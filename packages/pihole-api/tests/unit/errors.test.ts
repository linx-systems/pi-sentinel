import { describe, expect, test } from "bun:test";
import {
  PiholeErrorCode,
  apiKeyToErrorCode,
  createError,
  isAuthError,
  isRetryable,
  statusToErrorCode,
} from "../../src/errors";

describe("Errors", () => {
  describe("createError", () => {
    test("creates error with required fields", () => {
      const error = createError(
        PiholeErrorCode.Unauthorized,
        "Not authorized",
        401,
      );
      expect(error.code).toBe(PiholeErrorCode.Unauthorized);
      expect(error.message).toBe("Not authorized");
      expect(error.status).toBe(401);
      expect(error.hint).toBeUndefined();
      expect(error.apiKey).toBeUndefined();
    });

    test("creates error with optional fields", () => {
      const error = createError(
        PiholeErrorCode.BadRequest,
        "Invalid request",
        400,
        { hint: "Check your input", apiKey: "bad_request" },
      );
      expect(error.hint).toBe("Check your input");
      expect(error.apiKey).toBe("bad_request");
    });
  });

  describe("statusToErrorCode", () => {
    test("maps 400 to BadRequest", () => {
      expect(statusToErrorCode(400)).toBe(PiholeErrorCode.BadRequest);
    });

    test("maps 401 to Unauthorized", () => {
      expect(statusToErrorCode(401)).toBe(PiholeErrorCode.Unauthorized);
    });

    test("maps 403 to Unauthorized", () => {
      expect(statusToErrorCode(403)).toBe(PiholeErrorCode.Unauthorized);
    });

    test("maps 404 to NotFound", () => {
      expect(statusToErrorCode(404)).toBe(PiholeErrorCode.NotFound);
    });

    test("maps 409 to Conflict", () => {
      expect(statusToErrorCode(409)).toBe(PiholeErrorCode.Conflict);
    });

    test("maps 422 to ValidationError", () => {
      expect(statusToErrorCode(422)).toBe(PiholeErrorCode.ValidationError);
    });

    test("maps 500 to ServerError", () => {
      expect(statusToErrorCode(500)).toBe(PiholeErrorCode.ServerError);
    });

    test("maps 502, 503, 504 to ServiceUnavailable", () => {
      expect(statusToErrorCode(502)).toBe(PiholeErrorCode.ServiceUnavailable);
      expect(statusToErrorCode(503)).toBe(PiholeErrorCode.ServiceUnavailable);
      expect(statusToErrorCode(504)).toBe(PiholeErrorCode.ServiceUnavailable);
    });

    test("maps unknown 4xx to BadRequest", () => {
      expect(statusToErrorCode(418)).toBe(PiholeErrorCode.BadRequest);
    });

    test("maps unknown 5xx to ServerError", () => {
      expect(statusToErrorCode(501)).toBe(PiholeErrorCode.ServerError);
    });
  });

  describe("apiKeyToErrorCode", () => {
    test("maps unauthorized to Unauthorized", () => {
      expect(apiKeyToErrorCode("unauthorized")).toBe(
        PiholeErrorCode.Unauthorized,
      );
    });

    test("maps auth_failed to Unauthorized", () => {
      expect(apiKeyToErrorCode("auth_failed")).toBe(
        PiholeErrorCode.Unauthorized,
      );
    });

    test("maps totp_required to TotpRequired", () => {
      expect(apiKeyToErrorCode("totp_required")).toBe(
        PiholeErrorCode.TotpRequired,
      );
    });

    test("maps bad_totp to InvalidTotp", () => {
      expect(apiKeyToErrorCode("bad_totp")).toBe(PiholeErrorCode.InvalidTotp);
    });

    test("maps unknown to Unknown", () => {
      expect(apiKeyToErrorCode("some_unknown_key")).toBe(
        PiholeErrorCode.Unknown,
      );
    });
  });

  describe("isRetryable", () => {
    test("returns true for NetworkError", () => {
      expect(isRetryable(PiholeErrorCode.NetworkError)).toBe(true);
    });

    test("returns true for Timeout", () => {
      expect(isRetryable(PiholeErrorCode.Timeout)).toBe(true);
    });

    test("returns true for ServiceUnavailable", () => {
      expect(isRetryable(PiholeErrorCode.ServiceUnavailable)).toBe(true);
    });

    test("returns true for ServerError", () => {
      expect(isRetryable(PiholeErrorCode.ServerError)).toBe(true);
    });

    test("returns false for Unauthorized", () => {
      expect(isRetryable(PiholeErrorCode.Unauthorized)).toBe(false);
    });

    test("returns false for BadRequest", () => {
      expect(isRetryable(PiholeErrorCode.BadRequest)).toBe(false);
    });
  });

  describe("isAuthError", () => {
    test("returns true for Unauthorized", () => {
      expect(isAuthError(PiholeErrorCode.Unauthorized)).toBe(true);
    });

    test("returns true for SessionExpired", () => {
      expect(isAuthError(PiholeErrorCode.SessionExpired)).toBe(true);
    });

    test("returns true for TotpRequired", () => {
      expect(isAuthError(PiholeErrorCode.TotpRequired)).toBe(true);
    });

    test("returns false for NetworkError", () => {
      expect(isAuthError(PiholeErrorCode.NetworkError)).toBe(false);
    });
  });
});
