import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { Pickriders, SignatureVerificationError, verifySignature, type PickridersEvent } from '../src';
import { TEST_KEY, WEBHOOK_SECRET, makeOrder } from './helpers';

/** Exactly how the backend signs (src/developer/webhooks/webhook-signature.ts). */
const backendSign = (secret: string, timestamp: number, body: string) =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
const now = () => Math.floor(Date.now() / 1000);

let n = 0;
const orderEvent = (type: string, status: string): PickridersEvent =>
  ({
    object: 'event',
    id: `evt_${++n}`,
    type,
    created: new Date().toISOString(),
    livemode: false,
    data: { object: makeOrder({ status: status as never }) },
  }) as PickridersEvent;

function signed(event: object, secret = WEBHOOK_SECRET, timestamp = now()) {
  const body = JSON.stringify(event);
  return { body, header: `t=${timestamp},v1=${backendSign(secret, timestamp, body)}` };
}

const client = () => new Pickriders(TEST_KEY, { webhookSecret: WEBHOOK_SECRET, fetch: vi.fn() as never });

describe('signatures', () => {
  it('accepts what the backend signs, and either signature while a secret is rolled', async () => {
    const body = '{"id":"evt_1"}';
    const t = now();
    await expect(
      verifySignature(body, `t=${t},v1=${backendSign(WEBHOOK_SECRET, t, body)}`, WEBHOOK_SECRET),
    ).resolves.toBeUndefined();
    const rolled = `t=${t},v1=${backendSign('whsec_new', t, body)},v1=${backendSign(WEBHOOK_SECRET, t, body)}`;
    await expect(verifySignature(body, rolled, WEBHOOK_SECRET)).resolves.toBeUndefined();
  });

  it.each([
    ['a changed body', (h: string) => ({ body: '{"id":"evt_2"}', header: h }), 'signature_mismatch'],
    ['another secret', () => signed({ id: 'evt_1' }, 'whsec_other'), 'signature_mismatch'],
    ['an old timestamp', () => signed({ id: 'evt_1' }, WEBHOOK_SECRET, now() - 301), 'signature_expired'],
    ['no header', () => ({ body: '{}', header: '' }), 'signature_missing'],
    ['a malformed header', () => ({ body: '{}', header: 'v1=zz' }), 'signature_malformed'],
  ])('refuses %s, saying why', async (_name, make, code) => {
    const { header } = signed({ id: 'evt_1' });
    const { body, header: h } = make(header);
    const error = await verifySignature(body, h, WEBHOOK_SECRET).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SignatureVerificationError);
    expect(error).toMatchObject({ code });
  });

  it('constructEvent returns the parsed event, from a string or bytes', async () => {
    const event = orderEvent('order.delivered', 'delivered');
    const { body, header } = signed(event);
    const pickriders = client();
    await expect(pickriders.webhooks.constructEvent(body, header)).resolves.toEqual(event);
    await expect(pickriders.webhooks.constructEvent(new TextEncoder().encode(body), header)).resolves.toEqual(event);
  });

  it('generateTestHeader signs your own test events', async () => {
    const pickriders = client();
    const body = JSON.stringify(orderEvent('order.created', 'searching'));
    const header = await pickriders.webhooks.generateTestHeader(body);
    await expect(pickriders.webhooks.constructEvent(body, header)).resolves.toBeTruthy();
  });
});

describe('handler() for web Requests (Next.js, Hono, Workers, Bun, Deno)', () => {
  const post = (body: string, header: string) =>
    new Request('https://shop.test/webhooks', { method: 'POST', body, headers: { 'Pickriders-Signature': header } });

  it('verifies, calls matching listeners by type, group and *, and answers 200', async () => {
    const pickriders = client();
    const calls: string[] = [];
    pickriders.webhooks.on('order.delivered', (e) => void calls.push(`exact:${e.data.object.status}`));
    pickriders.webhooks.on('order.*', (e) => void calls.push(`group:${e.type}`));
    pickriders.webhooks.on('*', (e) => void calls.push(`all:${e.type}`));
    pickriders.webhooks.on('wallet.*', () => void calls.push('wallet'));
    const handle = pickriders.webhooks.handler();

    const { body, header } = signed(orderEvent('order.delivered', 'delivered'));
    const response = await handle(post(body, header));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(calls).toEqual(['exact:delivered', 'group:order.delivered', 'all:order.delivered']);
    expect(pickriders.webhooks.lastReceivedAt).toBeTypeOf('number');
  });

  it('answers 400 to a bad signature, and calls nothing', async () => {
    const pickriders = client();
    const listener = vi.fn();
    pickriders.webhooks.on('*', listener);
    const { body } = signed(orderEvent('order.delivered', 'delivered'));

    const response = await pickriders.webhooks.handler()(post(body, `t=${now()},v1=${'0'.repeat(64)}`));

    expect(response.status).toBe(400);
    expect(listener).not.toHaveBeenCalled();
  });

  it('handles a repeated event once', async () => {
    const pickriders = client();
    const listener = vi.fn();
    pickriders.webhooks.on('order.created', listener);
    const { body, header } = signed(orderEvent('order.created', 'searching'));
    const handle = pickriders.webhooks.handler();

    await handle(post(body, header));
    const again = await handle(post(body, header));

    expect(again.status).toBe(200);
    await expect(again.json()).resolves.toEqual({ received: true, duplicate: true });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('answers 500 when a listener throws, so Pickriders retries, and runs it again on the retry', async () => {
    const pickriders = client();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let attempts = 0;
    pickriders.webhooks.on('order.delivered', async () => {
      if (++attempts === 1) throw new Error('database down');
    });
    const { body, header } = signed(orderEvent('order.delivered', 'delivered'));
    const handle = pickriders.webhooks.handler();

    expect((await handle(post(body, header))).status).toBe(500);
    expect((await handle(post(body, header))).status).toBe(200);
    expect(attempts).toBe(2);
    errors.mockRestore();
  });

  it('answers 500 (retry later) when no secret is set, and says how to fix it', async () => {
    const pickriders = new Pickriders(TEST_KEY, { fetch: vi.fn() as never });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { body, header } = signed(orderEvent('order.created', 'searching'));

    const response = await pickriders.webhooks.handler()(post(body, header));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('PICKRIDERS_WEBHOOK_SECRET'),
    });
    errors.mockRestore();
  });

  it('takes a per-endpoint secret and an onEvent callback', async () => {
    const pickriders = new Pickriders(TEST_KEY, { fetch: vi.fn() as never });
    const onEvent = vi.fn();
    const { body, header } = signed(orderEvent('order.created', 'searching'), 'whsec_endpoint_2');

    const response = await pickriders.webhooks.handler({ secret: 'whsec_endpoint_2', onEvent })(post(body, header));

    expect(response.status).toBe(200);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'order.created' }));
  });
});

describe('nodeHandler() for Express and node:http', () => {
  const response = () => {
    const res = { statusCode: 0, headers: {} as Record<string, string>, body: '' };
    return Object.assign(res, {
      setHeader: (name: string, value: string) => void (res.headers[name] = value),
      end: (body?: string) => void (res.body = body ?? ''),
    });
  };

  it('reads a raw Buffer body (express.raw) and a plain request stream', async () => {
    const pickriders = client();
    const listener = vi.fn();
    pickriders.webhooks.on('order.picked_up', listener);
    const handle = pickriders.webhooks.nodeHandler();

    const first = signed(orderEvent('order.picked_up', 'in_transit'));
    const res1 = response();
    await handle({ headers: { 'pickriders-signature': first.header }, body: Buffer.from(first.body) }, res1);

    const second = signed(orderEvent('order.picked_up', 'in_transit'));
    const stream = Object.assign(Readable.from([Buffer.from(second.body)]), {
      headers: { 'pickriders-signature': second.header },
    });
    const res2 = response();
    await handle(stream, res2);

    expect([res1.statusCode, res2.statusCode]).toEqual([200, 200]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('explains how to fix a body that express.json() already parsed', async () => {
    const pickriders = client();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { header } = signed({ id: 'evt_x' });
    const res = response();

    await pickriders.webhooks.nodeHandler()(
      { headers: { 'pickriders-signature': header }, body: { id: 'evt_x' } },
      res,
    );

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain("express.raw({ type: 'application/json' })");
    errors.mockRestore();
  });
});
