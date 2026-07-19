use crate::commands::file::{
    build_markdown_content, mime_from_extension, normalize_path_for_frontend,
    read_dir_single_level, AllowedRoots, MarkdownFileContent, MAX_IMAGE_BYTES, MAX_MARKDOWN_BYTES,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use ignore::WalkBuilder;
use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::State;

use super::search::{SearchMatch, SearchState};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRef {
    pub source_id: String,
    pub path: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceCapabilities {
    pub watch: &'static str,
    pub external_editor: bool,
    pub respect_gitignore: bool,
    pub full_text_search: bool,
    pub wiki_links: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSourceInfo {
    pub id: String,
    pub kind: &'static str,
    pub label: String,
    pub native_path: String,
    pub generation: u64,
    pub capabilities: SourceCapabilities,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceEntry {
    pub name: String,
    pub path: String,
    pub document: DocumentRef,
    pub is_dir: bool,
    pub is_hidden: bool,
    pub children: Option<Vec<SourceEntry>>,
}

#[derive(Clone, Debug)]
pub struct NativeSource {
    root: PathBuf,
}

const MAX_ARCHIVE_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_ARCHIVE_TOTAL_SIZE: u64 = 1024 * 1024 * 1024;
const MAX_CENTRAL_DIRECTORY_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ZIP64_EXTENSIBLE_DATA_BYTES: u64 = 64 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 1_000;
const MAX_VIRTUAL_PATH_BYTES: usize = 4 * 1024;
const MAX_VIRTUAL_PATH_COMPONENTS: usize = 256;
const MAX_SYNTHETIC_DIRECTORIES: usize = 10_000;
const MAX_ARCHIVE_PATH_BYTES: usize = 16 * 1024 * 1024;
const MAX_ARCHIVE_ANCESTOR_BYTES: usize = 64 * 1024 * 1024;
const MAX_SEARCH_TOTAL_BYTES: usize = 100 * 1024 * 1024;
const MAX_SEARCH_TOTAL_COMPRESSED_BYTES: u64 = 100 * 1024 * 1024;
const MAX_SEARCH_RESULTS: usize = 1_000;
const MAX_MATCHES_PER_FILE: usize = 1_000;
const MAX_TOTAL_MATCHES: usize = 5_000;
const MAX_LINE_PREVIEW_CHARS: usize = 100;
const MAX_BACKLINK_REFERENCES: usize = 100_000;
const MAX_BACKLINK_CANDIDATE_INSPECTIONS: usize = 1_000_000;
const MAX_CACHED_BACKLINK_INDEXES: usize = 4;
const BACKLINK_INDEX_TTL: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ZipEntryKind {
    File,
    Directory,
}

#[derive(Clone, Debug)]
struct ZipIndexEntry {
    archive_index: usize,
    kind: ZipEntryKind,
    compressed_size: u64,
    uncompressed_size: u64,
    compression: zip::CompressionMethod,
}

#[derive(Clone, Debug)]
pub struct ZipSource {
    archive_path: PathBuf,
    entries: HashMap<String, ZipIndexEntry>,
    visible_directories: HashSet<String>,
    archive: Arc<Mutex<zip::ZipArchive<File>>>,
}

#[derive(Clone, Debug)]
pub enum SourceBackend {
    Native(NativeSource),
    Zip(ZipSource),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSearchOptions {
    query: String,
    is_regex: bool,
    case_sensitive: bool,
    show_hidden_files: bool,
    respect_gitignore: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSearchResult {
    document: DocumentRef,
    file_path: String,
    matches: Vec<SearchMatch>,
}

#[derive(Debug, Serialize)]
pub struct SourceSearchResponse {
    results: Vec<SourceSearchResult>,
    truncated: bool,
    cancelled: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkResult {
    document: DocumentRef,
    file_path: String,
    reference_count: usize,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct BacklinkResponse {
    results: Vec<BacklinkResult>,
    truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct BacklinkCacheKey {
    source_id: String,
    generation: u64,
    show_hidden_files: bool,
    respect_gitignore: bool,
}

#[derive(Clone)]
struct CachedBacklinkIndex {
    created_at: Instant,
    by_target: HashMap<String, Vec<BacklinkResult>>,
    truncated: bool,
}

#[derive(Default)]
struct BacklinkIndexInner {
    indexes: HashMap<BacklinkCacheKey, CachedBacklinkIndex>,
    in_flight: HashSet<BacklinkCacheKey>,
}

#[derive(Clone, Default)]
pub struct BacklinkIndexState(Arc<Mutex<BacklinkIndexInner>>);

impl BacklinkIndexState {
    pub fn new() -> Self {
        Self::default()
    }

    fn cached_or_reserve(
        &self,
        key: &BacklinkCacheKey,
        force_refresh: bool,
    ) -> Result<Option<CachedBacklinkIndex>, String> {
        let now = Instant::now();
        let mut state = self
            .0
            .lock()
            .map_err(|_| "バックリンク索引のロックに失敗しました".to_string())?;
        state
            .indexes
            .retain(|_, index| now.duration_since(index.created_at) < BACKLINK_INDEX_TTL);
        if !force_refresh {
            if let Some(index) = state.indexes.get(key) {
                return Ok(Some(index.clone()));
            }
        }
        if !state.in_flight.is_empty() {
            return Err("バックリンク索引はすでに構築中です".to_string());
        }
        state.in_flight.insert(key.clone());
        Ok(None)
    }

    fn finish(
        &self,
        key: BacklinkCacheKey,
        result: Result<CachedBacklinkIndex, String>,
    ) -> Result<CachedBacklinkIndex, String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "バックリンク索引のロックに失敗しました".to_string())?;
        state.in_flight.remove(&key);
        let mut index = result?;
        if state.indexes.len() >= MAX_CACHED_BACKLINK_INDEXES && !state.indexes.contains_key(&key) {
            if let Some(oldest) = state
                .indexes
                .iter()
                .min_by_key(|(_, entry)| entry.created_at)
                .map(|(key, _)| key.clone())
            {
                state.indexes.remove(&oldest);
            }
        }
        index.created_at = Instant::now();
        state.indexes.insert(key, index.clone());
        Ok(index)
    }
}

impl SourceBackend {
    fn native_path(&self) -> &Path {
        match self {
            Self::Native(source) => &source.root,
            Self::Zip(source) => &source.archive_path,
        }
    }

    fn capabilities(&self) -> SourceCapabilities {
        match self {
            Self::Native(_) => SourceCapabilities {
                watch: "entries",
                external_editor: true,
                respect_gitignore: true,
                full_text_search: true,
                wiki_links: true,
            },
            Self::Zip(_) => SourceCapabilities {
                watch: "container",
                external_editor: false,
                respect_gitignore: false,
                full_text_search: true,
                wiki_links: true,
            },
        }
    }

    fn kind(&self) -> &'static str {
        match self {
            Self::Native(_) => "native",
            Self::Zip(_) => "zip",
        }
    }

    fn label(&self) -> String {
        self.native_path()
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| self.native_path().to_string_lossy().into_owned())
    }
}

#[derive(Default)]
struct RegistryInner {
    next_id: u64,
    sources: HashMap<String, SourceRecord>,
}

#[derive(Clone)]
struct SourceRecord {
    backend: Arc<SourceBackend>,
    generation: u64,
}

#[derive(Clone, Default)]
pub struct SourceRegistry(Arc<Mutex<RegistryInner>>);

impl SourceRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn register_native(&self, root: PathBuf) -> Result<DocumentSourceInfo, String> {
        let mut registry = self
            .0
            .lock()
            .map_err(|_| "ドキュメントソースのロックに失敗しました".to_string())?;
        if let Some((id, record)) = registry.sources.iter().find(|(_, record)| {
            matches!(record.backend.as_ref(), SourceBackend::Native(source) if source.root == root)
        }) {
            return Ok(source_info(id, &record.backend, record.generation));
        }
        registry.next_id += 1;
        let id = format!("source-{}", registry.next_id);
        let backend = Arc::new(SourceBackend::Native(NativeSource { root }));
        let info = source_info(&id, &backend, 0);
        registry.sources.insert(
            id,
            SourceRecord {
                backend,
                generation: 0,
            },
        );
        Ok(info)
    }

    fn register_zip(&self, source: ZipSource) -> Result<DocumentSourceInfo, String> {
        let mut registry = self
            .0
            .lock()
            .map_err(|_| "ドキュメントソースのロックに失敗しました".to_string())?;
        if let Some(id) = registry.sources.iter().find_map(|(id, record)| {
            matches!(record.backend.as_ref(), SourceBackend::Zip(existing) if existing.archive_path == source.archive_path)
                .then(|| id.clone())
        }) {
            let current_generation = registry
                .sources
                .get(&id)
                .map(|record| record.generation)
                .unwrap_or_default();
            let backend = Arc::new(SourceBackend::Zip(source));
            let generation = current_generation.saturating_add(1);
            let info = source_info(&id, &backend, generation);
            registry.sources.insert(
                id,
                SourceRecord {
                    backend,
                    generation,
                },
            );
            return Ok(info);
        }
        registry.next_id += 1;
        let id = format!("source-{}", registry.next_id);
        let backend = Arc::new(SourceBackend::Zip(source));
        let info = source_info(&id, &backend, 0);
        registry.sources.insert(
            id,
            SourceRecord {
                backend,
                generation: 0,
            },
        );
        Ok(info)
    }

    fn get(&self, id: &str) -> Result<Arc<SourceBackend>, String> {
        self.get_with_generation(id).map(|(backend, _)| backend)
    }

    fn get_with_generation(&self, id: &str) -> Result<(Arc<SourceBackend>, u64), String> {
        self.0
            .lock()
            .map_err(|_| "ドキュメントソースのロックに失敗しました".to_string())?
            .sources
            .get(id)
            .map(|record| (record.backend.clone(), record.generation))
            .ok_or_else(|| "ドキュメントソースが見つかりません".to_string())
    }

    fn remove(&self, id: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "ドキュメントソースのロックに失敗しました".to_string())?
            .sources
            .remove(id);
        Ok(())
    }

    fn replace_zip(&self, id: &str, source: ZipSource) -> Result<DocumentSourceInfo, String> {
        let mut registry = self
            .0
            .lock()
            .map_err(|_| "ドキュメントソースのロックに失敗しました".to_string())?;
        let current = registry
            .sources
            .get(id)
            .ok_or_else(|| "ドキュメントソースが見つかりません".to_string())?;
        if !matches!(current.backend.as_ref(), SourceBackend::Zip(existing) if existing.archive_path == source.archive_path)
        {
            return Err("ZIPソースの再読込対象が一致しません".to_string());
        }
        let backend = Arc::new(SourceBackend::Zip(source));
        let generation = current.generation.saturating_add(1);
        let info = source_info(id, &backend, generation);
        registry.sources.insert(
            id.to_string(),
            SourceRecord {
                backend,
                generation,
            },
        );
        Ok(info)
    }
}

fn source_info(id: &str, backend: &SourceBackend, generation: u64) -> DocumentSourceInfo {
    DocumentSourceInfo {
        id: id.to_string(),
        kind: backend.kind(),
        label: backend.label(),
        native_path: normalize_path_for_frontend(backend.native_path()),
        generation,
        capabilities: backend.capabilities(),
    }
}

pub fn normalize_virtual_path(path: &str) -> Result<String, String> {
    if path.contains('\0')
        || path.contains('\\')
        || path.starts_with('/')
        || path.as_bytes().get(1).is_some_and(|byte| *byte == b':')
    {
        return Err("無効なソース内パスです".to_string());
    }
    let mut normalized = Vec::new();
    for component in Path::new(path).components() {
        match component {
            Component::Normal(value) => normalized.push(value.to_string_lossy().into_owned()),
            Component::CurDir => {}
            Component::ParentDir => {
                if normalized.pop().is_none() {
                    return Err("ソースのルート外へ移動できません".to_string());
                }
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("絶対パスはソース内パスに使用できません".to_string());
            }
        }
    }
    Ok(normalized.join("/"))
}

fn resolve_native_path(
    source: &NativeSource,
    virtual_path: &str,
    roots: &AllowedRoots,
) -> Result<PathBuf, String> {
    let relative = normalize_virtual_path(virtual_path)?;
    let candidate = if relative.is_empty() {
        source.root.clone()
    } else {
        source.root.join(relative)
    };
    let resolved = roots.resolve(&candidate.to_string_lossy())?;
    if !resolved.starts_with(&source.root) {
        return Err("ソースのルート外へ移動できません".to_string());
    }
    Ok(resolved)
}

fn is_markdown_virtual_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(crate::commands::is_markdown_extension)
}

fn is_supported_image_virtual_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" | "bmp" | "ico"
            )
        })
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, String> {
    let value = bytes
        .get(offset..offset + 2)
        .ok_or_else(|| "ZIPの中央ディレクトリー情報が不完全です".to_string())?;
    Ok(u16::from_le_bytes([value[0], value[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| "ZIPの中央ディレクトリー情報が不完全です".to_string())?;
    Ok(u32::from_le_bytes(value.try_into().unwrap()))
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, String> {
    let value = bytes
        .get(offset..offset + 8)
        .ok_or_else(|| "ZIPの中央ディレクトリー情報が不完全です".to_string())?;
    Ok(u64::from_le_bytes(value.try_into().unwrap()))
}

fn read_file_range(file: &mut File, offset: u64, length: usize) -> Result<Vec<u8>, String> {
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| format!("ZIPファイルの読み取り位置を変更できませんでした: {error}"))?;
    let mut bytes = vec![0; length];
    file.read_exact(&mut bytes)
        .map_err(|error| format!("ZIPファイルを読み取れませんでした: {error}"))?;
    Ok(bytes)
}

fn find_single_eocd_candidate(file: &mut File, file_size: u64) -> Result<u64, String> {
    const EOCD_MIN_SIZE: usize = 22;
    const CHUNK_SIZE: usize = 64 * 1024;
    file.seek(SeekFrom::Start(0))
        .map_err(|error| format!("ZIPファイルの読み取り位置を変更できませんでした: {error}"))?;
    let mut candidate = None;
    let mut carry = Vec::new();
    let mut consumed = 0u64;
    let mut next_scan_offset = 0u64;
    let mut chunk = vec![0u8; CHUNK_SIZE];
    loop {
        let read = file
            .read(&mut chunk)
            .map_err(|error| format!("ZIPファイルを読み取れませんでした: {error}"))?;
        if read == 0 {
            break;
        }
        let combined_start = consumed.saturating_sub(carry.len() as u64);
        let mut combined = carry;
        combined.extend_from_slice(&chunk[..read]);
        if combined.len() >= EOCD_MIN_SIZE {
            for index in 0..=combined.len() - EOCD_MIN_SIZE {
                let absolute = combined_start + index as u64;
                if absolute < next_scan_offset || !combined[index..].starts_with(b"PK\x05\x06") {
                    continue;
                }
                let comment_length = read_u16(&combined, index + 20)? as u64;
                if absolute
                    .checked_add(EOCD_MIN_SIZE as u64)
                    .and_then(|end| end.checked_add(comment_length))
                    .is_some_and(|end| end <= file_size)
                    && candidate.replace(absolute).is_some()
                {
                    return Err("ZIPファイルの終端情報が曖昧です".to_string());
                }
            }
            next_scan_offset = combined_start + (combined.len() - (EOCD_MIN_SIZE - 1)) as u64;
        }
        let carry_start = combined.len().saturating_sub(EOCD_MIN_SIZE - 1);
        carry = combined[carry_start..].to_vec();
        consumed += read as u64;
    }
    candidate.ok_or_else(|| "ZIPファイルの終端情報が見つかりません".to_string())
}

/// zip crateが中央ディレクトリー全体を解析する前に、EOCD/ZIP64 EOCDの固定長部分だけを読み、
/// エントリー数と中央ディレクトリーサイズを制限する。
fn preflight_zip_directory(file: &mut File, file_size: u64) -> Result<(), String> {
    const EOCD_MIN_SIZE: usize = 22;
    if file_size < EOCD_MIN_SIZE as u64 {
        return Err("ZIPファイルの終端情報が見つかりません".to_string());
    }
    let eocd_absolute = find_single_eocd_candidate(file, file_size)?;
    let eocd = read_file_range(file, eocd_absolute, EOCD_MIN_SIZE)?;
    let comment_length = read_u16(&eocd, 20)? as u64;
    if eocd_absolute + EOCD_MIN_SIZE as u64 + comment_length != file_size {
        return Err("ZIPファイル終端の後ろに未解釈データがあります".to_string());
    }
    let disk_number = read_u16(&eocd, 4)?;
    let central_disk = read_u16(&eocd, 6)?;
    let entries_on_disk = read_u16(&eocd, 8)?;
    let total_entries = read_u16(&eocd, 10)?;
    if disk_number != 0 || central_disk != 0 || entries_on_disk != total_entries {
        return Err("分割ZIPには対応していません".to_string());
    }

    let central_size_32 = read_u32(&eocd, 12)?;
    let central_offset_32 = read_u32(&eocd, 16)?;
    let needs_zip64 =
        total_entries == u16::MAX || central_size_32 == u32::MAX || central_offset_32 == u32::MAX;
    let (entry_count, central_size, central_offset, directory_limit) = if needs_zip64 {
        if eocd_absolute < 20 {
            return Err("ZIP64終端情報が不完全です".to_string());
        }
        let locator = read_file_range(file, eocd_absolute - 20, 20)?;
        if !locator.starts_with(b"PK\x06\x07")
            || read_u32(&locator, 4)? != 0
            || read_u32(&locator, 16)? != 1
        {
            return Err("分割ZIPまたは不正なZIP64には対応していません".to_string());
        }
        let zip64_offset = read_u64(&locator, 8)?;
        let zip64 = read_file_range(file, zip64_offset, 56)?;
        let zip64_record_size = read_u64(&zip64, 4)?;
        let zip64_end = zip64_offset
            .checked_add(12)
            .and_then(|offset| offset.checked_add(zip64_record_size))
            .ok_or_else(|| "ZIP64終端情報の範囲が不正です".to_string())?;
        if !zip64.starts_with(b"PK\x06\x06")
            || zip64_record_size < 44
            || zip64_record_size - 44 > MAX_ZIP64_EXTENSIBLE_DATA_BYTES
            || zip64_end != eocd_absolute - 20
            || read_u32(&zip64, 16)? != 0
            || read_u32(&zip64, 20)? != 0
            || read_u64(&zip64, 24)? != read_u64(&zip64, 32)?
        {
            return Err("分割ZIPまたは不正なZIP64には対応していません".to_string());
        }
        (
            read_u64(&zip64, 32)?,
            read_u64(&zip64, 40)?,
            read_u64(&zip64, 48)?,
            zip64_offset,
        )
    } else {
        (
            total_entries as u64,
            central_size_32 as u64,
            central_offset_32 as u64,
            eocd_absolute,
        )
    };

    if entry_count > MAX_ARCHIVE_ENTRIES as u64 {
        return Err(format!(
            "ZIP内のエントリ数は{}件以下にしてください",
            MAX_ARCHIVE_ENTRIES
        ));
    }
    if central_size > MAX_CENTRAL_DIRECTORY_BYTES {
        return Err("ZIPの中央ディレクトリーが大きすぎます".to_string());
    }
    if central_offset
        .checked_add(central_size)
        .is_none_or(|end| end > file_size)
    {
        return Err("ZIPの中央ディレクトリー範囲が不正です".to_string());
    }
    let minimum_central_size = entry_count
        .checked_mul(46)
        .ok_or_else(|| "ZIPの中央ディレクトリーサイズが不正です".to_string())?;
    if central_size < minimum_central_size {
        return Err("ZIPの中央ディレクトリーサイズが不正です".to_string());
    }
    if entry_count == 0 {
        if central_size != 0 || central_offset != eocd_absolute {
            return Err("空のZIPの中央ディレクトリー位置が不正です".to_string());
        }
    } else {
        if central_offset >= eocd_absolute {
            return Err("ZIPの中央ディレクトリー位置が不正です".to_string());
        }
        let signature = read_file_range(file, central_offset, 4)?;
        if signature != b"PK\x01\x02" {
            return Err("ZIPの中央ディレクトリー署名が不正です".to_string());
        }
    }
    let directory_end = central_offset
        .checked_add(central_size)
        .ok_or_else(|| "ZIPの中央ディレクトリー範囲が不正です".to_string())?;
    if directory_end > directory_limit {
        return Err("ZIPの中央ディレクトリー終端が不正です".to_string());
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|error| format!("ZIPファイルの読み取り位置を戻せませんでした: {error}"))?;
    Ok(())
}

fn open_verified_zip(
    archive_path: &Path,
    roots: &AllowedRoots,
) -> Result<zip::ZipArchive<File>, String> {
    let (mut file, verified) = crate::commands::file::trusted_paths::open_allowed_file(
        roots,
        &archive_path.to_string_lossy(),
    )?;
    if verified != archive_path {
        return Err("ZIPファイルのパスが変更されました".to_string());
    }
    let file_size = file
        .metadata()
        .map_err(|error| format!("ZIPファイル情報の取得に失敗しました: {error}"))?
        .len();
    if file_size > MAX_ARCHIVE_BYTES {
        return Err("ZIPファイルは1GiB以下にしてください".to_string());
    }
    preflight_zip_directory(&mut file, file_size)?;
    zip::ZipArchive::new(file).map_err(|error| format!("ZIPファイルを開けませんでした: {error}"))
}

fn validate_zip_virtual_path(path: &str) -> Result<(), String> {
    if path.len() > MAX_VIRTUAL_PATH_BYTES {
        return Err("ZIP内のパスが長すぎます".to_string());
    }
    if path.split('/').count() > MAX_VIRTUAL_PATH_COMPONENTS {
        return Err("ZIP内のパス階層が深すぎます".to_string());
    }
    Ok(())
}

fn virtual_ancestors(path: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = path.rsplit_once('/').map(|(parent, _)| parent);
    while let Some(directory) = current {
        result.push(directory.to_string());
        current = directory.rsplit_once('/').map(|(parent, _)| parent);
    }
    result
}

fn virtual_ancestor_bytes(path: &str) -> Option<usize> {
    path.bytes()
        .enumerate()
        .filter(|(_, byte)| *byte == b'/')
        .try_fold(0usize, |total, (index, _)| total.checked_add(index))
}

fn register_case_identity(
    path: &str,
    case_folded: &mut HashMap<String, String>,
) -> Result<(), String> {
    let folded = path.to_lowercase();
    if let Some(existing) = case_folded.get(&folded) {
        if existing != path {
            return Err(format!(
                "ZIP内に大文字小文字だけ異なる曖昧なパスがあります: {existing} / {path}"
            ));
        }
    } else {
        case_folded.insert(folded, path.to_string());
    }
    Ok(())
}

fn is_hidden_virtual_path(path: &str) -> bool {
    path.split('/').any(|component| component.starts_with('.'))
}

fn build_zip_source(archive_path: PathBuf, roots: &AllowedRoots) -> Result<ZipSource, String> {
    let mut archive = open_verified_zip(&archive_path, roots)?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(format!(
            "ZIP内のエントリ数は{}件以下にしてください",
            MAX_ARCHIVE_ENTRIES
        ));
    }
    if archive
        .has_overlapping_files()
        .map_err(|error| format!("ZIP内のデータ範囲を検証できませんでした: {error}"))?
    {
        return Err("ZIP内で複数エントリが同じ圧縮データ範囲を参照しています".to_string());
    }

    let mut entries = HashMap::new();
    let mut case_folded = HashMap::new();
    let mut physical_paths = HashSet::new();
    let mut indexed_files = HashSet::new();
    let mut indexed_directories = HashSet::new();
    let mut visible_directories = HashSet::new();
    let mut total_size = 0u64;
    let mut total_compressed_size = 0u64;
    let mut total_path_bytes = 0usize;
    let mut total_ancestor_bytes = 0usize;
    for archive_index in 0..archive.len() {
        let file = archive
            .by_index(archive_index)
            .map_err(|error| format!("ZIPエントリを読み取れませんでした: {error}"))?;
        if file.encrypted() {
            return Err("暗号化ZIPには対応していません".to_string());
        }
        if file.is_symlink() {
            return Err("ZIP内のシンボリックリンクには対応していません".to_string());
        }
        if !matches!(
            file.compression(),
            zip::CompressionMethod::Stored
                | zip::CompressionMethod::Deflated
                | zip::CompressionMethod::Deflate64
        ) {
            return Err(format!(
                "ZIP内に未対応の圧縮方式があります: {:?}",
                file.compression()
            ));
        }
        let enclosed = file
            .enclosed_name()
            .ok_or_else(|| "ZIP内に安全でないパスがあります".to_string())?;
        let raw_path = enclosed.to_string_lossy().replace('\\', "/");
        let path = normalize_virtual_path(raw_path.trim_end_matches('/'))?;
        if path.is_empty() {
            continue;
        }
        validate_zip_virtual_path(&path)?;
        total_path_bytes = total_path_bytes
            .checked_add(path.len())
            .ok_or_else(|| "ZIP内のパス合計が大きすぎます".to_string())?;
        total_ancestor_bytes = total_ancestor_bytes
            .checked_add(
                virtual_ancestor_bytes(&path)
                    .ok_or_else(|| "ZIP内のフォルダーパス合計が大きすぎます".to_string())?,
            )
            .ok_or_else(|| "ZIP内のフォルダーパス合計が大きすぎます".to_string())?;
        if total_path_bytes > MAX_ARCHIVE_PATH_BYTES
            || total_ancestor_bytes > MAX_ARCHIVE_ANCESTOR_BYTES
        {
            return Err("ZIP内のパスまたはフォルダー階層の合計が大きすぎます".to_string());
        }
        if !physical_paths.insert(path.clone()) {
            return Err(format!("ZIP内に重複するパスがあります: {path}"));
        }
        register_case_identity(&path, &mut case_folded)?;
        let kind = if file.is_dir() {
            ZipEntryKind::Directory
        } else {
            ZipEntryKind::File
        };
        match kind {
            ZipEntryKind::File => {
                if indexed_directories.contains(&path) {
                    return Err(format!(
                        "ZIP内でファイルとフォルダーのパスが衝突しています: {path}"
                    ));
                }
                indexed_files.insert(path.clone());
            }
            ZipEntryKind::Directory => {
                if indexed_files.contains(&path) {
                    return Err(format!(
                        "ZIP内でファイルとフォルダーのパスが衝突しています: {path}"
                    ));
                }
                indexed_directories.insert(path.clone());
            }
        }
        let ancestors = virtual_ancestors(&path);
        for directory in &ancestors {
            register_case_identity(directory, &mut case_folded)?;
            if indexed_files.contains(directory) {
                return Err(format!(
                    "ZIP内でファイルとフォルダーのパスが衝突しています: {directory}"
                ));
            }
            indexed_directories.insert(directory.clone());
        }
        if indexed_directories.len() > MAX_SYNTHETIC_DIRECTORIES {
            return Err("ZIP内のフォルダー数が多すぎます".to_string());
        }
        total_size = total_size
            .checked_add(file.size())
            .ok_or_else(|| "ZIPの展開後サイズが大きすぎます".to_string())?;
        if total_size > MAX_ARCHIVE_TOTAL_SIZE {
            return Err("ZIPの展開後合計サイズは1GiB以下にしてください".to_string());
        }
        total_compressed_size = total_compressed_size
            .checked_add(file.compressed_size())
            .ok_or_else(|| "ZIPの圧縮データ合計が大きすぎます".to_string())?;
        if total_compressed_size > MAX_ARCHIVE_BYTES {
            return Err("ZIPの圧縮データ合計は1GiB以下にしてください".to_string());
        }
        if file.size() > 0
            && (file.compressed_size() == 0
                || file.size() / file.compressed_size().max(1) > MAX_COMPRESSION_RATIO)
        {
            return Err(format!("ZIP内の圧縮率が高すぎます: {path}"));
        }
        entries.insert(
            path.clone(),
            ZipIndexEntry {
                archive_index,
                kind,
                compressed_size: file.compressed_size(),
                uncompressed_size: file.size(),
                compression: file.compression(),
            },
        );
        if is_markdown_virtual_path(&path) {
            visible_directories.extend(ancestors);
        }
    }

    // ZIPはディレクトリエントリを省略できるため、Markdownの祖先を仮想ディレクトリとして合成する。
    for directory in &visible_directories {
        entries.entry(directory.clone()).or_insert(ZipIndexEntry {
            archive_index: usize::MAX,
            kind: ZipEntryKind::Directory,
            compressed_size: 0,
            uncompressed_size: 0,
            compression: zip::CompressionMethod::Stored,
        });
    }

    Ok(ZipSource {
        archive_path,
        entries,
        visible_directories,
        archive: Arc::new(Mutex::new(archive)),
    })
}

fn list_zip_entries(source: &ZipSource, document: &DocumentRef) -> Vec<SourceEntry> {
    let prefix = if document.path.is_empty() {
        String::new()
    } else {
        format!("{}/", document.path)
    };
    let mut result = Vec::new();
    for (path, entry) in &source.entries {
        let Some(remainder) = path.strip_prefix(&prefix) else {
            continue;
        };
        if remainder.is_empty() || remainder.contains('/') {
            continue;
        }
        let visible = match entry.kind {
            ZipEntryKind::Directory => source.visible_directories.contains(path),
            ZipEntryKind::File => is_markdown_virtual_path(path),
        };
        if !visible {
            continue;
        }
        result.push(SourceEntry {
            name: remainder.to_string(),
            path: path.clone(),
            document: DocumentRef {
                source_id: document.source_id.clone(),
                path: path.clone(),
            },
            is_dir: entry.kind == ZipEntryKind::Directory,
            is_hidden: remainder.starts_with('.'),
            children: None,
        });
    }
    result.sort_by(|left, right| match (left.is_dir, right.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
    });
    result
}

fn list_native_entries(
    source: &NativeSource,
    document: &DocumentRef,
    respect_gitignore: bool,
    roots: &AllowedRoots,
) -> Result<Vec<SourceEntry>, String> {
    let directory = resolve_native_path(source, &document.path, roots)?;
    let virtual_directory = normalize_virtual_path(&document.path)?;
    if !directory.is_dir() {
        return Err("フォルダーを指定してください".to_string());
    }
    Ok(
        read_dir_single_level(&directory, respect_gitignore, Some(roots))
            .into_iter()
            .map(|entry| {
                let path = if virtual_directory.is_empty() {
                    entry.name.clone()
                } else {
                    format!("{virtual_directory}/{}", entry.name)
                };
                SourceEntry {
                    name: entry.name,
                    path: path.clone(),
                    document: DocumentRef {
                        source_id: document.source_id.clone(),
                        path,
                    },
                    is_dir: entry.is_dir,
                    is_hidden: entry.is_hidden,
                    children: None,
                }
            })
            .collect(),
    )
}

fn read_zip_entry(
    source: &ZipSource,
    path: &str,
    limit: u64,
    _roots: &AllowedRoots,
) -> Result<Vec<u8>, String> {
    let mut archive = source
        .archive
        .lock()
        .map_err(|_| "ZIPアーカイブのロックに失敗しました".to_string())?;
    read_zip_entry_from_archive(source, path, limit, &mut archive)
}

fn read_zip_entry_from_archive(
    source: &ZipSource,
    path: &str,
    limit: u64,
    archive: &mut zip::ZipArchive<File>,
) -> Result<Vec<u8>, String> {
    let entry = source
        .entries
        .get(path)
        .filter(|entry| entry.kind == ZipEntryKind::File)
        .ok_or_else(|| "ZIP内のファイルが見つかりません".to_string())?;
    if entry.uncompressed_size > limit {
        return Err("ZIP内のファイルがサイズ上限を超えています".to_string());
    }
    let file = archive
        .by_index(entry.archive_index)
        .map_err(|error| format!("ZIPエントリを読み取れませんでした: {error}"))?;
    if file.encrypted() || file.is_symlink() {
        return Err("ZIPエントリの安全性が登録時から変化しました".to_string());
    }
    if file.compression() != entry.compression
        || file.compressed_size() != entry.compressed_size
        || file.size() != entry.uncompressed_size
        || !matches!(
            file.compression(),
            zip::CompressionMethod::Stored
                | zip::CompressionMethod::Deflated
                | zip::CompressionMethod::Deflate64
        )
    {
        return Err("ZIPエントリのサイズまたは圧縮方式が登録時から変化しました".to_string());
    }
    let actual_path = file
        .enclosed_name()
        .ok_or_else(|| "ZIP内に安全でないパスがあります".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let actual_path = normalize_virtual_path(actual_path.trim_end_matches('/'))?;
    if actual_path != path {
        return Err("ZIPエントリが登録時から変更されました".to_string());
    }
    if file.size() > limit
        || (file.size() > 0
            && (file.compressed_size() == 0
                || file.size() / file.compressed_size().max(1) > MAX_COMPRESSION_RATIO))
    {
        return Err("ZIP内のファイルがサイズ上限を超えています".to_string());
    }
    let mut bytes = Vec::new();
    let read_limit = entry.uncompressed_size.min(limit).saturating_add(1);
    file.take(read_limit)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("ZIPエントリを展開できませんでした: {error}"))?;
    if bytes.len() as u64 > limit {
        return Err("ZIP内のファイルがサイズ上限を超えています".to_string());
    }
    if bytes.len() as u64 != entry.uncompressed_size {
        return Err("ZIPエントリの実際の展開サイズが宣言値と一致しません".to_string());
    }
    Ok(bytes)
}

#[tauri::command(async)]
pub fn register_native_source(
    root_path: String,
    roots: State<'_, AllowedRoots>,
    registry: State<'_, SourceRegistry>,
) -> Result<DocumentSourceInfo, String> {
    let root = roots.resolve(&root_path)?;
    if !root.is_dir() {
        return Err("フォルダーを指定してください".to_string());
    }
    registry.register_native(root)
}

#[tauri::command(async)]
pub fn register_native_document_source(
    path: String,
    roots: State<'_, AllowedRoots>,
    registry: State<'_, SourceRegistry>,
) -> Result<(DocumentSourceInfo, DocumentRef), String> {
    let file = roots.resolve(&path)?;
    if !file.is_file() {
        return Err("ファイルを指定してください".to_string());
    }
    let root = file
        .parent()
        .ok_or_else(|| "親フォルダーを特定できません".to_string())?
        .to_path_buf();
    let info = registry.register_native(root)?;
    let entry = file
        .file_name()
        .ok_or_else(|| "ファイル名を特定できません".to_string())?
        .to_string_lossy()
        .into_owned();
    Ok((
        info.clone(),
        DocumentRef {
            source_id: info.id,
            path: entry,
        },
    ))
}

#[tauri::command(async)]
pub fn register_zip_source(
    archive_path: String,
    roots: State<'_, AllowedRoots>,
    registry: State<'_, SourceRegistry>,
) -> Result<DocumentSourceInfo, String> {
    let canonical = roots.resolve(&archive_path)?;
    if !canonical
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
    {
        return Err("ZIPファイル（.zip）を指定してください".to_string());
    }
    let source = build_zip_source(canonical, &roots)?;
    registry.register_zip(source)
}

#[tauri::command(async)]
pub fn reload_zip_source(
    source_id: String,
    roots: State<'_, AllowedRoots>,
    registry: State<'_, SourceRegistry>,
) -> Result<DocumentSourceInfo, String> {
    let backend = registry.get(&source_id)?;
    let archive_path = match backend.as_ref() {
        SourceBackend::Zip(source) => source.archive_path.clone(),
        SourceBackend::Native(_) => return Err("ZIPソースではありません".to_string()),
    };
    let source = build_zip_source(archive_path, &roots)?;
    registry.replace_zip(&source_id, source)
}

#[tauri::command(async)]
pub fn unregister_source(
    source_id: String,
    registry: State<'_, SourceRegistry>,
) -> Result<(), String> {
    registry.remove(&source_id)
}

#[tauri::command(async)]
pub fn list_source_entries(
    document: DocumentRef,
    respect_gitignore: bool,
    roots: State<'_, AllowedRoots>,
    registry: State<'_, SourceRegistry>,
) -> Result<Vec<SourceEntry>, String> {
    let backend = registry.get(&document.source_id)?;
    match backend.as_ref() {
        SourceBackend::Native(source) => {
            list_native_entries(source, &document, respect_gitignore, &roots)
        }
        SourceBackend::Zip(source) => {
            let path = normalize_virtual_path(&document.path)?;
            let directory = source
                .entries
                .get(&path)
                .filter(|entry| entry.kind == ZipEntryKind::Directory);
            if !path.is_empty() && directory.is_none() {
                return Err("ZIP内のフォルダーが見つかりません".to_string());
            }
            Ok(list_zip_entries(source, &document))
        }
    }
}

#[tauri::command(async)]
pub fn read_source_markdown(
    document: DocumentRef,
    roots: State<'_, AllowedRoots>,
    registry: State<'_, SourceRegistry>,
) -> Result<MarkdownFileContent, String> {
    let backend = registry.get(&document.source_id)?;
    match backend.as_ref() {
        SourceBackend::Native(source) => {
            let path = resolve_native_path(source, &document.path, &roots)?;
            let (mut file, canonical) = crate::commands::file::trusted_paths::open_allowed_file(
                &roots,
                &path.to_string_lossy(),
            )?;
            if !crate::commands::has_markdown_extension(&canonical) {
                return Err("Markdownファイル（.md / .markdown）のみ読み込めます".to_string());
            }
            let byte_size = file.metadata().map_err(|error| error.to_string())?.len();
            if byte_size > MAX_MARKDOWN_BYTES {
                return Err("Markdownファイルは10MiB以下にしてください".to_string());
            }
            let mut raw = String::new();
            file.by_ref()
                .take(MAX_MARKDOWN_BYTES + 1)
                .read_to_string(&mut raw)
                .map_err(|error| format!("ファイル読み込みエラー: {error}"))?;
            if raw.len() as u64 > MAX_MARKDOWN_BYTES {
                return Err("Markdownファイルは10MiB以下にしてください".to_string());
            }
            let observed_size = byte_size.max(raw.len() as u64);
            Ok(build_markdown_content(raw, observed_size))
        }
        SourceBackend::Zip(source) => {
            let path = normalize_virtual_path(&document.path)?;
            if !is_markdown_virtual_path(&path) {
                return Err("Markdownファイル（.md / .markdown）のみ読み込めます".to_string());
            }
            let bytes = read_zip_entry(source, &path, MAX_MARKDOWN_BYTES, &roots)?;
            let byte_size = bytes.len() as u64;
            let raw = String::from_utf8(bytes)
                .map_err(|_| "ZIP内のMarkdownはUTF-8で保存してください".to_string())?;
            Ok(build_markdown_content(raw, byte_size))
        }
    }
}

#[tauri::command(async)]
pub fn read_source_image(
    document: DocumentRef,
    roots: State<'_, AllowedRoots>,
    registry: State<'_, SourceRegistry>,
) -> Result<String, String> {
    let backend = registry.get(&document.source_id)?;
    match backend.as_ref() {
        SourceBackend::Native(source) => {
            let path = resolve_native_path(source, &document.path, &roots)?;
            let (file, canonical) = crate::commands::file::trusted_paths::open_allowed_file(
                &roots,
                &path.to_string_lossy(),
            )?;
            if file.metadata().map_err(|error| error.to_string())?.len() > MAX_IMAGE_BYTES {
                return Err("画像ファイルは20MiB以下にしてください".to_string());
            }
            let mut bytes = Vec::new();
            file.take(MAX_IMAGE_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| format!("画像読み込みエラー: {error}"))?;
            if bytes.len() as u64 > MAX_IMAGE_BYTES {
                return Err("画像ファイルは20MiB以下にしてください".to_string());
            }
            Ok(format!(
                "data:{};base64,{}",
                mime_from_extension(&canonical),
                STANDARD.encode(bytes)
            ))
        }
        SourceBackend::Zip(source) => {
            let path = normalize_virtual_path(&document.path)?;
            if !is_supported_image_virtual_path(&path) {
                return Err("対応していない画像形式です".to_string());
            }
            let bytes = read_zip_entry(source, &path, MAX_IMAGE_BYTES, &roots)?;
            Ok(format!(
                "data:{};base64,{}",
                mime_from_extension(Path::new(&path)),
                STANDARD.encode(bytes)
            ))
        }
    }
}

fn collect_source_markdown_paths(
    backend: &SourceBackend,
    show_hidden_files: bool,
    respect_gitignore: bool,
    roots: &AllowedRoots,
) -> Result<Vec<String>, String> {
    collect_source_markdown_paths_with_status(
        backend,
        show_hidden_files,
        respect_gitignore,
        roots,
        MAX_ARCHIVE_ENTRIES,
    )
    .map(|(paths, _)| paths)
}

fn collect_source_markdown_paths_with_status(
    backend: &SourceBackend,
    show_hidden_files: bool,
    respect_gitignore: bool,
    roots: &AllowedRoots,
    entry_limit: usize,
) -> Result<(Vec<String>, bool), String> {
    match backend {
        SourceBackend::Native(source) => {
            let mut builder = WalkBuilder::new(&source.root);
            builder
                .hidden(!show_hidden_files)
                .git_ignore(respect_gitignore)
                .git_global(respect_gitignore)
                .git_exclude(respect_gitignore)
                .ignore(respect_gitignore)
                .parents(respect_gitignore);
            let mut paths = Vec::new();
            let mut truncated = false;
            for (index, entry) in builder.build().enumerate() {
                if index >= entry_limit {
                    truncated = true;
                    break;
                }
                let entry =
                    entry.map_err(|error| format!("Markdown一覧の走査に失敗しました: {error}"))?;
                let path = entry.path();
                if !path.is_file()
                    || !crate::commands::has_markdown_extension(path)
                    || roots.resolve(&path.to_string_lossy()).is_err()
                {
                    continue;
                }
                let Some(relative) = path.strip_prefix(&source.root).ok() else {
                    continue;
                };
                paths.push(relative.to_string_lossy().replace('\\', "/"));
            }
            Ok((paths, truncated))
        }
        SourceBackend::Zip(source) => Ok((
            source
                .entries
                .iter()
                .filter(|(path, entry)| {
                    entry.kind == ZipEntryKind::File
                        && is_markdown_virtual_path(path)
                        && (show_hidden_files || !is_hidden_virtual_path(path))
                })
                .map(|(path, _)| path.clone())
                .collect(),
            false,
        )),
    }
}

fn source_markdown_documents(
    backend: &SourceBackend,
    source_id: &str,
    show_hidden_files: bool,
    respect_gitignore: bool,
    roots: &AllowedRoots,
) -> Result<Vec<DocumentRef>, String> {
    let mut paths = collect_source_markdown_paths(
        backend,
        show_hidden_files,
        respect_gitignore && backend.capabilities().respect_gitignore,
        roots,
    )?;
    paths.sort_by_key(|path| path.to_lowercase());
    Ok(paths
        .into_iter()
        .map(|path| DocumentRef {
            source_id: source_id.to_string(),
            path,
        })
        .collect())
}

#[tauri::command(async)]
pub async fn list_source_markdown_documents(
    source_id: String,
    show_hidden_files: bool,
    respect_gitignore: bool,
    roots: State<'_, AllowedRoots>,
    registry: State<'_, SourceRegistry>,
) -> Result<Vec<DocumentRef>, String> {
    let roots = roots.inner().clone();
    let registry = registry.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let backend = registry.get(&source_id)?;
        source_markdown_documents(
            &backend,
            &source_id,
            show_hidden_files,
            respect_gitignore,
            &roots,
        )
    })
    .await
    .map_err(|error| format!("Markdown一覧の取得に失敗しました: {error}"))?
}

fn read_source_text(
    backend: &SourceBackend,
    path: &str,
    roots: &AllowedRoots,
    zip_archive: Option<&mut zip::ZipArchive<File>>,
) -> Result<String, String> {
    match backend {
        SourceBackend::Native(source) => {
            let path = resolve_native_path(source, path, roots)?;
            let (mut file, _) = crate::commands::file::trusted_paths::open_allowed_file(
                roots,
                &path.to_string_lossy(),
            )?;
            let mut raw = String::new();
            file.by_ref()
                .take(MAX_MARKDOWN_BYTES + 1)
                .read_to_string(&mut raw)
                .map_err(|error| format!("ファイル読み込みエラー: {error}"))?;
            if raw.len() as u64 > MAX_MARKDOWN_BYTES {
                return Err("Markdownファイルは10MiB以下にしてください".to_string());
            }
            Ok(raw)
        }
        SourceBackend::Zip(source) => {
            let archive =
                zip_archive.ok_or_else(|| "ZIP検索用アーカイブが開かれていません".to_string())?;
            let bytes = read_zip_entry_from_archive(source, path, MAX_MARKDOWN_BYTES, archive)?;
            String::from_utf8(bytes)
                .map_err(|_| "ZIP内のMarkdownはUTF-8で保存してください".to_string())
        }
    }
}

fn truncate_search_preview(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() > MAX_LINE_PREVIEW_CHARS {
        format!(
            "{}...",
            trimmed
                .chars()
                .take(MAX_LINE_PREVIEW_CHARS)
                .collect::<String>()
        )
    } else {
        trimmed.to_string()
    }
}

fn extract_wiki_targets(raw: &str, limit: usize) -> (Vec<String>, bool) {
    let mut excluded_ranges = Vec::new();
    let mut code_block_start = None;
    for (event, range) in Parser::new(raw).into_offset_iter() {
        match event {
            Event::Start(Tag::CodeBlock(_)) => code_block_start = Some(range.start),
            Event::End(TagEnd::CodeBlock) => {
                if let Some(start) = code_block_start.take() {
                    excluded_ranges.push(start..range.end);
                }
            }
            Event::Code(_) if code_block_start.is_none() => excluded_ranges.push(range),
            Event::Html(_) | Event::InlineHtml(_) if code_block_start.is_none() => {
                excluded_ranges.push(range)
            }
            _ => {}
        }
    }
    if let Some(start) = code_block_start {
        excluded_ranges.push(start..raw.len());
    }
    excluded_ranges.sort_by_key(|range| range.start);

    let mut targets = Vec::new();
    let mut truncated = false;
    let mut offset = 0;
    let mut excluded_index = 0;
    while offset < raw.len() {
        let Some(relative_start) = raw[offset..].find("[[") else {
            break;
        };
        let start = offset + relative_start;
        let Some(relative_end) = raw[start + 2..].find("]]") else {
            break;
        };
        let end = start + 2 + relative_end;
        let candidate_end = end + 2;
        while excluded_ranges
            .get(excluded_index)
            .is_some_and(|range| range.end <= start)
        {
            excluded_index += 1;
        }
        let in_code = excluded_ranges
            .get(excluded_index)
            .is_some_and(|range| range.start < candidate_end && range.end > start);
        let escaped = raw[..start]
            .bytes()
            .rev()
            .take_while(|byte| *byte == b'\\')
            .count()
            % 2
            == 1;
        let inner = &raw[start + 2..end];
        if inner.contains("[[") {
            // 不成立な外側の開始記号で、内側にある有効なWikiリンクまで
            // 飲み込まないよう、次の開始記号を再探索する。
            offset = start + 2;
            continue;
        }
        if !in_code
            && !escaped
            && !inner.trim().is_empty()
            && !inner.contains(']')
            && !inner.contains('\n')
        {
            let raw_target = inner.split_once('|').map_or(inner, |(target, _)| target);
            let target = raw_target
                .split_once('#')
                .map_or(raw_target, |(target, _)| target)
                .trim();
            if !target.is_empty() {
                if target.len() > super::wiki::MAX_WIKI_TARGET_BYTES {
                    truncated = true;
                    offset = candidate_end;
                    continue;
                }
                if targets.len() >= limit {
                    return (targets, true);
                }
                targets.push(target.to_string());
            }
        }
        offset = candidate_end;
    }
    (targets, truncated)
}

fn build_backlink_index(
    backend: &SourceBackend,
    source_id: &str,
    show_hidden_files: bool,
    respect_gitignore: bool,
    roots: &AllowedRoots,
) -> Result<CachedBacklinkIndex, String> {
    // 解決候補は前方Wikiリンクと同じく隠し文書も含める。表示設定は参照元を
    // 一覧へ出すかだけに適用し、隠し文書の存在で解決先が変わる規則を維持する。
    let (mut candidate_paths, paths_truncated) = collect_source_markdown_paths_with_status(
        backend,
        true,
        respect_gitignore && backend.capabilities().respect_gitignore,
        roots,
        MAX_ARCHIVE_ENTRIES,
    )?;
    candidate_paths.sort_by_key(|path| path.to_lowercase());
    let mut paths = if show_hidden_files {
        candidate_paths.clone()
    } else {
        collect_source_markdown_paths(
            backend,
            false,
            respect_gitignore && backend.capabilities().respect_gitignore,
            roots,
        )?
    };
    paths.sort_by_key(|path| path.to_lowercase());
    let files = super::wiki::WikiFileIndex::new(&candidate_paths);
    let mut by_target: HashMap<String, Vec<BacklinkResult>> = HashMap::new();
    let mut total_bytes = 0usize;
    let mut total_compressed_bytes = 0u64;
    let mut total_references = 0usize;
    let mut inspections = 0usize;
    let mut truncated = paths_truncated;
    let mut zip_archive = match backend {
        SourceBackend::Zip(source) => Some(
            source
                .archive
                .lock()
                .map_err(|_| "ZIPアーカイブのロックに失敗しました".to_string())?,
        ),
        SourceBackend::Native(_) => None,
    };

    'documents: for path in paths {
        if let SourceBackend::Zip(source) = backend {
            total_compressed_bytes = total_compressed_bytes.saturating_add(
                source
                    .entries
                    .get(&path)
                    .map(|entry| entry.compressed_size)
                    .unwrap_or_default(),
            );
            if total_compressed_bytes > MAX_SEARCH_TOTAL_COMPRESSED_BYTES {
                truncated = true;
                break;
            }
        }
        let raw = match read_source_text(backend, &path, roots, zip_archive.as_deref_mut()) {
            Ok(raw) => raw,
            Err(_) => {
                truncated = true;
                continue;
            }
        };
        total_bytes = total_bytes.saturating_add(raw.len());
        if total_bytes > MAX_SEARCH_TOTAL_BYTES {
            truncated = true;
            break;
        }
        let remaining = MAX_BACKLINK_REFERENCES.saturating_sub(total_references);
        let (targets, targets_truncated) = extract_wiki_targets(&raw, remaining);
        total_references = total_references.saturating_add(targets.len());
        if targets_truncated {
            truncated = true;
        }
        let mut counts = HashMap::<String, usize>::new();
        for target in targets {
            *counts.entry(target).or_default() += 1;
        }
        let current_dir = super::wiki::parent_components_lower(&path);
        let mut resolved_counts = HashMap::<String, usize>::new();
        let mut stop_after_document = false;
        for (target, reference_count) in counts {
            let resolved = match files.resolve_target(
                &target,
                &current_dir,
                &mut inspections,
                MAX_BACKLINK_CANDIDATE_INSPECTIONS,
            ) {
                Ok(resolved) => resolved,
                Err(_) => {
                    truncated = true;
                    stop_after_document = true;
                    break;
                }
            };
            let Some(resolved) = resolved else {
                continue;
            };
            if resolved == path {
                continue;
            }
            *resolved_counts.entry(resolved).or_default() += reference_count;
        }
        for (resolved, reference_count) in resolved_counts {
            by_target.entry(resolved).or_default().push(BacklinkResult {
                document: DocumentRef {
                    source_id: source_id.to_string(),
                    path: path.clone(),
                },
                file_path: path.clone(),
                reference_count,
            });
        }
        if stop_after_document {
            break 'documents;
        }
        if total_references >= MAX_BACKLINK_REFERENCES {
            truncated = true;
            break;
        }
    }
    for results in by_target.values_mut() {
        results.sort_by_key(|result| result.file_path.to_lowercase());
    }
    Ok(CachedBacklinkIndex {
        created_at: Instant::now(),
        by_target,
        truncated,
    })
}

#[tauri::command]
pub async fn list_source_backlinks(
    document: DocumentRef,
    show_hidden_files: bool,
    respect_gitignore: bool,
    force_refresh: bool,
    roots: State<'_, AllowedRoots>,
    registry: State<'_, SourceRegistry>,
    indexes: State<'_, BacklinkIndexState>,
) -> Result<BacklinkResponse, String> {
    let roots = roots.inner().clone();
    let registry = registry.inner().clone();
    let indexes = indexes.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = normalize_virtual_path(&document.path)?;
        if !is_markdown_virtual_path(&path) {
            return Err("Markdown文書を指定してください".to_string());
        }
        let (backend, generation) = registry.get_with_generation(&document.source_id)?;
        let respect_gitignore = respect_gitignore && backend.capabilities().respect_gitignore;
        let key = BacklinkCacheKey {
            source_id: document.source_id.clone(),
            generation,
            show_hidden_files,
            respect_gitignore,
        };
        let index = match indexes.cached_or_reserve(&key, force_refresh)? {
            Some(index) => index,
            None => indexes.finish(
                key,
                build_backlink_index(
                    &backend,
                    &document.source_id,
                    show_hidden_files,
                    respect_gitignore,
                    &roots,
                ),
            )?,
        };
        Ok(BacklinkResponse {
            results: index.by_target.get(&path).cloned().unwrap_or_default(),
            truncated: index.truncated,
        })
    })
    .await
    .map_err(|error| format!("バックリンクの取得に失敗しました: {error}"))?
}

#[tauri::command]
pub async fn search_source(
    request_id: u64,
    source_id: String,
    options: SourceSearchOptions,
    roots: State<'_, AllowedRoots>,
    registry: State<'_, SourceRegistry>,
    searches: State<'_, SearchState>,
) -> Result<SourceSearchResponse, String> {
    let roots = roots.inner().clone();
    let registry = registry.inner().clone();
    let searches = searches.inner().clone();
    searches.begin(request_id);

    tauri::async_runtime::spawn_blocking(move || {
        let backend = registry.get(&source_id)?;
        if options.query.is_empty() || !searches.is_current(request_id) {
            return Ok(SourceSearchResponse {
                results: Vec::new(),
                truncated: false,
                cancelled: !searches.is_current(request_id),
            });
        }
        let pattern = if options.is_regex {
            options.query
        } else {
            regex::escape(&options.query)
        };
        let regex = RegexBuilder::new(&pattern)
            .case_insensitive(!options.case_sensitive)
            .build()
            .map_err(|error| error.to_string())?;
        let paths = collect_source_markdown_paths(
            &backend,
            options.show_hidden_files,
            options.respect_gitignore && backend.capabilities().respect_gitignore,
            &roots,
        )?;
        let mut results = Vec::new();
        let mut total_matches = 0usize;
        let mut total_bytes = 0usize;
        let mut total_compressed_bytes = 0u64;
        let mut truncated = false;
        // ZIPは検索全体で同じファイルハンドルと中央ディレクトリを再利用する。
        // エントリごとの再オープンは最大10,000回の中央ディレクトリ再解析になるため避ける。
        let mut zip_archive = match backend.as_ref() {
            SourceBackend::Zip(source) => Some(
                source
                    .archive
                    .lock()
                    .map_err(|_| "ZIPアーカイブのロックに失敗しました".to_string())?,
            ),
            SourceBackend::Native(_) => None,
        };
        for path in paths {
            if !searches.is_current(request_id) {
                return Ok(SourceSearchResponse {
                    results,
                    truncated,
                    cancelled: true,
                });
            }
            if results.len() >= MAX_SEARCH_RESULTS {
                truncated = true;
                break;
            }
            if let SourceBackend::Zip(source) = backend.as_ref() {
                let compressed_size = source
                    .entries
                    .get(&path)
                    .map(|entry| entry.compressed_size)
                    .unwrap_or_default();
                total_compressed_bytes = total_compressed_bytes.saturating_add(compressed_size);
                if total_compressed_bytes > MAX_SEARCH_TOTAL_COMPRESSED_BYTES {
                    truncated = true;
                    break;
                }
            }
            let raw = match read_source_text(&backend, &path, &roots, zip_archive.as_deref_mut()) {
                Ok(raw) => raw,
                Err(_) if matches!(backend.as_ref(), SourceBackend::Native(_)) => continue,
                Err(error) => return Err(error),
            };
            total_bytes = total_bytes.saturating_add(raw.len());
            if total_bytes > MAX_SEARCH_TOTAL_BYTES {
                truncated = true;
                break;
            }
            let mut matches = Vec::new();
            for (line_index, line) in raw.lines().enumerate() {
                if regex.is_match(line) {
                    matches.push(SearchMatch {
                        line_number: line_index + 1,
                        line_text: truncate_search_preview(line),
                    });
                    total_matches += 1;
                    if matches.len() >= MAX_MATCHES_PER_FILE || total_matches >= MAX_TOTAL_MATCHES {
                        truncated = true;
                        break;
                    }
                }
            }
            if !matches.is_empty() {
                results.push(SourceSearchResult {
                    document: DocumentRef {
                        source_id: source_id.clone(),
                        path: path.clone(),
                    },
                    file_path: path,
                    matches,
                });
            }
            if total_matches >= MAX_TOTAL_MATCHES {
                break;
            }
        }
        results.sort_by(|left, right| left.file_path.cmp(&right.file_path));
        Ok(SourceSearchResponse {
            results,
            truncated,
            cancelled: false,
        })
    })
    .await
    .map_err(|error| format!("検索処理に失敗しました: {error}"))?
}

#[tauri::command(async)]
pub fn resolve_source_wiki_links(
    document: DocumentRef,
    targets: Vec<String>,
    respect_gitignore: bool,
    roots: State<'_, AllowedRoots>,
    registry: State<'_, SourceRegistry>,
    indexes: State<'_, super::wiki::WikiIndexState>,
) -> Result<HashMap<String, Option<DocumentRef>>, String> {
    let targets = super::wiki::validate_targets(targets)?;
    let backend = registry.get(&document.source_id)?;
    let files = match backend.as_ref() {
        SourceBackend::Native(source) => {
            let root = normalize_path_for_frontend(&source.root)
                .trim_end_matches('/')
                .to_string();
            indexes
                .get_or_build(&source.root, respect_gitignore, &roots)?
                .into_iter()
                .filter_map(|path| {
                    Path::new(&path)
                        .strip_prefix(Path::new(&root))
                        .ok()
                        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
                })
                .collect()
        }
        SourceBackend::Zip(_) => collect_source_markdown_paths(&backend, true, false, &roots)?,
    };
    let current_dir = super::wiki::parent_components_lower(&document.path);
    Ok(super::wiki::resolve_targets(targets, &files, &current_dir)?
        .into_iter()
        .map(|(target, resolved)| {
            (
                target,
                resolved.map(|path| DocumentRef {
                    source_id: document.source_id.clone(),
                    path,
                }),
            )
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn virtual_path_normalization_rejects_root_escape_and_absolute_paths() {
        assert_eq!(
            normalize_virtual_path("guide/./readme.md").unwrap(),
            "guide/readme.md"
        );
        assert_eq!(
            normalize_virtual_path("guide/../readme.md").unwrap(),
            "readme.md"
        );
        assert!(normalize_virtual_path("../secret.md").is_err());
        assert!(normalize_virtual_path("/secret.md").is_err());
        assert!(normalize_virtual_path("C:/secret.md").is_err());
        assert!(normalize_virtual_path("bad\0name.md").is_err());
        assert!(normalize_virtual_path("bad\\name.md").is_err());
    }

    #[test]
    fn registry_reuses_native_root_and_rejects_unknown_ids() {
        let registry = SourceRegistry::new();
        let root = tempfile::tempdir().unwrap().path().to_path_buf();
        let first = registry.register_native(root.clone()).unwrap();
        let second = registry.register_native(root).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(registry.get(&first.id).unwrap().kind(), "native");
        assert!(registry.get("unknown").is_err());
    }

    #[test]
    fn native_source_lists_virtual_paths_without_windows_verbatim_prefix() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir(directory.path().join("docs")).unwrap();
        std::fs::write(directory.path().join("README.md"), "# Native").unwrap();
        let roots = AllowedRoots::new();
        roots.register(&directory.path().to_string_lossy()).unwrap();
        let source = NativeSource {
            root: roots.resolve(&directory.path().to_string_lossy()).unwrap(),
        };
        let root = DocumentRef {
            source_id: "native-test".to_string(),
            path: String::new(),
        };

        let entries = list_native_entries(&source, &root, false, &roots).unwrap();
        assert!(entries
            .iter()
            .any(|entry| entry.path == "docs" && entry.is_dir));
        assert!(entries
            .iter()
            .any(|entry| entry.path == "README.md" && !entry.is_dir));
        assert!(entries
            .iter()
            .all(|entry| !entry.path.contains("//?/") && !entry.path.contains("\\\\?\\")));
    }

    fn create_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, content) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(content).unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn wiki_target_extraction_ignores_code_and_same_document_anchors() {
        let raw = "[[Target]] [[Target#Heading|Alias]] [[#Local]] \\[[Escaped]] `[[InlineCode]]`\n\n<!-- [[Comment]] -->\n\n```md\n[[FencedCode]]\n```\n\n```\n[[UnclosedCode]]";
        let (targets, truncated) = extract_wiki_targets(raw, 10);
        assert_eq!(targets, vec!["Target", "Target"]);
        assert!(!truncated);

        let (limited, truncated) = extract_wiki_targets("[[A]] [[B]]", 1);
        assert_eq!(limited, vec!["A"]);
        assert!(truncated);

        let (after_malformed, truncated) = extract_wiki_targets("[[unclosed\n[[Valid]]", 10);
        assert_eq!(after_malformed, vec!["Valid"]);
        assert!(!truncated);

        let oversized = format!("[[{}]] [[Valid]]", "x".repeat(1_025));
        let (after_oversized, truncated) = extract_wiki_targets(&oversized, 10);
        assert_eq!(after_oversized, vec!["Valid"]);
        assert!(truncated);
    }

    #[test]
    fn backlink_cache_rejects_duplicate_builds_and_recovers_after_failure() {
        let state = BacklinkIndexState::new();
        let key = BacklinkCacheKey {
            source_id: "source".to_string(),
            generation: 1,
            show_hidden_files: false,
            respect_gitignore: true,
        };
        assert!(state.cached_or_reserve(&key, false).unwrap().is_none());
        assert!(state.cached_or_reserve(&key, false).is_err());
        let mut other_key = key.clone();
        other_key.source_id = "other".to_string();
        assert!(state.cached_or_reserve(&other_key, false).is_err());
        assert!(state
            .finish(key.clone(), Err("failed".to_string()))
            .is_err());
        assert!(state.cached_or_reserve(&key, false).unwrap().is_none());

        let index = CachedBacklinkIndex {
            created_at: Instant::now(),
            by_target: HashMap::new(),
            truncated: false,
        };
        state.finish(key.clone(), Ok(index)).unwrap();
        assert!(state.cached_or_reserve(&key, false).unwrap().is_some());
        assert!(state.cached_or_reserve(&key, true).unwrap().is_none());
    }

    #[test]
    fn native_backlink_index_counts_only_links_resolving_to_the_target() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir(directory.path().join("sub")).unwrap();
        std::fs::create_dir(directory.path().join(".hidden")).unwrap();
        std::fs::write(directory.path().join("target.md"), "# Root target").unwrap();
        std::fs::write(directory.path().join("sub/target.md"), "# Nested target").unwrap();
        std::fs::write(
            directory.path().join("ref.md"),
            "[[target]] [[Target#Heading|Alias]] [[target.md]] `[[target]]`",
        )
        .unwrap();
        std::fs::write(directory.path().join("sub/ref.md"), "[[target]]").unwrap();
        std::fs::write(
            directory.path().join(".hidden/target.md"),
            "# Hidden target",
        )
        .unwrap();
        std::fs::write(directory.path().join("hidden-ref.md"), "[[.hidden/target]]").unwrap();
        let roots = AllowedRoots::new();
        roots.register(&directory.path().to_string_lossy()).unwrap();
        let backend = SourceBackend::Native(NativeSource {
            root: roots.resolve(&directory.path().to_string_lossy()).unwrap(),
        });

        let index = build_backlink_index(&backend, "native", false, false, &roots).unwrap();
        assert_eq!(
            index.by_target.get("target.md"),
            Some(&vec![BacklinkResult {
                document: DocumentRef {
                    source_id: "native".to_string(),
                    path: "ref.md".to_string(),
                },
                file_path: "ref.md".to_string(),
                reference_count: 3,
            }])
        );
        assert_eq!(
            index.by_target["sub/target.md"][0].document.path,
            "sub/ref.md"
        );
        assert_eq!(
            index.by_target[".hidden/target.md"][0].document.path,
            "hidden-ref.md"
        );
        assert!(!index.truncated);
    }

    #[test]
    fn native_markdown_collection_reports_entry_limit() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("one.md"), "# One").unwrap();
        let roots = AllowedRoots::new();
        roots.register(&directory.path().to_string_lossy()).unwrap();
        let backend = SourceBackend::Native(NativeSource {
            root: roots.resolve(&directory.path().to_string_lossy()).unwrap(),
        });

        let (_, truncated) =
            collect_source_markdown_paths_with_status(&backend, true, false, &roots, 1).unwrap();
        assert!(truncated);
    }

    #[test]
    fn zip_backlink_index_uses_virtual_documents() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("backlinks.zip");
        create_zip(
            &archive_path,
            &[("target.md", b"# Target"), ("guide/ref.md", b"[[target]]")],
        );
        let roots = AllowedRoots::new();
        roots
            .register_zip_file(&archive_path.to_string_lossy())
            .unwrap();
        let backend = SourceBackend::Zip(
            build_zip_source(
                roots.resolve(&archive_path.to_string_lossy()).unwrap(),
                &roots,
            )
            .unwrap(),
        );

        let index = build_backlink_index(&backend, "zip", true, false, &roots).unwrap();
        assert_eq!(index.by_target["target.md"][0].document.source_id, "zip");
        assert_eq!(
            index.by_target["target.md"][0].document.path,
            "guide/ref.md"
        );
        assert!(!index.truncated);
    }

    #[test]
    fn zip_source_lists_implicit_directories_and_reads_markdown() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("docs.zip");
        create_zip(
            &archive_path,
            &[
                ("guide/readme.md", b"# ZIP document"),
                ("guide/image.png", b"not-a-real-png"),
                ("ignored.txt", b"ignored"),
            ],
        );
        let sibling = directory.path().join("secret.md");
        std::fs::write(&sibling, "secret").unwrap();
        let roots = AllowedRoots::new();
        roots
            .register_zip_file(&archive_path.to_string_lossy())
            .unwrap();
        assert!(roots.resolve(&sibling.to_string_lossy()).is_err());
        let source = build_zip_source(
            roots.resolve(&archive_path.to_string_lossy()).unwrap(),
            &roots,
        )
        .unwrap();
        let root = DocumentRef {
            source_id: "zip-test".to_string(),
            path: String::new(),
        };
        let root_entries = list_zip_entries(&source, &root);
        assert_eq!(root_entries.len(), 1);
        assert_eq!(root_entries[0].name, "guide");
        assert!(root_entries[0].is_dir);

        let guide = DocumentRef {
            source_id: "zip-test".to_string(),
            path: "guide".to_string(),
        };
        let guide_entries = list_zip_entries(&source, &guide);
        assert_eq!(guide_entries.len(), 1);
        assert_eq!(guide_entries[0].name, "readme.md");
        let bytes = read_zip_entry(&source, "guide/readme.md", MAX_MARKDOWN_BYTES, &roots).unwrap();
        assert_eq!(bytes, b"# ZIP document");

        let registry = SourceRegistry::new();
        let registered = registry.register_zip(source.clone()).unwrap();
        assert_eq!(registered.generation, 0);
        let reloaded = registry.replace_zip(&registered.id, source).unwrap();
        assert_eq!(reloaded.generation, 1);
    }

    #[test]
    fn zip_markdown_uses_expanded_size_for_large_file_confirmation() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("large-markdown.zip");
        let expanded_size = 6 * 1024 * 1024;
        let mut markdown = Vec::with_capacity(expanded_size);
        let mut line_number = 0u64;
        while markdown.len() < expanded_size {
            writeln!(
                markdown,
                "line {line_number:08x}: archive size checks use expanded markdown bytes"
            )
            .unwrap();
            line_number += 1;
        }
        markdown.truncate(expanded_size);

        let file = File::create(&archive_path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file(
                "large.md",
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
            )
            .unwrap();
        writer.write_all(&markdown).unwrap();
        writer.finish().unwrap();

        let roots = AllowedRoots::new();
        roots
            .register_zip_file(&archive_path.to_string_lossy())
            .unwrap();
        let source = build_zip_source(
            roots.resolve(&archive_path.to_string_lossy()).unwrap(),
            &roots,
        )
        .unwrap();
        let entry = source.entries.get("large.md").unwrap();
        assert!(entry.compressed_size < entry.uncompressed_size);

        let bytes = read_zip_entry(&source, "large.md", MAX_MARKDOWN_BYTES, &roots).unwrap();
        let byte_size = bytes.len() as u64;
        let raw = String::from_utf8(bytes).unwrap();
        let content = build_markdown_content(raw, byte_size);

        assert_eq!(content.byte_size, expanded_size as u64);
        assert!(content.requires_confirmation);
    }

    #[test]
    fn registering_same_zip_replaces_stale_index_and_increments_generation() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("replace.zip");
        create_zip(&archive_path, &[("first.md", b"first")]);
        let roots = AllowedRoots::new();
        roots
            .register_zip_file(&archive_path.to_string_lossy())
            .unwrap();
        let canonical = roots.resolve(&archive_path.to_string_lossy()).unwrap();
        let registry = SourceRegistry::new();
        let first = registry
            .register_zip(build_zip_source(canonical.clone(), &roots).unwrap())
            .unwrap();

        create_zip(&archive_path, &[("second.md", b"second")]);
        let second = registry
            .register_zip(build_zip_source(canonical, &roots).unwrap())
            .unwrap();

        assert_eq!(second.id, first.id);
        assert_eq!(second.generation, first.generation + 1);
        let backend = registry.get(&second.id).unwrap();
        let SourceBackend::Zip(source) = backend.as_ref() else {
            panic!("ZIP source expected");
        };
        assert!(!source.entries.contains_key("first.md"));
        assert!(source.entries.contains_key("second.md"));
    }

    #[test]
    fn zip_markdown_collection_respects_hidden_file_setting() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("hidden.zip");
        create_zip(
            &archive_path,
            &[
                ("visible.md", b"visible"),
                (".private/hidden.md", b"hidden"),
            ],
        );
        let roots = AllowedRoots::new();
        roots
            .register_zip_file(&archive_path.to_string_lossy())
            .unwrap();
        let backend = SourceBackend::Zip(
            build_zip_source(
                roots.resolve(&archive_path.to_string_lossy()).unwrap(),
                &roots,
            )
            .unwrap(),
        );

        let visible_only = collect_source_markdown_paths(&backend, false, false, &roots).unwrap();
        assert_eq!(visible_only, vec!["visible.md"]);
        let with_hidden = collect_source_markdown_paths(&backend, true, false, &roots).unwrap();
        assert_eq!(with_hidden.len(), 2);
    }

    #[test]
    fn source_markdown_documents_are_sorted_and_keep_source_identity() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("documents.zip");
        create_zip(
            &archive_path,
            &[("z-last.md", b"last"), ("docs/A-first.markdown", b"first")],
        );
        let roots = AllowedRoots::new();
        roots
            .register_zip_file(&archive_path.to_string_lossy())
            .unwrap();
        let backend = SourceBackend::Zip(
            build_zip_source(
                roots.resolve(&archive_path.to_string_lossy()).unwrap(),
                &roots,
            )
            .unwrap(),
        );

        let documents =
            source_markdown_documents(&backend, "quick-open", true, false, &roots).unwrap();
        assert_eq!(
            documents,
            vec![
                DocumentRef {
                    source_id: "quick-open".to_string(),
                    path: "docs/A-first.markdown".to_string(),
                },
                DocumentRef {
                    source_id: "quick-open".to_string(),
                    path: "z-last.md".to_string(),
                },
            ]
        );
    }

    #[test]
    fn native_markdown_collection_reports_deleted_root() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().to_path_buf();
        let roots = AllowedRoots::new();
        roots.register(&root.to_string_lossy()).unwrap();
        let backend = SourceBackend::Native(NativeSource {
            root: roots.resolve(&root.to_string_lossy()).unwrap(),
        });
        directory.close().unwrap();

        let error = source_markdown_documents(&backend, "deleted", true, false, &roots)
            .expect_err("削除済みルートの走査は失敗として報告する必要がある");
        assert!(error.contains("Markdown一覧の走査に失敗しました"));
    }

    #[test]
    fn zip_source_rejects_parent_traversal_entries() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("unsafe.zip");
        create_zip(&archive_path, &[("../secret.md", b"secret")]);
        let roots = AllowedRoots::new();
        roots
            .register_zip_file(&archive_path.to_string_lossy())
            .unwrap();
        let canonical = roots.resolve(&archive_path.to_string_lossy()).unwrap();
        assert!(build_zip_source(canonical, &roots).is_err());
    }

    #[test]
    fn zip_source_supports_utf8_names_and_empty_archives() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("日本語.zip");
        create_zip(&archive_path, &[("資料/案内.md", "# 案内".as_bytes())]);
        let roots = AllowedRoots::new();
        roots
            .register_zip_file(&archive_path.to_string_lossy())
            .unwrap();
        let source = build_zip_source(
            roots.resolve(&archive_path.to_string_lossy()).unwrap(),
            &roots,
        )
        .unwrap();
        assert!(source.entries.contains_key("資料/案内.md"));

        let empty_path = directory.path().join("empty.zip");
        create_zip(&empty_path, &[]);
        roots
            .register_zip_file(&empty_path.to_string_lossy())
            .unwrap();
        let empty = build_zip_source(
            roots.resolve(&empty_path.to_string_lossy()).unwrap(),
            &roots,
        )
        .unwrap();
        assert!(empty.entries.is_empty());
    }

    #[test]
    fn zip_source_rejects_corrupt_and_case_colliding_archives() {
        let directory = tempfile::tempdir().unwrap();
        let corrupt_path = directory.path().join("corrupt.zip");
        std::fs::write(&corrupt_path, b"not a zip").unwrap();
        let roots = AllowedRoots::new();
        roots
            .register_zip_file(&corrupt_path.to_string_lossy())
            .unwrap();
        assert!(build_zip_source(
            roots.resolve(&corrupt_path.to_string_lossy()).unwrap(),
            &roots
        )
        .is_err());

        let duplicate_path = directory.path().join("duplicate.zip");
        create_zip(
            &duplicate_path,
            &[("Guide.md", b"first"), ("guide.md", b"second")],
        );
        roots
            .register_zip_file(&duplicate_path.to_string_lossy())
            .unwrap();
        assert!(build_zip_source(
            roots.resolve(&duplicate_path.to_string_lossy()).unwrap(),
            &roots
        )
        .is_err());

        let collision_path = directory.path().join("file-directory-collision.zip");
        create_zip(
            &collision_path,
            &[("guide", b"file"), ("guide/readme.md", b"# nested")],
        );
        roots
            .register_zip_file(&collision_path.to_string_lossy())
            .unwrap();
        assert!(build_zip_source(
            roots.resolve(&collision_path.to_string_lossy()).unwrap(),
            &roots
        )
        .is_err());

        let implicit_case_collision = directory.path().join("implicit-case-collision.zip");
        create_zip(
            &implicit_case_collision,
            &[("A/one.md", b"one"), ("a/two.md", b"two")],
        );
        roots
            .register_zip_file(&implicit_case_collision.to_string_lossy())
            .unwrap();
        assert!(build_zip_source(
            roots
                .resolve(&implicit_case_collision.to_string_lossy())
                .unwrap(),
            &roots
        )
        .is_err());
    }

    #[test]
    fn zip_source_rejects_overlapping_compressed_data_ranges() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("overlap.zip");
        create_zip(&archive_path, &[("one.md", b"same"), ("two.md", b"same")]);
        let mut bytes = std::fs::read(&archive_path).unwrap();
        let central_headers = bytes
            .windows(4)
            .enumerate()
            .filter_map(|(index, window)| (window == b"PK\x01\x02").then_some(index))
            .collect::<Vec<_>>();
        assert_eq!(central_headers.len(), 2);
        let first_local_offset = bytes[central_headers[0] + 42..central_headers[0] + 46].to_vec();
        bytes[central_headers[1] + 42..central_headers[1] + 46]
            .copy_from_slice(&first_local_offset);
        std::fs::write(&archive_path, bytes).unwrap();
        let roots = AllowedRoots::new();
        roots
            .register_zip_file(&archive_path.to_string_lossy())
            .unwrap();

        assert!(build_zip_source(
            roots.resolve(&archive_path.to_string_lossy()).unwrap(),
            &roots
        )
        .is_err());
    }

    #[test]
    fn zip_preflight_rejects_large_zip64_extensible_data_sector() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("zip64-extensible.zip");
        let mut bytes = vec![0u8; 98];
        bytes[0..4].copy_from_slice(b"PK\x06\x06");
        bytes[4..12].copy_from_slice(&(44 + MAX_ZIP64_EXTENSIBLE_DATA_BYTES + 1).to_le_bytes());
        bytes[56..60].copy_from_slice(b"PK\x06\x07");
        bytes[72..76].copy_from_slice(&1u32.to_le_bytes());
        bytes[76..80].copy_from_slice(b"PK\x05\x06");
        bytes[84..86].copy_from_slice(&u16::MAX.to_le_bytes());
        bytes[86..88].copy_from_slice(&u16::MAX.to_le_bytes());
        bytes[88..92].copy_from_slice(&u32::MAX.to_le_bytes());
        bytes[92..96].copy_from_slice(&u32::MAX.to_le_bytes());
        std::fs::write(&archive_path, bytes).unwrap();
        let mut file = File::open(&archive_path).unwrap();

        assert!(preflight_zip_directory(&mut file, 98).is_err());
    }

    #[test]
    fn zip_preflight_rejects_ambiguous_eocd_inside_comment() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("ambiguous-eocd.zip");
        create_zip(&archive_path, &[("note.md", b"note")]);
        let mut bytes = std::fs::read(&archive_path).unwrap();
        let real_eocd = bytes
            .windows(4)
            .rposition(|window| window == b"PK\x05\x06")
            .unwrap();
        bytes[real_eocd + 20..real_eocd + 22].copy_from_slice(&22u16.to_le_bytes());
        let mut fake_eocd = vec![0u8; 22];
        fake_eocd[..4].copy_from_slice(b"PK\x05\x06");
        fake_eocd[8..10].copy_from_slice(&1u16.to_le_bytes());
        fake_eocd[10..12].copy_from_slice(&1u16.to_le_bytes());
        bytes.extend(fake_eocd);
        std::fs::write(&archive_path, bytes).unwrap();
        let mut file = File::open(&archive_path).unwrap();
        let file_size = file.metadata().unwrap().len();

        assert!(preflight_zip_directory(&mut file, file_size).is_err());
    }

    #[test]
    fn zip_eocd_scan_rejects_dense_signatures_without_collecting_them() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("dense-eocd-signatures.zip");
        let mut bytes = Vec::with_capacity(1024 * 1024);
        while bytes.len() < 1024 * 1024 {
            let mut eocd = [0u8; 22];
            eocd[..4].copy_from_slice(b"PK\x05\x06");
            bytes.extend_from_slice(&eocd);
        }
        std::fs::write(&archive_path, &bytes).unwrap();
        let mut file = File::open(&archive_path).unwrap();

        assert!(find_single_eocd_candidate(&mut file, bytes.len() as u64).is_err());
    }

    #[test]
    fn zip_preflight_rejects_trailing_fake_eocd_that_zip_parser_would_skip() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("trailing-fake-eocd.zip");
        create_zip(&archive_path, &[("note.md", b"note")]);
        let mut bytes = std::fs::read(&archive_path).unwrap();
        let fake_offset = u32::try_from(bytes.len()).unwrap();
        let mut fake_eocd = vec![0u8; 22];
        fake_eocd[..4].copy_from_slice(b"PK\x05\x06");
        fake_eocd[8..10].copy_from_slice(&1u16.to_le_bytes());
        fake_eocd[10..12].copy_from_slice(&1u16.to_le_bytes());
        fake_eocd[16..20].copy_from_slice(&fake_offset.to_le_bytes());
        bytes.extend(fake_eocd);
        std::fs::write(&archive_path, bytes).unwrap();
        let mut file = File::open(&archive_path).unwrap();
        let file_size = file.metadata().unwrap().len();

        assert!(preflight_zip_directory(&mut file, file_size).is_err());
    }

    #[test]
    fn zip_preflight_rejects_fake_eocd_that_would_fallback_after_partial_directory() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("partial-directory-fallback.zip");
        create_zip(&archive_path, &[("one.md", b"one"), ("two.md", b"two")]);
        let mut bytes = std::fs::read(&archive_path).unwrap();
        let last_central = bytes
            .windows(4)
            .rposition(|window| window == b"PK\x01\x02")
            .unwrap();
        // ZIP crateの通常EOCD探索窓より広いpaddingでも、前方の候補を見落とさない。
        bytes.extend(vec![0u8; 70_000]);
        let fake_offset = bytes.len();
        let mut fake_eocd = vec![0u8; 22];
        fake_eocd[..4].copy_from_slice(b"PK\x05\x06");
        fake_eocd[8..10].copy_from_slice(&2u16.to_le_bytes());
        fake_eocd[10..12].copy_from_slice(&2u16.to_le_bytes());
        fake_eocd[12..16].copy_from_slice(
            &u32::try_from(fake_offset - last_central)
                .unwrap()
                .to_le_bytes(),
        );
        fake_eocd[16..20].copy_from_slice(&u32::try_from(last_central).unwrap().to_le_bytes());
        bytes.extend(fake_eocd);
        std::fs::write(&archive_path, bytes).unwrap();
        let mut file = File::open(&archive_path).unwrap();
        let file_size = file.metadata().unwrap().len();

        assert!(preflight_zip_directory(&mut file, file_size).is_err());
    }

    #[test]
    fn zip_source_rejects_excessively_deep_paths() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("deep.zip");
        let path = format!(
            "{}/note.md",
            vec!["a"; MAX_VIRTUAL_PATH_COMPONENTS].join("/")
        );
        create_zip(&archive_path, &[(path.as_str(), b"deep")]);
        let roots = AllowedRoots::new();
        roots
            .register_zip_file(&archive_path.to_string_lossy())
            .unwrap();
        assert!(build_zip_source(
            roots.resolve(&archive_path.to_string_lossy()).unwrap(),
            &roots
        )
        .is_err());
    }

    #[test]
    fn zip_source_rejects_excessive_aggregate_ancestor_work() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("aggregate-depth.zip");
        let file = File::create(&archive_path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        let parent = vec!["abcdefghijklmn"; MAX_VIRTUAL_PATH_COMPONENTS - 1].join("/");
        for index in 0..150 {
            writer
                .start_file(format!("{parent}/{index}.md"), options)
                .unwrap();
        }
        writer.finish().unwrap();
        let roots = AllowedRoots::new();
        roots
            .register_zip_file(&archive_path.to_string_lossy())
            .unwrap();

        assert!(build_zip_source(
            roots.resolve(&archive_path.to_string_lossy()).unwrap(),
            &roots
        )
        .is_err());
    }

    #[test]
    fn zip_read_rejects_declared_size_that_differs_from_expanded_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("size-mismatch.zip");
        create_zip(&archive_path, &[("note.md", b"hello")]);
        let mut bytes = std::fs::read(&archive_path).unwrap();
        let central = bytes
            .windows(4)
            .position(|window| window == b"PK\x01\x02")
            .unwrap();
        bytes[central + 24..central + 28].copy_from_slice(&1u32.to_le_bytes());
        std::fs::write(&archive_path, bytes).unwrap();
        let roots = AllowedRoots::new();
        roots
            .register_zip_file(&archive_path.to_string_lossy())
            .unwrap();
        let source = build_zip_source(
            roots.resolve(&archive_path.to_string_lossy()).unwrap(),
            &roots,
        )
        .unwrap();

        assert!(read_zip_entry(&source, "note.md", MAX_MARKDOWN_BYTES, &roots).is_err());
    }

    #[test]
    fn zip_source_rejects_symlinks_and_extreme_compression_ratios() {
        let directory = tempfile::tempdir().unwrap();
        let symlink_path = directory.path().join("symlink.zip");
        let file = File::create(&symlink_path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .add_symlink(
                "link.md",
                "target.md",
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
            )
            .unwrap();
        writer.finish().unwrap();
        let roots = AllowedRoots::new();
        roots
            .register_zip_file(&symlink_path.to_string_lossy())
            .unwrap();
        assert!(build_zip_source(
            roots.resolve(&symlink_path.to_string_lossy()).unwrap(),
            &roots
        )
        .is_err());

        let ratio_path = directory.path().join("ratio.zip");
        let file = File::create(&ratio_path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file(
                "large.md",
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
            )
            .unwrap();
        writer.write_all(&vec![b'a'; 2 * 1024 * 1024]).unwrap();
        writer.finish().unwrap();
        roots
            .register_zip_file(&ratio_path.to_string_lossy())
            .unwrap();
        assert!(build_zip_source(
            roots.resolve(&ratio_path.to_string_lossy()).unwrap(),
            &roots
        )
        .is_err());
    }

    #[test]
    fn zip_read_revalidates_entry_identity_after_archive_replacement() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("replace.zip");
        create_zip(&archive_path, &[("first.md", b"first")]);
        let roots = AllowedRoots::new();
        roots
            .register_zip_file(&archive_path.to_string_lossy())
            .unwrap();
        let source = build_zip_source(
            roots.resolve(&archive_path.to_string_lossy()).unwrap(),
            &roots,
        )
        .unwrap();

        create_zip(&archive_path, &[("second.md", b"second")]);

        assert!(read_zip_entry(&source, "first.md", MAX_MARKDOWN_BYTES, &roots).is_err());
    }

    #[test]
    fn zip_source_supports_zip64_entries() {
        let directory = tempfile::tempdir().unwrap();
        let archive_path = directory.path().join("zip64.zip");
        let file = File::create(&archive_path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file(
                "zip64.md",
                SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Stored)
                    .large_file(true),
            )
            .unwrap();
        writer.write_all(b"# ZIP64").unwrap();
        writer.finish().unwrap();
        let roots = AllowedRoots::new();
        roots
            .register_zip_file(&archive_path.to_string_lossy())
            .unwrap();
        let source = build_zip_source(
            roots.resolve(&archive_path.to_string_lossy()).unwrap(),
            &roots,
        )
        .unwrap();

        assert_eq!(
            read_zip_entry(&source, "zip64.md", MAX_MARKDOWN_BYTES, &roots).unwrap(),
            b"# ZIP64"
        );
    }

    #[test]
    fn zip_source_rejects_unsupported_compression_and_too_many_entries() {
        let directory = tempfile::tempdir().unwrap();
        let unsupported_path = directory.path().join("unsupported.zip");
        create_zip(&unsupported_path, &[("note.md", b"unsupported")]);
        let mut bytes = std::fs::read(&unsupported_path).unwrap();
        for (signature, method_offset) in [
            ([0x50, 0x4b, 0x03, 0x04], 8),
            ([0x50, 0x4b, 0x01, 0x02], 10),
        ] {
            if let Some(index) = bytes
                .windows(signature.len())
                .position(|window| window == signature)
            {
                bytes[index + method_offset..index + method_offset + 2]
                    .copy_from_slice(&99u16.to_le_bytes());
            }
        }
        std::fs::write(&unsupported_path, bytes).unwrap();
        let roots = AllowedRoots::new();
        roots
            .register_zip_file(&unsupported_path.to_string_lossy())
            .unwrap();
        assert!(build_zip_source(
            roots.resolve(&unsupported_path.to_string_lossy()).unwrap(),
            &roots
        )
        .is_err());

        let many_path = directory.path().join("many.zip");
        let file = File::create(&many_path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for index in 0..=MAX_ARCHIVE_ENTRIES {
            writer.start_file(format!("{index}.md"), options).unwrap();
        }
        writer.finish().unwrap();
        roots
            .register_zip_file(&many_path.to_string_lossy())
            .unwrap();
        assert!(
            build_zip_source(roots.resolve(&many_path.to_string_lossy()).unwrap(), &roots).is_err()
        );
    }
}
