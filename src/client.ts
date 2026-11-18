/**
 * pickriders/client: for browsers and mobile apps. Nothing here needs, or accepts, a secret key.
 *
 *   import { trackDelivery } from 'pickriders/client';
 *
 *   const delivery = trackDelivery(trackingUrl);   // from your server: order.tracking_url
 *   delivery.on('status', (status) => show(status));
 *   delivery.subscribe(({ data }) => render(data)); // or React's useSyncExternalStore
 */
import { DeliveryTracker, type TrackDeliveryOptions } from './tracking/delivery-tracker';

/**
 * Follows a delivery from its tracking link (or the token at its end) until it's delivered,
 * cancelled or failed. Polls the public tracking endpoint; refreshes when the tab comes back.
 */
export function trackDelivery(link: string, options?: TrackDeliveryOptions): DeliveryTracker {
  return new DeliveryTracker(link, options);
}

export { DeliveryTracker, trackingToken, type TrackDeliveryOptions } from './tracking/delivery-tracker';
export type { DeliveryTrackerEvents } from './tracking/delivery-tracker';
export { Tracker, type PollOption, type TrackerEvents, type TrackerState, type WaitOptions } from './tracking/tracker';
export { FINAL_STATUSES, ORDER_STATUSES, isFinalStatus, type FinalStatus } from './tracking/status';
export { createStore, type Store, type WritableStore } from './state/store';
export { Emitter, type Unsubscribe } from './state/emitter';
export {
  PickridersError,
  ConnectionError,
  TimeoutError,
  NotFoundError,
  InvalidRequestError,
  OrderEndedError,
  WaitTimeoutError,
} from './core/errors';
export { VERSION } from './core/runtime';
export type { OrderStatus, PublicTracking } from './types';
