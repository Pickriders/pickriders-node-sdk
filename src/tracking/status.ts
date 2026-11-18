import type { OrderStatus } from '../types';

/** Every public order status, in the order a delivery usually moves through them. */
export const ORDER_STATUSES = [
  'scheduled',
  'awaiting_dispatch',
  'searching',
  'rider_assigned',
  'picking_up',
  'in_transit',
  'delivered',
  'cancelled',
  'failed',
] as const satisfies readonly OrderStatus[];

/** The statuses an order never leaves. */
export const FINAL_STATUSES = ['delivered', 'cancelled', 'failed'] as const satisfies readonly OrderStatus[];
export type FinalStatus = (typeof FINAL_STATUSES)[number];

/** True once the order can't change any more: delivered, cancelled or failed. */
export const isFinalStatus = (status: string | undefined): status is FinalStatus =>
  (FINAL_STATUSES as readonly string[]).includes(status ?? '');
