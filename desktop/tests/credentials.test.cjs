'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { CredentialVault } = require('../credentials.cjs');

async function fixture(t) {
  const fixturesRoot = path.resolve(__dirname, '../release/test-vaults');
  await fs.mkdir(fixturesRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(fixturesRoot, 'vault-'));
  t.after(() => { if (!root.startsWith(`${fixturesRoot}${path.sep}`)) throw new Error('Unsafe fixture cleanup path.'); return fs.rm(root, { force: true, recursive: true }); });
  let cookies = [];
  const writes = [];
  const safeStorage = { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async value => Buffer.from(`TEST-ENCRYPTED:${value}`), decryptStringAsync: async value => ({ result: value.toString().replace(/^TEST-ENCRYPTED:/, ''), shouldReEncrypt: false }) };
  const vault = new CredentialVault({ safeStorage, cookies: { get: async () => cookies, set: async value => { writes.push(value); } }, filename: path.join(root, 'credentials.bin'), origin: 'https://relay.example.com' });
  return { vault, safeStorage, writes, filename: path.join(root, 'credentials.bin'), setCookies: value => { cookies = value; } };
}
test('only Supabase session cookies enter the encrypted vault; logout deletes it', async t => {
  const fx = await fixture(t);
  fx.setCookies([{ name: 'sb-test-auth-token', value: 'test-session' }, { name: 'analytics', value: 'do-not-persist' }]);
  await fx.vault.flush();
  const text = (await fs.readFile(fx.filename)).toString();
  assert.ok(text.startsWith('TEST-ENCRYPTED:'));
  assert.ok(text.includes('test-session'));
  assert.ok(!text.includes('analytics'));
  fx.setCookies([]);
  await fx.vault.flush();
  await assert.rejects(fs.readFile(fx.filename), { code: 'ENOENT' });
});
test('restore rejects cross-origin vaults and expired/non-auth cookies', async t => {
  const fx = await fixture(t);
  const write = async data => fs.writeFile(fx.filename, await fx.safeStorage.encryptStringAsync(JSON.stringify(data)));
  await write({ origin: 'https://evil.test', cookies: [{ name: 'sb-test-auth-token', value: 'secret' }] });
  await fx.vault.restore();
  assert.equal(fx.writes.length, 0);
  await write({ origin: 'https://relay.example.com', cookies: [{ name: 'sb-test-auth-token', value: 'secret', expirationDate: 1 }, { name: 'unrelated', value: 'secret' }, { name: 'sb-test-auth-token.0', value: 'valid', expirationDate: Date.now() / 1000 + 600 }] });
  await fx.vault.restore();
  assert.equal(fx.writes.length, 1);
  assert.equal(fx.writes[0].secure, true);
  assert.equal(fx.writes[0].sameSite, 'lax');
  assert.equal(fx.writes[0].url, 'https://relay.example.com');
});
test('encryption unavailability never falls back to a plaintext credential file', async t => {
  const fx = await fixture(t);
  fx.safeStorage.isAsyncEncryptionAvailable = async () => false;
  fx.setCookies([{ name: 'sb-test-auth-token', value: 'secret' }]);
  await fx.vault.flush();
  await assert.rejects(fs.readFile(fx.filename), { code: 'ENOENT' });
  await assert.rejects(fx.vault.restore(), /encryption is unavailable/);
});
