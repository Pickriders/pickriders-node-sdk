/**
 * A checkout server: books a delivery when an order is paid, and follows it with webhooks.
 * Plain node:http, so it runs as is; with Express, see the README.
 *
 *   yarn build && PICKRIDERS_KEY=sk_test_… PICKRIDERS_WEBHOOK_SECRET=whsec_… node examples/server.ts
 *   Then point a webhook endpoint at http://<public url>/webhooks/pickriders (dashboard → Webhooks).
 */
import { createServer } from 'node:http';

import Pickriders from 'pickriders';

const pickriders = new Pickriders({ serviceArea: 'NG-LA' });

// React to events wherever they're about. Throwing makes Pickriders retry the event later.
pickriders.webhooks.on('order.rider_assigned', (event) => {
  console.log(`${event.data.object.number}: ${event.data.object.rider?.name} is picking it up`);
});
pickriders.webhooks.on('order.delivered', async (event) => {
  console.log(`${event.data.object.number} delivered. Mark it fulfilled in your database here.`);
});
pickriders.webhooks.on('wallet.balance_low', (event) => {
  console.warn(`Wallet below ₦${event.data.threshold / 100}: top up.`);
});

const webhooks = pickriders.webhooks.nodeHandler();

createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/webhooks/pickriders') return webhooks(req, res);

  if (req.method === 'POST' && req.url === '/checkout') {
    const order = await pickriders.orders.create({
      pickup: {
        address: '1 Admiralty Way, Lekki',
        lat: 6.4281,
        lng: 3.4216,
        contact: { name: 'Shop', phone: '+2348012345678' },
      },
      dropoff: {
        address: '12 Awolowo Rd, Ikoyi',
        lat: 6.4474,
        lng: 3.4248,
        contact: { name: 'Ada', phone: '+2348098765432' },
      },
      reference: `cart_${Date.now()}`,
    });

    // The tracker hears the same webhooks, and asks the API if they go quiet.
    pickriders.orders
      .track(order)
      .done()
      .then((final) => console.log(`${final.number} finished: ${final.status}`));

    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ tracking_url: order.tracking_url }));
  }

  res.statusCode = 404;
  res.end();
}).listen(3000, () => console.log('Listening on http://localhost:3000'));
