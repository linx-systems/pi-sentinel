import { expect, test } from "./fixtures";
import { configureExtensionForTesting } from "./helpers/extension-config";
import { skipIfExtensionNotAccessible } from "./helpers/extension-check";

/**
 * E2E tests for domain management features.
 *
 * Tests adding/removing domains from allowlist and denylist
 * through the sidebar interface using the mock server.
 *
 * SETUP REQUIRED:
 * 1. Build extension: npm run build:firefox
 * 2. Load extension in Firefox (see tests/e2e/SETUP.md)
 * 3. Get extension ID and add to .env.test: EXTENSION_ID=your-uuid-here
 * 4. Run tests: npm run test:e2e
 */

test.describe("Domain Management", () => {
  test.beforeEach(async ({ context }) => {
    // Configure extension to use mock server
    await configureExtensionForTesting(context);
  });

  test("should display domains for current tab (requires extension ID)", async ({
    page,
    mockServer,
  }) => {
    const extensionId = process.env.EXTENSION_ID;

    // Check if extension is accessible (not just if ID is set)
    const canRun = await skipIfExtensionNotAccessible(
      page,
      extensionId,
      test.skip,
    );
    if (!canRun) return;

    await page.goto(`moz-extension://${extensionId}/sidebar.html`);

    // Navigate to a test page
    await page.goto("https://example.com");

    // Open sidebar and verify domains are listed
    await expect(page.locator("text=example.com")).toBeVisible();
  });

  test("should add domain to allowlist (requires extension ID)", async ({
    page,
    mockServer,
  }) => {
    const extensionId = process.env.EXTENSION_ID;

    // Check if extension is accessible (not just if ID is set)
    const canRun = await skipIfExtensionNotAccessible(
      page,
      extensionId,
      test.skip,
    );
    if (!canRun) return;

    await page.goto(`moz-extension://${extensionId}/sidebar.html`);

    // Find a domain in the list
    const domainRow = page.locator('[data-domain="tracker.example.com"]');

    // Click allowlist button
    await domainRow.locator('button[aria-label="Add to allowlist"]').click();

    // Verify success toast
    await expect(page.locator("text=Added to allowlist")).toBeVisible();
  });

  test("should add domain to denylist (requires extension ID)", async ({
    page,
    mockServer,
  }) => {
    const extensionId = process.env.EXTENSION_ID;

    // Check if extension is accessible (not just if ID is set)
    const canRun = await skipIfExtensionNotAccessible(
      page,
      extensionId,
      test.skip,
    );
    if (!canRun) return;

    await page.goto(`moz-extension://${extensionId}/sidebar.html`);

    const domainRow = page.locator('[data-domain="ads.example.com"]');
    await domainRow.locator('button[aria-label="Add to denylist"]').click();

    await expect(page.locator("text=Added to denylist")).toBeVisible();
  });

  test("should show domain status indicators (requires extension ID)", async ({
    page,
    mockServer,
  }) => {
    const extensionId = process.env.EXTENSION_ID;

    // Check if extension is accessible (not just if ID is set)
    const canRun = await skipIfExtensionNotAccessible(
      page,
      extensionId,
      test.skip,
    );
    if (!canRun) return;

    // Mock a domain that's already on allowlist
    mockServer.setHandler(
      "GET",
      "/api/search/allowed.example.com",
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            gravity: false,
            allowlist: true,
            denylist: false,
          }),
        );
      },
    );

    await page.goto(`moz-extension://${extensionId}/sidebar.html`);

    // Verify domain shows allowlist indicator
    const domainRow = page.locator('[data-domain="allowed.example.com"]');
    await expect(
      domainRow.locator(".status-indicator.allowlist"),
    ).toBeVisible();
  });

  test("should filter first-party vs third-party domains (requires extension ID)", async ({
    page,
    mockServer,
  }) => {
    const extensionId = process.env.EXTENSION_ID;

    // Check if extension is accessible (not just if ID is set)
    const canRun = await skipIfExtensionNotAccessible(
      page,
      extensionId,
      test.skip,
    );
    if (!canRun) return;

    await page.goto(`moz-extension://${extensionId}/sidebar.html`);

    // Click filter toggle
    await page.click('button:has-text("Third-party only")');

    // Verify only third-party domains are shown
    await expect(page.locator('[data-third-party="true"]')).toHaveCount(5);
    await expect(page.locator('[data-third-party="false"]')).toHaveCount(0);
  });

  test("should search domains (requires extension ID)", async ({
    page,
    mockServer,
  }) => {
    const extensionId = process.env.EXTENSION_ID;

    // Check if extension is accessible (not just if ID is set)
    const canRun = await skipIfExtensionNotAccessible(
      page,
      extensionId,
      test.skip,
    );
    if (!canRun) return;

    await page.goto(`moz-extension://${extensionId}/sidebar.html`);

    // Type in search box
    await page.fill('input[type="search"]', "tracker");

    // Verify filtered results
    const visibleDomains = page.locator(".domain-row:visible");
    await expect(visibleDomains).toHaveCount(2);
    await expect(visibleDomains.first()).toContainText("tracker");
  });

  test("should handle domain action errors (requires extension ID)", async ({
    page,
    mockServer,
  }) => {
    const extensionId = process.env.EXTENSION_ID;

    // Check if extension is accessible (not just if ID is set)
    const canRun = await skipIfExtensionNotAccessible(
      page,
      extensionId,
      test.skip,
    );
    if (!canRun) return;

    // Mock API error
    mockServer.setHandler("POST", "/api/domains/allow/exact", (_req, res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            key: "invalid_domain",
            message: "Domain already exists",
          },
        }),
      );
    });

    await page.goto(`moz-extension://${extensionId}/sidebar.html`);

    const domainRow = page.locator('[data-domain="existing.example.com"]');
    await domainRow.locator('button[aria-label="Add to allowlist"]').click();

    // Verify error toast
    await expect(page.locator("text=Domain already exists")).toBeVisible();
  });
});

test.describe("Domain Management API Tests", () => {
  test("should successfully add domain to allowlist", async ({
    page,
    mockServer,
  }) => {
    await page.goto("https://example.com");

    const response = await page.evaluate(async () => {
      const res = await fetch("http://localhost:8765/api/domains/allow/exact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: "example.com", comment: "Test" }),
      });
      return { status: res.status, data: await res.json() };
    });

    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
  });

  test("should successfully add domain to denylist", async ({
    page,
    mockServer,
  }) => {
    await page.goto("https://example.com");

    const response = await page.evaluate(async () => {
      const res = await fetch("http://localhost:8765/api/domains/deny/exact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: "ads.com", comment: "Blocked" }),
      });
      return { status: res.status, data: await res.json() };
    });

    expect(response.status).toBe(200);
    expect(response.data.success).toBe(true);
  });

  test("should search and find blocked domains", async ({
    page,
    mockServer,
  }) => {
    await page.goto("https://example.com");

    const response = await page.evaluate(async () => {
      const res = await fetch(
        "http://localhost:8765/api/search/ads.tracker.com",
      );
      return res.json();
    });

    expect(response.gravity).toBe(true);
  });

  test("should search and find allowed domains", async ({
    page,
    mockServer,
  }) => {
    await page.goto("https://example.com");

    const response = await page.evaluate(async () => {
      const res = await fetch("http://localhost:8765/api/search/example.com");
      return res.json();
    });

    expect(response.gravity).toBe(false);
  });
});

test.describe("Query Log", () => {
  test.beforeEach(async ({ context }) => {
    // Configure extension to use mock server
    await configureExtensionForTesting(context);
  });

  test("should display query log (requires extension ID)", async ({
    page,
    mockServer,
  }) => {
    const extensionId = process.env.EXTENSION_ID;

    // Check if extension is accessible (not just if ID is set)
    const canRun = await skipIfExtensionNotAccessible(
      page,
      extensionId,
      test.skip,
    );
    if (!canRun) return;

    await page.goto(`moz-extension://${extensionId}/sidebar.html`);

    // Switch to query log tab
    await page.click('button:has-text("Query Log")');

    // Verify queries are displayed
    await expect(page.locator("text=example.com")).toBeVisible();
    await expect(page.locator("text=ads.tracker.com")).toBeVisible();
  });

  test("should show blocked queries with indicator (requires extension ID)", async ({
    page,
    mockServer,
  }) => {
    const extensionId = process.env.EXTENSION_ID;

    // Check if extension is accessible (not just if ID is set)
    const canRun = await skipIfExtensionNotAccessible(
      page,
      extensionId,
      test.skip,
    );
    if (!canRun) return;

    await page.goto(`moz-extension://${extensionId}/sidebar.html`);

    await page.click('button:has-text("Query Log")');

    // Verify blocked query has indicator
    const blockedQuery = page.locator('[data-domain="ads.tracker.com"]');
    await expect(blockedQuery.locator(".status-blocked")).toBeVisible();
    await expect(blockedQuery).toContainText("GRAVITY");
  });

  test("should filter blocked queries (requires extension ID)", async ({
    page,
    mockServer,
  }) => {
    const extensionId = process.env.EXTENSION_ID;

    // Check if extension is accessible (not just if ID is set)
    const canRun = await skipIfExtensionNotAccessible(
      page,
      extensionId,
      test.skip,
    );
    if (!canRun) return;

    await page.goto(`moz-extension://${extensionId}/sidebar.html`);

    await page.click('button:has-text("Query Log")');

    // Click blocked filter
    await page.click('button:has-text("Blocked only")');

    // Verify only blocked queries shown
    await expect(page.locator('[data-status="GRAVITY"]')).toBeVisible();
    await expect(page.locator('[data-status="FORWARDED"]')).not.toBeVisible();
  });

  test("should refresh query log (requires extension ID)", async ({
    page,
    mockServer,
  }) => {
    const extensionId = process.env.EXTENSION_ID;

    // Check if extension is accessible (not just if ID is set)
    const canRun = await skipIfExtensionNotAccessible(
      page,
      extensionId,
      test.skip,
    );
    if (!canRun) return;

    await page.goto(`moz-extension://${extensionId}/sidebar.html`);

    await page.click('button:has-text("Query Log")');

    // Click refresh button
    await page.click('button[aria-label="Refresh"]');

    // Verify loading indicator
    await expect(page.locator(".loading-spinner")).toBeVisible();
  });
});

test.describe("Query Log API Tests", () => {
  test("should retrieve query log from API", async ({ page, mockServer }) => {
    await page.goto("https://example.com");

    const queries = await page.evaluate(async () => {
      const res = await fetch("http://localhost:8765/api/queries");
      return res.json();
    });

    expect(queries).toHaveLength(3);
    expect(queries[0].domain).toBe("example.com");
    expect(queries[1].domain).toBe("ads.tracker.com");
    expect(queries[1].status).toBe("GRAVITY");
  });

  test("should have both blocked and allowed queries", async ({
    page,
    mockServer,
  }) => {
    await page.goto("https://example.com");

    const queries = await page.evaluate(async () => {
      const res = await fetch("http://localhost:8765/api/queries");
      return res.json();
    });

    const blocked = queries.filter((q: any) => q.status === "GRAVITY");
    const allowed = queries.filter(
      (q: any) => q.status === "FORWARDED" || q.status === "CACHE",
    );

    expect(blocked.length).toBeGreaterThan(0);
    expect(allowed.length).toBeGreaterThan(0);
  });
});
