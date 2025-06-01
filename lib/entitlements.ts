'use strict';

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'plist'.
const plist = require('simple-plist');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'plistBuild... Remove this comment to see the full error message
const plistBuild = require('plist').build;

const entitlementTemplate = `
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>application-identifier</key>
    <string>FILLME.APPID</string>
    <key>com.apple.developer.team-identifier</key>
    <string>FILLME</string>
    <key>get-task-allow</key>
    <true/>
    <key>keychain-access-groups</key>
    <array>
      <string>FILLME.APPID</string>
    </array>
  </dict>
</plist>
`;

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'defaultEnt... Remove this comment to see the full error message
function defaultEntitlements (appid: any, devid: any) {
  const ent = plist.parse(entitlementTemplate.trim());
  ent['application-identifier'] = appid;
  ent['com.apple.developer.team-identifier'] = devid;
  ent['keychain-access-groups'] = [appid];
  ent['com.apple.developer.ubiquity-kvstore-identifier'] = appid;
  delete ent['aps-environment'];
  ent['com.apple.developer.icloud-container-identifiers'] = 'iCloud.' + devid;
  return plistBuild(ent, { pretty: true, allowEmpty: false }).toString();
}

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = defaultEntitlements;
