import fs from "node:fs";
import path from "node:path";
import plist from "./plist.js";
import { ConfigOptions } from "./config";
import { assertNotSymlink } from "./tools.js";

interface AppleDevices {
  iPhone: string[];
  iPad: string[];
  AppleTV: string[];
  AppleWatch: string[];
}
const appleDeviceNames = ["iPhone", "iPad", "AppleTV", "AppleWatch"];
/**
 * Creates an object with keys from the input array, each mapping to an empty array.
 */
function createEmptyArraysObject(keys: string[]): Record<string, any[]> {
  return Object.fromEntries(keys.map((key) => [key, []]));
}

export default function fix(
  file: string,
  options: ConfigOptions,
  emit: any,
): void {
  if (!options.appdir) {
    throw new Error("Invalid parameters for fixPlist");
  }
  let changed = false;
  assertNotSymlink(file);
  const data = plist.readFileSync(file);
  delete data[""];
  if (options.allowHttp) {
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
  if (options.forceFamily) {
    if (performForceFamily(data, emit)) {
      changed = true;
    }
  }
  if (options.bundleid) {
    renameAppExtensions(file, data.CFBundleIdentifier, options.bundleid, emit);
    setBundleId(data, options.bundleid);
    changed = true;
  }
  if (changed) {
    plist.writeFileSync(file, data);
  }
}

/** keep the appex ids prefixed by the new main bundle id, iOS requires it */
function renameAppExtensions(
  file: string,
  oldId: any,
  newId: string,
  emit: any,
) {
  const plugins = path.join(path.dirname(file), "PlugIns");
  assertNotSymlink(plugins);
  const appexs = fs.existsSync(plugins) ? fs.readdirSync(plugins) : [];
  for (const appex of appexs.filter((name) => name.endsWith(".appex"))) {
    const infoPath = path.join(plugins, appex, "Info.plist");
    if (fs.lstatSync(path.dirname(infoPath)).isSymbolicLink()) {
      continue; // never write outside the bundle
    }
    assertNotSymlink(infoPath);
    const info = fs.existsSync(infoPath) ? plist.readFileSync(infoPath) : {};
    const id = info.CFBundleIdentifier;
    if (typeof id === "string") {
      info.CFBundleIdentifier = oldId && id.startsWith(oldId + ".")
        ? newId + id.slice(oldId.length)
        : newId + "." + id.split(".").pop();
      emit(
        "message",
        `Renaming ${appex} bundle id to ${info.CFBundleIdentifier}`,
      );
      plist.writeFileSync(infoPath, info);
    }
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
  const have = createEmptyArraysObject(appleDeviceNames);
  const sd = data.UISupportedDevices;
  if (Array.isArray(sd)) {
    sd.forEach((model) => {
      for (const type of appleDeviceNames) {
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
      const families = ["Any", ...appleDeviceNames];
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
