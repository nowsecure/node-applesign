#!/usr/bin/env node
'use strict';

const fs = require('fs');
const packageJson = require('../package.json');
const tools = require('../lib/tools');
const config = require('../lib/config');
const colors = require('colors');
const Applesign = require('../');

colors.setTheme({
  error: 'red',
  msg: 'yellow',
  warning: 'green'
});

async function main (argv) {
  const conf = config.parse(argv);
  const options = config.compile(conf);
  const as = new Applesign(options);
  // initialize
  await tools.findInPath();
  if (conf.identities || conf.L) {
    const ids = await as.getIdentities();
    ids.forEach((id) => {
      console.log(id.hash, id.name);
    });
  } else if (conf.version) {
    console.log(packageJson.version);
  } else if (conf.h || conf.help) {
    console.error(config.helpMessage);
  } else if (conf._.length === 0) {
    console.error(config.shortHelpMessage);
  } else {
    if (options.insertLibrary !== undefined) {
      // if (err && err.toString().indexOf('dylib_insert') !== -1) {
      // console.error(err);
      // }
    }
    const target = getTargetMethod(options.file, (conf.s || conf.single));
    if (target === undefined) {
      throw new Error('Cannot open file');
    }
    as.events.on('message', (msg) => {
      console.log(colors.msg(msg));
    }).on('warning', (msg) => {
      console.error(colors.warning('warning'), msg);
    }).on('error', (msg) => {
      console.error(colors.msg(msg));
    });
    if (options.file === undefined) {
      throw new Error('No file provided');
    }
    try {
      await as[target](options.file);
      const outfile = (as.config.outfile || options.file);
      const message = 'Target is now signed: ' + outfile;
      console.log(message);
    } catch (e) {
      console.error(e);
    } finally {
      await as.cleanupTmp();
      await as.cleanup();
    }
    if (as.config.debug !== '') {
      const data = JSON.stringify(as.debugObject);
      fs.writeFileSync(as.config.debug, data);
      console.error('Debug: json file saved: ' + as.config.debug);
    }
  }
}

main(process.argv).then(_ => {}).catch(console.error);

function getTargetMethod (file, single) {
  try {
    if (tools.isDirectory(file)) {
      return 'signAppDirectory';
    }
    return (single) ? 'signFile' : 'signIPA';
  } catch (e) {
    return undefined;
  }
}
