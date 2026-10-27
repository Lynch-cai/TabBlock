import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteKey, isProtected, sameSite, shouldAllowPopup, shouldAllowNavigation, INTENT_TTL_MS } from '../../extension/lib.js';

test('siteKey', () => {
  assert.equal(siteKey('https://www.stream.to/watch?v=1'), 'stream.to');
  assert.equal(siteKey('http://localhost:4517/stream.html'), 'localhost');
  assert.equal(siteKey('https://cdn.stream.to'), 'cdn.stream.to');
  assert.equal(siteKey('chrome://extensions'), null);
  assert.equal(siteKey('about:blank'), null);
  assert.equal(siteKey('pas une url'), null);
  assert.equal(siteKey(undefined), null);
});

test('isProtected', () => {
  assert.equal(isProtected('stream.to', ['stream.to']), true);
  assert.equal(isProtected('cdn.stream.to', ['stream.to']), true);
  assert.equal(isProtected('notstream.to', ['stream.to']), false);
  assert.equal(isProtected('stream.to', []), false);
  assert.equal(isProtected(null, ['stream.to']), false);
});

test('sameSite', () => {
  assert.equal(sameSite('stream.to', 'stream.to'), true);
  assert.equal(sameSite('a.stream.to', 'stream.to'), true);
  assert.equal(sameSite('stream.to', 'a.stream.to'), true);
  assert.equal(sameSite('ads.com', 'stream.to'), false);
  assert.equal(sameSite('localhost', '127.0.0.1'), false);
  assert.equal(sameSite(null, 'stream.to'), false);
});

test('shouldAllowPopup', () => {
  const base = { sourceHost: 'stream.to', now: 10_000 };
  assert.equal(shouldAllowPopup({ ...base, targetUrl: 'about:blank' }), true);
  assert.equal(shouldAllowPopup({ ...base, targetUrl: 'https://stream.to/ep2' }), true);
  assert.equal(shouldAllowPopup({ ...base, targetUrl: 'https://ads.com/x' }), false);
  const intent = { href: 'https://ads.com/x', t: 10_000 - 100 };
  assert.equal(shouldAllowPopup({ ...base, targetUrl: 'https://ads.com/y', intent }), true);
  assert.equal(shouldAllowPopup({ ...base, targetUrl: 'https://other.com/', intent }), false);
  const expired = { ...intent, t: 10_000 - INTENT_TTL_MS - 1 };
  assert.equal(shouldAllowPopup({ ...base, targetUrl: 'https://ads.com/y', intent: expired }), false);
  assert.equal(shouldAllowPopup({ ...base, targetUrl: 'https://ads.com/y', intent: { href: null, t: 10_000 } }), false);
});

test('shouldAllowNavigation', () => {
  const base = { fromHost: 'stream.to', now: 10_000, serverRedirect: false };
  assert.equal(shouldAllowNavigation({ ...base, targetUrl: 'https://ads.com/' }), false);
  assert.equal(shouldAllowNavigation({ ...base, targetUrl: 'https://stream.to/ep2' }), true);
  const linkClick = { href: 'https://stream.to/out?u=x', t: 9_900 };
  assert.equal(shouldAllowNavigation({ ...base, targetUrl: 'https://x.com/', intent: linkClick }), false);
  assert.equal(shouldAllowNavigation({ ...base, serverRedirect: true, targetUrl: 'https://x.com/', intent: linkClick }), true);
  const playerClick = { href: null, t: 9_900 };
  assert.equal(shouldAllowNavigation({ ...base, serverRedirect: true, targetUrl: 'https://ads.com/', intent: playerClick }), false);
});
