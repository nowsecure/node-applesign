import plist from "simple-plist";

const appleDevices = ["iPhone", "iPad", "AppleTV", "AppleWatch"];
/**
 * Creates an object with keys from the input array, each mapping to an empty array.
 */
const objectFromEntries = (keys: string[]): Record<string, any[]> => {
  const result: Record<string, any[]> = {};
  keys.forEach((k) => {
    result[k] = [];
  });
  return result;
};

export default function fix(file: any, options: any, emit: any): void {
  const { appdir, bundleid, forceFamily, allowHttp } = options;
  if (!file || !appdir) {
    throw new Error("Invalid parameters for fixPlist");
  }
  let changed = false;
  const data = plist.readFileSync(file);
  delete data[""];
  if (allowHttp) {
    emit("message", "Adding NSAllowArbitraryLoads");
    if (
      !data.NSAppTransportSecurity ||
      data.NSAppTransportSecurity.constructor !== Object
    ) {
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

function setBundleId(data: any, bundleid: any) {
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

function performForceFamily(data: any, emit: Function | undefined) {
  if (emit === undefined) {
    emit = console.error;
  }
  const have = supportedDevices(data);
  const df = [];
  if (have.iPhone && have.iPhone.length > 0) {
    df.push(1);
  }
  if (have.iPad && have.iPad.length > 0) {
    df.push(2);
  }
  let changes = false;
  if (data.UISupportedDevices) {
    delete data.UISupportedDevices;
    changes = true;
  }
  if (
    (have.AppleWatch && have.AppleWatch.length > 0) ||
    (have.AppleTV && have.AppleTV.length > 0)
  ) {
    emit("message", "Apple{TV/Watch} apps do not require to be re-familied");
    return changes;
  }
  if (df.length === 0) {
    emit("message", "UIDeviceFamily forced to iPhone/iPod");
    df.push(1);
  }
  if (df.length === 2) {
    emit("message", "No UIDeviceFamily changes required");
    return changes;
  }
  emit("message", "UIDeviceFamily set to " + JSON.stringify(df));
  data.UIDeviceFamily = df;
  return true;
}

function supportedDevices(data: any) {
  const have = objectFromEntries(appleDevices);
  const sd = data.UISupportedDevices;
  if (Array.isArray(sd)) {
    sd.forEach((model) => {
      for (const type of appleDevices) {
        if (model.indexOf(type) !== -1) {
          if (!have[type]) {
            have[type] = [];
          }
          have[type].push(model);
          break;
        }
      }
    });
  } else if (sd !== undefined) {
    console.error("Warning: Invalid UISupportedDevices in Info.plist?");
  }
  const df = data.UIDeviceFamily;
  if (Array.isArray(df)) {
    df.forEach((family) => {
      const families = ["Any", ...appleDevices];
      const fam = families[family];
      if (fam) {
        if (have[fam] === undefined) {
          have[fam] = [];
        }
        have[fam].push(fam);
      }
    });
  }
  return have;
}
