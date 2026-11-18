import { InvalidRequestError } from '../core/errors';
import type { HttpClient, Query, RequestOptions } from '../core/http';
import { ListPromise } from '../core/list';
import type { OrderStore } from '../state/order-store';
import { OrderTracker, type TrackOrderOptions } from '../tracking/order-tracker';
import type {
  CancelOrderParams,
  CreateOrderParams,
  List,
  ListOrdersParams,
  Offer,
  Order,
  OrderEvent,
  OrderTracking,
  ListParams,
  RawCreateOrderParams,
  RescheduleOrderParams,
  StopInput,
  UpdateStopParams,
} from '../types';

/** An order, or its id. Every method that takes one takes either. */
export type OrderRef = string | { id: string };
export const idOf = (ref: string | { id: string }): string => (typeof ref === 'string' ? ref : ref.id);

export interface OrdersContext {
  http: HttpClient;
  store: OrderStore;
  defaultServiceArea: string | undefined;
  lastWebhookAt: () => number | undefined;
}

/** Book, follow, change and cancel deliveries. */
export class Orders {
  /** Every order this client has seen, kept newest-first-wins. Subscribe to it to watch them all. */
  readonly store: OrderStore;

  constructor(private readonly context: OrdersContext) {
    this.store = context.store;
  }

  /**
   * Books a delivery. Pass `pickup` and `dropoff` (an array of either makes a batch or bulk order),
   * or a `quote_id` to pay the price you were quoted.
   *
   *   const order = await pickriders.orders.create({
   *     service_area: 'NG-LA',
   *     pickup: { address: '1 Admiralty Way, Lekki', lat: 6.4281, lng: 3.4216, contact: { name: 'Shop', phone: '+2348012345678' } },
   *     dropoff: { address: '12 Awolowo Rd, Ikoyi', lat: 6.4474, lng: 3.4248, contact: { name: 'Ada', phone: '+2348098765432' } },
   *   });
   */
  async create(params: CreateOrderParams, options?: RequestOptions): Promise<Order> {
    return this.saved(
      this.context.http.request<Order>('POST', 'orders', {
        body: normalizeCreate(params, this.context.defaultServiceArea),
        ...options,
      }),
    );
  }

  /** The order as it is now. */
  async retrieve(order: OrderRef, options?: RequestOptions): Promise<Order> {
    return this.saved(this.context.http.request<Order>('GET', `orders/${enc(idOf(order))}`, options));
  }

  /** Your orders, newest first. Await for a page, or `for await` to walk them all. */
  list(params: ListOrdersParams = {}, options?: RequestOptions): ListPromise<Order, ListOrdersParams> {
    return new ListPromise(async (query) => {
      const page = await this.context.http.request<List<Order>>('GET', 'orders', { query: query as Query, ...options });
      for (const order of page.data) this.store.put(order, 'api');
      return page;
    }, params);
  }

  /** Cancels the order. What you're charged depends on how far it got; see `cancellation` on the result. */
  async cancel(order: OrderRef, params: CancelOrderParams = {}, options?: RequestOptions): Promise<Order> {
    return this.saved(
      this.context.http.request<Order>('POST', `orders/${enc(idOf(order))}/cancel`, { body: params, ...options }),
    );
  }

  /** Moves a scheduled order to another time, at the same price. */
  async reschedule(order: OrderRef, params: RescheduleOrderParams, options?: RequestOptions): Promise<Order> {
    return this.saved(
      this.context.http.request<Order>('POST', `orders/${enc(idOf(order))}/reschedule`, { body: params, ...options }),
    );
  }

  /** Starts the rider search for an order created with `dispatch: 'manual'`. */
  async dispatch(order: OrderRef, options?: RequestOptions): Promise<Order> {
    return this.saved(this.context.http.request<Order>('POST', `orders/${enc(idOf(order))}/dispatch`, options));
  }

  /** Changes a stop's contact, instructions or package before the rider gets there. */
  async updateStop(
    order: OrderRef,
    stopId: string,
    params: UpdateStopParams,
    options?: RequestOptions,
  ): Promise<Order> {
    return this.saved(
      this.context.http.request<Order>('PATCH', `orders/${enc(idOf(order))}/stops/${enc(stopId)}`, {
        body: params,
        ...options,
      }),
    );
  }

  /** Where the rider is and when they'll arrive. */
  tracking(order: OrderRef, options?: RequestOptions): Promise<OrderTracking> {
    return this.context.http.request<OrderTracking>('GET', `orders/${enc(idOf(order))}/tracking`, options);
  }

  /** Every event about this order, newest first. */
  events(order: OrderRef, params: ListParams = {}, options?: RequestOptions): ListPromise<OrderEvent> {
    return new ListPromise(
      (query) =>
        this.context.http.request<List<OrderEvent>>('GET', `orders/${enc(idOf(order))}/events`, {
          query: query as Query,
          ...options,
        }),
      params,
    );
  }

  /** Rider offers on a bidding order. */
  readonly offers = {
    /** Every offer riders made on the order, oldest first. */
    list: (order: OrderRef, options?: RequestOptions): Promise<List<Offer>> =>
      this.context.http.request<List<Offer>>('GET', `orders/${enc(idOf(order))}/offers`, options),
    /** Takes the offer: that rider is assigned and the order's price becomes the offer's amount. */
    accept: (order: OrderRef, offer: string | { id: string }, options?: RequestOptions): Promise<Offer> =>
      this.context.http.request<Offer>('POST', `orders/${enc(idOf(order))}/offers/${enc(idOf(offer))}/accept`, options),
    decline: (order: OrderRef, offer: string | { id: string }, options?: RequestOptions): Promise<Offer> =>
      this.context.http.request<Offer>(
        'POST',
        `orders/${enc(idOf(order))}/offers/${enc(idOf(offer))}/decline`,
        options,
      ),
  };

  /**
   * Follows the order until it's delivered, cancelled or failed. Works with webhooks, without
   * them, or both (see TrackOrderOptions.poll).
   *
   *   const final = await pickriders.orders.track(order).done();
   */
  track(order: OrderRef, options?: TrackOrderOptions): OrderTracker {
    return new OrderTracker(
      idOf(order),
      {
        store: this.store,
        retrieve: (id) => this.context.http.request<Order>('GET', `orders/${enc(id)}`),
        lastWebhookAt: this.context.lastWebhookAt,
      },
      options,
    );
  }

  private async saved(request: Promise<Order>): Promise<Order> {
    const order = await request;
    this.store.put(order, 'api');
    return order;
  }
}

const enc = encodeURIComponent;

/** `pickup`/`dropoff` become `stops` and a `type`; everything else passes through untouched. */
export function normalizeCreate(params: CreateOrderParams, defaultServiceArea?: string): RawCreateOrderParams {
  const { pickup, dropoff, ...rest } = params as RawCreateOrderParams & {
    pickup?: StopInput | StopInput[];
    dropoff?: StopInput | StopInput[];
  };
  const body: RawCreateOrderParams = { ...rest };
  if (!body.quote_id && !body.service_area && defaultServiceArea) body.service_area = defaultServiceArea;
  if (pickup === undefined && dropoff === undefined) return body;

  if (pickup === undefined || dropoff === undefined) {
    throw new InvalidRequestError('Give both `pickup` and `dropoff`.', {
      code: 'parameter_missing',
      param: pickup === undefined ? 'pickup' : 'dropoff',
    });
  }
  const pickups = ([] as StopInput[]).concat(pickup);
  const dropoffs = ([] as StopInput[]).concat(dropoff);
  if (pickups.length > 1 && dropoffs.length > 1) {
    throw new InvalidRequestError(
      'An order has one pickup and several drop-offs (batch), or several pickups and one drop-off (bulk), not both.',
      { code: 'parameter_invalid', param: 'dropoff' },
    );
  }
  const inferred = pickups.length > 1 ? 'bulk' : dropoffs.length > 1 ? 'batch' : 'single';
  return { ...body, type: body.type ?? inferred, stops: [...pickups, ...dropoffs] };
}
