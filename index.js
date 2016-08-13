'use strict';

const tools = require('./tools');
const path = require('path');
const ApplesignSession = require('./session');

module.exports = class Applesign {
  constructor (options) {
    this.config = this.withConfig(options);
  }

  withConfig (opt) {
    if (typeof opt !== 'object') {
      opt = {};
    }
    return {
      file: path.resolve(opt.file),
      outdir: undefined,
      outfile: opt.outfile,
      keychain: opt.keychain,
      ignoreVerificationErrors: true,
      ignoreCodesignErrors: true,
      entitlement: opt.entitlement || undefined,
      entry: opt.entry || undefined,
      bundleid: opt.bundleid || undefined,
      identity: opt.identity || undefined,
      replaceipa: opt.replaceipa || false,
      withoutWatchapp: opt.withoutWatchapp || false,
      mobileprovision: opt.mobileprovision || undefined,
      forceFamily: opt.forceFamily || false,
      parallel: opt.parallel || false,
      verifyTwice: opt.verifyTwice || false,
      unfairPlay: opt.unfairPlay || false
    };
  }

  signIPA (file, cb) {
    const s = new ApplesignSession(this.config);
    if (typeof file === 'function') {
      cb = file;
    } else {
      s.setFile(file);
    }
    return s.signIPA(cb);
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
