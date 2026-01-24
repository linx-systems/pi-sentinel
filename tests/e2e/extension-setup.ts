import { type BrowserContext, chromium } from "@playwright/test";
import path from "path";

/**
 * Helper to load the extension in a browser context.
 * For Firefox, extensions need special handling.
 */
export async function loadExtension(): Promise<BrowserContext> {
  const extensionPath = path.resolve(__dirname, "../../dist/firefox-mv3");

  // For Chrome/Chromium (if we add Chrome support later)
  // const context = await chromium.launchPersistentContext('', {
  //   headless: false,
  //   args: [
  //     `--disable-extensions-except=${extensionPath}`,
  //     `--load-extension=${extensionPath}`,
  //   ],
  // });

  // For Firefox, we need to use web-ext or manually load the extension
  // This is a placeholder - actual implementation depends on test requirements
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  return context;
}

/**
 * Get the extension's background page URL.
 */
export async function getBackgroundPage(context: BrowserContext) {
  // For Chromium-based browsers
  const backgroundPages = context.backgroundPages();
  if (backgroundPages.length > 0) {
    return backgroundPages[0];
  }

  // Wait for background page to load
  return context.waitForEvent("backgroundpage");
}

/**
 * Mock Pi-hole API responses for testing.
 */
export function mockPiHoleApi(page: any) {
  return page.route("**/api/**", (route: any) => {
    const url = route.request().url();

    // Mock authentication
    if (url.includes("/api/auth") && route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: {
            valid: true,
            sid: "test-session-id",
            csrf: "test-csrf-token",
            validity: 300,
            totp: false,
          },
        }),
      });
    }

    // Mock stats
    if (url.includes("/api/stats/summary")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          queries: {
            total: 10000,
            blocked: 2500,
            percent_blocked: 25.0,
            unique_domains: 500,
            forwarded: 7000,
            cached: 500,
          },
          clients: {
            active: 5,
            total: 10,
          },
          gravity: {
            domains_being_blocked: 150000,
            last_update: Date.now(),
          },
        }),
      });
    }

    // Mock blocking status
    if (url.includes("/api/dns/blocking")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          blocking: "enabled",
          timer: null,
        }),
      });
    }

    // Default: continue without mocking
    return route.continue();
  });
}
