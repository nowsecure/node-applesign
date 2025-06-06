declare module "colors";
declare module "simple-plist";
declare module "plist";
declare module "macho-entitlements";
declare module "macho-is-encrypted";
declare module "fatmacho";
declare module "macho";
declare module "which";
declare module "rimraf";

declare module "fs-walk" {
  function walkSync(
    appdir,
    cb: (basedir: string, filename: string, stat: number) => void,
  );
}
