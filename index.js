'use strict';

const tools = require('./tools');
const path = require('path');
const ApplesignSession = require('./session');

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
    return {
      file: opt.file ? path.resolve(opt.file) : undefined,
      use7zip: opt.use7zip === true,
      useOpenSSL: opt.useOpenSSL === true,
      outdir: undefined,
      outfile: opt.outfile,
      keychain: opt.keychain,
      cloneEntitlements: opt.cloneEntitlements || false,
      ignoreVerificationErrors: true,
      ignoreCodesignErrors: true,
      ignoreZipErrors: opt.ignoreZipErrors || false,
      insertLibrary: opt.insertLibrary || undefined,
      entitlement: opt.entitlement || undefined,
      entry: opt.entry || undefined,
      lipoArch: opt.lipoArch || undefined,
      bundleid: opt.bundleid || undefined,
      identity: opt.identity || undefined,
      replaceipa: opt.replaceipa || false,
      withoutWatchapp: opt.withoutWatchapp || false,
      mobileprovision: opt.mobileprovision || undefined,
      massageEntitlements: opt.massageEntitlements || false,
      forceFamily: opt.forceFamily || false,
      allowHttp: opt.allowHttp || false,
      parallel: opt.parallel || false,
      verifyTwice: opt.verifyTwice || false,
      unfairPlay: opt.unfairPlay || false,
      selfSignedProvision: opt.selfSignedProvision || false,
      dontVerify: opt.dontVerify || false,
      bundleIdKeychainGroup: opt.bundleIdKeychainGroup || false,
      customKeychainGroup: opt.customKeychainGroup || undefined,
      noclean: opt.noclean || false
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
