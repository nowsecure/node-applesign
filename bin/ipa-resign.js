#!/usr/bin/env node
'use strict';

const colors = require('colors');
const Applesign = require('../');
const conf = require('minimist')(process.argv.slice(2), {
  boolean: ['r', 'replace', 'L', 'identities', 'v', 'verifyTwice', 'f', 'without-fairplay', 'p', 'parallel', 'w', 'without-watchapp', 'u', 'unfair', 'f', 'force-family']
});

const options = {
  file: conf._[0] || 'undefined',
  outfile: conf.output || conf.o,
  entitlement: conf.entitlement || conf.e,
  bundleid: conf.bundleid || conf.b,
  identity: conf.identity || conf.i,
  mobileprovision: conf.mobileprovision || conf.m,
  replaceipa: conf.replace || conf.r,
  withoutWatchapp: !!conf['without-watchapp'] || !!conf.w,
  keychain: conf.keychain || conf.k,
  parallel: conf.parallel || conf.p,
  verifyTwice: conf.verifyTwice || !!conf.v,
  unfairPlay: conf['unfair'] || conf.u
  forceFamily: conf['force-family'] || conf.f
};

colors.setTheme({
  error: 'red',
  warn: 'green',
  msg: 'yellow'
});

const cs = new Applesign(options);

if (conf.identities || conf.L) {
  cs.getIdentities((err, ids) => {
    if (err) {
      console.error(colors.error(err));
    } else {
      ids.forEach((id) => {
        console.log(id.hash, id.name);
      });
    }
  });
} else if (conf.h || conf.help || conf._.length === 0) {
  const cmd = process.argv[1].split('/').pop();
  console.error(
`Usage:

  ${cmd} [--options ...] [input-ipafile]

  -b, --bundleid [BUNDLEID]     Change the bundleid when repackaging
  -e, --entitlements [ENTITL]   Specify entitlements file (EXPERIMENTAL)
  -f, --force-family            Force UIDeviceFamily in Info.plist to be iPhone
  -i, --identity [1C4D1A..]     Specify hash-id of the identity to use
  -k, --keychain [KEYCHAIN]     Specify alternative keychain file
  -L, --identities              List local codesign identities
  -m, --mobileprovision [FILE]  Specify the mobileprovision file to use
  -o, --output [APP.IPA]        Path to the output IPA filename
  -p, --parallel                Run layered signing dependencies in parallel
  -r, --replace                 Replace the input IPA file with the resigned one
  -u, --unfair                  Resign encrypted applications
  -v, --verify-twice            Verify after signing every file and at the end
  -w, --without-watchapp        Remove the WatchApp from the IPA before resigning
  [input-ipafile]               Path to the IPA file to resign

Example:

  ${cmd} -L # enumerate codesign identities, grab one and use it with -i
  ${cmd} -i AD71EB42BC289A2B9FD3C2D5C9F02D923495A23C test-app.ipa
`);
} else {
  cs.signIPA(options.file, (error, data) => {
    if (error) {
      console.error(error, data);
      process.exit(1);
    }
    console.log('IPA is now signed.');
  }).on('message', (msg) => {
    console.log(colors.msg(msg));
  }).on('warning', (msg) => {
    console.log(colors.error('error'), msg);
  });
}
