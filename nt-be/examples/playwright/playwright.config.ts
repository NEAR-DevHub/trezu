import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 600_000,
  use: {
    headless: false,
    viewport: { width: 1400, height: 900 },
    // Use installed Chrome instead of bundled Chromium
    // This gives access to wallet extensions and existing sessions
    channel: "chrome",
  },
});
