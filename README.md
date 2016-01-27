node-codesigner
===============

CodeSigner is a NodeJS API for re-signing iOS applications. 

Author
------

Sergi Alvarez aka pancake @ nowsecure.com

Dependencies
------------

* zip      - re-create IPA
* unzip    - decompress IPA
* codesign - sign and verify binary with new entitlements and identity
* security - get entitlements from mobileprovision

Future
------

* Use zip.js instead of system `zip` and `unzip` executables
* Reimplement the Apple code signing thing in pure Javascript
* Support xcarchives
* Use event model instead of callbacks
  - `Codesign.signIPA('ipafile').on('error', error_handle).on('ready', finished).start()`
* Run that thing in the browser
* Profit

Usage
-----

	$ bin/ipa-resign.js
	Usage:

	  ipa-resign.js [--output new.ipa] [--identities] [--identity id] \
	    [--mobileprovision file] [--bundleid id] [input-ipafile]

	List local codesign identities:

	  ipa-resign.js --identities
	  security find-identity -v -p codesigning

	Resign an IPA with a specific identity:

	  ipa-resign.js --identity 1C4D1A.. foo.ipa

	Resign an IPA:

	  ipa-resign.js --output my-foo.ipa --identity $IOS_CERTID \
	    --mobileprovision embedded.mobileprovision \
	    --bundleid com.nowsecure.TestApp ./foo.ipa

	Change bundleid:

	  ipa-resign.js --bundleid org.nowsecure.testapp path/to/ipa

	List mobile provisioning profiles:

	  ls ~/Library/MobileDevice/Provisioning\ Profiles
	  security cms -D -i embedded.mobileprovision   # Display its contents

	Install mobileprovisioning in device:

	  ideviceprovision list
	  ideviceprovision install /path/to.mobileprovision

	Define output IPA filename and install in device:

	  ipa-resign.js --output test.ipa
	  ios-deploy -b test.ipa

Further reading
---------------
https://github.com/maciekish/iReSign
http://dev.mlsdigital.net/posts/how-to-resign-an-ios-app-from-external-developers/
