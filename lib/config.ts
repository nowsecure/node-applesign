// Converted to ES module

import path from "node:path";
import idprov from "./idprov.js";
import { parseArgs } from "node:util";

const shortHelpMessage = `Usage:

  applesign [--options ...] [target.ipa | Payload/Target.app]

  -a, --all                     Resign all binaries, even it unrelated to the app
  -b, --bundleid [BUNDLEID]     Change the bundleid when repackaging
  -c, --clone-entitlements      Clone the entitlements from the provisioning to the bin
  -D, --device-provision        Automatically find the mobileprovision for the available device
  -f, --force-family            Force UIDeviceFamily in Info.plist to be iPhone
  -h, --help                    Show verbose help message
  -H, --allow-http              Add NSAppTransportSecurity.NSAllowsArbitraryLoads in plist
  -i, --identity [1C4D1A..]     Specify hash-id of the identity to use
  -L, --identities              List local codesign identities
  -m, --mobileprovision [FILE]  Specify the mobileprovision file to use
  -o, --output [APP.IPA]        Path to the output IPA filename
  -O, --osversion 9.0           Force specific OSVersion if any in Info.plist
  -R, --run [SCRIPT]            Run a hook script before signing starts
  -T, --tempdir [DIR]           Path to the output directory for temporary files
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
  -T, --tempdir [DIR]           Path to the output directory for temporary files
  -u, --unfair                  Resign encrypted applications
  -z, --ignore-zip-errors       Ignore unzip/7z uncompressing errors

  Stripping:
  -F, --without-signing-files   Remove signing related files
  -p, --without-plugins         Remove plugins (excluding XCTests) from the resigned IPA
  -w, --without-watchapp        Remove the WatchApp from the IPA before resigning
  -x, --without-xctests         Remove the XCTests from the resigned IPA

  Signing:
      --use-openssl             Use OpenSSL cms instead of Apple's security tool (EXPERIMENTAL)
  -a, --all                     Resign all binaries, even it unrelated to the app
  -d, --debug [file]            Create debug file with all the signing process
  -D, --device-provision        Automatically find the mobileprovision for the available device
  -i, --identity [1C4D1A..]     Specify hash-id of the identity to use
  -j, --json '{}'               Set the alternative JSON for signing files with custom entitlements
  -k, --keychain [KEYCHAIN]     Specify custom keychain file
  -K, --add-access-group [NAME] Add $(TeamIdentifier).NAME to keychain-access-groups
  -L, --identities              List local codesign identities
  -m, --mobileprovision [FILE]  Specify the mobileprovision file to use
  -R, --run [SCRIPT]            Run a hook script before signing starts
  -s, --single                  Sign a single file instead of an IPA
  -S, --self-sign-provision     Self-sign mobile provisioning (EXPERIMENTAL)
  -v, --verify                  Verify all the signed files at the end
  -V, --verify-twice            Verify after signing every file and at the end
  -Z, --pseudo-sign             Pseudo sign the binaries (EXPERIMENTAL)

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
  -N, --add-entitlements [FILE] Append entitlements from file (EXPERIMENTAL)
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
export interface ConfigOptions {
  appdir: any;
  appbin: any;
  all: boolean;
  allDirs: boolean;
  allowHttp: boolean;
  addEntitlements: string | null;
  bundleIdKeychainGroup: string | false;
  bundleid: string | undefined;
  cloneEntitlements: boolean;
  customKeychainGroup: string | undefined;
  debug: any; // opt.d || opt.debug || ""
  deviceProvision: any; // opt.D || opt.deviceProvision || false
  entitlement: string | undefined;
  entry: any; // opt.entry || undefined
  file: string | undefined;
  forceFamily: boolean;
  identity: string | undefined;
  ignoreCodesignErrors: boolean;
  ignoreVerificationErrors: boolean;
  ignoreZipErrors: boolean;
  insertLibrary: any; // opt.insertLibrary || undefined,
  json: any; // JSON.parse(opt.json || "{}"),
  keychain: any;
  lipoArch: any;
  massageEntitlements: boolean;
  mobileprovision: any;
  mobileprovisions: any;
  noEntitlementsFile: any;
  payloadOnly: boolean;
  noclean: boolean;
  osversion: any; // opt.osversion || undefined,
  tempdir: string | undefined;
  outfile: string | null;
  parallel: boolean;
  pseudoSign: boolean;
  replaceipa: boolean;
  run: any;
  selfSignedProvision: boolean;
  unfairPlay: boolean;
  use7zip: boolean;
  useOpenSSL: boolean;
  verify: boolean;
  verifyTwice: boolean;
  withGetTaskAllow: boolean;
  withoutPlugins: boolean;
  withoutSigningFiles: boolean;
  withoutWatchapp: boolean;
  withoutXCTests: boolean;
}

const fromOptions = function (opt: any): ConfigOptions {
  if (typeof opt !== "object") {
    opt = {};
  }
  if (opt.osversion !== undefined) {
    if (isNaN(+opt.osversion)) {
      throw new Error("Version passed to -O must be numeric");
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
    allDirs: opt.allDirs || true,
    allowHttp: opt.allowHttp || false,
    addEntitlements: opt.addEntitlements || undefined,
    bundleIdKeychainGroup: opt.bundleIdKeychainGroup || false,
    bundleid: opt.bundleid || undefined,
    cloneEntitlements: opt.cloneEntitlements || false,
    customKeychainGroup: opt.customKeychainGroup || undefined,
    debug: opt.d || opt.debug || "",
    deviceProvision: opt.D || opt.deviceProvision || false,
    entitlement: opt.entitlement || undefined,
    entry: opt.entry || undefined,
    file: opt.file ? path.resolve(opt.file) : undefined,
    forceFamily: opt.forceFamily || false,
    identity: opt.identity || undefined,
    ignoreCodesignErrors: true,
    ignoreVerificationErrors: true,
    ignoreZipErrors: opt.ignoreZipErrors || false,
    insertLibrary: opt.insertLibrary || undefined,
    json: JSON.parse(opt.json || "{}"),
    keychain: opt.keychain,
    lipoArch: opt.lipoArch || undefined,
    massageEntitlements: opt.massageEntitlements || false,
    mobileprovision: opt.mobileprovision,
    mobileprovisions: opt.mobileprovisions,
    noEntitlementsFile: opt.noEntitlementsFile || false,
    noclean: opt.noclean || false,
    osversion: opt.osversion || undefined,
    appbin: undefined,
    appdir: undefined,
    tempdir: opt.tempdir ? path.resolve(opt.tempdir) : undefined,
    payloadOnly: false,
    outfile: opt.outfile,
    parallel: opt.parallel || false,
    pseudoSign: opt.pseudoSign || false,
    replaceipa: opt.replaceipa || false,
    run: opt.run,
    selfSignedProvision: opt.selfSignedProvision || false,
    unfairPlay: opt.unfairPlay || false,
    use7zip: opt.use7zip === true,
    useOpenSSL: opt.useOpenSSL === true,
    verify: opt.verify || false,
    verifyTwice: opt.verifyTwice || false,
    withGetTaskAllow: opt.withGetTaskAllow,
    withoutPlugins: opt.withoutPlugins || false,
    withoutSigningFiles: opt.withoutSigningFiles || false,
    withoutWatchapp: opt.withoutWatchapp || false,
    withoutXCTests: opt.withoutXCTests || false,
  };
};

const fromState = function (state: any) {
  return JSON.parse(JSON.stringify(state));
};

const options = {
  "add-access-group": { type: "string", short: "K" },
  "add-entitlements": { type: "string", short: "N" },
  bundleid: { type: "string", short: "b" },
  debug: { type: "string", short: "d" },
  entitlements: { type: "string", short: "e" },
  identity: { type: "string", short: "i" },
  insert: { type: "string", short: "I" },
  json: { type: "string", short: "j" },
  keychain: { type: "string", short: "k" },
  lipo: { type: "string", short: "l" },
  mobileprovision: { type: "string", short: "m" },
  osversion: { type: "string", short: "O" },
  output: { type: "string", short: "o" },
  run: { type: "string", short: "R" },
  tempdir: { type: "string", short: "T" },
  all: { type: "boolean", short: "a" },
  "all-dirs": { type: "boolean", short: "A" },
  "allow-http": { type: "boolean", short: "H" },
  "bundleid-access-group": { type: "boolean", short: "B" },
  "clone-entitlements": { type: "boolean", short: "c" },
  "device-provision": { type: "boolean", short: "D" },
  "entry-entitlement": { type: "boolean", short: "E" },
  "force-family": { type: "boolean", short: "f" },
  help: { type: "boolean", short: "h" },
  identities: { type: "boolean", short: "L" },
  "ignore-zip-errors": { type: "boolean", short: "z" },
  "massage-entitlements": { type: "boolean", short: "M" },
  "no-entitlements-file": { type: "boolean", short: "C" },
  noclean: { type: "boolean", short: "n" },
  parallel: { type: "boolean", short: "P" },
  "pseudo-sign": { type: "boolean", short: "Z" },
  replace: { type: "boolean", short: "r" },
  "self-sign-provision": { type: "boolean", short: "S" },
  single: { type: "boolean", short: "s" },
  unfair: { type: "boolean", short: "u" },
  "use-7zip": { type: "boolean", short: "7" },
  "use-openssl": { type: "boolean" },
  verify: { type: "boolean", short: "v" },
  "verify-twice": { type: "boolean", short: "V" },
  version: { type: "boolean" },
  "without-get-task-allow": { type: "boolean", short: "t" },
  "without-plugins": { type: "boolean", short: "p" },
  "without-signing-files": { type: "boolean", short: "F" },
  "without-watchapp": { type: "boolean", short: "w" },
  "without-xctests": { type: "boolean", short: "x" },
} as const;

function parse(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv.slice(2),
    options,
    allowPositionals: true,
  });
  return { ...values, _: positionals };
}

function compile(conf: any) {
  const options = {
    all: conf.all || false,
    allDirs: conf["all-dirs"],
    allowHttp: conf["allow-http"],
    addEntitlements: conf["add-entitlements"],
    bundleIdKeychainGroup: conf["bundleid-access-group"],
    bundleid: conf.bundleid,
    cloneEntitlements: conf["clone-entitlements"],
    customKeychainGroup: conf["add-access-group"],
    debug: conf.debug || "",
    deviceProvision: conf["device-provision"] || false,
    entitlement: conf.entitlements,
    entry: conf["entry-entitlement"],
    file: conf._[0] || undefined,
    forceFamily: conf["force-family"],
    identity: conf.identity,
    ignoreZipErrors: conf["ignore-zip-errors"],
    insertLibrary: conf.insert,
    json: conf.json,
    keychain: conf.keychain,
    lipoArch: conf.lipo,
    massageEntitlements: conf["massage-entitlements"],
    mobileprovision: conf.mobileprovision,
    noEntitlementsFile: conf["no-entitlements-file"],
    noclean: conf.noclean,
    osversion: conf.osversion,
    tempdir: conf.tempdir ? path.resolve(conf.tempdir) : undefined,
    outfile: conf.output ? path.resolve(conf.output) : "",
    parallel: conf.parallel,
    pseudoSign: conf["pseudo-sign"],
    replaceipa: conf.replace,
    run: conf.run,
    selfSignedProvision: conf["self-sign-provision"],
    single: conf.single,
    unfairPlay: conf.unfair,
    use7zip: conf["use-7zip"],
    useOpenSSL: conf["use-openssl"],
    verify: conf.verify || conf["verify-twice"],
    verifyTwice: conf["verify-twice"],
    withGetTaskAllow: !conf["without-get-task-allow"],
    withoutPlugins: !!conf["without-plugins"],
    withoutSigningFiles: !!conf["without-signing-files"],
    withoutWatchapp: !!conf["without-watchapp"],
    withoutXCTests: !!conf["without-xctests"],
  };
  return options;
}

export {
  compile,
  fromOptions,
  fromState,
  helpMessage,
  parse,
  shortHelpMessage,
};
