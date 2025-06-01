'use strict';

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'fs'.
const fs = require('fs');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'plist'.
const plist = require('plist');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'tools'.
const tools = require('./tools');

function findIdentityFromProvisionSync (file: any) {
  let data = fs.readFileSync(file).toString();
  const b = data.indexOf('<?xml');
  if (b === -1) {
    throw new Error('Cannot find the plist inside ' + file);
  }
  data = data.substring(b);
  const e = data.indexOf('</plist>');
  if (e === -1) {
    throw new Error('Cannot find end of plist inside ' + file);
  }
  const cert = plist.parse(data.substring(0, e + 8)).DeveloperCertificates.toString();
  const res = tools.getIdentitiesSync();
  for (const id of res) {
    if (cert.indexOf(id.name) !== -1) {
      return id.hash;
    }
  }
  throw new Error('Cannot find an identity in ' + file);
}

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = findIdentityFromProvisionSync;
