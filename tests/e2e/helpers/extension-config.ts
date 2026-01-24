import type { BrowserContext } from "@playwright/test";

/**
 * Configure the extension to use the mock server for testing
 *
 * This function injects a script that overrides browser.storage.local.get
 * to return test configuration with the mock server URL (localhost:8765)
 * instead of the real Pi-hole URL.
 *
 * This allows the extension to make real HTTP requests to the mock server
 * without needing to modify extension code or rely on Playwright's route
 * interception (which doesn't work for extension background scripts).
 *
 * @param context - Playwright browser context
 *
 * @example
 * ```typescript
 * test.beforeEach(async ({ context }) => {
 *   await configureExtensionForTesting(context);
 * });
 *
 * test('extension test', async ({ page, mockServer }) => {
 *   // Extension will now use http://localhost:8765 as Pi-hole URL
 *   const extensionId = process.env.EXTENSION_ID;
 *   await page.goto(`moz-extension://${extensionId}/options.html`);
 *   // ...
 * });
 * ```
 */
export async function configureExtensionForTesting(
  context: BrowserContext,
): Promise<void> {
  await context.addInitScript(() => {
    // Store original get function
    const originalGet = browser.storage.local.get;

    // Override browser.storage.local.get to return test config
    browser.storage.local.get = async (keys: any) => {
      // Call original to get any existing values
      const result = await originalGet.call(browser.storage.local, keys);

      // Override Pi-hole URL for testing
      if (keys === "pisentinel_config" || keys === null || keys === undefined) {
        return {
          ...result,
          pisentinel_config: {
            piholeUrl: "http://localhost:8765",
            encryptedPassword: null,
            refreshInterval: 30,
            notificationsEnabled: false,
            rememberPassword: false,
            encryptedMasterKey: null,
            ...(result?.pisentinel_config || {}),
          },
        };
      }

      return result;
    };

    console.log(
      "[E2E Test] Extension configured to use mock server at http://localhost:8765",
    );
  });
}
