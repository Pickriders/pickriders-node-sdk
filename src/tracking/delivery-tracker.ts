import { Tracker, type PollOption, type TrackerEvents } from './tracker';
import { InvalidRequestError } from '../core/errors';
import { HttpClient } from '../core/http';
import { DEFAULT_BASE_URL } from '../core/runtime';
import type { PublicTracking } from '../types';

export interface TrackDeliveryOptions {
  /** How often to ask, in milliseconds. Default `'auto'`: every 5 seconds, every minute while scheduled. */
  poll?: PollOption;
  /** The API's base URL. Default: production. */
  baseUrl?: string;
  /** A fetch to use instead of the global one. */
  fetch?: typeof fetch;
}

export type DeliveryTrackerEvents = TrackerEvents<PublicTracking>;

const POLL_MS = 5_000;
const SCHEDULED_POLL_MS = 60_000;

/**
 * Follows a delivery from its tracking link, with no API key: safe in a browser or a mobile app.
 * It sees what the link shows (status, rider name and position, ETA), never phones or addresses
 * of other recipients.
 *
 *   import { trackDelivery } from 'pickriders/client';
 *   const delivery = trackDelivery(order.tracking_url);
 *   delivery.subscribe(({ data }) => render(data));
 */
export class DeliveryTracker extends Tracker<PublicTracking, DeliveryTrackerEvents> {
  /** The token from the tracking link. */
  readonly token: string;
  private readonly http: HttpClient;

  constructor(link: string, options: TrackDeliveryOptions = {}) {
    super(options.poll ?? 'auto');
    this.token = trackingToken(link);
    this.http = new HttpClient({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      timeout: 15_000,
      maxRetries: 1,
      fetch: options.fetch,
    });
    this.start();
  }

  protected fetchLatest(): Promise<PublicTracking> {
    return this.http.request<PublicTracking>('GET', `tracking/${encodeURIComponent(this.token)}`);
  }

  protected autoPollDelay(): number {
    return this.status === 'scheduled' ? SCHEDULED_POLL_MS : POLL_MS;
  }
}

/** The token from a tracking link (`https://pickriders.com/track/<token>`), or the token itself. */
export function trackingToken(link: string): string {
  const value = String(link ?? '').trim();
  let token = value;
  if (/^https?:\/\//i.test(value)) {
    const segments = new URL(value).pathname.split('/').filter(Boolean);
    token = segments[segments.length - 1] ?? '';
  }
  if (!/^[\w.~-]{8,}$/.test(token)) {
    throw new InvalidRequestError('Pass an order’s tracking_url, or the token at the end of it.', {
      code: 'tracking_link_invalid',
      param: 'link',
    });
  }
  return token;
}
