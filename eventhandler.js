'use strict';

module.exports = class EventHandler {
  constructor () {
    this.cb = {};
    this.queue = {};
  }
  on (ev, cb) {
    this.cb[ev] = cb;
    if (typeof this.queue[ev] === 'object') {
      this.queue[ev].forEach(cb);
    }
    return this;
  }
  emit (ev, msg) {
    const cb = this.cb[ev];
    if (typeof cb === 'function') {
      return cb(msg);
    }
    if (typeof this.queue[ev] !== 'object') {
      this.queue[ev] = [];
    }
    this.queue[ev].push(msg);
    return false;
  }
}
