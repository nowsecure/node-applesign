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
const depSolver = require('./lib/depsolver');
const plistBuild = require('plist').build;
const bin = require('./lib/bin');
const machoEntitlements = require('macho-entitlements');

module.exports = class Applesign {
  constructor (options) {
    this.config = config.fromOptions(options);
    this.events = new EventEmitter();
  }

  async signXCarchive (file) {
    const ipaFile = file + '.ipa';
    await tools.xcaToIpa(file, ipaFile);
    await this.signIPA(ipaFile);
  }

  async getIdentities () {
    return tools.getIdentities();
  }

  //  session
  /* Event Wrapper API with cb support */
  emit (ev, msg) {
    this.events.emit(ev, msg);
  }

  on (ev, cb) {
    this.events.on(ev, cb);
    return this;
  }

  /* Public API */
  async signIPA (file) {
    if (typeof file === 'string') {
      this.setFile(file);
    }
    tools.setOptions({
      use7zip: this.config.use7zip,
      useOpenSSL: this.config.useOpenSSL
    });
    console.error('SIGNING ', this.config.file, this.config.outdir);
    if (tools.isDirectory(this.config.file)) {
      throw new Error('This is a directory');
    }
    await this.unzipIPA(this.config.file, this.config.outdir);
    await this.signAppDirectory(this.config.outdir + '/Payload');
    await this.zipIPA();
    await this.cleanup();
    return this;
  }

  // move into index.js
  async signAppDirectory (ipadir, skipNested) {
    if (this.config.run) {
      runScriptSync(this.config.run, this);
    }
    if (!ipadir) {
      ipadir = path.join(this.config.outdir, 'Payload');
    }
    if (!tools.isDirectory(ipadir)) {
      await this.cleanup();
      throw new Error('Not a directory ' + ipadir);
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
        throw new Error('Invalid IPA: ' + ipadir);
      }
      this.config.appdir = path.join(ipadir, files[0]);
      filename = files[0].replace('.app', '');
    }
    const binname = getExecutable(this.config.appdir, filename);
    this.emit('msg', 'BinName: ' + binname);
    this.config.appbin = path.join(this.config.appdir, binname);
    try {
      if (!fs.lstatSync(this.config.appbin).isFile()) {
        throw new Error('This was suposed to be a file');
      }
    } catch (e) {
      const folders = this.config.appdir.split(path.sep);
      const binName = folders[folders.length - 1].replace('.app', '');
      this.config.appbin = path.join(this.config.appdir, binName);
      if (!fs.lstatSync(this.config.appbin).isFile()) {
        throw new Error('This was suposed to be a file');
      }
    }
    if (bin.isBitcode(this.config.appbin)) {
      throw new Error('This IPA contains only bitcode. Must be transpiled for the target device to run.');
    }
    if (bin.isEncrypted(this.config.appbin)) {
      if (!this.config.unfairPlay) {
        throw new Error('This IPA is encrypted');
      }
      this.emit('message', 'Main IPA executable is encrypted');
    } else {
      this.emit('message', 'Main IPA executable is not encrypted');
    }
    if (this.config.insertLibrary !== undefined) {
      await insertLibrary(this.config);
    }
    if (this.config.withoutWatchapp) {
      await this.removeWatchApp();
    }
    const infoPlist = path.join(this.config.appdir, 'Info.plist');
    this.fixPlist(infoPlist, this.config.bundleid);
    await this.checkProvision(this.config.appdir, this.config.mobileprovision);
    await this.fixEntitlements(this.config.appbin);
    await this.signLibraries(this.config.appbin, this.config.appdir);
    if (skipNested !== true) {
      console.error(this.nested);
      for (let nest of this.nested) {
        await this.signAppDirectory(nest, true);
      }
    }
    // await this.signWatchApp(this.config.appdir);
  }

  async signWatchApp (ipadir) {
    // TODO: find any sub directory ending with .app
    const watchApp = path.join(ipadir, 'Watch');
    try {
      if (!tools.isDirectory(watchApp)) {
        return false;
      }
    } catch (error) {
      return false;
    }
    const files = fs.readdirSync(watchApp).filter((x) => {
      return x.endsWith('.app');
    });
    if (files.length === 1) {
      console.error('Found Watch app. Lets sign it');
      await this.signAppDirectory(path.join(watchApp, files[0]));
    }
  }

  async removeWatchApp () {
    const keepTests = true;
    const watchdir = path.join(this.config.appdir, 'Watch');
    this.emit('message', 'Stripping out the WatchApp at ' + watchdir);

    await tools.asyncRimraf(watchdir);
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
    await tools.asyncRimraf(plugdir);
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
    /* allow to generate an IPA file without the embedded.mobileprovision */
    const withoutMobileProvision = false;
    if (withoutMobileProvision) {
      const mobileProvision = path.join(appdir, 'embedded.mobileprovision');
      return fs.unlinkSync(mobileProvision);
    }
    if (file && appdir) {
      this.emit('message', 'Embedding new mobileprovision');
      const mobileProvision = path.join(appdir, 'embedded.mobileprovision');
      if (this.config.selfSignedProvision) {
        /* update entitlements */
        const data = await tools.getMobileProvisionPlist(this.config.mobileprovision);
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
      }
      return fs.copySync(file, mobileProvision);
    }
  }

  adjustEntitlementsSync (file, entMobProv) {
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
  }

  async fixEntitlements (file) {
    if (!this.config.mobileprovision) {
      const pathToProvision = path.join(this.config.appdir, 'embedded.mobileprovision');
      const newEntitlements = await tools.getEntitlementsFromMobileProvision(pathToProvision);
      this.emit('message', 'Using the entitlements from the mobileprovision');
      this.adjustEntitlementsSync(file, newEntitlements);
    }
    const newEntitlements = await tools.getEntitlementsFromMobileProvision(this.config.mobileprovision);
    this.emit('message', JSON.stringify(newEntitlements));
    // const pathToProvision = path.join(this.config.appdir, 'embedded.mobileprovision');
    // fs.copySync(this.config.mobileprovision, pathToProvision);
    // plist.writeFileSync(pathToProvision, newEntitlements);
    this.adjustEntitlementsSync(file, newEntitlements);
  }

  /* Adjust Info.plist */
  fixPlist (file, bundleid) {
    const appdir = this.config.appdir;
    if (!file || !appdir) {
      throw new Error('Invalid parameters for fixPlist');
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

  async signFile (file) {
    if (this.config.lipoArch !== undefined) {
      this.emit('message', '[lipo] ' + this.config.lipoArch + ' ' + file);
      try {
        await tools.lipoFile(file, this.config.lipoArch);
      } catch (ignored) {
      }
    }
    function codesignHasFailed (config, error, errmsg) {
      if (error && error.message.indexOf('Error:') !== -1) {
        throw error;
      }
      return ((errmsg && errmsg.indexOf('no identity found') !== -1) || !config.ignoreCodesignErrors);
    }
    const res = await tools.codesign(this.config.identity, this.config.entitlement, this.config.keychain, file);
    if (res.code !== 0 && codesignHasFailed(this.config, res.code, res.stderr)) {
      return this.emit('end', res.stderr);
    }
    this.emit('message', 'Signed ' + file);
    if (this.config.verifyTwice) {
      this.emit('message', 'Verify ' + file);
      const res = await tools.verifyCodesign(file, this.config.keychain);
      if (res.code !== 0) {
        const type = (this.config.ignoreVerificationErrors) ? 'warning' : 'error';
        return this.emit(type, res.stderr);
      }
    }
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

  findLibrariesSync () {
    let libraries = [];
    let nested = [];
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
    return this.filterLibraries(libraries);
  }

  async signLibraries (bpath, appdir) {
    this.emit('message', 'Signing libraries and frameworks');
    const libraries = this.findLibrariesSync();

    const parallelVerify = async (libs) => {
      if (!this.config.verify) {
        return;
      }
      this.emit('message', 'Verifying ' + libs);
      const promises = libs.map(lib => tools.verifyCodesign);
      return Promise.all(promises);
    };

    const layeredSigning = async (libs) => {
      let libsCopy = libs.slice(0).reverse();
      for (let deps of libsCopy) {
        const promises = deps.map(dep => { return this.signFile(dep); });
        await Promise.all(promises);
      }
      await parallelVerify(libraries);
    };

    const serialSigning = async (libs) => {
      let libsCopy = libs.slice(0).reverse();
      for (let lib of libsCopy) {
        await this.signFile(lib);
        if (this.config.verify) {
          this.emit('message', 'Verifying ' + lib);
          await tools.verifyCodesign(lib);
        }
      }
    };

    this.emit('message', 'Resolving signing order using layered list');
    const libs = await depSolver(bpath, libraries, this.config.parallel);
    if (libs.length === 0) {
      libs.push(bpath);
    }
    if (typeof libs[0] === 'object') {
      return layeredSigning(libs);
    }
    return serialSigning(libs);
  }

  // we probably dont want to have 2 separate functions for this
  async cleanup () {
    if (this.config.noclean) {
      return;
    }
    const outdir = this.config.outdir;
    this.emit('message', 'Cleaning up ' + outdir);
    return tools.asyncRimraf(outdir);
  }

  // delete work directory and resigned ipa file
  async mrproper () {
    if (this.config.noclean) {
      return;
    }
    await this.cleanup();
    await tools.asyncRimraf(this.config.outfile);
  }

  async zipIPA () {
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

  async unzipIPA (file, outdir) {
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

  // must be static
  performForceFamily (data) {
    const have = supportedDevices(data);
    const df = [];
    if (have.iPhone.length > 0) {
      df.push(1);
    }
    if (have.iPad.length > 0) {
      df.push(2);
    }
    if (have.AppleWatch.length > 0 || have.AppleTV.length > 0) {
      this.emit('message', 'Apple{TV/Watch} apps do not require to be re-familied');
      return false;
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

async function insertLibrary (config) {
  const appDir = config.appdir;
  const targetLib = config.insertLibrary;
  const libraryName = path.basename(targetLib);
  try {
    fs.mkdirSync(path.join(appDir, 'Frameworks'));
  } catch (_) {
  }
  const outputLib = path.join(appDir, 'Frameworks', libraryName);
  await insertLibraryLL(outputLib, targetLib);
}

function insertLibraryLL (outputLib, targetLib) {
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

function supportedDevices (data) {
  const have = { iPhone: [], iPad: [] };
  const sd = data.UISupportedDevices;
  if (Array.isArray(sd)) {
    sd.forEach(model => {
      for (let type in ['iPhone', 'iPad']) {
        if (model.indexOf(type) !== -1) {
          if (!have[type]) {
            have[type] = [];
          }
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
      const families = ['Any', 'iPhone', 'iPad', 'AppleTV', 'AppleWatch'];
      const fam = families[family];
      if (fam) {
        have[fam].push(fam);
      }
    });
  }
  return have;
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
    process.env['APPLESIGN_DIRECTORY'] = session.config.appdir;
    process.env['APPLESIGN_MAINBIN'] = session.config.appbin;
    process.env['APPLESIGN_OUTFILE'] = session.config.outfile;
    process.env['APPLESIGN_OUTDIR'] = session.config.outdir;
    process.env['APPLESIGN_FILE'] = session.config.file;
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
