# Windows x64 release performance baseline (2026-08)

## Identity

- Commit: `a979f1a0c4cc3b2eae64ff128aa5fef25d4fa94f`
- FeatherMD: `0.2.4`
- Schema: `3`
- Fixture: `plain-v1+rich-v1`
- Environment: `windows-x64-i9-9900k-64gb-sata-2026-08`
- Build type: `windows-x64-release-qa`
- Machine-readable result: [windows-x64-i9-9900k-64gb-sata-2026-08.json](./windows-x64-i9-9900k-64gb-sata-2026-08.json)

## Reference environment

| Item              | Value                                                 |
| ----------------- | ----------------------------------------------------- |
| OS                | Windows 11 Pro 10.0.26200 (build 26200), x64          |
| CPU               | Intel Core i9-9900K @ 3.60 GHz, 16 logical processors |
| Physical memory   | 68,525,785,088 B (approximately 63.8 GiB)             |
| Workspace storage | SATA SSD                                              |
| WebView2 Runtime  | 151.0.4129.72                                         |
| Node.js           | v24.18.0                                              |
| Rust              | rustc 1.96.0                                          |
| Tauri CLI         | 2.11.4                                                |

The normal and performance FeatherMD instances were absent before each suite. The foreground QA run used the isolated performance identifier, AppData, WebView profile, and fixed fixtures defined by the spec. No user name, computer name, absolute path, or user document is recorded.

## Distribution and Vite sizes

| Artifact           |        Size |
| ------------------ | ----------: |
| Release executable | 8,572,416 B |
| MSI                | 5,881,856 B |
| NSIS installer     | 4,760,917 B |
| Portable ZIP       | 5,340,367 B |

| Vite scope           |         Raw |      Brotli |
| -------------------- | ----------: | ----------: |
| All output           | 8,734,210 B | 2,379,635 B |
| Initial JS/CSS graph |   200,914 B |    59,014 B |
| Lazy manifest graph  | 8,511,946 B | 2,303,996 B |
| KaTeX group          | 1,908,215 B | 1,054,897 B |
| Mermaid group        | 3,450,733 B |   823,514 B |
| Shiki group          | 2,393,647 B |   230,118 B |
| Font assets          | 1,072,948 B |   846,843 B |

The JSON result contains the type totals and the twenty largest files with their hashed names, raw sizes, and Brotli sizes.

## Timing reproducibility

Each timing entry contains five individual trials. Run 1 is the reviewed baseline; run 2 used the same commit, environment, build, and fixtures to check variation. Failed trials and outliers were not removed or replaced.

| Scenario            | Run 1 median | Run 2 median | Difference |
| ------------------- | -----------: | -----------: | ---------: |
| Cold startup        | 2,952.911 ms | 3,107.425 ms |     +5.23% |
| Warm startup        | 3,037.700 ms | 3,089.282 ms |     +1.70% |
| Plain first render  |   481.247 ms |   488.454 ms |     +1.50% |
| Plain repeat render |   466.422 ms |   464.895 ms |     -0.33% |
| Rich first render   |   701.892 ms |   694.401 ms |     -1.07% |
| Rich repeat render  |   580.431 ms |   581.937 ms |     +0.26% |

The first cold-start run included one 3,709.065 ms trial; it remains in the JSON and does not change the five-trial median. Startup comparison should allow for the observed 5.23% run-to-run median variation. Render medians varied by at most 1.50%.

## Memory reproducibility

Working set and private memory are separate process-tree totals and must not be added together. Both runs measured seven processes, including the Tauri process and its WebView2 descendants.

| Scenario | Working set run 1 | Working set run 2 | Private run 1 | Private run 2 |
| -------- | ----------------: | ----------------: | ------------: | ------------: |
| Empty    |         466.5 MiB |         461.6 MiB |     283.1 MiB |     280.1 MiB |
| Plain    |         473.4 MiB |         473.7 MiB |     290.4 MiB |     289.9 MiB |
| Rich     |         496.0 MiB |         499.6 MiB |     301.0 MiB |     305.0 MiB |

The largest run-to-run change was 1.05% for working set and 1.31% for private memory. Time and memory remain release-QA comparison metrics, not hosted-runner gates.

## Cost factors and decisions

| Rank | Finding                                                                                      | Effect     | Risk   | Cost       | Decision                                                                |
| ---: | -------------------------------------------------------------------------------------------- | ---------- | ------ | ---------- | ----------------------------------------------------------------------- |
|    1 | Startup is approximately 3 seconds and warm is not faster than cold                          | High       | Medium | Medium     | Track in [#35](https://github.com/cocoabreak/feathermd/issues/35)       |
|    2 | Fonts are 35.59% of total Brotli output; KaTeX ships TTF, WOFF, and WOFF2 assets             | High       | Medium | Low-Medium | Track in [#36](https://github.com/cocoabreak/feathermd/issues/36)       |
|    3 | Mermaid is the largest raw feature group at 3.45 MB but is already lazy                      | Medium     | High   | High       | Track in [#37](https://github.com/cocoabreak/feathermd/issues/37)       |
|    4 | Shiki is 2.39 MB raw but only 230 KB Brotli and its languages are already limited by ADR-008 | Low-Medium | High   | Medium     | Do not reduce supported languages without new usage and timing evidence |

Initial assets are only 2.30% of total raw output, so the current lazy-loading boundary is retained. CI size thresholds are intentionally handled in the separate [#38](https://github.com/cocoabreak/feathermd/issues/38) change.
