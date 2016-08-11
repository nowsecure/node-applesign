'use strict';

const path = require('path');
const fs = require('fs-extra');
const walk = require('fs-walk');
const rimraf = require('rimraf');
const tools = require('./tools');
const plist = require('simple-plist');
const depSolver = require('./depsolver');
const plistBuild = require('plist').build;
const EventEmitter = require('events').EventEmitter;
const isEncryptedSync = require('macho-is-encrypted');
const machoEntitlements = require('macho-entitlements');

function getResignedFilename (path) {
  if (!path) return null;
  const newPath = path.replace('.ipa', '-resigned.ipa');
  const pos = newPath.lastIndexOf(path.sep);
  if (pos !== -1) return newPath.substring(pos + 1);
  return newPath;
}

function parentDirectory (root) {
  return path.normalize(path.join(root, '..'));
}

function getExecutable (appdir, exename) {
  if (appdir) {
    const plistPath = path.join(appdir, 'Info.plist');
    const plistData = plist.readFileSync(plistPath);
    const cfBundleExecutable = plistData['CFBundleExecutable'];
    if (cfBundleExecutable) {
      return cfBundleExecutable;
    }
  }
  return exename;
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

module.exports = class ApplesignSession {
  constructor (state, onEnd) {
    this.config = JSON.parse(JSON.stringify(state));
    this.events = new EventEmitter();
    this.events.config = this.config;
  }

  /* Event Wrapper API with cb support */
  emit (ev, msg, cb) {
    this.events.emit(ev, msg);
    if (typeof cb === 'function') {
      return cb(msg);
    }
  }

  on (ev, cb) {
    this.events.on(ev, cb);
    return this;
  }

  /* Public API */
  signIPA (cb) {
    if (typeof cb === 'function') {
      this.events.removeAllListeners('end');
      this.events.on('end', cb);
    }
    this.unzip(this.config.file, this.config.outdir, (error) => {
      if (error) { return this.emit('end', error); }
      this.signAppDirectory(this.config.outdir + '/Payload', (error, res) => {
        if (error) { return this.emit('end', error); }
        this.zip((error, res) => {
          if (error) { return this.emit('end', error); }
          this.cleanup((_) => {
            this.emit('end');
          });
        });
      });
    });
    return this;
  }

  signAppDirectory (ipadir, next) {
    if (!ipadir) {
      ipadir = path.join(this.config.outdir, 'Payload');
    }
    function isDirectory () {
      try {
        return fs.statSync(ipadir).isDirectory();
      } catch (e) {
        return false;
      }
    }
    if (!isDirectory(ipadir)) {
      return this.cleanup(() => {
        next(new Error('Cannot find ' + ipadir));
      });
    }
    this.emit('message', 'Payload found');
    const files = fs.readdirSync(ipadir).filter((x) => {
      return x.indexOf('.app') === x.length - 4;
    });
    if (files.length !== 1) {
      return next(new Error('Invalid IPA'));
    }
    this.config.appdir = path.join(ipadir, files[0]);
    const binname = getExecutable(this.config.appdir, files[0].replace('.app', ''));
    this.config.appbin = path.join(this.config.appdir, binname);
    if (fs.lstatSync(this.config.appbin).isFile()) {
      if (isEncryptedSync.path(this.config.appbin)) {
        if (!this.config.unfairPlay) {
          return next(new Error('This IPA is encrypted'));
        }
        this.emit('message', 'Main IPA executable is encrypted');
      } else {
        this.emit('message', 'Main IPA executable is not encrypted');
      }
      this.removeWatchApp(() => {
        const infoPlist = path.join(this.config.appdir, 'Info.plist');
        this.fixPlist(infoPlist, this.config.bundleid, (err) => {
          if (err) return this.events.emit('error', err, next);
          this.checkProvision(this.config.appdir, this.config.mobileprovision, (err) => {
            if (err) return this.emit('error', err, next);
            this.fixEntitlements(this.config.appbin, (err) => {
              if (err) return this.emit('error', err, next);
              this.signLibraries(this.config.appbin, this.config.appdir, (err) => {
                if (err) return this.emit('error', err, next);
                next(null, next);
              });
            });
          });
        });
      });
    } else {
      next(new Error('Invalid path'));
    }
  }

  removeWatchApp (cb) {
    if (!this.config.withoutWatchapp) {
      return cb();
    }
    const watchdir = path.join(this.config.appdir, 'Watch');
    this.emit('message', 'Stripping out the WatchApp at ' + watchdir);
    rimraf(watchdir, () => {
      const plugdir = path.join(this.config.appdir, 'PlugIns');
      this.emit('message', 'Stripping out the PlugIns at ' + plugdir);
      rimraf(plugdir, cb);
    });
  }
  /*
    TODO: verify is mobileprovision app-id glob string matches the bundleid
    read provision file in raw
    search for application-identifier and <string>...</string>
    check if prefix matches and last dot separated word is an asterisk
    const identifierInProvisioning = 'x'
    Read the one in Info.plist and compare with bundleid
  */
  checkProvision (appdir, file, next) {
    if (file && appdir) {
      this.emit('message', 'Embedding new mobileprovision');
      const mobileProvision = path.join(appdir, 'embedded.mobileprovision');
      return fs.copy(file, mobileProvision, next);
    }
    next();
  }

  adjustEntitlements (file, entMobProv, next) {
    /* TODO: check if this supports binary plist too */
    const ent = machoEntitlements.parseFile(file);
    const entMacho = plist.parse(ent.toString());
    let changed = false;
    ['application-identifier', 'com.apple.developer.team-identifier'].forEach((id) => {
      if (entMacho[id] !== entMobProv[id]) {
        changed = true;
        entMacho[id] = entMobProv[id];
      }
    });
    if (changed) {
      const newEntitlementsFile = file + '.entitlements';
      fs.writeFileSync(newEntitlementsFile, plistBuild(entMacho).toString());
      this.emit('message', 'Updated binary entitlements' + newEntitlementsFile);
      this.config.entitlement = newEntitlementsFile;
    }
    next();
  }

  fixEntitlements (file, next) {
    if (!this.config.mobileprovision) {
      return next();
    }
    this.emit('message', 'Grabbing entitlements from mobileprovision');
    tools.getEntitlementsFromMobileProvision(this.config.mobileprovision, (error, newEntitlements) => {
      if (error) {
        return next(error);
      }
      this.emit('message', JSON.stringify(newEntitlements));
      const pathToProvision = path.join(this.config.appdir, 'embedded.mobileprovision');
      /* replace ipa's mobileprovision with given the entitlements? */
      plist.writeFileSync(pathToProvision, newEntitlements);
      this.adjustEntitlements(file, newEntitlements, next);
    });
  }

  fixPlist (file, bundleid, next) {
    const appdir = this.config.appdir;
    if (!file || !appdir) {
      return next('Invalid parameters for fixPlist');
    }
    if (bundleid) {
      const data = plist.readFileSync(file);
      const oldBundleID = data['CFBundleIdentifier'];
      this.emit('message', 'Rebundle ' + file + ' : ' + oldBundleID + ' into ' + bundleid);
      data['CFBundleIdentifier'] = bundleid;
      plist.writeFileSync(file, data);
    }
    next();
  }

  signFile (file, next) {
    function codesignHasFailed (config, error, errmsg) {
      if (error && error.message.indexOf('Error:')) {
        return true;
      }
      return ((errmsg && errmsg.indexOf('no identity found') !== -1) || !config.ignoreCodesignErrors);
    }
    this.emit('message', 'Sign ' + file);
    tools.codesign(this.config.identity, this.config.entitlement, this.config.keychain, file, (error, stdout, stderr) => {
      if (error && codesignHasFailed(this.config, error, stderr)) {
        return this.emit('end', error, next);
      }
      if (this.config.verifyTwice) {
        this.emit('message', 'Verify ' + file);
        tools.verifyCodesign(file, this.config.keychain, (error, stdout, stderr) => {
          if (error) {
            if (this.config.ignoreVerificationErrors) {
              return this.emit('warning', error, next);
            }
            return this.emit('error', error, next);
          }
          next(undefined, error);
        });
      } else {
        next(undefined, error);
      }
    });
  }

  signLibraries (bpath, appdir, next) {
    this.emit('message', 'Signing libraries and frameworks');

    const libraries = [];
    const exe = path.sep + getExecutable(this.config.appdir);

    let found = false;
    walk.walkSync(appdir, (basedir, filename, stat) => {
      const file = path.join(basedir, filename);
      if (file.endsWith(exe)) {
        this.emit('message', 'Executable found at ' + file);
        libraries.push(file);
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
          libraries.push(file);
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
    depSolver(bpath, libraries, (err, libs) => {
      if (err) { return next(err); }
      if (libs.length === 0) {
        libs.push(bpath);
      }
      this.emit('message', 'Using tsort signing order method');
      let libsCopy = libs.slice(0);
      const peek = (cb) => {
        if (libsCopy.length === 0) {
          libsCopy = libs.slice(0);
          return cb();
        }
        const lib = libsCopy.pop();
        this.signFile(lib, () => {
          peek(cb);
        });
      };
      peek(() => {
        libsCopy = libs.slice(0);
        const verify = (cb) => {
          if (libsCopy.length === 0) {
            return cb();
          }
          const lib = libsCopy.pop();
          this.emit('message', 'Verifying ' + lib);
          tools.verifyCodesign(lib, null, () => {
            verify(cb);
          });
        };
        verify(next);
      });
    });
  }

  cleanup (cb) {
    const outdir = this.config.outdir;
    this.emit('message', 'Cleaning up ' + outdir);
    try {
      rimraf(outdir, cb);
    } catch (e) {
      this.emit('message', e);
    }
  }

  zip (next) {
    function getOutputPath (cwd, ofile) {
      if (ofile.startsWith(path.sep)) {
        return ofile;
      }
      return path.join(parentDirectory(cwd), ofile);
    }
    const ipaIn = this.config.file;
    const ipaOut = getOutputPath(this.config.outdir, this.config.outfile);
    try {
      fs.unlinkSync(ipaOut);
    } catch (e) {
      /* do nothing */
    }
    const continuation = () => {
      this.events.emit('message', 'Zipifying into ' + ipaOut + ' ...');
      tools.zip(this.config.outdir, ipaOut, 'Payload', (error) => {
        if (!error && this.config.replaceipa) {
          this.events.emit('message', 'mv into ' + ipaIn);
          return fs.rename(ipaOut, ipaIn, next);
        }
        next(error);
      });
    };
    if (this.config.withoutWatchapp) {
      const watchdir = path.join(this.config.appdir, 'Watch');
      this.emit('message', 'Stripping out the WatchApp: ' + watchdir);
      rimraf(watchdir, () => {
        const plugdir = path.join(this.config.appdir, 'PlugIns');
        rimraf(plugdir, continuation);
      });
    } else {
      continuation();
    }
  }

  setFile (name) {
    if (typeof name === 'string') {
      this.config.file = name;
      this.config.outdir = path.resolve(name + '.d');
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
      return cb(new Error('No output specified'));
    }
    if (!outdir) {
      return cb(new Error('Invalid output directory'));
    }
    this.events.emit('message', ['rm -rf', outdir].join(' '));
    this.cleanup(() => {
      this.events.emit('message', 'Unzipping ' + file);
      tools.unzip(file, outdir, (error, stdout) => {
        if (error) {
          this.cleanup(() => { cb(error); });
        } else {
          cb(undefined, stdout);
        }
      });
    });
  }
};
