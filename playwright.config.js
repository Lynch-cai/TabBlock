import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  // The service worker can take seconds to react when the machine is busy.
  expect: { timeout: 15_000 },
  webServer: {
    command: 'node tests/e2e/server.js',
    url: 'http://127.0.0.1:4517/stream.html',
    reuseExistingServer: false,
  },
});
