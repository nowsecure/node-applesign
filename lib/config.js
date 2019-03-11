'use strict';

const path = require('path');
const idprov = require('./idprov');

const helpMessage = `Usage:

  applesign [--options ...] [input-ipafile]

  -7, --use-7zip                Use 7zip instead of unzip
      --use-openssl             Use OpenSSL cms instead of Apple's security tool
  -a, --all                     Resign all binaries, even it unrelated to the app
  -A, --all-dirs                Archive all directories, not just Payload/
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
  -p, --parallel                Run layered signing dependencies in parallel (EXPERIMENTAL)
  -r, --replace                 Replace the input IPA file with the resigned one
  -s, --single                  Sign a single file instead of an IPA
  -S, --self-sign-provision     Self-sign mobile provisioning (EXPERIMENTAL)
  -t, --without-get-task-allow  Do not set the get-task-allow entitlement (EXPERIMENTAL)
  -u, --unfair                  Resign encrypted applications
  -v, --verify                  Verify all the signed files at the end
  -V, --verify-twice            Verify after signing every file and at the end
  -w, --without-watchapp        Remove the WatchApp from the IPA before resigning
      --version                 Show applesign version
  -z, --ignore-zip-errors       Ignore unzip/7z uncompressing errors
  [input-ipafile]               Path to the IPA file to resign

Examples:

  applesign -L # enumerate codesign identities, grab one and use it with -i
  applesign -m embedded.mobileprovision test-app.ipa
  applesign -i AD71EB42BC289A2B9FD3C2D5C9F02D923495A23C test-app.ipa
  applesign -i AD71EB4... -c --lipo arm64 -w -V test-app.ipa
`;

const fromOptions = function (opt) {
  if (typeof opt !== 'object') {
    opt = {};
  }
  if (opt.osversion !== undefined) {
    if (isNaN(+opt.osversion)) {
      throw new Error('Version passed to -O must be numeric');
    }
  }
  if (opt.mobileprovision) {
    if (Array.isArray(opt.mobileprovision)) {
      opt.mobileprovisions = opt.mobileprovision;
      opt.mobileprovision = opt.mobileprovision[0];
      // throw new Error('Multiple mobile provisionings not yet supported');
    }
    const mp = opt.mobileprovision;
    opt.mobileprovisions = [mp];
    if (opt.identity) {
      const id0 = idprov(mp);
      const id1 = opt.identity;
      if (id0 !== id1) {
        // throw new Error('MobileProvisioningVersion doesn\'t match the given identity (' + id0 + ' vs ' + id1 + ')');
      }
    } else {
      opt.identity = idprov(mp);
    }
  } else {
    opt.mobileprovision = undefined;
    opt.mobileprovisions = [];
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
    mobileprovision: opt.mobileprovision,
    mobileprovisions: opt.mobileprovisions,
    noclean: opt.noclean || false,
    run: opt.run,
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
};

const fromState = function (state) {
  return JSON.parse(JSON.stringify(state));
};

function parse (argv) {
  return require('minimist')(argv.slice(2), {
    string: [
      'i', 'identity',
      'O', 'osversion',
      'R', 'run'
    ],
    boolean: [
      '7', 'use-7zip',
      'a', 'all',
      'A', 'all-dirs',
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
      'A', 'parallel',
      'r', 'replace',
      'S', 'self-signed-provision',
      's', 'single',
      't', 'without-get-task-allow',
      'u', 'unfair',
      'u', 'unsigned-provision',
      'v', 'verify',
      'V', 'verify-twice',
      'w', 'without-watchapp',
      'z', 'ignore-zip-errors'
    ]
  });
}

function compile (conf) {
  const options = {
    all: conf.a || conf.all || false,
    allDirs: conf['all-dirs'] || conf.A,
    allowHttp: conf['allow-http'] || conf.H,
    bundleIdKeychainGroup: conf.B || conf['bundleid-access-group'],
    bundleid: conf.bundleid || conf.b,
    cloneEntitlements: conf.c || conf['clone-entitlements'],
    customKeychainGroup: conf.K || conf['add-access-group'],
    entitlement: conf.entitlement || conf.e,
    entry: conf['entry-entitlement'] || conf.E,
    file: conf._[0] || 'undefined',
    forceFamily: conf['force-family'] || conf.f,
    withGetTaskAllow: !(conf['without-get-task-allow'] || conf.t),
    identity: conf.identity || conf.i,
    ignoreZipErrors: conf.z || conf['ignore-zip-errors'],
    insertLibrary: conf.I || conf.insert,
    run: conf.R || conf.run,
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
    verify: conf.v || conf.V || conf.verify || conf['verify-twice'],
    verifyTwice: conf.V || conf['verify-twice'],
    withoutWatchapp: !!conf['without-watchapp'] || !!conf.w
  };
  return options;
}

module.exports = {
  helpMessage: helpMessage,
  fromState: fromState,
  fromOptions: fromOptions,
  compile: compile,
  parse: parse
};
