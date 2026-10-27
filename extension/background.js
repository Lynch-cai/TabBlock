import { siteKey, isProtected, shouldAllowNavigation } from './lib.js';

// ponytail: popups are closed after they open (the ad tab may flash briefly). Patching
// window.open would miss popups fired from cross-origin player iframes.
const intents = new Map(); // tabId -> { href, t } : last real click in that tab
const pending = new Map(); // tabId -> { sourceTabId, sourceHost } : popup opened on about:blank
// Popups judged again on every redirect: a same-site popup (api.site.com/go?...) can
// redirect to the ad. Dropped once the popup settles and the user navigates in it.
const popups = new Map(); // tabId -> { sourceTabId, sourceHost, committed }
const INTENT_RACE_MS = 150;

chrome.action.setBadgeBackgroundColor({ color: '#C8291F' });

async function protectedHost(url) {
  const host = siteKey(url);
  const { protectedSites = [] } = await chrome.storage.local.get('protectedSites');
  return isProtected(host, protectedSites) ? host : null;
}

// host is the protected page's host; its count goes to the protectedSites entry covering it.
async function countBlocked(tabId, host) {
  const key = 'blocked:' + tabId;
  const { [key]: n = 0 } = await chrome.storage.session.get(key);
  const { totalBlocked = 0, protectedSites = [], siteCounts = {} } = await chrome.storage.local.get([
    'totalBlocked',
    'protectedSites',
    'siteCounts',
  ]);
  const site = protectedSites.find((s) => isProtected(host, [s])) ?? host;
  await chrome.storage.session.set({ [key]: n + 1 });
  await chrome.storage.local.set({
    totalBlocked: totalBlocked + 1,
    siteCounts: { ...siteCounts, [site]: (siteCounts[site] ?? 0) + 1 },
  });
  await chrome.action.setBadgeText({ tabId, text: String(n + 1) }).catch(() => {});
}

// The click message can land just after the navigation event: give it one more chance.
async function allowedAfterRace(check) {
  if (check()) return true;
  await new Promise((r) => setTimeout(r, INTENT_RACE_MS));
  return check();
}

async function decidePopup(tabId, sourceTabId, sourceHostPromise, url, serverRedirect = false) {
  const sourceHost = await sourceHostPromise;
  if (!sourceHost) return;
  const check = () =>
    shouldAllowNavigation({
      fromHost: sourceHost,
      targetUrl: url,
      intent: intents.get(sourceTabId),
      now: Date.now(),
      serverRedirect,
    });
  if (await allowedAfterRace(check)) return;
  // Creation and commit can both decide the same popup: only the remove that succeeds counts.
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    return;
  }
  await countBlocked(sourceTabId, sourceHost);
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'intent' && sender.tab) {
    intents.set(sender.tab.id, { href: msg.href, t: Date.now() });
  }
});

// Kept synchronous: for window.open('') the popup's next onBeforeNavigate can fire
// before any await here resolves, so `pending` must be filled right away.
chrome.webNavigation.onCreatedNavigationTarget.addListener(({ sourceTabId, tabId, url }) => {
  const sourceHost = chrome.tabs.get(sourceTabId).then((t) => protectedHost(t.url), () => null);
  popups.set(tabId, { sourceTabId, sourceHost, committed: false });
  if (!url || url === 'about:blank') {
    pending.set(tabId, { sourceTabId, sourceHost });
    return;
  }
  decidePopup(tabId, sourceTabId, sourceHost, url);
});

chrome.webNavigation.onBeforeNavigate.addListener(({ tabId, frameId, url }) => {
  if (frameId !== 0) return;
  const p = pending.get(tabId);
  if (p && url === 'about:blank') return; // Chrome reports the blank document first
  if (p) {
    pending.delete(tabId);
    decidePopup(tabId, p.sourceTabId, p.sourceHost, url);
  }
});

chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url, transitionType, transitionQualifiers }) => {
  if (frameId !== 0) return;
  // Previous committed URL, kept in session storage: tab.url is already the new page by
  // now, and an in-memory map would not survive a service worker restart.
  const key = 'url:' + tabId;
  const { [key]: fromUrl } = await chrome.storage.session.get(key);
  await chrome.storage.session.set({ [key]: url });
  const popup = popups.get(tabId);
  const serverRedirect = transitionQualifiers.includes('server_redirect');
  if (popup && url !== 'about:blank') {
    if (!popup.committed || serverRedirect || transitionQualifiers.includes('client_redirect')) {
      popup.committed = true;
      return decidePopup(tabId, popup.sourceTabId, popup.sourceHost, url, serverRedirect);
    }
    popups.delete(tabId);
  }
  const fromHost = await protectedHost(fromUrl);
  if (!fromHost || transitionType !== 'link' || transitionQualifiers.includes('forward_back')) return;
  const check = () =>
    shouldAllowNavigation({
      fromHost,
      targetUrl: url,
      intent: intents.get(tabId),
      now: Date.now(),
      serverRedirect,
    });
  if (await allowedAfterRace(check)) return;
  await chrome.tabs.goBack(tabId).catch(() => {});
  await countBlocked(tabId, fromHost);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  intents.delete(tabId);
  pending.delete(tabId);
  popups.delete(tabId);
  chrome.storage.session.remove(['blocked:' + tabId, 'url:' + tabId]);
});
