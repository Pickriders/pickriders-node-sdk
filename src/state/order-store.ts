import { Emitter, type Unsubscribe } from './emitter';
import { isFinalStatus } from '../tracking/status';
import type { Order, OrderEvent } from '../types';

/** Where an order snapshot came from. */
export type UpdateSource = 'api' | 'webhook' | 'poll';

export interface OrderUpdate {
  order: Order;
  /** The snapshot it replaced, if the store had one. */
  previous: Order | undefined;
  source: UpdateSource;
  /** The webhook event that carried it, when `source` is `webhook`. */
  event?: OrderEvent;
}

const DEFAULT_MAX_ORDERS = 1_000;

/**
 * The SDK's memory of orders, shared by every tracker on a client. Every order the API returns
 * (create, retrieve, cancel …) and every order webhook lands here, and only a newer snapshot
 * replaces an older one: webhooks that arrive late or twice can never move an order backwards.
 *
 * It lives in this process's memory. Several servers each keep their own; trackers fall back to
 * asking the API, so each one still sees the order through.
 */
export class OrderStore {
  private readonly orders = new Map<string, Order>();
  private readonly emitter = new Emitter<{ update: [OrderUpdate]; event: [OrderEvent] }>();

  constructor(private readonly max = DEFAULT_MAX_ORDERS) {}

  /** The newest snapshot of the order, if this client has seen it. */
  get(id: string): Order | undefined {
    return this.orders.get(id);
  }

  /** Every order held, oldest first. */
  all(): Order[] {
    return [...this.orders.values()];
  }

  get size(): number {
    return this.orders.size;
  }

  /** Stores `order` if it's newer than what's held. Returns whether it was. */
  put(order: Order, source: UpdateSource, event?: OrderEvent): boolean {
    const previous = this.orders.get(order.id);
    if (!isNewer(order, previous)) return false;
    this.orders.delete(order.id);
    this.orders.set(order.id, order);
    if (this.orders.size > this.max) this.orders.delete(this.orders.keys().next().value!);
    this.emitter.emit('update', { order, previous, source, ...(event && { event }) });
    return true;
  }

  /** Stores the order an event carries and tells event listeners, even when the order itself didn't change. */
  ingest(event: OrderEvent): void {
    this.put(event.data.object, 'webhook', event);
    this.emitter.emit('event', event);
  }

  /** Every accepted change to any order. */
  subscribe(listener: (update: OrderUpdate) => void): Unsubscribe {
    return this.emitter.on('update', listener);
  }

  /** Accepted changes to one order. */
  subscribeTo(id: string, listener: (update: OrderUpdate) => void): Unsubscribe {
    return this.emitter.on('update', (update) => update.order.id === id && listener(update));
  }

  /** Every order event received by webhook, including ones that don't change the order (a new offer, say). */
  onEvent(listener: (event: OrderEvent) => void): Unsubscribe {
    return this.emitter.on('event', listener);
  }

  delete(id: string): void {
    this.orders.delete(id);
  }

  clear(): void {
    this.orders.clear();
  }
}

/** Newer by `updated`; on a tie, a different snapshot wins unless what's held has already ended. */
export function isNewer(incoming: Order, current: Order | undefined): boolean {
  if (!current) return true;
  const a = Date.parse(incoming.updated);
  const b = Date.parse(current.updated);
  if (Number.isNaN(a) || Number.isNaN(b) || a !== b) return Number.isNaN(a) || Number.isNaN(b) || a > b;
  if (isFinalStatus(current.status) && !isFinalStatus(incoming.status)) return false;
  return JSON.stringify(incoming) !== JSON.stringify(current);
}
