import { vi } from "vitest";
import mockBrowser from "./__mocks__/webextension-polyfill";

// Set up global browser mock
globalThis.browser = mockBrowser as any;

// Also mock chrome for compatibility
globalThis.chrome = mockBrowser as any;

// Setup fetch mock
global.fetch = vi.fn();

// Setup crypto mock for tests
const cryptoMock = {
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

if (typeof globalThis.crypto === "undefined") {
  Object.defineProperty(globalThis, "crypto", {
    value: cryptoMock,
    writable: true,
  });
}
