# Oregano

Your town's food, in one place. A food-ordering platform for Chapainawabganj, Bangladesh: customer website and apps, restaurant app, rider app and admin dashboard, from one codebase.

## Run it locally

You need Node 24 and Docker.

```bash
corepack enable
pnpm install
pnpm db:up
pnpm db:migrate && pnpm db:seed && pnpm db:seed:demo
pnpm verify
```

Then `pnpm --filter @oregano/customer dev:web` opens the customer app at http://localhost:8081.

See `CLAUDE.md` for the project rules and `docs/` for the blueprint and plans.
