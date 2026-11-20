# Running applesign on Linux

Without `codesign`, applesign signs with a `.p12` identity using the
[Procursus ldid](https://github.com/ProcursusTeam/ldid), which can sign with
real certificates (`saurik`'s ldid from distro packages and brew can't). Use
`v2.1.5-procursus7`: `procursus8` crashes when signing with a p12.

```sh
curl -Lo ldid https://github.com/ProcursusTeam/ldid/releases/download/v2.1.5-procursus7/ldid_linux_x86_64
chmod +x ldid && sudo mv ldid /usr/local/bin/ # or set APPLESIGN_LDID=/path/to/ldid
```

Export the identity and its private key from Keychain Access as a `.p12`, pass
it with `-i`, and its password in `APPLESIGN_P12_PASSWORD`:

```sh
APPLESIGN_P12_PASSWORD=secret applesign -i dev.p12 -m embedded.mobileprovision app.ipa
```

Any tool path can be overridden with an `APPLESIGN_` environment variable named
after it (`APPLESIGN_LDID`, `APPLESIGN_UNZIP`, `APPLESIGN_OPENSSL`..). The
mobileprovision is decoded with `openssl`. These flags need macOS tools: `-L`,
`-k`, `-v`, `-V`, `--lipo`, `-I` (unless `insert_dylib` is built) and
`.xcarchive` inputs.
