'use strict';

const tools = require('./tools');
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
      file: opt.file,
      outdir: undefined,
      outfile: opt.outfile,
      keychain: opt.keychain,
      ignoreVerificationErrors: true,
      ignoreCodesignErrors: true,
      entitlement: opt.entitlement || undefined,
      bundleid: opt.bundleid || undefined,
      identity: opt.identity || undefined,
      replaceipa: opt.replaceipa || false,
      watchapp: opt.watchapp || false,
      mobileprovision: opt.mobileprovision || undefined
    };
  }

  signIPA (file, cb) {
    const s = new ApplesignSession(this.config);
    if (typeof cb === 'function') {
      s.setFile(file);
    } else {
      cb = file;
    }
    return s.signIPA(cb);
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
