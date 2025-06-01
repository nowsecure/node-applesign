'use strict';

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'path'.
const path = require('path');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'walk'.
const walk = require('fs-walk');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'plist'.
const plist = require('simple-plist');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'bin'.
const bin = require('./bin');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'fs'.
const fs = require('fs');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'depSolver'... Remove this comment to see the full error message
const depSolver = require('./depsolver');

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports.AppDirectory =

class AppDirectory {
  appbin: any;
  appdir: any;
  appexs: any;
  applibs: any;
  disklibs: any;
  exebin: any;
  nested: any;
  notlibs: any;
  orphan: any;
  syslibs: any;
  constructor () {
    this.nested = [];
  }

  async loadFromDirectory (appdir: any) {
    this.exebin = _getAppExecutable(appdir);
    this.appdir = appdir;
    this.appbin = path.join(this.appdir, this.exebin);
    this.nested = _findNested(this.appdir);
    this.disklibs = _findBinaries(this.appdir);
    this.appexs = _getAppExtensions(appdir);
    const applibs = _findLibraries(this.appdir, this.exebin, this.appexs, this.disklibs);
    // @ts-expect-error TS(7006): Parameter 'l' implicitly has an 'any' type.
    this.notlibs = applibs.filter(l => l[0] === '@');
    // @ts-expect-error TS(7006): Parameter 'l' implicitly has an 'any' type.
    this.applibs = applibs.filter(l => l[0] !== '@');
    this.syslibs = _findSystemLibraries(this.applibs);
    this.orphan = orphanedLibraries(this.applibs, this.disklibs);
  }

  appLibraries () {
    return this.applibs;
  }

  diskLibraries () {
    return this.disklibs;
  }

  systemLibraries () {
    return this.syslibs;
  }

  unavailableLibraries () {
    return this.notlibs;
  }

  orphanedLibraries (src: any, dst: any) {
    return this.orphan;
  }

  nestedApplications () {
    return this.nested;
  }

  appExtensions () {
    return this.appexs;
  }
};

// internal functions //
function orphanedLibraries (src: any, dst: any) {
  // list all the libs that are not referenced from the main binary and their dependencies
  const orphan = [];
  for (const lib of dst) {
    if (src.indexOf(lib) === -1) {
      orphan.push(lib);
    }
  }
  return orphan;
}

function _findSystemLibraries (applibs: any) {
  const syslibs: any = [];
  for (const lib of applibs) {
    const res = binSysLibs(lib).filter((l: any) => syslibs.indexOf(l) === -1);
    syslibs.push(...res);
  }
  return syslibs;
}

function _getAppExecutable (appdir: any) {
  if (!appdir) {
    throw new Error('No application directory is provided');
  }
  const plistPath = path.join(appdir, 'Info.plist');
  try {
    const plistData = plist.readFileSync(plistPath);
    const cfBundleExecutable = plistData.CFBundleExecutable;
    if (cfBundleExecutable) {
      return cfBundleExecutable;
    }
  } catch (e) {
    // do nothing
    console.error(e);
  }
  const exename = path.basename(appdir);
  const dotap = exename.indexOf('.app');
  return (dotap === -1) ? exename : exename.substring(0, dotap);
}

function _getAppExtensions (appdir: any) {
  const d = path.join(appdir, 'PlugIns');
  const apexBins: any = [];
  try {
    if (!fs.existsSync(d)) {
      return apexBins;
    }
    const files = fs.readdirSync(d);
    for (const file of files) {
      const apexDir = path.join(d, file);
      const apexPlist = path.join(apexDir, 'Info.plist');
      if (fs.existsSync(apexPlist)) {
        const apexInfo = plist.readFileSync(apexPlist);
        if (apexInfo.CFBundleExecutable) {
          const apexBin = path.join(apexDir, apexInfo.CFBundleExecutable);
          if (fs.existsSync(apexBin)) {
            apexBins.push(apexBin);
          }
        }
      }
    }
    console.error(apexBins);
  } catch (e) {
    console.error(e);
    return [];
  }
  return apexBins;
}

/** return an array of strings with the absolute paths of the sub-apps found inside appdir */
function _findNested (d: any) {
  const nested: any = [];
  walk.walkSync(d, (basedir: any, filename: any, stat: any) => {
    const file = path.join(basedir, filename);
    if (file.indexOf('.app/Info.plist') !== -1) {
      const nest = file.lastIndexOf('.app/');
      nested.push(file.substring(0, nest + 4));
    }
  });
  return nested;
}

function _findBinaries (appdir: any) {
  const libraries: any = [];
  walk.walkSync(appdir, (basedir: any, filename: any, stat: any) => {
    const file = path.join(basedir, filename);
    // only walk on files. Symlinks and other special files are forbidden
    if (!fs.lstatSync(file).isFile()) {
      return;
    }
    if (bin.isMacho(file)) {
      libraries.push(file);
    }
  });
  return libraries;
}

function binSysLibs (file: any) {
  try {
    return bin.enumerateLibraries(file)
      .filter((l: any) => l.startsWith('/'));
  } catch (e) {
    console.error('Warning: missing file:', file);
    return [];
  }
}

// return a list of the libs that must be inside the app
function binAbsLibs (file: any, o: any) {
  try {
    return bin.enumerateLibraries(file)
      .filter((l: any) => {
        return !(l.startsWith('/'));
      })
      .map((l: any) => {
        if (l[0] === '@') {
          const ll = depSolver.resolvePath(o.exe, file, l, o.libs);
          if (ll) {
            l = ll;
          } else {
            console.error('Warning: Cannot resolve dependency library: ' + file);
          }
        }
        return l;
      });
  } catch (e) {
    console.error('Warning: missing file:', file);
    return [];
  }
}

// get all dependencies from appbin recursively
function _findLibraries (appdir: any, appbin: any, appexs: any, disklibs: any) {
  const exe = path.join(appdir, appbin);

  const o = {
    exe,
    lib: exe,
    libs: disklibs
  };
  const libraries: any = [];
  const pending = [exe, ...appexs];
  while (pending.length > 0) {
    const target = pending.shift();
    if (libraries.indexOf(target) === -1) {
      libraries.push(target);
    }
    const res = binAbsLibs(target, o);
    const unexplored = res.filter((l: any) => libraries.indexOf(l) === -1);
    pending.push(...unexplored.filter((l: any) => pending.indexOf(l) === -1));
    libraries.push(...unexplored);
  }
  return libraries;
}
