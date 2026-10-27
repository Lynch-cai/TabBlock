import { test, expect, protect, totalBlocked, STREAM, OTHER } from './fixtures.js';

const openUrls = (context) => context.pages().map((p) => p.url());

// Clicking the player opens an ad that must be closed. Once the counter reaches `n`,
// every decision started before this click is settled too: it is a barrier, not a sleep.
async function adBarrier(page, serviceWorker, n) {
  await page.click('#player');
  await expect.poll(() => totalBlocked(serviceWorker)).toBe(n);
}

test.describe('site protege', () => {
  test.beforeEach(async ({ page, serviceWorker }) => {
    await protect(serviceWorker, ['localhost']);
    await page.goto(STREAM);
  });

  test('popunder du player ferme, le player recoit quand meme le clic', async ({ page, context, serviceWorker }) => {
    const before = context.pages().length;
    await page.click('#player');
    await expect.poll(() => totalBlocked(serviceWorker)).toBe(1);
    await expect.poll(() => context.pages().length).toBe(before);
    await expect(page.locator('#player')).toHaveAttribute('data-played', 'yes');
  });

  test('popup ouvert sur about:blank puis redirige vers la pub ferme', async ({ page, context, serviceWorker }) => {
    const before = context.pages().length;
    await page.click('#blank-popup');
    await expect.poll(() => totalBlocked(serviceWorker)).toBe(1);
    await expect.poll(() => context.pages().length).toBe(before);
  });

  test("popup lance depuis l'iframe cross-origin du lecteur ferme", async ({ page, context, serviceWorker }) => {
    const before = context.pages().length;
    await page.frameLocator('#player-frame').locator('#iframe-ad').click();
    await expect.poll(() => totalBlocked(serviceWorker)).toBe(1);
    await expect.poll(() => context.pages().length).toBe(before);
  });

  test('lien externe target=_blank clique reste ouvert', async ({ page, context, serviceWorker }) => {
    const [legit] = await Promise.all([context.waitForEvent('page'), page.click('#legit-blank')]);
    await legit.waitForLoadState();
    await adBarrier(page, serviceWorker, 1);
    expect(legit.isClosed()).toBe(false);
    expect(openUrls(context)).toContain(`${OTHER}/legit.html`);
  });

  test('lien interne target=_blank reste ouvert', async ({ page, context, serviceWorker }) => {
    const [same] = await Promise.all([context.waitForEvent('page'), page.click('#same-site')]);
    await same.waitForLoadState();
    await adBarrier(page, serviceWorker, 1);
    expect(same.isClosed()).toBe(false);
  });

  test('redirection JS cross-site annulee', async ({ page, serviceWorker }) => {
    await page.click('#redirect');
    await expect.poll(() => totalBlocked(serviceWorker)).toBe(1);
    await expect(page).toHaveURL(STREAM);
  });

  test('lien externe dans le meme onglet aboutit', async ({ page, serviceWorker }) => {
    await page.click('#legit-self');
    await expect(page).toHaveURL(`${OTHER}/legit.html`);
    await page.goBack();
    await adBarrier(page, serviceWorker, 1);
  });

  test("navigation directe (barre d'adresse) vers un autre site non annulee", async ({ page, serviceWorker }) => {
    await page.goto(`${OTHER}/legit.html`);
    await page.goBack();
    await adBarrier(page, serviceWorker, 1);
  });

  test('badge rouge avec le compteur sur l onglet', async ({ page, serviceWorker }) => {
    await adBarrier(page, serviceWorker, 1);
    const badge = await serviceWorker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'http://localhost:4517/*' });
      return chrome.action.getBadgeText({ tabId: tab.id });
    });
    expect(badge).toBe('1');
  });
});

test('site non protege : la pub reste ouverte', async ({ page, context, serviceWorker }) => {
  await page.goto(STREAM);
  const [ad] = await Promise.all([context.waitForEvent('page'), page.click('#player')]);
  await ad.waitForLoadState();
  expect(ad.isClosed()).toBe(false);
  expect(await totalBlocked(serviceWorker)).toBe(0);
});

const SHOTS = 'test-results/popup-shots';

async function streamTabId(serviceWorker) {
  return serviceWorker.evaluate(async () => (await chrome.tabs.query({ url: 'http://localhost:4517/*' }))[0].id);
}

const protectedSites = (serviceWorker) =>
  serviceWorker.evaluate(async () => (await chrome.storage.local.get('protectedSites')).protectedSites ?? []);

test('popup : le switch protege puis libere le site courant', async ({ page, context, serviceWorker, extensionId }) => {
  await page.goto(STREAM);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${await streamTabId(serviceWorker)}`);
  await expect(popup.locator('#host')).toHaveText('localhost');
  const toggle = popup.getByRole('switch', { name: 'Protection sur ce site' });
  await expect(toggle).not.toBeChecked();

  await toggle.check();
  await expect.poll(() => protectedSites(serviceWorker)).toEqual(['localhost']);
  await expect(popup.locator('#status')).toHaveText('Protection activée');

  await adBarrier(page, serviceWorker, 1);
  await expect(popup.locator('#tab-count')).toHaveText('1');
  await expect(popup.locator('#total-count')).toHaveText('1');
  await expect(popup.locator('#footer')).toHaveText('1 site protégé');

  await toggle.uncheck();
  await expect.poll(() => protectedSites(serviceWorker)).toEqual([]);
  await expect(popup.locator('#status')).toHaveText('Protection désactivée');
});

test('popup : page non supportee', async ({ context, extensionId, serviceWorker }) => {
  const blankId = await serviceWorker.evaluate(async () => (await chrome.tabs.query({ url: 'about:blank' }))[0]?.id
    ?? (await chrome.tabs.create({ url: 'about:blank' })).id);
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 320, height: 420 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${blankId}`);
  await expect(popup.locator('#host')).toHaveText('Page non supportée');
  await expect(popup.getByRole('switch')).toBeDisabled();
  await expect(popup.locator('#counters')).toBeHidden();
  await popup.screenshot({ path: `${SHOTS}/unsupported.png`, animations: 'disabled' });
});

for (const colorScheme of ['light', 'dark']) {
  test(`popup : capture ${colorScheme}`, async ({ page, context, serviceWorker, extensionId }) => {
    await protect(serviceWorker, ['localhost']);
    await page.goto(STREAM);
    await adBarrier(page, serviceWorker, 1);
    const popup = await context.newPage();
    await popup.emulateMedia({ colorScheme });
    await popup.setViewportSize({ width: 320, height: 420 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${await streamTabId(serviceWorker)}`);
    await expect(popup.locator('#tab-count')).toHaveText('1');
    await popup.screenshot({ path: `${SHOTS}/protected-${colorScheme}.png`, animations: 'disabled' });
    await popup.getByRole('switch').uncheck();
    await expect(popup.locator('#status')).toHaveText('Protection désactivée');
    await popup.screenshot({ path: `${SHOTS}/off-${colorScheme}.png`, animations: 'disabled' });
  });
}

test('popup : ecran des sites proteges, compteur par site et retrait', async ({ page, context, serviceWorker, extensionId }) => {
  await protect(serviceWorker, ['localhost', 'stream.example']);
  await page.goto(STREAM);
  await adBarrier(page, serviceWorker, 1);

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 320, height: 420 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${await streamTabId(serviceWorker)}`);
  await expect(popup.locator('#footer')).toHaveText('2 sites protégés');
  await popup.locator('#footer').click();

  const items = popup.locator('#site-list li');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('localhost');
  await expect(items.nth(0)).toContainText('1 bloqué');
  await expect(items.nth(1)).toContainText('stream.example');
  await expect(items.nth(1)).toContainText('0 bloqué');
  await expect(popup.getByRole('button', { name: 'Retour' })).toBeFocused();
  for (const colorScheme of ['light', 'dark']) {
    await popup.emulateMedia({ colorScheme });
    await popup.screenshot({ path: `${SHOTS}/sites-${colorScheme}.png`, animations: 'disabled' });
  }

  await popup.getByRole('button', { name: 'Retirer stream.example' }).click();
  await expect(items).toHaveCount(1);
  await expect.poll(() => protectedSites(serviceWorker)).toEqual(['localhost']);

  await popup.getByRole('button', { name: 'Retirer localhost' }).click();
  await expect(popup.locator('#sites-empty')).toBeVisible();
  await popup.emulateMedia({ colorScheme: 'light' });
  await popup.screenshot({ path: `${SHOTS}/sites-empty.png`, animations: 'disabled' });

  await popup.getByRole('button', { name: 'Retour' }).click();
  await expect(popup.locator('#footer')).toHaveText('0 site protégé');
  await expect(popup.getByRole('switch')).not.toBeChecked();
});

test('popup : lien de soutien Ko-fi', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const donate = popup.getByRole('link', { name: 'Soutenir' });
  await expect(donate).toHaveAttribute('href', 'https://ko-fi.com/lynch_');
  await expect(donate).toHaveAttribute('target', '_blank');
});

test('popup : lien vers le code source GitHub', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const source = popup.getByRole('link', { name: 'Code source sur GitHub' });
  await expect(source).toHaveAttribute('href', 'https://github.com/Lynch-cai/TabBlock');
  await expect(source).toHaveAttribute('target', '_blank');
});
