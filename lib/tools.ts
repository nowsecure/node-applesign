import fs from "node:fs";
import { execSync, spawn } from "node:child_process";
import plist from "./plist.js";
import path from "node:path";
import { tmpdir } from "node:os";
import which from "which";
import * as bin from "./bin.js";
import { ConfigOptions } from "./config.js";

const cmdSpec = {
  "7z": "/usr/local/bin/7z",
  codesign: "/usr/bin/codesign",
  insert_dylib: "insert_dylib",
  lipo: "/usr/bin/lipo",
  openssl: "/usr/local/bin/openssl",
  security: "/usr/bin/security",
  unzip: "/usr/bin/unzip",
  xcodebuild: "/usr/bin/xcodebuild",
  ideviceprovision: "/usr/local/bin/ideviceprovision",
  zip: "/usr/bin/zip",
  ldid: "ldid",
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
    child.on("error", reject);
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
  // prefixed, unzip and zip already read UNZIP and ZIP as default options
  const file = process.env["APPLESIGN_" + tool.toUpperCase()] || cmd[tool];
  if (!file) {
    throw new Error(`tools.findInPath: not found: ${tool}`);
  }
  return file;
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
  if (identity.endsWith(".p12")) {
    return ldidSign(entitlement, file, identity);
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

const unlockedP12s: Record<string, Promise<string>> = {};

/*
 * ldid only takes the p12 password in argv (-U), where any local user can read
 * it with ps. Re-export the p12 without password into a private tmp dir,
 * openssl reads the password from the environment. Without the env var ldid
 * prompts for it.
 */
function unlockP12(p12: string): Promise<string> {
  if (!process.env.APPLESIGN_P12_PASSWORD) {
    return Promise.resolve(p12);
  }
  return unlockedP12s[p12] ??= (async () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "applesign-p12-")); // 0700
    process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
    const pem = path.join(dir, "key.pem");
    const out = path.join(dir, "key.p12");
    const openssl = getTool("openssl");
    const read = ["pkcs12", "-in", p12, "-nodes", "-out", pem];
    read.push("-passin", "env:APPLESIGN_P12_PASSWORD");
    /* Keychain Access exports RC2 p12s, which OpenSSL 3 only reads with -legacy */
    await execProgram(openssl, read)
      .catch(() => execProgram(openssl, [...read, "-legacy"]));
    const write = ["pkcs12", "-export", "-in", pem, "-out", out];
    write.push("-passout", "pass:", "-keypbe", "NONE", "-certpbe", "NONE");
    await execProgram(openssl, write);
    fs.rmSync(pem);
    return out;
  })();
}

/* pseudo-sign, or sign for real when a p12 is given */
async function ldidSign(entitlement: any, file: string, p12?: string) {
  const args = ["-S" + (entitlement || "")];
  if (p12 !== undefined) {
    args.push("-K" + await unlockP12(p12));
    /* sign a main executable as its bundle to seal resources like codesign */
    const dir = path.dirname(file);
    const info = path.join(dir, "Info.plist");
    if (
      fs.existsSync(info) &&
      plist.readFileSync(info).CFBundleExecutable === path.basename(file)
    ) {
      return execProgram(getTool("ldid"), [...args, "-w", dir]);
    }
  }
  const identifier = bin.getIdentifier(file);
  if (identifier !== null && identifier !== "") {
    args.push("-I" + identifier);
  }
  args.push(file);
  return execProgram(getTool("ldid")!, args);
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

async function getMobileProvisionPlist(file: string, useOpenSSL = false) {
  let res;
  if (file === undefined) {
    throw new Error("No mobile provisioning file available.");
  }
  if (useOpenSSL === true) {
    /* portable using openssl */
    const args = ["cms", "-verify", "-noverify", "-inform", "der", "-in", file];
    res = await execProgram(getTool("openssl")!, args);
  } else {
    /* OSX specific using security */
    const args = ["cms", "-D", "-i", file];
    res = await execProgram(getTool("security")!, args);
  }
  return plist.parse(res.stdout) as Record<string, any>;
}

async function getEntitlementsFromMobileProvision(
  file: string,
  useOpenSSL = false,
): Promise<any> {
  const res = await getMobileProvisionPlist(file, useOpenSSL);
  return res.Entitlements;
}

async function zip(cwd: string, ofile: string, src: string, use7zip = false) {
  try {
    await fs.promises.unlink(ofile);
  } catch (ignored) {}
  const ofilePath = path.dirname(ofile);
  fs.mkdirSync(ofilePath, { recursive: true });
  if (use7zip) {
    const zipFile = ofile + ".zip";
    const args = ["a", zipFile, src];
    await execProgram(getTool("7z")!, args, { cwd });
    await fs.promises.rename(zipFile, ofile);
  } else {
    const args = ["-qry", ofile, src];
    await execProgram(getTool("zip")!, args, { cwd });
  }
}

async function unzip(ifile: string, odir: string, use7zip = false) {
  if (use7zip) {
    const args = ["x", "-y", "-o" + odir, ifile];
    return execProgram(getTool("7z")!, args);
  }
  const args = ["-o", ifile, "-d", odir];
  return execProgram(getTool("unzip"), args);
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
  const args = ["--strip-codesig", "--all-yes", lib, bin, bin];
  const res = await execProgram(getTool("insert_dylib"), args);
  console.error(JSON.stringify(res));
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

/* IPA contents are untrusted: never read or write files through a symlink */
function assertNotSymlink(file: string): void {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (e: any) {
    if (e.code === "ENOENT") {
      return;
    }
    throw e;
  }
  if (stat.isSymbolicLink()) {
    throw new Error("Refusing to follow symlink: " + file);
  }
}

async function asyncRimraf(dir: any) {
  if (dir !== undefined) {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

export {
  assertNotSymlink,
  asyncRimraf,
  codesign,
  getEntitlementsFromMobileProvision,
  getIdentities,
  getIdentitiesSync,
  getMobileProvisionPlist,
  ideviceprovision,
  insertLibrary,
  isDirectory,
  ldidSign,
  lipoFile,
  unzip,
  verifyCodesign,
  xcaToIpa,
  zip,
};
