# Rust dependency evaluation (#48)

Date: 2026-09-23

## Decision

Remove the direct `time <0.3.52` workaround and resolve `time 0.3.55` with
`cookie 0.18.2`. FeatherMD does not call the time crate directly. Cookie 0.18.2
stopped using its internal APIs; the lockfile also updates time-macros from
0.2.30 to 0.2.32. No unrelated dependency is updated.

Keep the direct base64 dependency at 0.22.1 for this release. Its existing
`general_purpose::STANDARD` image encoder has no demonstrated speed or binary
size benefit from 0.23.1. SIMD engine adoption is a separate future optimization,
not a prerequisite for releasing this dependency maintenance work.

## base64 comparison

Windows x64, Rust 1.98.1, release settings matching FeatherMD (`opt-level=z`,
LTO, one codegen unit, abort panic, stripped symbols). A standalone harness
compiled both exact versions and compared output for 4,101 input lengths:
0 through 4,095, 65,535/65,536/65,537, 1 MiB and 10 MiB. Inputs use a deterministic
byte pattern covering all byte values. Encoded strings matched byte for byte;
decoding the new output with the old version also recovered every input.

Seven trials per size alternated version order. Each trial encoded at least
128 MiB with fresh output allocations; the table reports median throughput.
Other QA work was running, so these are indicative measurements, not a stable
performance baseline or a claim of a statistically significant regression.

| Input | 0.22.1 MiB/s | 0.23.1 MiB/s |
| --- | ---: | ---: |
| 1 KiB | 1332.38 | 1314.90 |
| 64 KiB | 1465.08 | 1437.80 |
| 1 MiB | 1114.29 | 1037.37 |
| 10 MiB | 1065.91 | 1041.02 |

Separate executables reading a file and printing STANDARD-encoded output were
130,048 bytes with either version. This measures the isolated encoder harness,
not the complete app binary. No application-wide base64 size claim is made.

0.23.1 defaults to `std` plus `simd-unsafe`; STANDARD remains the scalar
GeneralPurpose engine. The optional Simd engine detects AVX2 on x86_64 or NEON
on aarch64 at runtime with scalar fallback. This evaluation does not adopt that
engine or add a CPU requirement. Version 0.23.1 requires Rust 1.71; time 0.3.55
requires Rust 1.88, below the tested compiler. Existing transitive base64 0.23.1
through ureq/plist remains; retaining the direct 0.22 dependency does not remove
SIMD features or unsafe code from the whole dependency graph.

## RustSec and platform impact

The initial Cargo audit reports zero vulnerabilities and seven informational
warnings. No advisory is ignored:

- `proc-macro-error 1.0.4` (RUSTSEC-2024-0370) comes through glib-macros and
  Tauri's Linux GTK3/WebKitGTK stack. Its replacement requires upstream migration.
- `glib 0.18.5` (RUSTSEC-2024-0429) comes through the same Linux stack. The fixed
  API line is 0.20+, incompatible with the current GTK3 dependency constraints.
- Five `unic-* 0.9.0` maintenance warnings (RUSTSEC-2025-0075, -0080, -0081,
  -0098, -0100) come through urlpattern and tauri-utils. Replacement with a
  maintained Unicode implementation requires upstream changes.

`cargo tree --target all` confirms cookie and plist consume time on the
supported dependency graph. No platform-specific application code or feature
selection changes. Linux and macOS execution cannot be verified locally on
Windows; their release builds remain required before publication. Cross-platform
build success is not a substitute for interactive runtime QA on those systems.

## Validation

- Rust formatting and Clippy (`--all-targets -- -D warnings`) passed.
- All 153 Rust library tests passed with cookie 0.18.2 and time 0.3.55.
- Windows release build passed; frontend production build and production-hook
  exclusion check passed. MSVC emits an informational linker-output warning when
  producing the DLL import library; Clippy reports no code warnings.
- Frontend formatting, ESLint, and svelte-check passed (zero errors/warnings).
  All 402 frontend tests and 106 performance-tool tests passed.
- All seven isolated Windows WebView2 smoke scenarios passed, including Markdown,
  valid/invalid Mermaid, ZIP, the 5 MiB boundary, update notification, and reload
  restoration of tabs/search/scroll.
- Final Cargo audit: zero vulnerabilities, the same seven upstream warnings.
  npm audit: three low findings, no moderate/high/critical findings. These come
  from SvelteKit development tooling in this static application.

## Sources

- [cookie 0.18.2 changelog](https://docs.rs/crate/cookie/0.18.2/source/CHANGELOG.md)
- [base64 release notes](https://github.com/marshallpierce/rust-base64/blob/master/RELEASE-NOTES.md)
- Published crate manifests and source for base64 0.22.1/0.23.1 and time 0.3.55
- Cargo.lock, cargo tree, and cargo-audit's RustSec database snapshot
