/** Removes the listener it came from. Safe to call more than once. */
export type Unsubscribe = () => void;

type Listener<Args> = (...args: Extract<Args, unknown[]>) => unknown;

/**
 * A small typed event emitter that works everywhere (no node:events). A listener that throws
 * never breaks the others or the SDK: the error goes to the `error` listeners, or console.error.
 */
export class Emitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<Listener<unknown[]>>>();

  on<K extends keyof Events>(name: K, listener: Listener<Events[K]>): Unsubscribe {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    set.add(listener as Listener<unknown[]>);
    return () => this.off(name, listener);
  }

  once<K extends keyof Events>(name: K, listener: Listener<Events[K]>): Unsubscribe {
    const off = this.on(name, ((...args: Extract<Events[K], unknown[]>) => {
      off();
      return listener(...args);
    }) as Listener<Events[K]>);
    return off;
  }

  off<K extends keyof Events>(name: K, listener: Listener<Events[K]>): void {
    this.listeners.get(name)?.delete(listener as Listener<unknown[]>);
  }

  listenerCount(name: keyof Events): number {
    return this.listeners.get(name)?.size ?? 0;
  }

  /** Calls every listener, in the order added. Returns their results, for callers that await them. */
  emit<K extends keyof Events>(name: K, ...args: Extract<Events[K], unknown[]>): unknown[] {
    const results: unknown[] = [];
    for (const listener of [...(this.listeners.get(name) ?? [])]) {
      try {
        const result = (listener as Listener<Events[K]>)(...args);
        if (result instanceof Promise) result.catch((error: unknown) => this.fail(name, error));
        results.push(result);
      } catch (error) {
        this.fail(name, error);
      }
    }
    return results;
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  private fail(name: keyof Events, error: unknown): void {
    if (name !== 'error' && this.listenerCount('error' as keyof Events) > 0) {
      (this.emit as unknown as (name: string, error: unknown) => void)('error', error);
    } else {
      console.error(`[pickriders] A "${String(name)}" listener threw:`, error);
    }
  }
}
