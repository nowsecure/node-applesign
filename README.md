node-applesign
===============

NodeJS module and commandline utility for re-signing iOS applications (IPA files).

Author
------

Sergi Alvarez Capilla aka pancake @ nowsecure.com

Program Dependencies
--------------------

* zip          - re-create IPA
* unzip        - decompress IPA (see `npm run unzip-lzfse`)
* codesign     - sign and verify binary with new entitlements and identity
* security     - get entitlements from mobileprovision
* insert_dylib - only if you want to use the -I,--insert flag

Usage
-----

When running without arguments we get a short help message

```
$ bin/applesign.js
Usage:

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
```

The full help is displayed when passing the `--help` flag.

```
$ bin/applesign.js --help
Usage:

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
      --use-openssl             Use OpenSSL cms instead of Apple's security tool
  -a, --all                     Resign all binaries, even it unrelated to the app
  -i, --identity [1C4D1A..]     Specify hash-id of the identity to use
  -k, --keychain [KEYCHAIN]     Specify alternative keychain file
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

Installing in the device:

  $ ideviceinstaller -i target-resigned.ipa
  $ ios-deploy -b  target-resigned.ipa

```

List local codesign identities:

	$ bin/applesign -L

Resign an IPA with a specific identity:

	$ bin/applesign -i 1C4D1A442A623A91E6656F74D170A711CB1D257A foo.ipa

Change bundleid:

	$ bin/applesign -b org.nowsecure.testapp path/to/ipa

Signing methods
---------------

There are different ways to sign an IPA file with applesign for experimental reasons.

You may want to check the following options:

**-c, --clone-entitlements**

put the entitlements embedded inside the signed mobileprovisioning file provided by the user as the default ones to sign all the binaries

**-S, --self-sign-provision**

creates a custom mobileprovisioning (unsigned for now). installd complains

**-E, --entry-entitlement**

use the default entitlements plist. useful when troubleshooting

The default signing method does as follow:

* Grab entitlements from binary
* Remove problematic entitlements
* Grab entitlements from the provisioning
* Adjust application-id and team-id of the binary with the provisioning ones
* Copy the original mobileprovisioning inside the IPA
* Creates ${AppName}.entitlements and signs all the mach0s

After some testing we will probably go for having -c or -E as default.

In addition, for performance reasons, applesign supports -p for parallel signing. The order of signing the binaries inside an IPA matters, so applesign creates a dependency list of all the bins and signs them in order. The parallel signing aims to run in parallel as much tasks as possible without breaking the dependency list.

Mangling
--------

It is possible with `--force-family` to remove the UISupportedDevices from the Info.plist and replace the entitlement information found in the mobileprovisioning and then carefully massage the rest of entitlements to drop the privileged ones (`--massage-entitlements`).

Other interesting manipulations that can be done in the IPA are:

**-I, --insert [frida.dylib]**

Allows to insert a dynamic library in the main executable. This is how Frida can be injected to introspect iOS applications without jailbreak.

**-l, --lipo [arm64|armv7]**

Thinifies an IPA by removing all fatmach0s to only contain binaries for one specified architecture. Also this is helpful to identify non-arm binaries embedded inside IPA that can be leaked from development or pre-production environments.

In order to thinify the final IPA even more, applesign allows to drop the watchapp extensions which would not be necessary for non Apple Watch users.

Performance
-----------

Sometimes the time required to run the codesigning step matters, so applesign allows to skip some steps and speedup the process.

See `--dont-verify` and `--parallel` commandline flags.

Enabling those options can result on a 35% speedup on ~60MB IPAs.

API usage
---------

Here's a simple program that resigns an IPA:

```js
const Applesign = require('applesign');

const as = new Applesign({
  identity: '81A24300FE2A8EAA99A9601FDA3EA811CD80526A',
  mobileprovision: '/path/to/dev.mobileprovision',
  withoutWatchapp: true
});
as.events.on('warning', (msg) => {
  console.log('WARNING', msg);
})
.on('message', (msg) => {
  console.log('msg', msg);
});

as.signIPA('/path/to/app.ipa')
.then(_ => {
  console.log('ios-deploy -b', as.config.outfile);
})
.catch(e => {
  console.error(e);
  process.exitCode = 1;
});

```

To list the developer identities available in the system:

```js
try {
  const ids = await as.getIdentities();
  ids.forEach((id) => {
    console.log(id.hash, id.name);
  });
} catch (err) {
  console.error(err, ids);
}
```

Bear in mind that the Applesign object can tuned to use different
configuration options:

```js
const options = {
  file: '/path/to/app.ipa',
  outfile: '/path/to/app-resigned.ipa',
  entitlement: '/path/to/entitlement',
  bundleid: 'app.company.bundleid',
  identity: 'hash id of the developer',
  mobileprovision: '/path/to/mobileprovision file',
  ignoreVerificationErrors: true,
  withoutWatchapp: true
};
```

Further reading
---------------

See the Wiki: https://github.com/nowsecure/node-applesign/wiki

* https://github.com/maciekish/iReSign
* https://github.com/saucelabs/isign
* https://github.com/phonegap/ios-deploy

Pre iOS9 devices will require a developer account:

* http://dev.mlsdigital.net/posts/how-to-resign-an-ios-app-from-external-developers/
