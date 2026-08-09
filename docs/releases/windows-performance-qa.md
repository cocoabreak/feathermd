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

To compare the saved result with a reviewed baseline, replace `baseline-name.json` with the selected baseline file:

```powershell
npm run --silent perf:report -- perf/artifacts/result.json perf/baselines/baseline-name.json perf/artifacts
```

The comparison is valid only when schema version, fixture version, environment ID, and build type match. Review current value, baseline value, absolute delta, and percentage delta in both `comparison.json` and `summary.md`.

## Isolated release timing and memory

Build the performance executable, then run the timing and memory suites separately:

```powershell
npm run perf:build-app

npm run --silent perf:verify-timings | Tee-Object -FilePath perf/artifacts/timings.json
if ($LASTEXITCODE -ne 0) { throw "performance timing suite failed" }

npm run --silent perf:verify-memory | Tee-Object -FilePath perf/artifacts/memory.json
if ($LASTEXITCODE -ne 0) { throw "performance memory suite failed" }
```

Confirm:

- Timing output contains five successful trials for cold startup, warm startup, plain first/repeat render, and rich first/repeat render, with individual values and medians.
- Memory output contains measured `empty`, `plain`, and `rich` entries with process counts, per-process values, and totals for working set and private memory.
- No timing or memory entry is `failed` or `not-measured`. Keep the failure reason when a suite fails; do not substitute a previous or zero value.
- The normal FeatherMD stores and trusted roots remain unchanged.
- Compare timing and memory only with a reviewed baseline from the same reference environment. Hosted-runner timing and memory are not release gates.

## Release record

Record the following without including user names, computer names, or local absolute paths:

- commit, app version, measurement date, and build type
- environment ID and the environment versions needed to interpret the result
- all trial values, medians, memory snapshots, and size summaries
- comparison status and any failure or `not-measured` reason
- reviewed `result.json`, `comparison.json`, `summary.md`, `timings.json`, and `memory.json` selected for the release

Raw files under `perf/artifacts/` are ignored by Git. Only reviewed baseline artifacts belong in `perf/baselines/`.
