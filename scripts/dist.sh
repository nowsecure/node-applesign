#!/bin/sh
# Build a single executable application (SEA) for the host platform.
# Needs node >= 25.5 (--build-sea) from nodejs.org, not a shared build.
set -e

V=$(node -p 'require("./package.json").version')
OUT=applesign-$V-$(node -p 'process.platform + "-" + process.arch')
SEA=$PWD/dist/sea

npm run build
node_modules/.bin/esbuild dist/bin/applesign.js --bundle --platform=node \
  --format=cjs --outfile="$SEA/applesign.cjs"
cat > "$SEA/sea.json" <<EOF
{
  "main": "$SEA/applesign.cjs",
  "output": "$PWD/$OUT",
  "disableExperimentalSEAWarning": true
}
EOF
node --build-sea "$SEA/sea.json"
if [ "$(uname)" = Darwin ]; then
  codesign --sign - -f "$OUT"
fi
test "$(./"$OUT" --version)" = "$V"
rm -f "$OUT.zip"
zip -9 "$OUT.zip" "$OUT"
