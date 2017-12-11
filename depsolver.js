'use strict';

const fatmacho = require('fatmacho');
const macho = require('macho');
const uniq = require('uniq');
const fs = require('fs');
const isArray = require('is-array');

const MACH0_MIN_SIZE = 1024 * 4;

function resolveRpath (libs, file, lib) {
  const realLib = lib.substring(6); /* chop @rpath */
  const rpaths = uniq(libs.filter((x) => {
    return x.indexOf('dylib') !== -1;
  }).map((x) => {
    return x.substring(0, x.lastIndexOf('/'));
  }));
  rpaths.forEach((x) => {
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
  const sl4sh = file.lastIndexOf('/');
  const rpath = (sl4sh !== -1) ? file.substring(0, sl4sh) : '';
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
    fs.readFile(file, (err, data) => {
      if (err) {
        console.error(err);
        return cb(err);
      }
      if (data.length < MACH0_MIN_SIZE) {
        return cb(new Error('mach0 files can\'t be that small'));
      }
      var exec = null;
      try {
        exec = macho.parse(data);
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
            console.error(file);
            console.error(e2);
            return cb(null, []);
          }
        }
      }
      if (exec === null) {
        /* skip fat file here*/
        return cb(null, []);
      }
      const libs = exec.cmds.filter((x) => {
        return x.type === 'load_dylib' || x.type === 'load_weak_dylib';
      }).map((x) => {
        return x.name;
      });
      cb(null, libs);
    });
  } catch (e) {
    cb(e);
  }
}

function layerize (state) {
  let currentLayer = 0;
  const result = [];
  // fs.writeFileSync('lala.json', JSON.stringify(state));
  let processing = false;
  do {
    result[currentLayer] = [];
    for (let lib of Object.keys(state)) {
      const deps = state[lib].deps;
      if (deps.length === 0) {
        if (state[lib].layer === -1) {
          result[currentLayer].push(lib);
          state[lib].layer = 0;
        }
      }
      let allDepsSolved = true;
      for (let dep of deps) {
        const depLayer = state[dep]? state[dep].layer: 0;
        if (depLayer === -1 || depLayer === currentLayer) {
          allDepsSolved = false;
          break;
        }
      }
      processing = true;
      if (allDepsSolved) {
        if (state[lib].layer === -1) {
          result[currentLayer].push(lib);
          state[lib].layer = currentLayer;
        }
        processing = false;
      }
    }
    currentLayer++;
  } while (processing);

  return result;
}

function flattenize (layers) {
  const list = [];
  for (let layer of layers) {
    for (let lib of layer) {
      list.push(lib);
    }
  }
  return list;
}

module.exports = function depSolver (executable, libs, parallel, cb) {
  if (libs.length === 0) {
    return cb(null, []);
  }
  const state = {};
  let peekableLibs = libs.slice(0);
  const peek = () => {
    const target = peekableLibs.pop();
    getMachoLibs(target, (error, macholibs) => {
      if (target === undefined || error || !isArray(macholibs)) {
        return cb(error);
      }
      state[target] = {
        layer: -1,
        deps: []
      };
      for (let r of macholibs) {
        if (!r.startsWith('/')) {
          const realPath = resolvePath(executable, target, r, libs);
          try {
            fs.statSync(realPath);
            state[target].deps.push(realPath);
          } catch (e) {
          }
        }
      }
      if (peekableLibs.length === 0) {
        const layers = layerize(state);
        if (parallel) {
          cb(null, layers);
        } else {
          const finalLibs = flattenize(layers);
          if (libs.length !== finalLibs.length) {
            console.log('Orphaned libraries found');
            const orphaned = libs.filter(lib => finalLibs.indexOf(lib) === -1);
            orphaned.forEach(lib => {
              console.log(' *', lib);
            });

            /*
             * sign those anyways, just ensure to
             * sign them before the app executable
             */
            finalLibs.unshift(orphaned);
          }
          cb(null, finalLibs);
        }
      } else {
        peek();
      }
    });
  };
  peek();
};
