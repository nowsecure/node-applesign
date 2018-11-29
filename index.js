'use strict';

const tools = require('./tools');
const path = require('path');
const ApplesignSession = require('./session');
const idprov = require('./idprov');

module.exports = class Applesign {
  constructor (options, cb) {
    this.config = this.withConfig(options);
    if (typeof cb === 'function') {
      tools.findInPath(cb, this);
    }
  }

  withConfig (opt) {
    if (typeof opt !== 'object') {
      opt = {};
    }
    if (opt.osversion !== undefined) {
      if (isNaN(+opt.osversion)) {
        throw new Error('Version passed to -O must be numeric');
      }
    }
    if (opt.mobileprovision && opt.identity) {
      if (idprov(opt.mobileprovision) !== opt.identity) {
        throw new Error('MobileProvisioningVersion doesn\'t match the given identity');
      }
    } else if (opt.mobileprovision && !opt.identity) {
      opt.identity = idprov(opt.mobileprovision);
    }
    return {
      all: opt.all || false,
      allowHttp: opt.allowHttp || false,
      osversion: opt.osversion || undefined,
      bundleid: opt.bundleid || undefined,
      bundleIdKeychainGroup: opt.bundleIdKeychainGroup || false,
      cloneEntitlements: opt.cloneEntitlements || false,
      customKeychainGroup: opt.customKeychainGroup || undefined,
      dontVerify: opt.dontVerify || false,
      entitlement: opt.entitlement || undefined,
      entry: opt.entry || undefined,
      allDirs: opt.allDirs || true,
      file: opt.file ? path.resolve(opt.file) : undefined,
      forceFamily: opt.forceFamily || false,
      identity: opt.identity || undefined,
      withGetTaskAllow: opt.withGetTaskAllow,
      ignoreCodesignErrors: true,
      ignoreVerificationErrors: true,
      ignoreZipErrors: opt.ignoreZipErrors || false,
      insertLibrary: opt.insertLibrary || undefined,
      keychain: opt.keychain,
      lipoArch: opt.lipoArch || undefined,
      massageEntitlements: opt.massageEntitlements || false,
      mobileprovision: opt.mobileprovision || undefined,
      noclean: opt.noclean || false,
      outdir: undefined,
      outfile: opt.outfile,
      parallel: opt.parallel || false,
      replaceipa: opt.replaceipa || false,
      selfSignedProvision: opt.selfSignedProvision || false,
      unfairPlay: opt.unfairPlay || false,
      use7zip: opt.use7zip === true,
      useOpenSSL: opt.useOpenSSL === true,
      verifyTwice: opt.verifyTwice || false,
      withoutWatchapp: opt.withoutWatchapp || false,
    };
  }

  signIPA (file, cb) {
    const s = new ApplesignSession(this.config);
    if (typeof file === 'function') {
      cb = file;
    } else {
      s.setFile(file);
    }
    return s.signIPA((err) => {
      s.finalize(cb, err);
    });
  }

  signFile (file, cb) {
    const s = new ApplesignSession(this.config);
    return s.signFile(file, cb);
  }

  signXCarchive (file, cb) {
    const ipaFile = file + '.ipa';
    tools.xcaToIpa(file, (error) => {
      if (error) {
        this.emit('warning', error);
        return cb(error);
      }
      this.signIPA(ipaFile, cb);
    });
  }

  getIdentities (cb) {
    tools.getIdentities(cb);
  }
};
