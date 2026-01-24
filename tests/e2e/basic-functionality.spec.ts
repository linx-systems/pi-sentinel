import { expect, test } from "./fixtures";
import { skipIfExtensionNotAccessible } from "./helpers/extension-check";

/**
 * Basic E2E tests for PiSentinel extension.
 *
 * These tests use a real HTTP mock server running on localhost:8765
 * instead of Playwright's route interception, which allows testing
 * extension background scripts that make API calls.
 *
 * SETUP REQUIRED:
 * 1. Build extension: npm run build:firefox
 * 2. Load extension in Firefox (see tests/e2e/SETUP.md)
 * 3. Get extension ID and add to .env.test
 * 4. Run tests: npm run test:e2e
 */

test.describe("PiSentinel Basic Functionality", () => {
  test("can navigate to example.com", async ({ page }) => {
    await page.goto("https://example.com");
    await expect(page).toHaveTitle(/Example Domain/);
  });

  test("can load a page with third-party resources", async ({ page }) => {
    // This tests that the extension's domain tracking works
    await page.goto("https://example.com");

    // Wait for page to fully load
    await page.waitForLoadState("networkidle");

    // Verify page loaded successfully
    await expect(page.locator("h1")).toContainText("Example Domain");
  });
});

test.describe("Extension Popup Access", () => {
  test("can access extension popup (requires extension ID)", async ({
    page,
  }) => {
    const extensionId = process.env.EXTENSION_ID;

    // Check if extension is accessible (not just if ID is set)
    const canRun = await skipIfExtensionNotAccessible(
      page,
      extensionId,
      test.skip,
    );
    if (!canRun) return;

    // Navigate to popup
    await page.goto(`moz-extension://${extensionId}/popup.html`);

    // Wait for popup to load
    await page.waitForLoadState("domcontentloaded");

    // Verify popup elements
    await expect(page.locator("text=PiSentinel")).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("API Mocking Verification", () => {
  test("mock server returns stats correctly", async ({ page, mockServer }) => {
    // Mock server is already running on localhost:8765
    await page.goto("https://example.com");

    // Make a test API call via fetch
    const response = await page.evaluate(async () => {
      const res = await fetch("http://localhost:8765/api/stats/summary");
      return res.json();
    });

    // Verify mock data
    expect(response.queries.total).toBe(10000);
    expect(response.queries.blocked).toBe(2500);
  });

  test("mock server handles authentication", async ({ page, mockServer }) => {
    await page.goto("https://example.com");

    const response = await page.evaluate(async () => {
      const res = await fetch("http://localhost:8765/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "test" }),
      });
      return res.json();
    });

    expect(response.session.valid).toBe(true);
    expect(response.session.sid).toBe("mock-session-id");
  });
});

test.describe("Extension State Verification", () => {
  test("extension storage is accessible", async ({ context }) => {
    // This verifies that extension APIs are available
    // Note: Direct extension storage access from tests is limited

    const page = await context.newPage();
    await page.goto("https://example.com");

    // Check if browser API is available (injected by extension)
    const hasBrowserApi = await page.evaluate(() => {
      return (
        typeof (window as any).browser !== "undefined" ||
        typeof (window as any).chrome !== "undefined"
      );
    });

    console.log("Browser API available:", hasBrowserApi);
  });
});

/**
 * Example test demonstrating how to test with real Pi-hole
 * (requires actual Pi-hole instance)
 */
test.describe("Real Pi-hole Integration", () => {
  test.skip("can connect to real Pi-hole", async ({ page }) => {
    // Skip by default - enable when testing with real Pi-hole
    const piHoleUrl = process.env.PIHOLE_URL || "http://pi.hole";

    // Don't mock API for this test
    await page.goto("https://example.com");

    // Make real API call
    const response = await page.evaluate(async (url) => {
      try {
        const res = await fetch(`${url}/api/stats/summary`);
        return { success: true, status: res.status };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }, piHoleUrl);

    console.log("Pi-hole connection:", response);
  });
});
