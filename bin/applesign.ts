#!/usr/bin/env node
import fs from "fs";
import pkgVersion from "../lib/version.js";
import { join } from "path";
import * as tools from "../lib/tools.js";
import * as config from "../lib/config.js";
import colors from "colors";
import Applesign from "../index.js";

colors.setTheme({
  error: "red",
  msg: "yellow",
  warning: "green",
});

// Removed unused SpawnOptions import (no longer required)
/**
 * Main entry point for applesign CLI.
 * @param argv Command-line arguments (process.argv)
 */
async function main(argv: string[]): Promise<void> {
  const conf = config.parse(argv);
  const options = config.compile(conf);
  const as = new Applesign(options);
  // initialize
  if (conf.identities || conf.L) {
    const ids = await as.getIdentities();
    ids.forEach((id: any) => {
      console.log(id.hash, id.name);
    });
  } else if (conf.version) {
    console.log(pkgVersion);
  } else if (conf.h || conf.help) {
    console.error(config.helpMessage);
  } else if (conf._.length === 0) {
    console.error(config.shortHelpMessage);
  } else {
    const singleMode = Boolean(conf.s || conf.single);
    const target = getTargetMethod(options.file, singleMode);
    if (!target) {
      throw new Error("Cannot open file");
    }
    // Subscribe to signing events
    as.events
      .on("message", (msg: string) => console.log(colors.msg(msg)))
      .on(
        "warning",
        (msg: string) => console.error(colors.warning("warning"), msg),
      )
      .on("error", (msg: string) => console.error(colors.msg(msg)));
    if (!options.file) {
      throw new Error("No file provided");
    }
    try {
      await as[target](options.file);
      const outfile = as.config.outfile || options.file;
      console.log(`Target is now signed: ${outfile}`);
    } catch (err) {
      process.exitCode = 1;
      console.error(err);
    } finally {
      if (!options.noclean) {
        await as.cleanupTmp();
        await as.cleanup();
      }
    }
    if (as.config.debug) {
      const data = JSON.stringify(as.debugObject);
      fs.writeFileSync(as.config.debug, data);
      console.error(`Debug: json file saved: ${as.config.debug}`);
    }
  }
}

// Invoke main with proper typing
main(process.argv)
  .catch((err: Error) => {
    console.error(err);
    process.exitCode = 1;
  });

/**
 * Determine which signing method to use based on file type and mode.
 * @param file Path to target file or directory
 * @param single Whether to sign a single file instead of an IPA
 * @returns Signing method name or undefined if unsupported
 */
type TargetMethod = "signAppDirectory" | "signFile" | "signIPA";
function getTargetMethod(
  file: string | undefined,
  single: boolean,
): TargetMethod | undefined {
  if (!file) return undefined;
  try {
    return tools.isDirectory(file)
      ? "signAppDirectory"
      : single
      ? "signFile"
      : "signIPA";
  } catch {
    return undefined;
  }
}
