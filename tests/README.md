# Test Suite Documentation

This directory contains comprehensive unit and E2E tests for the PiSentinel extension.

## Quick Start

```bash
# Install dependencies (if not already done)
npm install

# Run all tests
npm test

# Run tests in watch mode (recommended for development)
npm run test:watch

# Run tests with UI
npm run test:ui

# Generate coverage report
npm run test:coverage
```

## Test Organization

### Unit Tests

Unit tests are organized by feature/module:

- **`utils/`** - Utility function tests (formatting, domain parsing, message handling)
- **`background/`** - Background script tests (API client, state store, encryption)
- **`components/`** - Preact component tests (UI components)

### E2E Tests

E2E tests verify complete user workflows:

- **`e2e/extension.spec.ts`** - Extension loading, authentication, stats display
- **`e2e/domain-management.spec.ts`** - Domain management and query log

## Writing Tests

### Unit Test Example

```typescript
import {describe, it, expect} from 'vitest';
import {formatNumber} from '~/utils/utils';

describe('formatNumber', () => {
    it('should format thousands with K suffix', () => {
        expect(formatNumber(1500)).toBe('1.5K');
    });
});
```

### Component Test Example

```typescript
import {describe, it, expect} from 'vitest';
import {render, screen} from '@testing-library/preact';
import {StatsCard} from '~/entrypoints/popup/components/StatsCard';

describe('StatsCard', () => {
    it('should render label and value', () => {
        render(<StatsCard label = "Total"
        value = "100" / >
    )
        ;
        expect(screen.getByText('Total')).toBeTruthy();
    });
});
```

### Testing with Browser APIs

Browser APIs are mocked in `tests/setup.ts`. You can override them in individual tests:

```typescript
beforeEach(() => {
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
        success: true,
        data: {isConnected: true}
    });
});
```

## Test Configuration

### Vitest Configuration

See `vitest.config.ts` for the main configuration:

- **Environment**: `happy-dom` (lightweight DOM implementation)
- **Setup Files**: `tests/setup.ts` (global mocks and setup)
- **Coverage**: Configured to exclude tests, config files, and build artifacts

### Playwright Configuration

See `playwright.config.ts` for E2E test configuration:

- **Test Directory**: `tests/e2e`
- **Browser**: Firefox (extension's target browser)
- **Workers**: 1 (sequential execution for extension tests)

## Mocking

### Browser Extension APIs

The test setup provides mocks for common browser APIs:

```typescript
// Automatically available in tests
browser.runtime.sendMessage();
browser.storage.local.get();
browser.storage.session.set();
browser.alarms.create();
// etc.
```

### Fetch API

Global `fetch` is mocked via `vi.fn()`. Override it in your tests:

```typescript
fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({data: 'test'}),
});
```

### Crypto API

Web Crypto API is mocked in the setup file. Use `vi.spyOn` to customize:

```typescript
vi.spyOn(crypto.subtle, 'encrypt').mockResolvedValue(mockEncrypted);
```

## Debugging Tests

### Using Vitest UI

The Vitest UI provides a visual interface for running and debugging tests:

```bash
npm run test:ui
```

Then open the URL shown in the terminal (usually `http://localhost:51204/__vitest__/`).

### Debug Mode

Run tests with the `--inspect` flag to debug with Chrome DevTools:

```bash
npx vitest --inspect-brk
```

### Console Logs

Tests run in a real browser-like environment. Use `console.log()` to debug:

```typescript
it('should do something', () => {
    const result = someFunction();
    console.log('Result:', result); // Will appear in test output
    expect(result).toBe(expected);
});
```

## E2E Testing

E2E tests for browser extensions require special setup. The tests in `tests/e2e/` are currently **skipped** because they
need:

1. **Extension Loading**: Firefox extensions can't be automatically loaded in Playwright
2. **Manual Setup**: Use `web-ext` or load the extension manually in `about:debugging`

### Running E2E Tests Manually

1. Build the extension:
   ```bash
   npm run build:firefox
   ```

2. Load in Firefox:
    - Navigate to `about:debugging#/runtime/this-firefox`
    - Click "Load Temporary Add-on"
    - Select `dist/firefox-mv3/manifest.json`

3. Manually test the scenarios described in the E2E spec files

### Automating E2E Tests (Future)

To automate E2E tests, consider:

- Using `web-ext` CLI's testing features
- Selenium WebDriver with Firefox
- Custom test harness using Firefox remote debugging protocol

## Common Issues

### Import Path Errors

If you see "Failed to resolve import" errors, check:

1. The `~` alias is configured in `vitest.config.ts`
2. The path exists relative to the project root
3. File extensions are correct (`.ts`, `.tsx`)

### Browser API Not Mocked

If a browser API is not available, add it to `tests/setup.ts`:

```typescript
globalThis.browser = {
    // ... existing mocks ...
    newApi: {
        someMethod: vi.fn(),
    },
};
```

### Component Not Rendering

If Preact components don't render:

1. Check that `@preact/preset-vite` is configured in `vitest.config.ts`
2. Verify JSX imports are correct
3. Ensure component files use `.tsx` extension

### Fake Timers

When using fake timers with components:

```typescript
beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

it('should work with timers', async () => {
    render(<Component / >);

    // Wrap timer advances in act()
    await act(async () => {
        vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
        expect(screen.getByText('Updated')).toBeTruthy();
    });
});
```

## Coverage Reports

Coverage reports are generated in the `coverage/` directory:

```bash
# Generate coverage
npm run test:coverage

# Open HTML report
open coverage/index.html
```

### Coverage Goals

Aim for:

- **Lines**: >80%
- **Functions**: >80%
- **Branches**: >70%
- **Critical paths**: 100% (authentication, encryption, state management)

## Continuous Integration

Tests are designed to run in CI environments. Example GitHub Actions workflow:

```yaml
name: Tests

on: [ push, pull_request ]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test
      - run: npm run lint
```

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library for Preact](https://testing-library.com/docs/preact-testing-library/intro/)
- [Playwright Documentation](https://playwright.dev/)
- [web-ext Documentation](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)
