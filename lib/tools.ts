'use strict';

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'fs'.
const fs = require('fs');
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const { promisify } = require('util');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'execSync'.
const { execSync, spawn } = require('child_process');
const unlinkAsync = promisify(fs.unlink);
const renameAsync = promisify(fs.rename);
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'plist'.
const plist = require('simple-plist');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'path'.
const path = require('path');
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const which = require('which');
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const rimraf = require('rimraf');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'bin'.
const bin = require('./bin');

let use7zip = false;
let useOpenSSL = false;

const cmdSpec = {
  '7z': '/usr/local/bin/7z',
  codesign: '/usr/bin/codesign',
  insert_dylib: 'insert_dylib',
  lipo: '/usr/bin/lipo',
  /* only when useOpenSSL is true */
  openssl: '/usr/local/bin/openssl',
  security: '/usr/bin/security',
  unzip: '/usr/bin/unzip',
  xcodebuild: '/usr/bin/xcodebuild',
  ideviceprovision: '/usr/local/bin/ideviceprovision',
  zip: '/usr/bin/zip',
  ldid2: 'ldid2'
};

const cmd = {};
let cmdInited = false;

async function execProgram (bin: any, arg: any, opt: any) {
  return new Promise((resolve, reject) => {
    // @ts-expect-error TS(2580): Cannot find name 'Buffer'. Do you need to install ... Remove this comment to see the full error message
    let _out = Buffer.alloc(0);
    // @ts-expect-error TS(2580): Cannot find name 'Buffer'. Do you need to install ... Remove this comment to see the full error message
    let _err = Buffer.alloc(0);
    const child = spawn(bin, arg, opt || {});
    child.stdout.on('data', (data: any) => {
      // @ts-expect-error TS(2580): Cannot find name 'Buffer'. Do you need to install ... Remove this comment to see the full error message
      _out = Buffer.concat([_out, data]);
    });
    child.stderr.on('data', (data: any) => {
      // @ts-expect-error TS(2580): Cannot find name 'Buffer'. Do you need to install ... Remove this comment to see the full error message
      _err = Buffer.concat([_err, data]);
    });
    child.stdin.end();
    child.on('close', (code: any) => {
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
        code
      });
    });
  });
}

/* public */

function isDramatic (msg: any) {
  if (msg.indexOf('insert_dylib') !== -1) {
    return false;
  }
  if (msg.indexOf('7z') !== -1) {
    return false;
  }
  return true;
}

function findInPath () {
  if (cmdInited) {
    return;
  }
  cmdInited = true;
  const keys = Object.keys(cmdSpec);
  for (const key of keys) {
    try {
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      cmd[key] = which.sync(key);
    } catch (err) {
    }
  }
}

function getTool (tool: any) {
  findInPath();
  if (!(tool in cmd)) {
    if (isDramatic(tool)) {
      throw new Error(`Warning: tools.findInPath: not found: ${tool}`);
    }
    return null;
  }
  // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
  return cmd[tool];
}

async function ideviceprovision (action: any, optarg: any) {
  if (action === 'list') {
    const res = await execProgram(getTool('ideviceprovision'), ['list'], null);
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    return res.stdout.split('\n')
      .filter((line: any) => line.indexOf('-') !== -1)
      .map((line: any) => line.split(' ')[0]);
  } else {
    throw new Error('unsupported ideviceprovision action');
  }
}

async function codesign (identity: any, entitlement: any, keychain: any, file: any) {
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
  args.push('--generate-entitlement-der');
  args.push(file);
  return execProgram(getTool('codesign'), args, null);
}

async function pseudoSign (entitlement: any, file: any) {
  const args = [];
  if (typeof entitlement === 'string') {
    args.push('-S' + entitlement);
  } else {
    args.push('-S');
  }
  const identifier = bin.getIdentifier(file);
  if (identifier !== null && identifier !== '') {
    args.push('-I' + identifier);
  }
  args.push(file);
  return execProgram(getTool('ldid2'), args, null);
}

async function verifyCodesign (file: any, keychain: any, cb: any) {
  const args = ['-v', '--no-strict'];
  if (typeof keychain === 'string') {
    args.push('--keychain=' + keychain);
  }
  args.push(file);
  // @ts-expect-error TS(2554): Expected 3 arguments, but got 4.
  return execProgram(getTool('codesign'), args, null, cb);
}

async function getMobileProvisionPlist (file: any) {
  let res;
  if (file === undefined) {
    throw new Error('No mobile provisioning file available.');
  }
  if (useOpenSSL === true) {
    /* portable using openssl */
    const args = ['cms', '-in', file, '-inform', 'der', '-verify'];
    res = await execProgram(getTool('openssl'), args, null);
  } else {
    /* OSX specific using security */
    const args = ['cms', '-D', '-i', file];
    res = await execProgram(getTool('security'), args, null);
  }
  // @ts-expect-error TS(2571): Object is of type 'unknown'.
  return plist.parse(res.stdout);
}

async function getEntitlementsFromMobileProvision (file: any, cb: any) {
  const res = await getMobileProvisionPlist(file);
  return res.Entitlements;
}

async function zip (cwd: any, ofile: any, src: any) {
  try {
    await unlinkAsync(ofile);
  } catch (ignored) {
  }
  const ofilePath = path.dirname(ofile);
  fs.mkdirSync(ofilePath, { recursive: true });
  if (use7zip) {
    const zipFile = ofile + '.zip';
    const args = ['a', zipFile, src];
    await execProgram(getTool('7z'), args, { cwd });
    await renameAsync(zipFile, ofile);
  } else {
    const args = ['-qry', ofile, src];
    await execProgram(getTool('zip'), args, { cwd });
  }
}

async function unzip (ifile: any, odir: any) {
  if (use7zip) {
    const args = ['x', '-y', '-o' + odir, ifile];
    return execProgram(getTool('7z'), args, null);
  }
  // @ts-expect-error TS(2580): Cannot find name 'process'. Do you need to install... Remove this comment to see the full error message
  if (process.env.UNZIP !== undefined) {
    // @ts-expect-error TS(2339): Property 'unzip' does not exist on type '{}'.
    cmd.unzip = process.env.UNZIP;
    // @ts-expect-error TS(2580): Cannot find name 'process'. Do you need to install... Remove this comment to see the full error message
    delete process.env.UNZIP;
  }
  const args = ['-o', ifile, '-d', odir];
  return execProgram(getTool('unzip'), args, null);
}

async function xcaToIpa (ifile: any, odir: any) {
  const args = ['-exportArchive', '-exportFormat', 'ipa', '-archivePath', ifile, '-exportPath', odir];
  return execProgram(getTool('xcodebuild'), args, null);
}

async function insertLibrary (lib: any, bin: any, out: any) {
  let error = null;
  try {
    // @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
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
    if (getTool('insert_dylib') !== null) {
      const args = ['--strip-codesig', '--all-yes', lib, bin, bin];
      const res = await execProgram(getTool('insert_dylib'), args, null);
      console.error(JSON.stringify(res));
    } else {
      error = new Error('Cannot find insert_dylib or macho-mangle');
    }
  }
  if (error) {
    throw error;
  }
}

function getIdentitiesFromString (stdout: any) {
  const lines = stdout.split('\n');
  lines.pop(); // remove last line
  const ids: any = [];
  lines.filter((entry: any) => {
    return entry.indexOf('CSSMERR_TP_CERT_REVOKED') === -1;
  }).forEach((line: any) => {
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

function getIdentitiesSync (bin: any, arg: any) {
  const command = [getTool('security'), 'find-identity', '-v', '-p', 'codesigning'];
  return getIdentitiesFromString(execSync(command.join(' ')).toString());
}

async function getIdentities () {
  const args = ['find-identity', '-v', '-p', 'codesigning'];
  const res = await execProgram(getTool('security'), args, null);
  // @ts-expect-error TS(2571): Object is of type 'unknown'.
  return getIdentitiesFromString(res.stdout);
}

async function lipoFile (file: any, arch: any, cb: any) {
  const args = [file, '-thin', arch, '-output', file];
  // @ts-expect-error TS(2554): Expected 3 arguments, but got 4.
  return execProgram(getTool('lipo'), args, null, cb);
}

function isDirectory (pathString: any) {
  try {
    return fs.lstatSync(pathString).isDirectory();
  } catch (e) {
    return false;
  }
}

function setOptions (obj: any) {
  if (typeof obj.use7zip === 'boolean') {
    use7zip = obj.use7zip;
  }
  if (typeof obj.useOpenSSL === 'boolean') {
    useOpenSSL = obj.useOpenSSL;
  }
}

function asyncRimraf (dir: any) {
  return new Promise((resolve, reject) => {
    if (dir === undefined) {
      // @ts-expect-error TS(2794): Expected 1 arguments, but got 0. Did you forget to... Remove this comment to see the full error message
      resolve();
    }
    rimraf(dir, (err: any, res: any) => {
      return err ? reject(err) : resolve(res);
    });
  });
}

[
  codesign,
  pseudoSign,
  verifyCodesign,
  getEntitlementsFromMobileProvision,
  getMobileProvisionPlist,
  zip,
  unzip,
  xcaToIpa,
  getIdentities,
  ideviceprovision,
  getIdentitiesSync,
  insertLibrary,
  lipoFile,
  setOptions,
  isDirectory,
  asyncRimraf
].forEach(function (x) {
  // @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
  module.exports[x.name] = x;
});
