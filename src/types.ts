/**
 * The objects the API sends and accepts, with friendly names. Field names match the API and the
 * docs exactly (snake_case), so what you read in a webhook, a log or the docs is what you type.
 *
 * Generated shapes live in ./generated/openapi.ts (`yarn generate`); only what the OpenAPI document
 * can't say precisely is written by hand here.
 */
import type { components } from './generated/openapi';

type Schemas = components['schemas'];
type Override<T, U> = Omit<T, keyof U> & U;

/** Your own key–value pairs (up to 20 string values), returned on the order and in every event. */
export type Metadata = Record<string, string>;

export type OrderStatus = Schemas['PublicOrderDto']['status'];
export type OrderType = Schemas['PublicOrderDto']['type'];
export type StopStatus = Schemas['OrderStopDto']['status'];

export type Order = Override<Schemas['PublicOrderDto'], { object: 'order'; metadata: Metadata }>;
export type OrderStop = Schemas['OrderStopDto'];
export type OrderRider = Schemas['OrderRiderDto'];
export type OrderPricing = Schemas['OrderPricingDto'];
export type OrderCancellation = Schemas['OrderCancellationDto'];
export type OrderTracking = Schemas['OrderTrackingDto'];
/** What a tracking link shows: no phones and no other recipient's address. Safe in a browser. */
export type PublicTracking = Override<Schemas['PublicTrackingDto'], { object: 'tracking' }>;
export type Offer = Schemas['PublicOfferDto'];
export type Quote = Schemas['PublicQuoteDto'];
export type Wallet = Schemas['PublicWalletDto'];
export type WalletTransaction = Schemas['PublicWalletTransactionDto'];
export type FundingSession = Schemas['FundingSessionDto'];
export type FundingAccount = Schemas['PublicFundingAccountDto'];
export type Account = Schemas['PublicAccountDto'];
export type ServiceArea = Schemas['PublicServiceAreaDto'];
export type RiderAvailability = Schemas['RiderAvailabilityDto'];
export type WebhookEndpoint = Schemas['PublicWebhookEndpointDto'];
/** Returned once, when the endpoint is created or its secret rolled: store `secret` safely. */
export type WebhookEndpointWithSecret = Schemas['PublicWebhookEndpointWithSecretDto'];
export type WebhookDelivery = Schemas['WebhookDeliveryDto'];
export type PlatformStatus = Schemas['StatusDto'];
export type ResendEventParams = Schemas['ResendEventRequestDto'];
export type ResendEventResult = Schemas['ResendEventResponseDto'];

/** A pickup or drop-off: the coordinates are what the rider navigates to; the address is their label. */
export type StopInput = Schemas['StopInputDto'];
export type CreateQuoteParams = Schemas['CreateQuoteRequestDto'];
export type OrderPricingParams = Schemas['OrderPricingRequestDto'];
export type TestOptions = Schemas['TestOptionsDto'];
export type RawCreateOrderParams = Override<Schemas['CreateOrderRequestDto'], { metadata?: Metadata }>;

/**
 * Create an order the short way: name the `pickup` and the `dropoff`, and the SDK works out the
 * order type. Several drop-offs make a batch (one pickup, many drop-offs); several pickups make a
 * bulk order (many pickups, one drop-off). Or pass `stops` and `type` as the API takes them.
 */
export type CreateOrderParams =
  | (Omit<RawCreateOrderParams, 'stops' | 'type'> & {
      pickup: StopInput | StopInput[];
      dropoff: StopInput | StopInput[];
      stops?: never;
      type?: OrderType;
    })
  | (RawCreateOrderParams & { pickup?: never; dropoff?: never });

export type CancelOrderParams = Schemas['DeveloperCancelOrderRequestDto'];
export type RescheduleOrderParams = Schemas['DeveloperRescheduleOrderRequestDto'];
export type UpdateStopParams = Schemas['UpdateStopRequestDto'];
export type AdvanceTestOrderParams = Schemas['AdvanceOrderRequestDto'];
export type FundTestWalletParams = Schemas['FundTestWalletRequestDto'];
export type CreateFundingSessionParams = Schemas['CreateFundingSessionRequestDto'];
export type CreateWebhookEndpointParams = Override<
  Schemas['CreateWebhookEndpointRequestDto'],
  { enabled_events: Array<EventType | '*'> }
>;
export type UpdateWebhookEndpointParams = Override<
  Schemas['UpdateWebhookEndpointRequestDto'],
  { enabled_events?: Array<EventType | '*'> }
>;

/** A page of results. Iterate the list call itself (`for await`) to walk every page. */
export interface List<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  url: string;
}

export interface ListParams {
  /** 1–100. Default 20. */
  limit?: number;
  /** An object id: the page after it. */
  starting_after?: string;
  /** An object id: the page before it. */
  ending_before?: string;
}

/** `{ gte, lte }`, each a Date, an ISO 8601 string or Unix seconds. */
export interface DateRange {
  gte?: Date | string | number;
  lte?: Date | string | number;
}

export interface ListOrdersParams extends ListParams {
  status?: OrderStatus;
  type?: OrderType;
  reference?: string;
  created?: DateRange;
}

export interface ListEventsParams extends ListParams {
  /** An event type, or a group such as `order.*`. */
  type?: EventType | `${string}.*`;
  created?: DateRange;
}

export interface ListWalletTransactionsParams extends ListParams {
  type?: string;
  created?: DateRange;
}

export interface RiderAvailabilityParams {
  lat: number;
  lng: number;
  service_area: string;
}

// ----- Events --------------------------------------------------------------------------------

export const ORDER_EVENT_TYPES = [
  'order.created',
  'order.searching',
  'order.offer.created',
  'order.offer.expired',
  'order.rider_assigned',
  'order.rider_changed',
  'order.picked_up',
  'order.stop.arrived',
  'order.stop.completed',
  'order.delivered',
  'order.cancelled',
  'order.failed',
] as const;

export const EVENT_TYPES = [...ORDER_EVENT_TYPES, 'wallet.funded', 'wallet.balance_low', 'account.updated'] as const;

export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];
export type EventType = (typeof EVENT_TYPES)[number];

interface EventBase<Type extends string, Data> {
  object: 'event';
  id: string;
  type: Type;
  /** When it happened, ISO 8601. */
  created: string;
  livemode: boolean;
  data: Data;
}

/** `data.object` is the whole order as it was when the event happened. */
export type OrderEvent<Type extends OrderEventType = OrderEventType> = EventBase<
  Type,
  { object: Order; stop_id?: string; offer?: Offer }
>;
export type WalletFundedEvent = EventBase<'wallet.funded', { object: Wallet; transaction: WalletTransaction }>;
export type WalletBalanceLowEvent = EventBase<'wallet.balance_low', { object: Wallet; threshold: number }>;
export type AccountUpdatedEvent = EventBase<'account.updated', { object: Account }>;
/** Sent by "Send test event" in the dashboard, or `webhookEndpoints.test()`, whatever the endpoint subscribes to. */
export type PingEvent = EventBase<'ping', { object: { object: 'ping'; [key: string]: unknown } }>;

/** Any event Pickriders sends. Narrow it with `event.type`. */
export type PickridersEvent =
  | { [Type in OrderEventType]: OrderEvent<Type> }[OrderEventType]
  | WalletFundedEvent
  | WalletBalanceLowEvent
  | AccountUpdatedEvent
  | PingEvent;

/** What `webhooks.on()` accepts: one type, a group like `order.*`, or `*` for everything. */
export type EventPattern = PickridersEvent['type'] | 'order.*' | 'wallet.*' | '*';

/** The event a pattern matches, so listeners are typed exactly. */
export type EventFor<P extends EventPattern> = P extends '*'
  ? PickridersEvent
  : P extends `${infer Group}.*`
    ? Extract<PickridersEvent, { type: `${Group}.${string}` }>
    : Extract<PickridersEvent, { type: P }>;
