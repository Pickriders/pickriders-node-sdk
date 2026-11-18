import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OrderEndedError,
  Pickriders,
  WaitTimeoutError,
  type Order,
  type OrderEvent,
  type OrderEventType,
  type OrderStatus,
} from '../src';
import { TEST_KEY, apiError, makeOrder, mockApi } from './helpers';

let n = 0;
const event = (type: OrderEventType, order: Order): OrderEvent =>
  ({
    object: 'event',
    id: `evt_${++n}`,
    type,
    created: order.updated,
    livemode: false,
    data: { object: order },
  }) as OrderEvent;

/** A client whose API answers GET /orders/ord_1 with whatever `current` is. */
function setup() {
  const state = { current: makeOrder({ status: 'searching' }) };
  const api = mockApi().on('GET', '/orders/ord_1', () => state.current);
  const pickriders = new Pickriders(TEST_KEY, { fetch: api.fetch, webhookSecret: 'whsec_x' });
  return { api, pickriders, state };
}

describe('tracking by webhooks', () => {
  it('follows every status the webhooks bring, then resolves done() and stops by itself', async () => {
    const { api, pickriders } = setup();
    const created = makeOrder({ status: 'searching' });
    pickriders.orders.store.put(created, 'api');

    const tracker = pickriders.orders.track(created, { poll: false });
    const statuses: OrderStatus[] = [];
    const assigned = vi.fn();
    tracker.on('status', (status) => statuses.push(status));
    tracker.on('rider_assigned', assigned);
    const done = tracker.done();

    await pickriders.webhooks.dispatch(event('order.rider_assigned', makeOrder({ status: 'rider_assigned' })));
    await pickriders.webhooks.dispatch(event('order.picked_up', makeOrder({ status: 'in_transit' })));
    await pickriders.webhooks.dispatch(event('order.delivered', makeOrder({ status: 'delivered' })));

    await expect(done).resolves.toMatchObject({ status: 'delivered' });
    expect(statuses).toEqual(['rider_assigned', 'in_transit', 'delivered']);
    expect(assigned).toHaveBeenCalledOnce();
    expect(tracker.getSnapshot()).toMatchObject({ done: true, stopped: true, source: 'webhook' });
    expect(api.calls).toHaveLength(0);
  });

  it('ignores a webhook that arrives late with an older snapshot', async () => {
    const { pickriders } = setup();
    pickriders.orders.store.put(makeOrder({ status: 'searching' }), 'api');
    const assigned = makeOrder({ status: 'rider_assigned' });
    const inTransit = makeOrder({ status: 'in_transit' });
    const tracker = pickriders.orders.track('ord_1', { poll: false });

    await pickriders.webhooks.dispatch(event('order.picked_up', inTransit));
    await pickriders.webhooks.dispatch(event('order.rider_assigned', assigned));

    expect(tracker.status).toBe('in_transit');
    tracker.stop();
  });

  it('passes on events about its order that don’t change it, like a new offer', async () => {
    const { pickriders } = setup();
    const order = makeOrder({ status: 'searching' });
    pickriders.orders.store.put(order, 'api');
    const tracker = pickriders.orders.track(order, { poll: false });
    const events: string[] = [];
    tracker.on('event', (e) => events.push(e.type));

    await pickriders.webhooks.dispatch(event('order.offer.created', order));
    await pickriders.webhooks.dispatch(event('order.offer.created', makeOrder({ id: 'ord_other' })));

    expect(events).toEqual(['order.offer.created']);
    tracker.stop();
  });
});

describe('until()', () => {
  it('rejects with OrderEndedError, carrying the order, when it ends another way', async () => {
    const { pickriders } = setup();
    pickriders.orders.store.put(makeOrder({ status: 'searching' }), 'api');
    const tracker = pickriders.orders.track('ord_1', { poll: false });
    const waiting = tracker.until('delivered');

    await pickriders.webhooks.dispatch(event('order.cancelled', makeOrder({ status: 'cancelled' })));

    const error = await waiting.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OrderEndedError);
    expect((error as OrderEndedError<Order>).order.status).toBe('cancelled');
  });

  it('resolves at once when the order is already there, and takes several statuses or a test', async () => {
    const { pickriders } = setup();
    pickriders.orders.store.put(makeOrder({ status: 'rider_assigned', rider: { name: 'Musa' } as never }), 'api');
    const tracker = pickriders.orders.track('ord_1', { poll: false });

    await expect(tracker.until(['rider_assigned', 'picking_up'])).resolves.toMatchObject({ status: 'rider_assigned' });
    await expect(tracker.until((order) => order.rider?.name === 'Musa')).resolves.toBeTruthy();
    tracker.stop();
  });

  it('gives up after its timeout, and the tracker keeps going', async () => {
    const { pickriders } = setup();
    pickriders.orders.store.put(makeOrder({ status: 'searching' }), 'api');
    const tracker = pickriders.orders.track('ord_1', { poll: false });

    await expect(tracker.until('delivered', { timeout: 10 })).rejects.toBeInstanceOf(WaitTimeoutError);
    expect(tracker.getSnapshot().stopped).toBe(false);
    tracker.stop();
  });

  it('rejects pending waits when the tracker is stopped', async () => {
    const { pickriders } = setup();
    pickriders.orders.store.put(makeOrder(), 'api');
    const tracker = pickriders.orders.track('ord_1', { poll: false });
    const waiting = tracker.done();
    tracker.stop();
    await expect(waiting).rejects.toMatchObject({ code: 'tracker_stopped' });
  });
});

describe('tracking by polling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('without webhooks, asks every 5 seconds until the order ends, then stops asking', async () => {
    const { api, pickriders, state } = setup();
    const tracker = pickriders.orders.track('ord_1');
    const done = tracker.done();

    await vi.advanceTimersByTimeAsync(0);
    expect(tracker.status).toBe('searching');
    expect(tracker.getSnapshot().source).toBe('poll');

    state.current = makeOrder({ status: 'in_transit' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tracker.status).toBe('in_transit');

    state.current = makeOrder({ status: 'delivered' });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(done).resolves.toMatchObject({ status: 'delivered' });

    const calls = api.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.calls).toHaveLength(calls);
  });

  it('slows to a 30-second safety net once webhooks are arriving', async () => {
    const { api, pickriders } = setup();
    const tracker = pickriders.orders.track('ord_1');
    await vi.advanceTimersByTimeAsync(0);
    await pickriders.webhooks.dispatch(event('order.searching', makeOrder({ status: 'searching', id: 'ord_other' })));
    const before = api.calls.length;

    await vi.advanceTimersByTimeAsync(5_000); // the poll already scheduled
    await vi.advanceTimersByTimeAsync(25_000);
    expect(api.calls.length).toBe(before + 1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(api.calls.length).toBe(before + 2);
    tracker.stop();
  });

  it('keeps trying through errors, telling `error` listeners, and recovers', async () => {
    const { api, pickriders } = setup();
    let fail = true;
    api.on('GET', '/orders/ord_1', () =>
      fail ? apiError(503, 'api_error', 'unavailable') : makeOrder({ status: 'picking_up' }),
    );
    const tracker = new Pickriders(TEST_KEY, { fetch: api.fetch, maxRetries: 0 }).orders.track('ord_1');
    const errors: string[] = [];
    tracker.on('error', (error) => errors.push(error.code));

    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toEqual(['unavailable']);
    expect(tracker.getSnapshot().error?.code).toBe('unavailable');

    fail = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tracker.status).toBe('picking_up');
    expect(tracker.getSnapshot().error).toBeUndefined();
    tracker.stop();
    void pickriders;
  });

  it('stops for good on an error that won’t go away (the order isn’t yours), rejecting waits', async () => {
    const api = mockApi().on('GET', '/orders/ord_404', () => apiError(404, 'not_found_error', 'order_not_found'));
    const tracker = new Pickriders(TEST_KEY, { fetch: api.fetch }).orders.track('ord_404');
    const done = tracker.done().catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(0);

    await expect(done).resolves.toMatchObject({ code: 'order_not_found' });
    expect(tracker.getSnapshot().stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.calls).toHaveLength(1);
  });
});

describe('observing', () => {
  it('for await yields each snapshot and ends after the final one', async () => {
    const { pickriders } = setup();
    pickriders.orders.store.put(makeOrder({ status: 'searching' }), 'api');
    const tracker = pickriders.orders.track('ord_1', { poll: false });

    const seen: OrderStatus[] = [];
    const reading = (async () => {
      for await (const order of tracker) seen.push(order.status);
    })();
    await pickriders.webhooks.dispatch(event('order.rider_assigned', makeOrder({ status: 'rider_assigned' })));
    await pickriders.webhooks.dispatch(event('order.delivered', makeOrder({ status: 'delivered' })));
    await reading;

    expect(seen).toEqual(['searching', 'rider_assigned', 'delivered']);
  });

  it('subscribe/getSnapshot give a new immutable state per change (fits useSyncExternalStore)', async () => {
    const { pickriders } = setup();
    pickriders.orders.store.put(makeOrder({ status: 'searching' }), 'api');
    const tracker = pickriders.orders.track('ord_1', { poll: false });
    const before = tracker.getSnapshot();
    const listener = vi.fn();
    tracker.subscribe(listener);

    await pickriders.webhooks.dispatch(event('order.rider_assigned', makeOrder({ status: 'rider_assigned' })));

    const after = tracker.getSnapshot();
    expect(after).not.toBe(before);
    expect(before.status).toBe('searching');
    expect(after).toMatchObject({ status: 'rider_assigned', done: false, source: 'webhook' });
    expect(listener).toHaveBeenCalledWith(after, before);
    expect(tracker.getSnapshot()).toBe(after);
    tracker.stop();
  });

  it('an order that already ended resolves done() without asking anyone', async () => {
    const { api, pickriders } = setup();
    pickriders.orders.store.put(makeOrder({ status: 'delivered' }), 'api');
    await expect(pickriders.orders.track('ord_1').done()).resolves.toMatchObject({ status: 'delivered' });
    expect(api.calls).toHaveLength(0);
  });
});
