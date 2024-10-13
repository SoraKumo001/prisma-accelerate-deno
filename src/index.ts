import pg from "npm:pg";
import { PrismaPg } from "npm:@prisma/adapter-pg";
import { createHandler, importModule } from "npm:prisma-accelerate-local/deno";
import runtime from "npm:@prisma/client/runtime/query_engine_bg.postgresql.js";

const engine = "@prisma/client/runtime/query_engine_bg.postgresql.wasm";

Deno.serve(
  createHandler({
    runtime: () => runtime,
    secret: Deno.env.get("SECRET")!,
    queryEngineWasmModule: importModule(engine, import.meta.url),
    adapter: (datasourceUrl: string) => {
      const url = new URL(datasourceUrl);
      const schema = url.searchParams.get("schema") ?? undefined;
      const pool = new pg.Pool({
        connectionString: url.toString() ?? undefined,
      });
      return new PrismaPg(pool, {
        schema,
      });
    },
  })
);
