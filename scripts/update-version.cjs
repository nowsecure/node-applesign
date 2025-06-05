const fs = require("fs");
const path = require("path");

const pkg = require("../package.json");
const versionFile = path.join(__dirname, "../lib/version.ts");

fs.writeFileSync(
  versionFile,
  `const version = "${pkg.version}";\nexport default version;\n`,
);
console.log(`✅ Updated version.ts to ${pkg.version}`);
