use super::has_markdown_extension;
use crate::commands::file::{normalize_path_for_frontend, read_file_inner, AllowedRoots};
use ignore::WalkBuilder;
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use tauri::State;

#[derive(Serialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub truncated: bool,
    pub cancelled: bool,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub file_path: String,
    pub matches: Vec<SearchMatch>,
}

#[derive(Debug, Serialize)]
pub struct SearchMatch {
    pub(crate) line_number: usize,
    pub(crate) line_text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    root: String,
    query: String,
    is_regex: bool,
    case_sensitive: bool,
    show_hidden_files: bool,
    respect_gitignore: bool,
}

#[derive(Clone)]
pub struct SearchState(Arc<AtomicU64>);

impl SearchState {
    pub fn new() -> Self {
        Self(Arc::new(AtomicU64::new(0)))
    }

    pub(crate) fn begin(&self, request_id: u64) {
        self.0.fetch_max(request_id, Ordering::SeqCst);
    }

    pub(crate) fn is_current(&self, request_id: u64) -> bool {
        self.0.load(Ordering::SeqCst) == request_id
    }
}

const MAX_LINE_PREVIEW_CHARS: usize = 100;
const MAX_SCAN_ENTRIES: usize = 10_000;
const MAX_SEARCH_RESULTS: usize = 1_000;
const MAX_MATCHES_PER_FILE: usize = 1_000;
const MAX_TOTAL_MATCHES: usize = 5_000;

#[tauri::command]
pub async fn search_in_directory(
    request_id: u64,
    options: SearchOptions,
    roots: State<'_, AllowedRoots>,
    searches: State<'_, SearchState>,
) -> Result<SearchResponse, String> {
    let roots = roots.inner().clone();
    let searches = searches.inner().clone();
    searches.begin(request_id);

    tauri::async_runtime::spawn_blocking(move || {
        let canonical_root = roots.resolve(&options.root)?;
        if options.query.is_empty() || !searches.is_current(request_id) {
            return Ok(SearchResponse {
                results: Vec::new(),
                truncated: false,
                cancelled: !searches.is_current(request_id),
            });
        }

        let regex_pattern = if options.is_regex {
            options.query
        } else {
            regex::escape(&options.query)
        };
        let regex = RegexBuilder::new(&regex_pattern)
            .case_insensitive(!options.case_sensitive)
            .build()
            .map_err(|error| error.to_string())?;

        let (results, truncated, cancelled) = search_markdown_files(
            &canonical_root.to_string_lossy(),
            &regex,
            options.show_hidden_files,
            options.respect_gitignore,
            &roots,
            || !searches.is_current(request_id),
        );
        Ok(SearchResponse {
            results,
            truncated,
            cancelled,
        })
    })
    .await
    .map_err(|error| format!("検索処理に失敗しました: {error}"))?
}

fn search_markdown_files(
    root: &str,
    regex: &regex::Regex,
    show_hidden_files: bool,
    respect_gitignore: bool,
    roots: &AllowedRoots,
    is_cancelled: impl Fn() -> bool,
) -> (Vec<SearchResult>, bool, bool) {
    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(!show_hidden_files)
        .git_ignore(respect_gitignore)
        .git_global(respect_gitignore)
        .git_exclude(respect_gitignore)
        .ignore(respect_gitignore)
        .parents(respect_gitignore);

    let mut results = Vec::new();
    let mut total_matches = 0usize;
    let mut truncated = false;
    for (entry_index, entry) in builder.build().flatten().enumerate() {
        if is_cancelled() {
            return (results, truncated, true);
        }
        if entry_index >= MAX_SCAN_ENTRIES || results.len() >= MAX_SEARCH_RESULTS {
            truncated = true;
            break;
        }
        let path = entry.path();
        if !path.is_file() || !has_markdown_extension(path) {
            continue;
        }
        if roots.resolve(&path.to_string_lossy()).is_err() {
            continue;
        }

        let Ok(raw) = read_file_inner(roots, &path.to_string_lossy()) else {
            continue;
        };
        let mut matches = Vec::new();
        for (line_index, line) in raw.lines().enumerate() {
            if regex.is_match(line) {
                matches.push(SearchMatch {
                    line_number: line_index + 1,
                    line_text: truncate_preview(line.trim()),
                });
                total_matches += 1;
                if matches.len() >= MAX_MATCHES_PER_FILE || total_matches >= MAX_TOTAL_MATCHES {
                    truncated = true;
                    break;
                }
            }
        }
        if !matches.is_empty() {
            results.push(SearchResult {
                file_path: normalize_path_for_frontend(path),
                matches,
            });
        }
        if total_matches >= MAX_TOTAL_MATCHES {
            break;
        }
    }

    results.sort_by(|left, right| left.file_path.cmp(&right.file_path));
    (results, truncated, false)
}

fn truncate_preview(trimmed: &str) -> String {
    if trimmed.chars().count() > MAX_LINE_PREVIEW_CHARS {
        let truncated: String = trimmed.chars().take(MAX_LINE_PREVIEW_CHARS).collect();
        format!("{}...", truncated)
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn regex(pattern: &str) -> regex::Regex {
        RegexBuilder::new(pattern).build().unwrap()
    }

    #[test]
    fn searches_only_markdown_files() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "hello world\nsecond").unwrap();
        fs::write(dir.path().join("b.markdown"), "hello there").unwrap();
        fs::write(dir.path().join("c.txt"), "hello ignored").unwrap();

        let roots = AllowedRoots::new();
        roots.register_input_paths(&[dir.path().to_path_buf()]);
        let (results, truncated, cancelled) = search_markdown_files(
            &dir.path().to_string_lossy(),
            &regex("(?i)hello"),
            false,
            false,
            &roots,
            || false,
        );
        let files: Vec<String> = results
            .iter()
            .map(|result| {
                result
                    .file_path
                    .rsplit(['/', '\\'])
                    .next()
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert!(files.contains(&"a.md".to_string()));
        assert!(files.contains(&"b.markdown".to_string()));
        assert!(!files.iter().any(|file| file == "c.txt"));
        assert!(!truncated);
        assert!(!cancelled);
    }

    #[test]
    fn reports_line_numbers_starting_at_one() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "first\ntarget\nthird").unwrap();
        let roots = AllowedRoots::new();
        roots.register_input_paths(&[dir.path().to_path_buf()]);
        let (results, _, _) = search_markdown_files(
            &dir.path().to_string_lossy(),
            &regex("target"),
            false,
            false,
            &roots,
            || false,
        );
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].matches[0].line_number, 2);
    }

    #[test]
    fn stops_when_cancelled() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "target").unwrap();
        let roots = AllowedRoots::new();
        roots.register_input_paths(&[dir.path().to_path_buf()]);
        let (results, _, cancelled) = search_markdown_files(
            &dir.path().to_string_lossy(),
            &regex("target"),
            false,
            false,
            &roots,
            || true,
        );
        assert!(results.is_empty());
        assert!(cancelled);
    }

    #[test]
    fn truncate_preview_limits_long_lines() {
        let long = "あ".repeat(MAX_LINE_PREVIEW_CHARS + 50);
        let output = truncate_preview(&long);
        assert!(output.ends_with("..."));
        assert_eq!(output.chars().count(), MAX_LINE_PREVIEW_CHARS + 3);
        assert_eq!(truncate_preview("short"), "short");
    }

    #[test]
    fn search_relies_on_allowed_roots_guard() {
        let roots = AllowedRoots::new();
        let outside = tempfile::tempdir().unwrap();
        assert!(roots.resolve(&outside.path().to_string_lossy()).is_err());
    }
}
