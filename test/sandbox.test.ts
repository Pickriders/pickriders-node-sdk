/**
 * The quickstart, against the real sandbox. Runs only with a test key:
 *
 *   PICKRIDERS_TEST_KEY=sk_test_… yarn test:sandbox
 *   PICKRIDERS_BASE_URL=https://<dev api>/developer/api/v1 to aim at another environment.
 *
 * It books one test order, follows it to delivered and checks what came back. Test mode moves no
 * real money and sends no real rider.
 */
import { describe, expect, it } from 'vitest';

import Pickriders, { type OrderStatus } from '../src';

const key = process.env.PICKRIDERS_TEST_KEY;

describe.skipIf(!key)('sandbox quickstart', () => {
  it('books a delivery and follows it to the door', { timeout: 90_000 }, async () => {
    const pickriders = new Pickriders(key, { serviceArea: 'NG-LA' });

    await expect(pickriders.account.retrieve()).resolves.toMatchObject({ object: 'account' });

    const order = await pickriders.orders.create({
      pickup: {
        address: '1 Admiralty Way, Lekki Phase 1, Lagos',
        lat: 6.4281,
        lng: 3.4216,
        contact: { name: 'SDK sandbox test', phone: '+2348000000000' },
      },
      dropoff: {
        address: '12 Awolowo Road, Ikoyi, Lagos',
        lat: 6.4474,
        lng: 3.4248,
        contact: { name: 'SDK sandbox recipient', phone: '+2348000000001' },
      },
      metadata: { source: 'pickriders-node sandbox test' },
    });
    expect(order).toMatchObject({
      object: 'order',
      livemode: false,
      metadata: { source: 'pickriders-node sandbox test' },
    });

    const tracker = pickriders.orders.track(order, { poll: 2_000 });
    const statuses: OrderStatus[] = [];
    tracker.on('status', (status) => statuses.push(status));

    try {
      await pickriders.test.orders.advance(order, { to: 'delivered' });
      const delivered = await tracker.done({ timeout: 60_000 });

      expect(delivered.status).toBe('delivered');
      expect(delivered.delivered_at).toEqual(expect.any(String));
      expect(statuses.at(-1)).toBe('delivered');
    } finally {
      tracker.stop();
      const latest = await pickriders.orders.retrieve(order);
      if (latest.status !== 'delivered' && latest.status !== 'cancelled') await pickriders.orders.cancel(order);
    }
  });
});
