'use strict';

/* private */

const childproc = require('child_process');
const plist = require('simple-plist');
const which = require('which');
const fs = require('fs');

var use7zip = false;
var useOpenSSL = false;

const cmd = {
  sevenZip: '/usr/local/bin/7z',
  zip: '/usr/bin/zip',
  unzip: '/usr/bin/unzip',
  codesign: '/usr/bin/codesign',
  security: '/usr/bin/security',
  xcodebuild: '/usr/bin/xcodebuild',
  /* only when useOpenSSL is true */
  openssl: '/usr/local/bin/openssl',
  insert_dylib: 'insert_dylib',
  lipo: '/usr/bin/lipo'
};

function execProgram (bin, arg, opt, cb) {
  if (!opt) {
    opt = {};
  }
  opt.maxBuffer = 1024 * 1024;
  return childproc.execFile(bin, arg, opt, cb);
}

/* public */

function findInPath (cb) {
  const keys = Object.keys(cmd);
  let pending = keys.length;
  for (let key of keys) {
    which(key, function (err, loc) {
      if (err !== undefined) {
        cmd[key] = loc;
        if (--pending === 0) {
          cb(null, cmd);
        }
      }
    });
  }
}

function codesign (identity, entitlement, keychain, file, cb) {
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
}

function verifyCodesign (file, keychain, cb) {
  const args = ['-v', '--no-strict'];
  if (typeof keychain === 'string') {
    args.push('--keychain=' + keychain);
  }
  args.push(file);
  execProgram(cmd.codesign, args, null, cb);
}

function getMobileProvisionPlist (file, cb) {
  if (useOpenSSL === true) {
    /* portable using openssl */
    const args = [ 'cms', '-in', file, '-inform', 'der', '-verify' ];
    execProgram(cmd.openssl, args, null, (error, stdout) => {
      cb(error, plist.parse(stdout));
    });
  } else {
    /* OSX specific using security */
    const args = [ 'cms', '-D', '-i', file ];
    execProgram(cmd.security, args, null, (error, stdout) => {
      cb(error, plist.parse(stdout));
    });
  }
}

function getEntitlementsFromMobileProvision (file, cb) {
  return getMobileProvisionPlist(file, (e, o) => {
    if (e) {
      return cb(e, o);
    }
    return cb(e, o['Entitlements']);
  });
}

function zip (cwd, ofile, src, cb) {
  if (use7zip) {
    fs.unlink(ofile, () => {
      const zipFile = ofile + '.zip';
      const args = [ 'a', zipFile, src ];
      execProgram(cmd.sevenZip, args, { cwd: cwd }, (error, message) => {
        if (error) {
          return cb(error, message);
        }
        fs.rename(zipFile, ofile, cb);
      });
    });
  } else {
    fs.unlink(ofile, () => {
      const args = [ '-qry', ofile, src ];
      execProgram(cmd.zip, args, { cwd: cwd }, cb);
    });
  }
}

function unzip (ifile, odir, cb) {
  if (use7zip) {
    const args = [ 'x', '-o' + odir, ifile ];
    execProgram(cmd.sevenZip, args, null, cb);
  } else {
    const args = [ '-o', ifile, '-d', odir ];
    execProgram(cmd.unzip, args, null, cb);
  }
}

function xcaToIpa (ifile, odir, cb) {
  const args = [ '-exportArchive', '-exportFormat', 'ipa', '-archivePath', ifile, '-exportPath', odir ];
  execProgram(cmd.xcodebuild, args, null, cb);
}

function insertLibrary (lib, bin, out, cb) {
  try {
    const machoMangle = require('macho-mangle');
    try {
      const src = fs.readFileSync(bin);
      const dst = machoMangle(src, {
        type: 'load_dylib',
        name: lib
      });
      fs.writeFileSync(out, dst);
      console.log('Library inserted');
      cb();
    } catch (error) {
      return cb(error);
    }
  } catch (_) {
    const args = [ '--all-yes', lib, bin, bin ];
    execProgram(cmd.insert_dylib, args, null, (error, stdout) => {
      if (error) {
        return cb(error);
      }
      cb();
    });
  }
}

function getIdentities (cb) {
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

function lipoFile (file, arch, cb) {
  const args = [ file, '-thin', arch, '-output', file ];
  execProgram(cmd.lipo, args, null, cb);
}

function setOptions (obj) {
  if (typeof obj.use7zip !== 'undefined') {
    use7zip = obj.use7zip;
  }
  if (typeof obj.useOpenSSL !== 'undefined') {
    useOpenSSL = obj.useOpenSSL;
  }
}

[ findInPath,
  codesign,
  verifyCodesign,
  getEntitlementsFromMobileProvision,
  getMobileProvisionPlist,
  zip,
  unzip,
  xcaToIpa,
  getIdentities,
  insertLibrary,
  lipoFile,
  setOptions
].forEach(function (x) {
  module.exports[x.name] = x;
});
