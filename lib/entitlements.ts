import plist from "simple-plist";
import plistPkg from "plist";
const { build: plistBuild } = plistPkg;

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

export default function defaultEntitlements(appid: any, devid: any): string {
  const ent = plist.parse(entitlementTemplate.trim());
  ent["application-identifier"] = appid;
  ent["com.apple.developer.team-identifier"] = devid;
  ent["keychain-access-groups"] = [appid];
  ent["com.apple.developer.ubiquity-kvstore-identifier"] = appid;
  delete ent["aps-environment"];
  ent["com.apple.developer.icloud-container-identifiers"] = "iCloud." + devid;
  return plistBuild(ent, { pretty: true, allowEmpty: false }).toString();
}
