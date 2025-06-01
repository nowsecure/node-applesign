'use strict';

import fs from 'fs';
import plist from 'plist';
import * as tools from './tools.js';

export default function findIdentityFromProvisionSync(file: any): string {
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
