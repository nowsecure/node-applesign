import Applesign from '.';

const as = new Applesign({
  /* bin/applesign -L to list all available identities in your system */
  identity: '67CF8DCD3BA1E7241FFCFCE66FA6C0F58D17F795',
  /* clone the entitlements from the mobile provisioning */
  cloneEntitlements: false,
  mobileProvisioning: '/tmp/embedded.mobileprovision'
});

// @ts-expect-error TS(2580): Cannot find name 'process'. Do you need to install... Remove this comment to see the full error message
if (process.argv.length < 3) {
  console.error('Usage: example.js [path/to/ipa]');
  // @ts-expect-error TS(2580): Cannot find name 'process'. Do you need to install... Remove this comment to see the full error message
  process.exit(1);
}

as.events.on('message', (msg: any) => {
  console.log('message', msg);
}).on('warning', (msg: any) => {
  console.error('warning', msg);
});
// @ts-expect-error TS(2580): Cannot find name 'process'. Do you need to install... Remove this comment to see the full error message
as.signIPA(process.argv[2]).then(_ => {
  console.log('ios-deploy -b', as.config.outfile);
});
