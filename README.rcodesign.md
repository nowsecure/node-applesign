# Using applesign with rcodesign

This document explains how to use applesign with
[rcodesign](https://github.com/indygreg/apple-platform-rs), a pure Rust
implementation of Apple code signing that works on Linux, Windows, and macOS.

## Overview

rcodesign is an open-source alternative to Apple's native `codesign` tool that
provides:

- Cross-platform code signing (Linux, Windows, macOS)
- Pure Rust implementation (no Apple dependencies)
- Support for Mach-O binaries, app bundles, installers, and disk images
- Notarization support

## Installation

### Install rcodesign

#### Option 1: Using GitHub Action (Recommended for CI)

```yaml
- name: Setup rcodesign
  uses: ./.github/actions/action-setup-rcodesign
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    version: "0.22.0"
```

#### Option 2: Manual Installation

```bash
# Download from releases
curl -L https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign/0.22.0/apple-codesign-0.22.0-x86_64-apple-darwin.tar.gz | tar xz
sudo mv rcodesign /usr/local/bin/

# Or install from source
cargo install --git https://github.com/indygreg/apple-platform-rs --bin rcodesign apple-codesign
```

### Install applesign

```bash
npm install -g applesign
```

## Usage

### Basic Usage with rcodesign

```bash
# Use rcodesign instead of Apple's codesign
applesign --codesign-tool=rcodesign -m embedded.mobileprovision target.ipa

# With explicit certificate file
applesign --codesign-tool=rcodesign -i /path/to/certificate.p12 -m embedded.mobileprovision target.ipa

# With PEM certificate
applesign --codesign-tool=rcodesign -i /path/to/certificate.pem -m embedded.mobileprovision target.ipa
```

### Certificate Formats

rcodesign supports multiple certificate formats:

#### P12 Certificate (Recommended)

```bash
applesign --codesign-tool=rcodesign -i /path/to/developer.p12 -m embedded.mobileprovision target.ipa
```

#### PEM Certificate

```bash
applesign --codesign-tool=rcodesign -i /path/to/developer.pem -m embedded.mobileprovision target.ipa
```

#### Certificate Fingerprint

```bash
applesign --codesign-tool=rcodesign -i "SHA256:ABC123..." -m embedded.mobileprovision target.ipa
```

### Advanced Options

```bash
# Clone entitlements from provisioning profile
applesign --codesign-tool=rcodesign -c -m embedded.mobileprovision target.ipa

# Custom entitlements file
applesign --codesign-tool=rcodesign -e custom.entitlements -m embedded.mobileprovision target.ipa

# Remove WatchApp and plugins
applesign --codesign-tool=rcodesign -w -p -m embedded.mobileprovision target.ipa

# Verify after signing
applesign --codesign-tool=rcodesign -v -m embedded.mobileprovision target.ipa

# Debug mode
applesign --codesign-tool=rcodesign -d debug.json -m embedded.mobileprovision target.ipa
```

## Certificate Preparation

### Converting from Apple Keychain to P12

```bash
# Export certificate from keychain
security find-certificate -c "iPhone Developer" -p > devcert.pem
security find-certificate -c "iPhone Developer" -c > devcert.key

# Convert to P12
openssl pkcs12 -export -inkey devcert.key -in devcert.pem -out developer.p12
```

### Converting from Apple Keychain to PEM

```bash
# Export certificate and key
security find-certificate -c "iPhone Developer" -p > certificate.pem
security find-certificate -c "iPhone Developer" -c > private-key.pem

# Combine into single PEM
cat certificate.pem private-key.pem > developer.pem
```

## Differences from Apple codesign

### Key Differences

1. **No Keychain Integration**: rcodesign doesn't use macOS keychain directly
2. **Cross-Platform**: Works on Linux and Windows, not just macOS
3. **Certificate Format**: Supports PEM and P12 files directly
4. **No Notarization Integration**: Separate notarization step required

### Limitations

- No automatic certificate discovery from keychain
- Must specify certificate file explicitly
- Some advanced codesign flags may not be supported
- Keychain-related options are ignored

## Troubleshooting

### Common Issues

#### "Certificate not found"

```bash
# Ensure certificate file exists and is readable
ls -la /path/to/certificate.p12

# Try with absolute path
applesign --codesign-tool=rcodesign -i /full/path/to/certificate.p12 -m embedded.mobileprovision target.ipa
```

#### "Invalid certificate format"

```bash
# Verify certificate format
file /path/to/certificate.p12
# Should show: data

# For PEM files
file /path/to/certificate.pem
# Should show: ASCII text
```

#### "rcodesign not found"

```bash
# Check if rcodesign is in PATH
which rcodesign

# Or use full path
applesign --codesign-tool=/usr/local/bin/rcodesign -m embedded.mobileprovision target.ipa
```

### Debug Mode

Enable debug mode to see detailed rcodesign commands:

```bash
applesign --codesign-tool=rcodesign -d debug.json -m embedded.mobileprovision target.ipa
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Sign with rcodesign
on: [push]

jobs:
  sign:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: "18"

      - name: Install applesign
        run: npm install -g applesign

      - name: Setup rcodesign
        uses: ./.github/actions/action-setup-rcodesign
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - name: Sign IPA
        env:
          CERTIFICATE: ${{ secrets.DEVELOPER_CERTIFICATE }}
        run: |
          echo "$CERTIFICATE" | base64 -d > developer.p12
          applesign --codesign-tool=rcodesign -i developer.p12 -m embedded.mobileprovision target.ipa
```

### Docker Example

```dockerfile
FROM ubuntu:22.04

# Install dependencies
RUN apt-get update && apt-get install -y \
    nodejs \
    npm \
    curl \
    unzip

# Install rcodesign
RUN curl -L https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign/0.22.0/apple-codesign-0.22.0-x86_64-unknown-linux-musl.tar.gz | tar xz \
    && mv rcodesign /usr/local/bin/

# Install applesign
RUN npm install -g applesign

WORKDIR /app
COPY . .

# Sign application
CMD applesign --codesign-tool=rcodesign -i certificate.p12 -m embedded.mobileprovision app.ipa
```

## Migration from Apple codesign

### Before (Apple codesign)

```bash
applesign -i "iPhone Developer: John Doe (ABC123DEF)" -m embedded.mobileprovision target.ipa
```

### After (rcodesign)

```bash
# Step 1: Export certificate to P12 (one-time)
security find-certificate -c "iPhone Developer: John Doe (ABC123DEF)" -p > cert.pem
security find-certificate -c "iPhone Developer: John Doe (ABC123DEF)" -c > key.pem
openssl pkcs12 -export -inkey key.pem -in cert.pem -out developer.p12

# Step 2: Use with rcodesign
applesign --codesign-tool=rcodesign -i developer.p12 -m embedded.mobileprovision target.ipa
```

## Additional Resources

- [rcodesign Documentation](https://gregoryszorc.com/docs/apple-codesign/main/)
- [apple-platform-rs GitHub](https://github.com/indygreg/apple-platform-rs)
- [applesign GitHub](https://github.com/nowsecure/node-applesign)
- [Apple Code Signing Guide](https://developer.apple.com/support/code-signing/)

## Contributing

To contribute to rcodesign integration in applesign:

1. Test with different certificate formats
2. Report issues with rcodesign compatibility
3. Submit pull requests for additional rcodesign features
4. Update documentation for new use cases

## License

This integration follows the same MIT license as applesign. rcodesign is
licensed under MPL-2.0.
