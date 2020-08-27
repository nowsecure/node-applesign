'use strict';

const fs = require('fs');
const plist = require('plist');
const tools = require('./tools');

function findIdentityFromProvisionSync (file) {
  let data = fs.readFileSync(file).toString();
  const b = data.indexOf('<?xml');
  if (b === -1) {
    throw new Error('Cannot find plist');
  }
  data = data.substring(b);
  const e = data.indexOf('</plist>');
  if (e === -1) {
    throw new Error('Cannot find end of plist');
  }
  const cert = plist.parse(data.substring(0, e + 8)).DeveloperCertificates.toString();
  const res = tools.getIdentitiesSync();
  for (const id of res) {
    if (cert.indexOf(id.name) !== -1) {
      return id.hash;
    }
  }
  throw new Error('Cannot find an identity for this mobile provisioning file.');
}

module.exports = findIdentityFromProvisionSync;
