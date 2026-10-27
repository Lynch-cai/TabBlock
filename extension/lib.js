// Pure logic shared by the service worker, the popup and the node tests. No chrome.* here.

export const INTENT_TTL_MS = 2000;

// ponytail: hostname suffix matching, no Public Suffix List. Sibling subdomains
// (a.site.com -> b.site.com) count as cross-site; add a PSL if that ever matters.
export function siteKey(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function isProtected(host, sites) {
  return !!host && sites.some((s) => host === s || host.endsWith('.' + s));
}

export function sameSite(a, b) {
  return !!a && !!b && (a === b || a.endsWith('.' + b) || b.endsWith('.' + a));
}

export function shouldAllowPopup({ sourceHost, targetUrl, intent, now }) {
  const target = siteKey(targetUrl);
  if (!target) return true;
  if (sameSite(target, sourceHost)) return true;
  if (!intent || now - intent.t > INTENT_TTL_MS) return false;
  return sameSite(siteKey(intent.href), target);
}

// Top-level navigation of a protected tab. A clicked link that goes through a server
// redirect (link shortener, /out?url=) may land anywhere, so any fresh link click allows it.
export function shouldAllowNavigation({ fromHost, targetUrl, intent, now, serverRedirect }) {
  if (shouldAllowPopup({ sourceHost: fromHost, targetUrl, intent, now })) return true;
  return serverRedirect && !!intent?.href && now - intent.t <= INTENT_TTL_MS;
}
