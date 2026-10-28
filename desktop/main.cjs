'use strict';

const { app, BrowserWindow, Menu, Tray, nativeImage, Notification, dialog, ipcMain, protocol, safeStorage, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { autoUpdater } = require('electron-updater');
const { applicationOrigin, sameOrigin, safeWebPath, deepLinkTarget, notificationPayload, safeDownloadName, trustedSender } = require('./security.cjs');
const { CredentialVault } = require('./credentials.cjs');
const config = require('./config.json');

protocol.registerSchemesAsPrivileged([{ scheme: 'relay-internal', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const development = !app.isPackaged;
const smoke = process.argv.includes('--smoke-test');
let origin = null;
let configurationError = null;
try { if (process.env.RELAY_APP_URL && development) origin = applicationOrigin(process.env.RELAY_APP_URL, { development: true }); else if (config.appUrl) origin = applicationOrigin(config.appUrl); } catch (error) { configurationError = error.message; }
let mainWindow;
let tray;
let vault;
let credentialEncryptionAvailable = false;
let quitting = false;
let flushingQuit = false;
let updateReady = false;
let updateStatus = { state: 'disabled', message: 'Signed update feed is not configured.' };
let pendingDeepLink = process.argv.find(arg => arg.startsWith('relay://'));
const notificationTimes = [];
const icon = path.join(__dirname, 'assets', 'icon.png');

function log(event, error) { console.error(JSON.stringify({ time: new Date().toISOString(), event, ...(error ? { error: String(error.message || error).slice(0, 300) } : {}) })); }
function showWindow() { if (!mainWindow || mainWindow.isDestroyed()) return; if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
function updateState(state, message) { updateStatus = { state, message }; if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('relay:update-status', updateStatus); }
function assertSender(event) { if (!trustedSender(event, mainWindow, origin)) throw new Error('Untrusted desktop request.'); }
function updateConfigured() { try { return app.isPackaged && Boolean(config.publisherName) && new URL(config.updateUrl).protocol === 'https:'; } catch { return false; } }

async function openExternal(raw) {
  let target;
  try { target = new URL(raw); if (!['https:', ...(development ? ['http:'] : [])].includes(target.protocol) || target.username || target.password || raw.length > 4096) return; } catch { return; }
  const answer = await dialog.showMessageBox(mainWindow, { type: 'question', title: 'Open link in your browser?', message: target.hostname, detail: target.href, buttons: ['Cancel', 'Open in browser'], defaultId: 0, cancelId: 0, noLink: true });
  if (answer.response === 1) await shell.openExternal(target.href);
}

function handleDeepLink(raw) {
  const target = deepLinkTarget(raw, origin);
  if (!target || !mainWindow) return;
  showWindow();
  // Navigation is performed by the trusted shell; a peer cannot choose an origin.
  mainWindow.loadURL(target).catch(error => log('deep-link-load-failed', error));
}

function setupHtml() {
  const message = configurationError ? `Configuration error: ${configurationError}` : 'This validation build does not have a production application address yet.';
  const escape = text => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'"><title>Relay · Deployment required</title><style>:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f6f5f2;color:#252237;font:16px/1.65 system-ui,sans-serif;display:grid;place-items:center;padding:32px}main{max-width:600px}.mark{background:#29263f;color:white;font-size:29px;width:54px;height:54px;display:grid;place-items:center;border-radius:12px;font-weight:750}h1{font-size:30px;line-height:1.2;letter-spacing:-.8px;margin:26px 0 14px}p{color:#5c586b}code{display:inline-block;padding:2px 6px;background:#e9e7ee;font:13px/1.6 ui-monospace,monospace;border-radius:4px}.badge{display:inline-block;padding:4px 10px;font-size:12px;color:#654a0b;background:#f5e9c5;border-radius:4px;margin-top:20px}li{margin:10px 0}@media(prefers-color-scheme:dark){body{background:#1e1d27;color:#f6f5fa}p{color:#b6b1c6}code{background:#32303e}.badge{color:#f1d698;background:#44391f}}</style></head><body><main><div class="mark" aria-hidden="true">R</div><div class="badge">VALIDATION BUILD · NOT A PRODUCTION RELEASE</div><h1>Your team’s space,<br>ready for its address.</h1><p>${escape(message)} The native desktop shell is installed, but messaging needs the deployed Relay web app and its configured Supabase backend.</p><ol><li>Deploy and verify the web application.</li><li>Set <code>appUrl</code> in <code>desktop/config.json</code> to its HTTPS origin.</li><li>Configure the signed update feed and publisher certificate.</li><li>Build the production installer with <code>npm run build</code>.</li></ol><p>See <code>docs/DESKTOP.md</code> in the source package for setup and release instructions.</p></main></body></html>`;
}

function configureIpc() {
  const handle = (name, action) => ipcMain.handle(name, async (event, ...args) => { assertSender(event); return action(...args); });
  handle('relay:version', () => app.getVersion());
  handle('relay:preferences', () => ({ launchAtStartup: app.isPackaged ? app.getLoginItemSettings().openAtLogin : false, startupAvailable: app.isPackaged, updateStatus, credentialEncryption: credentialEncryptionAvailable }));
  handle('relay:startup', enabled => {
    if (typeof enabled !== 'boolean') throw new Error('Expected a boolean.');
    if (!app.isPackaged) throw new Error('Launch at startup is available after installation.');
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath });
    return { launchAtStartup: app.getLoginItemSettings().openAtLogin };
  });
  handle('relay:notify', value => {
    const payload = notificationPayload(value);
    const now = Date.now();
    while (notificationTimes.length && notificationTimes[0] < now - 60000) notificationTimes.shift();
    if (notificationTimes.length >= 12) return { shown: false, reason: 'rate-limited' };
    if (!Notification.isSupported() || mainWindow.isFocused()) return { shown: false, reason: 'focused-or-unavailable' };
    notificationTimes.push(now);
    const notice = new Notification({ title: payload.title, body: payload.body, icon, silent: false });
    notice.on('click', () => { showWindow(); if (origin) mainWindow.loadURL(new URL(payload.path, origin).href).catch(error => log('notification-navigation-failed', error)); });
    notice.show();
    return { shown: true };
  });
  handle('relay:check-update', async () => {
    if (!updateConfigured()) return updateStatus;
    await autoUpdater.checkForUpdates();
    return updateStatus;
  });
  handle('relay:install-update', async () => {
    if (!updateReady || !updateConfigured()) throw new Error('No verified update is ready.');
    quitting = true;
    if (vault) await vault.flush();
    autoUpdater.quitAndInstall(false, true);
  });
}

function configureUpdater() {
  if (!updateConfigured()) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.verifyUpdateCodeSignature = true;
  autoUpdater.setFeedURL({ provider: 'generic', url: config.updateUrl });
  autoUpdater.on('checking-for-update', () => updateState('checking', 'Checking for updates…'));
  autoUpdater.on('update-not-available', () => updateState('current', 'Relay is up to date.'));
  autoUpdater.on('error', error => { updateState('error', 'Update check failed. Try again from the Relay menu.'); log('update-error', error); });
  autoUpdater.on('update-available', async info => {
    updateState('available', `Version ${info.version} is available.`);
    const answer = await dialog.showMessageBox(mainWindow, { type: 'info', title: 'Relay update available', message: `Download Relay ${info.version}?`, buttons: ['Later', 'Download'], defaultId: 1, cancelId: 0 });
    if (answer.response === 1) { updateState('downloading', 'Downloading a signed update…'); autoUpdater.downloadUpdate().catch(error => log('update-download-error', error)); }
  });
  autoUpdater.on('update-downloaded', () => { updateReady = true; updateState('ready', 'Update downloaded. Choose “Restart and update” from the Relay menu.'); });
  updateState('ready-to-check', 'Updates are checked from the Relay menu.');
}

function createMenus() {
  const menu = Menu.buildFromTemplate([
    { label: 'Relay', submenu: [
      { label: 'Show Relay', click: showWindow },
      { label: 'Launch at sign in', type: 'checkbox', checked: app.isPackaged ? app.getLoginItemSettings().openAtLogin : false, enabled: app.isPackaged, click: item => { app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath }); } },
      { label: 'Check for updates…', enabled: updateConfigured(), click: () => autoUpdater.checkForUpdates().catch(error => log('update-check-error', error)) },
      { label: 'Restart and update', enabled: updateConfigured(), click: async () => { if (!updateReady) { await dialog.showMessageBox(mainWindow, { message: 'No update has been downloaded yet.' }); return; } quitting = true; if (vault) await vault.flush(); autoUpdater.quitAndInstall(); } },
      { type: 'separator' },
      { label: 'Quit Relay', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } }
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }, ...(development ? [{ role: 'toggleDevTools' }] : [])] }
  ]);
  Menu.setApplicationMenu(menu);
  tray = new Tray(nativeImage.createFromPath(icon));
  tray.setToolTip('Relay');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Relay', click: showWindow }, { label: 'Quit Relay', click: () => { quitting = true; app.quit(); } }]));
  tray.on('double-click', showWindow);
}

async function createWindow() {
  // An in-memory partition prevents plaintext renderer localStorage or cookie DB
  // from becoming the credential store. Only auth cookies enter the DPAPI vault.
  const appSession = session.fromPartition('relay-memory');
  appSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(permission === 'notifications' && contents === mainWindow?.webContents && sameOrigin(details.requestingUrl, origin)));
  appSession.setPermissionCheckHandler((contents, permission, requestingOrigin) => permission === 'notifications' && contents === mainWindow?.webContents && sameOrigin(requestingOrigin, origin));
  appSession.setDevicePermissionHandler(() => false);
  await appSession.protocol.handle('relay-internal', request => new Response(request.url === 'relay-internal://setup/' || request.url === 'relay-internal://setup' ? setupHtml() : 'Not found', { status: request.url.startsWith('relay-internal://setup') ? 200 : 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } }));
  if (origin) {
    vault = new CredentialVault({ safeStorage, cookies: appSession.cookies, origin, filename: path.join(app.getPath('userData'), 'credentials.bin') });
    try { credentialEncryptionAvailable = await vault.available(); await vault.restore(); } catch (error) { log('credential-restore-unavailable', error); }
    appSession.cookies.on('changed', () => vault.schedule());
  }
  mainWindow = new BrowserWindow({ width: 1360, height: 900, minWidth: 680, minHeight: 500, show: !smoke && !process.argv.includes('--hidden'), backgroundColor: '#29263f', title: 'Relay', icon, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, navigateOnDragDrop: false, spellcheck: true, session: appSession } });
  mainWindow.on('close', event => { if (!quitting && !smoke) { event.preventDefault(); mainWindow.hide(); } });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { openExternal(url).catch(error => log('external-link-failed', error)); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!sameOrigin(url, origin)) { event.preventDefault(); openExternal(url).catch(error => log('external-navigation-failed', error)); } });
  mainWindow.webContents.on('will-redirect', (event, url) => { if (!sameOrigin(url, origin)) event.preventDefault(); });
  mainWindow.webContents.on('render-process-gone', (_event, details) => log('renderer-exited', new Error(details.reason)));
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => { if (code !== -3) log('application-load-failed', new Error(description)); });
  appSession.on('will-download', (event, item, contents) => {
    const urls = item.getURLChain();
    const trustedDownload = urls.every(url => { try { const parsed = new URL(url); return sameOrigin(url, origin) || (parsed.protocol === 'blob:' && parsed.origin === origin) || (config.storageUrl && sameOrigin(url, config.storageUrl)); } catch { return false; } });
    if (contents !== mainWindow.webContents || !trustedDownload) { event.preventDefault(); return; }
    item.setSaveDialogOptions({ title: 'Save Relay attachment', defaultPath: path.join(app.getPath('downloads'), safeDownloadName(item.getFilename())), properties: ['showOverwriteConfirmation'] });
    item.on('done', (_done, state) => { if (state !== 'completed' && state !== 'cancelled') dialog.showErrorBox('Download failed', 'The attachment could not be downloaded. Please retry from the conversation.'); });
  });
  configureIpc();
  configureUpdater();
  createMenus();
  await mainWindow.loadURL(origin || 'relay-internal://setup/');
  if (origin && !credentialEncryptionAvailable && !smoke) await dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Session storage unavailable', message: 'Relay cannot access Windows credential encryption.', detail: 'You can sign in for this session, but your sign-in will not be saved. Check your Windows account encryption settings and restart Relay.', buttons: ['Continue'] });
  if (pendingDeepLink) { handleDeepLink(pendingDeepLink); pendingDeepLink = null; }
  if (smoke) {
    const settings = mainWindow.webContents.getLastWebPreferences();
    const encryptedCredentialsAvailable = await safeStorage.isAsyncEncryptionAvailable();
    let credentialRoundTrip = false;
    if (encryptedCredentialsAvailable) { const bytes = await safeStorage.encryptStringAsync('relay-native-smoke'); credentialRoundTrip = (await safeStorage.decryptStringAsync(bytes)).result === 'relay-native-smoke' && bytes.toString() !== 'relay-native-smoke'; }
    const renderer = await mainWindow.webContents.executeJavaScript('({nodeRequire: typeof window.require, nodeProcess: typeof window.process, desktopBridge: Boolean(window.relayDesktop)})');
    const result = { version: app.getVersion(), packaged: app.isPackaged, url: mainWindow.webContents.getURL(), sandbox: settings.sandbox, contextIsolation: settings.contextIsolation, nodeIntegration: settings.nodeIntegration, configured: Boolean(origin), encryptedCredentialsAvailable, credentialRoundTrip, renderer };
    const reportPath = process.env.RELAY_SMOKE_REPORT;
    if (reportPath) await fs.writeFile(reportPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ smoke: result }));
    quitting = true;
    app.quit();
  }
}

app.setName('Relay');
app.setAppUserModelId('com.relay.collaboration');
if (smoke && process.env.RELAY_SMOKE_USER_DATA) app.setPath('userData', process.env.RELAY_SMOKE_USER_DATA);
const lock = smoke || app.requestSingleInstanceLock();
if (!lock) app.quit(); else {
  app.on('second-instance', (_event, argv) => { const link = argv.find(arg => arg.startsWith('relay://')); if (link) handleDeepLink(link); else showWindow(); });
  app.on('open-url', (event, url) => { event.preventDefault(); if (mainWindow) handleDeepLink(url); else pendingDeepLink = url; });
  app.whenReady().then(async () => {
    if (app.isPackaged && !smoke) app.setAsDefaultProtocolClient('relay');
    await createWindow();
  }).catch(error => { log('desktop-start-failed', error); if (!smoke) dialog.showErrorBox('Relay could not start', error.message); app.exit(1); });
  app.on('activate', showWindow);
  app.on('window-all-closed', () => { if (quitting || smoke) app.quit(); });
  app.on('before-quit', event => {
    quitting = true;
    if (vault && !flushingQuit) { event.preventDefault(); flushingQuit = true; vault.flush().catch(error => log('credential-save-failed', error)).finally(() => app.quit()); }
  });
}
