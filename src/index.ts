import { PrismaPg } from "npm:@prisma/adapter-pg@5.8.0-dev.39";
import { getPrismaClient } from "npm:@prisma/client@5.8.0-dev.39/runtime/library.js";
import { FastifyReply, FastifyRequest, fastify } from "npm:fastify";
import pg from "npm:pg";
const { Pool } = pg;

const queryEngineWasmFileBytes = fetch(
  new URL(
    "https://esm.sh/@prisma/client@5.8.0-dev.39/runtime/query-engine.wasm"
  )
).then((r) => r.arrayBuffer());

const BaseConfig = {
  runtimeDataModel: { models: {}, enums: {}, types: {} },
  relativeEnvPaths: {
    rootEnvPath: "",
    schemaEnvPath: "",
  },
  relativePath: "",
  datasourceNames: ["db"],
  inlineSchema: "",
  dirname: "",
  clientVersion: "",
  engineVersion: "",
  activeProvider: "",
  inlineDatasources: {},
  inlineSchemaHash: "",
};

const getPrisma = ({
  request,
  reply,
  prismaMap,
  apiKey,
  ignoreSchemaError,
}: {
  request: FastifyRequest;
  reply: FastifyReply;
  apiKey?: string;
  prismaMap: {
    [key: string]: Promise<
      InstanceType<ReturnType<typeof getPrismaClient>> | undefined
    >;
  };
  ignoreSchemaError?: boolean;
}) => {
  if (apiKey) {
    const authorization = request.headers["authorization"];
    const key = authorization?.replace("Bearer ", "");
    if (key !== apiKey) {
      reply.status(401).send({ Unauthorized: { reason: "InvalidKey" } });
      return;
    }
  }
  const { hash } = request.params as {
    version: string;
    hash: string;
  };
  const engineVersion = request.headers["prisma-engine-hash"] as string;
  if (!engineVersion) {
    reply.status(404).send({ EngineNotStarted: { reason: "VersionMissing" } });
    return;
  }
  const prisma = prismaMap[`${engineVersion}-${hash}`];
  if (!prisma && !ignoreSchemaError) {
    reply.status(404).send({ EngineNotStarted: { reason: "SchemaMissing" } });
    return;
  }
  return prisma;
};

export const getHost = (request: FastifyRequest) => {
  const { headers } = request;
  return headers["x-forwarded-host"] ?? headers["host"];
};

export const createServer = ({
  datasourceUrl,
  apiKey,
}: {
  datasourceUrl: string;
  https?: { cert: string; key: string };
  apiKey?: string;
  wasm?: boolean;
}) => {
  const prismaMap: {
    [key: string]: Promise<
      InstanceType<ReturnType<typeof getPrismaClient>> | undefined
    >;
  } = {};

  return fastify()
    .post("/:version/:hash/graphql", async (request, reply) => {
      const prisma = await getPrisma({ apiKey, request, reply, prismaMap });
      if (!prisma) return;
      const query = JSON.parse(request.body as string);

      if (query.batch) {
        const result = await prisma._engine
          .requestBatch(query.batch, {
            containsWrite: true,
            transaction: query.transaction
              ? {
                  kind: "batch",
                  options: query.transaction,
                }
              : undefined,
          })
          .then((batchResult) => {
            return {
              batchResult: batchResult.map((v) => ("data" in v ? v.data : v)),
              extensions: {
                traces: [],
                logs: [],
              },
            };
          })
          .catch((e) => {
            return {
              errors: [
                {
                  error: String(e),
                  user_facing_error: {
                    is_panic: false,
                    message: e.message,
                    meta: e.meta,
                    error_code: e.code,
                    batch_request_idx: 1,
                  },
                },
              ],
            };
          });
        return result;
      }
      return prisma._engine
        .request(query, { isWrite: true })
        .then((result) => ("data" in result ? result.data : result))
        .catch((e: { message: string; code: number; meta: unknown }) => {
          return {
            errors: [
              {
                error: String(e),
                user_facing_error: {
                  message: e.message,
                  error_code: e.code,
                  is_panic: false,
                  meta: e.meta,
                },
              },
            ],
          };
        });
    })
    .post("/:version/:hash/transaction/start", async (request, reply) => {
      const prisma = await getPrisma({ apiKey, request, reply, prismaMap });
      if (!prisma) return;
      const { id } = await prisma._engine.transaction(
        "start",
        {},
        JSON.parse(request.body as string)
      );
      const { version, hash } = request.params as {
        version: string;
        hash: string;
      };
      return {
        id,
        extensions: {},
        "data-proxy": {
          endpoint: `https://${getHost(request)}/${version}/${hash}/itx/${id}`,
        },
      };
    })
    .post("/:version/:hash/itx/:id/graphql", async (request, reply) => {
      const prisma = await getPrisma({ apiKey, request, reply, prismaMap });
      if (!prisma) return;
      const { id } = request.params as {
        id: string;
      };
      const query = JSON.parse(request.body as string);
      const result = await prisma._engine
        .request(query, {
          isWrite: true,
          interactiveTransaction: { id, payload: {} },
        })
        .catch((e: { message: string; code: number; meta: unknown }) => {
          return {
            errors: [
              {
                error: String(e),
                user_facing_error: {
                  message: e.message,
                  error_code: e.code,
                  is_panic: false,
                  meta: e.meta,
                },
              },
            ],
          };
        });
      return result;
    })
    .post("/:version/:hash/itx/:id/commit", async (request, reply) => {
      const prisma = await getPrisma({ apiKey, request, reply, prismaMap });
      if (!prisma) return;
      const { id } = request.params as {
        id: string;
      };
      return prisma._engine.transaction("commit", {}, { id, payload: {} });
    })
    .post("/:version/:hash/itx/:id/rollback", async (request, reply) => {
      const prisma = await getPrisma({ apiKey, request, reply, prismaMap });
      if (!prisma) return;
      const { id } = request.params as {
        id: string;
      };
      return prisma._engine.transaction("rollback", {}, { id, payload: {} });
    })
    .put("/:version/:hash/schema", async (request, reply) => {
      if (
        await getPrisma({
          apiKey,
          request,
          reply,
          prismaMap,
          ignoreSchemaError: true,
        })
      )
        return;

      const { hash } = request.params as {
        version: string;
        hash: string;
      };
      const engineVersion = request.headers["prisma-engine-hash"] as string;

      const result = () => {
        const inlineSchema = request.body as string;
        const PrismaClient = getPrismaClient({
          ...BaseConfig,
          inlineSchema,
          dirname: "",
          engineVersion,
          generator: {
            name: "",
            provider: {
              fromEnvVar: null,
              value: "prisma-client-js",
            },
            output: {
              value: "",
              fromEnvVar: null,
            },
            config: {
              engineType: "wasm",
            },
            binaryTargets: [
              {
                fromEnvVar: null,
                value: "",
                native: true,
              },
            ],
            previewFeatures: ["driverAdapters"],
          },

          getQueryEngineWasmModule: async () => {
            const result = new WebAssembly.Module(
              await queryEngineWasmFileBytes
            );
            return result;
          },
        });

        const url = new URL(datasourceUrl);
        const schema = url.searchParams.get("schema");
        const pool = new Pool({
          connectionString: url.toString(),
        });
        const adapter = new PrismaPg(pool, { schema: schema ?? undefined });
        return new PrismaClient({ adapter });
      };
      prismaMap[`${engineVersion}-${hash}`] = Promise.resolve(result());
    });
};

createServer({
  datasourceUrl: Deno.env.get("DATABASE_URL")!,
})
  .listen()
  .then(console.log);
