import { ConnectionError, PickridersError, TimeoutError, errorFromResponse } from './errors';
import { VERSION, isBrowser, platform, sleep, uuid } from './runtime';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export type QueryValue = string | number | boolean | Date | null | undefined | { [key: string]: QueryValue };
export type Query = Record<string, QueryValue>;

/** Per-call options, the last argument of every method. */
export interface RequestOptions {
  /**
   * Makes a POST safe to retry: the same key never does the work twice. The SDK sends a fresh one
   * with every POST and reuses it across its own retries; pass yours to retry across restarts too.
   */
  idempotencyKey?: string;
  /** Milliseconds before the request is abandoned. Default: the client's `timeout`. */
  timeout?: number;
  /** Retries after a network error, a 409 for a request still in flight, a 429 or a 5xx. Default: the client's. */
  maxRetries?: number;
  /** Cancels the request. */
  signal?: AbortSignal;
  /** Extra headers for this call. */
  headers?: Record<string, string>;
}

export interface HttpClientOptions {
  apiKey?: string | undefined;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  fetch?: typeof fetch | undefined;
}

interface Call extends RequestOptions {
  query?: Query | undefined;
  body?: unknown;
}

const MAX_RETRY_DELAY_MS = 8_000;
const MAX_RETRY_AFTER_MS = 60_000;

/** One HTTP call to the API: auth, JSON, timeouts, retries with backoff, Idempotency-Key and typed errors. */
export class HttpClient {
  constructor(private readonly options: HttpClientOptions) {}

  get baseUrl(): string {
    return this.options.baseUrl;
  }

  async request<T>(method: HttpMethod, path: string, call: Call = {}): Promise<T> {
    const url = buildUrl(this.options.baseUrl, path, call.query);
    const maxRetries = call.maxRetries ?? this.options.maxRetries;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.options.apiKey) headers.Authorization = `Bearer ${this.options.apiKey}`;
    if (call.body !== undefined) headers['Content-Type'] = 'application/json';
    if (method === 'POST') headers['Idempotency-Key'] = call.idempotencyKey ?? `sdk_${uuid()}`;
    // Browsers refuse a custom User-Agent, and custom headers would need a CORS preflight on public routes.
    if (!isBrowser()) headers['User-Agent'] = `pickriders-node/${VERSION} ${platform()}`;
    Object.assign(headers, call.headers);

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.send(url, method, headers, call);
      } catch (error) {
        if (error instanceof TimeoutError || call.signal?.aborted || attempt >= maxRetries) throw error;
        await sleep(backoff(attempt), call.signal);
        continue;
      }

      const body = await readBody(response);
      if (response.ok) return body as T;

      const error = errorFromResponse(response.status, body, response.headers);
      if (attempt >= maxRetries || !shouldRetry(response, error)) throw error;
      await sleep(retryDelay(response, attempt), call.signal);
    }
  }

  private async send(url: string, method: HttpMethod, headers: Record<string, string>, call: Call): Promise<Response> {
    const fetchImpl = this.options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new PickridersError('No fetch available. Use Node.js 20 or later, or pass `fetch` in the options.');
    }
    const timeout = call.timeout ?? this.options.timeout;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new TimeoutError(`The request took longer than ${timeout} ms.`)),
      timeout,
    );
    const onAbort = () => controller.abort(call.signal?.reason);
    call.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await fetchImpl(url, {
        method,
        headers,
        body: call.body === undefined ? null : JSON.stringify(call.body),
        signal: controller.signal,
      });
    } catch (cause) {
      if (controller.signal.reason instanceof TimeoutError) throw controller.signal.reason;
      if (call.signal?.aborted) throw call.signal.reason;
      throw new ConnectionError(`Couldn't reach the Pickriders API at ${new URL(url).origin}.`, { cause });
    } finally {
      clearTimeout(timer);
      call.signal?.removeEventListener('abort', onAbort);
    }
  }
}

function shouldRetry(response: Response, error: PickridersError): boolean {
  if (response.headers.get('pickriders-should-retry') === 'false') return false;
  // 409 with these codes means the same Idempotency-Key is still being worked on: wait and ask again.
  if (response.status === 409) return error.code === 'idempotency_in_progress';
  return response.status === 408 || response.status === 429 || response.status >= 500;
}

/** Exponential backoff with full jitter: about 0.5 s, 1 s, 2 s … capped at 8 s. */
const backoff = (attempt: number): number =>
  Math.min(MAX_RETRY_DELAY_MS, 500 * 2 ** attempt) * (0.5 + Math.random() / 2);

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS);
  return backoff(attempt);
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** `created: { gte: date }` becomes `created[gte]=…`; dates become ISO strings; empty values are left out. */
export function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`);
  const add = (key: string, value: QueryValue) => {
    if (value === undefined || value === null) return;
    if (value instanceof Date) url.searchParams.append(key, value.toISOString());
    else if (typeof value === 'object') for (const [k, v] of Object.entries(value)) add(`${key}[${k}]`, v);
    else url.searchParams.append(key, String(value));
  };
  for (const [key, value] of Object.entries(query ?? {})) add(key, value);
  return url.toString();
}
