import fs from "node:fs";
import { build, parse as plistParse } from "plist";

// plist.parse() treats any Uint8Array as binary, so only pass bytes for bplist
function parse(data: string | Buffer): any {
  const bplist = Buffer.isBuffer(data) &&
    data.subarray(0, 6).toString() === "bplist";
  return plistParse(bplist ? data : data.toString());
}

function readFileSync(file: string): any {
  const data = fs.readFileSync(file);
  return data.length === 0 ? {} : parse(data);
}

function writeFileSync(file: string, obj: any) {
  fs.writeFileSync(file, build(obj));
}

export default { build, parse, readFileSync, writeFileSync };
