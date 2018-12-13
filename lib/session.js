'use strict';

const path = require('path');
const uuid = require('uuid');
const fs = require('fs-extra');
const walk = require('fs-walk');
const rimraf = require('rimraf');
const tools = require('./tools');
const plist = require('simple-plist');
const depSolver = require('./depsolver');
const plistBuild = require('plist').build;
const EventEmitter = require('events').EventEmitter;
const isEncryptedSync = require('macho-is-encrypted');
const isBitcodeSync = require('./macho-is-bitcode');
const machoEntitlements = require('macho-entitlements');

const entitlementTemplate = `
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>application-identifier</key>
    <string>FILLME.APPID</string>
    <key>com.apple.developer.team-identifier</key>
    <string>FILLME</string>
    <key>get-task-allow</key>
    <true/>
    <key>keychain-access-groups</key>
    <array>
      <string>FILLME.APPID</string>
    </array>
  </dict>
</plist>
`;

function defaultEntitlements (appid, devid) {
  const ent = plist.parse(entitlementTemplate.trim());
  ent['application-identifier'] = appid;
  ent['com.apple.developer.team-identifier'] = devid;
  ent['keychain-access-groups'] = [ appid ];
  ent['com.apple.developer.ubiquity-kvstore-identifier'] = appid;
  delete ent['aps-environment'];
  ent['com.apple.developer.icloud-container-identifiers'] = 'iCloud.' + devid;
  return plistBuild(ent).toString();
}

function insertLibrary (config, cb) {
  const appDir = config.appdir;
  const targetLib = config.insertLibrary;
  const libraryName = path.basename(targetLib);
  try {
    fs.mkdirSync(path.join(appDir, 'Frameworks'));
  } catch (_) {
  }
  const outputLib = path.join(appDir, 'Frameworks', libraryName);
  try {
    const writeStream = fs.createWriteStream(outputLib);
    writeStream.on('finish', () => {
      fs.chmodSync(outputLib, 0x1ed); // 0755
      /* XXX: if binary doesnt contains an LC_RPATH load command this will not work */
      const insertedLibraryName = '@rpath/' + path.basename(targetLib);
      /* Just copy the library via USB on the DCIM directory */
      // const insertedLibraryName = '/var/mobile/Media/DCIM/' + path.basename(targetLib);
      /* useful on jailbroken devices where we can write in /usr/lib */
      // const insertedLibraryName = '/usr/lib/' + path.basename(targetLib);
      /* forbidden in iOS */
      // const insertedLibraryName = '@executable_path/Frameworks/' + path.basename(targetLib);
      return tools.insertLibrary(insertedLibraryName, config.appbin, outputLib, cb);
    });
    fs.createReadStream(targetLib).pipe(writeStream);
  } catch (e) {
    console.error(e);
  }
}

function getResignedFilename (input) {
  if (!input) {
    return null;
  }
  const pos = input.lastIndexOf(path.sep);
  if (pos !== -1) {
    const tmp = input.substring(pos + 1);
    const dot = tmp.lastIndexOf('.');
    input = (dot !== -1) ? tmp.substring(0, dot) : tmp;
  } else {
    const dot = input.lastIndexOf('.');
    if (dot !== -1) {
      input = input.substring(0, dot);
    }
  }
  return input + '-resigned.ipa';
}

function parentDirectory (root) {
  return path.normalize(path.join(root, '..'));
}

function getExecutable (appdir, exename) {
  if (appdir) {
    const plistPath = path.join(appdir, 'Info.plist');
    try {
      const plistData = plist.readFileSync(plistPath);
      const cfBundleExecutable = plistData['CFBundleExecutable'];
      if (cfBundleExecutable) {
        return cfBundleExecutable;
      }
    } catch (e) {
      // do nothing
    }
  }
  return exename;
}

function isMacho (buffer) {
  const magics = [
    [0xca, 0xfe, 0xba, 0xbe], // fat
    [0xce, 0xfa, 0xed, 0xfe], // 32bit
    [0xcf, 0xfa, 0xed, 0xfe], // 64bit
    [0xfe, 0xed, 0xfa, 0xce] // big-endian
  ];
  if (buffer.length < 4) {
    return false;
  }
  for (let a of magics) {
    if (!buffer.compare(Buffer.from(a))) {
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

  finalize (cb, error) {
    if (error && !this.config.noclean) {
      return this.mrproper(_ => { cb(error); });
    }
    return cb(error);
  }

  /* Public API */
  signIPA (cb) {
    if (typeof cb === 'function') {
      this.events.removeAllListeners('end');
      this.events.on('end', cb);
    }
    tools.setOptions({
      use7zip: this.config.use7zip,
      useOpenSSL: this.config.useOpenSSL
    });
    this.unzip(this.config.file, this.config.outdir, (error) => {
      if (error) { return this.finalize(cb, error); }
      this.signAppDirectory(this.config.outdir + '/Payload', (error, res) => {
        if (error) { return this.finalize(cb, error); }
        this.zip((error, res) => {
          if (error) { return this.finalize(cb, error); }
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

    try {
      if (!tools.isDirectory(ipadir)) {
        return this.cleanup(() => {
          next(new Error('Not a directory ' + ipadir));
        });
      }
    } catch (e) {
      return next(new Error('Cannot find ' + ipadir));
    }
    this.emit('message', 'Payload found');
    if (ipadir.endsWith('/')) {
      ipadir = ipadir.substring(0, ipadir.length - 1);
    }
    let filename = 'ipadir';
    if (ipadir.endsWith('.app')) {
      this.config.appdir = ipadir;
      const slash = ipadir.lastIndexOf('/');
      if (slash !== -1) {
        filename = ipadir.substring(slash + 1).replace('.app', '');
      }
    } else {
      const files = fs.readdirSync(ipadir).filter((x) => {
        return x.endsWith('.app');
      });
      if (files.length !== 1) {
        return next(new Error('Invalid IPA: ' + ipadir));
      }
      this.config.appdir = path.join(ipadir, files[0]);
      filename = files[0].replace('.app', '');
    }
    const binname = getExecutable(this.config.appdir, filename);
    this.config.appbin = path.join(this.config.appdir, binname);
    try {
      if (!fs.lstatSync(this.config.appbin).isFile()) {
        return next(new Error('This was suposed to be a file'));
      }
    } catch (e) {
      const folders = this.config.appdir.split(path.sep);
      const binName = folders[folders.length - 1].replace('.app', '');
      this.config.appbin = path.join(this.config.appdir, binName);
      if (!fs.lstatSync(this.config.appbin).isFile()) {
        return next(new Error('This was suposed to be a file'));
      }
    }
    if (isBitcodeSync.path(this.config.appbin)) {
      return next(new Error('This IPA contains only bitcode. Must be transpiled for the target device to run.'));
    }
    if (isEncryptedSync.path(this.config.appbin)) {
      if (!this.config.unfairPlay) {
        return next(new Error('This IPA is encrypted'));
      }
      this.emit('message', 'Main IPA executable is encrypted');
    } else {
      this.emit('message', 'Main IPA executable is not encrypted');
    }
    if (this.config.insertLibrary !== undefined) {
      insertLibrary(this.config, (err) => {
        if (err) {
          return this.emit('error', err, next);
        }
      });
    }
    const continuation = () => {
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
    };
    if (this.config.withoutWatchapp) {
      this.removeWatchApp(continuation);
    } else {
      continuation();
    }
  }

  removeWatchApp (cb) {
    const keepTests = true;
    const watchdir = path.join(this.config.appdir, 'Watch');
    this.emit('message', 'Stripping out the WatchApp at ' + watchdir);

    rimraf(watchdir, () => {
      const plugdir = path.join(this.config.appdir, 'PlugIns');
      let tests = [];
      if (fs.existsSync(plugdir)) {
        try {
          tests = fs.readdirSync(plugdir).filter((x) => {
            return x.indexOf('.xctest') !== -1;
          });
        } catch (err) {
          console.error(err);
        }
      }
      if (keepTests) {
        if (tests.length > 0) {
          this.emit('message', 'Dont strip the xctest plugins');
        }
        for (let t of tests) {
          const oldName = path.join(plugdir, t);
          const newName = path.join(this.config.appdir, '__' + t);
          fs.renameSync(oldName, newName);
        }
      }
      this.emit('message', 'Stripping out the PlugIns at ' + plugdir);
      rimraf(plugdir, (err, res) => {
        if (keepTests) {
          try {
            fs.mkdirSync(plugdir);
            for (let t of tests) {
              const oldName = path.join(this.config.appdir, '__' + t);
              const newName = path.join(plugdir, t);
              fs.renameSync(oldName, newName);
            }
          } catch (err) {
            console.error(err);
          }
        }
        return cb(err, res);
      });
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
    /* allow to generate an IPA file without the embedded.mobileprovision */
    const withoutMobileProvision = false;
    if (withoutMobileProvision) {
      const mobileProvision = path.join(appdir, 'embedded.mobileprovision');
      return fs.unlink(mobileProvision, () => {
        next();
      });
    }
    if (file && appdir) {
      this.emit('message', 'Embedding new mobileprovision');
      const mobileProvision = path.join(appdir, 'embedded.mobileprovision');
      if (this.config.selfSignedProvision) {
        /* update entitlements */
        return tools.getMobileProvisionPlist(this.config.mobileprovision, (err, data) => {
          if (err) {
            return next(err);
          }
          const mainBin = path.join(this.config.appdir, getExecutable(this.config.appdir));
          let ent = machoEntitlements.parseFile(mainBin);
          if (ent === null) {
            console.error('Cannot find entitlements in binary. Using defaults');
            const entMobProv = data['Entitlements'];
            const teamId = entMobProv['com.apple.developer.team-identifier'];
            const appId = entMobProv['application-identifier'];
            ent = defaultEntitlements(appId, teamId);
          }
          data['Entitlements'] = plist.parse(ent.toString().trim());
          fs.writeFileSync(mobileProvision, plistBuild(data).toString());
          /* TODO: self-sign mobile provisioning */
          next();
        });
      }
      return fs.copy(file, mobileProvision, next);
    }
    next();
  }

  adjustEntitlements (file, entMobProv, next) {
    const teamId = entMobProv['com.apple.developer.team-identifier'];
    const appId = entMobProv['application-identifier'];
    /* TODO: check if this supports binary plist too */
    let ent = machoEntitlements.parseFile(file);
    if (ent === null) {
      console.error('Cannot find entitlements in binary. Using defaults');
      ent = defaultEntitlements(appId, teamId);
      // return next();
    }
    let entMacho = plist.parse(ent.toString().trim());
    if (this.config.selfSignedProvision) { /* */
      this.emit('message', 'Using an unsigned provisioning');
      const newEntitlementsFile = file + '.entitlements';
      const newEntitlements = plistBuild(entMacho).toString();
      fs.writeFileSync(newEntitlementsFile, newEntitlements);
      this.config.entitlement = newEntitlementsFile;
      return next();
    }
    let changed = false;
    if (this.config.cloneEntitlements) {
      this.emit('message', 'Cloning entitlements');
      entMacho = entMobProv;
      changed = true;
    } else {
      const k = 'com.apple.developer.icloud-container-identifiers';
      if (entMacho[k]) {
        entMacho[k] = 'iCloud.' + appId;
      }
      ['application-identifier', 'com.apple.developer.team-identifier'].forEach((id) => {
        if (entMacho[id] !== entMobProv[id]) {
          changed = true;
          entMacho[id] = entMobProv[id];
        }
      });
      if (typeof entMacho['keychain-access-groups'] === 'object') {
        changed = true;
        // keychain access groups makes the resigning fail with -M
        delete entMacho['keychain-access-groups'];
        // entMacho['keychain-access-groups'][0] = appId;
      }
      if (this.config.massageEntitlements === true) {
        [
          'com.apple.developer.ubiquity-kvstore-identifier',
          'com.apple.developer.ubiquity-container-identifiers',
          'com.apple.developer.icloud-container-identifiers',
          'com.apple.developer.icloud-container-environment',
          'com.apple.developer.icloud-services',
          'com.apple.developer.payment-pass-provisioning',
          'com.apple.developer.default-data-protection',
          'com.apple.networking.vpn.configuration',
          'com.apple.developer.associated-domains',
          'com.apple.security.application-groups',
          'com.apple.developer.team-identifier',
          'com.apple.developer.in-app-payments',
          'com.apple.developer.siri',
          'beta-reports-active', /* our entitlements doesnt support beta */
          'aps-environment'
        ].forEach((id) => {
          if (typeof entMacho[id] !== 'undefined') {
            delete entMacho[id];
            changed = true;
          }
        });
      } else {
        delete entMacho['com.apple.developer.icloud-container-identifiers'];
        delete entMacho['com.apple.developer.icloud-container-environment'];
        delete entMacho['com.apple.developer.ubiquity-kvstore-identifier'];
        delete entMacho['com.apple.developer.icloud-services'];
        delete entMacho['com.apple.developer.siri'];
        delete entMacho['com.apple.developer.in-app-payments'];
        delete entMacho['aps-environment'];
        delete entMacho['com.apple.security.application-groups'];
        delete entMacho['com.apple.developer.associated-domains'];
        delete entMacho['com.apple.developer.team-identifier'];
      }
    }
    if (this.config.withGetTaskAllow) {
      if (entMacho['get-task-allow'] !== true) {
        this.emit('message', 'get-task-allow set to true');
        entMacho['get-task-allow'] = true;
        changed = true;
      }
    }
    const additionalKeychainGroups = [];
    if (typeof this.config.customKeychainGroup === 'string') {
      additionalKeychainGroups.push(this.config.customKeychainGroup);
    }
    if (this.config.bundleIdKeychainGroup) {
      if (typeof this.config.bundleid === 'string') {
        additionalKeychainGroups.push(this.config.bundleid);
      } else {
        const infoPlist = path.join(this.config.appdir, 'Info.plist');
        const plistData = plist.readFileSync(infoPlist);
        const bundleid = plistData['CFBundleIdentifier'];
        additionalKeychainGroups.push(bundleid);
      }
    }
    if (this.config.osversion !== undefined) {
      const infoPlist = path.join(this.config.appdir, 'Info.plist');
      const plistData = plist.readFileSync(infoPlist);
      plistData['MinimumOSVersion'] = this.config.osversion;
      // DTPlatformVersion
      plist.writeFileSync(infoPlist, plistData);
    }
    if (additionalKeychainGroups.length > 0) {
      const newGroups = additionalKeychainGroups.map(group => `${teamId}.${group}`);
      const groups = entMacho['keychain-access-groups'];
      if (typeof groups === 'undefined') {
        entMacho['keychain-access-groups'] = newGroups;
      } else {
        groups.push(...newGroups);
      }
      changed = true;
    }
    if (changed || this.config.entry) {
      const newEntitlementsFile = file + '.entitlements';
      let newEntitlements = (appId && teamId && this.config.entry)
        ? defaultEntitlements(appId, teamId)
        : (this.config.entitlement)
          ? fs.readFileSync(this.config.entitlement).toString()
          : plistBuild(entMacho).toString();
      const ent = plist.parse(newEntitlements.trim());
      const shouldRenameGroups = !this.config.mobileprovision && !this.config.cloneEntitlements;
      if (shouldRenameGroups && ent['com.apple.security.application-groups']) {
        const ids = appId.split('.');
        ids.shift();
        const id = ids.join('.');
        const groups = [];
        for (let group of ent['com.apple.security.application-groups']) {
          const cols = group.split('.');
          if (cols.length === 4) {
            groups.push('group.' + id);
          } else {
            groups.push('group.' + id + '.' + cols.pop());
          }
        }
        ent['com.apple.security.application-groups'] = groups;
      }
      delete ent['beta-reports-active']; /* our entitlements doesnt support beta */
      delete ent['com.apple.developer.ubiquity-container-identifiers']; // TODO should be massaged
      newEntitlements = plistBuild(ent).toString();
      fs.writeFileSync(newEntitlementsFile, newEntitlements);
      this.emit('message', 'Updated binary entitlements' + newEntitlementsFile);
      this.config.entitlement = newEntitlementsFile;
    }
    next();
  }

  fixEntitlements (file, next) {
    if (!this.config.mobileprovision) {
      const pathToProvision = path.join(this.config.appdir, 'embedded.mobileprovision');
      tools.getEntitlementsFromMobileProvision(pathToProvision, (error, newEntitlements) => {
        if (error) {
          return next(error);
        }
        this.emit('message', 'Using the entitlements from the mobileprovision');
        return this.adjustEntitlements(file, newEntitlements, next);
      });
      return;
    }
    tools.getEntitlementsFromMobileProvision(this.config.mobileprovision, (error, newEntitlements) => {
      if (error) {
        return next(error);
      }
      this.emit('message', JSON.stringify(newEntitlements));
      // const pathToProvision = path.join(this.config.appdir, 'embedded.mobileprovision');
      // fs.copySync(this.config.mobileprovision, pathToProvision);
      // plist.writeFileSync(pathToProvision, newEntitlements);
      this.adjustEntitlements(file, newEntitlements, next);
    });
  }

  /* Adjust Info.plist */
  fixPlist (file, bundleid, next) {
    const appdir = this.config.appdir;
    if (!file || !appdir) {
      return next('Invalid parameters for fixPlist');
    }
    let changed = false;
    const data = plist.readFileSync(file);
    delete data[''];
    if (this.config.allowHttp) {
      this.emit('message', 'Adding NSAllowArbitraryLoads');
      if (!Object.isObject(data['NSAppTransportSecurity'])) {
        data['NSAppTransportSecurity'] = {};
      }
      data['NSAppTransportSecurity']['NSAllowsArbitraryLoads'] = true;
      changed = true;
    }
    if (this.config.forceFamily) {
      if (this.performForceFamily(data)) {
        changed = true;
      }
    }
    if (bundleid) {
      this.setBundleId(file, data, bundleid);
      changed = true;
    }
    if (changed) {
      plist.writeFileSync(file, data);
    }
    next();
  }

  setBundleId (file, data, bundleid) {
    const oldBundleId = data['CFBundleIdentifier'];
    this.emit('message', 'Rebundle ' + file + ' : ' + oldBundleId + ' into ' + bundleid);
    if (oldBundleId) {
      data['CFBundleIdentifier'] = bundleid;
    }
    if (data['basebundleidentifier']) {
      data['basebundleidentifier'] = bundleid;
    }
    try {
      data['CFBundleURLTypes'][0]['CFBundleURLName'] = bundleid;
    } catch (e) {
      /* do nothing */
    }
  }

  signFile (file, next) {
    if (this.config.lipoArch === undefined) {
      return this.signFileContinuation(file, next);
    }
    this.emit('message', '[lipo] ' + this.config.lipoArch + ' ' + file);
    tools.lipoFile(file, this.config.lipoArch, (_) => {
      /* ignore error */
      return this.signFileContinuation(file, next);
    });
  }

  signFileContinuation (file, next) {
    function codesignHasFailed (config, error, errmsg) {
      if (error && error.message.indexOf('Error:')) {
        next(error);
        return true;
      }
      return ((errmsg && errmsg.indexOf('no identity found') !== -1) || !config.ignoreCodesignErrors);
    }
    tools.codesign(this.config.identity, this.config.entitlement, this.config.keychain, file, (error, stdout, stderr) => {
      if (error && codesignHasFailed(this.config, error, stderr)) {
        return this.emit('end', error, next);
      }
      this.emit('message', 'Signed ' + file);
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
    return this;
  }

  filterLibraries (libraries) {
    return libraries.filter(library => {
      // Resign all frameworks. even if not referenced :?
      if (this.config.all) {
        return true;
      }
      if (library.indexOf('Frameworks/') !== -1) {
        return true;
      }
      // check if there's a Plist to inform us which is the right executable
      const exe = getExecutable(path.dirname(library), path.basename(library));
      if (path.basename(library) !== exe) {
        this.emit('warning', 'Not signing ' + library);
        return false;
      }
      return true;
    });
  }

  signLibraries (bpath, appdir, next) {
    this.emit('message', 'Signing libraries and frameworks');

    let libraries = [];
    const exe = path.sep + getExecutable(this.config.appdir);
    const folders = this.config.appbin.split(path.sep);
    const exe2 = path.sep + folders[folders.length - 1];

    let found = false;
    let failure = false;
    walk.walkSync(appdir, (basedir, filename, stat) => {
      if (failure) {
        return;
      }
      const file = path.join(basedir, filename);
      // only walk on files. Symlinks and other special files are forbidden
      if (!fs.lstatSync(file).isFile()) {
        return;
      }
      if (file.endsWith(exe) || file.endsWith(exe2)) {
        this.emit('message', 'Executable found at ' + file);
        libraries.push(file);
        found = true;
        return;
      }
      try {
        const fd = fs.openSync(file, 'r');
        let buffer = Buffer.alloc(4);
        if (fs.readSync(fd, buffer, 0, 4) === 4) {
          if (isMacho(buffer)) {
            libraries.push(file);
          }
        }
        fs.close(fd);
      } catch (e) {
        console.error(basedir, filename, e);
        failure = true;
        return next(e);
      }
    });
    if (!found) {
      return next('Cannot find any MACH0 binary to sign');
    }
    const parallelVerify = (libs, next) => {
      if (!this.config.verify) {
        return next();
      }
      let depsCount = libs.length;
      for (let lib of libs) {
        this.emit('message', 'Verifying ' + lib);
        tools.verifyCodesign(lib, null, (err) => {
          if (--depsCount === 0) {
            next(err);
          }
        });
      }
    };

    const layeredSigning = (libs, next) => {
      let libsCopy = libs.slice(0).reverse();
      let failure = false;
      const peel = () => {
        if (libsCopy.length === 0) {
          return parallelVerify(libraries, next);
        }
        const deps = libsCopy.pop();
        let depsCount = deps.length;
        for (let d of deps) {
          this.signFile(d, (err) => {
            if (failure) {
              return;
            }
            if (err) {
              failure = true;
              console.error(err);
              return next(err);
            }
            if (--depsCount === 0) {
              peel();
            }
          });
        }
      };
      peel();
    };

    const serialSigning = (libs, next) => {
      let libsCopy = libs.slice(0).reverse();
      const peek = (cb) => {
        if (libsCopy.length === 0) {
          libsCopy = libs.slice(0);
          return cb();
        }
        const lib = libsCopy.pop();
        this.signFile(lib, (err) => {
          if (err) {
            return err;
          }
          peek(cb);
        });
      };
      peek(() => {
        if (!this.config.verify) {
          return next();
        }
        libsCopy = libs.slice(0);
        const verify = (cb) => {
          if (libsCopy.length === 0) {
            return cb();
          }
          const lib = libsCopy.pop();
          this.emit('message', 'Verifying ' + lib);
          tools.verifyCodesign(lib, null, _ => {
            verify(cb);
          });
        };
        verify(next);
      });
    };

    this.emit('message', 'Resolving signing order using layered list');
    libraries = this.filterLibraries(libraries);
    depSolver(bpath, libraries, this.config.parallel, (err, libs) => {
      if (err) {
        return next(err);
      }
      if (libs.length === 0) {
        libs.push(bpath);
      }
      if (typeof libs[0] === 'object') {
        return layeredSigning(libs, next);
      }
      return serialSigning(libs, next);
    });
  }

  cleanup (cb) {
    if (this.config.noclean) {
      return cb();
    }
    const outdir = this.config.outdir;
    this.emit('message', 'Cleaning up ' + outdir);
    try {
      rimraf(outdir, cb);
    } catch (e) {
      this.emit('message', e);
    }
  }

  mrproper (cb) {
    if (this.config.noclean) {
      return cb();
    }
    this.cleanup(err => {
      if (err) {
        this.emit('error', err);
      }
      rimraf(this.config.outfile, cb);
    });
  }

  /* TODO: move to tools.js */
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
    this.events.emit('message', 'Zipifying into ' + ipaOut + ' ...');
    const rootFolder = this.config.payloadOnly ? 'Payload' : '.';
    tools.zip(this.config.outdir, ipaOut, rootFolder, (error) => {
      if (!error && this.config.replaceipa) {
        this.events.emit('message', 'mv into ' + ipaIn);
        return fs.rename(ipaOut, ipaIn, next);
      }
      next(error);
    });
  }

  setFile (name) {
    if (typeof name === 'string') {
      this.config.file = path.resolve(name);
      this.config.outdir = this.config.file + '.' + uuid.v4();
      if (!this.config.outfile) {
        this.setOutputFile(getResignedFilename(this.config.file));
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
        if (error && !this.config.ignoreZipErrors) {
          this.cleanup(() => { cb(error); });
        } else {
          cb(null, stdout);
        }
      });
    });
  }

  performForceFamily (data) {
    const have = supportedDevices(data);
    const df = [];
    if (have.iPhone.length > 0) {
      df.push(1);
    }
    if (have.iPad.length > 0) {
      df.push(2);
    }
    if (df.length === 0) {
      this.emit('message', 'UIDeviceFamily forced to iPhone/iPod');
      df.push(1);
    }
    if (df.length === 2) {
      this.emit('message', 'No UIDeviceFamily changes required');
      return false;
    }
    this.emit('message', 'UIDeviceFamily set to ' + JSON.stringify(df));
    data.UIDeviceFamily = df;
    return true;
  }
};

function supportedDevices (data) {
  const have = { iPhone: [], iPad: [] };
  const sd = data.UISupportedDevices;
  if (Array.isArray(sd)) {
    sd.forEach(model => {
      for (let type in ['iPhone', 'iPad']) {
        if (model.indexOf(type) !== -1) {
          have[type].push(model);
          break;
        }
      }
    });
  } else if (sd !== undefined) {
    console.error('Warning: Invalid UISupportedDevices in Info.plist?');
  }
  const df = data.UIDeviceFamily;
  if (Array.isArray(df)) {
    df.forEach(family => {
      switch (family) {
        case 1:
          have.iPhone.push('iPhone');
          break;
        case 2:
          have.iPad.push('iPad');
          break;
      }
    });
  }
  return have;
}
