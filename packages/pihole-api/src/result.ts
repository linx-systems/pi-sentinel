/**
 * Result type for explicit error handling.
 * Inspired by Rust's Result type.
 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

export interface Ok<T> {
  ok: true;
  data: T;
}

export interface Err<E> {
  ok: false;
  error: E;
}

/**
 * Create a successful result.
 */
export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

/**
 * Create an error result.
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/**
 * Type guard for successful results.
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/**
 * Type guard for error results.
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/**
 * Unwrap a result, throwing if it's an error.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.data;
  }
  throw result.error;
}

/**
 * Unwrap a result with a default value.
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (result.ok) {
    return result.data;
  }
  return defaultValue;
}

/**
 * Map the success value of a result.
 */
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  if (result.ok) {
    return ok(fn(result.data));
  }
  return result;
}

/**
 * Map the error value of a result.
 */
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> {
  if (!result.ok) {
    return err(fn(result.error));
  }
  return result;
}

/**
 * Chain results together.
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  if (result.ok) {
    return fn(result.data);
  }
  return result;
}
