import { describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  AuthenticationError,
  ConnectionError,
  IdempotencyError,
  InsufficientFundsError,
  InvalidRequestError,
  NotFoundError,
  PermissionError,
  Pickriders,
  RateLimitError,
  TimeoutError,
} from '../src';
import { buildUrl } from '../src/core/http';
import { TEST_KEY, apiError, json, mockApi } from './helpers';

const client = (api: ReturnType<typeof mockApi>, options = {}) =>
  new Pickriders(TEST_KEY, { fetch: api.fetch, baseUrl: 'https://api.test/developer/api/v1', ...options });

describe('requests', () => {
  it('sends the key, JSON and a User-Agent, and parses the answer', async () => {
    const api = mockApi().on('GET', '/ping', () => ({ object: 'ping', ok: true }));

    await expect(client(api).ping()).resolves.toEqual({ object: 'ping', ok: true });

    const [call] = api.calls;
    expect(call!.url.toString()).toBe('https://api.test/developer/api/v1/ping');
    expect(call!.headers.get('authorization')).toBe(`Bearer ${TEST_KEY}`);
    expect(call!.headers.get('user-agent')).toMatch(/^pickriders-node\/\S+ node\//);
    expect(call!.headers.get('idempotency-key')).toBeNull();
  });

  it('gives every POST an Idempotency-Key and keeps it across retries', async () => {
    const api = mockApi().on('POST', '/quotes', (_req, call) =>
      call === 0 ? apiError(503, 'api_error', 'unavailable') : { object: 'quote', id: 'quo_1' },
    );
    const pickriders = client(api);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    await pickriders.quotes.create({ type: 'single', service_area: 'NG-LA', stops: [] });

    expect(api.calls).toHaveLength(2);
    const [first, second] = api.calls.map((c) => c.headers.get('idempotency-key'));
    expect(first).toMatch(/^sdk_[0-9a-f-]{36}$/);
    expect(second).toBe(first);
    vi.restoreAllMocks();
  });

  it('uses your Idempotency-Key when you pass one', async () => {
    const api = mockApi().on('POST', '/quotes', () => ({ id: 'quo_1' }));
    await client(api).quotes.create({ type: 'single', service_area: 'NG-LA', stops: [] }, { idempotencyKey: 'mine-1' });
    expect(api.calls[0]!.headers.get('idempotency-key')).toBe('mine-1');
  });

  it('waits as long as Retry-After says on a 429, then succeeds', async () => {
    // Retry-After: 0 keeps the test fast; the delay logic is the same.
    const api = mockApi();
    api.on('GET', '/wallet', (_req, call) =>
      call === 0
        ? json(
            429,
            { error: { type: 'rate_limit_error', code: 'rate_limited', message: 'Slow down' } },
            { 'retry-after': '0' },
          )
        : { object: 'wallet', available: 1, held: 0 },
    );
    await expect(client(api).wallet.retrieve()).resolves.toMatchObject({ available: 1 });
    expect(api.calls).toHaveLength(2);
  });

  it('retries a request still in flight under the same key (409 idempotency_in_progress), not other conflicts', async () => {
    const api = mockApi().on('POST', '/quotes', (_req, call) =>
      call === 0
        ? json(
            409,
            { error: { type: 'idempotency_error', code: 'idempotency_in_progress', message: 'wait' } },
            { 'retry-after': '0' },
          )
        : { id: 'quo_1' },
    );
    await client(api).quotes.create({ type: 'single', service_area: 'NG-LA', stops: [] });
    expect(api.calls).toHaveLength(2);

    const other = mockApi().on('POST', '/orders/ord_1/cancel', () =>
      apiError(409, 'invalid_request_error', 'order_not_cancellable'),
    );
    await expect(client(other).orders.cancel('ord_1')).rejects.toBeInstanceOf(InvalidRequestError);
    expect(other.calls).toHaveLength(1);
  });

  it('never retries a 4xx it can’t fix by waiting', async () => {
    const api = mockApi().on('GET', '/orders/ord_x', () => apiError(404, 'not_found_error', 'order_not_found'));
    await expect(client(api).orders.retrieve('ord_x')).rejects.toBeInstanceOf(NotFoundError);
    expect(api.calls).toHaveLength(1);
  });

  it.each([
    [400, 'invalid_request_error', InvalidRequestError],
    [401, 'authentication_error', AuthenticationError],
    [402, 'insufficient_funds_error', InsufficientFundsError],
    [403, 'permission_error', PermissionError],
    [404, 'not_found_error', NotFoundError],
    [422, 'idempotency_error', IdempotencyError],
    [429, 'rate_limit_error', RateLimitError],
    [500, 'api_error', ApiError],
  ])('maps %i %s to %o with every detail', async (status, type, Class) => {
    const api = mockApi().on('GET', '/account', () =>
      apiError(status, type, 'some_code', 'What went wrong', {
        param: 'stops.1.lat',
        doc_url: 'https://docs/errors#some_code',
      }),
    );
    const error = await client(api, { maxRetries: 0 })
      .account.retrieve()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Class);
    expect(error).toMatchObject({
      message: 'What went wrong',
      type,
      code: 'some_code',
      param: 'stops.1.lat',
      status,
      requestId: 'req_test',
      docUrl: 'https://docs/errors#some_code',
    });
  });

  it('handles an answer that isn’t the API’s error format', async () => {
    const api = mockApi().on('GET', '/account', () => new Response('<html>Bad gateway</html>', { status: 502 }));
    const error = await client(api, { maxRetries: 0 })
      .account.retrieve()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: 'http_502', raw: '<html>Bad gateway</html>' });
  });

  it('turns network failures into ConnectionError, after retrying', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const pickriders = new Pickriders(TEST_KEY, { fetch: fetch as never, maxRetries: 1 });
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const error = await pickriders.ping().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as Error).cause).toBeInstanceOf(TypeError);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it('gives up after `timeout` with TimeoutError, without retrying', async () => {
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason)),
        ),
    );
    const pickriders = new Pickriders(TEST_KEY, { fetch: fetch as never, timeout: 20 });

    await expect(pickriders.ping()).rejects.toBeInstanceOf(TimeoutError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stops when your AbortSignal fires', async () => {
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason)),
        ),
    );
    const controller = new AbortController();
    const pending = new Pickriders(TEST_KEY, { fetch: fetch as never }).ping({ signal: controller.signal });
    controller.abort(new Error('user left'));
    await expect(pending).rejects.toThrow('user left');
  });
});

describe('buildUrl', () => {
  it('writes nested filters as key[sub]=, dates as ISO, and skips empty values', () => {
    const url = buildUrl('https://api.test/v1/', '/orders', {
      limit: 5,
      status: undefined,
      created: { gte: new Date('2026-11-01T00:00:00Z'), lte: 1767225600 },
    });
    expect(decodeURIComponent(url)).toBe(
      'https://api.test/v1/orders?limit=5&created[gte]=2026-11-01T00:00:00.000Z&created[lte]=1767225600',
    );
  });
});
