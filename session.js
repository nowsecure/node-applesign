'use strict';

const fs = require('fs-extra');
const macho = require('macho');
const walk = require('fs-walk');
const rimraf = require('rimraf');
const tools = require('./tools');
const plist = require('simple-plist');
const fatmacho = require('fatmacho');
const EventEmitter = require('events').EventEmitter;

function getResignedFilename (path) {
  if (!path) return null;
  const newPath = path.replace('.ipa', '-resigned.ipa');
  const pos = newPath.lastIndexOf('/');
  if (pos !== -1) return newPath.substring(pos + 1);
  return newPath;
}

function isBinaryEncrypted (path) {
  const data = fs.readFileSync(path);
  try {
    macho.parse(data);
  } catch (e) {
    try {
      fatmacho.parse(data).forEach((bin) => {
        macho.parse(bin.data).cmds.forEach((cmd) => {
          if (cmd.type === 'encryption_info' && cmd.id) {
            return true;
          }
        });
      });
    } catch (e) {
      /* console.error(path, e); */
    }
  }
  return false;
}

function getExecutable (appdir, exename) {
  if (appdir) {
    const plistPath = [ appdir, 'Info.plist' ].join('/');
    const plistData = plist.readFileSync(plistPath);
    const cfBundleExecutable = plistData['CFBundleExecutable'];
    if (cfBundleExecutable) {
      return cfBundleExecutable;
    }
  }
  return exename;
}

function upperDirectory (file) {
  const slash = file.replace(/\/$/, '').lastIndexOf('/');
  if (slash !== -1) {
    return file.substring(0, slash) + '/';
  }
  return file + '/';
}

function isMacho (buffer) {
  const magics = [
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

/*
  TODO: verify is mobileprovision app-id glob string matches the bundleid
  read provision file in raw
  search for application-identifier and <string>...</string>
  check if prefix matches and last dot separated word is an asterisk
  const identifierInProvisioning = 'x'
  Read the one in Info.plist and compare with bundleid
*/
function checkProvision (appdir, file, next) {
  if (file && appdir) {
    const provision = 'embedded.mobileprovision';
    const mobileProvision = [ appdir, provision ].join('/');
    return fs.copy(file, mobileProvision, next);
  }
  next();
}

module.exports = class ApplesignSession {
  constructor (state) {
    this.config = JSON.parse(JSON.stringify(state));
    this.events = new EventEmitter();
    this.events.config = this.config;
  }

  /* Event Wrapper API with cb support */
  emit (ev, msg, cb) {
    function isEnder (ev) {
      return (ev === 'error');
    }
    if (isEnder(ev) && msg && typeof cb === 'function') {
      cb(msg);
    }
    return this.events.emit(ev, msg);
  }

  on (ev, cb) {
    this.events.on(ev, cb);
    return this;
  }

  /* Public API */
  signIPA (cb) {
    this.unzip(this.config.file, this.config.outdir, (error) => {
      if (error) { return this.emit('error', error, cb); }
      this.signAppDirectory(this.config.outdir + '/Payload', (error, res) => {
        if (error) { this.emit('error', error, cb); }
        this.ipafyDirectory((error, res) => {
          if (error) { this.emit('error', error, cb); }
          this.cleanup((ignored_error) => {
            cb(ignored_error, res);
          });
        });
      });
    });
    return this;
  }

  signAppDirectory (path, next) {
    if (!path) {
      path = this.config.outdir + '/Payload';
    }
    /* W T F */
    try {
      if (!fs.lstatSync(path).isDirectory()) {
        throw new Error('Invalid IPA');
      }
    } catch (e) {
      return this.cleanup(() => {
        next(e.message);
      });
    }
    this.emit('message', 'Payload found');
    const files = fs.readdirSync(path).filter((x) => {
      return x.indexOf('.app') !== -1;
    });
    if (files.length !== 1) {
      return next('Invalid IPA');
    }
    this.config.appdir = [ path, files[0] ].join('/');
    const binname = getExecutable(this.config.appdir, files[0].replace('.app', ''));
    const binpath = [ this.config.appdir, binname ].join('/');
    if (fs.lstatSync(binpath).isFile()) {
      const isEncrypted = isBinaryEncrypted(binpath);
      if (isEncrypted) {
        return next('ipa is encrypted');
      }
      this.emit('message', 'Main IPA executable is not encrypted');

      const infoPlist = [ this.config.appdir, 'Info.plist' ].join('/');

      this.fixPlist(infoPlist, this.config.bundleid, (err) => {
        if (err) return this.emit('error', err, next);
        checkProvision(this.config.appdir, this.config.mobileprovision, (err) => {
          if (err) return this.emit('error', err, next);
          this.fixEntitlements(binpath, (err) => {
            if (err) return this.emit('error', err, next);
            this.signFile(binpath, (err) => {
              if (err) return this.emit('error', err, next);
              this.signLibraries(this.config.appdir, next);
            });
          });
        });
      });
    } else {
      next('Invalid path');
    }
  }

  fixEntitlements (file, next) {
    if (!this.config.mobileprovision) {
      return next();
    }
    this.emit('message', 'Grabbing entitlements from mobileprovision');
    tools.getEntitlementsFromMobileProvision(this.config.mobileprovision, (error, newEntitlements) => {
      this.emit('message', JSON.stringify(newEntitlements));
      const provision = 'embedded.mobileprovision';
      const pathToProvision = [ this.config.appdir, provision ].join('/');
      this.config.entitlement = pathToProvision;
      plist.writeFileSync(pathToProvision, newEntitlements);
      next(error);
    });
  }

  fixPlist (file, bundleid, next) {
    const appdir = this.config.appdir;
    if (!file || !appdir) {
      return next('Invalid parameters for fixPlist');
    }
    if (bundleid) {
      const pl_path = [ this.config.appdir, file ].join('/');
      const data = plist.readFileSync(pl_path);
      const oldBundleID = data['CFBundleIdentifier'];
      this.emit('message', 'Rebundle ' + pl_path + ' ' + oldBundleID + ' into ' + bundleid);
      data['CFBundleIdentifier'] = bundleid;
      plist.writeFileSync(pl_path, data);
    }
    next();
  }

  signFile (file, next) {
    this.emit('message', 'Sign ' + file);
    tools.codesign(this.config.identity, this.config.entitlement, file, (error, stdout, stderr) => {
      if (error) {
        return this.emit('error', error, next);
      }
      this.emit('message', 'Verify ' + file);
      tools.verifyCodesign(file, (error, stdout, stderr) => {
        next(error, stdout || stderr);
      });
    });
  }

  signLibraries (path, next) {
    let signs = 0;
    let errors = 0;
    let found = false;

    this.emit('message', 'Signing libraries and frameworks');

    const exe = '/' + getExecutable(this.config.appdir);
    walk.walkSync(path, (basedir, filename, stat) => {
      const file = [ basedir, filename ].join('/');
      if (file.endsWith(exe)) {
        found = true;
        return;
      }
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
          this.signFile(file, (err) => {
            signs--;
            if (err) {
              this.emit('error ', err);
              errors++;
            }
            if (signs === 0) {
              if (errors > 0) {
                this.emit('error', 'Warning: Some (' + errors + ') errors happened.');
              } else {
                this.emit('message', 'Everything seems signed now');
              }
              next();
            }
          });
        }
        fs.close(fd);
      } catch (e) {
        console.error(basedir, filename, e);
        next(e);
      }
    });
    if (!found) {
      next('Cannot find any MACH0 binary to sign');
    }
  }

  cleanup (cb) {
    const outdir = this.config.outdir;
    this.emit('message', 'Cleaning up ' + outdir);
    try {
      rimraf(outdir, cb);
    } catch (e) {
      this.emit('error', e);
    }
  }

  ipafyDirectory (next) {
    const ipa_in = this.config.file;
    const ipa_out = upperDirectory(this.config.outdir) + this.config.outfile;
    this.events.emit('message', 'Zipifying into ' + ipa_out + ' ...');
    tools.zip(this.config.outdir, ipa_out, 'Payload', (error) => {
      if (!error && this.config.replaceipa) {
        this.events.emit('message', 'mv into ' + ipa_in);
        return fs.rename(ipa_out, ipa_in, next);
      }
      next(error);
    });
  }

  setFile (name) {
    if (typeof name === 'string') {
      this.config.file = name;
      this.config.outdir = name + '.d';
      if (!this.config.outfile) {
        this.setOutputFile(getResignedFilename(name));
      }
    }
  }

  setOutputFile (name) {
    this.config.outfile = name;
  }

  /* TODO: move to tools.js */
  unzip (file, outdir, cb) {
    if (!file || !outdir) {
      cb(true, 'No output specified');
      return false;
    }
    if (!outdir) {
      cb(true, 'Invalid output directory');
      return false;
    }
    this.events.emit('message', ['rm -rf', outdir].join(' '));
    this.cleanup(() => {
      this.events.emit('message', 'Unzipping ' + file);
      tools.unzip(file, outdir, (error, stdout) => {
        if (error) {
          this.cleanup(() => { cb(error.message); });
        } else {
          cb(undefined, stdout);
        }
      });
    });
  }
};
