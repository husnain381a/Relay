'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

// Only the trusted application's Supabase auth cookies are persisted. Renderer
// localStorage, arbitrary cookies and passwords are never copied to this vault.
class CredentialVault {
  constructor({ safeStorage, cookies, filename, origin }) {
    this.safeStorage = safeStorage;
    this.cookies = cookies;
    this.filename = filename;
    this.origin = origin;
    this.timer = null;
    this.pending = Promise.resolve();
    this.restoring = false;
  }
  async available() {
    return this.safeStorage.isAsyncEncryptionAvailable();
  }
  async restore() {
    if (!(await this.available())) throw new Error('Windows credential encryption is unavailable. Sign in for this session only.');
    let buffer;
    try { buffer = await fs.readFile(this.filename); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const decrypted = await this.safeStorage.decryptStringAsync(buffer);
    const value = JSON.parse(decrypted.result);
    if (value.origin !== this.origin || !Array.isArray(value.cookies) || value.cookies.length > 64) return;
    this.restoring = true;
    try {
      for (const cookie of value.cookies) {
        if (typeof cookie.name !== 'string' || !/^sb-[a-z0-9-]+-auth-token(?:\.\d+)?$/.test(cookie.name) || typeof cookie.value !== 'string' || cookie.value.length > 16384) continue;
        if (cookie.expirationDate && cookie.expirationDate <= Date.now() / 1000) continue;
        await this.cookies.set({ url: this.origin, name: cookie.name, value: cookie.value, path: '/', secure: this.origin.startsWith('https:'), httpOnly: Boolean(cookie.httpOnly), sameSite: 'lax', ...(cookie.expirationDate ? { expirationDate: cookie.expirationDate } : {}) });
      }
    } finally { this.restoring = false; }
    if (decrypted.shouldReEncrypt) await this.flush();
  }
  schedule() {
    if (this.restoring) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.flush().catch(error => { console.error(JSON.stringify({ event: 'credential-persistence-failed', error: String(error.message || error).slice(0, 200) })); }); }, 250);
  }
  async flush() {
    clearTimeout(this.timer);
    this.pending = this.pending.catch(() => {}).then(async () => {
      if (!(await this.available())) return;
      const cookies = (await this.cookies.get({ url: this.origin })).filter(cookie => /^sb-[a-z0-9-]+-auth-token(?:\.\d+)?$/.test(cookie.name));
      if (cookies.length === 0) { await fs.rm(this.filename, { force: true }); return; }
      const encrypted = await this.safeStorage.encryptStringAsync(JSON.stringify({ origin: this.origin, cookies }));
      await fs.mkdir(path.dirname(this.filename), { recursive: true });
      await fs.writeFile(`${this.filename}.tmp`, encrypted, { mode: 0o600 });
      await fs.rename(`${this.filename}.tmp`, this.filename);
    });
    return this.pending;
  }
}

module.exports = { CredentialVault };
