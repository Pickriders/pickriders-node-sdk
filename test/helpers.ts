import { vi } from 'vitest';

import type { Order, OrderStatus } from '../src/types';

export interface RecordedRequest {
  method: string;
  url: URL;
  /** The path after /developer/api/v1, e.g. `/orders/ord_1`. */
  path: string;
  headers: Headers;
  body: unknown;
}

type Handler = (request: RecordedRequest, call: number) => unknown;

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export const apiError = (status: number, type: string, code: string, message = code, extra: object = {}) =>
  json(status, { error: { type, code, message, param: null, request_id: 'req_test', doc_url: null, ...extra } });

/** A fake Pickriders API: register routes, then pass `api.fetch` to the client. */
export function mockApi() {
  const routes: { method: string; path: string | RegExp; handler: Handler; calls: number }[] = [];
  const calls: RecordedRequest[] = [];

  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const request: RecordedRequest = {
      method: init.method ?? 'GET',
      url,
      path: url.pathname.replace(/^\/developer\/api\/v1/, ''),
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(request);
    const route = routes.find(
      (r) =>
        r.method === request.method &&
        (typeof r.path === 'string' ? r.path === request.path : r.path.test(request.path)),
    );
    if (!route)
      return apiError(404, 'not_found_error', 'route_not_found', `No mock for ${request.method} ${request.path}`);
    const result = await route.handler(request, route.calls++);
    return result instanceof Response ? result : json(200, result);
  });

  const api = {
    fetch: fetch as unknown as typeof globalThis.fetch,
    calls,
    on(method: string, path: string | RegExp, handler: Handler) {
      routes.unshift({ method, path, handler, calls: 0 });
      return api;
    },
  };
  return api;
}

let clock = Date.parse('2026-11-18T10:00:00.000Z');

/** A public order, with `updated` moving forward each time so newer snapshots win. */
export function makeOrder(overrides: Partial<Order> & { status?: OrderStatus } = {}): Order {
  clock += 1000;
  const stamp = new Date(clock).toISOString();
  return {
    object: 'order',
    id: 'ord_1',
    type: 'single',
    status: 'searching',
    number: 'PR-1042',
    reference: null,
    metadata: {},
    quote_id: null,
    service_area: 'NG-LA',
    pricing: {
      mode: 'fixed',
      currency: 'NGN',
      amount: 250000,
      delivery_fee: 230000,
      service_charge: 20000,
      max_amount: null,
      min_offer_percentage: null,
      auto_accept_after_s: null,
    },
    stops: [],
    rider: null,
    tracking_url: 'https://pickriders.com/track/b3JkXzE.c2lnbmF0dXJl',
    dispatch: 'auto',
    scheduled_for: null,
    cancellation: null,
    delivered_at: null,
    livemode: false,
    created: stamp,
    updated: stamp,
    ...overrides,
  } as Order;
}

export const TEST_KEY = 'sk_test_51abcdefghijklmnopqrstuvwxyz';
export const WEBHOOK_SECRET = 'whsec_test_secret_value';
