// Tells the service worker what the user really clicked: the link href, or null for a
// click outside any link. Never touches the DOM, never stops an event.
function report(e) {
  if (!e.isTrusted) return;
  const link = e.composedPath().find((el) => el instanceof HTMLAnchorElement && el.href);
  try {
    chrome.runtime.sendMessage({ type: 'intent', href: link ? link.href : null }).catch(() => {});
  } catch {
    // extension reloaded: this orphaned content script can no longer talk to the worker
  }
}

for (const type of ['pointerdown', 'click', 'auxclick']) {
  window.addEventListener(type, report, true);
}
