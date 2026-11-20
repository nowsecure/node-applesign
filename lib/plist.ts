import fs from "node:fs";
import { build, parse as plistParse } from "plist";

// plist 5.1.2 reads the high half of 16 byte ints, copy the low one there
// TODO: remove once TooTallNate/plist.js#192 is released
function fixInt128(data: Buffer): Buffer {
  const buf = Buffer.from(data);
  try {
    const t = buf.length - 32;
    const size = buf[t + 6];
    const count = Number(buf.readBigUInt64BE(t + 8));
    const table = Number(buf.readBigUInt64BE(t + 24));
    for (let i = 0; i < count; i++) {
      const o = buf.readUIntBE(table + i * size, size);
      if (buf[o] === 0x14) buf.copy(buf, o + 1, o + 9, o + 17);
    }
  } catch {
    // malformed trailer, let plist report it
  }
  return buf;
}

// plist.parse() treats any Uint8Array as binary, so only pass bytes for bplist
function parse(data: string | Buffer): any {
  const bplist = Buffer.isBuffer(data) &&
    data.subarray(0, 6).toString() === "bplist";
  return plistParse(bplist ? fixInt128(data) : data.toString());
}

function readFileSync(file: string): any {
  const data = fs.readFileSync(file);
  return data.length === 0 ? {} : parse(data);
}

function writeFileSync(file: string, obj: any) {
  fs.writeFileSync(file, build(obj));
}

export default { build, parse, readFileSync, writeFileSync };
