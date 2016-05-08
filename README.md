node-applesign
===============

NodeJS module and commandline utility for re-signing iOS applications (IPA files).

Author
------

Sergi Alvarez aka pancake @ nowsecure.com

Dependencies
------------

* zip      - re-create IPA
* unzip    - decompress IPA
* codesign - sign and verify binary with new entitlements and identity
* security - get entitlements from mobileprovision

Usage
-----

	$ bin/ipa-resign.js
	Usage: codesign [--output new.ipa] [--identities] [--identity id]
		[--mobileprovision file] [--bundleid id] [--replace] [input-ipafile]

List local codesign identities:

	$ bin/ipa-resign --identities

Resign an IPA with a specific identity:

	$ bin/ipa-resign --identity 1C4D1A442A623A91E6656F74D170A711CB1D257A foo.ipa

Change bundleid:

	$ bin/ipa-resign --bundleid org.nowsecure.testapp path/to/ipa

List mobile provisioning profiles:

	$ ls ~/Library/MobileDevice/Provisioning\ Profiles
	$ security cms -D -i embedded.mobileprovision   # Display its contents

Install mobileprovisioning in device:

	$ ideviceprovision install /path/to.mobileprovision

Define output IPA filename and install in device:

	$ bin/ipa-resign.js --output test.ipa
	$ ios-deploy -b test.ipa

Provisionings
-------------

In device:

	ideviceprovision list
	ideviceprovision install /path/to/provision

In System

	ls ~/Library/MobileDevice/Provisioning\ Profiles
	security find-identity -v -p codesigning

Show provisioning profile contents:

	security cms -D -i embedded.mobileprovision

API usage
---------

Here's a simple program that resigns an IPA:

```js
const Applesign = require('node-applesign');
const as = new Applesign({
  identity: '81A24300FE2A8EAA99A9601FDA3EA811CD80526A',
  mobileprovision: '/path/to/dev.mobileprovision'
});
const s = as.signIPA('/path/to/app.ipa', (err, data) => {
  if (err) {
    console.error(data);
  }
  console.log('ios-deploy -b', as.config.outfile);
}).on('error', (msg) => {
  console.log('ERROR', msg);
}).on('message', (msg) => {
  console.log('msg', msg);
}).on('done', (err) => {
  console.log('process done');
  process.exit(0);
});;
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
  mobileprovision: '/path/to/mobileprovision file'
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
