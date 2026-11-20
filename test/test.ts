import * as assert from "node:assert";
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { describe, it } from "mocha";
import Applesign from "../index.js";
import { AppDirectory } from "../lib/appdir.js";

const mochaTimeout = 15000;
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
  });
});

describe("Commandline", () => {
  describe("dist/bin/applesign.js", () => {
    it("should fail when applesign cannot be executed", (done) => {
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
    it("should fail when passing a nonexistent IPA", (done) => {
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
  describe(`${parallel ? "Parallel" : "Serial"} signing`, function () {
    this.timeout(mochaTimeout);
    it(file, (done) => {
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
  describe(`Deploy ${file}`, function () {
    this.timeout(mochaTimeout);
    it("deploying", (done) => {
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

describe("Commandline IPA signing", function () {
  this.timeout(30000); // in case reading directory is slow
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
