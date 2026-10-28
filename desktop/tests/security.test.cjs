'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applicationOrigin, sameOrigin, safeWebPath, deepLinkTarget, notificationPayload, safeDownloadName, trustedSender } = require('../security.cjs');
const origin = 'https://relay.example.com';
const uuid = 'd8ed4c90-4061-4bec-bef4-45a9ea13e83e';

test('only explicit HTTPS application origins are trusted in production', () => {
  assert.equal(applicationOrigin(origin), origin);
  for (const url of ['http://relay.example.com', 'file:///C:/Windows', 'https://relay.example.com.evil.test', 'javascript:alert(1)']) {
    if (url.includes('.evil.')) assert.equal(sameOrigin(url, origin), false); else assert.throws(() => applicationOrigin(url));
  }
  assert.throws(() => applicationOrigin('https://user:password@relay.example.com'));
  assert.throws(() => applicationOrigin(`${origin}/path`));
  assert.throws(() => applicationOrigin('http://localhost:3000'));
  assert.equal(sameOrigin(`blob:${origin}/opaque-document`, origin), false);
  assert.equal(applicationOrigin('http://localhost:3000', { development: true }), 'http://localhost:3000');
  assert.throws(() => applicationOrigin('http://example.com', { development: true }));
});
test('deep links cannot change origin or smuggle authentication credentials', () => {
  assert.equal(deepLinkTarget(`relay://open?workspace=${uuid}&conversation=${uuid}`, origin), `${origin}/?workspace=${uuid}&conversation=${uuid}`);
  for (const url of [`relay://evil?workspace=${uuid}`, `relay://open?workspace=${uuid}&conversation=../../evil`, 'relay://open?workspace=bad', `relay://open/evil?workspace=${uuid}`, `https://relay.example.com?workspace=${uuid}`, `relay://user:password@open?workspace=${uuid}`, `relay://open?workspace=${uuid}#code=secret`]) assert.equal(deepLinkTarget(url, origin), null);
  assert.equal(deepLinkTarget(`relay://open?workspace=${uuid}&url=https://evil.test&code=secret`, origin), `${origin}/?workspace=${uuid}`);
});
test('notification navigation remains inside the trusted application', () => {
  for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', '/\n/evil.test']) assert.equal(safeWebPath(value), '/');
  assert.equal(safeWebPath('/?workspace=abc'), '/?workspace=abc');
  assert.throws(() => notificationPayload({ title: 'a'.repeat(121), body: '' }));
  assert.throws(() => notificationPayload({ title: {}, body: '' }));
  assert.equal(notificationPayload({ title: 'Hello\u0000', body: 'Body', path: '//evil.test' }).path, '/');
});
test('download names cannot escape the chosen directory or target Windows devices', () => {
  assert.equal(safeDownloadName('../../evil.exe'), '.._.._evil.exe');
  assert.equal(safeDownloadName('CON.txt'), 'relay-CON.txt');
  assert.equal(safeDownloadName('notes.txt. '), 'notes.txt');
  assert.equal(safeDownloadName(''), 'download');
});
test('IPC accepts only the main frame of the expected window and origin', () => {
  const frame = { url: `${origin}/?workspace=${uuid}` };
  const webContents = { mainFrame: frame };
  const window = { isDestroyed: () => false, webContents };
  assert.equal(trustedSender({ sender: webContents, senderFrame: frame }, window, origin), true);
  assert.equal(trustedSender({ sender: webContents, senderFrame: { url: origin } }, window, origin), false);
  assert.equal(trustedSender({ sender: {}, senderFrame: frame }, window, origin), false);
  frame.url = 'https://relay.example.com.evil.test';
  assert.equal(trustedSender({ sender: webContents, senderFrame: frame }, window, origin), false);
});
