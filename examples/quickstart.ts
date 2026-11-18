/**
 * Book a test delivery and follow it to the door, with no webhooks and no real rider.
 *
 *   yarn build && PICKRIDERS_KEY=sk_test_… node examples/quickstart.ts
 */
import Pickriders from 'pickriders';

const pickriders = new Pickriders(); // reads PICKRIDERS_KEY

const order = await pickriders.orders.create({
  service_area: 'NG-LA',
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
});
console.log(
  `Booked ${order.number} for ₦${(order.pricing.amount / 100).toLocaleString()}. Track: ${order.tracking_url}`,
);

const tracker = pickriders.orders.track(order);
tracker.on('status', (status) => console.log(`→ ${status}`));
tracker.on('rider_assigned', (o) => console.log(`  ${o.rider?.name} is on the way`));

// In test mode nobody rides: move it along as the test rider would.
await pickriders.test.orders.advance(order, { to: 'delivered' });

const final = await tracker.done();
console.log(`${final.number} ended ${final.status} at ${final.delivered_at}`);
