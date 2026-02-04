import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { PiholeClient } from "../../src/client";
import { isErr, isOk } from "../../src/result";

// Store original fetch before any tests run
const originalFetch = global.fetch;

describe("PiholeClient", () => {
  let client: PiholeClient;

  beforeEach(() => {
    // Reset to a default mock that returns 500 (for tests that don't set their own mock)
    global.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 500 })),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // Create client helper that sets mock first
  const createMockedClient = (
    mockFetch: typeof global.fetch,
    config: ConstructorParameters<typeof PiholeClient>[0],
  ): PiholeClient => {
    global.fetch = mockFetch;
    return new PiholeClient(config);
  };

  describe("constructor", () => {
    test("normalizes base URL", () => {
      const c = new PiholeClient({
        baseUrl: "http://pi.hole/",
      });
      // Client is created without error
      expect(c).toBeDefined();
    });

    test("initializes with pre-existing session", () => {
      const c = new PiholeClient({
        baseUrl: "http://pi.hole",
        sid: "test-sid",
        csrf: "test-csrf",
      });
      expect(c.isConnected()).toBe(true);
    });
  });

  // Create default client for tests that need it
  beforeEach(() => {
    client = new PiholeClient({
      baseUrl: "http://pi.hole",
      password: "test-password",
    });
  });

  describe("connect", () => {
    test("authenticates successfully", async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              session: {
                valid: true,
                sid: "session-id",
                csrf: "csrf-token",
                validity: 300,
                totp: false,
              },
            }),
            { status: 200 },
          ),
        ),
      );

      const result = await client.connect();
      expect(isOk(result)).toBe(true);
      expect(client.isConnected()).toBe(true);
    });

    test("returns error on failed auth", async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { key: "auth_failed" } }), {
            status: 401,
          }),
        ),
      );

      const result = await client.connect();
      expect(isErr(result)).toBe(true);
    });
  });

  describe("disconnect", () => {
    test("logs out successfully", async () => {
      // First login
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              session: {
                valid: true,
                sid: "session-id",
                csrf: "csrf-token",
                validity: 300,
                totp: false,
              },
            }),
            { status: 200 },
          ),
        ),
      );
      await client.connect();

      // Then logout
      global.fetch = mock(() =>
        Promise.resolve(new Response(null, { status: 204 })),
      );

      const result = await client.disconnect();
      expect(isOk(result)).toBe(true);
      expect(client.isConnected()).toBe(false);
    });
  });

  describe("testConnection", () => {
    test("returns ok when server responds with 200", async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
      );

      const result = await client.testConnection();
      expect(isOk(result)).toBe(true);
    });

    test("returns ok when server responds with 401", async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response(null, { status: 401 })),
      );

      const result = await client.testConnection();
      expect(isOk(result)).toBe(true);
    });
  });

  describe("endpoint namespaces", () => {
    test("exposes all endpoint namespaces", () => {
      expect(client.auth).toBeDefined();
      expect(client.dns).toBeDefined();
      expect(client.stats).toBeDefined();
      expect(client.queries).toBeDefined();
      expect(client.history).toBeDefined();
      expect(client.domains).toBeDefined();
      expect(client.groups).toBeDefined();
      expect(client.clients).toBeDefined();
      expect(client.lists).toBeDefined();
      expect(client.dhcp).toBeDefined();
      expect(client.config).toBeDefined();
      expect(client.info).toBeDefined();
      expect(client.network).toBeDefined();
      expect(client.actions).toBeDefined();
      expect(client.logs).toBeDefined();
      expect(client.teleporter).toBeDefined();
    });
  });

  // NOTE: Integration tests with real HTTP mocking are in separate files
  // These tests verify the endpoint namespaces are properly exposed
  describe("endpoint API surface", () => {
    test("stats has expected methods", () => {
      expect(typeof client.stats.getSummary).toBe("function");
      expect(typeof client.stats.getUpstreams).toBe("function");
      expect(typeof client.stats.getTopDomains).toBe("function");
      expect(typeof client.stats.getTopClients).toBe("function");
      expect(typeof client.stats.getQueryTypes).toBe("function");
      expect(typeof client.stats.getRecentBlocked).toBe("function");
      expect(client.stats.database).toBeDefined();
    });

    test("dns has expected methods", () => {
      expect(typeof client.dns.getStatus).toBe("function");
      expect(typeof client.dns.enable).toBe("function");
      expect(typeof client.dns.disable).toBe("function");
      expect(typeof client.dns.setBlocking).toBe("function");
    });

    test("domains has expected methods", () => {
      expect(typeof client.domains.deny).toBe("function");
      expect(typeof client.domains.undeny).toBe("function");
      expect(typeof client.domains.getDenylist).toBe("function");
      expect(typeof client.domains.allow).toBe("function");
      expect(typeof client.domains.unallow).toBe("function");
      expect(typeof client.domains.getAllowlist).toBe("function");
      expect(typeof client.domains.denyRegex).toBe("function");
      expect(typeof client.domains.allowRegex).toBe("function");
      expect(typeof client.domains.list).toBe("function");
      expect(typeof client.domains.add).toBe("function");
      expect(typeof client.domains.update).toBe("function");
      expect(typeof client.domains.remove).toBe("function");
      expect(typeof client.domains.batchDelete).toBe("function");
      expect(typeof client.domains.search).toBe("function");
    });

    test("groups has expected methods", () => {
      expect(typeof client.groups.list).toBe("function");
      expect(typeof client.groups.create).toBe("function");
      expect(typeof client.groups.update).toBe("function");
      expect(typeof client.groups.delete).toBe("function");
      expect(typeof client.groups.batchDelete).toBe("function");
    });

    test("clients has expected methods", () => {
      expect(typeof client.clients.list).toBe("function");
      expect(typeof client.clients.create).toBe("function");
      expect(typeof client.clients.update).toBe("function");
      expect(typeof client.clients.delete).toBe("function");
      expect(typeof client.clients.getSuggestions).toBe("function");
      expect(typeof client.clients.batchDelete).toBe("function");
    });

    test("lists has expected methods", () => {
      expect(typeof client.lists.list).toBe("function");
      expect(typeof client.lists.add).toBe("function");
      expect(typeof client.lists.update).toBe("function");
      expect(typeof client.lists.delete).toBe("function");
      expect(typeof client.lists.batchDelete).toBe("function");
    });

    test("config has expected methods", () => {
      expect(typeof client.config.get).toBe("function");
      expect(typeof client.config.getSection).toBe("function");
      expect(typeof client.config.update).toBe("function");
      expect(typeof client.config.addArrayItem).toBe("function");
      expect(typeof client.config.removeArrayItem).toBe("function");
    });

    test("info has expected methods", () => {
      expect(typeof client.info.getClient).toBe("function");
      expect(typeof client.info.getSystem).toBe("function");
      expect(typeof client.info.getHost).toBe("function");
      expect(typeof client.info.getFtl).toBe("function");
      expect(typeof client.info.getSensors).toBe("function");
      expect(typeof client.info.getDatabase).toBe("function");
      expect(typeof client.info.getVersion).toBe("function");
      expect(typeof client.info.getMessages).toBe("function");
    });

    test("actions has expected methods", () => {
      expect(typeof client.actions.updateGravity).toBe("function");
      expect(typeof client.actions.restartDns).toBe("function");
      expect(typeof client.actions.flushLogs).toBe("function");
      expect(typeof client.actions.flushArp).toBe("function");
      expect(typeof client.actions.flushNetwork).toBe("function");
    });
  });
});
