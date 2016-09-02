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

	  -b, --bundleid [BUNDLEID]     Change the bundleid when repackaging
	  -c, --clone-entitlements      Clone the entitlements from the provisioning to the bin
	  -e, --entitlements [ENTITL]   Specify entitlements file (EXPERIMENTAL)
	  -E, --entry-entitlement       Use generic entitlement (EXPERIMENTAL)
	  -f, --force-family            Force UIDeviceFamily in Info.plist to be iPhone
	  -i, --identity [1C4D1A..]     Specify hash-id of the identity to use
	  -k, --keychain [KEYCHAIN]     Specify alternative keychain file
	  -L, --identities              List local codesign identities
	  -m, --mobileprovision [FILE]  Specify the mobileprovision file to use
	  -o, --output [APP.IPA]        Path to the output IPA filename
	  -p, --parallel                Run layered signing dependencies in parallel
	  -r, --replace                 Replace the input IPA file with the resigned one
	  -s, --single                  Sign a single file instead of an IPA
	  -S, --self-sign-provision     Self-sign mobile provisioning (EXPERIMENTAL)
	  -u, --unfair                  Resign encrypted applications
	  -v, --verify-twice            Verify after signing every file and at the end
	  -w, --without-watchapp        Remove the WatchApp from the IPA before resigning
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
