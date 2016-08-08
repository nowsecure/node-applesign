'use strict';

const assert = require('assert');
const process = require('child_process');

describe('API', function () {
  describe('require', function () {
    it('cannot require', function () {
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
      const ipaResign = process.spawn('bin/ipa-resign.js');
      ipaResign.on('stdout', (text) => {
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
      const ipaResign = process.spawn('bin/ipa-resign.js', ['missing.ipa']);
      ipaResign.on('close', (code) => {
        assert.equal(code, 1);
        done();
      });
    });
  });
});
