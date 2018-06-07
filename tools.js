'use strict';

/* private */

const childproc = require('child_process');
const plist = require('simple-plist');
const which = require('which');
const fs = require('fs');

var use7zip = false;
var useOpenSSL = false;

const cmd = {
  '7z': '/usr/local/bin/7z',
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
  let _out = Buffer.alloc(0);
  let _err = Buffer.alloc(0);
  const child = childproc.spawn(bin, arg, opt || {});
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
      return cb(new Error(msg), '', '');
    }
    cb(null, _out.toString(), _err.toString());
  });
}

/* public */

function findInPath (cb, user) {
  const keys = Object.keys(cmd);
  let pending = keys.length;
  for (let key of keys) {
    which(key, function (err, loc) {
      if (err !== undefined) {
        cmd[key] = loc;
        if (--pending === 0) {
          cb(err, user);
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
  function parseMobileProvisioning (error, stdout) {
    if (error) {
      return cb(error);
    }
    if (stdout === '') {
      const msg = `Empty entitlements for ${file}.\nAre you providing a mobile provisioning with -m?`;
      cb(new Error(msg));
    } else {
      try {
        cb(null, plist.parse(stdout));
      } catch (e) {
        cb(e);
      }
    }
  }
  if (useOpenSSL === true) {
    try {
      /* portable using openssl */
      const args = [ 'cms', '-in', file, '-inform', 'der', '-verify' ];
      execProgram(cmd.openssl, args, null, parseMobileProvisioning);
    } catch (e) {
      cb(e);
    }
  } else {
    try {
      /* OSX specific using security */
      const args = [ 'cms', '-D', '-i', file ];
      execProgram(cmd.security, args, null, parseMobileProvisioning);
    } catch (e) {
      cb(e);
    }
  }
}

function getEntitlementsFromMobileProvision (file, cb) {
  return getMobileProvisionPlist(file, (e, o) => {
    return e ? cb(e, o) : cb(e, o['Entitlements']);
  });
}

function zip (cwd, ofile, src, cb) {
  if (use7zip) {
    fs.unlink(ofile, () => {
      const zipFile = ofile + '.zip';
      const args = [ 'a', zipFile, src ];
      execProgram(cmd['7z'], args, { cwd: cwd }, (error, message) => {
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
    const args = [ 'x', '-y', '-o' + odir, ifile ];
    return execProgram(cmd['7z'], args, null, cb);
  }
  const args = [ '-o', ifile, '-d', odir ];
  execProgram(cmd.unzip, args, null, cb);
}

function xcaToIpa (ifile, odir, cb) {
  const args = [ '-exportArchive', '-exportFormat', 'ipa', '-archivePath', ifile, '-exportPath', odir ];
  execProgram(cmd.xcodebuild, args, null, cb);
}

function insertLibrary (lib, bin, out, cb) {
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
      cb();
    } catch (error) {
      return cb(error);
    }
  } catch (_) {
    const args = [ '--strip-codesig', '--all-yes', lib, bin, bin ];
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
    lines.filter(entry => {
      return entry.indexOf('CSSMERR_TP_CERT_REVOKED') === -1;
    }).forEach((line) => {
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
    cb(null, ids);
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
