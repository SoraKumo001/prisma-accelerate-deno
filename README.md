# prisma-accelerate-deno

Sample of Prisma engine running in deno and behaving similarly to prisma-accelerate.

## Required settings on the deno-deploy side.

- Deno Settings/Environment Variables

```env
SECRET="SECRET"
```

## Create API key

npx prisma-accelerate-local -s SECRET -m DB_URL

```bash
npx prisma-accelerate-local -s abc -m postgres://postgres:xxxx@db.example.com:5432/postgres?schema=public
```

```

## Client-side configuration

```

DATABASE_URL="prisma://xxxx.deno.dev/?api_key=xxx"

```

```
