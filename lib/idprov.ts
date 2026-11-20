"use strict";

import fs from "node:fs";
import { createHash } from "node:crypto";
import plist from "./plist.js";
import * as tools from "./tools.js";

// SHA-1 of the DeveloperCertificates, as listed by security find-identity
function provisionHashes(file: any): string[] {
  let data = fs.readFileSync(file).toString();
  const b = data.indexOf("<?xml");
  if (b === -1) {
    throw new Error("Cannot find the plist inside " + file);
  }
  data = data.substring(b);
  const e = data.indexOf("</plist>");
  if (e === -1) {
    throw new Error("Cannot find end of plist inside " + file);
  }
  const certs = plist.parse(data.substring(0, e + 8)).DeveloperCertificates;
  return certs.map((cert: Uint8Array) =>
    createHash("sha1").update(cert).digest("hex").toUpperCase()
  );
}

export default function findIdentityFromProvisionSync(file: any): string {
  const hashes = provisionHashes(file);
  const id = tools.getIdentitiesSync().find((id) => hashes.includes(id.hash));
  if (!id) {
    throw new Error("Cannot find an identity in " + file);
  }
  return id.hash;
}

// signing works with any identity, but iOS refuses to install the app
export function checkIdentityInProvision(file: any, identity: string) {
  const hash = identity.toUpperCase();
  // .p12 files and identity names can't be checked
  if (/^[0-9A-F]{40}$/.test(hash) && !provisionHashes(file).includes(hash)) {
    throw new Error(`The identity ${identity} is not in ${file}`);
  }
}
