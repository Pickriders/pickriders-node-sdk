/** The `error.type` values the API sends. */
export type ApiErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'permission_error'
  | 'not_found_error'
  | 'idempotency_error'
  | 'rate_limit_error'
  | 'insufficient_funds_error'
  | 'api_error';

/** The body of every error the API returns: `{ error: ApiErrorBody }`. */
export interface ApiErrorBody {
  type: ApiErrorType;
  code: string;
  message: string;
  param: string | null;
  request_id: string | null;
  doc_url: string | null;
}

export interface PickridersErrorInit {
  type?: string;
  code?: string;
  param?: string | null;
  status?: number;
  requestId?: string | null;
  docUrl?: string | null;
  headers?: Headers;
  raw?: unknown;
  cause?: unknown;
}

/**
 * Every error the SDK throws is a PickridersError, so one `instanceof` check catches them all.
 * Subclasses say what went wrong; `code` says exactly what (it's stable: switch on it).
 */
export class PickridersError extends Error {
  /** The API's error type, e.g. `invalid_request_error`, or `sdk_error` for problems found before a request. */
  readonly type: string;
  /** A stable, machine-readable code, e.g. `quote_expired`. Linked from `docUrl`. */
  readonly code: string;
  /** The request field the error is about, e.g. `stops.1.lat`. */
  readonly param: string | null;
  /** The HTTP status, when the API answered. */
  readonly status: number | undefined;
  /** Quote this to Pickriders support: it finds the request in our logs. */
  readonly requestId: string | null;
  /** Where the code is explained. */
  readonly docUrl: string | null;
  readonly headers: Headers | undefined;
  /** The response body, as received. */
  readonly raw: unknown;

  constructor(message: string, init: PickridersErrorInit = {}) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = new.target.name;
    this.type = init.type ?? 'sdk_error';
    this.code = init.code ?? 'sdk_error';
    this.param = init.param ?? null;
    this.status = init.status;
    this.requestId = init.requestId ?? null;
    this.docUrl = init.docUrl ?? null;
    this.headers = init.headers;
    this.raw = init.raw;
  }
}

/** A field is missing or wrong (`param` names it), or the request can't be done in this state. HTTP 400, 409, 422. */
export class InvalidRequestError extends PickridersError {}
/** The API key is missing, wrong, revoked, or the team is suspended. HTTP 401. */
export class AuthenticationError extends PickridersError {}
/** The key may not do this: a restricted key, an IP allowlist, or live mode not approved yet. HTTP 403. */
export class PermissionError extends PickridersError {}
/** No such object for this team and mode. A test key never sees live objects, and the other way round. HTTP 404. */
export class NotFoundError extends PickridersError {}
/** An Idempotency-Key was reused with a different request. HTTP 422. */
export class IdempotencyError extends PickridersError {}
/** Too many requests. The SDK already retried; `retryAfter` says how long to wait. HTTP 429. */
export class RateLimitError extends PickridersError {
  /** Seconds until the limit resets, from the Retry-After header. */
  get retryAfter(): number | null {
    const value = Number(this.headers?.get('retry-after'));
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
}
/** The wallet's available balance doesn't cover the order. Top it up and try again. HTTP 402. */
export class InsufficientFundsError extends PickridersError {}
/** Something went wrong at Pickriders. The SDK already retried. HTTP 5xx. */
export class ApiError extends PickridersError {}
/** The API couldn't be reached: no network, DNS, TLS, or the connection dropped. */
export class ConnectionError extends PickridersError {}
/** The request took longer than the `timeout` option. */
export class TimeoutError extends ConnectionError {}
/** A webhook's Pickriders-Signature didn't match, was missing, or was too old. Answer 400 and drop it. */
export class SignatureVerificationError extends PickridersError {}
/** Waited for an order to reach a status, but it ended another way (cancelled or failed). `order` is how it ended. */
export class OrderEndedError<T = unknown> extends PickridersError {
  constructor(
    message: string,
    readonly order: T,
  ) {
    super(message, { code: 'order_ended' });
  }
}
/** A wait (`until`, `done`) passed its `timeout`. The tracker keeps going; only the wait gave up. */
export class WaitTimeoutError extends PickridersError {}

const BY_TYPE: Record<string, typeof PickridersError> = {
  invalid_request_error: InvalidRequestError,
  authentication_error: AuthenticationError,
  permission_error: PermissionError,
  not_found_error: NotFoundError,
  idempotency_error: IdempotencyError,
  rate_limit_error: RateLimitError,
  insufficient_funds_error: InsufficientFundsError,
  api_error: ApiError,
};

const BY_STATUS: Record<number, typeof PickridersError> = {
  400: InvalidRequestError,
  401: AuthenticationError,
  402: InsufficientFundsError,
  403: PermissionError,
  404: NotFoundError,
  409: InvalidRequestError,
  422: InvalidRequestError,
  429: RateLimitError,
};

/** Turns an API error response into the matching error class. Tolerates bodies that aren't the API's format. */
export function errorFromResponse(status: number, body: unknown, headers: Headers): PickridersError {
  const error = (body as { error?: Partial<ApiErrorBody> } | null)?.error;
  const Class =
    (error?.type && BY_TYPE[error.type]) || BY_STATUS[status] || (status >= 500 ? ApiError : PickridersError);
  const message =
    typeof error?.message === 'string' && error.message
      ? error.message
      : `The Pickriders API answered ${status} without an error message.`;
  return new Class(message, {
    type: error?.type ?? (status >= 500 ? 'api_error' : 'invalid_request_error'),
    code: error?.code ?? `http_${status}`,
    param: error?.param ?? null,
    status,
    requestId: error?.request_id ?? headers.get('request-id'),
    docUrl: error?.doc_url ?? null,
    headers,
    raw: body,
  });
}
