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

## Keeping the SDK, the API and the docs in step (required)

- **When backend-api's Developer API changes** (backend-api CLAUDE.md hard rule 11): `yarn openapi:pull <dump or URL>`, `yarn generate`, then update `src/types.ts` (event types in `ORDER_EVENT_TYPES` / `EVENT_TYPES`), the resource methods, webhook code if the payload or signature changed, tests and README, plus a changeset. The **API drift** workflow (`openapi-drift.yml`) fails daily while `openapi/developer-openapi.json` differs from the deployed document.
- **When the SDK's public surface changes** (an export, a method, an option, an event, an error, or behaviour such as polling, retries or webhook handling), the same piece of work updates the docs in `../developer-dashboard`: the SDK pages (`src/app/docs/_content/sdks.tsx`), the tutorial (`tutorial.tsx`) and their examples in `docs-snippets/`. After the release, bump `pickriders` there; its `yarn test` type-checks every example against the published package, so a breaking change shows up as failing examples to fix.
- Never document behaviour the code doesn't have. Check claims against `src/` and the backend's source.
