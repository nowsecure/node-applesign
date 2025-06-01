#!/usr/bin/env node
'use strict';

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'fs'.
const fs = require('fs');
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
// Point to root package.json in distribution
const packageJson = require('../../package.json');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'tools'.
const tools = require('../lib/tools');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'config'.
const config = require('../lib/config');
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const colors = require('colors');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'Applesign'... Remove this comment to see the full error message
const Applesign = require('../');

colors.setTheme({
  error: 'red',
  msg: 'yellow',
  warning: 'green'
});

async function main (argv: any) {
  const conf = config.parse(argv);
  const options = config.compile(conf);
  const as = new Applesign(options);
  // initialize
  if (conf.identities || conf.L) {
    const ids = await as.getIdentities();
    ids.forEach((id: any) => {
      console.log(id.hash, id.name);
    });
  } else if (conf.version) {
    console.log(packageJson.version);
  } else if (conf.h || conf.help) {
    console.error(config.helpMessage);
  } else if (conf._.length === 0) {
    console.error(config.shortHelpMessage);
  } else {
    const target = getTargetMethod(options.file, (conf.s || conf.single));
    if (target === undefined) {
      throw new Error('Cannot open file');
    }
    as.events.on('message', (msg: any) => {
      console.log(colors.msg(msg));
    }).on('warning', (msg: any) => {
      console.error(colors.warning('warning'), msg);
    }).on('error', (msg: any) => {
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
      // @ts-expect-error TS(2580): Cannot find name 'process'. Do you need to install... Remove this comment to see the full error message
      process.exitCode = 1;
      console.error(e);
    } finally {
      if (!options.noclean) {
        await as.cleanupTmp();
        await as.cleanup();
      }
    }
    if (as.config.debug !== '') {
      const data = JSON.stringify(as.debugObject);
      fs.writeFileSync(as.config.debug, data);
      console.error('Debug: json file saved: ' + as.config.debug);
    }
  }
}

// @ts-expect-error TS(2580): Cannot find name 'process'. Do you need to install... Remove this comment to see the full error message
main(process.argv).then(_ => {}).catch(console.error);

function getTargetMethod (file: any, single: any) {
  try {
    if (tools.isDirectory(file)) {
      return 'signAppDirectory';
    }
    return (single) ? 'signFile' : 'signIPA';
  } catch (e) {
    return undefined;
  }
}
