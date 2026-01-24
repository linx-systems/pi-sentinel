import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [preact()],
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "tests/", "**/*.config.*", "dist/", ".wxt/"],
    },
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "dist", ".wxt", "tests/e2e"],
    deps: {
      inline: [/webextension-polyfill/],
    },
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./"),
      "webextension-polyfill": path.resolve(
        __dirname,
        "./tests/__mocks__/webextension-polyfill.ts",
      ),
    },
  },
});
