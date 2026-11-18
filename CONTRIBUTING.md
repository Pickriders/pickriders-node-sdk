# Contributing

## Set up

```sh
nvm use          # Node 22: the dev tools need 22+, the SDK itself supports 20+
yarn install     # also installs the pre-commit hook
yarn test:watch  # tests re-run as you edit
```

## Before a pull request

```sh
yarn validate    # typecheck, lint, format, tests, and the package's exports and types
yarn changeset   # say what changed for users: patch, minor or major
```

Branch off `dev` and open the pull request into `dev`. `main` is what's released.

## How the code is laid out

| Path                       | What                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `src/index.ts`             | The server entry, `pickriders`. Everything public is exported here.                   |
| `src/client.ts`            | The browser entry, `pickriders/client`. Must never import anything that takes a key.  |
| `src/pickriders.ts`        | The client class: options, environment variables, the browser guard, resource wiring. |
| `src/core/`                | HTTP (retries, idempotency, timeouts), errors, pagination, runtime helpers.           |
| `src/resources/`           | One class per API area. Thin: build the request, put orders in the store.             |
| `src/state/`               | The emitter, the generic store and the order store (newest snapshot wins).            |
| `src/tracking/`            | `Tracker` (shared engine), `OrderTracker` (server), `DeliveryTracker` (browser).      |
| `src/webhooks/`            | Signature checks (Web Crypto) and the handlers.                                       |
| `src/types.ts`             | Friendly names for API shapes, and the event types.                                   |
| `src/generated/openapi.ts` | Generated. Don't edit: run `yarn generate`.                                           |
| `test/`                    | Vitest. `test/helpers.ts` has a fake API. `sandbox.test.ts` hits the real sandbox.    |
| `examples/`                | Runnable, and type-checked with the rest.                                             |

## When the API changes

1. Refresh the OpenAPI document: `yarn openapi:pull` (production), `yarn openapi:pull <url>`, or from a local backend: `yarn openapi:pull ../backend-api/developer-openapi.json` after `yarn swagger:dump:developer` there.
2. `yarn generate` regenerates `src/generated/openapi.ts`.
3. Add or change the resource method, a friendly type in `src/types.ts` if needed, and tests.
4. A new webhook event type goes in `ORDER_EVENT_TYPES` or `EVENT_TYPES` in `src/types.ts`.

## Testing against the sandbox

```sh
PICKRIDERS_TEST_KEY=sk_test_… yarn test:sandbox
PICKRIDERS_TEST_KEY=sk_test_… PICKRIDERS_BASE_URL=https://<dev api>/developer/api/v1 yarn test:sandbox
```

CI runs it when the `PICKRIDERS_TEST_KEY` secret is set.

## Principles

- **Ease over features.** The obvious call should be the right one: safe retries, typed results, clear errors that say what to do.
- **No runtime dependencies.** Use `fetch`, Web Crypto and `TextEncoder`, so the SDK runs in Node, Bun, Deno, edge runtimes and browsers alike.
- **Field names are the API's.** Requests and responses stay snake_case, exactly as in the docs and webhooks.
- **Never move an order backwards.** Anything that updates an order goes through the order store.
- **Errors say what to do next.** Every message a developer can hit should name the fix.

## Node versions

The SDK supports Node 20+, but the dev tools need Node 22+. So CI runs the full checks on Node 22 and 24, and on Node 20, 22 and 24 installs the packed build into an empty project and runs `test/compat/built-package.test.mjs` with `node --test`. To run that yourself:

```sh
yarn build && npm pack
mkdir /tmp/app && cd /tmp/app && npm init -y && npm i <path to pickriders-x.y.z.tgz>
cp <repo>/test/compat/built-package.test.mjs . && node --test built-package.test.mjs
```

Pull requests into `dev` and `main` can only merge once the **CI passed** check succeeds.
