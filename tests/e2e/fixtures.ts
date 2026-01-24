import { test as base } from "@playwright/test";
import { MockPiHoleServer } from "./server/mock-server";

/**
 * Extended Playwright test fixture with MockPiHoleServer
 *
 * This fixture automatically starts the mock server before each test
 * and stops it after each test completes.
 *
 * Usage:
 * ```typescript
 * import { test, expect } from './fixtures';
 *
 * test('my test', async ({ page, mockServer }) => {
 *   // Mock server is already running on localhost:8765
 *
 *   // Customize responses for this test
 *   mockServer.setHandler('POST', '/api/auth', (req, res) => {
 *     res.writeHead(401, { 'Content-Type': 'application/json' });
 *     res.end(JSON.stringify({ error: 'Unauthorized' }));
 *   });
 *
 *   await page.goto('https://example.com');
 *   // Test implementation...
 * });
 * ```
 */
export const test = base.extend<{ mockServer: MockPiHoleServer }>({
  mockServer: async ({}, use) => {
    const server = new MockPiHoleServer(8765);

    // Start the mock server before the test
    await server.start();

    // Provide the server to the test
    await use(server);

    // Stop the mock server after the test
    await server.stop();
  },
});

export { expect } from "@playwright/test";
