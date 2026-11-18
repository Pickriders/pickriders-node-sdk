import { DEFAULT_TOLERANCE_SECONDS, SIGNATURE_HEADER, signatureHeader, verifySignature } from './signature';
import { PickridersError, SignatureVerificationError } from '../core/errors';
import type { Unsubscribe } from '../state/emitter';
import type { OrderStore } from '../state/order-store';
import { ORDER_EVENT_TYPES, type EventFor, type EventPattern, type OrderEvent, type PickridersEvent } from '../types';

export interface WebhookHandlerOptions {
  /** This endpoint's signing secret (`whsec_…`). Default: the client's `webhookSecret`. */
  secret?: string;
  /** Seconds a signature stays valid. Default 300. */
  tolerance?: number;
  /** Called for each new verified event, after the `on()` listeners. Throw to make Pickriders retry. */
  onEvent?: (event: PickridersEvent) => unknown;
}

/** The least of Node's IncomingMessage the handler needs; Express, Connect and plain node:http all fit. */
export interface NodeLikeRequest {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  [Symbol.asyncIterator]?(): AsyncIterator<unknown>;
}

/** The least of Node's ServerResponse the handler needs. */
export interface NodeLikeResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

export interface WebhooksContext {
  secret: () => string | undefined;
  store: OrderStore;
}

type AnyListener = (event: PickridersEvent) => unknown;

const SEEN_LIMIT = 2_000;
const ORDER_TYPES = new Set<string>(ORDER_EVENT_TYPES);
const decoder = new TextDecoder();

/**
 * Receives Pickriders webhooks: checks each signature, ignores repeats, keeps order trackers up to
 * date, and calls your listeners.
 *
 *   pickriders.webhooks.on('order.delivered', async (event) => markDelivered(event.data.object));
 *   export const POST = pickriders.webhooks.handler();        // Next.js, Hono, Workers, Bun, Deno
 *   app.post('/webhooks', pickriders.webhooks.nodeHandler()); // Express, node:http
 */
export class Webhooks {
  private readonly listeners = new Map<string, Set<AnyListener>>();
  private readonly seen = new Set<string>();
  private lastReceived: number | undefined;

  constructor(private readonly context: WebhooksContext) {}

  /** When this client last received a verified event (ms since epoch), if ever. */
  get lastReceivedAt(): number | undefined {
    return this.lastReceived;
  }

  /**
   * Checks the signature and returns the event. Pass the body exactly as received: a string or
   * bytes, never parsed JSON. Throws SignatureVerificationError when it doesn't check out.
   */
  async constructEvent(
    payload: string | Uint8Array | ArrayBuffer,
    signature: string | null | undefined,
    secret: string | undefined = this.context.secret(),
    { tolerance = DEFAULT_TOLERANCE_SECONDS }: { tolerance?: number } = {},
  ): Promise<PickridersEvent> {
    const body = typeof payload === 'string' ? payload : decoder.decode(payload);
    await verifySignature(body, signature, secret ?? '', { tolerance });
    try {
      return JSON.parse(body) as PickridersEvent;
    } catch (cause) {
      throw new SignatureVerificationError('The body is signed but isn’t JSON.', { code: 'payload_invalid', cause });
    }
  }

  /**
   * Calls `listener` for each new event matching `pattern`: a type (`order.delivered`), a group
   * (`order.*`), or `*`. Listeners can be async; if one throws, the handler answers 500 and
   * Pickriders sends the event again later.
   */
  on<P extends EventPattern>(pattern: P, listener: (event: EventFor<P>) => unknown): Unsubscribe {
    let set = this.listeners.get(pattern);
    if (!set) this.listeners.set(pattern, (set = new Set()));
    set.add(listener as AnyListener);
    return () => void set.delete(listener as AnyListener);
  }

  once<P extends EventPattern>(pattern: P, listener: (event: EventFor<P>) => unknown): Unsubscribe {
    const off = this.on(pattern, (event) => {
      off();
      return listener(event);
    });
    return off;
  }

  /**
   * Hands a verified event to trackers and listeners. The handlers call it for you; call it yourself
   * when events reach you another way (a queue, say). An event already handled is skipped.
   */
  async dispatch(event: PickridersEvent): Promise<{ duplicate: boolean }> {
    if (this.seen.has(event.id)) return { duplicate: true };
    this.lastReceived = Date.now();
    if (ORDER_TYPES.has(event.type)) this.context.store.ingest(event as OrderEvent);

    const group = `${event.type.split('.')[0]}.*`;
    const matching = [event.type, group, '*'].flatMap((pattern) => [...(this.listeners.get(pattern) ?? [])]);
    await Promise.all(matching.map(async (listener) => listener(event)));

    // Only once every listener succeeded: a failed event comes again and runs again.
    this.seen.add(event.id);
    if (this.seen.size > SEEN_LIMIT) this.seen.delete(this.seen.values().next().value!);
    return { duplicate: false };
  }

  /**
   * A route handler for runtimes with web Requests: Next.js route handlers, Hono, Remix, SvelteKit,
   * Cloudflare Workers, Bun and Deno.
   *
   *   // app/api/pickriders/route.ts
   *   export const POST = pickriders.webhooks.handler();
   */
  handler(options: WebhookHandlerOptions = {}): (request: Request) => Promise<Response> {
    return async (request) => {
      const { status, body } = await this.receive(await request.text(), request.headers.get(SIGNATURE_HEADER), options);
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    };
  }

  /**
   * A handler for Express, Connect and node:http. With Express, give this route the raw body:
   *
   *   app.post('/webhooks/pickriders', express.raw({ type: 'application/json' }), pickriders.webhooks.nodeHandler());
   */
  nodeHandler(options: WebhookHandlerOptions = {}): (req: NodeLikeRequest, res: NodeLikeResponse) => Promise<void> {
    return async (req, res) => {
      let result: { status: number; body: object };
      try {
        const header = req.headers[SIGNATURE_HEADER.toLowerCase()];
        result = await this.receive(await rawBody(req), Array.isArray(header) ? header[0] : header, options);
      } catch (error) {
        console.error('[pickriders]', error instanceof Error ? error.message : error);
        result = { status: 500, body: { error: error instanceof Error ? error.message : 'Webhook handling failed.' } };
      }
      res.statusCode = result.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result.body));
    };
  }

  /** A signed header for `body`, for posting your own test events to your route. */
  generateTestHeader(body: string, secret: string | undefined = this.context.secret()): Promise<string> {
    if (!secret) throw new PickridersError('No webhook secret to sign with.', { code: 'webhook_secret_missing' });
    return signatureHeader(body, secret);
  }

  private async receive(
    body: string,
    header: string | null | undefined,
    options: WebhookHandlerOptions,
  ): Promise<{ status: number; body: object }> {
    let event: PickridersEvent;
    try {
      event = await this.constructEvent(body, header, options.secret ?? this.context.secret(), options);
    } catch (error) {
      if (!(error instanceof SignatureVerificationError)) throw error;
      // A missing secret is our setup, not a bad request: let Pickriders retry once it's fixed.
      if (error.code === 'webhook_secret_missing') console.error(`[pickriders] ${error.message}`);
      return { status: error.code === 'webhook_secret_missing' ? 500 : 400, body: { error: error.message } };
    }
    try {
      const { duplicate } = await this.dispatch(event);
      if (!duplicate) await options.onEvent?.(event);
      return { status: 200, body: { received: true, ...(duplicate && { duplicate: true }) } };
    } catch (error) {
      console.error(`[pickriders] Handling ${event.type} (${event.id}) failed. Pickriders will retry it.`, error);
      return { status: 500, body: { error: 'The event handler failed. It will be retried.' } };
    }
  }
}

async function rawBody(req: NodeLikeRequest): Promise<string> {
  const { body } = req;
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return decoder.decode(body);
  if (body !== undefined && body !== null && typeof body === 'object' && Object.keys(body).length > 0) {
    throw new PickridersError(
      'The body was already parsed as JSON, so its signature can’t be checked. Give this route the raw body: ' +
        "app.post(path, express.raw({ type: 'application/json' }), pickriders.webhooks.nodeHandler()).",
      { code: 'webhook_body_parsed' },
    );
  }
  if (!req[Symbol.asyncIterator]) return '';
  const chunks: Uint8Array[] = [];
  for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
    chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return decoder.decode(all);
}
