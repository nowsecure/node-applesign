'use strict';

const path = require('path');
const idprov = require('./idprov');

const shortHelpMessage = `Usage:

  applesign [--options ...] [target.ipa | Payload/Target.app]

  -a, --all                     Resign all binaries, even it unrelated to the app
  -b, --bundleid [BUNDLEID]     Change the bundleid when repackaging
  -c, --clone-entitlements      Clone the entitlements from the provisioning to the bin
  -f, --force-family            Force UIDeviceFamily in Info.plist to be iPhone
  -h, --help                    Show verbose help message
  -H, --allow-http              Add NSAppTransportSecurity.NSAllowsArbitraryLoads in plist
  -i, --identity [1C4D1A..]     Specify hash-id of the identity to use
  -L, --identities              List local codesign identities
  -m, --mobileprovision [FILE]  Specify the mobileprovision file to use
  -o, --output [APP.IPA]        Path to the output IPA filename
  -O, --osversion 9.0           Force specific OSVersion if any in Info.plist
  -p, --without-plugins         Remove plugins (excluding XCTests) from the resigned IPA
  -w, --without-watchapp        Remove the WatchApp from the IPA before resigning
  -x, --without-xctests         Remove the XCTests from the resigned IPA

Example:

  $ applesign -w -c -m embedded.mobileprovision target.ipa
`;

const helpMessage = `Usage:

  applesign [--options ...] [input-ipafile]

  Packaging:
  -7, --use-7zip                Use 7zip instead of unzip
  -A, --all-dirs                Archive all directories, not just Payload/
  -I, --insert [frida.dylib]    Insert a dynamic library to the main executable
  -l, --lipo [arm64|armv7]      Lipo -thin all bins inside the IPA for the given architecture
  -n, --noclean                 keep temporary files when signing error happens
  -o, --output [APP.IPA]        Path to the output IPA filename
  -P, --parallel                Run layered signing dependencies in parallel (EXPERIMENTAL)
  -r, --replace                 Replace the input IPA file with the resigned one
  -u, --unfair                  Resign encrypted applications
  -z, --ignore-zip-errors       Ignore unzip/7z uncompressing errors

  Stripping:
  -p, --without-plugins         Remove plugins (excluding XCTests) from the resigned IPA
  -w, --without-watchapp        Remove the WatchApp from the IPA before resigning
  -x, --without-xctests         Remove the XCTests from the resigned IPA

  Signing:
      --use-openssl             Use OpenSSL cms instead of Apple's security tool (EXPERIMENTAL)
  -a, --all                     Resign all binaries, even it unrelated to the app
  -d, --debug [file]            Create debug file with all the signing process
  -i, --identity [1C4D1A..]     Specify hash-id of the identity to use
  -j, --json '{}'               Set the alternative JSON for signing files with custom entitlments
  -k, --keychain [KEYCHAIN]     Specify custom keychain file
  -K, --add-access-group [NAME] Add $(TeamIdentifier).NAME to keychain-access-groups
  -L, --identities              List local codesign identities
  -m, --mobileprovision [FILE]  Specify the mobileprovision file to use
  -s, --single                  Sign a single file instead of an IPA
  -S, --self-sign-provision     Self-sign mobile provisioning (EXPERIMENTAL)
  -v, --verify                  Verify all the signed files at the end
  -V, --verify-twice            Verify after signing every file and at the end

  Info.plist
  -b, --bundleid [BUNDLEID]     Change the bundleid when repackaging
  -B, --bundleid-access-group   Add $(TeamIdentifier).bundleid to keychain-access-groups
  -f, --force-family            Force UIDeviceFamily in Info.plist to be iPhone
  -H, --allow-http              Add NSAppTransportSecurity.NSAllowsArbitraryLoads in plist
  -O, --osversion 9.0           Force specific OSVersion if any in Info.plist

  Entitlements:
  -c, --clone-entitlements      Clone the entitlements from the provisioning to the bin
  -e, --entitlements [ENTITL]   Specify entitlements file (EXPERIMENTAL)
  -E, --entry-entitlement       Use generic entitlement (EXPERIMENTAL)
  -M, --massage-entitlements    Massage entitlements to remove privileged ones
  -t, --without-get-task-allow  Do not set the get-task-allow entitlement (EXPERIMENTAL)
  -C, --no-entitlements-file    Do not create .entitlements file in the IPA

  -h, --help                    Show this help message
      --version                 Show applesign version
  [input-ipafile]               Path to the IPA file to resign

Examples:

  $ applesign -L # enumerate codesign identities, grab one and use it with -i
  $ applesign -m embedded.mobileprovision target.ipa
  $ applesign -i AD71EB42BC289A2B9FD3C2D5C9F02D923495A23C target.ipa
  $ applesign -m a.mobileprovision -c --lipo arm64 -w target.ipa
  $ applesign -m a.mobileprovision -j '{"custom":[{"filematch":"ShareExtension$","entitlements":"/tmp/foo.ent"}]}' target.ipa

Installing in the device:

  $ ideviceinstaller -i target-resigned.ipa
  $ ios-deploy -b  target-resigned.ipa
`;

/*
// Expected format:
// ----------------

{
  "custom": [
    {
      "filematch": "ShareExtension$",
      "entitlements": "/tmp/share.entitlements",
      "__identity": "83498489489X",
    }
  ]
}

*/

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
    withoutSigningFiles: opt.withoutSigningFiles || false,
    debug: opt.d || opt.debug || '',
    json: JSON.parse(opt.json || '{}'),
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
    noEntitlementsFile: opt.noEntitlementsFile || false,
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
    withoutPlugins: opt.withoutPlugins || false,
    withoutWatchapp: opt.withoutWatchapp || false,
    withoutXCTests: opt.withoutXCTests || false
  };
};

const fromState = function (state) {
  return JSON.parse(JSON.stringify(state));
};

function parse (argv) {
  return require('minimist')(argv.slice(2), {
    string: [
      'd', 'debug',
      'j', 'json',
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
      'C', 'no-entitlements-file',
      'E', 'entry-entitlement',
      'f', 'force-family',
      'F', 'without-signing-files',
      'H', 'allow-http',
      'L', 'identities',
      'M', 'massage-entitlements',
      'n', 'noclean',
      'p', 'without-plugins',
      'P', 'parallel',
      'r', 'replace',
      'S', 'self-signed-provision',
      's', 'single',
      't', 'without-get-task-allow',
      'u', 'unfair',
      'u', 'unsigned-provision',
      'v', 'verify',
      'V', 'verify-twice',
      'w', 'without-watchapp',
      'x', 'without-xctests',
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
    debug: conf.debug || conf.d || '',
    entitlement: conf.entitlement || conf.e,
    entry: conf['entry-entitlement'] || conf.E,
    file: conf._[0] || undefined,
    forceFamily: conf['force-family'] || conf.f,
    withGetTaskAllow: !(conf['without-get-task-allow'] || conf.t),
    json: conf.json || conf.j,
    identity: conf.identity || conf.i,
    ignoreZipErrors: conf.z || conf['ignore-zip-errors'],
    insertLibrary: conf.I || conf.insert,
    run: conf.R || conf.run,
    keychain: conf.keychain || conf.k,
    lipoArch: conf.lipo || conf.l,
    massageEntitlements: conf['massage-entitlements'] || conf.M,
    mobileprovision: conf.mobileprovision || conf.m,
    noclean: conf.n || conf.noclean,
    noEntitlementsFile: conf.C || conf['no-entitlements-file'] || conf.noEntitlementsFile,
    osversion: conf.osversion || conf.O,
    outfile: (conf.output || conf.o) ? path.resolve(conf.output || conf.o): '',
    parallel: conf.parallel || conf.P,
    replaceipa: conf.replace || conf.r,
    selfSignedProvision: conf.S || conf['self-signed-provision'],
    single: conf.single || conf.s,
    unfairPlay: conf.unfair || conf.u,
    use7zip: conf['7'] || conf['use-7zip'],
    useOpenSSL: conf['use-openssl'],
    verify: conf.v || conf.V || conf.verify || conf['verify-twice'],
    verifyTwice: conf.V || conf['verify-twice'],
    withoutWatchapp: !!conf['without-watchapp'] || !!conf.w,
    withoutPlugins: !!conf['without-plugins'] || !!conf.p,
    withoutXCTests: !!conf['without-xctests'] || !!conf.x
  };
  return options;
}

module.exports = {
  helpMessage: helpMessage,
  shortHelpMessage: shortHelpMessage,
  fromState: fromState,
  fromOptions: fromOptions,
  compile: compile,
  parse: parse
};
