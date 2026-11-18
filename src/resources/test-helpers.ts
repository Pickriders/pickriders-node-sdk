import { idOf, type OrderRef } from './orders';
import { PermissionError } from '../core/errors';
import type { HttpClient, RequestOptions } from '../core/http';
import type { OrderStore } from '../state/order-store';
import type { AdvanceTestOrderParams, FundTestWalletParams, Order, Wallet } from '../types';

/**
 * Test mode only (a `sk_test_` key): move orders along without a real rider, and add play money.
 * Nothing here touches real riders or real money.
 */
export class TestHelpers {
  constructor(
    private readonly http: HttpClient,
    private readonly store: OrderStore,
    private readonly livemode: () => boolean | undefined,
  ) {}

  readonly orders = {
    /**
     * Moves a test order to its next state, or straight `to` one (`delivered` runs every step in
     * between, sending each event), as the test rider would.
     *
     *   await pickriders.test.orders.advance(order, { to: 'delivered' });
     */
    advance: async (order: OrderRef, params: AdvanceTestOrderParams = {}, options?: RequestOptions): Promise<Order> => {
      this.assertTestMode('test.orders.advance');
      const advanced = await this.http.request<Order>(
        'POST',
        `test/orders/${encodeURIComponent(idOf(order))}/advance`,
        {
          body: params,
          ...options,
        },
      );
      this.store.put(advanced, 'api');
      return advanced;
    },
  };

  readonly wallet = {
    /** Adds test money (in kobo) to the test wallet. */
    fund: async (params: FundTestWalletParams, options?: RequestOptions): Promise<Wallet> => {
      this.assertTestMode('test.wallet.fund');
      return this.http.request('POST', 'test/wallet/fund', { body: params, ...options });
    },
  };

  private assertTestMode(method: string): void {
    if (this.livemode() === true) {
      throw new PermissionError(`${method} works only with a test key (sk_test_…). This client uses a live key.`, {
        type: 'permission_error',
        code: 'test_mode_only',
      });
    }
  }
}
