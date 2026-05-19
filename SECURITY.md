# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | ✅         |
| < 1.0   | ❌         |

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

We participate in responsible disclosure via [huntr.dev](https://huntr.dev).
You can also email us at **security@launchpromptly.com**.

We will:
- Acknowledge receipt within **48 hours**
- Provide an initial assessment within **5 business days**
- Keep you informed of progress
- Credit you in the release notes (unless you prefer anonymity)

## Scope

In scope:
- Prompt injection / jailbreak bypass via the SDK
- PII leakage through detection logic
- Authentication / authorization bypasses
- Cryptographic weaknesses
- Supply chain attacks (dependency confusion, typosquatting)

Out of scope:
- Denial of service via resource exhaustion
- Vulnerabilities in unpinned transitive dependencies without a PoC
- Social engineering

## Security Hardening

This SDK is designed with the following principles:
- No network calls in hot paths (all ML runs in the scanner sidecar)
- No storage of raw prompt text beyond the current request
- Ed25519-signed requests to the scanner service
- EXIF stripping for all image inputs
- Spotlighting for all PDF-extracted text

## Vulnerability Disclosure Process (VDP)

See our full VDP at: https://launchpromptly.com/security
