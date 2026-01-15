import type {Page, Route} from '@playwright/test';

/**
 * Mock Pi-hole API responses for testing.
 *
 * Usage:
 *   await page.route('**\/api/**', mockPiHoleApiHandler);
 */

export interface MockApiOptions {
    authenticated?: boolean;
    blockingEnabled?: boolean;
    totpRequired?: boolean;
    stats?: {
        total?: number;
        blocked?: number;
        percent_blocked?: number;
    };
}

/**
 * Create a mock API handler with custom options
 */
export function createMockApiHandler(options: MockApiOptions = {}) {
    const {
        authenticated = true,
        blockingEnabled = true,
        totpRequired = false,
        stats = {
            total: 10000,
            blocked: 2500,
            percent_blocked: 25.0,
        },
    } = options;

    return async (route: Route) => {
        const url = route.request().url();
        const method = route.request().method();

        // Mock authentication
        if (url.includes('/api/auth') && method === 'POST') {
            if (authenticated) {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        session: {
                            valid: true,
                            sid: 'mock-session-id',
                            csrf: 'mock-csrf-token',
                            validity: 300,
                            totp: totpRequired,
                        },
                    }),
                });
            } else {
                await route.fulfill({
                    status: 401,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        error: {
                            key: 'unauthorized',
                            message: 'Invalid credentials',
                        },
                    }),
                });
            }
            return;
        }

        // Mock logout
        if (url.includes('/api/auth') && method === 'DELETE') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({success: true}),
            });
            return;
        }

        // Mock stats
        if (url.includes('/api/stats/summary')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    queries: {
                        total: stats.total,
                        blocked: stats.blocked,
                        percent_blocked: stats.percent_blocked,
                        unique_domains: 500,
                        forwarded: stats.total! - stats.blocked!,
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
            return;
        }

        // Mock blocking status
        if (url.includes('/api/dns/blocking') && method === 'GET') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    blocking: blockingEnabled ? 'enabled' : 'disabled',
                    timer: null,
                }),
            });
            return;
        }

        // Mock set blocking
        if (url.includes('/api/dns/blocking') && method === 'POST') {
            const requestBody = route.request().postDataJSON();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    blocking: requestBody.enabled ? 'enabled' : 'disabled',
                    timer: requestBody.timer || null,
                }),
            });
            return;
        }

        // Mock queries
        if (url.includes('/api/queries')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([
                    {
                        id: 1,
                        timestamp: Date.now() - 1000,
                        type: 'A',
                        domain: 'example.com',
                        client: '192.168.1.100',
                        status: 'FORWARDED',
                        reply_type: 'IP',
                        reply_time: 15,
                    },
                    {
                        id: 2,
                        timestamp: Date.now() - 2000,
                        type: 'A',
                        domain: 'ads.tracker.com',
                        client: '192.168.1.100',
                        status: 'GRAVITY',
                        reply_type: 'NODATA',
                        reply_time: 2,
                    },
                    {
                        id: 3,
                        timestamp: Date.now() - 3000,
                        type: 'A',
                        domain: 'cdn.example.com',
                        client: '192.168.1.100',
                        status: 'CACHE',
                        reply_type: 'IP',
                        reply_time: 1,
                    },
                ]),
            });
            return;
        }

        // Mock domain allowlist/denylist
        if (url.includes('/api/domains/allow') || url.includes('/api/domains/deny')) {
            if (method === 'POST') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({success: true}),
                });
            } else if (method === 'DELETE') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({success: true}),
                });
            } else {
                await route.continue();
            }
            return;
        }

        // Mock domain search
        if (url.includes('/api/search/')) {
            const domain = url.split('/api/search/')[1];
            const isBlocked = domain.includes('ads') || domain.includes('tracker');

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    gravity: isBlocked,
                    allowlist: false,
                    denylist: false,
                }),
            });
            return;
        }

        // Default: continue without mocking
        await route.continue();
    };
}

/**
 * Default mock API handler with standard settings
 */
export const mockPiHoleApiHandler = createMockApiHandler();

/**
 * Setup mock API for a page
 */
export async function setupMockApi(page: Page, options?: MockApiOptions) {
    await page.route('**/api/**', createMockApiHandler(options));
}

/**
 * Mock scenarios for testing different states
 */
export const mockScenarios = {
    // Happy path - everything working
    default: createMockApiHandler(),

    // Authentication failed
    unauthenticated: createMockApiHandler({authenticated: false}),

    // TOTP required
    totpRequired: createMockApiHandler({totpRequired: true}),

    // Blocking disabled
    blockingDisabled: createMockApiHandler({blockingEnabled: false}),

    // High blocking rate
    highBlocking: createMockApiHandler({
        stats: {
            total: 10000,
            blocked: 7500,
            percent_blocked: 75.0,
        },
    }),

    // Low activity
    lowActivity: createMockApiHandler({
        stats: {
            total: 100,
            blocked: 10,
            percent_blocked: 10.0,
        },
    }),
};
