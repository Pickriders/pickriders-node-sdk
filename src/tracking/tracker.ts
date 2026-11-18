import { isFinalStatus } from './status';
import {
  AuthenticationError,
  NotFoundError,
  OrderEndedError,
  PermissionError,
  PickridersError,
  WaitTimeoutError,
} from '../core/errors';
import { Emitter, type Unsubscribe } from '../state/emitter';
import { createStore, type Store, type WritableStore } from '../state/store';
import type { UpdateSource } from '../state/order-store';
import type { OrderStatus } from '../types';

/** Everything a tracker knows, as one immutable snapshot: render a UI straight from it. */
export interface TrackerState<T> {
  /** The latest snapshot, once the first one has arrived. */
  data: T | undefined;
  status: OrderStatus | undefined;
  /** True once the order is delivered, cancelled or failed. Nothing changes after that. */
  done: boolean;
  /** The last error, cleared by the next good update. */
  error: PickridersError | undefined;
  /** How the latest snapshot arrived. */
  source: UpdateSource | undefined;
  /** When the snapshot last changed. */
  updatedAt: Date | undefined;
  /** True once the tracker stopped: the order ended, `stop()` was called, or it can never succeed (a bad key, say). */
  stopped: boolean;
}

/**
 * How the tracker asks the API for news when webhooks don't bring it:
 * - `'auto'` (default): every few seconds until webhooks arrive, then only as a safety net.
 * - a number: every that many milliseconds.
 * - `false`: never; webhooks only.
 */
export type PollOption = 'auto' | number | false;

export interface WaitOptions {
  /** Milliseconds to wait before rejecting with WaitTimeoutError. The tracker itself keeps going. */
  timeout?: number;
  signal?: AbortSignal;
}

export type TrackerEvents<T> = {
  /** Any change to the snapshot. */
  update: [data: T, state: TrackerState<T>];
  /** The status changed. */
  status: [status: OrderStatus, data: T];
  /** It reached delivered, cancelled or failed. */
  done: [data: T];
  /** Fetching failed. The tracker retries by itself unless the error can't go away (a revoked key, say). */
  error: [error: PickridersError];
} & { [Status in OrderStatus]: [data: T] };

const INITIAL = {
  data: undefined,
  status: undefined,
  done: false,
  error: undefined,
  source: undefined,
  updatedAt: undefined,
  stopped: false,
} as const;

const MAX_BACKOFF_MS = 60_000;

/** The shared engine behind OrderTracker (server) and DeliveryTracker (browser). */
export abstract class Tracker<T extends { status: OrderStatus }, E extends TrackerEvents<T> = TrackerEvents<T>>
  implements Store<TrackerState<T>>, AsyncIterable<T>
{
  protected readonly state: WritableStore<TrackerState<T>> = createStore<TrackerState<T>>({ ...INITIAL });
  protected readonly emitter = new Emitter<E>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private inFlight: Promise<T> | undefined;
  private readonly cleanups: Unsubscribe[] = [];

  protected constructor(protected readonly poll: PollOption) {}

  /** Fetches the latest snapshot from the API, for polling and `refresh()`. */
  protected abstract fetchLatest(): Promise<T>;
  /** Milliseconds until the next poll in `'auto'` mode. */
  protected abstract autoPollDelay(): number;
  /** Stores a fetched snapshot. Returns false when it's not newer than what the tracker has. */
  protected receive(data: T, source: UpdateSource): boolean {
    return this.apply(data, source);
  }

  // ----- Reading ------------------------------------------------------------------------------

  /** The latest snapshot, once known. */
  get data(): T | undefined {
    return this.state.getSnapshot().data;
  }

  get status(): OrderStatus | undefined {
    return this.state.getSnapshot().status;
  }

  /** True once delivered, cancelled or failed. */
  get isDone(): boolean {
    return this.state.getSnapshot().done;
  }

  getSnapshot = (): TrackerState<T> => this.state.getSnapshot();

  /** Calls `listener` with every new state. Pairs with `getSnapshot` for React's useSyncExternalStore. */
  subscribe = (listener: (state: TrackerState<T>, previous: TrackerState<T>) => void): Unsubscribe =>
    this.state.subscribe(listener);

  // ----- Observing ----------------------------------------------------------------------------

  /**
   * Listen for `update`, `status`, `done`, `error`, or a status by name:
   *
   *   tracker.on('rider_assigned', (order) => notify(order.rider?.name));
   */
  on<K extends keyof E & string>(name: K, listener: (...args: Extract<E[K], unknown[]>) => unknown): Unsubscribe {
    return this.emitter.on(name, listener as never);
  }

  once<K extends keyof E & string>(name: K, listener: (...args: Extract<E[K], unknown[]>) => unknown): Unsubscribe {
    return this.emitter.once(name, listener as never);
  }

  // ----- Waiting ------------------------------------------------------------------------------

  /**
   * Resolves once the order reaches `target`: a status, any of several, or a test you write.
   * Rejects with OrderEndedError if it ends another way: waiting for `delivered` on an order that
   * gets cancelled rejects instead of hanging.
   */
  until(target: OrderStatus | OrderStatus[] | ((data: T) => boolean), options: WaitOptions = {}): Promise<T> {
    const statuses = typeof target === 'function' ? undefined : ([] as OrderStatus[]).concat(target);
    const matches = typeof target === 'function' ? target : (data: T) => statuses!.includes(data.status);
    const wanted = statuses ? statuses.join(' or ') : 'the state you waited for';

    return new Promise<T>((resolve, reject) => {
      let finish: () => void = () => undefined;
      const check = (): void => {
        const { data, error, stopped } = this.state.getSnapshot();
        if (data && matches(data)) {
          finish();
          resolve(data);
        } else if (data && isFinalStatus(data.status)) {
          finish();
          reject(new OrderEndedError(`The order ended ${data.status}, so it will never be ${wanted}.`, data));
        } else if (stopped) {
          finish();
          reject(error ?? new PickridersError(`The tracker stopped before ${wanted}.`, { code: 'tracker_stopped' }));
        }
      };
      const off = this.state.subscribe(check);
      const timer =
        options.timeout === undefined
          ? undefined
          : setTimeout(() => {
              finish();
              reject(
                new WaitTimeoutError(`Still not ${wanted} after ${options.timeout} ms.`, { code: 'wait_timeout' }),
              );
            }, options.timeout);
      const onAbort = () => {
        finish();
        reject(options.signal?.reason);
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      finish = () => {
        off();
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      };
      if (options.signal?.aborted) return onAbort();
      check();
    });
  }

  /** Resolves with the order once it's delivered, cancelled or failed. Check `status` to see which. */
  done(options: WaitOptions = {}): Promise<T> {
    return this.until((data) => isFinalStatus(data.status), options);
  }

  /**
   * Every snapshot as it changes, starting with the current one, ending after the final one:
   *
   *   for await (const order of tracker) console.log(order.status);
   */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    const queue: T[] = [];
    let wake: (() => void) | undefined;
    const off = this.state.subscribe((next, previous) => {
      if (next.data && next.data !== previous.data) queue.push(next.data);
      wake?.();
    });
    try {
      const current = this.data;
      if (current) {
        yield current;
        if (isFinalStatus(current.status)) return;
      }
      for (;;) {
        while (queue.length) {
          const data = queue.shift()!;
          yield data;
          if (isFinalStatus(data.status)) return;
        }
        const { stopped, error } = this.state.getSnapshot();
        if (stopped) {
          if (error) throw error;
          return;
        }
        await new Promise<void>((resolve) => (wake = resolve));
        wake = undefined;
      }
    } finally {
      off();
    }
  }

  // ----- Control ------------------------------------------------------------------------------

  /** Asks the API now instead of waiting for the next poll. Resolves with the latest snapshot. */
  refresh(): Promise<T> {
    return (this.inFlight ??= this.fetchLatest()
      .then((data) => {
        this.failures = 0;
        this.receive(data, 'poll');
        if (this.state.getSnapshot().error) this.state.set((s) => ({ ...s, error: undefined }));
        return this.data ?? data;
      })
      .catch((cause: unknown) => {
        const error =
          cause instanceof PickridersError
            ? cause
            : new PickridersError('Fetching the latest state failed.', { cause, code: 'tracker_fetch_failed' });
        this.failures++;
        this.state.set((s) => ({ ...s, error }));
        this.emit('error', error);
        // These won't fix themselves by asking again.
        if (
          error instanceof AuthenticationError ||
          error instanceof NotFoundError ||
          error instanceof PermissionError
        ) {
          this.stop();
        }
        throw error;
      })
      .finally(() => (this.inFlight = undefined)));
  }

  /** Stops polling and listening. Waits still pending reject. Safe to call more than once. */
  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    if (!this.state.getSnapshot().stopped) this.state.set((s) => ({ ...s, stopped: true }));
  }

  /** `using tracker = pickriders.orders.track(order)` stops it when the block ends. */
  [Symbol.dispose](): void {
    this.stop();
  }

  // ----- For subclasses -----------------------------------------------------------------------

  /** Begins polling (if enabled) and, in browsers, refreshing when the tab comes back into view. */
  protected start(): void {
    if (this.data) this.schedule();
    else
      void this.refresh()
        .catch(() => undefined)
        .finally(() => this.schedule());
    const doc = (globalThis as { document?: Document }).document;
    if (doc?.addEventListener) {
      const onVisible = () => {
        if (doc.visibilityState === 'visible' && !this.isDone) void this.refresh().catch(() => undefined);
      };
      doc.addEventListener('visibilitychange', onVisible);
      this.cleanups.push(() => doc.removeEventListener('visibilitychange', onVisible));
    }
  }

  /** Emits any of the tracker's events by name. */
  protected emit(name: keyof E & string, ...args: unknown[]): void {
    (this.emitter.emit as unknown as (name: string, ...args: unknown[]) => unknown)(name, ...args);
  }

  protected addCleanup(cleanup: Unsubscribe): void {
    this.cleanups.push(cleanup);
  }

  /** Puts a snapshot into the state and tells listeners. Returns false when nothing changed. */
  protected apply(data: T, source: UpdateSource): boolean {
    const current = this.state.getSnapshot();
    if (current.stopped || current.done) return false;
    if (current.data && JSON.stringify(current.data) === JSON.stringify(data)) return false;
    const done = isFinalStatus(data.status);
    const next: TrackerState<T> = {
      ...current,
      data,
      status: data.status,
      done,
      error: undefined,
      source,
      updatedAt: new Date(),
    };
    this.state.set(next);
    this.emit('update', data, next);
    if (data.status !== current.status) {
      this.emit('status', data.status, data);
      this.emit(data.status, data);
    }
    if (done) {
      this.emit('done', data);
      this.stop();
    }
    return true;
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (this.poll === false || this.state.getSnapshot().stopped) return;
    const base = this.poll === 'auto' ? this.autoPollDelay() : this.poll;
    const backedOff = this.failures ? Math.max(base, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.failures)) : base;
    const hidden = (globalThis as { document?: Document }).document?.visibilityState === 'hidden';
    this.timer = setTimeout(
      () => {
        this.refresh()
          .catch(() => undefined)
          .finally(() => this.schedule());
      },
      hidden ? Math.min(MAX_BACKOFF_MS, backedOff * 6) : backedOff,
    );
  }
}
