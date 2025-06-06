#!/bin/sh

if [ "$1" = "-h" ]; then
  echo "Usage: dist.sh [linux macos win alpine]"
  echo "See https://github.com/zeit/pkg-fetch/releases for a complete list"
  echo "Generate a distribution zip for the given targets"
  exit 0
fi

PKG=node_modules/.bin/pkg
if [ ! -x $PKG ]; then
  npm i
  exec $@
fi

V=$(node -e 'console.log(require("./package.json").version)')

echo "Version: $V"

# $PKG bin/applesign.js || exit 1

if [ -z "$*" ]; then
  TARGETS=macos
else
  TARGETS=$*
fi
# TARGETS=linux macos win.exe
echo "Targets: $TARGETS"

for a in ${TARGETS}; do
  echo "Packaging for $a ..."
  if [ "$a" = "win" ]; then
    E=$V.exe
  else
    E=$V
  fi
  $PKG -t node10-$a-x64 -o applesign-$E bin/applesign.js
  rm -f applesign-$V-$a.zip
  echo "Compressing applesign-$V-$a.zip"
  zip -9 applesign-$V-$a.zip applesign-$E
done

echo Done
