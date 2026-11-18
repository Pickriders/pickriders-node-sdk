import { afterEach, describe, expect, it, vi } from 'vitest';

import { trackDelivery, trackingToken, InvalidRequestError, type PublicTracking } from '../src/client';
import { Pickriders, PermissionError } from '../src';
import { TEST_KEY, mockApi } from './helpers';

const TOKEN = 'NjU2MGYwYzJhMWIyYzNkNGU1ZjYwNzE4.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
const tracking = (status: PublicTracking['status']): PublicTracking =>
  ({ object: 'tracking', number: 'PR-1042', status, rider: null, stop: null, eta_s: 300 }) as PublicTracking;

describe('pickriders/client: trackDelivery', () => {
  afterEach(() => vi.useRealTimers());

  it('reads the token from a tracking link or takes it as is, and refuses anything else', () => {
    expect(trackingToken(`https://pickriders.com/track/${TOKEN}`)).toBe(TOKEN);
    expect(trackingToken(`https://pickriders.com/track/${TOKEN}/?utm=x`)).toBe(TOKEN);
    expect(trackingToken(TOKEN)).toBe(TOKEN);
    expect(() => trackingToken('https://pickriders.com/')).toThrow(InvalidRequestError);
  });

  it('polls the public tracking endpoint with no key until delivered', async () => {
    vi.useFakeTimers();
    let status: PublicTracking['status'] = 'rider_assigned';
    const api = mockApi().on('GET', `/tracking/${TOKEN}`, () => tracking(status));

    const delivery = trackDelivery(`https://pickriders.com/track/${TOKEN}`, { fetch: api.fetch });
    const statuses: string[] = [];
    delivery.on('status', (s) => statuses.push(s));
    const done = delivery.done();

    await vi.advanceTimersByTimeAsync(0);
    status = 'delivered';
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(done).resolves.toMatchObject({ status: 'delivered' });
    expect(statuses).toEqual(['rider_assigned', 'delivered']);
    expect(api.calls[0]!.headers.get('authorization')).toBeNull();
    expect(api.calls[0]!.url.origin).toBe('https://api.pickriders.com');
  });
});

describe('new Pickriders()', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reads PICKRIDERS_KEY when no key is passed, and knows test from live', () => {
    vi.stubEnv('PICKRIDERS_KEY', 'sk_live_abc123');
    expect(new Pickriders().livemode).toBe(true);
    expect(new Pickriders(TEST_KEY).livemode).toBe(false);
    expect(new Pickriders({ apiKey: TEST_KEY }).livemode).toBe(false);
  });

  it('says what to do when the key is missing or isn’t a secret key', () => {
    vi.stubEnv('PICKRIDERS_KEY', '');
    expect(() => new Pickriders()).toThrow(/PICKRIDERS_KEY/);
    expect(() => new Pickriders('pk_test_123')).toThrow(/sk_test_ or sk_live_/);
  });

  it('refuses a secret key in a browser unless told otherwise', () => {
    vi.stubGlobal('window', {});
    expect(() => new Pickriders(TEST_KEY)).toThrow(/pickriders\/client/);
    expect(() => new Pickriders(TEST_KEY, { dangerouslyAllowBrowser: true })).not.toThrow();
  });

  it('keeps test helpers to test keys, before sending anything', async () => {
    const api = mockApi();
    const live = new Pickriders('sk_live_abc123', { fetch: api.fetch });
    await expect(live.test.wallet.fund({ amount: 100 })).rejects.toBeInstanceOf(PermissionError);
    expect(api.calls).toHaveLength(0);
  });

  it('uses PICKRIDERS_BASE_URL, for staging', async () => {
    vi.stubEnv('PICKRIDERS_BASE_URL', 'https://staging.test/developer/api/v1');
    const api = mockApi().on('GET', '/ping', () => ({ object: 'ping', livemode: false }));
    await new Pickriders(TEST_KEY, { fetch: api.fetch }).ping();
    expect(api.calls[0]!.url.origin).toBe('https://staging.test');
  });
});
