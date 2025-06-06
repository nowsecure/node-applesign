import fs from "node:fs";
import * as bin from "./bin.js";

function resolveRpath(
  libs: string[],
  file: string,
  lib: string,
): string | null {
  const libName = lib.substring(6); /* chop @rpath */
  const rpaths = libs.filter((x: string) => {
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
  const rpath = slash !== -1 ? file.substring(0, slash) : "";
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
  const result: string[][] = [];
  let processing = false;
  do {
    result[currentLayer] = [];
    for (const lib of Object.keys(state)) {
      const deps = state[lib].deps;
      if (deps.length === 0) {
        if (state[lib].layer === -1) {
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

export default function depSolver(
  executable: string,
  libs: string[],
  parallel: boolean,
): Promise<any> {
  return new Promise((resolve, reject) => {
    if (libs.length === 0) {
      return resolve([]);
    }
    const state: Record<string, any> = {};
    const peekableLibs = libs.slice(0);
    const peek = () => {
      const target = peekableLibs.pop() as string;
      const macholibs = bin.enumerateLibraries(target);
      state[target] = {
        layer: -1,
        deps: [],
      };
      for (const r of macholibs) {
        if (!r.startsWith("/")) {
          const realPath = resolvePath(executable, target!, r, libs);
          if (realPath !== null) {
            try {
              fs.statSync(realPath);
              state[target].deps.push(realPath);
            } catch (e) {}
          }
        }
      }
      if (peekableLibs.length === 0) {
        const layers = layerize(state);
        if (parallel) {
          return resolve(layers);
        }
        const finalLibs: string[] = layers.flatMap((layer) => layer);

        if (libs.length !== finalLibs.length) {
          console.log("Orphaned libraries found");
          const orphaned = libs.filter(
            (lib: string) => finalLibs.indexOf(lib) === -1,
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
