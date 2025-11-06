import path from "node:path";
import walk from "fs-walk";
import plist from "simple-plist";
import * as bin from "./bin.js";
import fs from "node:fs";
import { resolvePath } from "./depsolver.js";

export class AppDirectory {
  appbin: string = "";
  appdir: string = "";
  appexs: string[] = [];
  applibs: string[] = [];
  disklibs: string[] = [];
  exebin: string | null = null;
  nested: string[] = [];
  notlibs: string[] = [];
  orphan: string[] = [];
  syslibs: string[] = [];
  constructor() {
    this.nested = [];
  }

  async loadFromDirectory(appdir: string) {
    this.exebin = _getAppExecutable(appdir);
    this.appdir = appdir;
    this.appbin = path.join(this.appdir, this.exebin);
    this.nested = _findNested(this.appdir);
    this.disklibs = _findBinaries(this.appdir);
    this.appexs = _getAppExtensions(appdir);
    const applibs = _findLibraries(
      this.appdir,
      this.exebin,
      this.appexs,
      this.disklibs,
    );
    this.notlibs = applibs.filter((l) => l[0] === "@");
    this.applibs = applibs.filter((l) => l[0] !== "@");
    this.syslibs = _findSystemLibraries(this.applibs);
    this.orphan = orphanedLibraries(this.applibs, this.disklibs);
  }

  appLibraries(): string[] {
    return this.applibs;
  }

  diskLibraries(): string[] {
    return this.disklibs;
  }

  systemLibraries(): string[] {
    return this.syslibs;
  }

  unavailableLibraries(): string[] {
    return this.notlibs;
  }

  orphanedLibraries(): string[] {
    return this.orphan;
  }

  nestedApplications(): string[] {
    return this.nested;
  }

  appExtensions(): string[] {
    return this.appexs;
  }
}

// internal functions //
/**
 * Finds libraries that are present in the application bundle but not
 * referenced by the main binary or any of its dependencies.
 *
 * @param src - Array of libraries that are referenced by the main binary and its dependencies
 * @param dst - Array of all libraries found in the application bundle
 * @returns Array of library paths that exist in the application but aren't referenced
 */
function orphanedLibraries(src: string[], dst: string[]): string[] {
  return dst.filter((lib) => !src.includes(lib));
}

function _findSystemLibraries(applibs: string[]): string[] {
  const syslibs: string[] = [];
  for (const lib of applibs) {
    const res = binSysLibs(lib).filter((l: any) => syslibs.indexOf(l) === -1);
    syslibs.push(...res);
  }
  return syslibs;
}

function _getAppExecutable(appdir: string): string {
  if (!appdir) {
    throw new Error("No application directory is provided");
  }
  const plistPath = path.join(appdir, "Info.plist");
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
  const dotap = exename.indexOf(".app");
  return dotap === -1 ? exename : exename.substring(0, dotap);
}

function _getAppExtensions(appdir: string): string[] {
  const d = path.join(appdir, "PlugIns");
  const apexBins: string[] = [];
  try {
    if (!fs.existsSync(d)) {
      return apexBins;
    }
    const files = fs.readdirSync(d);
    for (const file of files) {
      const apexDir = path.join(d, file);
      const apexPlist = path.join(apexDir, "Info.plist");
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
function _findNested(d: string): string[] {
  const nested: string[] = [];
  walk.walkSync(d, (basedir: any, filename: any, stat: any) => {
    const file = path.join(basedir, filename);
    if (file.indexOf(".app/Info.plist") !== -1) {
      const nest = file.lastIndexOf(".app/");
      nested.push(file.substring(0, nest + 4));
    }
  });
  return nested;
}

function _findBinaries(appdir: string): string[] {
  const libraries: string[] = [];
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

/**
 * Finds all libraries with absolute paths that the file depends on
 *
 * @param file - The macho file to be analyzed
 * @returns Array of absolute paths to the discovered binary files
 */
function binSysLibs(file: string): string[] {
  try {
    return bin
      .enumerateLibraries(file)
      .filter((l: string) => l.startsWith("/"));
  } catch (e) {
    console.error("Warning: missing file:", file);
    return [];
  }
}

// return a list of the libs that must be inside the app
function binAbsLibs(sourceFile: string, targetPaths: any): string[] {
  try {
    return bin
      .enumerateLibraries(sourceFile)
      .filter((libraryPath: string) => {
        return !libraryPath.startsWith("/");
      })
      .map((libraryPath: string) => {
        if (libraryPath.startsWith("@")) {
          const resolvedPath = resolvePath(
            targetPaths.exe,
            sourceFile,
            libraryPath,
            targetPaths.libs,
          );
          if (resolvedPath) {
            libraryPath = resolvedPath;
          } else {
            console.error(
              "Warning: Cannot resolve dependency library: " + sourceFile,
            );
          }
        }
        return libraryPath;
      });
  } catch (error) {
    console.error("Warning: missing file:", sourceFile);
    return [];
  }
}

// get all dependencies from appbin recursively
function _findLibraries(
  appdir: string,
  appbin: string,
  appexs: string[],
  disklibs: string[],
): string[] {
  const exe = path.join(appdir, appbin);

  const targets = {
    exe,
    lib: exe,
    libs: disklibs,
  };
  const libraries: any = [];
  const pending = [exe, ...appexs];
  while (pending.length > 0) {
    const target = pending.shift() as string;
    if (libraries.indexOf(target) === -1) {
      libraries.push(target);
    }
    const res = binAbsLibs(target, targets);
    const unexplored = res.filter((l: string) => libraries.indexOf(l) === -1);
    pending.push(
      ...unexplored.filter((l: string) => pending.indexOf(l) === -1),
    );
    libraries.push(...unexplored);
  }
  return libraries;
}
