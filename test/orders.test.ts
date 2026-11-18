import { describe, expect, it } from 'vitest';

import { InvalidRequestError, OrderStore, Pickriders, type StopInput } from '../src';
import { normalizeCreate } from '../src/resources/orders';
import { isNewer } from '../src/state/order-store';
import { TEST_KEY, makeOrder, mockApi } from './helpers';

const stop = (address: string): StopInput => ({
  address,
  lat: 6.43,
  lng: 3.42,
  contact: { name: 'Ada', phone: '+2348012345678' },
});
const shop = stop('1 Admiralty Way');
const home = stop('12 Awolowo Rd');
const office = stop('5 Broad St');

describe('orders.create: the short way', () => {
  it('one pickup and one drop-off is a single order', () => {
    expect(normalizeCreate({ service_area: 'NG-LA', pickup: shop, dropoff: home })).toEqual({
      service_area: 'NG-LA',
      type: 'single',
      stops: [shop, home],
    });
  });

  it('several drop-offs make a batch, several pickups a bulk order, pickups first', () => {
    expect(normalizeCreate({ pickup: shop, dropoff: [home, office] })).toMatchObject({
      type: 'batch',
      stops: [shop, home, office],
    });
    expect(normalizeCreate({ pickup: [shop, office], dropoff: home })).toMatchObject({
      type: 'bulk',
      stops: [shop, office, home],
    });
  });

  it('refuses several pickups and several drop-offs, and a missing side, naming the field', () => {
    expect(() => normalizeCreate({ pickup: [shop, office], dropoff: [home, office] })).toThrow(InvalidRequestError);
    const error = (() => {
      try {
        normalizeCreate({ pickup: shop } as never);
      } catch (e) {
        return e as InvalidRequestError;
      }
    })();
    expect(error).toMatchObject({ code: 'parameter_missing', param: 'dropoff' });
  });

  it('fills in the client’s service area, but never over yours or a quote’s', () => {
    expect(normalizeCreate({ pickup: shop, dropoff: home }, 'NG-LA')).toMatchObject({ service_area: 'NG-LA' });
    expect(normalizeCreate({ service_area: 'NG-FC', pickup: shop, dropoff: home }, 'NG-LA')).toMatchObject({
      service_area: 'NG-FC',
    });
    expect(normalizeCreate({ quote_id: 'quo_1' }, 'NG-LA')).toEqual({ quote_id: 'quo_1' });
  });

  it('passes the API’s own shape through untouched', () => {
    const raw = { type: 'single' as const, service_area: 'NG-LA', stops: [shop, home], reference: 'inv_42' };
    expect(normalizeCreate(raw)).toEqual(raw);
  });

  it('sends it, and remembers the order it gets back', async () => {
    const created = makeOrder({ id: 'ord_9' });
    const api = mockApi().on('POST', '/orders', () => created);
    const pickriders = new Pickriders(TEST_KEY, { fetch: api.fetch, serviceArea: 'NG-LA' });

    const order = await pickriders.orders.create({ pickup: shop, dropoff: home, metadata: { cart: 'c_1' } });

    expect(order).toEqual(created);
    expect(api.calls[0]!.body).toEqual({
      service_area: 'NG-LA',
      metadata: { cart: 'c_1' },
      type: 'single',
      stops: [shop, home],
    });
    expect(pickriders.orders.store.get('ord_9')).toEqual(created);
  });
});

describe('orders.list', () => {
  const page = (ids: string[], has_more: boolean) => ({
    object: 'list',
    data: ids.map((id) => makeOrder({ id })),
    has_more,
    url: '/orders',
  });

  it('awaits as one page, and walks every page with for await', async () => {
    const api = mockApi().on('GET', '/orders', (req) => {
      const after = req.url.searchParams.get('starting_after');
      if (!after) return page(['ord_5', 'ord_4'], true);
      if (after === 'ord_4') return page(['ord_3', 'ord_2'], true);
      return page(['ord_1'], false);
    });
    const pickriders = new Pickriders(TEST_KEY, { fetch: api.fetch });

    const first = await pickriders.orders.list({ limit: 2, status: 'delivered' });
    expect(first.data.map((o) => o.id)).toEqual(['ord_5', 'ord_4']);

    const ids: string[] = [];
    for await (const order of pickriders.orders.list({ limit: 2, status: 'delivered' })) ids.push(order.id);
    expect(ids).toEqual(['ord_5', 'ord_4', 'ord_3', 'ord_2', 'ord_1']);
    expect(api.calls.every((c) => c.url.searchParams.get('status') === 'delivered')).toBe(true);

    await expect(pickriders.orders.list({ limit: 2 }).toArray({ max: 3 })).resolves.toHaveLength(3);
  });

  it('fetches nothing until awaited or iterated', () => {
    const api = mockApi();
    void new Pickriders(TEST_KEY, { fetch: api.fetch }).orders.list();
    expect(api.calls).toHaveLength(0);
  });
});

describe('every order the API returns lands in the store', () => {
  it('retrieve, cancel and test advance', async () => {
    const api = mockApi()
      .on('GET', '/orders/ord_1', () => makeOrder({ status: 'searching' }))
      .on('POST', '/orders/ord_1/cancel', () => makeOrder({ status: 'cancelled' }))
      .on('POST', '/test/orders/ord_2/advance', () => makeOrder({ id: 'ord_2', status: 'delivered' }));
    const pickriders = new Pickriders(TEST_KEY, { fetch: api.fetch });

    await pickriders.orders.retrieve('ord_1');
    expect(pickriders.orders.store.get('ord_1')?.status).toBe('searching');
    await pickriders.orders.cancel({ id: 'ord_1' }, { reason: 'Customer changed their mind' });
    expect(pickriders.orders.store.get('ord_1')?.status).toBe('cancelled');
    expect(api.calls[1]!.body).toEqual({ reason: 'Customer changed their mind' });
    await pickriders.test.orders.advance('ord_2', { to: 'delivered' });
    expect(pickriders.orders.store.get('ord_2')?.status).toBe('delivered');
  });
});

describe('OrderStore', () => {
  it('only lets a newer snapshot replace an older one', () => {
    const store = new OrderStore();
    const older = makeOrder({ status: 'rider_assigned' });
    const newer = makeOrder({ status: 'in_transit' });

    expect(store.put(newer, 'webhook')).toBe(true);
    expect(store.put(older, 'webhook')).toBe(false);
    expect(store.get('ord_1')?.status).toBe('in_transit');
  });

  it('on the same timestamp, takes a changed snapshot but never un-ends an order', () => {
    const delivered = makeOrder({ status: 'delivered' });
    expect(isNewer({ ...delivered, status: 'in_transit' }, delivered)).toBe(false);
    expect(isNewer({ ...delivered, rider: { name: 'Musa' } as never }, delivered)).toBe(true);
    expect(isNewer({ ...delivered }, delivered)).toBe(false);
  });

  it('tells subscribers what changed and where it came from, and forgets the oldest past its limit', () => {
    const store = new OrderStore(2);
    const seen: string[] = [];
    store.subscribe(({ order, previous, source }) =>
      seen.push(`${order.id}:${previous?.status ?? '-'}>${order.status}@${source}`),
    );

    store.put(makeOrder({ id: 'a', status: 'searching' }), 'api');
    store.put(makeOrder({ id: 'a', status: 'rider_assigned' }), 'webhook');
    store.put(makeOrder({ id: 'b' }), 'poll');
    store.put(makeOrder({ id: 'c' }), 'poll');

    expect(seen).toEqual([
      'a:->searching@api',
      'a:searching>rider_assigned@webhook',
      'b:->searching@poll',
      'c:->searching@poll',
    ]);
    expect(store.get('a')).toBeUndefined();
    expect(store.size).toBe(2);
  });
});
