import { test as base, chromium, expect } from '@playwright/test';
import path from 'node:path';

const pathToExtension = path.join(import.meta.dirname, '../../extension');

export const STREAM = 'http://localhost:4517/stream.html';
export const OTHER = 'http://127.0.0.1:4517';

export const test = base.extend({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${pathToExtension}`, `--load-extension=${pathToExtension}`],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(serviceWorker.url().split('/')[2]);
  },
});

export function protect(serviceWorker, sites) {
  return serviceWorker.evaluate((s) => chrome.storage.local.set({ protectedSites: s }), sites);
}

export async function totalBlocked(serviceWorker) {
  const { totalBlocked = 0 } = await serviceWorker.evaluate(() => chrome.storage.local.get('totalBlocked'));
  return totalBlocked;
}

export { expect };
