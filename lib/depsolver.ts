import fs from "fs";
import * as bin from "./bin.js";

function resolveRpath(libs: any, file: any, lib: any): string | null {
  const libName = lib.substring(6); /* chop @rpath */
  const rpaths = libs.filter((x: any) => {
    return x.indexOf(libName) !== -1;
  });
  if (rpaths.length > 0) {
    return rpaths[0];
  }
  // throw new Error('Cannot resolve rpath: ' + libName);
  console.error("Cannot resolve rpath for:", lib, "from", file);
  return null;
}

function resolvePathDirective(
  file: string,
  lib: string,
  directive: string,
): string {
  const slash = file.lastIndexOf("/");
  const rpath = (slash !== -1) ? file.substring(0, slash) : "";
  return lib.replace(directive, rpath);
}

export function resolvePath(
  executable: string,
  file: string,
  lib: string,
  libs: string[],
) {
  if (lib.startsWith("/")) {
    return null;
  }
  if (lib.startsWith("@rpath")) {
    return resolveRpath(libs, file, lib);
  }
  if (lib.startsWith("@executable_path")) {
    return resolvePathDirective(executable, lib, "@executable_path");
  }
  if (lib.startsWith("@loader_path")) {
    return resolvePathDirective(executable, lib, "@loader_path");
  }
  throw new Error("Cannot resolve: " + file);
}

function layerize(state: any) {
  let currentLayer = 0;
  const result = [];
  let processing = false;
  do {
    result[currentLayer] = [];
    for (const lib of Object.keys(state)) {
      const deps = state[lib].deps;
      if (deps.length === 0) {
        if (state[lib].layer === -1) {
          // @ts-expect-error TS(2345): Argument of type 'string' is not assignable to par... Remove this comment to see the full error message
          result[currentLayer].push(lib);
          state[lib].layer = 0;
        }
      }
      let allDepsSolved = true;
      for (const dep of deps) {
        const depLayer = state[dep] ? state[dep].layer : 0;
        if (depLayer === -1 || depLayer === currentLayer) {
          allDepsSolved = false;
          break;
        }
      }
      processing = true;
      if (allDepsSolved) {
        if (state[lib].layer === -1) {
          // @ts-expect-error TS(2345): Argument of type 'string' is not assignable to par... Remove this comment to see the full error message
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

function flattenize(layers: any): string[] {
  const list: string[] = [];
  for (const layer of layers) {
    for (const lib of layer) {
      list.push(lib);
    }
  }
  return list;
}

export default function depSolver(
  executable: string,
  libs: string[],
  parallel: boolean,
): Promise<any> {
  return new Promise((resolve, reject) => {
    if (libs.length === 0) {
      return resolve([]);
    }
    const state = {};
    const peekableLibs = libs.slice(0);
    const peek = () => {
      const target = peekableLibs.pop();
      const macholibs = bin.enumerateLibraries(target);
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      state[target] = {
        layer: -1,
        deps: [],
      };
      for (const r of macholibs) {
        if (!r.startsWith("/")) {
          const realPath = resolvePath(executable, target!, r, libs);
          try {
            fs.statSync(realPath);
            // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            state[target].deps.push(realPath);
          } catch (e) {
          }
        }
      }
      if (peekableLibs.length === 0) {
        const layers = layerize(state);
        if (parallel) {
          return resolve(layers);
        }
        const finalLibs = flattenize(layers);
        if (libs.length !== finalLibs.length) {
          console.log("Orphaned libraries found");
          const orphaned = libs.filter((lib: any) =>
            finalLibs.indexOf(lib) === -1
          );
          orphaned.forEach((lib: any) => {
            console.log(" *", lib);
          });

          /*
           * sign those anyways, just ensure to
           * sign them before the app executable
           */
          finalLibs.unshift(...orphaned);
        }
        return resolve(finalLibs);
      }
      peek();
    };
    peek();
  });
}
