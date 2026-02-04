import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { PiholeErrorCode } from "../../src/errors";
import { HttpClient } from "../../src/http";
import { isErr, isOk } from "../../src/result";

describe("HttpClient", () => {
  let client: HttpClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new HttpClient({
      baseUrl: "http://localhost",
      timeout: 5000,
      maxRetries: 2,
      retryDelayBase: 10, // Fast retries for tests
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("request", () => {
    test("returns error when baseUrl not configured", async () => {
      const noUrlClient = new HttpClient();
      const result = await noUrlClient.request({
        method: "GET",
        path: "/test",
      });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(PiholeErrorCode.BadRequest);
      }
    });

    test("makes successful GET request", async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: "test" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      const result = await client.request({ method: "GET", path: "/api/test" });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toEqual({ data: "test" });
      }
    });

    test("makes successful POST request with body", async () => {
      global.fetch = mock((url, options) => {
        expect(options?.method).toBe("POST");
        expect(options?.body).toBe(JSON.stringify({ key: "value" }));
        return Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      });

      const result = await client.request({
        method: "POST",
        path: "/api/test",
        body: { key: "value" },
      });
      expect(isOk(result)).toBe(true);
    });

    test("handles 204 No Content", async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response(null, { status: 204 })),
      );

      const result = await client.request({
        method: "DELETE",
        path: "/api/test",
      });
      expect(isOk(result)).toBe(true);
    });

    test("handles error response with Pi-hole error format", async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                key: "unauthorized",
                message: "Not authenticated",
                hint: "Please login",
              },
            }),
            { status: 401 },
          ),
        ),
      );

      const result = await client.request({ method: "GET", path: "/api/test" });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(PiholeErrorCode.Unauthorized);
        expect(result.error.message).toBe("Not authenticated");
        expect(result.error.hint).toBe("Please login");
        expect(result.error.status).toBe(401);
      }
    });

    test("handles network error", async () => {
      global.fetch = mock(() => Promise.reject(new Error("Network failure")));

      const result = await client.request({
        method: "GET",
        path: "/api/test",
        noRetry: true,
      });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(PiholeErrorCode.NetworkError);
      }
    });

    test("handles timeout", async () => {
      global.fetch = mock(() => {
        const error = new Error("Aborted");
        error.name = "AbortError";
        return Promise.reject(error);
      });

      const result = await client.request({
        method: "GET",
        path: "/api/test",
        noRetry: true,
      });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(PiholeErrorCode.Timeout);
      }
    });

    test("retries on server error", async () => {
      let attempts = 0;
      global.fetch = mock(() => {
        attempts++;
        if (attempts < 2) {
          return Promise.resolve(new Response(null, { status: 500 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ success: true }), { status: 200 }),
        );
      });

      const result = await client.request({ method: "GET", path: "/api/test" });
      expect(isOk(result)).toBe(true);
      expect(attempts).toBe(2);
    });

    test("does not retry on 401", async () => {
      let attempts = 0;
      global.fetch = mock(() => {
        attempts++;
        return Promise.resolve(
          new Response(JSON.stringify({ error: { key: "unauthorized" } }), {
            status: 401,
          }),
        );
      });

      const result = await client.request({ method: "GET", path: "/api/test" });
      expect(isErr(result)).toBe(true);
      expect(attempts).toBe(1);
    });

    test("includes auth headers when provided", async () => {
      global.fetch = mock((url, options) => {
        expect(options?.headers?.["X-FTL-SID"]).toBe("test-sid");
        expect(options?.headers?.["X-FTL-CSRF"]).toBe("test-csrf");
        return Promise.resolve(
          new Response(JSON.stringify({}), { status: 200 }),
        );
      });

      await client.request(
        { method: "GET", path: "/api/test" },
        { "X-FTL-SID": "test-sid", "X-FTL-CSRF": "test-csrf" },
      );
    });
  });

  describe("configuration", () => {
    test("setBaseUrl normalizes trailing slash", () => {
      client.setBaseUrl("http://example.com/");
      expect(client.getBaseUrl()).toBe("http://example.com");
    });

    test("configure updates settings", () => {
      client.configure({ timeout: 30000 });
      // Can't directly test private config, but can verify it doesn't throw
      expect(client.getBaseUrl()).toBe("http://localhost");
    });
  });
});
