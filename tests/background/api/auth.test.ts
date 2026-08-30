import { describe, expect, it } from "vitest";
import { isTotpChallenge } from "~/background/api/auth";

describe("isTotpChallenge", () => {
  it("recognizes Pi-hole's two password-only TOTP challenges", () => {
    expect(
      isTotpChallenge({
        key: "totp_required",
        message: "A 2FA token is required",
        status: 400,
      }),
    ).toBe(true);
    expect(
      isTotpChallenge({
        key: "bad_request",
        message: "No 2FA token found in JSON payload",
        status: 400,
      }),
    ).toBe(true);
  });

  it("does not re-classify a rejected submitted token as another challenge", () => {
    expect(
      isTotpChallenge(
        {
          key: "bad_request",
          message: "No 2FA token found in JSON payload",
          status: 400,
        },
        "123456",
      ),
    ).toBe(false);
  });
});
