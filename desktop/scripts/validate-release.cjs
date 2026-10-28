'use strict';

const config = require('../config.json');
const { applicationOrigin } = require('../security.cjs');
try {
  if (!config.appUrl) throw new Error('Configure the deployed Relay HTTPS origin in desktop/config.json.');
  applicationOrigin(config.appUrl);
  if (!config.updateUrl || new URL(config.updateUrl).protocol !== 'https:') throw new Error('Configure an HTTPS signed update feed in desktop/config.json.');
  if (typeof config.publisherName !== 'string' || !config.publisherName.trim()) throw new Error('Configure the expected Windows certificate publisherName.');
  if (!process.env.CSC_LINK && !process.env.WIN_CSC_LINK) throw new Error('Set CSC_LINK or WIN_CSC_LINK to the release signing certificate in CI secret storage.');
  if (config.storageUrl) applicationOrigin(config.storageUrl);
  console.log('Desktop release configuration validated.');
} catch (error) {
  console.error(`Production release blocked: ${error.message}`);
  process.exitCode = 1;
}
