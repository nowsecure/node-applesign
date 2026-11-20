import * as tools from "./lib/tools.js";
import * as config from "./lib/config.js";
import idprov from "./lib/idprov.js";
import { EventEmitter } from "node:events";
import path from "node:path";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import { walkSync } from "@nodelib/fs.walk";
import plist from "./lib/plist.js";
import fchk from "./lib/fchk.js";
import { homedir, tmpdir } from "node:os";
import {
  AppDirectory,
  assertInsideBundle,
  bundleExecutablePath,
} from "./lib/appdir.js";
import depSolver from "./lib/depsolver.js";
import adjustInfoPlist from "./lib/info-plist.js";
import defaultEntitlements from "./lib/entitlements.js";
import * as bin from "./lib/bin.js";

import { build as plistBuild } from "plist";

class Applesign {
  config: config.ConfigOptions;
  debugObject: Record<string, any>;
  events: EventEmitter;
  nested: any[];
  tmpDir: string;
  constructor(options: any) {
    this.config = config.fromOptions(options || {});
    this.events = new EventEmitter();
    this.nested = [];
    this.debugObject = {};
    this.tmpDir = this._makeTmpDir();
  }

  _makeTmpDir() {
    const tmp = tmpdir();
    const base = path.join(tmp, "applesign");
    const result = path.join(base, randomUUID());
    fs.mkdirSync(result, { recursive: true });
    return result;
  }

  _fullPathInTmp(filePath: string) {
    const dirname = path.dirname(filePath);
    const dirnameInTmp = path.join(this.tmpDir, dirname);
    fs.mkdirSync(dirnameInTmp, { recursive: true });
    return path.join(this.tmpDir, filePath);
  }

  async getDeviceProvision() {
    const installedProvisions = await tools.ideviceprovision("list");
    const pd = path.join(
      homedir(),
      "Library",
      "MobileDevice",
      "Provisioning Profiles",
    );
    for (const ip of installedProvisions) {
      const absPath = path.join(pd, ip + ".mobileprovision");
      if (fs.existsSync(absPath)) {
        return absPath;
      }
    }
    throw new Error(
      "Cannot find provisioning file automatically. Please use -m",
    );
  }

  async signXCarchive(file: string) {
    fchk(arguments, ["string"]);
    const ipaFile = file + ".ipa";
    await tools.xcaToIpa(file, ipaFile);
    await this.signIPA(ipaFile);
  }

  async getIdentities() {
    fchk(arguments, []);
    return tools.getIdentities();
  }

  async signIPA(file: string) {
    fchk(arguments, ["string"]);
    if (typeof file === "string") {
      this.setFile(file);
    }
    tools.setOptions({
      use7zip: this.config.use7zip,
      useOpenSSL: this.config.useOpenSSL,
    });
    // unsure, but this.config.file shouldnt be undefined
    if (!this.config.file) {
      this.config.file = file;
    }
    await this._pullMobileProvision();
    this.emit("message", "File: " + this.config.file);
    this.emit("message", "Tempdir: " + this.config.tempdir);
    if (tools.isDirectory(this.config.file as string)) {
      throw new Error("This is a directory");
    }
    try {
      if (!this.config.tempdir) {
        throw new Error("No tempdir specified");
      }
      await this.unzipIPA(this.config.file, this.config.tempdir);
      this.config.appdir = getAppDirectory(
        getPayloadDirectory(this.config.tempdir),
      );
      if (this.config.debug) {
        this.debugObject = {};
      }
      const tasks = [];
      if (this.config.withoutWatchapp) {
        tasks.push(this.removeWatchApp());
      }
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
      await this.signAppDirectory(this.config.appdir);
      await this.zipIPA();
    } finally {
      await this.cleanup();
    }
    return this;
  }

  async _pullMobileProvision() {
    if (this.config.deviceProvision === true) {
      this.config.mobileprovision = await this.getDeviceProvision();
      this.config.mobileprovisions = [this.config.mobileprovision];
      this.config.identity = idprov(this.config.mobileprovision);
    }
    this.config.mobileprovision = this.config.mobileprovisions[0];
    if (this.config.mobileprovisions.length > 1) {
      this.config.mobileprovisions.slice(1);
    }
  }

  async signAppDirectoryInternal(ipadir: string, skipNested: boolean) {
    fchk(arguments, ["string", "boolean"]);
    await this._pullMobileProvision();
    if (this.config.run) {
      await runScript(this.config.run, this);
    }
    this.config.appdir = ipadir;
    const binname = getExecutable(this.config.appdir);
    this.emit("msg", "Main Executable Name: " + binname);
    this.config.appbin = bundleExecutablePath(this.config.appdir, binname);
    if (!fs.lstatSync(this.config.appbin).isFile()) {
      throw new Error("This was supposed to be a file");
    }
    if (bin.isBitcode(this.config.appbin)) {
      throw new Error(
        "This IPA contains only bitcode. Must be transpiled for the target device to run.",
      );
    }
    if (bin.isEncrypted(this.config.appbin)) {
      if (!this.config.unfairPlay) {
        throw new Error("This IPA is encrypted");
      }
      this.emit("warning", "Main IPA executable is encrypted");
    } else {
      this.emit("message", "Main IPA executable is not encrypted");
    }
    // nested apps are only signed, like the appexs
    if (!skipNested && this.config.insertLibrary !== undefined) {
      await injectLibrary(this.config);
    }
    if (!skipNested) {
      const infoPlistPath = path.join(this.config.appdir, "Info.plist");
      adjustInfoPlist(infoPlistPath, this.config, this.emit.bind(this));
    }
    if (!this.config.pseudoSign) {
      if (!this.config.mobileprovision) {
        throw new Error("warning: No mobile provisioning file provided");
      }
      await this.checkProvision(
        this.config.appdir,
        this.config.mobileprovision,
      );
    }
    await this.adjustEntitlements(this.config.appbin);
    await this.signLibraries(this.config.appbin, this.config.appdir);

    if (skipNested !== true) {
      const { appbin } = this.config;
      for (const nest of this.nested) {
        if (tools.isDirectory(nest)) {
          await this.signAppDirectoryInternal(nest, true);
        } else {
          this.emit("warning", "Cannot find " + nest);
        }
      }
      Object.assign(this.config, { appdir: ipadir, appbin });
    }
  }

  async signAppDirectory(ipadir: string) {
    fchk(arguments, ["string"]);
    return this.signAppDirectoryInternal(ipadir, false);
  }

  async removeWatchApp() {
    fchk(arguments, []);
    const watchdir = path.join(this.config.appdir, "Watch");
    this.emit("message", "Stripping out the WatchApp at " + watchdir);
    await tools.asyncRimraf(watchdir);

    const placeholderdir = path.join(
      this.config.appdir,
      "com.apple.WatchPlaceholder",
    );
    this.emit("message", "Stripping out the WatchApp at " + placeholderdir);
    await tools.asyncRimraf(placeholderdir);
  }

  async removeXCTests() {
    fchk(arguments, []);
    // reversed, children come first so emptied dirs (.framework) go too
    const dir = this.config.appdir;
    for (const { path: p, dirent } of walkSync(dir).reverse()) {
      const empty = dirent.isDirectory() && fs.readdirSync(p).length === 0;
      if (empty || path.relative(dir, p).toLowerCase().includes("xctest")) {
        this.emit("message", "Deleting " + p);
        fs.rmSync(p, { recursive: true });
      }
    }
  }

  async removeSigningFiles() {
    fchk(arguments, []);
    const ext = /\.(entitlements|mobileprovision)$/;
    // SC_Info holds the FairPlay .sinf/.supp files of the app and its appexs
    walkSync(this.config.appdir).forEach(({ path: target, name, dirent }) => {
      if (dirent.isDirectory() ? name === "SC_Info" : ext.test(name)) {
        this.emit("message", "Deleting " + target);
        fs.rmSync(target, { recursive: true, force: true });
      }
    });
  }

  async removePlugins() {
    fchk(arguments, []);
    const plugdir = path.join(this.config.appdir, "PlugIns");
    const tmpdir = path.join(this.config.appdir, "applesign_xctest_tmp");
    this.emit("message", "Stripping out the PlugIns at " + plugdir);
    let tests: string[] = [];
    if (!this.config.withoutXCTests) {
      tests = await enumerateTestFiles(plugdir);
      if (tests.length > 0) {
        await moveFiles(tests, plugdir, tmpdir);
      }
    }

    await tools.asyncRimraf(plugdir);
    if (tests.length > 0) {
      await moveFiles(tests, tmpdir, plugdir);
      await fs.promises.rmdir(tmpdir);
    }
  }

  findProvisioningsSync() {
    fchk(arguments, []);
    const files: string[] = [];
    walkSync(this.config.appdir).forEach(({ path: file, name: filename }) => {
      // only walk on files. Symlinks and other special files are forbidden
      if (!fs.lstatSync(file).isFile()) {
        return;
      }
      if (filename === "embedded.mobileprovision") {
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
  async checkProvision(appdir: string, file: string) {
    fchk(arguments, ["string", "string"]);
    /* Deletes the embedded.mobileprovision from the ipa? */
    const withoutMobileProvision = false;
    if (withoutMobileProvision) {
      const files = this.findProvisioningsSync();
      files.forEach((file: string) => {
        console.error("Deleting ", file);
        fs.unlinkSync(file);
      });
    }
    if (appdir && file && !withoutMobileProvision) {
      this.emit("message", "Embedding new mobileprovision");
      const mobileProvision = path.join(appdir, "embedded.mobileprovision");
      tools.assertNotSymlink(mobileProvision);
      if (this.config.selfSignedProvision) {
        /* update entitlements */
        const data = await tools.getMobileProvisionPlist(
          this.config.mobileprovision,
        );
        const mainBin = bundleExecutablePath(appdir, getExecutable(appdir));
        let ent = bin.entitlements(mainBin);
        if (ent === null) {
          this.emit(
            "warning",
            "Cannot find entitlements in binary. Using defaults",
          );
          const entMobProv = data.Entitlements;
          const teamId = entMobProv["com.apple.developer.team-identifier"];
          const appId = entMobProv["application-identifier"];
          ent = defaultEntitlements(appId, teamId);
        }
        data.Entitlements = plist.parse(ent.toString().trim());
        /* TODO: self-sign mobile provisioning */
        return fs.writeFileSync(mobileProvision, plistBuild(data).toString());
      }
      return fs.copyFileSync(file, mobileProvision);
    }
  }

  debugInfo(path: string, key: any, val: any) {
    if (!val) {
      return;
    }
    const f = path.replace(this.config.tempdir + "/", "");
    if (!this.debugObject) {
      this.debugObject = {};
    }
    if (this.debugObject[f] === undefined) {
      this.debugObject[f] = {};
    }
    this.debugObject[f][key] = val;
  }

  addEntitlementsSync(orig: any) {
    if (!this.config.addEntitlements) {
      return orig;
    }
    this.emit("message", "Adding entitlements from file");
    const addEnt = plist.readFileSync(this.config.addEntitlements);
    // TODO: deepmerge
    return Object.assign(orig, addEnt);
  }

  adjustEntitlementsSync(file: string, entMobProv: any) {
    if (this.config.pseudoSign) {
      const ent = bin.entitlements(file);
      if (ent === null) {
        return;
      }
      let entMacho = plist.parse(ent.toString().trim());
      entMacho = this.addEntitlementsSync(entMacho);
      // TODO: merge additional entitlements here
      const newEntitlements = plistBuild(entMacho).toString();
      const newEntitlementsFile = file + ".entitlements";
      const tmpEntitlementsFile = this._fullPathInTmp(newEntitlementsFile);
      fs.writeFileSync(tmpEntitlementsFile, newEntitlements);
      this.config.entitlement = tmpEntitlementsFile;
      return;
    }
    fchk(arguments, ["string", "object"]);
    this.debugInfo(file, "before", entMobProv);
    const teamId = entMobProv["com.apple.developer.team-identifier"];
    const appId = entMobProv["application-identifier"];
    let ent = bin.entitlements(file);
    if (ent === null && !this.config.cloneEntitlements) {
      console.error("Cannot find entitlements in binary. Using defaults");
      ent = defaultEntitlements(appId, teamId);
    }
    let entMacho: any;
    if (ent !== null) {
      entMacho = plist.parse(ent.toString().trim());
      entMacho = this.addEntitlementsSync(entMacho);
      this.debugInfo(file, "fullPath", file);
      this.debugInfo(file, "oldEntitlements", entMacho || "TODO");
      if (this.config.selfSignedProvision) {
        this.emit("message", "Using an unsigned provisioning");
        const newEntitlementsFile = file + ".entitlements";
        const newEntitlements = plistBuild(entMacho).toString();
        const tmpEntitlementsFile = this._fullPathInTmp(newEntitlementsFile);
        fs.writeFileSync(tmpEntitlementsFile, newEntitlements);
        this.config.entitlement = tmpEntitlementsFile;
        if (!this.config.noEntitlementsFile) {
          tools.assertNotSymlink(newEntitlementsFile);
          fs.writeFileSync(newEntitlementsFile, newEntitlements);
        }
        this.debugInfo(file, "newEntitlements", plist.parse(newEntitlements));
        return;
      }
    }
    let changed = false;
    if (this.config.cloneEntitlements) {
      this.emit("message", "Cloning entitlements");
      entMacho = entMobProv;
      changed = true;
    } else {
      const k = "com.apple.developer.icloud-container-identifiers";
      if (entMacho[k]) {
        entMacho[k] = "iCloud." + appId;
      }
      ["application-identifier", "com.apple.developer.team-identifier"].forEach(
        (id) => {
          if (entMacho[id] !== entMobProv[id]) {
            changed = true;
            entMacho[id] = entMobProv[id];
          }
        },
      );
      if (this.config.massageEntitlements === true) {
        if (typeof entMacho["keychain-access-groups"] === "object") {
          changed = true;
          // keychain access groups makes the resigning fail with -M
          delete entMacho["keychain-access-groups"];
          // entMacho['keychain-access-groups'][0] = appId;
        }
        [
          "com.apple.developer.ubiquity-kvstore-identifier",
          "com.apple.developer.ubiquity-container-identifiers",
          "com.apple.developer.icloud-container-identifiers",
          "com.apple.developer.icloud-container-environment",
          "com.apple.developer.icloud-services",
          "com.apple.developer.payment-pass-provisioning",
          "com.apple.developer.default-data-protection",
          "com.apple.networking.vpn.configuration",
          "com.apple.developer.associated-domains",
          "com.apple.security.application-groups",
          "com.apple.developer.in-app-payments",
          "com.apple.developer.siri",
          "beta-reports-active", /* our entitlements doesnt support beta */
          "aps-environment",
        ].forEach((id) => {
          if (typeof entMacho[id] !== "undefined") {
            delete entMacho[id];
            changed = true;
          }
        });
      } else if (!this.config.cloneEntitlements) {
        delete entMacho["com.apple.developer.icloud-container-identifiers"];
        delete entMacho["com.apple.developer.icloud-container-environment"];
        delete entMacho["com.apple.developer.ubiquity-kvstore-identifier"];
        delete entMacho["com.apple.developer.icloud-services"];
        delete entMacho["com.apple.developer.siri"];
        delete entMacho["com.apple.developer.in-app-payments"];
        delete entMacho["aps-environment"];
        delete entMacho["com.apple.security.application-groups"];
        delete entMacho["com.apple.developer.associated-domains"];
        delete entMacho["keychain-access-groups"];
        changed = true;
      }
    }

    if (typeof this.config.withGetTaskAllow !== "undefined") {
      this.emit(
        "message",
        "get-task-allow set to " + this.config.withGetTaskAllow,
      );
      entMacho["get-task-allow"] = this.config.withGetTaskAllow;
      changed = true;
    }

    const additionalKeychainGroups = [];
    if (typeof this.config.customKeychainGroup === "string") {
      additionalKeychainGroups.push(this.config.customKeychainGroup);
    }
    const infoPlist = path.join(this.config.appdir, "Info.plist");
    tools.assertNotSymlink(infoPlist);
    const plistData = plist.readFileSync(infoPlist) as Record<string, any>;
    if (this.config.bundleIdKeychainGroup) {
      if (typeof this.config.bundleid === "string") {
        additionalKeychainGroups.push(this.config.bundleid);
      } else {
        const bundleid = plistData.CFBundleIdentifier;
        additionalKeychainGroups.push(bundleid);
      }
    }
    if (this.config.osversion !== undefined) {
      plistData.MinimumOSVersion = this.config.osversion;
      if (plistData.DTPlatformVersion !== undefined) {
        plistData.DTPlatformVersion = this.config.osversion;
      }
      plist.writeFileSync(infoPlist, plistData);
    }
    if (additionalKeychainGroups.length > 0) {
      const newGroups = additionalKeychainGroups.map(
        (group) => `${teamId}.${group}`,
      );
      const groups = entMacho["keychain-access-groups"];
      if (typeof groups === "undefined") {
        entMacho["keychain-access-groups"] = newGroups;
      } else {
        groups.push(...newGroups);
      }
      changed = true;
    }
    if (changed || this.config.entry) {
      const newEntitlementsFile = file + ".entitlements";
      let newEntitlements = appId && teamId && this.config.entry
        ? defaultEntitlements(appId, teamId)
        : this.config.entitlement
        ? fs.readFileSync(this.config.entitlement).toString()
        : plistBuild(entMacho).toString();
      const ent = plist.parse(newEntitlements.trim()) as Record<string, any>;
      const shouldRenameGroups = !this.config.mobileprovision &&
        !this.config.cloneEntitlements;
      if (shouldRenameGroups && ent["com.apple.security.application-groups"]) {
        const ids = appId.split(".");
        ids.shift();
        const id = ids.join(".");
        const groups = [];
        for (const group of ent["com.apple.security.application-groups"]) {
          const cols = group.split(".");
          if (cols.length === 4) {
            groups.push("group." + id);
          } else {
            groups.push("group." + id + "." + cols.pop());
          }
        }
        ent["com.apple.security.application-groups"] = groups;
      }
      delete ent[
        "beta-reports-active"
      ]; /* our entitlements doesnt support beta */
      if (this.config.massageEntitlements === true) {
        delete ent["com.apple.developer.ubiquity-container-identifiers"]; // TODO should be massaged
      }
      newEntitlements = plistBuild(ent).toString();

      this.debugInfo(file, "newEntitlements", ent);

      const tmpEntitlementsFile = this._fullPathInTmp(newEntitlementsFile);
      fs.writeFileSync(tmpEntitlementsFile, newEntitlements);
      this.config.entitlement = tmpEntitlementsFile;
      if (!this.config.noEntitlementsFile) {
        fs.writeFileSync(tmpEntitlementsFile, newEntitlements);
        this.emit(
          "message",
          "Updated binary entitlements" + tmpEntitlementsFile,
        );
      }
      this.debugInfo(file, "after", newEntitlements);
    } else {
      this.debugInfo(file, "nothing-changed", true);
    }
  }

  async adjustEntitlements(file: string) {
    fchk(arguments, ["string"]);
    let newEntitlements = null;
    if (!this.config.pseudoSign) {
      const mp = this.config.mobileprovision
        ? this.config.mobileprovision
        : path.join(this.config.appdir, "embedded.mobileprovision");
      newEntitlements = await tools.getEntitlementsFromMobileProvision(mp);
      this.emit("message", JSON.stringify(newEntitlements));
    }
    this.adjustEntitlementsSync(file, newEntitlements);
  }

  async signFile(file: string) {
    const config = this.config;
    function customOptions(config: any, file: string) {
      if (
        typeof config.json === "object" &&
        typeof config.json.custom === "object"
      ) {
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
    function getKeychain() {
      return custom !== false && custom.keychain !== undefined
        ? custom.keychain
        : config.keychain;
    }
    function getIdentity() {
      return custom !== false && custom.identity !== undefined
        ? custom.identity
        : config.identity;
    }
    function getEntitlements() {
      return custom !== false && custom.entitlements !== undefined
        ? custom.entitlements
        : config.entitlement;
    }

    fchk(arguments, ["string"]);
    if (this.config.lipoArch !== undefined) {
      this.emit("message", "[lipo] " + this.config.lipoArch + " " + file);
      try {
        await tools.lipoFile(file, this.config.lipoArch);
      } catch (ignored) {}
    }
    function codesignHasFailed(config: any, error: any, errmsg: string) {
      if (error && errmsg.indexOf("Error:") !== -1) {
        throw error;
      }
      return (
        (errmsg && errmsg.indexOf("no identity found") !== -1) ||
        !config.ignoreCodesignErrors
      );
    }
    const identity = getIdentity();
    let entitlements = "";
    if (this.config.cloneEntitlements) {
      const mp = await tools.getMobileProvisionPlist(
        this.config.mobileprovision,
      );
      const newEntitlementsFile = file + ".entitlements";
      const tmpEntitlementsFile = this._fullPathInTmp(newEntitlementsFile);
      const entstr = plistBuild(mp.Entitlements, {
        pretty: true,
        allowEmpty: false,
      }).toString();
      fs.writeFileSync(tmpEntitlementsFile, entstr);
      entitlements = tmpEntitlementsFile;
    } else {
      entitlements = getEntitlements();
    }
    let res: any;
    if (this.config.pseudoSign) {
      const newEntitlementsFile = file + ".entitlements";
      const tmpEntitlementsFile = this._fullPathInTmp(newEntitlementsFile);
      const entitlements = fs.existsSync(tmpEntitlementsFile)
        ? tmpEntitlementsFile
        : null;
      res = await tools.ldidSign(entitlements, file);
    } else {
      const keychain = getKeychain();
      res = await tools.codesign(identity, entitlements, keychain, file);
      if (res.code !== 0 && codesignHasFailed(config, res.code, res.stderr)) {
        return this.emit("end", res.stderr);
      }
    }
    this.emit("message", "Signed " + file);
    if (config.verifyTwice) {
      this.emit("message", "Verify " + file);
      const res = await tools.verifyCodesign(file, config.keychain);
      if (res.code !== 0) {
        const type = config.ignoreVerificationErrors ? "warning" : "error";
        return this.emit(type, res.stderr);
      }
    }
    return this;
  }

  findLibrariesSync() {
    fchk(arguments, []);
    const libraries: any = [];
    const nested: any = [];
    const exe = path.sep + getExecutable(this.config.appdir);
    const folders = this.config.appbin.split(path.sep);
    const exe2 = path.sep + folders[folders.length - 1];

    let found = false;
    walkSync(this.config.appdir).forEach(({ path: file }) => {
      // only walk on files. Symlinks and other special files are forbidden
      if (!fs.lstatSync(file).isFile()) {
        return;
      }
      if (file.endsWith(exe) || file.endsWith(exe2)) {
        this.emit("message", "Executable found at " + file);
        libraries.push(file);
        found = true;
        return;
      }

      const nest = nestedApp(this.config.appdir, file);
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
      throw new Error("Cannot find any MACH0 binary to sign");
    }
    console.error("Found nested", nested);
    this.nested = nested;
    return libraries;
  }

  async signLibraries(bpath: string, appdir: string) {
    fchk(arguments, ["string", "string"]);
    this.emit("message", "Signing libraries and frameworks");

    const parallelVerify = async (libs: any) => {
      if (!this.config.verify) {
        return;
      }
      this.emit("message", "Verifying " + libs);
      const promises = libs.flat().map((l: string) => tools.verifyCodesign(l));
      return Promise.all(promises);
    };

    // last line of defense: never sign anything outside of the app bundle
    const signBundleFile = async (file: string) => {
      assertInsideBundle(appdir, file);
      return this.signFile(file);
    };

    const layeredSigning = async (libs: any) => {
      const libsCopy = libs.slice(0).reverse();
      for (const deps of libsCopy) {
        const promises = deps.map((dep: any) => {
          return signBundleFile(dep);
        });
        await Promise.all(promises);
      }
      await parallelVerify(libs);
    };

    const serialSigning = async (libs: any) => {
      const libsCopy = libs.slice(0).reverse();
      for (const lib of libsCopy) {
        await signBundleFile(lib);
        if (this.config.verify) {
          this.emit("message", "Verifying " + lib);
          await tools.verifyCodesign(lib);
        }
      }
    };

    this.emit("message", "Resolving signing order using layered list");
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
        assertInsideBundle(appdir, appex);
        await this.adjustEntitlements(appex);
        await signBundleFile(appex);
      }

      this.emit(
        "message",
        "Nested: " + JSON.stringify(ls.nestedApplications()),
      );
      this.emit(
        "message",
        "SystemLibraries: " + JSON.stringify(ls.systemLibraries()),
      );
      this.emit(
        "message",
        "DiskLibraries: " + JSON.stringify(ls.diskLibraries()),
      );
      this.emit(
        "message",
        "UnavailableLibraries: " + JSON.stringify(ls.unavailableLibraries()),
      );
      this.emit(
        "message",
        "AppLibraries: " + JSON.stringify(ls.appLibraries()),
      );
      this.emit("message", "Orphan: " + JSON.stringify(ls.orphanedLibraries()));
      const libraries = ls.appLibraries();
      if (this.config.all) {
        libraries.push(...ls.orphanedLibraries());
      } else {
        for (const ol of ls.orphanedLibraries()) {
          console.error("Warning: Orphaned library not signed, try -a: " + ol);
        }
      }
      this.debugInfo("analysis", "orphan", ls.orphanedLibraries());
      // const libraries = ls.diskLibraries ();
      libs = libraries.filter((library: any) => !ls.appexs.includes(library)); // remove already-signed appexs
    }
    if (libs.length === 0) {
      libs.push(bpath);
    }
    return typeof libs[0] === "object"
      ? layeredSigning(libs)
      : serialSigning(libs);
  }

  async cleanup() {
    fchk(arguments, []);
    if (this.config.noclean) {
      return;
    }
    const tempdir = this.config.tempdir;
    this.emit("message", "Cleaning up " + tempdir);
    return tools.asyncRimraf(tempdir);
  }

  async cleanupTmp() {
    this.emit("message", "Cleaning up temp dir " + this.tmpDir);
    await tools.asyncRimraf(this.tmpDir);
  }

  async zipIPA() {
    fchk(arguments, []);
    if (!this.config.file) {
      console.error("Missing input file to zip");
      return;
    }
    const ipaIn = this.config.file as string;
    if (!this.config.tempdir) {
      throw new Error("No tempdir specified");
    }
    const ipaOut = getOutputPath(this.config.tempdir, this.config.outfile!);
    try {
      await fs.promises.unlink(ipaOut);
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        throw err;
      }
    }
    this.events.emit("message", "Zipifying into " + ipaOut + " ...");
    const rootFolder = this.config.payloadOnly ? "Payload" : ".";
    await tools.zip(this.config.tempdir, ipaOut, rootFolder);
    if (this.config.replaceipa) {
      this.events.emit("message", "mv into " + ipaIn);
      await fs.promises.rename(ipaOut, ipaIn);
    }
  }

  setFile(name: any) {
    fchk(arguments, ["string"]);
    this.config.file = path.resolve(name);
    this.config.tempdir ??= this.config.file + "." + randomUUID();
    if (!this.config.outfile) {
      this.config.outfile = getResignedFilename(this.config.file);
    }
  }

  async unzipIPA(file: string, workdir: string): Promise<void> {
    fchk(arguments, ["string", "string"]);
    if (!file) {
      throw new Error("No input file specified");
    }
    if (!workdir) {
      throw new Error("No output directory specified");
    }
    await this.cleanup();
    this.events.emit("message", "Unzipping " + file);
    await tools.unzip(file, workdir);
  }

  /* Event Wrapper API with cb support */
  emit(ev: any, msg: any) {
    this.events.emit(ev, msg);
  }

  on(ev: any, cb: any) {
    this.events.on(ev, cb);
    return this;
  }
}

// helper functions

// next to the input, not next to the tempdir which -T may move elsewhere
function getResignedFilename(input: string): string | null {
  if (!input) {
    return null;
  }
  const { dir, name } = path.parse(input);
  return path.join(dir, name + "-resigned.ipa");
}

function getExecutable(appdir: string) {
  if (!appdir) {
    throw new Error("No application directory is provided");
  }
  const plistPath = path.join(appdir, "Info.plist");
  let cfBundleExecutable;
  try {
    const plistData = plist.readFileSync(plistPath) as Record<string, any>;
    cfBundleExecutable = plistData.CFBundleExecutable;
  } catch (e) {
    // do nothing
  }
  if (cfBundleExecutable) {
    bundleExecutablePath(appdir, cfBundleExecutable);
    return cfBundleExecutable;
  }
  const exename = path.basename(appdir);
  const dotap = exename.indexOf(".app");
  return dotap === -1 ? exename : exename.substring(0, dotap);
}

async function injectLibrary(config: any) {
  const appDir = config.appdir;
  const targetLib = config.insertLibrary;
  const libraryName = path.basename(targetLib);
  const frameworksDir = path.join(appDir, "Frameworks");
  try {
    fs.mkdirSync(frameworksDir);
  } catch (_) {}
  if (!tools.isDirectory(frameworksDir)) {
    throw new Error("Not a directory: " + frameworksDir);
  }
  const outputLib = path.join(frameworksDir, libraryName);
  tools.assertNotSymlink(outputLib);
  await insertLibraryLL(outputLib, targetLib, config);
}

function insertLibraryLL(outputLib: any, targetLib: string, config: any) {
  return new Promise((resolve, reject) => {
    try {
      const writeStream = fs.createWriteStream(outputLib);
      writeStream.on("finish", () => {
        /* XXX: if binary doesnt contains an LC_RPATH load command this will not work */
        const insertedLibraryName = "@rpath/" + path.basename(targetLib);
        fs.chmodSync(outputLib, 0x1ed); // 0755
        /* Just copy the library via USB on the DCIM directory */
        // const insertedLibraryName = '/var/mobile/Media/DCIM/' + path.basename(targetLib);
        /* useful on jailbroken devices where we can write in /usr/lib */
        // const insertedLibraryName = '/usr/lib/' + path.basename(targetLib);
        /* forbidden in iOS */
        // const insertedLibraryName = '@executable_path/Frameworks/' + path.basename(targetLib);
        tools
          .insertLibrary(insertedLibraryName, config.appbin, outputLib)
          .then(resolve)
          .catch(reject);
      });
      fs.createReadStream(targetLib).pipe(writeStream);
    } catch (e) {
      reject(e);
    }
  });
}

function parentDirectory(root: string) {
  return path.normalize(path.join(root, ".."));
}

function getOutputPath(cwd: string, ofile: string) {
  return ofile.startsWith(path.sep)
    ? ofile
    : path.join(parentDirectory(cwd), ofile);
}

async function runScript(script: string, session: any) {
  if (script.endsWith(".js")) {
    try {
      const s = await import(pathToFileURL(path.resolve(script)).href);
      return s.default(session);
    } catch (e: any) {
      console.error(e);
      return false;
    }
  } else {
    process.env.APPLESIGN_DIRECTORY = session.config.appdir;
    process.env.APPLESIGN_MAINBIN = session.config.appbin;
    process.env.APPLESIGN_OUTFILE = session.config.outfile;
    process.env.APPLESIGN_TEMPDIR = session.config.tempdir || "";
    process.env.APPLESIGN_FILE = session.config.file;
    try {
      const res = execSync(script);
      console.error(res.toString());
    } catch (e: any) {
      console.error(e.toString());
      return false;
    }
  }
  return true;
}

function nestedApp(appdir: string, file: string) {
  const rel = path.relative(appdir, file);
  const dotApp = rel.indexOf(".app/");
  return dotApp !== -1 && path.join(appdir, rel.substring(0, dotApp + 4));
}

function getPayloadDirectory(tempdir?: string): string {
  if (!tempdir) {
    throw new Error("No tempdir specified");
  }
  return path.join(tempdir, "Payload");
}

function getAppDirectory(directory: string): string {
  if (!tools.isDirectory(directory)) {
    throw new Error("Not a directory " + directory);
  }
  if (directory.endsWith(".app")) {
    return directory;
  }
  const files = fs.readdirSync(directory).filter((x: string) => {
    return x.endsWith(".app");
  });
  if (files.length !== 1) {
    throw new Error("Invalid IPA: " + directory);
  }
  const appdir = path.join(directory, files[0]);
  if (!tools.isDirectory(appdir)) {
    throw new Error("Invalid IPA: " + appdir + " is not a directory");
  }
  return appdir;
}

async function enumerateTestFiles(dir: string): Promise<string[]> {
  let tests: string[] = [];
  if (fs.existsSync(dir)) {
    tests = (await fs.promises.readdir(dir)).filter((x: string) => {
      return x.indexOf(".xctest") !== -1;
    });
  }
  return tests;
}

async function moveFiles(files: string[], sourceDir: string, destDir: string) {
  await fs.promises.mkdir(destDir, { recursive: true });
  for (const f of files) {
    const oldName = path.join(sourceDir, f);
    const newName = path.join(destDir, f);
    await fs.promises.rename(oldName, newName);
  }
}
export default Applesign;
