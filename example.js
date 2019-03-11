'use strict';

const Applesign = require('.');

const as = new Applesign({
  /* bin/applesign -L to list all available identities in your system */
  identity: '67CF8DCD3BA1E7241FFCFCE66FA6C0F58D17F795',
  /* clone the entitlements from the mobile provisioning */
  cloneEntitlements: false,
  mobileProvisioning: '/tmp/embedded.mobileprovision'
});

if (process.argv.length < 3) {
  console.error('Usage: example.js [path/to/ipa]');
  process.exit(1);
}

as.events.on('message', (msg) => {
  console.log('message', msg);
}).on('warning', (msg) => {
  console.error('warning', msg);
});
as.signIPA(process.argv[2]).then(_ => {
  console.log('ios-deploy -b', as.config.outfile);
});
