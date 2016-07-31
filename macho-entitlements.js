'use strict';

const fatmacho = require('fatmacho');
const macho = require('macho');
const fs = require('fs');

const CSSLOT_CODEDIRECTORY = 0;
const CSSLOT_REQUIREMENTS = 2;
const CSSLOT_ENTITLEMENTS = 5;

function parseEntitlements (data) {
  const count = data.readUInt32BE(8);
  for (let i = 0; i < count; i++) {
    const base = 8 * i;
    const type = data.readUInt32BE(base + 12);
    const blob = data.readUInt32BE(base + 16);
    if (type === CSSLOT_ENTITLEMENTS) {
      const size = data.readUInt32BE(blob + 4);
      return data.slice(blob + 8, blob + size);
    }
  }
  return null;
}

function getEntitlements (data, machoObject) {
  for (let cmd of machoObject.cmds) {
    if (cmd.type === 'code_signature') {
      return parseEntitlements(data.slice(cmd.dataoff));
    }
  }
  return null;
}

function getEntitlementsFromBuffer (data) {
  try {
    const hdrs = macho.parse(data);
    return getEntitlements(data, hdrs);
  } catch (e) {
    try {
      const bins = fatmacho.parse(data);
      const hdrs = macho.parse(bins[0].data);
      return getEntitlements(bins[0].data, hdrs);
    } catch (e2) {
      return null;
    }
  }
}

function getEntitlementsFromFile (path) {
  const data = fs.readFileSync(path);
  return getEntitlementsFromBuffer(data);
}

module.exports = {
  'parse': getEntitlementsFromBuffer,
  'parseFile': getEntitlementsFromFile
};
