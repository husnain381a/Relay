'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');

(async () => {
  const packaged = process.argv.includes('--packaged');
  const report = path.resolve(__dirname, packaged ? '../release/packaged-smoke.json' : '../release/smoke.json');
  const userData = path.resolve(__dirname, packaged ? '../release/packaged-smoke-user-data' : '../release/smoke-user-data');
  await fs.mkdir(path.dirname(report), { recursive: true });
  await fs.rm(report, { force: true });
  const electron = packaged ? path.resolve(__dirname, '../release/win-unpacked/Relay.exe') : require('electron');
  const env = { ...process.env, RELAY_SMOKE_REPORT: report, RELAY_SMOKE_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [...(packaged ? [] : [path.resolve(__dirname, '..')]), '--smoke-test', '--hidden'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const timer = setTimeout(() => child.kill(), 45000);
  child.on('error', error => { throw error; });
  child.on('exit', async code => {
    clearTimeout(timer);
    try {
      const result = JSON.parse(await fs.readFile(report, 'utf8'));
      if (code !== 0 || !result.sandbox || !result.contextIsolation || result.nodeIntegration !== false || result.renderer.nodeRequire !== 'undefined' || result.renderer.nodeProcess !== 'undefined' || (result.encryptedCredentialsAvailable && !result.credentialRoundTrip)) throw new Error(`Smoke test failed (${code}).`);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) { console.error(output.slice(-3000)); console.error(`Desktop smoke process exited ${code}: ${error.message}`); process.exitCode = 1; }
  });
})().catch(error => { console.error(error.message); process.exitCode = 1; });
