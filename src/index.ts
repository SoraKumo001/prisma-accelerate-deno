import { PrismaPg } from "npm:@prisma/adapter-pg@5.8.0-dev.41";
import { getPrismaClient } from "npm:@prisma/client@5.8.0-dev.41/runtime/library.js";
import pg from "npm:pg";
import {
  PrismaAccelerate,
  ResultError,
} from "npm:prisma-accelerate-local@0.1.8";

const queryEngineWasmFileBytes = fetch(
  new URL(
    "../../node_modules/@prisma/client/runtime/query-engine.wasm",
    import.meta.url
  )
)
  .then((r) => r.arrayBuffer())
  .catch(() =>
    fetch(
      new URL(
        "https://esm.sh/@prisma/client@5.8.0-dev.41/runtime/query-engine.wasm"
      )
    ).then((r) => r.arrayBuffer())
  );

export const createServer = ({
  datasourceUrl,
  apiKey,
  wasm,
}: {
  datasourceUrl: string;
  https?: { cert: string; key: string };
  apiKey?: string;
  wasm?: boolean;
}) => {
  const prismaAccelerate = new PrismaAccelerate({
    apiKey,
    wasm,
    getQueryEngineWasmModule: async () => {
      const result = new WebAssembly.Module(await queryEngineWasmFileBytes);
      return result;
    },
    PrismaPg,
    getPrismaClient,
    pg,
  });

  return Deno.serve(async (request) => {
    const url = new URL(request.url);
    const paths = url.pathname.split("/");
    const [_, version, hash, command] = paths;
    const headers = Object.fromEntries(request.headers.entries());
    const createResponse = (result: Promise<unknown>) =>
      result
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
              datasourceUrl,
            })
          );
      }
    }
    return new Response("Not Found", { status: 404 });
  });
};

createServer({
  datasourceUrl: Deno.env.get("DATABASE_URL")!,
  apiKey: Deno.env.get("API_KEY"),
  wasm: true,
});
