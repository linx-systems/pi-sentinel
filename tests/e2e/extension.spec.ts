import { expect, test } from "./fixtures";
import { configureExtensionForTesting } from "./helpers/extension-config";
import { skipIfExtensionNotAccessible } from "./helpers/extension-check";

/**
 * E2E tests for PiSentinel extension.
 *
 * These tests use a real HTTP mock server running on localhost:8765
 * and configure the extension to use this server via storage override.
 *
 * SETUP REQUIRED:
 * 1. Build extension: npm run build:firefox
 * 2. Load extension in Firefox (see tests/e2e/SETUP.md)
 * 3. Get extension ID and add to .env.test: EXTENSION_ID=your-uuid-here
 * 4. Run tests: npm run test:e2e
 */

test.describe("PiSentinel Extension", () => {
  test.beforeEach(async ({ context }) => {
    // Configure extension to use mock server
    await configureExtensionForTesting(context);
  });

  test("should load extension successfully", async ({ page }) => {
    const extensionId = process.env.EXTENSION_ID;

    // Check if extension is accessible (not just if ID is set)
    const canRun = await skipIfExtensionNotAccessible(
      page,
      extensionId,
      test.skip,
    );
    if (!canRun) return;

    // Navigate to about:debugging to verify extension is listed
    await page.goto("about:debugging#/runtime/this-firefox");
    await expect(page.locator("text=PiSentinel")).toBeVisible();
  });

  test("should show options page (requires extension ID)", async ({
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

    // Navigate to extension options
    await page.goto(`moz-extension://${extensionId}/options.html`);

    // Wait for page load
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator("text=Pi-hole Configuration")).toBeVisible({
      timeout: 5000,
    });
  });

  test("should authenticate with Pi-hole (requires extension ID)", async ({
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

    await page.goto(`moz-extension://${extensionId}/options.html`);

    // Wait for page load
    await page.waitForLoadState("domcontentloaded");

    // Fill in Pi-hole URL and password
    // Note: Extension is already configured to use localhost:8765 via extension-config helper
    await page.fill('input[type="text"]', "http://localhost:8765");
    await page.fill('input[type="password"]', "test-password");

    // Click connect button
    await page.click('button:has-text("Connect")');

    // Verify connection success
    await expect(page.locator("text=Connected")).toBeVisible({ timeout: 5000 });
  });

  test("should display statistics in popup (requires extension ID)", async ({
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

    await page.goto(`moz-extension://${extensionId}/popup.html`);

    // Wait for stats to load
    await page.waitForLoadState("domcontentloaded");

    // Verify stats are displayed
    await expect(page.locator("text=10.0K")).toBeVisible({ timeout: 5000 }); // Total queries
    await expect(page.locator("text=2.5K")).toBeVisible(); // Blocked queries
    await expect(page.locator("text=25.0%")).toBeVisible(); // Block percentage
  });

  test("should toggle blocking status (requires extension ID)", async ({
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

    // Customize blocking handler to track state
    let blockingState = "enabled";
    mockServer.setHandler("POST", "/api/dns/blocking", (_req, res, body) => {
      const data = JSON.parse(body);
      blockingState = data.enabled ? "enabled" : "disabled";

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          blocking: blockingState,
          timer: data.timer || null,
        }),
      );
    });

    await page.goto(`moz-extension://${extensionId}/popup.html`);

    // Wait for popup to load
    await page.waitForLoadState("domcontentloaded");

    // Find the toggle button
    const toggleButton = page.locator(".toggle");
    await expect(toggleButton).toHaveClass(/active/);

    // Click to disable blocking
    await toggleButton.click();

    // Verify timer options appear
    await expect(page.locator("text=Disable for:")).toBeVisible();

    // Click on 5 minutes option
    await page.click('button:has-text("5 minutes")');

    // Verify blocking is disabled
    await expect(page.locator("text=Blocking Disabled")).toBeVisible();
    await expect(page.locator("text=5m remaining")).toBeVisible();
  });
});

test.describe("Pi-hole API Integration", () => {
  test("should handle authentication errors", async ({ page, mockServer }) => {
    // Mock failed authentication
    mockServer.setHandler("POST", "/api/auth", (_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            key: "unauthorized",
            message: "Invalid password",
          },
        }),
      );
    });

    await page.goto("https://example.com");

    // Test authentication error handling
    const authResponse = await page.evaluate(async () => {
      const res = await fetch("http://localhost:8765/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong" }),
      });
      return { status: res.status, data: await res.json() };
    });

    expect(authResponse.status).toBe(401);
    expect(authResponse.data.error.key).toBe("unauthorized");
  });

  test("should handle TOTP requirement", async ({ page, mockServer }) => {
    // Mock TOTP required response
    mockServer.setHandler("POST", "/api/auth", (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          session: {
            valid: false,
            totp: true,
            message: "TOTP required",
          },
        }),
      );
    });

    await page.goto("https://example.com");

    // Test TOTP response
    const authResponse = await page.evaluate(async () => {
      const res = await fetch("http://localhost:8765/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "test" }),
      });
      return res.json();
    });

    expect(authResponse.session.totp).toBe(true);
    expect(authResponse.session.valid).toBe(false);
  });

  test("should handle server unavailable", async ({ page, mockServer }) => {
    // Mock server error
    mockServer.setHandler("GET", "/api/stats/summary", (_req, res) => {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Service Unavailable",
        }),
      );
    });

    await page.goto("https://example.com");

    // Test error handling
    const statsResponse = await page.evaluate(async () => {
      const res = await fetch("http://localhost:8765/api/stats/summary");
      return { status: res.status, data: await res.json() };
    });

    expect(statsResponse.status).toBe(503);
  });
});
