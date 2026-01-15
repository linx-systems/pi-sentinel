import {expect, test} from './fixtures';

/**
 * Tests demonstrating different mock API scenarios.
 *
 * These tests show how to test various Pi-hole states and error conditions
 * using the MockPiHoleServer with customized handlers.
 */

test.describe('Mock API Scenarios', () => {
    test('default scenario - normal operation', async ({page, mockServer}) => {
        // Mock server already has default handlers configured
        await page.goto('https://example.com');

        // Test API response
        const stats = await page.evaluate(async () => {
            const res = await fetch('http://localhost:8765/api/stats/summary');
            return res.json();
        });

        expect(stats.queries.total).toBe(10000);
        expect(stats.queries.blocked).toBe(2500);
        expect(stats.queries.percent_blocked).toBe(25.0);
    });

    test('authentication failure scenario', async ({page, mockServer}) => {
        // Customize auth handler to return 401
        mockServer.setHandler('POST', '/api/auth', (_req, res) => {
            res.writeHead(401, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({
                error: {key: 'unauthorized', message: 'Invalid credentials'}
            }));
        });

        await page.goto('https://example.com');

        const authResponse = await page.evaluate(async () => {
            const res = await fetch('http://localhost:8765/api/auth', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({password: 'wrong'}),
            });
            return {status: res.status, data: await res.json()};
        });

        expect(authResponse.status).toBe(401);
        expect(authResponse.data.error.key).toBe('unauthorized');
    });

    test('TOTP required scenario', async ({page, mockServer}) => {
        // Customize auth handler to require TOTP
        mockServer.setHandler('POST', '/api/auth', (_req, res) => {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({
                session: {
                    valid: false,
                    totp: true,
                    message: 'TOTP required',
                },
            }));
        });

        await page.goto('https://example.com');

        const authResponse = await page.evaluate(async () => {
            const res = await fetch('http://localhost:8765/api/auth', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({password: 'test'}),
            });
            return res.json();
        });

        expect(authResponse.session.totp).toBe(true);
    });

    test('blocking disabled scenario', async ({page, mockServer}) => {
        // Customize blocking handler
        mockServer.setHandler('GET', '/api/dns/blocking', (_req, res) => {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({
                blocking: 'disabled',
                timer: null,
            }));
        });

        await page.goto('https://example.com');

        const blockingStatus = await page.evaluate(async () => {
            const res = await fetch('http://localhost:8765/api/dns/blocking');
            return res.json();
        });

        expect(blockingStatus.blocking).toBe('disabled');
    });

    test('high blocking rate scenario', async ({page, mockServer}) => {
        // Customize stats handler for high blocking
        mockServer.setHandler('GET', '/api/stats/summary', (_req, res) => {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({
                queries: {
                    total: 10000,
                    blocked: 7500,
                    percent_blocked: 75.0,
                    unique_domains: 500,
                    forwarded: 2000,
                    cached: 500,
                },
                clients: {active: 5, total: 10},
                gravity: {domains_being_blocked: 150000, last_update: Date.now()},
            }));
        });

        await page.goto('https://example.com');

        const stats = await page.evaluate(async () => {
            const res = await fetch('http://localhost:8765/api/stats/summary');
            return res.json();
        });

        expect(stats.queries.percent_blocked).toBe(75.0);
    });

    test('low activity scenario', async ({page, mockServer}) => {
        // Customize stats handler for low activity
        mockServer.setHandler('GET', '/api/stats/summary', (_req, res) => {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({
                queries: {
                    total: 100,
                    blocked: 10,
                    percent_blocked: 10.0,
                    unique_domains: 20,
                    forwarded: 80,
                    cached: 10,
                },
                clients: {active: 1, total: 2},
                gravity: {domains_being_blocked: 150000, last_update: Date.now()},
            }));
        });

        await page.goto('https://example.com');

        const stats = await page.evaluate(async () => {
            const res = await fetch('http://localhost:8765/api/stats/summary');
            return res.json();
        });

        expect(stats.queries.total).toBe(100);
        expect(stats.queries.blocked).toBe(10);
    });
});

test.describe('Domain Management Scenarios', () => {
    test('add domain to allowlist', async ({page, mockServer}) => {
        await page.goto('https://example.com');

        const response = await page.evaluate(async () => {
            const res = await fetch('http://localhost:8765/api/domains/allow/exact', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({domain: 'example.com', comment: 'Test'}),
            });
            return {status: res.status, data: await res.json()};
        });

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
    });

    test('add domain to denylist', async ({page, mockServer}) => {
        await page.goto('https://example.com');

        const response = await page.evaluate(async () => {
            const res = await fetch('http://localhost:8765/api/domains/deny/exact', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({domain: 'ads.com', comment: 'Blocked'}),
            });
            return {status: res.status, data: await res.json()};
        });

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
    });

    test('search for blocked domain', async ({page, mockServer}) => {
        await page.goto('https://example.com');

        const response = await page.evaluate(async () => {
            const res = await fetch('http://localhost:8765/api/search/ads.tracker.com');
            return res.json();
        });

        expect(response.gravity).toBe(true);
    });

    test('search for allowed domain', async ({page, mockServer}) => {
        await page.goto('https://example.com');

        const response = await page.evaluate(async () => {
            const res = await fetch('http://localhost:8765/api/search/example.com');
            return res.json();
        });

        expect(response.gravity).toBe(false);
    });
});

test.describe('Query Log Scenarios', () => {
    test('retrieve query log', async ({page, mockServer}) => {
        await page.goto('https://example.com');

        const queries = await page.evaluate(async () => {
            const res = await fetch('http://localhost:8765/api/queries');
            return res.json();
        });

        expect(queries).toHaveLength(3);
        expect(queries[0].domain).toBe('example.com');
        expect(queries[1].domain).toBe('ads.tracker.com');
        expect(queries[1].status).toBe('GRAVITY');
    });

    test('query log contains both blocked and allowed', async ({page, mockServer}) => {
        await page.goto('https://example.com');

        const queries = await page.evaluate(async () => {
            const res = await fetch('http://localhost:8765/api/queries');
            return res.json();
        });

        const blocked = queries.filter((q: any) => q.status === 'GRAVITY');
        const allowed = queries.filter((q: any) => q.status === 'FORWARDED' || q.status === 'CACHE');

        expect(blocked.length).toBeGreaterThan(0);
        expect(allowed.length).toBeGreaterThan(0);
    });
});

test.describe('Blocking Control Scenarios', () => {
    test('enable blocking', async ({page, mockServer}) => {
        await page.goto('https://example.com');

        const response = await page.evaluate(async () => {
            const res = await fetch('http://localhost:8765/api/dns/blocking', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({enabled: true}),
            });
            return res.json();
        });

        expect(response.blocking).toBe('enabled');
    });

    test('disable blocking with timer', async ({page, mockServer}) => {
        await page.goto('https://example.com');

        const response = await page.evaluate(async () => {
            const res = await fetch('http://localhost:8765/api/dns/blocking', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({enabled: false, timer: 300}),
            });
            return res.json();
        });

        expect(response.blocking).toBe('disabled');
        expect(response.timer).toBe(300);
    });

    test('disable blocking indefinitely', async ({page, mockServer}) => {
        await page.goto('https://example.com');

        const response = await page.evaluate(async () => {
            const res = await fetch('http://localhost:8765/api/dns/blocking', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({enabled: false}),
            });
            return res.json();
        });

        expect(response.blocking).toBe('disabled');
        expect(response.timer).toBeNull();
    });
});
