'use strict';
const r2pipe = require('r2pipe');
const tsort = require('tsort');
const uniq = require('uniq');
const fs = require('fs');

function resolvePath(file, x) {
  if (x.startsWith('@rpath')) {
    let baseIndex = file.lastIndexOf('/Frameworks');
    let basePath = '/';
    if (baseIndex !== -1) {
      basePath = file.substring(0, baseIndex + 12);
      return basePath + x.substring(6);
    } else {
      baseIndex = file.lastIndexOf('/');
      if (baseIndex !== -1) {
        basePath = file.substring(0, baseIndex);
      }
      return basePath + x.substring(6);
    }
  }
  return x;
}

module.exports = function(libs, cb) {
  const files = {};
  const graph = tsort();
  let peekableLibs = libs.slice(0);
  console.log(libs);
  const peek = () => {
    const lib = peekableLibs.pop();
    r2pipe.syscmdj('rabin2 -lj ' + lib, (res) => {
      for (let r of res.libs) {
        if (!r.startsWith('/')) {
          const realPath = resolvePath(lib, r);
          fs.statSync(realPath);
          console.log('realPath', realPath);
          graph.add(lib, realPath);
        }
      }
      if (peekableLibs.length === 0) {
        cb(uniq(graph.sort()));
      } else {
        peek();
      }
    });
  };
  peek();
}
