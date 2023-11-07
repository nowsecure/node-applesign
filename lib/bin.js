'use strict';

const isEncryptedSync = require('macho-is-encrypted');
const fatmacho = require('fatmacho');
const macho = require('macho');
const fs = require('fs');

const MACH0_MIN_SIZE = 1024 * 4;
const MH_EXECUTE = 2;
const MH_DYLIB = 6;
const MH_BUNDLE = 8;
const CSSLOT_CODEDIRECTORY = 0;

function isMacho (filePath) {
  if (typeof filePath !== 'string') {
    throw new Error('Expected a string');
  }
  // read file headers and read the magic and filetype
  if (!fs.lstatSync(filePath).isFile()) {
    return false;
  }
  const fd = fs.openSync(filePath, 'r');
  if (fd < 1) {
    return false;
  }
  const machoMagic = Buffer.alloc(4);
  if (fs.readSync(fd, machoMagic, { position: 0, length: 4 }) !== 4) {
    return false;
  }
  const machoType = Buffer.alloc(4);
  if (fs.readSync(fd, machoType, { position: 0xc, length: 4 }) !== 4) {
    return false;
  }
  fs.close(fd);
  // is this a fatmacho?

  if (!machoMagic.compare(Buffer.from([0xca, 0xfe, 0xba, 0xbe]))) {
    try {
      const data = fs.readFileSync(filePath);
      const butter = fatmacho.parse(data);
      for (const slice of butter) {
        const mm = slice.data.slice(0, 4);
        const mt = slice.data.slice(0xc, 0xc + 4);
        if (isValidMacho(mm, mt)) {
          return true;
        }
      }
    } catch (_) {
      // nothing to see
    }
    return false;
  }
  return isValidMacho(machoMagic, machoType);
}

function isValidMacho (machoMagic, machoType) {
  // verify this file have enough magic
  const magics = [
    [0xce, 0xfa, 0xed, 0xfe], // 32bit
    [0xcf, 0xfa, 0xed, 0xfe] // 64bit
  ];
  for (const a of magics) {
    if (!machoMagic.slice(0, 4).compare(Buffer.from(a))) {
      // ensure the macho type is supported by ldid2
      const fileType = machoType[0];
      switch (fileType) {
        case MH_EXECUTE:
        case MH_DYLIB:
        case MH_BUNDLE:
          return true;
      }
      return false;
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

function parseMachoAndGetData (data) {
  try {
    return [macho.parse(data), data];
  } catch (e) {
    const fat = fatmacho.parse(data); //  throws
    const slice = fat[0].data;
    return [parseMacho(slice), slice];
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

function getIdentifier (path) {
  const rawData = fs.readFileSync(path);
  const [bin, data] = parseMachoAndGetData(rawData);
  for (const cmd of bin.cmds) {
    if (cmd.type === 'code_signature') {
      return parseIdentifier(data.slice(cmd.dataoff));
    }
  }
  return null;

  function parseIdentifier (data) {
    const count = data.readUInt32BE(8);
    for (let i = 0; i < count; i++) {
      const base = 8 * i;
      const type = data.readUInt32BE(base + 12);
      const blob = data.readUInt32BE(base + 16);
      if (type === CSSLOT_CODEDIRECTORY) {
        const size = data.readUInt32BE(blob + 4);
        const directory = data.slice(blob + 8, blob + size);
        const identOffset = directory.readUInt32BE(12);
        const identifier = [];
        let cursor = identOffset;
        while (cursor < size) {
          const charCode = data.readUInt8(blob + cursor);
          if (charCode === 0) {
            break;
          }
          identifier.push(String.fromCharCode(charCode));
          cursor++;
        }
        return identifier.join('');
      }
    }
    return null;
  }
}

module.exports = {
  entitlements,
  isMacho,
  isBitcode,
  isEncrypted,
  isTruncated,
  enumerateLibraries,
  getIdentifier
};
