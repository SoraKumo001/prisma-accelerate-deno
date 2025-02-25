# prisma-accelerate-deno

Sample of Prisma engine running in deno and behaving similarly to prisma-accelerate.

## Required settings on the deno-deploy side.

- Deno Settings/Environment Variables

- env

```env
SECRET="SECRET"
```

- src/index.ts

```ts
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
```

## Create API key

npx prisma-accelerate-local -s SECRET -m DB_URL

```bash
npx prisma-accelerate-local -s abc -m postgres://postgres:xxxx@db.example.com:5432/postgres?schema=public
```

## Client-side configuration

```
DATABASE_URL="prisma://xxxx.deno.dev/?api_key=xxx"
```
