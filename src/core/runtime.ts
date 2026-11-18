declare const __SDK_VERSION__: string;

/** This SDK's version, from package.json at build time. */
export const VERSION: string = typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : '0.0.0-dev';

export const DEFAULT_BASE_URL = 'https://api.pickriders.com/developer/api/v1';

/** True in a browser (or a web worker): somewhere a secret key must never be. */
export const isBrowser = (): boolean =>
  typeof window !== 'undefined' ||
  (typeof self !== 'undefined' && typeof (self as { importScripts?: unknown }).importScripts === 'function');

/** Reads an environment variable where there is one (Node, Bun, Deno with --allow-env), and nothing elsewhere. */
export function readEnv(name: string): string | undefined {
  try {
    const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
    return value?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** A short description of where the SDK runs, sent with each server request to help support. */
export function platform(): string {
  const g = globalThis as {
    process?: { versions?: { node?: string; bun?: string } };
    Deno?: { version?: { deno?: string } };
    navigator?: { userAgent?: string };
  };
  if (g.process?.versions?.bun) return `bun/${g.process.versions.bun}`;
  if (g.Deno?.version?.deno) return `deno/${g.Deno.version.deno}`;
  if (g.process?.versions?.node) return `node/${g.process.versions.node}`;
  return 'unknown';
}

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** A random v4 UUID, from Web Crypto (Node 20+, browsers, edge runtimes). */
export function uuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = c.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
