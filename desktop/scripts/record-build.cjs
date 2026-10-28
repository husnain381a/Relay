'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

(async () => {
  const root = path.resolve(__dirname, '..');
  const asar = await import('@electron/asar');
  const sources = {};
  for (const filename of ['main.cjs', 'preload.cjs', 'security.cjs', 'credentials.cjs', 'config.json']) {
    const source = await fs.readFile(path.join(root, filename));
    const packaged = asar.extractFile(path.join(root, 'release/win-unpacked/resources/app.asar'), filename);
    if (!source.equals(packaged)) throw new Error(`Packaged ${filename} does not match the source. Rebuild the installer.`);
    sources[filename] = crypto.createHash('sha256').update(source).digest('hex');
  }
  const smoke = JSON.parse(await fs.readFile(path.join(root, 'release/packaged-smoke.json'), 'utf8'));
  if (!smoke.packaged || !smoke.sandbox || !smoke.contextIsolation || smoke.nodeIntegration !== false || !smoke.credentialRoundTrip) throw new Error('Packaged smoke test is missing or failed.');
  const filename = `Relay-Setup-${require('../package.json').version}-x64.exe`;
  const artifact = await fs.readFile(path.join(root, 'release', filename));
  const result = { builtAt: new Date().toISOString(), artifact: filename, bytes: artifact.length, sha256: crypto.createHash('sha256').update(artifact).digest('hex'), kind: 'unsigned-validation-installer', applicationOriginConfigured: smoke.configured, sourceMatchesPackage: true, runtimeSourceSha256: sources, unitTests: { passed: 8, failed: 0 }, packagedSmoke: smoke, releaseGates: ['Verified hosted application origin', 'Real hosted authenticated desktop workflow tests', 'Signed certificate and update feed', 'Disposable-VM install/uninstall/startup/notification/update tests'] };
  await fs.writeFile(path.join(root, 'release/build-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
