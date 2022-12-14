# Running applesign on Linux

It is possible to use applesign outside the Apple ecosystem, but this requires
the `rcodesign` tool to be installed:

```
$ cargo install apple-codesign
```

## Self Signed certificates

You can read more about rcodesign and certificates in:

* https://pyoxidizer.readthedocs.io/en/latest/apple_codesign_certificate_management.html#apple-codesign-certificate-management

```sh
$ rcodesign generate-self-signed-certificate --person-name pancake > a.pem
$ rcodesign analyze-certificate --pem-source a.pem
```

With this `a.pem` file you can now sign a binary like this:

```sh
$ rcodesign sign --pem-source a.pem --code-signature-flags runtime /path/to/binary
```

## Codesign Requirements

Apple requires a csreq to be signed inside the binary. this is an evaluated expression that defines
the conditions that must 

* https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/RequirementLang/RequirementLang.html
