const Applesign = require('./');

const as = new Applesign({
  /* bin/applesign -L to list all available identities in your system */
  identity: 'A5A2C300FE2A8EAC99A9601FDAAEA811CC80586F',
  /* clone the entitlements from the mobile provisioning */
  cloneEntitlements: false,
  mobileProvisioning: '/tmp/embedded.mobileprovision'
});

if (process.argv.length < 3) {
  console.error('Usage: example.js [path/to/ipa]');
  process.exit(1);
}

const s = as.signIPA(process.argv[2], onEnd)
  .on('message', (msg) => {
    console.log('message', msg);
  })
  .on('warning', (msg) => {
    console.error('warning', msg);
  });

function onEnd (error) {
  if (error) {
    console.log('error', error);
    process.exit(1);
  } else {
    console.log('ios-deploy -b', s.config.outfile);
  }
}

