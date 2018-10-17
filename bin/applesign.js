#!/usr/bin/env node
'use strict';

const packageJson = require('../package.json');
const colors = require('colors');
const Applesign = require('../');
const conf = require('minimist')(process.argv.slice(2), {
  string: [
    'i', 'identity',
    'O', 'osversion'
  ],
  boolean: [
    '7', 'use-7zip',
    'a', 'all',
    'B', 'bundleid-access-group',
    'c', 'clone-entitlements',
    'E', 'entry-entitlement',
    'f', 'force-family',
    'f', 'force-family',
    'H', 'allow-http',
    'L', 'identities',
    'M', 'massage-entitlements',
    'n', 'noclean',
    'p', 'parallel',
    'r', 'replace',
    'S', 'self-signed-provision',
    's', 'single',
    'u', 'unfair',
    'u', 'unsigned-provision',
    'V', 'dont-verify',
    'v', 'verify-twice',
    'w', 'without-watchapp',
    'z', 'ignore-zip-errors'
  ]
});

const options = {
  all: conf.a || conf.all || false,
  allowHttp: conf['allow-http'] || conf.H,
  bundleIdKeychainGroup: conf.B || conf['bundleid-access-group'],
  bundleid: conf.bundleid || conf.b,
  cloneEntitlements: conf.c || conf['clone-entitlements'],
  customKeychainGroup: conf.K || conf['add-access-group'],
  dontVerify: conf['dont-verify'] || conf.V,
  entitlement: conf.entitlement || conf.e,
  entry: conf['entry-entitlement'] || conf.E,
  file: conf._[0] || 'undefined',
  forceFamily: conf['force-family'] || conf.f,
  identity: conf.identity || conf.i,
  ignoreZipErrors: conf.z || conf['ignore-zip-errors'],
  insertLibrary: conf.I || conf.insert,
  keychain: conf.keychain || conf.k,
  lipoArch: conf.lipo || conf.l,
  massageEntitlements: conf['massage-entitlements'] || conf.M,
  mobileprovision: conf.mobileprovision || conf.m,
  noclean: conf.n || conf.noclean,
  osversion: conf.osversion || conf.O,
  outfile: conf.output || conf.o,
  parallel: conf.parallel || conf.p,
  replaceipa: conf.replace || conf.r,
  selfSignedProvision: conf.S || conf['self-signed-provision'],
  single: conf.single || conf.s,
  unfairPlay: conf.unfair || conf.u,
  use7zip: conf['7'] || conf['use-7zip'],
  useOpenSSL: conf['use-openssl'],
  verifyTwice: conf.verifyTwice || !!conf.v,
  withoutWatchapp: !!conf['without-watchapp'] || !!conf.w,
};

colors.setTheme({
  error: 'red',
  msg: 'yellow',
  warn: 'green',
});

new Applesign(options, (err, asInstance) => {
  if (err) {
    console.error(err);
  }
  if (conf.identities || conf.L) {
    asInstance.getIdentities((err, ids) => {
      if (err) {
        console.error(colors.error(err));
      } else {
        ids.forEach((id) => {
          console.log(id.hash, id.name);
        });
      }
    });
  } else if (conf.version) {
    console.log(packageJson.version);
  } else if (conf.h || conf.help || conf._.length === 0) {
    console.error(usageMessage);
  } else {
    const target = (conf.s || conf.single) ? 'signFile' : 'signIPA';
    const session = asInstance[target](options.file, (error, data) => {
      if (error) {
        console.error(error, data);
        process.exitCode = 1;
      } else {
        console.log('Target is now signed:', session.config.outfile || options.file);
      }
    }).on('message', (msg) => {
      console.log(colors.msg(msg));
    }).on('warning', (msg) => {
      console.error(colors.error('error'), msg);
    }).on('error', (msg) => {
      console.error(colors.msg(msg));
    });
  }
});

const usageMessage = `Usage:

  applesign [--options ...] [input-ipafile]

  -7, --use-7zip                Use 7zip instead of unzip
      --use-openssl             Use OpenSSL cms instead of Apple's security tool
  -b, --bundleid [BUNDLEID]     Change the bundleid when repackaging
  -B, --bundleid-access-group   Add $(TeamIdentifier).bundleid to keychain-access-groups
  -c, --clone-entitlements      Clone the entitlements from the provisioning to the bin
  -e, --entitlements [ENTITL]   Specify entitlements file (EXPERIMENTAL)
  -E, --entry-entitlement       Use generic entitlement (EXPERIMENTAL)
  -f, --force-family            Force UIDeviceFamily in Info.plist to be iPhone
  -h, --help                    Show this help message
  -H, --allow-http              Add NSAppTransportSecurity.NSAllowsArbitraryLoads in plist
  -i, --identity [1C4D1A..]     Specify hash-id of the identity to use
  -I, --insert [frida.dylib]    Insert a dynamic library to the main executable
  -k, --keychain [KEYCHAIN]     Specify alternative keychain file
  -K, --add-access-group [NAME] Add $(TeamIdentifier).NAME to keychain-access-groups
  -l, --lipo [arm64|armv7]      Lipo -thin all bins inside the IPA for the given architecture
  -L, --identities              List local codesign identities
  -m, --mobileprovision [FILE]  Specify the mobileprovision file to use
  -M, --massage-entitlements    Massage entitlements to remove privileged ones
  -n, --noclean                 keep temporary files when signing error happens
  -o, --output [APP.IPA]        Path to the output IPA filename
  -O, --osversion 9.0           Force specific OSVersion if any in Info.plist
  -p, --parallel                Run layered signing dependencies in parallel
  -r, --replace                 Replace the input IPA file with the resigned one
  -s, --single                  Sign a single file instead of an IPA
  -S, --self-sign-provision     Self-sign mobile provisioning (EXPERIMENTAL)
  -u, --unfair                  Resign encrypted applications
  -v, --verify-twice            Verify after signing every file and at the end
  -V, --dont-verify             Do not perform any codesign verification
  -w, --without-watchapp        Remove the WatchApp from the IPA before resigning
      --version                 Show applesign version
  -z, --ignore-zip-errors       Ignore unzip/7z uncompressing errors
  [input-ipafile]               Path to the IPA file to resign

Example:

  applesign -L # enumerate codesign identities, grab one and use it with -i
  applesign -i AD71EB42BC289A2B9FD3C2D5C9F02D923495A23C test-app.ipa
  applesign -i AD71EB4... -c --lipo arm64 -w -V test-app.ipa
`;
