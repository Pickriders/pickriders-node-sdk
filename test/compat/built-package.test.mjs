/**
 * The published package, installed as a user would, on every Node version we support, Node 20
 * included. The dev tools (vitest, tsup) need Node 22, so this uses only node:test and a local fake
 * API. CI packs the build with `npm pack`, installs the tarball into an empty project, copies this
 * file there and runs `node --test`.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { after, before, describe, it } from 'node:test';

import Pickriders, { OrderEndedError, Pickriders as Named, VERSION } from 'pickriders';
import { trackDelivery } from 'pickriders/client';

const require = createRequire(import.meta.url);
const SECRET = 'whsec_compat';
let clock = Date.now();
let order;
let seq = 0;
let api;
let baseUrl;

const snapshot = (status) => (order = { ...order, status, updated: new Date((clock += 1000)).toISOString() });
const signedEvent = (type) => {
  const body = JSON.stringify({
    object: 'event',
    id: `evt_${++seq}`,
    type,
    created: order.updated,
    livemode: false,
    data: { object: order },
  });
  const t = Math.floor(Date.now() / 1000);
  return { body, header: `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}` };
};
const read = (req) =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
  });

let flaky = 0;
before(async () => {
  api = createServer(async (req, res) => {
    const body = await read(req);
    const path = req.url.replace('/developer/api/v1', '');
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && path === '/orders') {
      if (flaky++ === 0) {
        res.statusCode = 503;
        res.setHeader('retry-after', '0');
        return res.end(JSON.stringify({ error: { type: 'api_error', code: 'unavailable', message: 'busy' } }));
      }
      const params = JSON.parse(body);
      order = {
        object: 'order',
        id: 'ord_compat',
        type: params.type,
        status: 'searching',
        number: 'PR-1',
        metadata: {},
        stops: params.stops,
        rider: null,
        tracking_url: 'https://pickriders.com/track/b3JkX2NvbXBhdA.c2lnbmF0dXJl',
        livemode: false,
        created: new Date().toISOString(),
        updated: new Date(clock).toISOString(),
        idempotency_key: req.headers['idempotency-key'],
      };
      return res.end(JSON.stringify(order));
    }
    if (req.method === 'GET' && path === '/orders/ord_compat') return res.end(JSON.stringify(order));
    if (req.method === 'GET' && path.startsWith('/tracking/')) {
      return res.end(
        JSON.stringify({
          object: 'tracking',
          number: 'PR-1',
          status: order.status,
          rider: null,
          stop: null,
          eta_s: 60,
        }),
      );
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { type: 'not_found_error', code: 'route_not_found', message: path } }));
  });
  await new Promise((resolve) => api.listen(0, resolve));
  baseUrl = `http://localhost:${api.address().port}/developer/api/v1`;
});
after(() => api.close());

const stop = (address) => ({ address, lat: 6.4, lng: 3.4, contact: { name: 'A', phone: '+2348000000000' } });

describe(`pickriders on Node ${process.versions.node}`, () => {
  it('loads as ES modules and CommonJS', () => {
    assert.equal(typeof Pickriders, 'function');
    assert.equal(Named, Pickriders);
    assert.match(VERSION, /^\d+\.\d+\.\d+/);
    const cjs = require('pickriders');
    assert.equal(typeof cjs.Pickriders, 'function');
    assert.equal(typeof require('pickriders/client').trackDelivery, 'function');
  });

  it('creates an order (retrying a 503 under one Idempotency-Key) and follows it to the end by webhook', async () => {
    const pickriders = new Pickriders('sk_test_compat', { baseUrl, webhookSecret: SECRET });
    const created = await pickriders.orders.create({
      service_area: 'NG-LA',
      pickup: stop('A'),
      dropoff: [stop('B'), stop('C')],
    });
    assert.equal(created.type, 'batch');
    assert.match(created.idempotency_key, /^sdk_/);

    const tracker = pickriders.orders.track(created, { poll: false });
    const statuses = [];
    tracker.on('status', (status) => statuses.push(status));
    const handle = pickriders.webhooks.handler();

    for (const [status, type] of [
      ['rider_assigned', 'order.rider_assigned'],
      ['in_transit', 'order.picked_up'],
      ['delivered', 'order.delivered'],
    ]) {
      snapshot(status);
      const { body, header } = signedEvent(type);
      const response = await handle(
        new Request('http://shop.test/hooks', { method: 'POST', body, headers: { 'Pickriders-Signature': header } }),
      );
      assert.equal(response.status, 200);
    }

    const final = await tracker.done({ timeout: 2000 });
    assert.equal(final.status, 'delivered');
    assert.deepEqual(statuses, ['rider_assigned', 'in_transit', 'delivered']);
  });

  it('refuses a forged webhook', async () => {
    const pickriders = new Pickriders('sk_test_compat', { baseUrl, webhookSecret: SECRET });
    const { body } = signedEvent('order.delivered');
    await assert.rejects(
      pickriders.webhooks.constructEvent(body, `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`),
      {
        code: 'signature_mismatch',
      },
    );
  });

  it('follows by polling without webhooks, and until() rejects when the order ends another way', async () => {
    snapshot('searching');
    const pickriders = new Pickriders('sk_test_compat', { baseUrl });
    const tracker = pickriders.orders.track('ord_compat', { poll: 20 });
    const waiting = tracker.until('delivered');
    await tracker.until('searching', { timeout: 2000 });
    snapshot('cancelled');
    await assert.rejects(waiting, (error) => error instanceof OrderEndedError && error.order.status === 'cancelled');
  });

  it('pickriders/client follows a tracking link with no key', async () => {
    snapshot('in_transit');
    const delivery = trackDelivery(order.tracking_url, { baseUrl, poll: 20 });
    const seen = await delivery.until('in_transit', { timeout: 2000 });
    assert.equal(seen.eta_s, 60);
    delivery.stop();
  });
});
