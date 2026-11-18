# Oregano

Your town's food, in one place. A food-ordering platform for Chapainawabganj, Bangladesh: customer website and apps, restaurant app, rider app and admin dashboard, from one codebase.

## Run it locally

You need Node 24 and Docker.

```bash
corepack enable
pnpm install
pnpm db:up            # PostgreSQL, Redis and S3-compatible storage (SeaweedFS)
cp apps/api/.env.example apps/api/.env
pnpm db:migrate && pnpm db:seed && pnpm db:seed:demo
pnpm verify
```

Then start the API and worker (`pnpm --filter @oregano/api dev` and `dev:worker`) and open an app:

| App        | Command                                     | Address               |
| ---------- | ------------------------------------------- | --------------------- |
| Customer   | `pnpm --filter @oregano/customer dev:web`   | http://localhost:8081 |
| Restaurant | `pnpm --filter @oregano/restaurant dev:web` | http://localhost:8082 |
| Rider      | `pnpm --filter @oregano/rider dev:web`      | http://localhost:8083 |
| Admin      | `pnpm --filter @oregano/admin dev`          | http://localhost:8084 |

Sign-in codes are not sent in development: open `http://localhost:4000/v1/dev/otp/<your phone>` (with your own number in place of `<your phone>`). The demo phones are listed in `CLAUDE.md`.

See `CLAUDE.md` for the project rules and `docs/` for the blueprint and plans.
