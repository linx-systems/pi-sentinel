import { defineConfig } from "wxt";
import preact from "@preact/preset-vite";

export default defineConfig({
  outDir: "dist",

  vite: () => ({
    plugins: [preact()],
  }),

  manifest: {
    name: "PiSentinel",
    version: "0.0.1",
    description: "Pi-hole v6 companion - monitor and control DNS blocking",

    browser_specific_settings: {
      gecko: {
        id: "pisentinel@rooki.xyz",
        strict_min_version: "142.0",
        data_collection_permissions: {
          required: ["none"],
        },
      },
    },

    permissions: ["storage", "alarms", "notifications", "webRequest"],

    host_permissions: ["<all_urls>"],

    icons: {
      16: "/icons/icon-16.png",
      32: "/icons/icon-32.png",
      48: "/icons/icon-48.png",
      96: "/icons/icon-96.png",
    },

    action: {
      default_icon: {
        16: "/icons/icon-16.png",
        32: "/icons/icon-32.png",
        48: "/icons/icon-48.png",
      },
      default_title: "PiSentinel",
    },

    sidebar_action: {
      default_panel: "sidebar.html",
      default_icon: {
        16: "/icons/icon-16.png",
        32: "/icons/icon-32.png",
      },
      default_title: "PiSentinel Domains",
    },

    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },

    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  },

  browser: "firefox",
  manifestVersion: 3,
});
