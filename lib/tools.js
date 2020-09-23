'use strict';

const fs = require('fs-extra');
const { promisify } = require('util');
const { execSync, spawn } = require('child_process');
const unlinkAsync = promisify(fs.unlink);
const renameAsync = promisify(fs.rename);
const plist = require('simple-plist');
const path = require('path');
const which = require('which');
const rimraf = require('rimraf');

var use7zip = false;
var useOpenSSL = false;

const cmd = {
  '7z': '/usr/local/bin/7z',
  codesign: '/usr/bin/codesign',
  insert_dylib: 'insert_dylib',
  lipo: '/usr/bin/lipo',
  /* only when useOpenSSL is true */
  openssl: '/usr/local/bin/openssl',
  security: '/usr/bin/security',
  unzip: '/usr/bin/unzip',
  xcodebuild: '/usr/bin/xcodebuild',
  zip: '/usr/bin/zip'
};

async function execProgram (bin, arg, opt) {
  return new Promise((resolve, reject) => {
    let _out = Buffer.alloc(0);
    let _err = Buffer.alloc(0);
    const child = spawn(bin, arg, opt || {});
    child.stdout.on('data', data => {
      _out = Buffer.concat([_out, data]);
    });
    child.stderr.on('data', data => {
      _err = Buffer.concat([_err, data]);
    });
    child.stdin.end();
    child.on('close', code => {
      if (code !== 0) {
        let msg = 'stdout: ' + _out.toString('utf8');
        msg += '\nstderr: ' + _err.toString('utf8');
        msg += '\ncommand: ' + bin + ' ' + arg.join(' ');
        msg += '\ncode: ' + code;
        return reject(new Error(msg));
      }
      resolve({
        stdout: _out.toString(),
        stderr: _err.toString(),
        code: code
      });
    });
  });
}

/* public */

function isDramatic (msg) {
  if (msg.indexOf('insert_dylib') !== -1) {
    return false;
  }
  if (msg.indexOf('7z') !== -1) {
    return false;
  }
  return true;
}

async function findInPath () {
  return new Promise((resolve, reject) => {
    const keys = Object.keys(cmd);
    for (const key of keys) {
      try {
        cmd[key] = which.sync(key);
      } catch (err) {
        if (isDramatic(err.toString())) {
          return reject(new Error('Warning: tools.findInPath: ' + err));
        }
      }
    }
    resolve();
  });
}

async function codesign (identity, entitlement, keychain, file) {
  /* use the --no-strict to avoid the "resource envelope is obsolete" error */
  const args = ['--no-strict']; // http://stackoverflow.com/a/26204757
  if (identity === undefined) {
    throw new Error('--identity is required to sign');
  }
  args.push('-fs', identity);
  // args.push('-v');
  // args.push('--deep');
  if (typeof entitlement === 'string') {
    args.push('--entitlements=' + entitlement);
  }
  if (typeof keychain === 'string') {
    args.push('--keychain=' + keychain);
  }
  args.push(file);
  return execProgram(cmd.codesign, args, null);
}

async function verifyCodesign (file, keychain, cb) {
  const args = ['-v', '--no-strict'];
  if (typeof keychain === 'string') {
    args.push('--keychain=' + keychain);
  }
  args.push(file);
  return execProgram(cmd.codesign, args, null, cb);
}

async function getMobileProvisionPlist (file) {
  var res;
  if (file === undefined) {
    throw new Error('No mobile provisioning file available.');
  }
  if (useOpenSSL === true) {
    /* portable using openssl */
    const args = ['cms', '-in', file, '-inform', 'der', '-verify'];
    res = await execProgram(cmd.openssl, args, null);
  } else {
    /* OSX specific using security */
    const args = ['cms', '-D', '-i', file];
    res = await execProgram(cmd.security, args, null);
  }
  return plist.parse(res.stdout);
}

async function getEntitlementsFromMobileProvision (file, cb) {
  const res = await getMobileProvisionPlist(file);
  return res.Entitlements;
}

async function zip (cwd, ofile, src) {
  try {
    await unlinkAsync(ofile);
  } catch (ignored) {
  }
  const ofilePath = path.dirname(ofile);
  fs.ensureDirSync(ofilePath);
  if (use7zip) {
    const zipFile = ofile + '.zip';
    const args = ['a', zipFile, src];
    await execProgram(cmd['7z'], args, { cwd: cwd });
    await renameAsync(zipFile, ofile);
  } else {
    const args = ['-qry', ofile, src];
    await execProgram(cmd.zip, args, { cwd: cwd });
  }
}

async function unzip (ifile, odir) {
  if (use7zip) {
    const args = ['x', '-y', '-o' + odir, ifile];
    return execProgram(cmd['7z'], args, null);
  }
  if (process.env.UNZIP !== undefined) {
    cmd.unzip = process.env.UNZIP;
    delete process.env.UNZIP;
  }
  const args = ['-o', ifile, '-d', odir];
  return execProgram(cmd.unzip, args, null);
}

async function xcaToIpa (ifile, odir) {
  const args = ['-exportArchive', '-exportFormat', 'ipa', '-archivePath', ifile, '-exportPath', odir];
  return execProgram(cmd.xcodebuild, args, null);
}

async function insertLibrary (lib, bin, out) {
  let error = null;
  try {
    const machoMangle = require('macho-mangle');
    try {
      let src = fs.readFileSync(bin);
      if (lib.indexOf('@rpath') === 0) {
        src = machoMangle(src, {
          type: 'rpath',
          name: '@executable_path/Frameworks'
        });
      }
      const dst = machoMangle(src, {
        type: 'load_dylib',
        name: lib,
        version: {
          current: '1.0.0',
          compat: '0.0.0'
        }
      });
      fs.writeFileSync(bin, dst);
      console.log('Library inserted');
    } catch (e) {
      error = e;
    }
  } catch (e) {
    if (cmd.insert_dylib) {
      const args = ['--strip-codesig', '--all-yes', lib, bin, bin];
      const res = await execProgram(cmd.insert_dylib, args, null);
      console.error(JSON.stringify(res));
    } else {
      error = new Error('Cannot find insert_dylib or macho-mangle');
    }
  }
  if (error) {
    throw error;
  }
}

function getIdentitiesFromString (stdout) {
  const lines = stdout.split('\n');
  lines.pop(); // remove last line
  const ids = [];
  lines.filter(entry => {
    return entry.indexOf('CSSMERR_TP_CERT_REVOKED') === -1;
  }).forEach((line) => {
    const tok = line.indexOf(') ');
    if (tok !== -1) {
      const msg = line.substring(tok + 2).trim();
      const tok2 = msg.indexOf(' ');
      if (tok2 !== -1) {
        ids.push({
          hash: msg.substring(0, tok2),
          name: msg.substring(tok2 + 1).replace(/^"/, '').replace(/"$/, '')
        });
      }
    }
  });
  return ids;
}

function getIdentitiesSync (bin, arg) {
  const command = [cmd.security, 'find-identity', '-v', '-p', 'codesigning'];
  return getIdentitiesFromString(execSync(command.join(' ')).toString());
}

async function getIdentities () {
  const args = ['find-identity', '-v', '-p', 'codesigning'];
  const res = await execProgram(cmd.security, args, null);
  return getIdentitiesFromString(res.stdout);
}

async function lipoFile (file, arch, cb) {
  const args = [file, '-thin', arch, '-output', file];
  return execProgram(cmd.lipo, args, null, cb);
}

function isDirectory (pathString) {
  try {
    return fs.lstatSync(pathString).isDirectory();
  } catch (e) {
    return false;
  }
}

function setOptions (obj) {
  if (typeof obj.use7zip === 'boolean') {
    use7zip = obj.use7zip;
  }
  if (typeof obj.useOpenSSL === 'boolean') {
    useOpenSSL = obj.useOpenSSL;
  }
}

function asyncRimraf (dir) {
  return new Promise((resolve, reject) => {
    if (dir === undefined) {
      resolve();
    }
    rimraf(dir, (err, res) => {
      return err ? reject(err) : resolve(res);
    });
  });
}

[findInPath,
  codesign,
  verifyCodesign,
  getEntitlementsFromMobileProvision,
  getMobileProvisionPlist,
  zip,
  unzip,
  xcaToIpa,
  getIdentities,
  getIdentitiesSync,
  insertLibrary,
  lipoFile,
  setOptions,
  isDirectory,
  asyncRimraf
].forEach(function (x) {
  module.exports[x.name] = x;
});
