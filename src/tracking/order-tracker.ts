import { Tracker, type PollOption, type TrackerEvents } from './tracker';
import type { OrderStore, UpdateSource } from '../state/order-store';
import type { Order, OrderEvent } from '../types';

export interface TrackOrderOptions {
  /**
   * How to hear about changes when webhooks don't bring them. Default `'auto'`: every 5 seconds
   * until this client receives webhooks, then every 30 as a safety net; a scheduled order every minute.
   */
  poll?: PollOption;
}

export type OrderTrackerEvents = TrackerEvents<Order> & {
  /** A webhook event about this order, including ones that don't change it (a new offer, say). */
  event: [event: OrderEvent];
};

/** What the tracker needs from the client. */
export interface OrderTrackerContext {
  store: OrderStore;
  retrieve: (id: string) => Promise<Order>;
  /** When this client last received a verified webhook, if ever. */
  lastWebhookAt: () => number | undefined;
}

const FAST_POLL_MS = 5_000;
const SAFETY_NET_POLL_MS = 30_000;
const SCHEDULED_POLL_MS = 60_000;
/** Webhooks count as flowing if one arrived this recently. */
const WEBHOOKS_FRESH_MS = 10 * 60_000;

/**
 * Follows one order to the end. Fed by your webhooks (through `pickriders.webhooks`) and by the
 * API when webhooks are quiet, so it works with or without them, and it stops by itself once
 * the order is delivered, cancelled or failed.
 *
 *   const tracker = pickriders.orders.track(order);
 *   tracker.on('status', (status) => console.log(status));
 *   const final = await tracker.done();
 */
export class OrderTracker extends Tracker<Order, OrderTrackerEvents> {
  readonly id: string;

  constructor(
    id: string,
    private readonly context: OrderTrackerContext,
    options: TrackOrderOptions = {},
  ) {
    super(options.poll ?? 'auto');
    this.id = id;
    const known = context.store.get(id);
    if (known) this.apply(known, 'api');
    this.addCleanup(context.store.subscribeTo(id, ({ order, source }) => this.apply(order, source)));
    this.addCleanup(context.store.onEvent((event) => event.data.object.id === id && this.emit('event', event)));
    if (!this.isDone) this.start();
  }

  protected fetchLatest(): Promise<Order> {
    return this.context.retrieve(this.id);
  }

  /** Goes through the store, so a stale answer can't overwrite a newer webhook. */
  protected override receive(order: Order, source: UpdateSource): boolean {
    return this.context.store.put(order, source);
  }

  protected autoPollDelay(): number {
    if (this.status === 'scheduled') return SCHEDULED_POLL_MS;
    const last = this.context.lastWebhookAt();
    return last !== undefined && Date.now() - last < WEBHOOKS_FRESH_MS ? SAFETY_NET_POLL_MS : FAST_POLL_MS;
  }
}
