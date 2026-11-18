import { SignatureVerificationError } from '../core/errors';

export const SIGNATURE_HEADER = 'Pickriders-Signature';
export const EVENT_ID_HEADER = 'Pickriders-Event-Id';
/** How old a signature may be, in seconds, before it's refused (replay protection). */
export const DEFAULT_TOLERANCE_SECONDS = 300;

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new SignatureVerificationError('Web Crypto is not available here. Use Node.js 20 or later.');
    key = subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keys.set(secret, key);
  }
  return key;
}

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** Hex HMAC-SHA256 of `<timestamp>.<body>`: what Pickriders signs. */
export async function computeSignature(secret: string, timestamp: number, body: string): Promise<string> {
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(`${timestamp}.${body}`),
  );
  return toHex(signature);
}

/** Compares in constant time, so the time taken says nothing about how much matched. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface VerifyOptions {
  /** Seconds a signature stays valid. Default 300. */
  tolerance?: number;
  /** Now, in milliseconds. For tests. */
  now?: number;
}

/**
 * Checks a Pickriders-Signature header (`t=<unix seconds>,v1=<hex>[,v1=<hex>]`) against the raw
 * body. While a secret is being rolled there are two v1 values; one matching is enough. Throws
 * SignatureVerificationError saying what was wrong.
 */
export async function verifySignature(
  body: string,
  header: string | null | undefined,
  secret: string,
  { tolerance = DEFAULT_TOLERANCE_SECONDS, now = Date.now() }: VerifyOptions = {},
): Promise<void> {
  if (!secret) {
    throw new SignatureVerificationError(
      'No webhook signing secret. Pass `webhookSecret` to the client or set PICKRIDERS_WEBHOOK_SECRET (it starts whsec_).',
      { code: 'webhook_secret_missing' },
    );
  }
  if (!header) {
    throw new SignatureVerificationError(`The request has no ${SIGNATURE_HEADER} header. Was it sent by Pickriders?`, {
      code: 'signature_missing',
    });
  }
  const parts = header.split(',').map((part) => {
    const at = part.indexOf('=');
    return [part.slice(0, at).trim(), part.slice(at + 1).trim()] as const;
  });
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  const signatures = parts.filter(([key, value]) => key === 'v1' && /^[0-9a-f]{64}$/.test(value)).map(([, v]) => v);
  if (!Number.isInteger(timestamp) || signatures.length === 0) {
    throw new SignatureVerificationError(`The ${SIGNATURE_HEADER} header is malformed.`, {
      code: 'signature_malformed',
    });
  }
  if (Math.abs(now / 1000 - timestamp) > tolerance) {
    throw new SignatureVerificationError(
      `The signature is ${Math.round(Math.abs(now / 1000 - timestamp))} s old, more than the ${tolerance} s allowed. ` +
        'Check the server clock, or it may be a replay.',
      { code: 'signature_expired' },
    );
  }
  const expected = await computeSignature(secret, timestamp, body);
  if (!signatures.some((signature) => safeEqual(signature, expected))) {
    throw new SignatureVerificationError(
      'The signature doesn’t match. Check the signing secret is this endpoint’s, and that the body is passed exactly as received (not parsed and re-serialised).',
      { code: 'signature_mismatch' },
    );
  }
}

/**
 * A valid header for `body`, as Pickriders would send it. For your tests: post your own events
 * to your webhook route.
 */
export async function signatureHeader(body: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${await computeSignature(secret, timestamp, body)}`;
}
