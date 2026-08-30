/**
 * Determines whether a failed authentication response should prompt for TOTP.
 *
 * Pi-hole may return either `totp_required`, or (for a password-only request)
 * the exact 400 `bad_request` response saying no 2FA token was present.
 * A response after a submitted TOTP is always an authentication failure so an
 * invalid code is not misclassified as another challenge.
 */
export function isTotpChallenge(
  error: { key: string; message: string; status: number } | undefined,
  submittedTotp?: string,
): boolean {
  if (submittedTotp !== undefined || !error) {
    return false;
  }

  return (
    error.key === "totp_required" ||
    (error.key === "bad_request" &&
      error.status === 400 &&
      error.message === "No 2FA token found in JSON payload")
  );
}
