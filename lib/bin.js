'use strict';

const isEncryptedSync = require('macho-is-encrypted');
const fatmacho = require('fatmacho');
const macho = require('macho');
const fs = require('fs');

const MACH0_MIN_SIZE = 1024 * 4;

function isMacho (data) {
  if (typeof data === 'string') {
    if (!fs.lstatSync(data).isFile()) {
      return false;
    }
    const fd = fs.openSync(data, 'r');
    data = Buffer.alloc(4);
    if (fs.readSync(fd, data, 0, 4) !== 4) {
      return false;
    }
    fs.close(fd);
  }
  const magics = [
    [0xca, 0xfe, 0xba, 0xbe], // fat
    [0xce, 0xfa, 0xed, 0xfe], // 32bit
    [0xcf, 0xfa, 0xed, 0xfe], // 64bit
    [0xfe, 0xed, 0xfa, 0xce] // big-endian
  ];
  if (data.length < 4) {
    return false;
  }
  for (const a of magics) {
    if (!data.compare(Buffer.from(a))) {
      return true;
    }
  }
  return false;
}

function isBitcodeMacho (cmds) {
  let haveBitcode = false;
  let haveNative = false;
  for (const cmd of cmds) {
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

function isEncrypted (data) {
  if (typeof data === 'string') {
    data = fs.readFileSync(data);
  }
  return isEncryptedSync.data(data);
}

function isFatmacho (data) {
  if (typeof data === 'string') {
    data = fs.readFileSync(data);
  }
  try {
    fatmacho.parse(data);
    return true;
  } catch (_) {
    return false;
  }
}

function isBitcode (data) {
  if (typeof data === 'string') {
    data = fs.readFileSync(data);
  }
  try {
    const exec = macho.parse(data);
    return isBitcodeMacho(exec.cmds);
  } catch (e) {
    const fat = fatmacho.parse(data);
    for (const bin of fat) {
      const exec = macho.parse(bin.data);
      if (isBitcodeMacho(exec.cmds)) {
        return true;
      }
    }
  }
  return false;
}

function isTruncated (data) {
  if (typeof data === 'string') {
    data = fs.readFileSync(data);
  }
  if (data.length < MACH0_MIN_SIZE) {
    return true;
  }
  const diskMacho = macho.parse(data);
  for (const cmd of diskMacho.cmds) {
    switch (cmd.type) {
      case 'segment':
      case 'segment_64':
        {
          const end = cmd.fileoff + cmd.filesize;
          if (end > data.length) {
            return true;
          }
        }
        break;
    }
  }
  return false;
}

function parseMacho (data) {
  try {
    return macho.parse(data);
  } catch (e) {
    const fat = fatmacho.parse(data); //  throws
    // we get the first slice, assuming it contains the same libs as the others
    return parseMacho(fat[0].data);
  }
}

function enumerateLibraries (data) {
  if (typeof data === 'string') {
    data = fs.readFileSync(data);
  }
  const exec = parseMacho(data);
  return exec.cmds.filter((x) =>
    x.type === 'load_dylib' || x.type === 'load_weak_dylib'
  ).map((x) => x.name);
}

const machoEntitlements = require('macho-entitlements');

function entitlements (file) {
  return machoEntitlements.parseFile(file);
}

module.exports = {
  entitlements: entitlements,
  isFatmacho: isFatmacho,
  isMacho: isMacho,
  isBitcode: isBitcode,
  isEncrypted: isEncrypted,
  isTruncated: isTruncated,
  enumerateLibraries: enumerateLibraries
};
