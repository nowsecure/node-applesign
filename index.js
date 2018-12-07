'use strict';

const path = require('path');
const tools = require('./lib/tools');
const idprov = require('./lib/idprov');
const ApplesignSession = require('./lib/session');

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
      const id0 = idprov(opt.mobileprovision);
      const id1 = opt.identity;
      if (id0 !== id1) {
        throw new Error('MobileProvisioningVersion doesn\'t match the given identity (' + id0 + ' vs ' + id1 + ')');
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
      verify: opt.verify || false,
      verifyTwice: opt.verifyTwice || false,
      withoutWatchapp: opt.withoutWatchapp || false
    };
  }

  signDirectory (directory, cb) {
    return this.newSession(directory, cb, (err, cb, session) => {
      if (err) {
        console.error(err);
      }
      session.signAppDirectory(directory, (error, res) => {
        if (error) {
          console.error(error);
        }
        session.finalize(cb, error);
      });
    });
  }

  signIPA (file, cb) {
    return this.newSession(file, cb, (err, cb, session) => {
      if (err) {
        return cb(err);
      }
      if (tools.isDirectory(file)) {
        return cb(new Error('This is a directory'));
      }
      session.signIPA((err) => {
        session.finalize(cb, err);
      });
    });
  }

  newSession (file, cb, action) {
    const s = new ApplesignSession(this.config);
    if (typeof file === 'function') {
      cb = file;
    } else {
      s.setFile(file);
    }
    return {
      start: (cb) => { action(undefined, cb, s); },
      session: s
    };
  }

  signFile (file, cb) {
    return this.newSession(file, cb, (err, cb, session) => {
      if (err) {
        return cb(err);
      }
      session.signFile(file, cb);
    });
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
