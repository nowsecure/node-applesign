'use strict';

const machoEntitlements = require('./macho-entitlements');
const ent = machoEntitlements.parseFile(process.argv[2]);
console.log(ent.toString());
