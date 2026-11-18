/**
 * pickriders: the Pickriders SDK for servers (Node.js 20+, Bun, Deno, edge runtimes).
 * In a browser or mobile app, import from 'pickriders/client' instead: it needs no secret key.
 */
import { Pickriders } from './pickriders';

export default Pickriders;
export { Pickriders, type PickridersOptions } from './pickriders';

export * from './core/errors';
export type { RequestOptions } from './core/http';
export { ListPromise } from './core/list';
export { VERSION } from './core/runtime';

export type { OrderRef } from './resources/orders';
export { Emitter, type Unsubscribe } from './state/emitter';
export { createStore, type Store, type WritableStore } from './state/store';
export { OrderStore, type OrderUpdate, type UpdateSource } from './state/order-store';

export { OrderTracker, type OrderTrackerEvents, type TrackOrderOptions } from './tracking/order-tracker';
export { DeliveryTracker, trackingToken, type TrackDeliveryOptions } from './tracking/delivery-tracker';
export { Tracker, type PollOption, type TrackerEvents, type TrackerState, type WaitOptions } from './tracking/tracker';
export { FINAL_STATUSES, ORDER_STATUSES, isFinalStatus, type FinalStatus } from './tracking/status';

export { Webhooks, type NodeLikeRequest, type NodeLikeResponse, type WebhookHandlerOptions } from './webhooks/webhooks';
export { EVENT_ID_HEADER, SIGNATURE_HEADER, signatureHeader, verifySignature } from './webhooks/signature';

export * from './types';
