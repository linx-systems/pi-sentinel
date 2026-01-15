import {vi} from 'vitest';

// Mock browser API
globalThis.browser = {
    runtime: {
        sendMessage: vi.fn(),
        onMessage: {
            addListener: vi.fn(),
            removeListener: vi.fn(),
        },
        id: 'test-extension-id',
    },
    storage: {
        local: {
            get: vi.fn(),
            set: vi.fn(),
            remove: vi.fn(),
        },
        session: {
            get: vi.fn(),
            set: vi.fn(),
            remove: vi.fn(),
        },
    },
    alarms: {
        create: vi.fn(),
        clear: vi.fn(),
        getAll: vi.fn(),
        onAlarm: {
            addListener: vi.fn(),
        },
    },
    tabs: {
        query: vi.fn(),
        get: vi.fn(),
    },
    webRequest: {
        onBeforeRequest: {
            addListener: vi.fn(),
            removeListener: vi.fn(),
        },
    },
    action: {
        setBadgeText: vi.fn(),
        setBadgeBackgroundColor: vi.fn(),
    },
    notifications: {
        create: vi.fn(),
    },
} as any;

// Setup fetch mock
global.fetch = vi.fn();

// Setup crypto mock for tests
const crypto = {
    getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) {
            arr[i] = Math.floor(Math.random() * 256);
        }
        return arr;
    },
    subtle: {
        importKey: vi.fn(),
        encrypt: vi.fn(),
        decrypt: vi.fn(),
        deriveBits: vi.fn(),
    },
};

if (typeof globalThis.crypto === 'undefined') {
    Object.defineProperty(globalThis, 'crypto', {
        value: crypto,
        writable: true,
    });
}
