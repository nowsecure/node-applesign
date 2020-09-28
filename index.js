'use strict';

const tools = require('./lib/tools');
const config = require('./lib/config');
const EventEmitter = require('events').EventEmitter;
const path = require('path');
const { execSync } = require('child_process');
const uuid = require('uuid');
const fs = require('fs-extra');
const walk = require('fs-walk');
const plist = require('simple-plist');
const fchk = require('./lib/fchk');
const { tmpdir } = require('os');

const { AppDirectory } = require('./lib/appdir');

const depSolver = require('./lib/depsolver');

const adjustInfoPlist = require('./lib/info-plist');
const defaultEntitlements = require('./lib/entitlements');

const plistBuild = require('plist').build;
const bin = require('./lib/bin');

class Applesign {
  constructor (options) {
    this.config = config.fromOptions(options || {});
    this.events = new EventEmitter();
    this.nested = [];
    this.debugObject = {};
    this.tmpDir = this._makeTmpDir();
  }

  _makeTmpDir () {
    const tmp = tmpdir();
    const base = path.join(tmp, 'applesign');
    const result = path.join(base, uuid.v4());
    fs.ensureDirSync(result);
    return result;
  }

  _pathInTmp (filePath, scope = null) {
    const baseName = path.basename(filePath);
    if (typeof scope === 'string') {
      return path.join(this.tmpDir, scope, baseName);
    }
    return path.join(this.tmpDir, baseName);
  }

  async signXCarchive (file) {
    fchk(arguments, ['string']);
    const ipaFile = file + '.ipa';
    await tools.xcaToIpa(file, ipaFile);
    await this.signIPA(ipaFile);
  }

  async getIdentities () {
    fchk(arguments, []);
    return tools.getIdentities();
  }

  async signIPA (file) {
    fchk(arguments, ['string']);
    if (typeof file === 'string') {
      this.setFile(file);
    }
    tools.setOptions({
      use7zip: this.config.use7zip,
      useOpenSSL: this.config.useOpenSSL
    });
    this.emit('message', 'File: ' + this.config.file);
    this.emit('message', 'Outdir: ' + this.config.outdir);
    if (tools.isDirectory(this.config.file)) {
      throw new Error('This is a directory');
    }
    try {
      await this.unzipIPA(this.config.file, this.config.outdir);
      const appDirectory = path.join(this.config.outdir, '/Payload');
      this.config.appdir = getAppDirectory(appDirectory);
      if (this.config.debug) {
        this.debugObject = {};
      }
      const tasks = [];
      if (this.config.withoutWatchapp) {
        tasks.push(this.removeWatchApp());
      }
      // TODO: this .withoutSigningFiles option doesnt exist yet
      if (this.config.withoutSigningFiles) {
        tasks.push(this.removeSigningFiles());
      }
      if (this.config.withoutPlugins) {
        tasks.push(this.removePlugins());
      }
      if (this.config.withoutXCTests) {
        tasks.push(this.removeXCTests());
      }
      if (tasks.length > 0) {
        await Promise.all(tasks);
      }
      await this.signAppDirectory(appDirectory, false);
      await this.zipIPA();
    } catch (e) {
      process.exitCode = 1;
      throw e;
    } finally {
      await this.cleanup();
    }
    return this;
  }

  _pullMobileProvision () {
    this.config.mobileprovision = this.config.mobileprovisions[0];
    if (this.config.mobileprovisions.length > 1) {
      this.config.mobileprovisions.slice(1);
    }
  }

  async signAppDirectory (ipadir, skipNested) {
    fchk(arguments, ['string', 'boolean']);
    this._pullMobileProvision();
    if (this.config.run) {
      runScriptSync(this.config.run, this);
    }
    if (this.config.appdir === undefined) {
      this.config.appdir = ipadir;
    }
    const binname = getExecutable(this.config.appdir);
    this.emit('msg', 'Main Executable Name: ' + binname);
    this.config.appbin = path.join(this.config.appdir, binname);
    if (!fs.lstatSync(this.config.appbin).isFile()) {
      throw new Error('This was suposed to be a file');
    }
    if (bin.isBitcode(this.config.appbin)) {
      throw new Error('This IPA contains only bitcode. Must be transpiled for the target device to run.');
    }
    if (bin.isEncrypted(this.config.appbin)) {
      if (!this.config.unfairPlay) {
        throw new Error('This IPA is encrypted');
      }
      this.emit('warning', 'Main IPA executable is encrypted');
    } else {
      this.emit('message', 'Main IPA executable is not encrypted');
    }
    if (this.config.insertLibrary !== undefined) {
      await insertLibrary(this.config);
    }
    const infoPlistPath = path.join(this.config.appdir, 'Info.plist');
    adjustInfoPlist(infoPlistPath, this.config, this.emit.bind(this));
    if (!this.config.mobileprovision) {
      throw new Error('warning: No mobile provisioning file provided');
    }
    await this.checkProvision(this.config.appdir, this.config.mobileprovision);
    await this.adjustEntitlements(this.config.appbin);
    await this.signLibraries(this.config.appbin, this.config.appdir);

    if (skipNested !== true) {
      for (const nest of this.nested) {
        if (tools.isDirectory(nest)) {
          await this.signAppDirectory(nest, true);
        } else {
          this.emit('warning', 'Cannot find ' + nest);
        }
      }
    }
  }

  async removeWatchApp () {
    fchk(arguments, []);
    const watchdir = path.join(this.config.appdir, 'Watch');
    this.emit('message', 'Stripping out the WatchApp at ' + watchdir);
    await tools.asyncRimraf(watchdir);

    const placeholderdir = path.join(this.config.appdir, 'com.apple.WatchPlaceholder');
    this.emit('message', 'Stripping out the WatchApp at ' + placeholderdir);
    await tools.asyncRimraf(placeholderdir);
  }

  // XXX some directory leftovers
  async removeXCTests () {
    fchk(arguments, []);
    const dir = this.config.appdir;
    walk.walkSync(dir, (basedir, filename, stat) => {
      const target = path.join(basedir, filename);
      //  if (target.toLowerCase().indexOf('/xct') !== -1)
      if (target.toLowerCase().indexOf('xctest') !== -1) {
        this.emit('message', 'Deleting ' + target);
        fs.unlinkSync(target);
      }
    });
  }

  async removeSigningFiles () {
    fchk(arguments, []);
    const dir = this.config.appdir;
    walk.walkSync(dir, (basedir, filename, stat) => {
      if (filename.endsWith('.entitlements') || filename.endsWith('.mobileprovision')) {
        const target = path.join(basedir, filename);
        this.emit('message', 'Deleting ' + target);
        fs.unlinkSync(target);
      }
    });
  }

  async removePlugins () {
    fchk(arguments, []);
    const plugdir = path.join(this.config.appdir, 'PlugIns');
    const tmpdir = path.join(this.config.appdir, 'applesign_xctest_tmp');
    this.emit('message', 'Stripping out the PlugIns at ' + plugdir);
    let tests = [];
    if (!this.config.withoutXCTests) {
      tests = await enumerateTestFiles(plugdir);
      if (tests.length > 0) {
        await moveFiles(tests, plugdir, tmpdir);
      }
    }

    await tools.asyncRimraf(plugdir);
    if (tests.length > 0) {
      await moveFiles(tests, tmpdir, plugdir);
      await fs.rmdir(tmpdir);
    }
  }

  findProvisioningsSync () {
    fchk(arguments, []);
    const files = [];
    walk.walkSync(this.config.appdir, (basedir, filename, stat) => {
      const file = path.join(basedir, filename);
      // only walk on files. Symlinks and other special files are forbidden
      if (!fs.lstatSync(file).isFile()) {
        return;
      }
      if (filename === 'embedded.mobileprovision') {
        files.push(file);
      }
    });
    return files;
  }

  /*
    TODO: verify is mobileprovision app-id glob string matches the bundleid
    read provision file in raw
    search for application-identifier and <string>...</string>
    check if prefix matches and last dot separated word is an asterisk
    const identifierInProvisioning = 'x'
    Read the one in Info.plist and compare with bundleid
  */
  async checkProvision (appdir, file) {
    fchk(arguments, ['string', 'string']);
    /* Deletes the embedded.mobileprovision from the ipa? */
    const withoutMobileProvision = false;
    if (withoutMobileProvision) {
      const files = this.findProvisioningsSync();
      files.forEach((file) => {
        console.error('Deleting ', file);
        fs.unlinkSync(file);
      });
    }
    if (appdir && file && !withoutMobileProvision) {
      this.emit('message', 'Embedding new mobileprovision');
      const mobileProvision = path.join(appdir, 'embedded.mobileprovision');
      if (this.config.selfSignedProvision) {
        /* update entitlements */
        const data = await tools.getMobileProvisionPlist(this.config.mobileprovision);
        const mainBin = path.join(appdir, getExecutable(appdir));
        let ent = bin.entitlements(mainBin);
        if (ent === null) {
          this.emit('warning', 'Cannot find entitlements in binary. Using defaults');
          const entMobProv = data.Entitlements;
          const teamId = entMobProv['com.apple.developer.team-identifier'];
          const appId = entMobProv['application-identifier'];
          ent = defaultEntitlements(appId, teamId);
        }
        data.Entitlements = plist.parse(ent.toString().trim());
        fs.writeFileSync(mobileProvision, plistBuild(data).toString());
        /* TODO: self-sign mobile provisioning */
      }
      return fs.copySync(file, mobileProvision);
    }
  }

  debugInfo (path, key, val) {
    if (!val) {
      return;
    }
    const f = path.replace(this.config.outdir + '/', '');
    if (!this.debugObject) {
      this.debugObject = {};
    }
    if (this.debugObject[f] === undefined) {
      this.debugObject[f] = {};
    }
    this.debugObject[f][key] = val;
  }

  adjustEntitlementsSync (file, entMobProv) {
    fchk(arguments, ['string', 'object']);
    this.debugInfo(file, 'before', entMobProv);
    const teamId = entMobProv['com.apple.developer.team-identifier'];
    const appId = entMobProv['application-identifier'];
    let ent = bin.entitlements(file);
    if (ent === null && !this.config.cloneEntitlements) {
      console.error('Cannot find entitlements in binary. Using defaults');
      ent = defaultEntitlements(appId, teamId);
    }
    let entMacho = plist.parse(ent.toString().trim());
    this.debugInfo(file, 'fullPath', file);
    this.debugInfo(file, 'oldEntitlements', entMacho || 'TODO');
    if (this.config.selfSignedProvision) {
      this.emit('message', 'Using an unsigned provisioning');
      const newEntitlementsFile = file + '.entitlements';
      const newEntitlements = plistBuild(entMacho).toString();
      const tmpEmtitlementsFile = this._pathInTmp(newEntitlementsFile);
      fs.writeFileSync(tmpEmtitlementsFile, newEntitlements);
      this.config.entitlement = tmpEmtitlementsFile;
      if (!this.config.noEntitlementsFile) {
        fs.writeFileSync(newEntitlementsFile, tmpEntitlements);
      }
      this.debugInfo(file, 'newEntitlements', plist.parse(newEntitlements));
      return;
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
      if (this.config.massageEntitlements === true) {
        if (typeof entMacho['keychain-access-groups'] === 'object') {
          changed = true;
          // keychain access groups makes the resigning fail with -M
          delete entMacho['keychain-access-groups'];
        // entMacho['keychain-access-groups'][0] = appId;
        }
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
      } else if (!this.config.cloneEntitlements) {
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

    if (typeof this.config.withGetTaskAllow !== 'undefined') {
      this.emit('message', 'get-task-allow set to ' + this.config.withGetTaskAllow);
      entMacho['get-task-allow'] = this.config.withGetTaskAllow;
      changed = true;
    }

    const additionalKeychainGroups = [];
    if (typeof this.config.customKeychainGroup === 'string') {
      additionalKeychainGroups.push(this.config.customKeychainGroup);
    }
    const infoPlist = path.join(this.config.appdir, 'Info.plist');
    const plistData = plist.readFileSync(infoPlist);
    if (this.config.bundleIdKeychainGroup) {
      if (typeof this.config.bundleid === 'string') {
        additionalKeychainGroups.push(this.config.bundleid);
      } else {
        const bundleid = plistData.CFBundleIdentifier;
        additionalKeychainGroups.push(bundleid);
      }
    }
    if (this.config.osversion !== undefined) {
      // DTPlatformVersion
      plistData.MinimumOSVersion = this.config.osversion;
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
        for (const group of ent['com.apple.security.application-groups']) {
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
      if (this.config.massageEntitlements === true) {
        delete ent['com.apple.developer.ubiquity-container-identifiers']; // TODO should be massaged
      }
      newEntitlements = plistBuild(ent).toString();

      this.debugInfo(file, 'newEntitlements', ent);

      const tmpEntitlementsFile = this._pathInTmp(newEntitlementsFile);
      fs.writeFileSync(tmpEntitlementsFile, newEntitlements);
      this.config.entitlement = tmpEntitlementsFile;
      if (!this.config.noEntitlementsFile) {
        fs.writeFileSync(tmpEntitlementsFile, newEntitlements);
        this.emit('message', 'Updated binary entitlements' + tmpEntitlementsFile);
      }
      this.debugInfo(file, 'after', newEntitlements);
    } else {
      this.debugInfo(file, 'nothing-changed', true);
    }
  }

  async adjustEntitlements (file) {
    fchk(arguments, ['string']);
    const mp = this.config.mobileprovision ? this.config.mobileprovision : path.join(this.config.appdir, 'embedded.mobileprovision');
    const newEntitlements = await tools.getEntitlementsFromMobileProvision(mp);
    this.emit('message', JSON.stringify(newEntitlements));
    this.adjustEntitlementsSync(file, newEntitlements);
  }

  async signFile (file) {
    const config = this.config;
    function customOptions (config, file) {
      if (typeof config.json === 'object' && typeof config.json.custom === 'object') {
        for (const c of config.json.custom) {
          if (!c.filematch) {
            continue;
          }
          const re = new RegExp(c.filematch);
          if (re.test(file)) {
            // console.error('Debug: '+ JSON.stringify(c, null, 2))
            return c;
          }
        }
      }
      return false;
    }
    const custom = customOptions(config, file);
    function getKeychain () { return (custom !== false && custom.keychain !== undefined) ? custom.keychain : config.keychain; }
    function getIdentity () { return (custom !== false && custom.identity !== undefined) ? custom.identity : config.identity; }
    function getEntitlements () { return (custom !== false && custom.entitlements !== undefined) ? custom.entitlements : config.entitlements; }

    fchk(arguments, ['string']);
    if (this.config.lipoArch !== undefined) {
      this.emit('message', '[lipo] ' + this.config.lipoArch + ' ' + file);
      try {
        await tools.lipoFile(file, this.config.lipoArch);
      } catch (ignored) {
      }
    }
    function codesignHasFailed (config, error, errmsg) {
      if (error && errmsg.indexOf('Error:') !== -1) {
        throw error;
      }
      return ((errmsg && errmsg.indexOf('no identity found') !== -1) || !config.ignoreCodesignErrors);
    }
    const identity = getIdentity();
    let entitlements = '';
    if (this.config.cloneEntitlements) {
      const mp = await tools.getMobileProvisionPlist(this.config.mobileprovision);
      const newEntitlementsFile = file + '.entitlements';
      const tmpEntitlementsFile = this._pathInTmp(newEntitlementsFile);
      const entstr = plistBuild(mp.Entitlements).toString();
      fs.writeFileSync(tmpEntitlementsFile, entstr);
      entitlements = tmpEntitlementsFile;
    } else {
      entitlements = getEntitlements();
    }
    const keychain = getKeychain();
    const res = await tools.codesign(identity, entitlements, keychain, file);
    if (res.code !== 0 && codesignHasFailed(config, res.code, res.stderr)) {
      return this.emit('end', res.stderr);
    }
    this.emit('message', 'Signed ' + file);
    if (config.verifyTwice) {
      this.emit('message', 'Verify ' + file);
      const res = await tools.verifyCodesign(file, config.keychain);
      if (res.code !== 0) {
        const type = (config.ignoreVerificationErrors) ? 'warning' : 'error';
        return this.emit(type, res.stderr);
      }
    }
    return this;
  }

  filterLibraries (libraries) {
    fchk(arguments, ['object']);
    return libraries.filter(library => {
      // Resign all frameworks. even if not referenced :?
      if (library.indexOf('Frameworks/') !== -1) {
        return true;
      }
      if (this.config.all) {
        return true;
      }
      // check if there's a Plist to inform us which is the right executable
      const exe = getExecutable(path.dirname(library));
      if (path.basename(library) !== exe) {
        this.emit('warning', 'Not signing ' + library);
        return false;
      }
      return true;
    });
  }

  findLibrariesSync () {
    fchk(arguments, []);
    const libraries = [];
    const nested = [];
    const exe = path.sep + getExecutable(this.config.appdir);
    const folders = this.config.appbin.split(path.sep);
    const exe2 = path.sep + folders[folders.length - 1];

    let found = false;
    walk.walkSync(this.config.appdir, (basedir, filename, stat) => {
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

      const nest = nestedApp(file);
      if (nest !== false) {
        if (nested.indexOf(nest) === -1) {
          nested.push(nest);
        }
        return;
      }
      if (bin.isMacho(file)) {
        libraries.push(file);
      }
    });
    if (!found) {
      throw new Error('Cannot find any MACH0 binary to sign');
    }
    console.error('Found nested', nested);
    this.nested = nested;
    // return this.filterLibraries(libraries);

    return libraries;
  }

  async signLibraries (bpath, appdir) {
    fchk(arguments, ['string', 'string']);
    this.emit('message', 'Signing libraries and frameworks');

    const parallelVerify = async (libs) => {
      if (!this.config.verify) {
        return;
      }
      this.emit('message', 'Verifying ' + libs);
      const promises = libs.map(lib => tools.verifyCodesign);
      return Promise.all(promises);
    };

    const layeredSigning = async (libs) => {
      const libsCopy = libs.slice(0).reverse();
      for (const deps of libsCopy) {
        const promises = deps.map(dep => { return this.signFile(dep); });
        await Promise.all(promises);
      }
      await parallelVerify(libs);
    };

    const serialSigning = async (libs) => {
      const libsCopy = libs.slice(0).reverse();
      for (const lib of libsCopy) {
        await this.signFile(lib);
        if (this.config.verify) {
          this.emit('message', 'Verifying ' + lib);
          await tools.verifyCodesign(lib);
        }
      }
    };

    this.emit('message', 'Resolving signing order using layered list');
    let libs = [];
    const ls = new AppDirectory();
    await ls.loadFromDirectory(appdir);
    if (this.config.parallel) {
      // known to be buggy in some situations, must use AppDirectory
      const libraries = this.findLibrariesSync();
      libs = await depSolver(bpath, libraries, true);

      for (const appex of ls.appexs) {
        libs.push([appex]);
      }
    } else {
      for (const appex of ls.appexs) {
        await this.adjustEntitlements(appex);
        await this.signFile(appex);
      }

      this.emit('message', 'Nested: ' + JSON.stringify(ls.nestedApplications()));
      this.emit('message', 'SystemLibraries: ' + JSON.stringify(ls.systemLibraries()));
      this.emit('message', 'DiskLibraries: ' + JSON.stringify(ls.diskLibraries()));
      this.emit('message', 'UnavailableLibraries: ' + JSON.stringify(ls.unavailableLibraries()));
      this.emit('message', 'AppLibraries: ' + JSON.stringify(ls.appLibraries()));
      this.emit('message', 'Orphan: ' + JSON.stringify(ls.orphanedLibraries()));
      const libraries = ls.appLibraries();
      if (this.config.all) {
        libraries.push(...ls.orphanedLibraries());
      } else {
        for (let ol of ls.orphanedLibraries()) {
          console.error('Warning: Orphaned library not signed, try -a: ' + ol);
        }
      }
      this.debugInfo('analysis', 'orphan', ls.orphanedLibraries());
      // const libraries = ls.diskLibraries ();
      libs = libraries.filter(library => !(ls.appexs.includes(library))); // remove already-signed appexs
    }
    if (libs.length === 0) {
      libs.push(bpath);
    }
    return (typeof libs[0] === 'object')
      ? layeredSigning(libs)
      : serialSigning(libs);
  }

  async cleanup () {
    fchk(arguments, []);
    if (this.config.noclean) {
      return;
    }
    const outdir = this.config.outdir;
    this.emit('message', 'Cleaning up ' + outdir);
    //  await tools.asyncRimraf(this.config.outfile);
    return tools.asyncRimraf(outdir);
  }

  async cleanupTmp () {
    this.emit('message', 'Cleaning up temp dir ' + this.tmpDir);
    await tools.asyncRimraf(this.tmpDir);
  }

  async zipIPA () {
    fchk(arguments, []);
    const ipaIn = this.config.file;
    const ipaOut = getOutputPath(this.config.outdir, this.config.outfile);
    try {
      fs.unlinkSync(ipaOut); // await for it
    } catch (e) {
      /* do nothing */
    }
    this.events.emit('message', 'Zipifying into ' + ipaOut + ' ...');
    const rootFolder = this.config.payloadOnly ? 'Payload' : '.';
    await tools.zip(this.config.outdir, ipaOut, rootFolder);
    if (this.config.replaceipa) {
      this.events.emit('message', 'mv into ' + ipaIn);
      fs.rename(ipaOut, ipaIn);
    }
  }

  setFile (name) {
    fchk(arguments, ['string']);
    this.config.file = path.resolve(name);
    this.config.outdir = this.config.file + '.' + uuid.v4();
    if (!this.config.outfile) {
      this.config.outfile = getResignedFilename(this.config.file);
    }
  }

  async unzipIPA (file, outdir) {
    fchk(arguments, ['string', 'string']);
    if (!file || !outdir) {
      throw new Error('No output specified');
    }
    if (!outdir) {
      throw new Error('Invalid output directory');
    }
    await this.cleanup();
    this.events.emit('message', 'Unzipping ' + file);
    return tools.unzip(file, outdir);
  }

  /* Event Wrapper API with cb support */
  emit (ev, msg) {
    this.events.emit(ev, msg);
  }

  on (ev, cb) {
    this.events.on(ev, cb);
    return this;
  }
}

// helper functions

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

function getExecutable (appdir) {
  if (!appdir) {
    throw new Error('No application directory is provided');
  }
  const plistPath = path.join(appdir, 'Info.plist');
  try {
    const plistData = plist.readFileSync(plistPath);
    const cfBundleExecutable = plistData.CFBundleExecutable;
    if (cfBundleExecutable) {
      return cfBundleExecutable;
    }
  } catch (e) {
    // do nothing
  }
  const exename = path.basename(appdir);
  const dotap = exename.indexOf('.app');
  return (dotap === -1) ? exename : exename.substring(0, dotap);
}

async function insertLibrary (config) {
  const appDir = config.appdir;
  const targetLib = config.insertLibrary;
  const libraryName = path.basename(targetLib);
  try {
    fs.mkdirSync(path.join(appDir, 'Frameworks'));
  } catch (_) {
  }
  const outputLib = path.join(appDir, 'Frameworks', libraryName);
  await insertLibraryLL(outputLib, targetLib, config);
}

function insertLibraryLL (outputLib, targetLib, config) {
  return new Promise((resolve, reject) => {
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
        tools.insertLibrary(insertedLibraryName, config.appbin, outputLib).then(resolve).catch(reject);
      });
      fs.createReadStream(targetLib).pipe(writeStream);
    } catch (e) {
      reject(e);
    }
  });
}

function parentDirectory (root) {
  return path.normalize(path.join(root, '..'));
}

function getOutputPath (cwd, ofile) {
  return ofile.startsWith(path.sep) ? ofile : path.join(parentDirectory(cwd), ofile);
}

function runScriptSync (script, session) {
  if (script.endsWith('.js')) {
    try {
      const s = require(script);
      return s(session);
    } catch (e) {
      console.error(e);
      return false;
    }
  } else {
    process.env.APPLESIGN_DIRECTORY = session.config.appdir;
    process.env.APPLESIGN_MAINBIN = session.config.appbin;
    process.env.APPLESIGN_OUTFILE = session.config.outfile;
    process.env.APPLESIGN_OUTDIR = session.config.outdir;
    process.env.APPLESIGN_FILE = session.config.file;
    try {
      const res = execSync(script);
      console.error(res.toString());
    } catch (e) {
      console.error(e.toString());
      return false;
    }
  }
  return true;
}

function nestedApp (file) {
  const dotApp = file.indexOf('.app/');
  if (dotApp !== -1) {
    const subApp = file.substring(dotApp + 4).indexOf('.app/');
    if (subApp !== -1) {
      return file.substring(0, dotApp + 4 + subApp + 4);
    }
  }
  return false;
}

function getAppDirectory (ipadir) {
  if (!ipadir) {
    ipadir = path.join(this.config.outdir, 'Payload');
  }
  if (!tools.isDirectory(ipadir)) {
    throw new Error('Not a directory ' + ipadir);
  }
  if (ipadir.endsWith('.app')) {
    this.config.appdir = ipadir;
  } else {
    const files = fs.readdirSync(ipadir).filter((x) => {
      return x.endsWith('.app');
    });
    if (files.length !== 1) {
      throw new Error('Invalid IPA: ' + ipadir);
    }
    return path.join(ipadir, files[0]);
  }
  if (ipadir.endsWith('/')) {
    ipadir = ipadir.substring(0, ipadir.length - 1);
  }
  return ipadir;
}

async function enumerateTestFiles (dir) {
  let tests = [];
  if (fs.existsSync(dir)) {
    tests = (await fs.readdir(dir)).filter((x) => {
      return x.indexOf('.xctest') !== -1;
    });
  }
  return tests;
}

async function moveFiles (files, sourceDir, destDir) {
  await fs.ensureDir(destDir);
  for (const f of files) {
    const oldName = path.join(sourceDir, f);
    const newName = path.join(destDir, f);
    await fs.rename(oldName, newName);
  }
}
module.exports = Applesign;
