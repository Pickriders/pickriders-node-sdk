import type { HttpClient, Query, RequestOptions } from '../core/http';
import { ListPromise } from '../core/list';
import type {
  Account,
  CreateFundingSessionParams,
  CreateQuoteParams,
  FundingAccount,
  FundingSession,
  List,
  ListWalletTransactionsParams,
  PlatformStatus,
  Quote,
  RiderAvailability,
  RiderAvailabilityParams,
  ServiceArea,
  Wallet,
  WalletTransaction,
} from '../types';

const enc = encodeURIComponent;

/** Your team's profile and live-access status. */
export class AccountResource {
  constructor(private readonly http: HttpClient) {}

  retrieve(options?: RequestOptions): Promise<Account> {
    return this.http.request('GET', 'account', options);
  }
}

/** The prepaid wallet orders are paid from. Amounts are in kobo (minor units). */
export class WalletResource {
  constructor(private readonly http: HttpClient) {}

  /** The balance: `available` to spend, and `held` for orders in progress. */
  retrieve(options?: RequestOptions): Promise<Wallet> {
    return this.http.request('GET', 'wallet', options);
  }

  /** Top-ups, holds, charges and refunds, newest first. */
  transactions(
    params: ListWalletTransactionsParams = {},
    options?: RequestOptions,
  ): ListPromise<WalletTransaction, ListWalletTransactionsParams> {
    return new ListPromise(
      (query) =>
        this.http.request<List<WalletTransaction>>('GET', 'wallet/transactions', { query: query as Query, ...options }),
      params,
    );
  }

  /** A hosted payment page to top up the live wallet by card or bank transfer. Send the payer to its `url`. */
  createFundingSession(params: CreateFundingSessionParams, options?: RequestOptions): Promise<FundingSession> {
    return this.http.request('POST', 'wallet/funding-sessions', { body: params, ...options });
  }

  /** Your team's own bank account number for transfers, once it's set up in the dashboard. */
  fundingAccount(options?: RequestOptions): Promise<FundingAccount> {
    return this.http.request('GET', 'wallet/funding-account', options);
  }
}

/** Prices before you book. A quote holds its price for 15 minutes: pass its id as `quote_id` to `orders.create`. */
export class QuotesResource {
  constructor(private readonly http: HttpClient) {}

  create(params: CreateQuoteParams, options?: RequestOptions): Promise<Quote> {
    return this.http.request('POST', 'quotes', { body: params, ...options });
  }

  retrieve(quote: string | { id: string }, options?: RequestOptions): Promise<Quote> {
    return this.http.request('GET', `quotes/${enc(typeof quote === 'string' ? quote : quote.id)}`, options);
  }
}

/** How many riders are near a point, and how soon one could reach it. Never who or exactly where. */
export class RidersResource {
  constructor(private readonly http: HttpClient) {}

  availability(params: RiderAvailabilityParams, options?: RequestOptions): Promise<RiderAvailability> {
    return this.http.request('GET', 'riders/availability', { query: { ...params }, ...options });
  }
}

/** Where Pickriders delivers, with each area's currency and limits. Use an area's `id` as `service_area`. */
export class ServiceAreasResource {
  constructor(private readonly http: HttpClient) {}

  async list(options?: RequestOptions): Promise<ServiceArea[]> {
    const list = await this.http.request<{ data: ServiceArea[] }>('GET', 'service-areas', options);
    return list.data;
  }
}

/** Whether the platform is up, and any incidents. Needs no key. */
export class StatusResource {
  constructor(private readonly http: HttpClient) {}

  retrieve(options?: RequestOptions): Promise<PlatformStatus> {
    return this.http.request('GET', 'status', options);
  }
}
