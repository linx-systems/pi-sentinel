import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import browser from "webextension-polyfill";
import { AuthManager } from "~/background/api/auth";
import { apiClient } from "~/background/api/client";
import { STORAGE_KEYS } from "~/utils/constants";

const PIHOLE_URL = "https://pi-hole.test";
const APP_PASSWORD = "synthetic-app-password";
const TOTP_CODE = "123456";

function jsonResponse(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successfulSession(totp: boolean): Response {
  return jsonResponse(
    {
      session: {
        valid: true,
        sid: "synthetic-session-id",
        csrf: "synthetic-csrf-token",
        validity: 300,
        totp,
      },
    },
    200,
  );
}

describe("AuthManager.authenticate TOTP classification", () => {
  let manager: AuthManager;
  let fetchMock: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    apiClient.clearSession();
    apiClient.setBaseUrl(PIHOLE_URL);
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      [STORAGE_KEYS.CONFIG]: { piholeUrl: PIHOLE_URL },
    });

    manager = new AuthManager();
  });

  afterEach(() => {
    apiClient.clearSession();
    apiClient.setBaseUrl("");
  });

  function expectPasswordOnlyRequest(): void {
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${PIHOLE_URL}/api/auth`);
    expect(JSON.parse(options.body as string)).toEqual({
      password: APP_PASSWORD,
    });
  }

  it("accepts a successful app-password session even when 2FA is enabled", async () => {
    fetchMock.mockResolvedValueOnce(successfulSession(true));

    await expect(manager.authenticate(APP_PASSWORD)).resolves.toEqual({
      success: true,
    });

    expectPasswordOnlyRequest();
  });

  it("requests TOTP only when Pi-hole reports a missing 2FA token", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            key: "bad_request",
            message: "No 2FA token found in JSON payload",
          },
        },
        400,
      ),
    );

    await expect(manager.authenticate(APP_PASSWORD)).resolves.toEqual({
      success: false,
      totpRequired: true,
    });

    expectPasswordOnlyRequest();
  });

  it("requests TOTP for an explicit totp_required challenge", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            key: "totp_required",
            message: "A 2FA token is required",
          },
        },
        400,
      ),
    );

    await expect(manager.authenticate(APP_PASSWORD)).resolves.toEqual({
      success: false,
      totpRequired: true,
    });

    expectPasswordOnlyRequest();
  });

  it("does not request TOTP when an app password is rejected as unauthorized", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            key: "unauthorized",
            message: "Invalid credentials",
          },
        },
        401,
      ),
    );

    await expect(manager.authenticate(APP_PASSWORD)).resolves.toEqual({
      success: false,
      error: "Invalid credentials",
    });

    expectPasswordOnlyRequest();
  });

  it("does not re-request TOTP when Pi-hole rejects the supplied token", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            key: "bad_request",
            message: "Invalid 2FA token",
          },
        },
        400,
      ),
    );

    await expect(
      manager.authenticate(APP_PASSWORD, TOTP_CODE),
    ).resolves.toEqual({
      success: false,
      error: "Invalid 2FA token",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(options.body as string)).toEqual({
      password: APP_PASSWORD,
      totp: TOTP_CODE,
    });
  });
});
