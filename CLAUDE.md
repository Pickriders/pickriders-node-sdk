# pickriders-node

The official Pickriders SDK (npm `pickriders`): TypeScript, zero runtime dependencies, ESM + CJS, server entry `pickriders` and browser entry `pickriders/client`. Read CONTRIBUTING.md for layout and principles.

## Commands

- `yarn validate` — the full gate: typecheck, lint, format check, tests, build, publint and attw. Run before calling anything ready.
- `yarn test` / `yarn test:watch`; `yarn test:sandbox` needs `PICKRIDERS_TEST_KEY`.
- `yarn format` (prettier) — never `npx prettier` with other settings.
- `yarn generate` after changing `openapi/developer-openapi.json` (`yarn openapi:pull` refreshes it).

## Rules

- Never edit `src/generated/` by hand.
- `src/client.ts` and everything it imports must work in a browser and never accept a secret key.
- No Node-only APIs (`node:crypto`, `Buffer`, `process`) in `src/`, except through `src/core/runtime.ts`. Tests may use them.
- Keep API field names snake_case. Methods that take an order accept the order or its id.
- Every order an API call returns goes through `OrderStore.put`.
- New behaviour needs tests; user-visible changes need a changeset (`yarn changeset`).
- Never read or print `.env*` files or secrets.
- Git: branch off `dev`, PR into `dev`. Don't add AI co-authors or "Generated with" lines to commits or PRs.
