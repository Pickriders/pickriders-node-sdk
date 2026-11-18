# Pickriders for Node.js and the browser

Book deliveries and follow them to the door, in a few lines of TypeScript or JavaScript.

```ts
import Pickriders from 'pickriders';

const pickriders = new Pickriders(); // reads PICKRIDERS_KEY

const order = await pickriders.orders.create({ pickup, dropoff });
const delivered = await pickriders.orders.track(order).done();
```

- **Follows every order to the end, for you.** One tracker hears your webhooks, asks the API when they go quiet, never moves backwards on a late event, and stops by itself once the order is delivered, cancelled or failed.
- **Safe to retry, by default.** Every POST carries an Idempotency-Key, and network errors, 429s and 5xx are retried with backoff. A retry never books a delivery twice.
- **Typed end to end.** Every request, response and webhook event is typed, so `event.data.object` is an `Order` the moment you check `event.type`.
- **Runs where your code runs.** Node.js 20+, Bun, Deno, Next.js, Cloudflare Workers, and in the browser through `pickriders/client`, which needs no secret key.
- **No dependencies.** Nothing to audit but this package.

## Install

```sh
npm install pickriders
# or: yarn add pickriders · pnpm add pickriders · bun add pickriders
```

Get a test key (`sk_test_…`) from the dashboard under **Developers → API keys**, and set it as `PICKRIDERS_KEY`.

## Book a delivery

```ts
import Pickriders from 'pickriders';

const pickriders = new Pickriders({ serviceArea: 'NG-LA' });

const order = await pickriders.orders.create({
  pickup: {
    address: '1 Admiralty Way, Lekki Phase 1, Lagos',
    lat: 6.4281,
    lng: 3.4216,
    contact: { name: 'Mama Put Kitchen', phone: '+2348012345678' },
  },
  dropoff: {
    address: '12 Awolowo Road, Ikoyi, Lagos',
    lat: 6.4474,
    lng: 3.4248,
    contact: { name: 'Ada Obi', phone: '+2348098765432' },
    instructions: 'Gate 3, ask for Ada',
  },
  reference: 'cart_8812', // your own id: unique per team, and searchable
});

order.tracking_url; // send this to your customer
```

Give several drop-offs for a **batch** (one pickup, many drop-offs) or several pickups for a **bulk** order (many pickups, one drop-off). The SDK sets the order type for you. To pay a price you showed the customer first, create a quote and pass its id:

```ts
const quote = await pickriders.quotes.create({ type: 'single', service_area: 'NG-LA', stops: [pickup, dropoff] });
const order = await pickriders.orders.create({ quote_id: quote.id });
```

Amounts are in kobo: `order.pricing.amount / 100` is naira.

## Follow it to the door

`orders.track()` returns a tracker that knows the order's latest state and tells you when it changes.

```ts
const tracker = pickriders.orders.track(order);

tracker.on('status', (status, order) => console.log(status));
tracker.on('rider_assigned', (order) => notifyCustomer(`${order.rider?.name} is on the way`));
tracker.on('delivered', (order) => markFulfilled(order.reference));

const final = await tracker.done(); // delivered, cancelled or failed
```

Wait for one moment instead of the end:

```ts
await tracker.until('in_transit'); // rejects with OrderEndedError if it's cancelled first
await tracker.until(['picking_up', 'in_transit'], { timeout: 10 * 60_000 });
await tracker.until((order) => order.rider !== null);
```

Or read every change as it happens:

```ts
for await (const order of pickriders.orders.track(order)) {
  console.log(order.status); // ends after the final status
}
```

### Where the updates come from

You don't have to choose. The tracker uses whatever reaches it:

| You have                          | The tracker                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| Webhooks flowing into this server | Updates the moment each event arrives, and checks with the API every 30 s as a safety net.     |
| No webhooks (a script, a worker)  | Asks the API every 5 s (every minute while an order is scheduled).                             |
| Both, across several servers      | Each server's tracker sees the order through: if its webhooks land elsewhere, it asks the API. |

Set `poll` to change this: `track(order, { poll: false })` for webhooks only, or `{ poll: 10_000 }` to ask every 10 seconds. A late or repeated webhook never moves an order backwards, because only newer snapshots are kept.

The tracker stops once the order ends. If you stop caring sooner, call `tracker.stop()`, or let `using tracker = pickriders.orders.track(order)` stop it for you at the end of the block.

## Webhooks

Create an endpoint in the dashboard (or with `pickriders.webhookEndpoints.create()`), and set its signing secret as `PICKRIDERS_WEBHOOK_SECRET`. Then mount the handler. It checks the signature, ignores repeats, updates every tracker, and calls your listeners.

```ts
pickriders.webhooks.on('order.delivered', async (event) => {
  await db.orders.markDelivered(event.data.object.reference);
});
pickriders.webhooks.on('order.*', (event) => log(event.type)); // a whole group
pickriders.webhooks.on('wallet.balance_low', (event) => alertFinance(event.data.threshold));
```

If a listener throws, the handler answers 500 and Pickriders sends the event again later. The handler only marks an event done once every listener has succeeded.

**Next.js** (App Router), and the same for **Hono, Remix, SvelteKit, Cloudflare Workers, Bun and Deno**:

```ts
// app/api/webhooks/pickriders/route.ts
export const POST = pickriders.webhooks.handler();
```

**Express.** Give the route the raw body, so the signature can be checked:

```ts
app.post('/webhooks/pickriders', express.raw({ type: 'application/json' }), pickriders.webhooks.nodeHandler());
```

**node:http**, Fastify (with a raw body) and others:

```ts
const handle = pickriders.webhooks.nodeHandler();
createServer((req, res) => (req.url === '/webhooks/pickriders' ? handle(req, res) : notFound(res)));
```

To check a signature yourself: `const event = await pickriders.webhooks.constructEvent(rawBody, signatureHeader)`. To test your route, sign your own events with `await pickriders.webhooks.generateTestHeader(body)`.

## In the browser and in mobile apps

Never put a secret key in client code: the SDK refuses to run with one in a browser. To show customers their delivery, pass the order's `tracking_url` from your server and follow it with `pickriders/client`. It needs no key and sees only what the tracking link shows (status, rider, ETA), never phone numbers.

```ts
import { trackDelivery } from 'pickriders/client';

const delivery = trackDelivery(trackingUrl);
delivery.on('status', (status) => render(status));
```

Trackers are stores: `subscribe` and `getSnapshot` plug straight into React, Vue and Svelte.

```tsx
import { useEffect, useState, useSyncExternalStore } from 'react';
import { trackDelivery } from 'pickriders/client';

function useDelivery(trackingUrl: string) {
  const [delivery] = useState(() => trackDelivery(trackingUrl));
  useEffect(() => () => delivery.stop(), [delivery]);
  return useSyncExternalStore(delivery.subscribe, delivery.getSnapshot);
}

function DeliveryStatus({ trackingUrl }: { trackingUrl: string }) {
  const { data, error } = useDelivery(trackingUrl);
  if (!data) return <p>Loading…</p>;
  return (
    <p>
      {data.status.replace('_', ' ')}
      {data.rider && ` · ${data.rider.name}`}
      {data.eta_s ? ` · about ${Math.ceil(data.eta_s / 60)} min` : null}
      {error && ' (reconnecting)'}
    </p>
  );
}
```

`getSnapshot()` returns `{ data, status, done, error, source, updatedAt, stopped }`, a new object only when something changed.

## Watching every order

Every order the client sees (created, fetched, listed, or sent by webhook) lands in one store, newest snapshot wins:

```ts
pickriders.orders.store.subscribe(({ order, previous, source }) => {
  dashboard.update(order); // source: 'api', 'webhook' or 'poll'
});
pickriders.orders.store.get('ord_…');
```

## Everything else

| Area              | Methods                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orders            | `orders.create` `retrieve` `list` `cancel` `reschedule` `dispatch` `updateStop` `tracking` `events` `track` · `orders.offers.list` `accept` `decline` |
| Quotes            | `quotes.create` `retrieve`                                                                                                                            |
| Wallet            | `wallet.retrieve` `transactions` `createFundingSession` `fundingAccount`                                                                              |
| Riders and areas  | `riders.availability` · `serviceAreas.list`                                                                                                           |
| Webhook endpoints | `webhookEndpoints.create` `retrieve` `list` `update` `del` `rollSecret` `test`                                                                        |
| Events            | `events.retrieve` `list` `resend`                                                                                                                     |
| Account           | `account.retrieve` · `ping()` · `status()`                                                                                                            |
| Test mode         | `test.orders.advance` · `test.wallet.fund`                                                                                                            |

Every method that takes an order takes the order itself or its id. Field names are exactly the API's (`tracking_url`, `service_area`), so what you read in the docs, a webhook or a log is what you type.

### Lists

Await a list for one page, or iterate it to walk every page:

```ts
const page = await pickriders.orders.list({ status: 'delivered', limit: 50 });

for await (const order of pickriders.orders.list({ created: { gte: new Date('2026-11-01') } })) {
  // every matching order, page by page
}

const recent = await pickriders.events.list({ type: 'order.*' }).toArray({ max: 200 });
```

## Test mode

With a `sk_test_` key nothing reaches a real rider or moves real money. Move orders along yourself:

```ts
await pickriders.test.orders.advance(order); // the next step
await pickriders.test.orders.advance(order, { to: 'delivered' }); // every step, with every event
await pickriders.test.wallet.fund({ amount: 50_000_00 }); // ₦50,000 of test money
```

Or let them run by themselves with `test_options: { auto_advance: true }`, or rehearse failures with `test_options: { scenario: 'no_riders' | 'rider_cancels' | 'delivery_fails' }`.

## Errors

Every error is a `PickridersError`. Its class says what kind; its `code` says exactly what, and is stable enough to switch on.

```ts
import { InsufficientFundsError, InvalidRequestError, PickridersError } from 'pickriders';

try {
  await pickriders.orders.create(params);
} catch (error) {
  if (error instanceof InsufficientFundsError) return askToTopUp();
  if (error instanceof InvalidRequestError) return showFieldError(error.param, error.message); // param: 'stops.1.lat'
  if (error instanceof PickridersError) console.error(error.code, error.requestId); // quote requestId to support
  throw error;
}
```

| Class                        | When                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `InvalidRequestError`        | A field is missing or wrong (`param` names it), or the order can't do that now.         |
| `AuthenticationError`        | The key is missing, wrong, revoked, or the team is suspended.                           |
| `PermissionError`            | A restricted key, an IP allowlist, or live mode not approved yet.                       |
| `NotFoundError`              | No such object for this team and mode.                                                  |
| `InsufficientFundsError`     | The wallet's available balance doesn't cover the order.                                 |
| `IdempotencyError`           | An Idempotency-Key was reused with a different request.                                 |
| `RateLimitError`             | Still too many requests after retrying. `retryAfter` says how long to wait.             |
| `ApiError`                   | A problem at Pickriders, after retrying.                                                |
| `ConnectionError`            | The API couldn't be reached. `TimeoutError` when it took longer than `timeout`.         |
| `SignatureVerificationError` | A webhook signature didn't check out.                                                   |
| `OrderEndedError`            | `until()` waited for a status, but the order ended another way. `error.order` says how. |
| `WaitTimeoutError`           | `until()` or `done()` passed its `timeout`.                                             |

## Configuration

```ts
const pickriders = new Pickriders({
  apiKey: 'sk_test_…', // default: PICKRIDERS_KEY
  webhookSecret: 'whsec_…', // default: PICKRIDERS_WEBHOOK_SECRET
  serviceArea: 'NG-LA', // for orders that don't name one; default: PICKRIDERS_SERVICE_AREA
  timeout: 30_000, // ms per request
  maxRetries: 2, // after network errors, 429s and 5xx
  baseUrl: undefined, // default: PICKRIDERS_BASE_URL, else production
  fetch: undefined, // your own fetch, e.g. for a proxy
});
```

Any call can override these for itself, as its last argument:

```ts
await pickriders.orders.create(params, { idempotencyKey: `cart_${cart.id}`, timeout: 10_000, maxRetries: 5 });
```

Passing your own `idempotencyKey` (your cart id, say) makes a retry safe even after your process restarts.

## JavaScript and CommonJS

The package ships ES modules, CommonJS and type declarations:

```js
import Pickriders from 'pickriders'; // ES modules
const { Pickriders } = require('pickriders'); // CommonJS
```

## Requirements

Node.js 20 or later, Bun, Deno, or any runtime with `fetch` and Web Crypto. `pickriders/client` runs in every modern browser.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Report security issues privately through [GitHub security advisories](https://github.com/Pickriders/pickriders-node/security/advisories/new), not in public issues.
