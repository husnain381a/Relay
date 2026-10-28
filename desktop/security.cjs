'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function applicationOrigin(raw, { development = false } = {}) {
  const url = new URL(raw);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.hash || url.search || url.pathname !== '/') throw new Error('Use an application origin without a path, query, credentials or fragment.');
  if (url.protocol !== 'https:' && !(development && local && url.protocol === 'http:')) throw new Error('The desktop application requires HTTPS. Local HTTP is available only during development.');
  return url.origin;
}

function sameOrigin(raw, origin) {
  if (!origin) return false;
  try { const url = new URL(raw); return ['https:', 'http:'].includes(url.protocol) && url.origin === origin && !url.username && !url.password; } catch { return false; }
}

function safeWebPath(raw) {
  if (typeof raw !== 'string' || raw.length > 1024 || !raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u001f]/.test(raw)) return '/';
  try { const url = new URL(raw, 'https://relay.invalid'); return url.origin === 'https://relay.invalid' ? `${url.pathname}${url.search}` : '/'; } catch { return '/'; }
}

function deepLinkTarget(raw, origin) {
  if (!origin || typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'relay:' || url.hostname !== 'open' || (url.pathname && url.pathname !== '/') || url.username || url.password || url.hash) return null;
    const target = new URL('/', origin);
    for (const key of ['workspace', 'conversation', 'message']) {
      const value = url.searchParams.get(key);
      if (value !== null) {
        if (!UUID.test(value)) return null;
        target.searchParams.set(key, value);
      }
    }
    if (!target.searchParams.has('workspace')) return null;
    return target.href;
  } catch { return null; }
}

function notificationPayload(value) {
  if (!value || typeof value !== 'object' || typeof value.title !== 'string' || typeof value.body !== 'string') throw new Error('Invalid notification.');
  if (value.title.length > 120 || value.body.length > 500) throw new Error('Notification is too long.');
  return { title: value.title.replace(/[\u0000-\u001f]/g, ''), body: value.body.replace(/[\u0000-\u001f]/g, ''), path: safeWebPath(value.path || '/') };
}

function safeDownloadName(value) {
  const name = String(value || 'download').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 180);
  return !name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `relay-${name || 'download'}` : name;
}

function trustedSender(event, window, origin) {
  return Boolean(window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && sameOrigin(event.senderFrame?.url, origin));
}

module.exports = { applicationOrigin, sameOrigin, safeWebPath, deepLinkTarget, notificationPayload, safeDownloadName, trustedSender };
