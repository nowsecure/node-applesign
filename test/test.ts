"use strict";

// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const assert = require("assert");
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'spawn'.
const spawn = require("child_process").spawn;
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'path'.
const path = require("path");
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'fs'.
const fs = require("fs");

const mochaTimeout = 15000; /* 15s */
// @ts-expect-error TS(2580): Cannot find name 'process'. Do you need to install... Remove this comment to see the full error message
const developerCertificate = process.env.DEVCERT;
const ipaDir = "test/ipa";

// @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe("API", function () {
  // @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
  describe("require", function () {
    // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it("require works", function () {
      try {
        // @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
        require("../");
        assert.equal(0, 0);
      } catch (e) {
        // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
        it("require");
        assert.equal(0, 1);
      }
    });
  });
});

// @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe("Commandline", function () {
  // @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
  describe("bin/applesign.js", function () {
    // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it("should fail when applesign cannot be executed", function (done: any) {
      let data = "";
      const ipaResign = spawn("bin/applesign.js");
      ipaResign.stdout.on("data", (text: any) => {
        data += text;
      });
      ipaResign.on("close", (code: any) => {
        assert.equal(data, "");
        assert.equal(code, 0);
        done();
      });
    });
  });
  // @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
  describe("bin/applesign.js missing.ipa", function () {
    // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it("should fail when passing an unexistent IPA", function (done: any) {
      const ipaResign = spawn("bin/applesign.js", ["missing.ipa"]);
      ipaResign.on("close", (code: any) => {
        assert.equal(code, 1);
        done();
      });
    });
  });
  /*
 // XXX this test fails in the CI because no keys has been created yet
  describe('bin/applesign.js -L', function () {
    it('checking for developer certificates', function (done) {
      let data = '';
      const ipaResign = spawn('bin/applesign.js', ['-L']);
      ipaResign.stdout.on('data', (text) => {
        if (developerCertificate === undefined) {
          developerCertificate = text.toString().split(' ')[0];
        }
        data += text;
      });
      ipaResign.on('close', (code) => {
        assert.notEqual(data, '');
        assert.equal(code, 0);
        done();
      });
    });
  });
  */
});

function grabIPAs(file: any) {
  return (file.indexOf("resigned") === -1) && file.endsWith(".ipa");
}

/*
function grabResignedIPAs (file) {
  return (file.indexOf('resigned') !== -1) && file.endsWith('.ipa');
}
*/

function processIPA(file: any, parallel: any) {
  // @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
  describe(
    (parallel ? "Parallel" : "Serial") + " signing",
    function (this: any) {
      this.timeout(mochaTimeout);
      // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
      it(file, function (done: any) {
        let hasData = false;
        const ipaFile = path.resolve(path.join(ipaDir, file));
        const ipaResign = spawn(
          "bin/applesign.js",
          parallel
            ? ["-p", "-i", developerCertificate, ipaFile]
            : ["-i", developerCertificate, ipaFile],
        );
        ipaResign.stdout.on("data", (text: any) => {
          hasData = true;
        });
        ipaResign.stderr.on("data", (text: any) => {
          console.error(text.toString());
        });
        ipaResign.on("close", (code: any) => {
          assert.equal(hasData, true);
          assert.equal(code, 0);
          done();
        });
      });
    },
  );
}

const deployIPA = (file: any) => {
  // @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
  describe("Deploy " + file, function (this: any) {
    this.timeout(mochaTimeout);
    // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it("deploying", function (done: any) {
      let hasData = false;
      const ipaResign = spawn("ios-deploy", ["-b", path.join(ipaDir, file)]);
      ipaResign.stdout.on("data", (text: any) => {
        hasData = true;
      });
      ipaResign.stderr.on("data", (text: any) => {
        console.error(text.toString());
      });
      ipaResign.on("close", (code: any) => {
        assert.equal(hasData, true);
        assert.equal(code, 0);
        done();
      });
    });
  });
};

// @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe("Commandline IPA signing", function () {
  fs.readdir(ipaDir, function (err: any, files: any) {
    assert.equal(err, undefined);
    // @ts-expect-error TS(2582): Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
    describe("Processing", function () {
      files.filter(grabIPAs).forEach(function (file: any) {
        // @ts-expect-error TS(2582): Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
        it(file, function () {
          processIPA(file, false);
          processIPA(file, true);
          deployIPA(file);
        });
      });
    });
  });
});
