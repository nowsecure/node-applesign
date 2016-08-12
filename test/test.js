'use strict';

const assert = require('assert');
const spawn = require('child_process').spawn;
const path = require('path');
const fs = require('fs');

const mochaTimeout = 15000; /* 15s */
var developerCertificate = process.env.DEVCERT;
const ipaDir = 'test/ipa';

describe('API', function () {
  describe('require', function () {
    it('require works', function () {
      try {
        require('../');
        assert.equal(0, 0);
      } catch (e) {
        it('require');
        assert.equal(0, 1);
      }
    });
  });
});

describe('Commandline', function () {
  describe('bin/ipa-resign.js', function () {
    it('should fail when ipa-resign cannot be executed', function (done) {
      var data = '';
      const ipaResign = spawn('bin/ipa-resign.js');
      ipaResign.stdout.on('data', (text) => {
        data += text;
      });
      ipaResign.on('close', (code) => {
        assert.equal(data, '');
        assert.equal(code, 0);
        done();
      });
    });
  });
  describe('bin/ipa-resign.js missing.ipa', function () {
    it('should fail when passing an unexistent IPA', function (done) {
      const ipaResign = spawn('bin/ipa-resign.js', ['missing.ipa']);
      ipaResign.on('close', (code) => {
        assert.equal(code, 1);
        done();
      });
    });
  });
  describe('bin/ipa-resign.js -L', function () {
    it('checking for developer certificates', function (done) {
      var data = '';
      const ipaResign = spawn('bin/ipa-resign.js', ['-L']);
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
});

function grabIPAs (file) {
  return (file.indexOf('resigned') === -1) && file.endsWith('.ipa');
}

function grabResignedIPAs (file) {
  return (file.indexOf('resigned') !== -1) && file.endsWith('.ipa');
}

describe('Commandline IPA signing', function () {
  fs.readdir(ipaDir, function (err, files) {
    assert.equal(err, undefined);
    files.filter(grabIPAs).forEach(function (file) {
      describe(file, function () {
        this.timeout(mochaTimeout);
        it('signing', function (done) {
          let hasData = false;
          const ipaFile = path.resolve(path.join(ipaDir, file));
          const ipaResign = spawn('bin/ipa-resign.js', ['-i', developerCertificate, ipaFile]);
          ipaResign.stdout.on('data', (text) => {
            hasData = true;
          });
          ipaResign.stderr.on('data', (text) => {
            console.error(text.toString());
          });
          ipaResign.on('close', (code) => {
            assert.equal(hasData, true);
            assert.equal(code, 0);
            done();
          });
        });
      });
    });
  });
});

describe('Commandline IPA parallel signing', function () {
  fs.readdir(ipaDir, function (err, files) {
    assert.equal(err, undefined);
    files.filter(grabIPAs).forEach(function (file) {
      describe(file, function () {
        this.timeout(mochaTimeout);
        it('parallel signing', function (done) {
          let hasData = false;
          const ipaFile = path.resolve(path.join(ipaDir, file));
          const ipaResign = spawn('bin/ipa-resign.js', ['-p', '-i', developerCertificate, ipaFile]);
          ipaResign.stdout.on('data', (text) => {
            hasData = true;
          });
          ipaResign.stderr.on('data', (text) => {
            console.error(text.toString());
          });
          ipaResign.on('close', (code) => {
            assert.equal(hasData, true);
            assert.equal(code, 0);
            done();
          });
        });
      });
    });
  });
});

describe('Resigned IPA deploy', function () {
  fs.readdir(ipaDir, function (err, files) {
    assert.equal(err, undefined);
    files.filter(grabResignedIPAs).forEach(function (file) {
      describe(file, function () {
        this.timeout(mochaTimeout);
        it('deploying', function (done) {
          var hasData = false;
          const ipaResign = spawn('ios-deploy', ['-b', path.join(ipaDir, file)]);
          ipaResign.stdout.on('data', (text) => {
            hasData = true;
          });
          ipaResign.stderr.on('data', (text) => {
            console.error(text.toString());
          });
          ipaResign.on('close', (code) => {
            assert.equal(hasData, true);
            assert.equal(code, 0);
            done();
          });
        });
      });
    });
  });
});
