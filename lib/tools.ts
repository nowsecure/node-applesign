import fs from "node:fs";
import { promisify } from "node:util";
import { execSync, spawn } from "node:child_process";
const unlinkAsync = promisify(fs.unlink);
const renameAsync = promisify(fs.rename);
import plist from "simple-plist";
import path from "node:path";
import which from "which";
import rimraf from "rimraf";
import * as bin from "./bin.js";
// import { ConfigOptions } from "../dist/lib/config.js";
import { ConfigOptions } from "./config.js";

// TODO: remove globals
let use7zip = false;
let useOpenSSL = false;

const cmdSpec = {
  "7z": "/usr/local/bin/7z",
  codesign: "/usr/bin/codesign",
  insert_dylib: "insert_dylib",
  lipo: "/usr/bin/lipo",
  /* only when useOpenSSL is true */
  openssl: "/usr/local/bin/openssl",
  security: "/usr/bin/security",
  unzip: "/usr/bin/unzip",
  xcodebuild: "/usr/bin/xcodebuild",
  ideviceprovision: "/usr/local/bin/ideviceprovision",
  zip: "/usr/bin/zip",
  ldid2: "ldid2",
};

const cmd: Record<string, string> = {};
let cmdInited = false;

/**
 * Result of executing a child process.
 */
interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}
/**
 * Execute a program and capture stdout, stderr, and exit code.
 * @param cmdPath Path to executable
 * @param args Array of string arguments
 * @param options Spawn options
 * @returns Promise resolving to execution result
 */
/**
 * Options for spawning child processes used by execProgram.
 */
type ExecOptions = {
  cwd?: string;
  env?: { [key: string]: string | undefined };
  stdio?: any;
};
/**
 * Execute a program and capture stdout, stderr, and exit code.
 * @param cmdPath Path to executable
 * @param args Arguments array
 * @param options Spawn options
 * @returns Execution result
 */
async function execProgram(
  cmdPath: string,
  args: string[],
  options?: ExecOptions,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let _out = Buffer.alloc(0);
    let _err = Buffer.alloc(0);
    const child = spawn(cmdPath, args, options || {});
    child.stdout.on("data", (data: Buffer) => {
      _out = Buffer.concat([_out, data]);
    });
    child.stderr.on("data", (data: Buffer) => {
      _err = Buffer.concat([_err, data]);
    });
    child.stdin.end();
    child.on("close", (code: number) => {
      if (code !== 0) {
        let msg = `stdout: ${_out.toString("utf8")}`;
        msg += `\nstderr: ${_err.toString("utf8")}`;
        msg += `\ncommand: ${cmdPath} ${args.join(" ")}`;
        msg += `\ncode: ${code}`;
        return reject(new Error(msg));
      }
      resolve({
        stdout: _out.toString(),
        stderr: _err.toString(),
        code,
      });
    });
  });
}

/* public */
function findInPath() {
  if (cmdInited) {
    return;
  }
  cmdInited = true;
  const keys = Object.keys(cmdSpec);
  for (const key of keys) {
    try {
      cmd[key] = which.sync(key);
    } catch {
      // ignore missing tools
    }
  }
}

/**
 * Get the path to a tool executable, or throw if not found.
 * @param tool Name of the tool
 */
function getTool(tool: string): string {
  findInPath();
  if (!(tool in cmd)) {
    throw new Error(`tools.findInPath: not found: ${tool}`);
  }
  return cmd[tool];
}

async function ideviceprovision(action: any, optarg?: any) {
  if (action === "list") {
    const res = await execProgram(getTool("ideviceprovision")!, ["list"]);
    return res.stdout
      .split("\n")
      .filter((line: any) => line.indexOf("-") !== -1)
      .map((line: any) => line.split(" ")[0]);
  } else {
    throw new Error("unsupported ideviceprovision action");
  }
}

async function codesign(
  identity: string,
  entitlement: string | undefined,
  keychain: string | undefined,
  file: string,
) {
  if (identity === undefined) {
    // XXX: typescript can ensure this at compile time
    throw new Error("--identity is required to sign");
  }
  /* use the --no-strict to avoid the "resource envelope is obsolete" error */
  const args = ["--no-strict"]; // http://stackoverflow.com/a/26204757
  args.push("-fs", identity);
  // args.push('-v');
  // args.push('--deep');
  if (typeof entitlement === "string") {
    args.push("--entitlements=" + entitlement);
  }
  if (typeof keychain === "string") {
    args.push("--keychain=" + keychain);
  }
  args.push("--generate-entitlement-der");
  args.push(file);
  return execProgram(getTool("codesign")!, args);
}

async function pseudoSign(entitlement: any, file: string): Promise<ExecResult> {
  const args = [];
  if (typeof entitlement === "string") {
    args.push("-S" + entitlement);
  } else {
    args.push("-S");
  }
  const identifier = bin.getIdentifier(file);
  if (identifier !== null && identifier !== "") {
    args.push("-I" + identifier);
  }
  args.push(file);
  return execProgram(getTool("ldid2")!, args);
}

async function verifyCodesign(
  file: string,
  keychain?: string,
): Promise<ExecResult> {
  const args = ["-v", "--no-strict"];
  if (typeof keychain === "string") {
    args.push("--keychain=" + keychain);
  }
  args.push(file);
  return execProgram(getTool("codesign")!, args);
}

async function getMobileProvisionPlist(file: string) {
  let res;
  if (file === undefined) {
    throw new Error("No mobile provisioning file available.");
  }
  if (useOpenSSL === true) {
    /* portable using openssl */
    const args = ["cms", "-in", file, "-inform", "der", "-verify"];
    res = await execProgram(getTool("openssl")!, args);
  } else {
    /* OSX specific using security */
    const args = ["cms", "-D", "-i", file];
    res = await execProgram(getTool("security")!, args);
  }
  return plist.parse(res.stdout);
}

async function getEntitlementsFromMobileProvision(
  file: string,
  cb?: any,
): Promise<any> {
  const res = await getMobileProvisionPlist(file);
  return res.Entitlements;
}

async function zip(cwd: string, ofile: string, src: string) {
  try {
    await unlinkAsync(ofile);
  } catch (ignored) {}
  const ofilePath = path.dirname(ofile);
  fs.mkdirSync(ofilePath, { recursive: true });
  if (use7zip) {
    const zipFile = ofile + ".zip";
    const args = ["a", zipFile, src];
    await execProgram(getTool("7z")!, args, { cwd });
    await renameAsync(zipFile, ofile);
  } else {
    const args = ["-qry", ofile, src];
    await execProgram(getTool("zip")!, args, { cwd });
  }
}

async function unzip(ifile: string, odir: string) {
  if (use7zip) {
    const args = ["x", "-y", "-o" + odir, ifile];
    return execProgram(getTool("7z")!, args);
  }
  if (process.env.UNZIP !== undefined) {
    cmd.unzip = process.env.UNZIP;
    delete process.env.UNZIP;
  }
  const args = ["-o", ifile, "-d", odir];
  return execProgram(getTool("unzip")!, args);
}

async function xcaToIpa(ifile: string, odir: string) {
  const args = [
    "-exportArchive",
    "-exportFormat",
    "ipa",
    "-archivePath",
    ifile,
    "-exportPath",
    odir,
  ];
  return execProgram(getTool("xcodebuild")!, args);
}

// XXX: the out parameter is never used. therfor the caller doesnt works well
async function insertLibrary(lib: string, bin: string, out: string) {
  let error = null;
  try {
    const machoMangle = require("macho-mangle");
    try {
      let src = fs.readFileSync(bin);
      if (lib.indexOf("@rpath") === 0) {
        src = machoMangle(src, {
          type: "rpath",
          name: "@executable_path/Frameworks",
        });
      }
      const dst = machoMangle(src, {
        type: "load_dylib",
        name: lib,
        version: {
          current: "1.0.0",
          compat: "0.0.0",
        },
      });
      fs.writeFileSync(bin, dst);
      console.log("Library inserted");
    } catch (e) {
      error = e;
    }
  } catch (e) {
    if (getTool("insert_dylib") !== null) {
      const args = ["--strip-codesig", "--all-yes", lib, bin, bin];
      const res = await execProgram(getTool("insert_dylib")!, args);
      console.error(JSON.stringify(res));
    } else {
      error = new Error("Cannot find insert_dylib or macho-mangle");
    }
  }
  if (error) {
    throw error;
  }
}

export interface Identity {
  hash: string;
  name: string;
}

function getIdentitiesFromString(stdout: any): Identity[] {
  const lines = stdout.split("\n");
  lines.pop(); // remove last line
  const ids: Identity[] = [];
  lines
    .filter((entry: string) => {
      return entry.indexOf("CSSMERR_TP_CERT_REVOKED") === -1;
    })
    .forEach((line: string) => {
      const tok = line.indexOf(") ");
      if (tok !== -1) {
        const msg = line.substring(tok + 2).trim();
        const tok2 = msg.indexOf(" ");
        if (tok2 !== -1) {
          ids.push({
            hash: msg.substring(0, tok2),
            name: msg
              .substring(tok2 + 1)
              .replace(/^"/, "")
              .replace(/"$/, ""),
          });
        }
      }
    });
  return ids;
}

function getIdentitiesSync(): Identity[] {
  const command = [
    getTool("security"),
    "find-identity",
    "-v",
    "-p",
    "codesigning",
  ];
  return getIdentitiesFromString(execSync(command.join(" ")).toString());
}

async function getIdentities(): Promise<Identity[]> {
  const args = ["find-identity", "-v", "-p", "codesigning"];
  const res = await execProgram(getTool("security")!, args);
  return getIdentitiesFromString(res.stdout);
}

async function lipoFile(file: string, arch: string): Promise<ExecResult> {
  const args = [file, "-thin", arch, "-output", file];
  return execProgram(getTool("lipo")!, args);
}

function isDirectory(filePath: string): boolean {
  try {
    return fs.lstatSync(filePath).isDirectory();
  } catch (error) {
    return false;
  }
}

export interface GlobalOptions {
  use7zip: boolean;
  useOpenSSL: boolean;
}

function setGlobalOptions(obj: GlobalOptions): void {
  if (typeof obj.use7zip === "boolean") {
    use7zip = obj.use7zip;
  }
  if (typeof obj.useOpenSSL === "boolean") {
    useOpenSSL = obj.useOpenSSL;
  }
}

function asyncRimraf(dir: any) {
  return new Promise<any>((resolve, reject) => {
    if (dir === undefined) {
      resolve(undefined);
    }
    rimraf(dir, (err: any, res: any) => {
      return err ? reject(err) : resolve(res);
    });
  });
}

export {
  asyncRimraf,
  codesign,
  getEntitlementsFromMobileProvision,
  getIdentities,
  getIdentitiesSync,
  getMobileProvisionPlist,
  ideviceprovision,
  insertLibrary,
  isDirectory,
  lipoFile,
  pseudoSign,
  setGlobalOptions as setOptions,
  unzip,
  verifyCodesign,
  xcaToIpa,
  zip,
};
