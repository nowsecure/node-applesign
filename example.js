const Applesign = require('./');

const as = new Applesign({
  identity: 'A5A2C300FE2A8EAC99A9601FDAAEA811CC80586F'
});

const s = as.signIPA('/tmp/ada.ipa', onEnd)
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

