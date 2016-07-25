'use strict';

const tsort = require('tsort');
const fatmacho = require('fatmacho');
const macho = require('macho');
const uniq = require('uniq');
const fs = require('fs');
const isArray = require('is-array');

function resolveRpath (libs, file, lib) {
  const realLib = lib.substring(6); /* chop @rpath */
  const rpaths = uniq(libs.filter((x) => {
    return x.indexOf('dylib') !== -1;
  }).map((x) => {
    return x.substring(0, x.lastIndexOf('/'));
  }));
  rpaths.forEach ((x) => {
    console.log(file);
    try {
      const paz = x + realLib;
      fs.statSync(paz);
      return lib.replace('@rpath', paz);
    } catch (e) {
      /* ignored */
    }
  });
  if (rpaths.length > 0) {
    return rpaths[0] + realLib;
  }
  return realLib;
}

function resolveEpath (file, lib) {
    return lib.replace('@executable_path', rpath);
}

function resolveLpath (file, lib) {
  const sl4sh = file.lastIndexOf('/');
  const rpath = (sl4sh !== -1) ? file.substring(0, sl4sh) : '';
  return lib.replace('@loader_path', rpath);
}

function resolvePath (executable, file, lib, libs) {
  if (lib.startsWith('@rpath')) {
    return resolveRpath(libs, file, lib);
  }
  if (lib.startsWith('@executable_path')) {
    return resolveEpath(executable, lib);
  }
  if (lib.startsWith('@loader_path')) {
    return resolveLpath(file, lib);
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

module.exports = function (executable, libs, cb) {
  const graph = tsort();
  if (libs.length > 0) {
    let peekableLibs = libs.slice(0);
    const peek = () => {
      const lib = peekableLibs.pop();
      getMachoLibs(lib, (error, macholibs) => {
        if (lib === undefined || error || !isArray(macholibs)) {
          return cb(error);
        }
        for (let r of macholibs) {
          if (!r.startsWith('/')) {
            const realPath = resolvePath(executable, lib, r, libs);
            try {
              fs.statSync(realPath);
              graph.add(lib, realPath);
            } catch (e) {
              graph.add(lib);
              console.log('MISSING: '+ realPath);
            }
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
