import type { Page } from "@playwright/test";

/**
 * Checks if the extension is actually accessible in the browser.
 * Returns true if extension pages can be loaded, false otherwise.
 *
 * This is more robust than just checking if EXTENSION_ID is set,
 * because the extension must be manually loaded in Firefox for
 * UI tests to work.
 */
export async function isExtensionAccessible(
  page: Page,
  extensionId: string,
): Promise<boolean> {
  try {
    // Try to navigate to extension popup
    const response = await page.goto(
      `moz-extension://${extensionId}/popup.html`,
      {
        waitUntil: "domcontentloaded",
        timeout: 3000,
      },
    );

    // If navigation succeeded, extension is loaded
    return response?.ok() ?? false;
  } catch (error) {
    // NS_ERROR_NOT_AVAILABLE or timeout means extension isn't loaded
    return false;
  }
}

/**
 * Helper to skip test if extension isn't accessible.
 * Call this at the start of extension UI tests.
 *
 * @example
 * ```typescript
 * test('extension UI test', async ({ page }) => {
 *   const extensionId = process.env.EXTENSION_ID;
 *   const canRun = await skipIfExtensionNotAccessible(page, extensionId, test.skip);
 *   if (!canRun) return;
 *
 *   // Test implementation...
 * });
 * ```
 */
export async function skipIfExtensionNotAccessible(
  page: Page,
  extensionId: string | undefined,
  testSkip: () => void,
): Promise<boolean> {
  if (!extensionId) {
    console.log("⚠️  Set EXTENSION_ID in .env.test to enable this test");
    testSkip();
    return false;
  }

  const accessible = await isExtensionAccessible(page, extensionId);

  if (!accessible) {
    console.log(
      "⚠️  Extension not loaded in browser. See tests/e2e/RUN_WITH_EXTENSION.md",
    );
    testSkip();
    return false;
  }

  return true;
}
