import type { Unsubscribe } from './emitter';

/**
 * A value you can read, replace and watch. Its `subscribe` and `getSnapshot` fit React's
 * useSyncExternalStore, Svelte stores and Vue's watch as they are: no adapter needed.
 */
export interface Store<T> {
  /** The current value. The same object until it changes, so it's safe to compare by reference. */
  getSnapshot(): T;
  /** Calls `listener` after every change, with the new and the previous value. */
  subscribe(listener: (value: T, previous: T) => void): Unsubscribe;
}

export interface WritableStore<T> extends Store<T> {
  set(next: T | ((previous: T) => T)): void;
}

export function createStore<T>(initial: T): WritableStore<T> {
  let value = initial;
  const listeners = new Set<(value: T, previous: T) => void>();
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      const previous = value;
      value = typeof next === 'function' ? (next as (p: T) => T)(previous) : next;
      if (Object.is(value, previous)) return;
      for (const listener of [...listeners]) {
        try {
          listener(value, previous);
        } catch (error) {
          console.error('[pickriders] A store listener threw:', error);
        }
      }
    },
  };
}
