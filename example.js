const Applesign = require('./');

const as = new Applesign({
  identity: 'A5A2C300FE2A8EAC99A9601FDAAEA811CC80586F'
});

const s = as.signIPA('/tmp/ada.ipa', (error) => {
  if (error) {
    console.log('error', error);
    process.exit(1);
  } else {
    s.cleanup();
    console.log('ios-deploy -b', s.config.outfile);
  }
}).on('message', (msg) => {
  console.log("message", msg);
}).on('error', (msg) => {
  console.error('error', msg);
});
