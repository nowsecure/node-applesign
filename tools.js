'use strict';

const childproc = require('child_process');
const plist = require('simple-plist');

const path = {
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

function callback (cb) {
  return function (error, stdout, stderr) {
    if (error && error.message) {
      return cb(error.message);
    }
    cb(undefined, stdout);
  };
}

module.exports = {
  codesign: function (identity, entitlement, file, cb) {
    /* use the --no-strict to avoid the "resource envelope is obsolete" error */
    const args = [ '--no-strict' ]; // http://stackoverflow.com/a/26204757
    if (identity === undefined) {
      return cb('--identity is required to sign');
    }
    args.push('-fs', identity);
    if (typeof entitlement === 'string') {
      args.push('--entitlements=' + entitlement);
    }
    args.push(file);
    execProgram(path.codesign, args, null, callback(cb));
  },
  verifyCodesign: function (file, cb) {
    const args = ['-v', '--no-strict', file];
    execProgram(path.codesign, args, null, callback(cb));
  },
  getEntitlementsFromMobileProvision: function (file, cb) {
    const args = [ 'cms', '-D', '-i', file ];
    execProgram(path.security, args, null, callback((error, stdout) => {
      cb(error, plist.parse(stdout)['Entitlements']);
    }));
  },
  zip: function (cwd, ofile, src, cb) {
    const args = [ '-qry', ofile, src ];
    execProgram(path.zip, args, { cwd: cwd }, callback(cb));
  },
  unzip: function (ifile, odir, cb) {
    const args = [ '-o', ifile, '-d', odir ];
    execProgram(path.unzip, args, null, callback(cb));
  },
  xcaToIpa: function (ifile, odir, cb) {
    const args = [ '-exportArchive', '-exportFormat', 'ipa', '-archivePath', ifile, '-exportPath', odir ];
    execProgram(path.xcodebuild, args, null, callback(cb));
  },
  getIdentities: function (cb) {
    const args = [ 'find-identity', '-v', '-p', 'codesigning' ];
    execProgram(path.security, args, null, callback((error, stdout) => {
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
    }));
  }
};
