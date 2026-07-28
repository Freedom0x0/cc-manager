# Changelog

## [Unreleased]

### v5 amendment — platform strategy

- **Platform**: Windows-first. v2.0 / v2.1 / v3.0 produce Windows installers (NSIS + Portable) only.
- **macOS**: Adaptation deferred to v4.0 (spec §15). Rationale: current dev machine + CI are Windows; macOS adaptation involves Apple signing / notarization / native menu — better isolated as a dedicated release.
- **Dev mode**: Cross-platform (`npm run dev` works on macOS). Only `npm run package` is Windows-only until v4.0.

### Notes

- electron-builder.json reserves `mac.target: ["dmg", "zip"]` for v4.0 enablement
- Test fixtures must use `os.tmpdir()` instead of hardcoded Windows paths (D10)
- macOS signing: NOT in v4.0 scope (D11) — Gatekeeper warning + right-click open expected
