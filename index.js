'use strict';

const fs = require('fs-extra');
const macho = require('macho');
const walk = require('fs-walk');
const rimraf = require('rimraf');
const fatmacho = require('fatmacho');
const plist = require('simple-plist');
const childproc = require('child_process');

function execProgram (bin, arg, opt, cb) {
  if (opt === null) {
    opt = {};
  }
  opt.maxBuffer = 1024 * 1024;
  return childproc.execFile(bin, arg, opt, cb);
}

function isBinaryEncrypted (path) {
  const data = fs.readFileSync(path);
  try {
    const exec = macho.parse(data);
  } catch (e) {
    try {
      fatmacho.parse(data).forEach((bin) => {;
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

function getResignedFilename (path) {
  if (!path) return null;
  const newPath = path.replace('.ipa', '-resigned.ipa');
  const pos = newPath.lastIndexOf('/');
  if (pos !== -1) return newPath.substring(pos + 1);
  return newPath;
}

function getExecutable(appdir, exename) {
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

/*
  TODO: verify is mobileprovision app-id glob string matches the bundleid
  read provision file in raw
  search for application-identifier and <string>...</string>
  check if prefix matches and last dot separated word is an asterisk
  const identifierInProvisioning = 'x'
  Read the one in Info.plist and compare with bundleid
*/
function checkProvision(appdir, file, next) {
  if (!file || !appdir) {
    return next();
  }
  const provision = 'embedded.mobileprovision';
  const mobileProvision = [ appdir, provision ].join('/');
  fs.copy(file, mobileProvision, next);
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

function relativeUpperDirectory (file) {
  return ((file[0] !== '/') ? '../' : '') + file;
}

function upperDirectory(file) {
  const slash = file.replace(/\/$/,'').lastIndexOf('/');
  if (slash != -1) {
    return file.substring(0, slash) + '/';
  }
  return file + '/';
}

class EventHandler {
  constructor() {
    this.cb = {};
    this.queue = {};
  }
  on(ev, cb) {
    this.cb[ev] = cb;
    if (typeof this.queue[ev] === 'object') {
      this.queue[ev].forEach(cb);
    }
    return this;
  }
  emit(ev, msg) {
    const cb = this.cb[ev];
    if (typeof cb === 'function') {
      return cb(msg);
    }
    if (typeof this.queue[ev] !== 'object') {
      this.queue[ev] = [];
    }
    this.queue[ev].push(msg);
    return false;
  }
}

class ApplesignSession {

  constructor(state) {
    this.config = JSON.parse(JSON.stringify(state));
    this.events = new EventHandler(this.config);
  }

  /* Event Wrapper API with cb support */
  emit(ev, msg, cb) {
    function isEnder(ev) {
      return (ev === 'error' || ev === 'done');
    }
    if (isEnder(ev) && msg && typeof cb === 'function') {
      cb(msg);
    }
    return this.events.emit(ev, msg);
  }

  on(ev, cb) {
    return this.events.on(ev, cb);
  }

  /* Public API */
  signIPA(cb) {
    const self = this;
    self.cleanup((error) => {
      self.unzip(self.config.file, self.config.outdir, (error) => {
        if (error) { return self.emit('error', error, cb); }
        self.signAppDirectory(self.config.outdir + '/Payload', (error, res) => {
          if (error) { self.emit('error', error, cb); }
          self.ipafyDirectory((error, res) => {
            if (error) { self.emit('error', error, cb); }
            self.cleanup((ignored_error) => {
              self.emit('done', '', cb);
              cb(ignored_error, res);
            });
          });
        });
      });
    });
    return this;
  }

  signAppDirectory(path, next) {
    const self = this;
    if (!path) {
      path = self.config.outdir + '/Payload';
    }
    /* W T F */
    try {
      if (!fs.lstatSync(path).isDirectory()) {
        throw new Error('Invalid IPA');
      }
    } catch (e) {
      return self.cleanup(next);
    }
    self.emit('message', 'Payload found');
    const files = fs.readdirSync(path).filter((x) => {
      return x.indexOf('.app') !== -1;
    });
    if (files.length !== 1) {
      return next('Invalid IPA');
    }
    self.config.appdir = [ path, files[0] ].join('/');
    const binname = getExecutable(self.config.appdir, files[0].replace('.app', ''));
    const binpath = [ self.config.appdir, binname ].join('/');
    if (fs.lstatSync(binpath).isFile()) {
      const isEncrypted = isBinaryEncrypted(binpath);
      if (isEncrypted) {
        return next('ipa is encrypted');
      }
      self.emit('message', 'Main IPA executable is not encrypted');

      const infoPlist = [ self.config.appdir, 'Info.plist' ].join('/');

      self.fixPlist(infoPlist, self.config.bundleid, (err) => {
        if (err) return self.emit('error', err, next);
        checkProvision(self.config.appdir, self.config.mobileprovision, (err) => {
          if (err) return self.emit('error', err, next);
          self.fixEntitlements(binpath, (err) => {
            if (err) return self.emit('error', err, next);
            self.signFile(binpath, (err) => {
              if (err) return self.emit('error', err, next);
              self.signLibraries(self.config.appdir, next);
            });
          });
        });
      });
    } else {
      cb('Invalid path');
    }
  }

  fixEntitlements(file, next) {
    const self = this;
    if (!this.config.security || !this.config.mobileprovision) {
      return next();
    }
    self.emit('message', 'Generating entitlements');
    const args = [ 'cms', '-D', '-i', this.config.mobileprovision ];
    execProgram(config.security, args, null, (error, stdout, stderr) => {
      const data = plist.parse(stdout);
      const newEntitlements = data[ 'Entitlements' ];
      self.emit('message', JSON.stringify(newEntitlements));
      /* save new entitlements */
      const provision = 'embedded.mobileprovision';
      const pl_path = [ self.config.appdir, provision ].join('/');
      config.entitlement = pl_path;
      plist.writeFileSync(pl_path, newEntitlements);
      next(error, stdout || stderr);
    });
  };

  fixPlist (file, bundleid, next) {
    const appdir = this.config.appdir;
    if (!file || !appdir) {
      return next('Invalid parameters for fixPlist');
    }
    if (bundleid) {
      const pl_path = [ config.appdir, file ].join('/');
      const data = plist.readFileSync(pl_path);
      const oldBundleID = data['CFBundleIdentifier'];
  
      this.emit('message', 'Rebundle ' + pl_path + ' ' + oldBundleID + ' into ' + bundleid);
  
      data['CFBundleIdentifier'] = bundleid;
      plist.writeFileSync(pl_path, data);
    }
    next();
  }

  signFile(file, next) {
    const args = [ '--no-strict' ]; // http://stackoverflow.com/a/26204757
    const self = this;
    if (self.config.identity !== undefined) {
      args.push('-fs', self.config.identity);
    } else {
      return next('--identity is required to sign');
    }
    if (self.config.entitlement !== undefined) {
      args.push('--entitlements=' + self.config.entitlement);
    }
    self.emit('message', 'Sign ' + file);
    args.push(file);
    execProgram(self.config.codesign, args, null, function (error, stdout, stderr) {
      /* use the --no-strict to avoid the "resource envelope is obsolete" error */
      if (error) {
        return self.emit('error', error, next);
      }
      const args = ['-v', '--no-strict', file];
      self.emit('message', 'Verify ' + file);
      execProgram(self.config.codesign, args, null, (error, stdout, stderr) => {
        next(error, stdout || stderr);
      });
    });
  }

  signLibraries(path, next) {
    const self = this;
    let signs = 0;
    let errors = 0;
    let found = false;

    this.emit('message', 'Signing libraries and frameworks');

    const exe = '/' + getExecutable(self.config.appdir);
    walk.walkSync(path, (basedir, filename, stat) => {
      const file = [ basedir, filename ].join('/');
      if (file.endsWith (exe)) {
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
          self.signFile(file, (err) => {
            signs--;
            if (err) {
              self.emit('error ', err);
              errors++;
            }
            if (signs === 0) {
              if (errors > 0) {
                self.emit('error', 'Warning: Some (' + errors + ') errors happened.');
              } else {
                self.emit('message', 'Everything seems signed now');
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

  cleanup(cb) {
    this.emit('message', 'Cleaning up ' + this.config.outdir);
    try {
      rimraf(this.config.outdir, cb);
    } catch (e) {
      this.emit('error', e);
    }
  }

  ipafyDirectory(next) {
    const self = this;
    const ipa_in = self.config.file;
    const ipa_out = upperDirectory(self.config.outdir) + self.config.outfile;
    const args = [ '-qry', ipa_out, 'Payload' ];
    self.events.emit('message', 'Zipifying into ' + ipa_out + ' ...');
    execProgram(self.config.zip, args, { cwd: self.config.outdir }, (error, stdout, stderr) => {
      if (self.config.replaceipa) {
        self.events.emit('message', 'mv into ' + ipa_in);
        return fs.rename (ipa_out, ipa_in, next);
      }
      next();
    });
  }

  setFile(name) {
    this.config.file = name;
    this.config.outdir = name + '.d';
    if (!this.config.outfile) {
      this.setOutputFile(getResignedFilename(name));
    }
  }

  setOutputFile(name) {
    this.config.outfile = name;
  }

  unzip(file, outdir, cb) {
    const self = this;
    if (!file || !outdir) {
      cb(true, 'No output specified');
      return false;
    }
    const args = [ '-o', file, '-d', outdir ];
    if (!outdir) {
      cb(true, 'Invalid output directory');
      return false;
    }
    self.events.emit('message', ['rimraf', outdir].join(' '));
    rimraf(outdir, function (ignored_error) {
      self.events.emit('message', self.config.unzip + ' ' + args.join(' '));
      execProgram(self.config.unzip, args, null, (error, out, err) => {
        if (error) {
          /* remove outdir created by unzip */
          rimraf(outdir, (e) => { cb(error.message); });
        } else {
          cb(undefined, out);
        }
      });
    });
  }
}

module.exports = class Applesign {
  constructor(options) {
    this.config = this.withConfig(options);
  }

  withConfig (opt) {
    if (typeof opt !== 'object') {
      opt = {};
    }
    return {
      file : opt.file || undefined,
      outdir : opt.outdir || opt.file + '.d',
      outfile : opt.outfile || getResignedFilename(opt.file || undefined),
      zip : opt.zip || '/usr/bin/zip',
      unzip : opt.unzip || '/usr/bin/unzip',
      codesign : opt.codesign || '/usr/bin/codesign',
      security : opt.codesign || '/usr/bin/security',
      entitlement : opt.entitlement || undefined,
      bundleid : opt.bundleid || undefined,
      identity : opt.identity || undefined,
      replaceipa : opt.replaceipa || undefined,
      mobileprovision : opt.mobileprovision || undefined
    }
  }

  signIPA(file, cb) {
    const s = new ApplesignSession(this.config);
    if (typeof cb === 'function') {
      if (typeof file === 'string') {
        s.setFile(file);
      } else {
        throw Error('sarandunga');
      }
    } else {
      cb = file;
    }
    return s.signIPA(cb);
  }

  getIdentities(cb) {
    const args = [ 'find-identity', '-v', '-p', 'codesigning' ];
    execProgram(this.config.security, args, null, (error, stdout, stderr) => {
      if (error) {
        return cb(error, stderr);
      }
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
    });
  }
}
