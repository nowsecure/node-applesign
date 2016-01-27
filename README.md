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

	codesign -v appPath

* security - get entitlements from mobileprovision

	security cms -D -i provisionPath

Future
------
* Use zip.js instead of system `zip` and `unzip` executables
* Reimplement the Apple code signing thing in pure Javascript
* Support xcarchives
* Use event model instead of callbacks
	Codesign.signIPA('ipafile').on('error', error_handle).on('ready', finished).start()
* Run that thing in the browser
* Profit


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


Further reading
---------------
http://dev.mlsdigital.net/posts/how-to-resign-an-ios-app-from-external-developers/
