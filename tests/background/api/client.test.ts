import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiholeApiClient } from "~/background/api/client";

describe("PiholeApiClient", () => {
  let client: PiholeApiClient;
  let fetchMock: any;

  beforeEach(() => {
    client = new PiholeApiClient({ baseUrl: "http://pi.hole" });

    // Mock global fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("query responses", () => {
    it("rejects a successful malformed query container instead of treating it as empty", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      await expect(client.getQueries()).resolves.toEqual({
        success: false,
        error: {
          key: "invalid_response",
          message: "Invalid query response",
          status: 200,
        },
      });
    });
    it.each([
      ["direct array", []],
      ["queries container", { queries: [] }],
    ])("keeps a valid empty %s successful", async (_shape, payload) => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => payload,
      });

      await expect(client.getQueries()).resolves.toEqual({
        success: true,
        data: [],
      });
    });
  });

  describe("connection test transport failures", () => {
    it("preserves HTTPS and classifies certificate failures as status-0 network failures", async () => {
      client = new PiholeApiClient({ baseUrl: "https://192.168.1.192" });
      fetchMock.mockRejectedValueOnce(
        new Error("self signed certificate in certificate chain"),
      );

      await expect(client.testConnection()).resolves.toEqual({
        success: false,
        error: {
          key: "cert_error",
          message:
            "SSL certificate error. Open your Pi-hole URL in Firefox and accept the certificate first.",
          status: 0,
        },
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://192.168.1.192/api/auth",
        expect.objectContaining({ method: "GET" }),
      );
    });
  });
});
