import type { HttpClient, Query, RequestOptions } from '../core/http';
import { ListPromise } from '../core/list';
import type {
  CreateWebhookEndpointParams,
  List,
  ListEventsParams,
  ListParams,
  PickridersEvent,
  ResendEventParams,
  ResendEventResult,
  UpdateWebhookEndpointParams,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEndpointWithSecret,
} from '../types';

type Ref = string | { id: string };
const path = (ref: Ref, rest = '') => `${encodeURIComponent(typeof ref === 'string' ? ref : ref.id)}${rest}`;

/** Where Pickriders sends events. Each endpoint has its own signing secret. */
export class WebhookEndpointsResource {
  constructor(private readonly http: HttpClient) {}

  /** The response carries the signing `secret`, this once. Store it (it's your `webhookSecret`). */
  create(params: CreateWebhookEndpointParams, options?: RequestOptions): Promise<WebhookEndpointWithSecret> {
    return this.http.request('POST', 'webhook_endpoints', { body: params, ...options });
  }

  retrieve(endpoint: Ref, options?: RequestOptions): Promise<WebhookEndpoint> {
    return this.http.request('GET', `webhook_endpoints/${path(endpoint)}`, options);
  }

  list(params: ListParams = {}, options?: RequestOptions): ListPromise<WebhookEndpoint> {
    return new ListPromise(
      (query) =>
        this.http.request<List<WebhookEndpoint>>('GET', 'webhook_endpoints', { query: query as Query, ...options }),
      params,
    );
  }

  update(endpoint: Ref, params: UpdateWebhookEndpointParams, options?: RequestOptions): Promise<WebhookEndpoint> {
    return this.http.request('PATCH', `webhook_endpoints/${path(endpoint)}`, { body: params, ...options });
  }

  del(endpoint: Ref, options?: RequestOptions): Promise<void> {
    return this.http.request('DELETE', `webhook_endpoints/${path(endpoint)}`, options);
  }

  /** A new secret. The old one keeps working for 24 hours, so you can deploy the new one first. */
  rollSecret(endpoint: Ref, options?: RequestOptions): Promise<WebhookEndpointWithSecret> {
    return this.http.request('POST', `webhook_endpoints/${path(endpoint, '/roll_secret')}`, options);
  }

  /** Sends a signed `ping` event to the endpoint now, and returns how it answered. */
  test(endpoint: Ref, options?: RequestOptions): Promise<WebhookDelivery> {
    return this.http.request('POST', `webhook_endpoints/${path(endpoint, '/test')}`, options);
  }
}

/** Everything that happened, kept for 30 days: the same events webhooks deliver. */
export class EventsResource {
  constructor(private readonly http: HttpClient) {}

  retrieve(event: Ref, options?: RequestOptions): Promise<PickridersEvent> {
    return this.http.request('GET', `events/${path(event)}`, options);
  }

  list(params: ListEventsParams = {}, options?: RequestOptions): ListPromise<PickridersEvent, ListEventsParams> {
    return new ListPromise(
      (query) => this.http.request<List<PickridersEvent>>('GET', 'events', { query: query as Query, ...options }),
      params,
    );
  }

  /** Sends the event again to your endpoints (or one of them). */
  resend(event: Ref, params: ResendEventParams = {}, options?: RequestOptions): Promise<ResendEventResult> {
    return this.http.request('POST', `events/${path(event, '/resend')}`, { body: params, ...options });
  }
}
