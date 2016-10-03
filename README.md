node-applesign
===============

NodeJS module and commandline utility for re-signing iOS applications (IPA files).

Author
------

Sergi Alvarez aka pancake @ nowsecure.com

Program Dependencies
--------------------

* zip      - re-create IPA
* unzip    - decompress IPA
* codesign - sign and verify binary with new entitlements and identity
* security - get entitlements from mobileprovision

Usage
-----

	$ bin/ipa-resign.js
	Usage:

	  ipa-resign.js [--options ...] [input-ipafile]
	  -7, --use-7zip                Use 7zip instead of unzip
	      --use-openssl             Use OpenSSL cms instead of Apple's security tool
	  -b, --bundleid [BUNDLEID]     Change the bundleid when repackaging
	  -c, --clone-entitlements      Clone the entitlements from the provisioning to the bin
	  -e, --entitlements [ENTITL]   Specify entitlements file (EXPERIMENTAL)
	  -E, --entry-entitlement       Use generic entitlement (EXPERIMENTAL)
	  -f, --force-family            Force UIDeviceFamily in Info.plist to be iPhone
	  -i, --identity [1C4D1A..]     Specify hash-id of the identity to use
	  -I, --insert [frida.dylib]    Insert a dynamic library to the main executable
	  -k, --keychain [KEYCHAIN]     Specify alternative keychain file
	  -l, --lipo [arm64|armv7]      Lipo -thin all bins inside the IPA for the given architecture
	  -L, --identities              List local codesign identities
	  -m, --mobileprovision [FILE]  Specify the mobileprovision file to use
	  -M, --massage-entitlements    Massage entitlements to remove privileged ones
	  -o, --output [APP.IPA]        Path to the output IPA filename
	  -p, --parallel                Run layered signing dependencies in parallel
	  -r, --replace                 Replace the input IPA file with the resigned one
	  -s, --single                  Sign a single file instead of an IPA
	  -S, --self-sign-provision     Self-sign mobile provisioning (EXPERIMENTAL)
	  -u, --unfair                  Resign encrypted applications
	  -v, --verify-twice            Verify after signing every file and at the end
	  -V, --dont-verify             Avoid verification step of codesigning
	  -w, --without-watchapp        Remove the WatchApp from the IPA before resigning
	      --version                 Show applesign version
	  [input-ipafile]               Path to the IPA file to resign

	Example:

	  ipa-resign.js -L # enumerate codesign identities, grab one and use it with -i
	  ipa-resign.js -i AD71EB42BC289A2B9FD3C2D5C9F02D923495A23C test-app.ipa

List local codesign identities:

	$ bin/ipa-resign -I

Resign an IPA with a specific identity:

	$ bin/ipa-resign -i 1C4D1A442A623A91E6656F74D170A711CB1D257A foo.ipa

Change bundleid:

	$ bin/ipa-resign -b org.nowsecure.testapp path/to/ipa

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

const s = as.signIPA('/path/to/app.ipa', onEnd)
  .on('warning', (msg) => {
    console.log('WARNING', msg);
  })
  .on('message', (msg) => {
    console.log('msg', msg);
  });

function onEnd(err, data) => {
  if (err) {
    console.error(err);
    s.cleanup();
    process.exit(1);
  } else {
    console.log('ios-deploy -b', as.config.outfile);
    process.exit(0);
  }
}

```

To list the developer identities available in the system:

```js
as.getIdentities((err, ids) => {
  if (err) {
    console.error(err, ids);
  } else {
    ids.forEach((id) => {
      console.log(id.hash, id.name);
    });
  }
});
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
