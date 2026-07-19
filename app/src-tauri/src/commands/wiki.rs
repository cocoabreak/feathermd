use super::file::{normalize_path_for_frontend, AllowedRoots};
use super::MARKDOWN_EXTENSIONS;
use ignore::WalkBuilder;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::State;

const MAX_WIKI_SCAN_ENTRIES: usize = 10_000;
const MAX_WIKI_TARGETS: usize = 1_000;
pub(crate) const MAX_WIKI_TARGET_BYTES: usize = 1_024;
const MAX_WIKI_TARGET_TOTAL_BYTES: usize = 64 * 1_024;
const MAX_WIKI_CANDIDATE_INSPECTIONS: usize = 1_000_000;
const WIKI_INDEX_TTL: Duration = Duration::from_secs(2);
const MAX_CACHED_WIKI_INDEXES: usize = 8;

struct WikiIndexEntry {
    created_at: Instant,
    files: Vec<String>,
}

pub struct WikiIndexState(Mutex<HashMap<(String, bool), WikiIndexEntry>>);

impl WikiIndexState {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }

    pub(crate) fn get_or_build(
        &self,
        scan_root: &Path,
        respect_gitignore: bool,
        roots: &AllowedRoots,
    ) -> Result<Vec<String>, String> {
        let key = (
            normalize_path_for_frontend(scan_root).to_lowercase(),
            respect_gitignore,
        );
        let now = Instant::now();
        {
            let mut indexes = self
                .0
                .lock()
                .map_err(|_| "Wikiインデックスのロックに失敗しました".to_string())?;
            indexes.retain(|_, entry| now.duration_since(entry.created_at) < WIKI_INDEX_TTL);
            if let Some(entry) = indexes.get(&key) {
                return Ok(entry.files.clone());
            }
        }

        // ファイル走査中はcache mutexを保持せず、別ルートの解決を待たせない。
        let files = collect_markdown_files(scan_root, respect_gitignore, Some(roots));
        let mut indexes = self
            .0
            .lock()
            .map_err(|_| "Wikiインデックスのロックに失敗しました".to_string())?;
        if indexes.len() >= MAX_CACHED_WIKI_INDEXES {
            if let Some(oldest) = indexes
                .iter()
                .min_by_key(|(_, entry)| entry.created_at)
                .map(|(key, _)| key.clone())
            {
                indexes.remove(&oldest);
            }
        }
        indexes.insert(
            key,
            WikiIndexEntry {
                created_at: now,
                files: files.clone(),
            },
        );
        Ok(files)
    }
}

/// 小文字化済みのパス文字列がMarkdown拡張子（.md / .markdown）で終わるか判定する。
/// Wikiリンク解決はPath::extensionではなく正規化済みパス文字列の末尾一致で扱うため、
/// 共有のMARKDOWN_EXTENSIONSからドット付きサフィックスを導出して使う。
fn ends_with_markdown_ext(lower: &str) -> bool {
    MARKDOWN_EXTENSIONS
        .iter()
        .any(|ext| lower.ends_with(&format!(".{ext}")))
}

/// `[[ページ名]]` のリスト（targets）をワークスペース内のファイルパスへ一括解決する。
/// 探索起点はroot（未指定ならcurrent_fileの親フォルダ）で、AllowedRootsの信頼範囲内に限る。
/// 戻り値はページ名→解決パス（見つからなければNone）のマップ。
#[tauri::command(async)]
pub fn resolve_wiki_links(
    current_file: String,
    targets: Vec<String>,
    root: Option<String>,
    respect_gitignore: bool,
    state: State<'_, AllowedRoots>,
    indexes: State<'_, WikiIndexState>,
) -> Result<HashMap<String, Option<String>>, String> {
    let targets = validate_targets(targets)?;
    let current_file = current_file.replace('\\', "/");
    let scan_root = match &root {
        Some(r) => r.replace('\\', "/"),
        None => Path::new(&current_file)
            .parent()
            .ok_or_else(|| "現在ファイルの親フォルダーを特定できません".to_string())?
            .to_string_lossy()
            .replace('\\', "/"),
    };

    // canonicalize済みの起点を走査し、各候補もAllowedRootsで再検証する。
    let canonical_root = state.resolve(&scan_root)?;

    let files = indexes.get_or_build(&canonical_root, respect_gitignore, &state)?;
    let current_dir = parent_components_lower(&current_file);

    resolve_targets(targets, &files, &current_dir)
}

pub(crate) fn validate_targets(targets: Vec<String>) -> Result<Vec<String>, String> {
    if targets.len() > MAX_WIKI_TARGETS {
        return Err(format!(
            "Wikiリンクの解決対象は{}件以下にしてください",
            MAX_WIKI_TARGETS
        ));
    }
    let total_bytes = targets.iter().try_fold(0usize, |total, target| {
        if target.len() > MAX_WIKI_TARGET_BYTES {
            return Err(format!(
                "Wikiリンク名は{}バイト以下にしてください",
                MAX_WIKI_TARGET_BYTES
            ));
        }
        total
            .checked_add(target.len())
            .ok_or_else(|| "Wikiリンク名の合計が大きすぎます".to_string())
    })?;
    if total_bytes > MAX_WIKI_TARGET_TOTAL_BYTES {
        return Err("Wikiリンク名の合計は64KiB以下にしてください".to_string());
    }
    Ok(targets)
}

/// 探索起点以下の全Markdownファイルのパス（スラッシュ正規化済み）を収集する
fn collect_markdown_files(
    scan_root: &Path,
    respect_gitignore: bool,
    roots: Option<&AllowedRoots>,
) -> Vec<String> {
    let mut builder = WalkBuilder::new(scan_root);
    builder
        // 隠しファイルの扱いはツリーと同じく除外しない
        .hidden(false)
        .git_ignore(respect_gitignore)
        .git_global(respect_gitignore)
        .git_exclude(respect_gitignore)
        .ignore(respect_gitignore)
        .parents(respect_gitignore);

    let mut files = Vec::new();
    for entry in builder.build().flatten().take(MAX_WIKI_SCAN_ENTRIES) {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        if roots.is_some_and(|r| r.resolve(&entry.path().to_string_lossy()).is_err()) {
            continue;
        }
        let path = normalize_path_for_frontend(entry.path());
        let lower = path.to_lowercase();
        if ends_with_markdown_ext(&lower) {
            files.push(path);
        }
    }
    files
}

/// パスの親フォルダをコンポーネント列（小文字）にする。近接ランキングの基準に使う
pub(crate) fn parent_components_lower(path: &str) -> Vec<String> {
    let lower = path.to_lowercase();
    let mut parts: Vec<String> = lower
        .split('/')
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();
    parts.pop(); // ファイル名を除く
    parts
}

/// 1つのページ名を候補ファイル群から解決する。
/// マッチング（大文字小文字無視）:
/// - `/` なし: ファイル名のstem一致。拡張子付き指定はファイル名全体一致
/// - `/` あり: コンポーネント境界でのパス末尾一致
///
/// 複数マッチ時は「現在ファイルに近い順→浅い順→パス昇順」で決定的に1件を返す
#[cfg(test)]
pub(crate) fn resolve_one(
    target: &str,
    files: &[String],
    current_dir: &[String],
) -> Option<String> {
    let mut inspections = 0;
    WikiFileIndex::new(files)
        .resolve_target(
            target,
            current_dir,
            &mut inspections,
            MAX_WIKI_CANDIDATE_INSPECTIONS,
        )
        .ok()
        .flatten()
}

struct IndexedWikiFile {
    path: String,
    lower: String,
    parent_components: Vec<String>,
    depth: usize,
}

pub(crate) struct WikiFileIndex {
    files: Vec<IndexedWikiFile>,
    by_file_name: HashMap<String, Vec<usize>>,
}

impl WikiFileIndex {
    pub(crate) fn new(files: &[String]) -> Self {
        let mut indexed = Vec::with_capacity(files.len());
        let mut by_file_name: HashMap<String, Vec<usize>> = HashMap::new();
        for path in files {
            let lower = path.to_lowercase();
            let parent_components = parent_components_lower(&lower);
            let depth = parent_components.len();
            let index = indexed.len();
            if let Some(file_name) = lower.rsplit('/').next() {
                by_file_name
                    .entry(file_name.to_string())
                    .or_default()
                    .push(index);
            }
            indexed.push(IndexedWikiFile {
                path: path.clone(),
                lower,
                parent_components,
                depth,
            });
        }
        Self {
            files: indexed,
            by_file_name,
        }
    }

    pub(crate) fn resolve_target(
        &self,
        target: &str,
        current_dir: &[String],
        inspections: &mut usize,
        inspection_limit: usize,
    ) -> Result<Option<String>, String> {
        let normalized = target.replace('\\', "/");
        let lower = normalized.trim().trim_matches('/').to_lowercase();
        if lower.is_empty() {
            return Ok(None);
        }

        let has_ext = ends_with_markdown_ext(&lower);
        let suffixes: Vec<String> = if has_ext {
            vec![lower.clone()]
        } else {
            MARKDOWN_EXTENSIONS
                .iter()
                .map(|ext| format!("{lower}.{ext}"))
                .collect()
        };
        let has_path = lower.contains('/');
        let mut candidate_indexes = HashSet::new();
        for suffix in &suffixes {
            if let Some(file_name) = suffix.rsplit('/').next() {
                if let Some(indexes) = self.by_file_name.get(file_name) {
                    candidate_indexes.extend(indexes.iter().copied());
                }
            }
        }

        let mut best: Option<&IndexedWikiFile> = None;
        let mut best_key: Option<(i64, usize, &str)> = None;
        for index in candidate_indexes {
            *inspections = inspections
                .checked_add(1)
                .ok_or_else(|| "Wikiリンク解決の処理量が大きすぎます".to_string())?;
            if *inspections > inspection_limit {
                return Err("Wikiリンク解決の処理量が大きすぎます".to_string());
            }
            let file = &self.files[index];
            let matches = suffixes.iter().any(|suffix| {
                if has_path {
                    file.lower
                        .strip_suffix(suffix)
                        .is_some_and(|prefix| prefix.is_empty() || prefix.ends_with('/'))
                } else {
                    file.lower
                        .rsplit('/')
                        .next()
                        .is_some_and(|name| name == suffix.as_str())
                }
            });
            if !matches {
                continue;
            }
            let common = file
                .parent_components
                .iter()
                .zip(current_dir)
                .take_while(|(left, right)| left == right)
                .count() as i64;
            let key = (-common, file.depth, file.lower.as_str());
            if best_key.is_none_or(|current| key < current) {
                best = Some(file);
                best_key = Some(key);
            }
        }
        Ok(best.map(|file| file.path.clone()))
    }
}

pub(crate) fn resolve_targets(
    targets: Vec<String>,
    files: &[String],
    current_dir: &[String],
) -> Result<HashMap<String, Option<String>>, String> {
    let index = WikiFileIndex::new(files);
    let mut inspections = 0usize;
    let mut result = HashMap::new();
    let mut resolved_by_normalized_target: HashMap<String, Option<String>> = HashMap::new();
    for target in targets {
        let normalized_target = target
            .replace('\\', "/")
            .trim()
            .trim_matches('/')
            .to_lowercase();
        if let Some(resolved) = resolved_by_normalized_target.get(&normalized_target) {
            result.insert(target, resolved.clone());
            continue;
        }
        let resolved = index.resolve_target(
            &target,
            current_dir,
            &mut inspections,
            MAX_WIKI_CANDIDATE_INSPECTIONS,
        )?;
        resolved_by_normalized_target.insert(normalized_target, resolved.clone());
        result.insert(target, resolved);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn resolve(target: &str, files: &[&str], current: &str) -> Option<String> {
        let files: Vec<String> = files.iter().map(|s| s.to_string()).collect();
        resolve_one(target, &files, &parent_components_lower(current))
    }

    #[test]
    fn resolves_by_stem_case_insensitive() {
        let files = ["D:/notes/Setup.md", "D:/notes/other.md"];
        assert_eq!(
            resolve("setup", &files, "D:/notes/index.md"),
            Some("D:/notes/Setup.md".to_string())
        );
    }

    #[test]
    fn resolves_with_explicit_extension() {
        let files = ["D:/notes/setup.md", "D:/notes/setup.markdown"];
        assert_eq!(
            resolve("setup.markdown", &files, "D:/notes/index.md"),
            Some("D:/notes/setup.markdown".to_string())
        );
    }

    #[test]
    fn does_not_match_partial_file_name() {
        let files = ["D:/notes/my-setup.md"];
        assert_eq!(resolve("setup", &files, "D:/notes/index.md"), None);
    }

    #[test]
    fn resolves_path_target_at_component_boundary() {
        let files = ["D:/notes/guide/setup.md", "D:/notes/misguide/setup.md"];
        assert_eq!(
            resolve("guide/setup", &files, "D:/notes/index.md"),
            Some("D:/notes/guide/setup.md".to_string())
        );
        let relative_files = ["guide/setup.md", "misguide/setup.md"];
        assert_eq!(
            resolve("guide/setup", &relative_files, "index.md"),
            Some("guide/setup.md".to_string())
        );
    }

    #[test]
    fn prefers_file_closer_to_current_file() {
        let files = [
            "D:/notes/setup.md",
            "D:/notes/sub/setup.md",
            "D:/notes/sub/deep/setup.md",
        ];
        // 現在ファイルと同じフォルダを最優先
        assert_eq!(
            resolve("setup", &files, "D:/notes/sub/index.md"),
            Some("D:/notes/sub/setup.md".to_string())
        );
        // 同率（共通接頭辞が同じ）なら浅い方
        assert_eq!(
            resolve("setup", &files, "D:/notes/index.md"),
            Some("D:/notes/setup.md".to_string())
        );
    }

    #[test]
    fn returns_none_for_unknown_or_empty_target() {
        let files = ["D:/notes/setup.md"];
        assert_eq!(resolve("missing", &files, "D:/notes/index.md"), None);
        assert_eq!(resolve("", &files, "D:/notes/index.md"), None);
        assert_eq!(resolve("  ", &files, "D:/notes/index.md"), None);
    }

    #[test]
    fn rejects_too_many_wiki_targets() {
        let targets = (0..=MAX_WIKI_TARGETS)
            .map(|i| format!("page-{i}"))
            .collect();

        assert!(validate_targets(targets).is_err());
    }

    #[test]
    fn rejects_oversized_wiki_target_names_and_resolution_work() {
        assert!(validate_targets(vec!["x".repeat(MAX_WIKI_TARGET_BYTES + 1)]).is_err());

        let files = (0..101)
            .map(|index| format!("notes/{index}/same.md"))
            .collect::<Vec<_>>();
        let index = WikiFileIndex::new(&files);
        let mut inspections = 0;
        assert!(index
            .resolve_target("same", &[], &mut inspections, 100)
            .is_err());
    }

    #[test]
    fn indexed_resolution_does_not_inspect_unrelated_file_names() {
        let targets = (0..101).map(|index| format!("target-{index}")).collect();
        let files = (0..MAX_WIKI_SCAN_ENTRIES)
            .map(|index| format!("notes/file-{index}.md"))
            .collect::<Vec<_>>();
        let resolved = resolve_targets(targets, &files, &[]).unwrap();
        assert!(resolved.values().all(Option::is_none));
    }

    fn write(dir: &Path, rel: &str, content: &str) -> PathBuf {
        let path = dir.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn collect_markdown_files_filters_extensions_recursively() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.md", "");
        write(dir.path(), "sub/b.markdown", "");
        write(dir.path(), "sub/c.txt", "");

        let files = collect_markdown_files(dir.path(), false, None);
        let names: Vec<&str> = files
            .iter()
            .map(|p| p.rsplit('/').next().unwrap())
            .collect();
        assert!(names.contains(&"a.md"));
        assert!(names.contains(&"b.markdown"));
        assert!(!names.contains(&"c.txt"));
    }

    #[test]
    fn collect_markdown_files_respects_gitignore_when_enabled() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        write(dir.path(), ".gitignore", "ignored/\n");
        write(dir.path(), "ignored/hidden.md", "");
        write(dir.path(), "visible.md", "");

        let with = collect_markdown_files(dir.path(), true, None);
        assert!(!with.iter().any(|p| p.ends_with("hidden.md")));
        assert!(with.iter().any(|p| p.ends_with("visible.md")));

        let without = collect_markdown_files(dir.path(), false, None);
        assert!(without.iter().any(|p| p.ends_with("hidden.md")));
    }
}
