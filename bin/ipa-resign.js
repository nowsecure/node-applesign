#!/usr/bin/env node
'use strict';

const colors = require('colors');
const Applesign = require('../');
const conf = require('minimist')(process.argv.slice(2), {
  boolean: ['replace', 'identities']
});

function getBool(c, b) {
  if (c !== undefined) {
    return c;
  }
  return b;
}

const options = {
  file: conf._[0] || 'undefined',
  outfile: conf.output || conf.o,
  entitlement: conf.entitlement || conf.e,
  bundleid: conf.bundleid || conf.b,
  identity: conf.identity || conf.i,
  mobileprovision: conf.mobileprovision || conf.m,
  replaceipa: conf.replace || conf.r,
  withoutWatchapp: !!conf['without-watchapp'] || !!conf.w,
  graphSortedBins: conf.d || conf.dependencies,
  keychain: conf.keychain || conf.k,
  verifyOnce: !(conf.verifyOnce || conf.v)
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

  -L, --identities              List local codesign identities
  -i, --identity 1C4D1A..       Specify hash-id of the identity to use
  -r, --replace                 Replace the input IPA file with the resigned one
  -d, --dependencies            Sign binaries in the correct dependency order
  -e, --entitlements [ENTITL]   Specify entitlements file (EXPERIMENTAL)
  -w, --without-watchapp        Remove the WatchApp from the IPA before resigning
  -k, --keychain [KEYCHAIN]     Specify alternative keychain file
  -o, --output [APP.IPA]        Path to the output IPA filename
  -b, --bundleid [BUNDLEID]     Change the bundleid when repackaging
  -m, --mobileprovision [FILE]  Specify the mobileprovision file to use
  -v, --verify-once             Do not verify twice
  [input-ipafile]               Path to the IPA file to resign

Example:

  ${cmd} --replace -identity AD71EB42BC289A2B9FD3C2D5C9F02D923495A23C \\
    --mobileprovision embedded.mobileprovision --bundleid com.nowsecure.TestApp ./foo.ipa
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
