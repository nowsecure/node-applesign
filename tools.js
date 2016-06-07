'use strict';

const childproc = require('child_process');
const plist = require('simple-plist');
const fs = require('fs');

const cmd = {
  zip: '/usr/bin/zip',
  unzip: '/usr/bin/unzip',
  codesign: '/usr/bin/codesign',
  security: '/usr/bin/security',
  xcodebuild: '/usr/bin/xcodebuild'
};

function execProgram (bin, arg, opt, cb) {
  if (!opt) {
    opt = {};
  }
  opt.maxBuffer = 1024 * 1024;
  return childproc.execFile(bin, arg, opt, cb);
}

module.exports = {
  codesign: function (identity, entitlement, keychain, file, cb) {
    /* use the --no-strict to avoid the "resource envelope is obsolete" error */
    const args = [ '--no-strict' ]; // http://stackoverflow.com/a/26204757
    if (identity === undefined) {
      return cb(new Error('--identity is required to sign'));
    }
    args.push('-fs', identity);
    if (typeof entitlement === 'string') {
      args.push('--entitlements=' + entitlement);
    }
    if (typeof keychain === 'string') {
      args.push('--keychain=' + keychain);
    }
    args.push(file);
    execProgram(cmd.codesign, args, null, cb);
  },
  verifyCodesign: function (file, keychain, cb) {
    const args = ['-v', '--no-strict'];
    if (typeof keychain === 'string') {
      args.push('--keychain=' + keychain);
    }
    args.push(file);
    execProgram(cmd.codesign, args, null, cb);
  },
  getEntitlementsFromMobileProvision: function (file, cb) {
    const args = [ 'cms', '-D', '-i', file ];
    execProgram(cmd.security, args, null, (error, stdout) => {
      cb(error, plist.parse(stdout)['Entitlements']);
    });
  },
  zip: function (cwd, ofile, src, cb) {
    fs.unlink(ofile, () => {
      const args = [ '-qry', ofile, src ];
      execProgram(cmd.zip, args, { cwd: cwd }, cb);
    });
  },
  unzip: function (ifile, odir, cb) {
    const args = [ '-o', ifile, '-d', odir ];
    execProgram(cmd.unzip, args, null, cb);
  },
  xcaToIpa: function (ifile, odir, cb) {
    const args = [ '-exportArchive', '-exportFormat', 'ipa', '-archivePath', ifile, '-exportPath', odir ];
    execProgram(cmd.xcodebuild, args, null, cb);
  },
  getIdentities: function (cb) {
    const args = [ 'find-identity', '-v', '-p', 'codesigning' ];
    execProgram(cmd.security, args, null, (error, stdout) => {
      if (error) {
        return cb(error);
      }
      const lines = stdout.split('\n');
      lines.pop(); // remove last line
      let ids = [];
      lines.forEach((line) => {
        const tok = line.indexOf(') ');
        if (tok !== -1) {
          const msg = line.substring(tok + 2).trim();
          const tok2 = msg.indexOf(' ');
          if (tok2 !== -1) {
            ids.push({
              'hash': msg.substring(0, tok2),
              'name': msg.substring(tok2 + 1)
            });
          }
        }
      });
      cb(undefined, ids);
    });
  }
};
