'use strict';

const r2pipe = require('r2pipe');
const tsort = require('tsort');
const uniq = require('uniq');

function resolveRpath(file, lib) {
  const slash = file.lastIndexOf('/Frameworks');
  if (slash !== -1) {
    const rpath = file.substring(0, slash + '/Frameworks'.length);
    return lib.replace('@rpath', rpath);
  }
  const sl4sh = file.lastIndexOf('/');
  if (sl4sh !== -1) {
    const rpath = file.substring(0, sl4sh);
    return lib.replace('@rpath', rpath);
  }
  throw new Error('Cannot resolve rpath');
}

function filterLibs(file, libs) {
  const res = [];
  for (let lib of libs) {
    if (lib.startsWith('@rpath')) {
      const rpath = resolveRpath (file, lib);
      res.push(rpath);
    }
  }
  return uniq(res);
}

function topoSort(deps, cb) {
  const graph = tsort();
  for (let file in deps) {
    for (let lib of deps[file]) {
      graph.add(file, lib);
    }
  }
  return graph.sort();
}

module.exports = function dependencySolver(files, cb) {
  const deps = { };
  let done = files.length;
  if (done === 0) {
    return cb([]);
  }
  for (let file of files) {
    r2pipe.syscmdj ('rabin2 -lj ' + file, (obj) => {
      deps[file] = filterLibs(file, obj.libs)
      if (--done === 0) {
        return cb(topoSort(deps));
      }
    });
  }
}
