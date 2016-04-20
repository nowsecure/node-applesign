'use strict';

const fs = require('fs-extra');
const macho = require('macho');
const walk = require('fs-walk');
const rimraf = require('rimraf');
const fatmacho = require('fatmacho');
const plist = require('simple-plist');
const colors = require('colors/safe');
const childproc = require('child_process');

colors.setTheme({
  error: 'red',
  warn: 'green',
  msg: 'yellow'
});

const BIG = colors.msg;
const MSG = colors.warn;
const ERR = colors.error;

var codesign = {};

function execProgram (bin, arg, cb) {
  return childproc.execFile(bin, arg, {
    maxBuffer: 1024 * 1024
  }, cb);
}

function log () {
  var args = [];
  for (var a of arguments) {
    args.push(a);
  }
  if (typeof arguments[0] === 'function') {
    console.log(arguments[0](args.slice(1).join(' ').trim()));
  } else {
    console.error(colors.error('[ERROR] ' + args.join(' ').trim()));
  }
}

function isBinaryEncrypted (path) {
  const data = fs.readFileSync(path);
  try {
    const exec = macho.parse(data);
    console.log(exec);
  } catch (e) {
    try {
      const fat = fatmacho.parse(data);
      for (let bin of fat) {
        const exec = macho.parse(bin.data);
        for (let cmd of exec.cmds) {
          if (cmd.type === 'encryption_info') {
            console.log(cmd);
            if (cmd.id) {
              return true;
            }
          }
        }
      }
    } catch (e) {
      console.error(path, e);
    }
  }
  return false;
}

function getResignedFilename (path) {
  const newPath = path.replace('.ipa', '-resigned.ipa');
  const pos = newPath.lastIndexOf('/');
  if (pos !== -1) return newPath.substring(pos + 1);
  return newPath;
}

codesign.withConfig = function (options) {
  if (!options || !options.file) {
    log(ERR, '[$] No config file specified');
    return false;
  }
  var config = { file: options.file };
  config.outdir = options.outdir || options.file + '.d';
  config.outfile = options.outfile || getResignedFilename(config.file);
  config.zip = options.zip || '/usr/bin/zip';
  config.unzip = options.unzip || '/usr/bin/unzip';
  config.codesign = options.codesign || '/usr/bin/codesign';
  config.security = options.codesign || '/usr/bin/security';
  config.entitlement = options.entitlement || undefined;
  config.bundleid = options.bundleid || undefined;
  config.identity = options.identity || undefined;
  config.mobileprovision = options.mobileprovision || undefined;
  return config;
};

function unzip (file, config, cb) {
  if (!file || !config.outdir) {
    cb(true, 'No output specified');
    return false;
  }
  const args = [ '-o', file, '-d', config.outdir ];
  if (!config.outdir) {
    cb(true, 'Invalid output directory');
    return false;
  }
  log(BIG, ['[$] rimraf', config.outdir].join(' '));
  rimraf(config.outdir, function () {
    log(BIG, '[$] ' + config.unzip + ' ' + args.join(' '));
    execProgram(config.unzip, args, (rc, out, err) => {
      if (rc) {
        /* remove outdir created by unzip */
        rimraf(config.outdir, function () {
          cb(rc, out, err || rc);
        });
      } else {
        cb(rc, out || rc, err || rc);
      }
    });
  });
}

codesign.getExecutable = function (config, exename) {
  if (config.appdir) {
    const plistPath = [ config.appdir, 'Info.plist' ].join('/');
    const plistData = plist.readFileSync(plistPath);
    const cfBundleExecutable = plistData['CFBundleExecutable'];
    if (cfBundleExecutable) {
      return cfBundleExecutable;
    }
  }
  return exename;
};

codesign.fixPlist = function (file, config, cb) {
  if (!file || !config.bundleid || !config.appdir) {
    log(MSG, '[-] Skip bundle-id');
    return cb(false);
  }
  const pl_path = [ config.appdir, file ].join('/');
  console.log(pl_path);
  const data = plist.readFileSync(pl_path);
  const oldBundleID = data['CFBundleIdentifier'];
  /* fix bundle-id */
  log(MSG, 'CFBundleResourceSpecification:', data['CFBundleResourceSpecification']);
  log(MSG, 'Old BundleID:', oldBundleID);
  log(MSG, 'New BundleID:', config.bundleid);
  data['CFBundleIdentifier'] = config.bundleid;
  plist.writeFileSync(pl_path, data);
  cb(false, '');
};

codesign.checkProvision = function (file, config, cb) {
  if (!file || !config.appdir) {
    return cb(false);
  }
  const provision = 'embedded.mobileprovision';
  const pl_path = [ config.appdir, provision ].join('/');
  fs.copy(file, pl_path, function (err) {
/*
  TODO: verify is mobileprovision app-id glob string matches the bundleid
  read provision file in raw
  search for application-identifier and <string>...</string>
  check if prefix matches and last dot separated word is an asterisk
  const identifierInProvisioning = 'x'
  Read the one in Info.plist and compare with bundleid
*/
    cb(err, err);
  });
};

codesign.fixEntitlements = function (file, config, cb) {
  log(BIG, '[*] Generating entitlements');
  if (!config.security || !config.mobileprovision) {
    return cb(false);
  }
  const args = [ 'cms', '-D', '-i', config.mobileprovision ];
  execProgram(config.security, args, (error, stdout, stderr) => {
    const data = plist.parse(stdout);
    const newEntitlements = data[ 'Entitlements' ];
    console.log(newEntitlements);
    /* save new entitlements */
    const provision = 'embedded.mobileprovision';
    const pl_path = [ config.appdir, provision ].join('/');
    config.entitlement = pl_path;
    plist.writeFileSync(pl_path, newEntitlements);
    // log(MSG, stdout + stderr);
    cb(error, stdout || stderr);
  });
};

codesign.signFile = function (file, config, cb) {
  const args = [ '--no-strict' ]; // http://stackoverflow.com/a/26204757
  if (config.identity !== undefined) {
    args.push('-fs', config.identity);
  } else {
    cb(true, '--identity is required to sign');
  }
  if (config.entitlement !== undefined) {
    args.push('--entitlements=' + config.entitlement);
  }
  log(BIG, '[-] Sign', file);
  args.push(file);
  execProgram(config.codesign, args, function (error, stdout, stderr) {
    /* use the --no-strict to avoid the "resource envelope is obsolete" error */
    if (error) return cb(error, stdout || stderr);
    const args = ['-v', '--no-strict', file];
    log(BIG, '[-] Verify', file);
    execProgram(config.codesign, args, (error, stdout, stderr) => {
      cb(error, stdout || stderr);
    });
  });
};

function isMacho (buffer) {
  const magics = [
    [0xca, 0xfe, 0xba, 0xbe], // fat
    [0xca, 0xfe, 0xba, 0xbe], // fat
    [0xce, 0xfa, 0xed, 0xfe], // 32bit
    [0xcf, 0xfa, 0xed, 0xfe], // 64bit
    [0xfe, 0xed, 0xfa, 0xce]  // big-endian
  ];
  for (let a of magics) {
    if (!buffer.compare(Buffer(a))) {
      return true;
    }
  }
  return false;
}

codesign.signLibraries = function (path, config, cb) {
  let signs = 0;
  log(MSG, 'Signing libraries and frameworks');
  let found = false;
  walk.walkSync(path, (basedir, filename, stat, next) => {
    const file = [ basedir, filename ].join('/');
    if (!fs.lstatSync(file).isFile()) {
      return;
    }
    try {
      const fd = fs.openSync(file, 'r');
      let buffer = new Buffer(4);
      fs.readSync(fd, buffer, 0, 4);
      if (isMacho(buffer)) {
        found = true;
        signs++;
        codesign.signFile(file, config, () => {
          signs--;
          if (signs === 0) {
            log(MSG, 'Everything is signed now');
            cb(false);
          }
        });
      }
      fs.close(fd);
    } catch (e) {
      console.error(basedir, filename, e);
    }
  });
  if (!found) {
    cb(true, 'Cannot find any MACH0 binary to sign');
  }
};

codesign.signAppDirectory = function (path, config, cb) {
  if (cb === undefined && typeof config === 'function') {
    cb = config;
    config = {};
  }
  try {
    if (!fs.lstatSync(config.outdir + '/Payload').isDirectory()) {
      throw new Error('Invalid IPA');
    }
  } catch (e) {
    return codesign.cleanup(config, () => {
      cb(true, 'Invalid IPA');
    });
  }
  log(BIG, '[*] Payload found');
  const files = fs.readdirSync(config.outdir + '/Payload').filter((x) => {
    return x.indexOf('.app') !== -1;
  });
  if (files.length !== 1) {
    return cb(true, 'Invalid IPA');
  }
  config.appdir = [ config.outdir, 'Payload', files[0] ].join('/');
  const binname = codesign.getExecutable(config, files[0].replace('.app', ''));
  const binpath = [ config.appdir, binname ].join('/');
  if (fs.lstatSync(binpath).isFile()) {
    const isEncrypted = isBinaryEncrypted(binpath);
    if (isEncrypted) {
      return cb(new Error('ipa is encrypted'));
    }
    log(MSG, '[*] Executable is not encrypted');
    codesign.fixPlist('Info.plist', config, (err, reason) => {
      if (err) return cb(err, reason);
      codesign.checkProvision(config.mobileprovision, config, (err, reason) => {
        if (err) return cb(err, reason);
        codesign.fixEntitlements(binpath, config, (err, reason) => {
          if (err) return cb(err, reason);
          codesign.signFile(binpath, config, (err, reason) => {
            if (err) return cb(err, reason);
            codesign.signLibraries(config.appdir, config, cb);
          });
        });
      });
    });
  } else {
    cb(true, 'Invalid path');
  }
};

function relativeUpperDirectory (file) {
  return ((file[0] !== '/') ? '../' : '') + file;
}

codesign.cleanup = function (config, cb) {
  rimraf(config.outdir, cb);
};

codesign.ipafyDirectory = function (config, cb) {
  const zipfile = relativeUpperDirectory(config.outfile);
  const args = [ '-qry', zipfile, 'Payload' ];
  execProgram(config.zip, args, { cwd: config.outdir }, (error, stdout, stderr) => {
    cb(error, stdout || stderr);
  });
};

codesign.getIdentities = function (config, cb) {
  const args = [ 'find-identity', '-v', '-p', 'codesigning' ];
  execProgram(config.security, args, (error, stdout, stderr) => {
    if (error) {
      cb(error, stderr);
    } else {
      const lines = stdout.split('\n');
      lines.pop(); // remove last line
      let ids = [];
      for (let line of lines) {
        const tok = line.indexOf(') ');
        if (tok !== -1) {
          line = line.substring(tok + 2).trim();
          const tok2 = line.indexOf(' ');
          if (tok2 !== -1) {
            ids.push({
              'hash': line.substring(0, tok2),
              'name': line.substring(tok2 + 1)
            });
          }
        }
      }
      cb(false, ids);
    }
  });
};

codesign.signIPA = function (config, cb) {
  rimraf(config.outdir, () => {
    unzip(config.file, config, (error, stdout, stderr) => {
      if (error) {
        return cb(error, stderr);
      }
      codesign.signAppDirectory(config.outdir, config, (error, res) => {
        if (error) {
          return cb(error, res);
        }
        codesign.ipafyDirectory(config, (error, res) => {
          if (error) {
            cb(error, res);
          }
          codesign.cleanup(config, () => {
            log(BIG, '[-] Removing temporary directory');
            cb(error, res);
          });
        });
      });
    });
  });
};

module.exports = function (options) {
  const self = this;
  this.config = codesign.withConfig(options);
  this.signIPA = function (cb) {
    codesign.signIPA(self.config, cb);
  };
  this.cleanup = function (cb) {
    codesign.cleanup(self.config, cb);
  };
  this.getIdentities = function (cb) {
    codesign.getIdentities(self.config, cb);
  };
  this.logError = log;
};
