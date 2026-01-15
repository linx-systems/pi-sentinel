import type {IncomingMessage, ServerResponse} from 'http';
import http from 'http';

/**
 * Mock Pi-hole HTTP server for E2E testing.
 *
 * This server responds to Pi-hole API requests, allowing tests to control
 * responses without needing a real Pi-hole instance or relying on Playwright's
 * route interception (which doesn't work for extension background scripts).
 */
export class MockPiHoleServer {
    private server: http.Server | null = null;
    private port: number;
    private handlers: Map<string, Function> = new Map();

    constructor(port: number = 8765) {
        this.port = port;
        this.setupDefaultHandlers();
    }

    /**
     * Start the HTTP server
     */
    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer(this.handleRequest.bind(this));

            this.server.listen(this.port, () => {
                console.log(`[Mock Server] Listening on http://localhost:${this.port}`);
                resolve();
            });

            this.server.on('error', (error) => {
                console.error('[Mock Server] Error:', error);
                reject(error);
            });
        });
    }

    /**
     * Stop the HTTP server
     */
    async stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    console.log('[Mock Server] Stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Set custom handler for specific endpoint
     *
     * @example
     * mockServer.setHandler('POST', '/api/auth', (req, res, body) => {
     *   res.writeHead(401, { 'Content-Type': 'application/json' });
     *   res.end(JSON.stringify({ error: 'Unauthorized' }));
     * });
     */
    setHandler(method: string, path: string, handler: Function): void {
        this.handlers.set(`${method} ${path}`, handler);
    }

    /**
     * Reset all handlers to defaults
     */
    resetHandlers(): void {
        this.handlers.clear();
        this.setupDefaultHandlers();
    }

    /**
     * Get the server URL
     */
    getUrl(): string {
        return `http://localhost:${this.port}`;
    }

    /**
     * Handle incoming HTTP request
     */
    private handleRequest(req: IncomingMessage, res: ServerResponse): void {
        const url = req.url || '';
        const method = req.method || 'GET';

        console.log(`[Mock Server] ${method} ${url}`);

        // Enable CORS for all requests
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-FTL-SID, X-FTL-CSRF');

        // Handle preflight OPTIONS requests
        if (method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        // Find and execute handler
        const handler = this.findHandler(method, url);

        if (handler) {
            this.executeHandler(req, res, handler);
        } else {
            console.warn(`[Mock Server] No handler for ${method} ${url}`);
            res.writeHead(404, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({error: 'Not Found'}));
        }
    }

    /**
     * Setup default API handlers
     */
    private setupDefaultHandlers(): void {
        // Authentication endpoint
        this.handlers.set('POST /api/auth', (_req, res, body) => {
            const data = body ? JSON.parse(body) : {};

            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({
                session: {
                    valid: true,
                    sid: 'mock-session-id',
                    csrf: 'mock-csrf-token',
                    validity: 300,
                    totp: data.totp ? true : false,
                },
            }));
        });

        // Logout endpoint
        this.handlers.set('DELETE /api/auth', (_req, res) => {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({success: true}));
        });

        // Stats summary endpoint
        this.handlers.set('GET /api/stats/summary', (_req, res) => {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({
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
            }));
        });

        // Get blocking status
        this.handlers.set('GET /api/dns/blocking', (_req, res) => {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({
                blocking: 'enabled',
                timer: null,
            }));
        });

        // Set blocking status
        this.handlers.set('POST /api/dns/blocking', (_req, res, body) => {
            const data = JSON.parse(body);

            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({
                blocking: data.enabled ? 'enabled' : 'disabled',
                timer: data.timer || null,
            }));
        });

        // Query log endpoint
        this.handlers.set('GET /api/queries', (_req, res) => {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify([
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
            ]));
        });

        // Add to allowlist
        this.handlers.set('POST /api/domains/allow/exact', (_req, res) => {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({success: true}));
        });

        // Add to denylist
        this.handlers.set('POST /api/domains/deny/exact', (_req, res) => {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({success: true}));
        });

        // Remove from allowlist
        this.handlers.set('DELETE /api/domains/allow/exact', (_req, res) => {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({success: true}));
        });

        // Remove from denylist
        this.handlers.set('DELETE /api/domains/deny/exact', (_req, res) => {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({success: true}));
        });

        // Search domain
        this.handlers.set('GET /api/search/*', (req, _res) => {
            const domain = req.url?.split('/api/search/')[1] || '';
            const isBlocked = domain.includes('ads') || domain.includes('tracker');

            _res.writeHead(200, {'Content-Type': 'application/json'});
            _res.end(JSON.stringify({
                gravity: isBlocked,
                allowlist: false,
                denylist: false,
            }));
        });
    }

    /**
     * Find handler for method and URL
     */
    private findHandler(method: string, url: string): Function | undefined {
        const key = `${method} ${url}`;

        // Try exact match first
        if (this.handlers.has(key)) {
            return this.handlers.get(key);
        }

        // Try wildcard match
        for (const [pattern, handler] of this.handlers) {
            if (this.matchesPattern(method, url, pattern)) {
                return handler;
            }
        }

        return undefined;
    }

    /**
     * Check if URL matches pattern (supports wildcards)
     */
    private matchesPattern(method: string, url: string, pattern: string): boolean {
        const [patternMethod, patternPath] = pattern.split(' ');

        if (method !== patternMethod) {
            return false;
        }

        if (patternPath.includes('*')) {
            const regex = new RegExp('^' + patternPath.replace(/\*/g, '.*') + '$');
            return regex.test(url);
        }

        return url === patternPath;
    }

    /**
     * Execute handler with request body
     */
    private executeHandler(req: IncomingMessage, res: ServerResponse, handler: Function): void {
        let body = '';

        req.on('data', (chunk) => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                handler(req, res, body);
            } catch (error) {
                console.error('[Mock Server] Handler error:', error);
                res.writeHead(500, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({error: 'Internal Server Error'}));
            }
        });
    }
}
