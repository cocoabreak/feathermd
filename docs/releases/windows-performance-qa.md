# Windows release performance QA

Use this procedure on the Windows x64 reference environment before a release. It measures the production frontend and the isolated Tauri performance release build without changing the normal FeatherMD profile.

## Preconditions

- Use a clean, reviewed commit and record its SHA.
- Close normal FeatherMD and any existing FeatherMD Performance instance. The runner must refuse to continue if either instance is detected; do not terminate an existing instance from the runner.
- Keep the reference environment, WebView2 Runtime, Node.js, Rust toolchain, storage conditions, and background workload consistent with the selected baseline.
- Run the commands from `app/` in PowerShell.
- Do not use a developer's Markdown files. The commands use the fixed `plain-v1` and `rich-v1` fixtures.

## Build and size report

```powershell
npm ci
npm run perf:test
npm run perf:ci
```

Confirm:

- `perf/artifacts/result.json` records the expected commit with `source.dirty` set to `false`.
- `perf/artifacts/summary.md` contains the frontend size report.
- `perf/artifacts/comparison.json` is `not-requested` when no baseline was selected, or `comparable` when a baseline was selected. A `partial` or `incompatible` result is not a complete valid comparison; preserve and review its reasons.
- `build/.vite/perf-manifest.json` is absent after the final production rebuild.
- Missing distributions remain `not-measured`; they are never interpreted as zero bytes.

The first reviewed release baseline is `perf/baselines/windows-x64-i9-9900k-64gb-sata-2026-08.json`. A frontend-only `perf:ci` result has a different environment ID and build type, so do not compare it directly with a full release-QA baseline.

Build the normal release distributions before the isolated performance suites. Create the portable ZIP with the same file set as `.github/workflows/release.yml`.

```powershell
npm run tauri -- build
```

## Isolated release timing and memory

Build the performance executable, then run the timing and memory suites separately:

```powershell
npm run perf:build-app

npm run --silent perf:verify-timings | Tee-Object -FilePath perf/artifacts/timings.json
if ($LASTEXITCODE -ne 0) { throw "performance timing suite failed" }

npm run --silent perf:verify-memory | Tee-Object -FilePath perf/artifacts/memory.json
if ($LASTEXITCODE -ne 0) { throw "performance memory suite failed" }
```

Create `perf/artifacts/environment.json` with an `environment` object containing the selected reference environment's public fields and `buildType` set to `windows-x64-release-qa`. Do not include local paths, user names, or computer names. Then compose the full result, replacing distribution file names with the current release artifacts:

```powershell
npm run --silent perf:compose -- `
  perf/artifacts/result.json `
  perf/artifacts/timings.json `
  perf/artifacts/memory.json `
  perf/artifacts/environment.json `
  perf/artifacts/full `
  executable=src-tauri/target/release/feathermd.exe `
  msi=src-tauri/target/release/bundle/msi/FeatherMD_0.2.4_x64_en-US.msi `
  nsis=src-tauri/target/release/bundle/nsis/FeatherMD_0.2.4_x64-setup.exe `
  portableZip=perf/artifacts/FeatherMD_0.2.4_x64-portable.zip
```

To compare the composed result with the selected reviewed baseline:

```powershell
npm run --silent perf:report -- `
  perf/artifacts/full/result.json `
  perf/baselines/windows-x64-i9-9900k-64gb-sata-2026-08.json `
  perf/artifacts/comparison
```

Confirm:

- Timing output contains five successful trials for cold startup, warm startup, plain first/repeat render, and rich first/repeat render, with individual values and medians.
- Memory output contains measured `empty`, `plain`, and `rich` entries with process counts, per-process values, and totals for working set and private memory.
- No timing or memory entry is `failed` or `not-measured`. Keep the failure reason when a suite fails; do not substitute a previous or zero value.
- The normal FeatherMD stores and trusted roots remain unchanged.
- Compare timing and memory only with a reviewed baseline from the same reference environment. Hosted-runner timing and memory are not release gates.
- `perf:compose` must fail for a dirty build result, incomplete suite, invalid schema, unsafe public value, or unreadable distribution. Do not edit a failed result into a measured result.

## Release record

Record the following without including user names, computer names, or local absolute paths:

- commit, app version, measurement date, and build type
- environment ID and the environment versions needed to interpret the result
- all trial values, medians, memory snapshots, and size summaries
- comparison status and any failure or `not-measured` reason
- reviewed `result.json`, `comparison.json`, `summary.md`, `timings.json`, and `memory.json` selected for the release

Raw files under `perf/artifacts/` are ignored by Git. Only reviewed baseline artifacts belong in `perf/baselines/`.
