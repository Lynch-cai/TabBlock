import { siteKey, isProtected } from './lib.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('fr-FR');

// ?tabId= lets the e2e tests open the popup in a tab of its own (it is then the active tab).
const tabIdParam = new URLSearchParams(location.search).get('tabId');
const tab = tabIdParam
  ? await chrome.tabs.get(Number(tabIdParam))
  : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
const host = siteKey(tab?.url);
const countKey = 'blocked:' + tab?.id;
// Firefox and Safari let the user withhold site access; without it content.js never runs here.
const origins = host ? [new URL(tab.url).origin + '/*'] : [];

function renderSites(protectedSites, siteCounts) {
  const items = [...protectedSites].sort().map((site) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'site-name';
    name.textContent = site;
    const count = document.createElement('span');
    const n = siteCounts[site] ?? 0;
    count.className = 'site-count';
    count.textContent = `${fmt(n)} bloqué${n > 1 ? 's' : ''}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = 'Retirer';
    remove.setAttribute('aria-label', `Retirer ${site}`);
    remove.addEventListener('click', () =>
      chrome.storage.local.set({ protectedSites: protectedSites.filter((s) => s !== site) }),
    );
    const text = document.createElement('div');
    text.className = 'site-text';
    text.append(name, count);
    li.append(text, remove);
    return li;
  });
  $('site-list').replaceChildren(...items);
  $('sites-empty').hidden = items.length > 0;
}

function showSites(show) {
  $('home').hidden = show;
  $('footer').hidden = show;
  $('sites-view').hidden = !show;
  (show ? $('back') : $('footer')).focus();
}

async function render() {
  const { protectedSites = [], totalBlocked = 0, siteCounts = {} } = await chrome.storage.local.get([
    'protectedSites',
    'totalBlocked',
    'siteCounts',
  ]);
  const { [countKey]: tabCount = 0 } = await chrome.storage.session.get(countKey);
  const on = isProtected(host, protectedSites);

  $('host').textContent = host ?? 'Page non supportée';
  $('counters').hidden = !host;
  $('tab-count').textContent = fmt(tabCount);
  $('total-count').textContent = fmt(totalBlocked);
  $('toggle').checked = on;
  $('toggle').disabled = !host;
  $('status').textContent = !host
    ? 'TabBlock ne peut pas agir sur cette page.'
    : on
      ? 'Protection activée'
      : 'Protection désactivée';
  $('status').classList.toggle('on', on);
  const n = protectedSites.length;
  $('footer').textContent = `${n} site${n > 1 ? 's' : ''} protégé${n > 1 ? 's' : ''}`;
  renderSites(protectedSites, siteCounts);
  $('grant').hidden = !host || (await chrome.permissions.contains({ origins }));
}

// permissions.request needs the user gesture: call it before any await.
$('grant').addEventListener('click', () => chrome.permissions.request({ origins }).then(render));

$('toggle').addEventListener('change', async (e) => {
  const { protectedSites = [] } = await chrome.storage.local.get('protectedSites');
  // Turning off also drops a parent entry (stream.to) that covers this subdomain.
  const next = e.target.checked
    ? [...protectedSites, host]
    : protectedSites.filter((s) => !isProtected(host, [s]));
  await chrome.storage.local.set({ protectedSites: next });
});

$('footer').addEventListener('click', () => showSites(true));
$('back').addEventListener('click', () => showSites(false));
chrome.storage.onChanged.addListener(render);
render();
