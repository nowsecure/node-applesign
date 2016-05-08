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
	Usage: codesign [--output new.ipa] [--identities] [--identity id]
		[--mobileprovision file] [--bundleid id] [--replace] [input-ipafile]

List local codesign identities:

	$ bin/ipa-resign --identities

Resign an IPA with a specific identity:

	$ bin/ipa-resign --identity 1C4D1A442A623A91E6656F74D170A711CB1D257A foo.ipa

Change bundleid:

	$ bin/ipa-resign --bundleid org.nowsecure.testapp path/to/ipa

API usage
---------

Here's a simple program that resigns an IPA:

```js
const Applesign = require('applesign');

const as = new Applesign({
  identity: '81A24300FE2A8EAA99A9601FDA3EA811CD80526A',
  mobileprovision: '/path/to/dev.mobileprovision'
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
  ignoreVerificationErrors: true
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
