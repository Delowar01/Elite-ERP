import "server-only";

/**
 * The single time source for platform security decisions (session expiry, idle timeout,
 * throttling windows, TOTP steps, token iat/exp). Timestamps are computed here and written
 * explicitly, so database CHECKs compare values from one clock. Verification suites substitute
 * `now` to exercise expiry deterministically; production code never reassigns it.
 */
export const platformClock = {
  now: (): Date => new Date(),
};
