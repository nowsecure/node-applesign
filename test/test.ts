import * as assert from "node:assert";
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { describe, it } from "mocha";

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
