import { PickridersError } from './core/errors';
import { HttpClient, type RequestOptions } from './core/http';
import { DEFAULT_BASE_URL, VERSION, isBrowser, readEnv } from './core/runtime';
import {
  AccountResource,
  QuotesResource,
  RidersResource,
  ServiceAreasResource,
  StatusResource,
  WalletResource,
} from './resources/account';
import { Orders } from './resources/orders';
import { TestHelpers } from './resources/test-helpers';
import { EventsResource, WebhookEndpointsResource } from './resources/webhook-endpoints';
import { OrderStore } from './state/order-store';
import type { PlatformStatus } from './types';
import { Webhooks } from './webhooks/webhooks';

export interface PickridersOptions {
  /** Your secret key, `sk_test_…` or `sk_live_…`. Default: the PICKRIDERS_KEY environment variable. */
  apiKey?: string;
  /** Your webhook endpoint's signing secret, `whsec_…`. Default: PICKRIDERS_WEBHOOK_SECRET. */
  webhookSecret?: string;
  /** The service area used when an order or quote doesn't name one, e.g. `NG-LA`. Default: PICKRIDERS_SERVICE_AREA. */
  serviceArea?: string;
  /** Milliseconds before a request is abandoned. Default 30,000. */
  timeout?: number;
  /** Retries after a network error, a 429 or a 5xx, with backoff. POSTs are safe to retry (Idempotency-Key). Default 2. */
  maxRetries?: number;
  /** The API's base URL. Default: PICKRIDERS_BASE_URL, else production. */
  baseUrl?: string;
  /** A fetch to use instead of the global one. */
  fetch?: typeof fetch;
  /**
   * A secret key in a browser can be read by anyone using your site. The SDK refuses unless you set
   * this, for tools only you run. For your customers, use `trackDelivery` from `pickriders/client`.
   */
  dangerouslyAllowBrowser?: boolean;
}

/**
 * The Pickriders API, for your server.
 *
 *   import Pickriders from 'pickriders';
 *   const pickriders = new Pickriders(); // reads PICKRIDERS_KEY
 *
 *   const order = await pickriders.orders.create({ pickup, dropoff });
 *   const delivered = await pickriders.orders.track(order).done();
 */
export class Pickriders {
  static readonly VERSION = VERSION;

  /** Book, follow, change and cancel deliveries. */
  readonly orders: Orders;
  /** Prices before you book. */
  readonly quotes: QuotesResource;
  /** Your prepaid wallet: balance, transactions, top-ups. */
  readonly wallet: WalletResource;
  /** Your team's profile and live-access status. */
  readonly account: AccountResource;
  /** Riders near a point. */
  readonly riders: RidersResource;
  /** Where Pickriders delivers. */
  readonly serviceAreas: ServiceAreasResource;
  /** Where Pickriders sends your events. */
  readonly webhookEndpoints: WebhookEndpointsResource;
  /** The last 30 days of events. */
  readonly events: EventsResource;
  /** Receive, verify and react to webhooks. */
  readonly webhooks: Webhooks;
  /** Test mode helpers: advance orders, add test money. */
  readonly test: TestHelpers;

  /** True for a live key, false for a test key. */
  readonly livemode: boolean;

  private readonly http: HttpClient;
  private readonly statusResource: StatusResource;

  constructor(apiKey?: string, options?: PickridersOptions);
  constructor(options?: PickridersOptions);
  constructor(keyOrOptions?: string | PickridersOptions, maybeOptions: PickridersOptions = {}) {
    const options = typeof keyOrOptions === 'object' ? keyOrOptions : maybeOptions;
    const apiKey = (typeof keyOrOptions === 'string' ? keyOrOptions : options.apiKey) ?? readEnv('PICKRIDERS_KEY');

    if (!apiKey) {
      throw new PickridersError(
        'No API key. Pass one (`new Pickriders("sk_test_…")`) or set PICKRIDERS_KEY. Keys are in the dashboard under Developers → API keys.',
        { code: 'api_key_missing' },
      );
    }
    if (!/^sk_(test|live)_\S+$/.test(apiKey.trim())) {
      throw new PickridersError('That doesn’t look like a Pickriders secret key: they start sk_test_ or sk_live_.', {
        code: 'api_key_invalid',
      });
    }
    if (isBrowser() && !options.dangerouslyAllowBrowser) {
      throw new PickridersError(
        'A secret key in a browser can be read by anyone using your site, so the SDK won’t run with one here. ' +
          'Call Pickriders from your server, and follow deliveries in the browser with `trackDelivery` from "pickriders/client".',
        { code: 'secret_key_in_browser' },
      );
    }

    this.livemode = apiKey.startsWith('sk_live_');
    this.http = new HttpClient({
      apiKey: apiKey.trim(),
      baseUrl: options.baseUrl ?? readEnv('PICKRIDERS_BASE_URL') ?? DEFAULT_BASE_URL,
      timeout: options.timeout ?? 30_000,
      maxRetries: options.maxRetries ?? 2,
      fetch: options.fetch,
    });

    const store = new OrderStore();
    const webhookSecret = options.webhookSecret ?? readEnv('PICKRIDERS_WEBHOOK_SECRET');
    this.webhooks = new Webhooks({ secret: () => webhookSecret, store });
    this.orders = new Orders({
      http: this.http,
      store,
      defaultServiceArea: options.serviceArea ?? readEnv('PICKRIDERS_SERVICE_AREA'),
      lastWebhookAt: () => this.webhooks.lastReceivedAt,
    });
    this.quotes = new QuotesResource(this.http);
    this.wallet = new WalletResource(this.http);
    this.account = new AccountResource(this.http);
    this.riders = new RidersResource(this.http);
    this.serviceAreas = new ServiceAreasResource(this.http);
    this.webhookEndpoints = new WebhookEndpointsResource(this.http);
    this.events = new EventsResource(this.http);
    this.test = new TestHelpers(this.http, store, () => this.livemode);
    this.statusResource = new StatusResource(this.http);
  }

  /** Checks the key works. Resolves with `{ object: 'ping', livemode }`. */
  ping(options?: RequestOptions): Promise<{ object: 'ping'; livemode: boolean }> {
    return this.http.request('GET', 'ping', options);
  }

  /** The platform's status and any open incidents, as on the status page. */
  status(options?: RequestOptions): Promise<PlatformStatus> {
    return this.statusResource.retrieve(options);
  }
}
