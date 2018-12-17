'use strict';

const tools = require('./lib/tools');
const config = require('./lib/config');
const EventEmitter = require('events').EventEmitter;
const ApplesignSession = require('./lib/session');

module.exports = class Applesign {
  constructor (options) {
    this.config = config.fromOptions(options);
    this.events = new EventEmitter();
  }

  async signDirectory (directory, cb) {
    const s = new ApplesignSession(this.config);
    s.events = this.events;
    s.setFile(directory);
    await s.signAppDirectory(directory);
    await s.finalize();
  }

  async signIPA (file) {
    const s = new ApplesignSession(this.config);
    s.events = this.events;
    s.setFile(file);
    await s.signIPA();
  }

  async signFile (file) {
    const s = new ApplesignSession(this.config);
    s.events = this.events;
    // s.setFile(file);
    await s.signFile(file);
  }

  async signXCarchive (file) {
    const ipaFile = file + '.ipa';
    await tools.xcaToIpa(file);
    await this.signIPA(ipaFile);
  }

  async getIdentities () {
    return tools.getIdentities();
  }
};
