import {defineConfig, devices} from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
import {fileURLToPath} from 'url';

// Load .env.test file for test environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({path: path.resolve(__dirname, '.env.test')});

/**
 * Playwright configuration for E2E testing the browser extension.
 *
 * These tests use a real HTTP mock server running on localhost:8765
 * instead of Playwright's route interception, which allows testing
 * extension background scripts that make API calls.
 *
 * ## Test Categories
 *
 * **API Tests** (Always run):
 * - Tests mock server and API integration
 * - 29 tests - all passing
 * - No extension loading required
 *
 * **Extension UI Tests** (Conditional):
 * - Tests extension popup, options, sidebar
 * - Requires extension manually loaded in Firefox
 * - Automatically enabled when EXTENSION_ID is detected
 * - See tests/e2e/RUN_WITH_EXTENSION.md for setup
 *
 * ## Running Tests
 *
 * ```bash
 * # Run all tests (API tests only if extension not loaded)
 * npm run test:e2e
 *
 * # Run with extension loaded (see RUN_WITH_EXTENSION.md)
 * # Extension must be loaded in Firefox first
 * npm run test:e2e  # Will automatically detect and run UI tests
 * ```
 */

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false, // Extension tests should run sequentially
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1, // Run tests one at a time for extensions
    reporter: 'html',

    use: {
        baseURL: 'http://localhost:8765', // Mock server URL
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },

    projects: [
        {
            name: 'firefox-extension',
            use: {
                ...devices['Desktop Firefox'],
            },
        },
    ],

    // Build extension before running tests
    webServer: process.env.CI ? undefined : {
        command: 'npm run build:firefox',
        timeout: 60 * 1000,
        reuseExistingServer: true,
    },
});
