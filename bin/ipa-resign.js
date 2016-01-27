#!/usr/bin/env node
'use strict';

const Codesign = require('../');
const conf = require('minimist')(process.argv.slice(2));

var options = {
	file: conf._[0] || undefined,
	outfile: conf.output,
	entitlement: conf.entitlement,
	bundleid: conf.bundleid,
	certificate: conf.certificate,
	identity: conf.identity,
	mobileprovision: conf.mobileprovision
}

const cs = new Codesign(options);

if (conf.identities) {
	cs.getIdentities((err, ids) => {
		if (err) {
			cs.logError (err, ids);
		} else {
			ids.forEach((id) => {
				console.log(id.hash, id.name);
			});
		}
	});
} else if (conf.help || conf._.length === 0) {
	console.error(
`Usage: codesign [--output new.ipa] [--identities] [--identity id]
                [--mobileprovision file] [--bundleid id]
                [input-ipafile]

List local codesign identities:

  codesign --identities

Resign an IPA with a specific identity:

  codesign --identity 1C4D1A442A623A91E6656F74D170A711CB1D257A foo.ipa

Change bundleid:

  codesign --bundleid org.nowsecure.testapp path/to/ipa

List mobile provisioning profiles:

  ls ~/Library/MobileDevice/Provisioning\\ Profiles
  security cms -D -i embedded.mobileprovision   # Display its contents

Install mobileprovisioning in device:

  ideviceprovision install /path/to.mobileprovision

Define output IPA filename and install in device:

  codesign --output test.ipa
  ios-deploy -b test.ipa
`);
} else {
	cs.signIPA((err, data) => {
		if (err) {
			cs.logError(data);
			process.exit (1);
		}
		console.log("IPA is now signed.");
	});
}
