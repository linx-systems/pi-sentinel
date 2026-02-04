# @pisentinel/pihole-api

Type-safe TypeScript client for the Pi-hole v6 REST API.

## Features

- Complete coverage of Pi-hole v6 API (~80 endpoints)
- Type-safe with full TypeScript support
- Result type for explicit error handling (no exceptions)
- Automatic session management with auto-refresh
- Retry with exponential backoff
- Zero runtime dependencies
- Works in Node.js 18+ and browsers

## Installation

```bash
npm install @pisentinel/pihole-api
# or
bun add @pisentinel/pihole-api
```

## Quick Start

```typescript
import { PiholeClient, isOk, isErr } from "@pisentinel/pihole-api";

const client = new PiholeClient({
  baseUrl: "http://pi.hole",
  password: "your-password",
});

// Get statistics
const statsResult = await client.stats.getSummary();
if (isOk(statsResult)) {
  console.log("Blocked queries:", statsResult.data.queries.blocked);
}

// Disable blocking for 5 minutes
const blockingResult = await client.dns.disable(300);
if (isErr(blockingResult)) {
  console.error("Failed to disable:", blockingResult.error.message);
}

// Add domain to denylist
await client.domains.deny("ads.example.com");

// Get query log
const queries = await client.queries.list({ length: 100 });
```

## API Reference

### Client Configuration

```typescript
const client = new PiholeClient({
  // Required
  baseUrl: "http://pi.hole", // Pi-hole server URL

  // Authentication (one of these)
  password: "your-password", // Plain password (auto-authenticates)
  // or provide session tokens directly
  sid: "session-id",
  csrf: "csrf-token",

  // Optional
  timeout: 10000, // Request timeout in ms (default: 10000)
  maxRetries: 3, // Max retry attempts (default: 3)
  autoRefresh: true, // Auto-refresh sessions (default: true)
});
```

### Result Type

All methods return `Result<T, PiholeError>`:

```typescript
type Result<T, E = PiholeError> =
  | { ok: true; data: T }
  | { ok: false; error: E };

// Helper functions
isOk(result); // Type guard for success
isErr(result); // Type guard for error
unwrap(result); // Returns data or throws
unwrapOr(result, defaultValue); // Returns data or default
```

### Available Endpoints

#### Authentication (`client.auth`)

```typescript
await client.auth.login(password, totp?);
await client.auth.logout();
await client.auth.check();
await client.auth.getSessions();
await client.auth.deleteSession(id);
await client.auth.generateTotp();
await client.auth.createAppPassword();
```

#### DNS Control (`client.dns`)

```typescript
await client.dns.getStatus();
await client.dns.enable();
await client.dns.disable(seconds?);
await client.dns.setBlocking(enabled, timer?);
```

#### Statistics (`client.stats`)

```typescript
await client.stats.getSummary();
await client.stats.getUpstreams();
await client.stats.getTopDomains(count?, blocked?);
await client.stats.getTopClients(count?, blocked?);
await client.stats.getQueryTypes();
await client.stats.getRecentBlocked();
// Database variants available with .database prefix
```

#### History (`client.history`)

```typescript
await client.history.get(from?, until?);
await client.history.getClients(from?, until?);
// Database variants available
```

#### Queries (`client.queries`)

```typescript
await client.queries.list({ length, from, until, client, domain, type, status });
await client.queries.getSuggestions();
```

#### Domain Management (`client.domains`)

```typescript
// Denylist
await client.domains.deny(domain, comment?);
await client.domains.undeny(domain);
await client.domains.getDenylist();

// Allowlist
await client.domains.allow(domain, comment?);
await client.domains.unallow(domain);
await client.domains.getAllowlist();

// Regex variants
await client.domains.denyRegex(pattern);
await client.domains.allowRegex(pattern);

// Generic CRUD
await client.domains.list(type, kind);
await client.domains.add(type, kind, domain, options?);
await client.domains.update(type, kind, domain, options);
await client.domains.remove(type, kind, domain);
await client.domains.batchDelete(items);

// Search
await client.domains.search(domain);
```

#### Groups (`client.groups`)

```typescript
await client.groups.list();
await client.groups.create(name, options?);
await client.groups.update(name, options);
await client.groups.delete(name);
await client.groups.batchDelete(names);
```

#### Clients (`client.clients`)

```typescript
await client.clients.list();
await client.clients.create(client, options?);
await client.clients.update(client, options);
await client.clients.delete(client);
await client.clients.getSuggestions();
await client.clients.batchDelete(clients);
```

#### Lists/Adlists (`client.lists`)

```typescript
await client.lists.list();
await client.lists.add(address, options?);
await client.lists.update(id, options);
await client.lists.delete(id);
await client.lists.batchDelete(ids);
```

#### DHCP (`client.dhcp`)

```typescript
await client.dhcp.getLeases();
await client.dhcp.deleteLease(ip);
```

#### Configuration (`client.config`)

```typescript
await client.config.get();
await client.config.getSection(element);
await client.config.update(changes);
await client.config.addArrayItem(element, value);
await client.config.removeArrayItem(element, value);
```

#### System Info (`client.info`)

```typescript
await client.info.getClient();
await client.info.getSystem();
await client.info.getHost();
await client.info.getFtl();
await client.info.getSensors();
await client.info.getDatabase();
await client.info.getVersion();
await client.info.getMetrics();
await client.info.getLogin();
await client.info.getMessages();
await client.info.getMessageCount();
await client.info.deleteMessage(id);
```

#### Network (`client.network`)

```typescript
await client.network.getGateway();
await client.network.getRoutes();
await client.network.getInterfaces();
await client.network.getDevices();
await client.network.deleteDevice(id);
```

#### Actions (`client.actions`)

```typescript
await client.actions.updateGravity();
await client.actions.restartDns();
await client.actions.flushLogs();
await client.actions.flushArp();
await client.actions.flushNetwork();
```

#### Logs (`client.logs`)

```typescript
await client.logs.getDnsmasq(lines?);
await client.logs.getFtl(lines?);
await client.logs.getWebserver(lines?);
```

#### Teleporter (`client.teleporter`)

```typescript
await client.teleporter.export();
await client.teleporter.import(data);
```

#### Other

```typescript
await client.getEndpoints();
```

## Error Handling

```typescript
import { PiholeErrorCode } from "@pisentinel/pihole-api";

const result = await client.dns.disable();

if (isErr(result)) {
  switch (result.error.code) {
    case PiholeErrorCode.Unauthorized:
      // Handle auth error
      break;
    case PiholeErrorCode.NetworkError:
      // Handle network error
      break;
    case PiholeErrorCode.Timeout:
      // Handle timeout
      break;
    default:
      console.error(result.error.message);
  }
}
```

## License

MIT
