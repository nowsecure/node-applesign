'use strict';
const macho = require('macho');
const fatmacho = require('fatmacho');
const fs = require('fs');

const SYNC_API = {
  data: haveBitcodeSyncData,
  path: haveBitcodeSync
};

function isBitcode (cmds) {
  let haveBitcode = false;
  let haveNative = false;
  for (let cmd of cmds) {
    if (cmd.type === 'segment' || cmd.type === 'segment_64') {
      if (cmd.name === '__TEXT' && cmd.sections.length > 0) {
        haveNative = cmd.vmsize > 0;
      }
      if (cmd.name === '__LLVM' && cmd.sections.length > 0) {
        const section = cmd.sections[0];
        if (section.sectname === '__bundle' && section.size > 0) {
          haveBitcode = true;
        }
      }
    }
  }
  return haveBitcode && !haveNative;
}

function haveBitcodeSyncData (data) {
  try {
    const exec = macho.parse(data);
    return isBitcode(exec.cmds);
  } catch (e) {
    const fat = fatmacho.parse(data);
    for (let bin of fat) {
      const exec = macho.parse(bin.data);
      if (isBitcode(exec.cmds)) { return true; }
    }
  }
  return false;
}

function haveBitcodeSync (path) {
  const data = fs.readFileSync(path);
  return haveBitcodeSyncData(data);
}

module.exports = SYNC_API;
