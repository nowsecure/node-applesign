'use strict';
const tsort = require('tsort');
const fatmacho = require('fatmacho');
const macho = require('macho');
const uniq = require('uniq');
const fs = require('fs');
const isArray = require('is-array');

const useR2Pipe = false;
const r2pipe = require('r2pipe');

function resolvePath(file, lib) {
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

function getMachoLibs(file, cb) {
  if (useR2Pipe) {
    r2pipe.syscmdj('rabin2 -lj ' + file, (res) => {
      if (!res) {
        cb (new Error('r2pipe error'));
      } else {
        cb (null, res.libs);
      }
    });
    return;
  }
  try {
    const data = fs.readFileSync(file);
    try {
      var exec = macho.parse(data);
    } catch (e) {
      try {
        const fat = fatmacho.parse(data);
        var exec = macho.parse(fat[0].data);
      } catch (e2) {
        return cb (e2);
      }
    }
    const libs = exec.cmds.filter( (x) => {
      return x.type === 'load_dylib';
    }).map ( (x) => {
      return x.name;
    });
    cb (null, libs);
  } catch (e) {
    cb (e);
  }
}

module.exports = function(libs, cb) {
  const files = {};
  const graph = tsort();
  if (libs.length > 0) {
    let peekableLibs = libs.slice(0);
    const peek = () => {
      const lib = peekableLibs.pop();
      getMachoLibs(lib, (error, libs) => {
        if (lib === undefined || error || !isArray(libs)) {
          return cb(new Error(error));
        }
        for (let r of libs) {
          if (!r.startsWith('/')) {
            const realPath = resolvePath(lib, r);
            fs.statSync(realPath);
            //console.log('realPath', realPath);
            graph.add(lib, realPath);
          }
        }
        if (peekableLibs.length === 0) {
          cb(null, uniq(graph.sort()));
        } else {
          peek();
        }
      });
    };
    peek();
  } else {
    cb(null, []);
  }
}
