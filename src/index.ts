import { PrismaPg } from "npm:@prisma/adapter-pg";
import { getPrismaClient } from "npm:@prisma/client/runtime/library.js";
import pg from "npm:pg";
import {
  PrismaAccelerate,
  ResultError,
} from "npm:prisma-accelerate-local@1.1.0/lib";
import runtime from "npm:@prisma/client/runtime/query_engine_bg.postgresql.js";

const engine = "query_engine_bg.postgresql.wasm";
const queryEngineWasmFileBytes: Promise<ArrayBuffer> = (async () =>
  (await fetch(
    new URL(
      `../../node_modules/@prisma/client/runtime/${engine}`,
      import.meta.url
    )
  )
    .then((r) => r.arrayBuffer())
    .catch(() => undefined)) ??
  (await fetch(
    new URL(`../node_modules/@prisma/client/runtime/${engine}`, import.meta.url)
  ).then((r) => r.arrayBuffer())))();

const getAdapter = (datasourceUrl: string) => {
  const url = new URL(datasourceUrl);
  const schema = url.searchParams.get("schema");
  const pool = new pg.Pool({
    connectionString: url.toString(),
  });
  return new PrismaPg(pool, {
    schema: schema ?? undefined,
  });
};

export const createServer = ({
  secret,
}: {
  https?: { cert: string; key: string };
  secret: string;
}) => {
  const prismaAccelerate = new PrismaAccelerate({
    secret,
    adapter: (datasourceUrl) => getAdapter(datasourceUrl),
    getQueryEngineWasmModule: async () =>
      new WebAssembly.Module(await queryEngineWasmFileBytes),
    getRuntime: () => runtime,
    getPrismaClient: getPrismaClient,
  });

  return Deno.serve(async (request) => {
    const url = new URL(request.url);
    const paths = url.pathname.split("/");
    const [_, version, hash, command] = paths;
    const headers = Object.fromEntries(request.headers.entries());
    const createResponse = (result: Promise<unknown>) => {
      const response = result
        .then((r) => {
          return new Response(JSON.stringify(r), {
            headers: { "content-type": "application/json" },
          });
        })
        .catch((e) => {
          if (e instanceof ResultError) {
            return new Response(JSON.stringify(e.value), {
              status: e.code,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response(JSON.stringify(e), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        });
      return response;
    };
    if (request.method === "POST") {
      const body = await request.text();
      switch (command) {
        case "graphql":
          return createResponse(
            prismaAccelerate.query({ body, hash, headers })
          );
        case "transaction":
          return createResponse(
            prismaAccelerate.startTransaction({
              body,
              hash,
              headers,
              version,
            })
          );
        case "itx": {
          const id = paths[4];
          switch (paths[5]) {
            case "commit":
              return createResponse(
                prismaAccelerate.commitTransaction({
                  id,
                  hash,
                  headers,
                })
              );
            case "rollback":
              return createResponse(
                prismaAccelerate.rollbackTransaction({
                  id,
                  hash,
                  headers,
                })
              );
          }
        }
      }
    } else if (request.method === "PUT") {
      const body = await request.text();
      switch (command) {
        case "schema":
          return createResponse(
            prismaAccelerate.updateSchema({
              body,
              hash,
              headers,
            })
          );
      }
    }
    return new Response("Not Found", { status: 404 });
  });
};

createServer({
  secret: Deno.env.get("SECRET")!,
});
