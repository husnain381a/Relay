'use strict';

require('./validate-release.cjs');
if (process.exitCode) process.exit(process.exitCode);
const { spawnSync } = require('node:child_process');
const config = require('../config.json');
const cli = require.resolve('electron-builder/out/cli/cli.js');
const child = spawnSync(process.execPath, [cli, '--win', 'nsis', '--x64', '--publish', 'never', '--config.win.signExecutable=true', '--config.win.signAndEditExecutable=true', `--config.win.publisherName=${config.publisherName}`, '--config.publish.provider=generic', `--config.publish.url=${config.updateUrl}`], { stdio: 'inherit', windowsHide: true });
if (child.error) console.error(child.error.message);
process.exitCode = child.status ?? 1;
