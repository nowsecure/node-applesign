declare module 'colors';
declare module '*.json';
// Node built-in modules
declare module 'fs';
declare module 'path';
// Node.js process and buffer globals
declare namespace NodeJS {
  interface ProcessEnv { [key: string]: string | undefined; }
  interface Process {
    argv: string[];
    env: ProcessEnv;
    exitCode?: number;
    /**
     * Exit the process with the given code.
     */
    exit(code?: number): void;
  }
}
declare var process: NodeJS.Process;

// Minimal Buffer API
declare class Buffer {
  static alloc(size: number): Buffer;
  static concat(buffers: Buffer[]): Buffer;
  /**
   * Create a Buffer from an array of numbers or string.
   */
  static from(data: number[] | string): Buffer;
  toString(encoding?: string): string;
  compare(other: Buffer): number;
  slice(start: number, end?: number): Buffer;
}
// Global require for CommonJS modules
declare function require(moduleName: string): any;

// Detailed child_process module types
declare module 'child_process' {
  export interface SpawnOptions {
    cwd?: string;
    env?: { [key: string]: string | undefined };
    stdio?: any;
  }
  export function spawn(command: string, args?: readonly string[], options?: SpawnOptions): any;
  export function execSync(command: string, options?: any): Buffer;
}
declare module 'events';
declare module 'os';
declare module 'util';
// Third-party modules without types
declare module 'fs-walk';
declare module 'simple-plist';
declare module 'plist';
declare module 'macho-is-encrypted';
declare module 'fatmacho';
declare module 'macho';
declare module 'uuid';
declare module 'fs-extra';
declare module 'which';
declare module 'rimraf';
declare module 'minimist';
// Ambient declarations for modules without TypeScript types
declare module 'fs-walk';
declare module 'simple-plist';
declare module 'plist';
declare module 'macho-is-encrypted';
declare module 'fatmacho';
declare module 'macho';
declare module 'uuid';
declare module 'fs-extra';
declare module 'which';
declare module 'rimraf';
declare module 'minimist';
