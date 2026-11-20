import * as assert from "node:assert";
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import Applesign from "../dist/index.js";
import { AppDirectory } from "../dist/lib/appdir.js";
import plist from "../dist/lib/plist.js";

const ipaTimeout = 15000;
const developerCertificate = process.env.DEVCERT;
const ipaDir = "test/ipa";

/*
// cant await import or require because.. mocha/esm
describe("API", () => {
  describe("require", () => {
    it("require works", async () => {
      try {
        // const index = await import('./dist/index.js') as any;
        assert.strictEqual(0, 0);
      } catch (e) {
	      console.error(e);
        assert.fail("require failed");
      }
    });
  });
});
*/

describe("API", () => {
  describe("plist", () => {
    it("preserves a binary plist integer stored in 16 bytes", () => {
      const binary = Buffer.from(
        "62706c6973743030" + // bplist00
          "1400000000000000000000000000000001" + // 16-byte integer: 1
          "08" + // object offset
          "0000000000000101" + // offset and reference sizes
          "0000000000000001" + // object count
          "0000000000000000" + // root object index
          "0000000000000019", // offset table position
        "hex",
      );
      const value = plist.parse(binary);
      assert.strictEqual(value, 1);
      assert.strictEqual(plist.parse(plist.build(value)), 1);
    });
  });

  describe("unzipIPA", () => {
    it("should fail when the input file is missing", async () => {
      const applesign = new Applesign({});
      await assert.rejects(
        applesign.unzipIPA("", "tmp"),
        /No input file specified/,
      );
    });

    it("should fail when the output directory is missing", async () => {
      const applesign = new Applesign({});
      await assert.rejects(
        applesign.unzipIPA("test.ipa", ""),
        /No output directory specified/,
      );
    });
  });

  describe("removeXCTests", () => {
    it("deletes the directories left empty", async () => {
      const root = fs.mkdtempSync(path.join(tmpdir(), "applesign-xctest-"));
      const signer = new Applesign({});
      try {
        const appdir = path.join(root, "Main.app");
        const frameworks = path.join(appdir, "Frameworks");
        for (
          const file of [
            "XCTest.framework/XCTest",
            "Swift.framework/libXCTestSwiftSupport.dylib",
            "Keep.framework/Keep",
          ]
        ) {
          fs.mkdirSync(path.dirname(path.join(frameworks, file)), {
            recursive: true,
          });
          fs.writeFileSync(path.join(frameworks, file), "");
        }
        signer.config.appdir = appdir;
        await signer.removeXCTests();
        assert.deepStrictEqual(fs.readdirSync(frameworks), ["Keep.framework"]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(signer.tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("removeSigningFiles", () => {
    it("skips directories named like signing files", async () => {
      const root = fs.mkdtempSync(path.join(tmpdir(), "applesign-test-"));
      const signer = new Applesign({});
      try {
        const appdir = path.join(root, "Main.app");
        fs.mkdirSync(path.join(appdir, "Res.entitlements"), {
          recursive: true,
        });
        for (
          const file of [
            "Res.entitlements/keep",
            "Main.entitlements",
            "embedded.mobileprovision",
          ]
        ) {
          fs.writeFileSync(path.join(appdir, file), "");
        }
        signer.config.appdir = appdir;
        await signer.removeSigningFiles();
        assert.deepStrictEqual(fs.readdirSync(appdir), ["Res.entitlements"]);
        assert.ok(fs.existsSync(path.join(appdir, "Res.entitlements/keep")));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(signer.tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("extension symlinks", () => {
    function createBundle(directory: string, name: string): string {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, "Info.plist"),
        `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>${name}</string></dict></plist>`,
      );
      const executable = path.join(directory, name);
      const macho = Buffer.alloc(32);
      macho.writeUInt32LE(0xfeedfacf, 0); // MH_MAGIC_64
      macho.writeUInt32LE(0x0100000c, 4); // CPU_TYPE_ARM64
      macho.writeUInt32LE(2, 12); // MH_EXECUTE
      fs.writeFileSync(executable, macho);
      return executable;
    }

    for (const mode of ["all", "parallel"]) {
      it(`excludes external extension binaries when signing with --${mode}`, async () => {
        const root = fs.mkdtempSync(path.join(tmpdir(), "applesign-test-"));
        const signer = new Applesign({ [mode]: true, pseudoSign: true });
        try {
          const appdir = path.join(root, "Main.app");
          const main = createBundle(appdir, "Main");
          const internal = createBundle(
            path.join(appdir, "PlugIns/Internal.appex"),
            "Internal",
          );
          const external = path.join(root, "External.appex");
          createBundle(external, "External");
          fs.symlinkSync(
            external,
            path.join(appdir, "PlugIns/External.appex"),
            "dir",
          );

          const expected = new Set([main, internal]);
          const directory = new AppDirectory();
          await directory.loadFromDirectory(appdir);
          assert.deepStrictEqual(new Set(directory.diskLibraries()), expected);
          assert.deepStrictEqual(new Set(directory.appLibraries()), expected);
          assert.deepStrictEqual(directory.appExtensions(), [internal]);

          const signed: string[] = [];
          signer.signFile = async (file: string) => {
            signed.push(file);
            return signer;
          };
          signer.adjustEntitlements = async () => {};
          await signer.signAppDirectory(appdir);
          assert.deepStrictEqual(new Set(signed), expected);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
          fs.rmSync(signer.tmpDir, { recursive: true, force: true });
        }
      });
    }

    it("signs nested apps with --parallel", async () => {
      const root = fs.mkdtempSync(path.join(tmpdir(), "applesign-test-"));
      const signer = new Applesign({ parallel: true, pseudoSign: true });
      try {
        const appdir = path.join(root, "Main.app");
        const main = createBundle(appdir, "Main");
        const watch = createBundle(path.join(appdir, "Watch/W.app"), "W");
        const signed: string[] = [];
        signer.signFile = async (file: string) => {
          signed.push(file);
          return signer;
        };
        signer.adjustEntitlements = async () => {};
        await signer.signAppDirectory(appdir);
        assert.deepStrictEqual(signed.sort(), [main, watch].sort());
        assert.strictEqual(signer.config.appdir, appdir);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(signer.tmpDir, { recursive: true, force: true });
      }
    });

    it("signs frameworks of an app inside an .app directory with --parallel", async () => {
      const root = fs.mkdtempSync(path.join(tmpdir(), "applesign-test-"));
      const signer = new Applesign({ parallel: true, pseudoSign: true });
      try {
        const appdir = path.join(root, "Old.app/Main.app");
        const main = createBundle(appdir, "Main");
        const fw = createBundle(
          path.join(appdir, "Frameworks/F.framework"),
          "F",
        );
        const signed: string[] = [];
        signer.signFile = async (file: string) => {
          signed.push(file);
          return signer;
        };
        signer.adjustEntitlements = async () => {};
        await signer.signAppDirectory(appdir);
        assert.deepStrictEqual(signed.sort(), [fw, main].sort());
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(signer.tmpDir, { recursive: true, force: true });
      }
    });

    it("verifies the signed binaries with --parallel", async () => {
      const root = fs.mkdtempSync(path.join(tmpdir(), "applesign-test-"));
      const signer = new Applesign({
        parallel: true,
        pseudoSign: true,
        verify: true,
      });
      process.env.CODESIGN = "false"; // every verification fails
      try {
        const appdir = path.join(root, "Main.app");
        createBundle(appdir, "Main");
        signer.signFile = async () => signer;
        signer.adjustEntitlements = async () => {};
        await assert.rejects(signer.signAppDirectory(appdir), /-v --no-strict/);
      } finally {
        delete process.env.CODESIGN;
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(signer.tmpDir, { recursive: true, force: true });
      }
    });
  });
});

describe("Commandline", () => {
  describe("dist/bin/applesign.js", () => {
    it("should fail when applesign cannot be executed", (_t, done) => {
      let data = "";
      const ipaResign = spawn("dist/bin/applesign.js");
      ipaResign.stdout.on("data", (text) => {
        data += text;
      });
      ipaResign.on("close", (code) => {
        assert.strictEqual(data, "");
        assert.strictEqual(code, 0);
        done();
      });
    });
  });

  describe("dist/bin/applesign.js missing.ipa", () => {
    it("should fail when passing a nonexistent IPA", (_t, done) => {
      const ipaResign = spawn("dist/bin/applesign.js", ["missing.ipa"]);
      ipaResign.on("close", (code) => {
        assert.strictEqual(code, 1);
        done();
      });
    });
  });

  /*
  describe("bin/applesign.js -L", () => {
    it("checking for developer certificates", (done) => {
      let data = "";
      const ipaResign = spawn("bin/applesign.js", ["-L"]);
      ipaResign.stdout.on("data", (text) => {
        if (!developerCertificate) {
          developerCertificate = text.toString().split(" ")[0];
        }
        data += text;
      });
      ipaResign.on("close", (code) => {
        assert.notStrictEqual(data, "");
        assert.strictEqual(code, 0);
        done();
      });
    });
  });
  */
});

function grabIPAs(file: string): boolean {
  return !file.includes("resigned") && file.endsWith(".ipa");
}

function processIPA(file: string, parallel: boolean) {
  describe(`${parallel ? "Parallel" : "Serial"} signing`, () => {
    it(file, { timeout: ipaTimeout }, (_t, done) => {
      let hasData = false;
      const ipaFile = path.resolve(path.join(ipaDir, file));
      const args = parallel
        ? ["-p", "-i", developerCertificate!, ipaFile]
        : ["-i", developerCertificate!, ipaFile];
      const ipaResign = spawn("dist/bin/applesign.js", args);

      ipaResign.stdout.on("data", () => {
        hasData = true;
      });

      ipaResign.stderr.on("data", (text) => {
        console.error(text.toString());
      });

      ipaResign.on("close", (code) => {
        assert.strictEqual(hasData, true);
        assert.strictEqual(code, 0);
        done();
      });
    });
  });
}

function deployIPA(file: string) {
  describe(`Deploy ${file}`, () => {
    it("deploying", { timeout: ipaTimeout }, (_t, done) => {
      let hasData = false;
      const ipaResign = spawn("ios-deploy", ["-b", path.join(ipaDir, file)]);
      ipaResign.stdout.on("data", () => {
        hasData = true;
      });

      ipaResign.stderr.on("data", (text) => {
        console.error(text.toString());
      });

      ipaResign.on("close", (code) => {
        assert.strictEqual(hasData, true);
        assert.strictEqual(code, 0);
        done();
      });
    });
  });
}

describe("Commandline IPA signing", () => {
  const files = fs.readdirSync(ipaDir);
  describe("Processing", () => {
    files.filter(grabIPAs).forEach((file) => {
      describe(file, () => {
        processIPA(file, false);
        processIPA(file, true);
        deployIPA(file);
      });
    });
  });
});
