'use strict';

const tsort = require('tsort');
const fatmacho = require('fatmacho');
const macho = require('macho');
const uniq = require('uniq');
const fs = require('fs');
const isArray = require('is-array');

function resolvePath (file, lib) {
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

function getMachoLibs (file, cb) {
  try {
    const data = fs.readFileSync(file);
    try {
      var exec = macho.parse(data);
    } catch (e) {
      try {
        var fat = fatmacho.parse(data);
      } catch (e2) {
        return cb(e2);
      }
      for (let i = 0; i < fat.length; i++) {
        try {
          exec = macho.parse(fat[0].data);
          break;
        } catch (e2) {
          /* ignore exceptions here */
        }
      }
    }
    const libs = exec.cmds.filter((x) => {
      return x.type === 'load_dylib';
    }).map((x) => {
      return x.name;
    });
    cb(null, libs);
  } catch (e) {
    cb(e);
  }
}

module.exports = function (libs, cb) {
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
            graph.add(lib, realPath);
          }
        }
        if (peekableLibs.length === 0) {
          cb(null, uniq(graph.sort()).reverse());
        } else {
          peek();
        }
      });
    };
    peek();
  } else {
    cb(null, []);
  }
};
