# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PiSentinel is a Firefox Manifest V3 extension for Pi-hole v6 integration. It monitors DNS blocking statistics, controls
blocking status, and manages domains directly from the browser.

**Key Technologies:**

- TypeScript (strict mode)
- Preact (lightweight React alternative)
- WXT + Vite (bundler)
- webextension-polyfill (cross-browser API compatibility)
- Firefox MV3 (Manifest V3)

## Directory Layout

```
/
├── background/          # Background modules
│   ├── api/             # Pi-hole v6 REST client, auth, types
│   ├── crypto/          # PBKDF2 + AES-256-GCM encryption
│   ├── services/        # Badge, notifications, domain tracker
│   └── state/           # Central state store
├── components/          # Shared UI components
├── entrypoints/         # WXT entry points
│   ├── background.ts    # Background script
│   ├── popup/           # Quick stats & blocking toggle
│   ├── sidebar/         # Per-tab domain list & query log
│   └── options/         # Server config & 2FA setup
├── public/              # Static assets (icons)
├── tests/               # Unit + E2E tests
└── utils/               # Shared messaging, types, constants, validation
```

## Quick Reference

```bash
bun install              # Install dependencies
bun run dev              # Watch mode (unminified + sourcemaps)
bun run build            # Production build
bun run lint             # ESLint
bun run lint:ext         # web-ext lint
bun run package          # Build + unsigned .xpi
```

## Detailed Documentation

Architecture, coding patterns, testing workflow, and debugging guides are in `.claude/rules/`:

- `architecture.md` — Message flow, state management, background structure, session/domain tracking
- `coding-patterns.md` — API integration, code examples, Firefox MV3 specifics
- `testing.md` — Build commands, dev workflow, testing changes
- `debugging.md` — Common issues and troubleshooting checklists
