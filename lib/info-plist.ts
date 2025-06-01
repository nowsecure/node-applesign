'use strict';

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'plist'.
const plist = require('simple-plist');

const appleDevices = ['iPhone', 'iPad', 'AppleTV', 'AppleWatch'];
// @ts-expect-error TS(2464): A computed property name must be of type 'string',... Remove this comment to see the full error message
const objectFromEntries = (x: any) => Array.from(x, (k) => ({ [k]: [] })); // ES7 is not yet here

function fix (file: any, options: any, emit: any) {
  const { appdir, bundleid, forceFamily, allowHttp } = options;
  if (!file || !appdir) {
    throw new Error('Invalid parameters for fixPlist');
  }
  let changed = false;
  const data = plist.readFileSync(file);
  delete data[''];
  if (allowHttp) {
    emit('message', 'Adding NSAllowArbitraryLoads');
    if (!data.NSAppTransportSecurity || (data.NSAppTransportSecurity.constructor !== Object)) {
      data.NSAppTransportSecurity = {};
    }
    data.NSAppTransportSecurity.NSAllowsArbitraryLoads = true;
    changed = true;
  }
  if (forceFamily) {
    if (performForceFamily(data, emit)) {
      changed = true;
    }
  }
  if (bundleid) {
    setBundleId(data, bundleid);
    changed = true;
  }
  if (changed) {
    plist.writeFileSync(file, data);
  }
}

function setBundleId (data: any, bundleid: any) {
  const oldBundleId = data.CFBundleIdentifier;
  if (oldBundleId) {
    data.CFBundleIdentifier = bundleid;
  }
  if (data.basebundleidentifier) {
    data.basebundleidentifier = bundleid;
  }
  try {
    data.CFBundleURLTypes[0].CFBundleURLName = bundleid;
  } catch (e) {
    /* do nothing */
  }
}

function performForceFamily (data: any, emit: any) {
  if (!emit) emit = console.error;
  const have = supportedDevices(data);
  const df = [];
  // @ts-expect-error TS(2339): Property 'iPhone' does not exist on type '{}[]'.
  if (have.iPhone && have.iPhone.length > 0) {
    df.push(1);
  }
  // @ts-expect-error TS(2339): Property 'iPad' does not exist on type '{}[]'.
  if (have.iPad && have.iPad.length > 0) {
    df.push(2);
  }
  let changes = false;
  if (data.UISupportedDevices) {
    delete data.UISupportedDevices;
    changes = true;
  }
  // @ts-expect-error TS(2339): Property 'AppleWatch' does not exist on type '{}[]... Remove this comment to see the full error message
  if ((have.AppleWatch && have.AppleWatch.length > 0) || (have.AppleTV && have.AppleTV.length > 0)) {
    emit('message', 'Apple{TV/Watch} apps do not require to be re-familied');
    return changes;
  }
  if (df.length === 0) {
    emit('message', 'UIDeviceFamily forced to iPhone/iPod');
    df.push(1);
  }
  if (df.length === 2) {
    emit('message', 'No UIDeviceFamily changes required');
    return changes;
  }
  emit('message', 'UIDeviceFamily set to ' + JSON.stringify(df));
  data.UIDeviceFamily = df;
  return true;
}

function supportedDevices (data: any) {
  const have = objectFromEntries(appleDevices);
  const sd = data.UISupportedDevices;
  if (Array.isArray(sd)) {
    sd.forEach(model => {
      for (const type of appleDevices) {
        if (model.indexOf(type) !== -1) {
          // @ts-expect-error TS(7015): Element implicitly has an 'any' type because index... Remove this comment to see the full error message
          if (!have[type]) {
            // @ts-expect-error TS(7015): Element implicitly has an 'any' type because index... Remove this comment to see the full error message
            have[type] = [];
          }
          // @ts-expect-error TS(7015): Element implicitly has an 'any' type because index... Remove this comment to see the full error message
          have[type].push(model);
          break;
        }
      }
    });
  } else if (sd !== undefined) {
    console.error('Warning: Invalid UISupportedDevices in Info.plist?');
  }
  const df = data.UIDeviceFamily;
  if (Array.isArray(df)) {
    df.forEach(family => {
      const families = ['Any', ...appleDevices];
      const fam = families[family];
      if (fam) {
        // @ts-expect-error TS(7015): Element implicitly has an 'any' type because index... Remove this comment to see the full error message
        if (have[fam] === undefined) {
          // @ts-expect-error TS(7015): Element implicitly has an 'any' type because index... Remove this comment to see the full error message
          have[fam] = [];
        }
        // @ts-expect-error TS(7015): Element implicitly has an 'any' type because index... Remove this comment to see the full error message
        have[fam].push(fam);
      }
    });
  }
  return have;
}

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = fix;
