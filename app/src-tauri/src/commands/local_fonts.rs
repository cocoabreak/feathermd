use crate::commands::file::NativeDialogState;
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{ipc::Response, AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

const FONT_DIR: &str = "local-fonts";
const CONTAINER_MAGIC: &[u8; 8] = b"FMDLF001";
const CONTAINER_HEADER_LEN: usize = 8 + 4 + 8;
const MAX_FONT_BYTES: usize = 32 * 1024 * 1024;
const MAX_METADATA_BYTES: usize = 16 * 1024;
const MAX_CONTAINER_BYTES: usize = CONTAINER_HEADER_LEN + MAX_METADATA_BYTES + MAX_FONT_BYTES;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalFontSlot {
    Body,
    Code,
}

impl LocalFontSlot {
    fn file_name(self) -> &'static str {
        match self {
            Self::Body => "body.slot",
            Self::Code => "code.slot",
        }
    }

    fn temp_file_name(self) -> &'static str {
        match self {
            Self::Body => "body.tmp",
            Self::Code => "code.tmp",
        }
    }

    fn candidate_file_name(self) -> &'static str {
        match self {
            Self::Body => "body.candidate",
            Self::Code => "code.candidate",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalFontFormat {
    Woff2,
    Ttf,
    Otf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFontInfo {
    pub original_file_name: String,
    pub format: LocalFontFormat,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFontSlotStatus {
    info: Option<LocalFontInfo>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LocalFontStatus {
    body: LocalFontSlotStatus,
    code: LocalFontSlotStatus,
}

pub struct LocalFontState(Mutex<()>);

impl LocalFontState {
    pub fn new() -> Self {
        Self(Mutex::new(()))
    }
}

struct ParsedContainer {
    info: LocalFontInfo,
    font_bytes: Vec<u8>,
}

fn ensure_main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("このウインドウからはローカルフォントを操作できません".to_string());
    }
    Ok(())
}

fn font_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| "ローカルフォント管理領域を解決できません".to_string())?;
    ensure_safe_directory(&app_data)?;
    let dir = app_data.join(FONT_DIR);
    fs::create_dir_all(&dir).map_err(|_| "ローカルフォント管理領域を作成できません".to_string())?;
    ensure_safe_directory(&dir)?;
    Ok(dir)
}

fn ensure_safe_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        fs::create_dir_all(path)
            .map_err(|_| "ローカルフォント管理領域を作成できません".to_string())?;
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| "ローカルフォント管理領域を確認できません".to_string())?;
    if !metadata.is_dir() || is_reparse_or_symlink(&metadata) {
        return Err("ローカルフォント管理領域が安全なディレクトリではありません".to_string());
    }
    Ok(())
}

#[cfg(windows)]
fn is_reparse_or_symlink(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_or_symlink(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

fn validate_existing_file(path: &Path) -> Result<bool, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("ローカルフォント管理ファイルを確認できません".to_string()),
    };
    if !metadata.is_file() || is_reparse_or_symlink(&metadata) {
        return Err("ローカルフォント管理ファイルが安全な通常ファイルではありません".to_string());
    }
    Ok(true)
}

fn format_from_path(path: &Path) -> Result<LocalFontFormat, String> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("woff2") => Ok(LocalFontFormat::Woff2),
        Some("ttf") => Ok(LocalFontFormat::Ttf),
        Some("otf") => Ok(LocalFontFormat::Otf),
        _ => Err("WOFF2、TTF、OTFフォントを選択してください".to_string()),
    }
}

fn validate_signature(format: LocalFontFormat, bytes: &[u8]) -> Result<(), String> {
    let valid = match format {
        LocalFontFormat::Woff2 => bytes.starts_with(b"wOF2"),
        LocalFontFormat::Ttf => {
            bytes.starts_with(&[0x00, 0x01, 0x00, 0x00]) || bytes.starts_with(b"true")
        }
        LocalFontFormat::Otf => bytes.starts_with(b"OTTO"),
    };
    if valid {
        Ok(())
    } else {
        Err("拡張子とフォント形式が一致しないか、フォントが破損しています".to_string())
    }
}

fn read_selected_font(path: &Path) -> Result<ParsedContainer, String> {
    let format = format_from_path(path)?;
    let original_file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "フォントのファイル名を取得できません".to_string())?;
    let file = File::open(path).map_err(|_| "選択したフォントを開けません".to_string())?;
    let source_metadata = file
        .metadata()
        .map_err(|_| "選択したフォントの情報を確認できません".to_string())?;
    if !source_metadata.is_file() {
        return Err("通常のフォントファイルを選択してください".to_string());
    }
    let declared_size = source_metadata.len();
    if declared_size > MAX_FONT_BYTES as u64 {
        return Err("フォントは32 MiB以下にしてください".to_string());
    }
    let mut font_bytes = Vec::with_capacity(declared_size as usize);
    file.take((MAX_FONT_BYTES + 1) as u64)
        .read_to_end(&mut font_bytes)
        .map_err(|_| "選択したフォントを読み込めません".to_string())?;
    if font_bytes.len() > MAX_FONT_BYTES {
        return Err("フォントは32 MiB以下にしてください".to_string());
    }
    validate_signature(format, &font_bytes)?;
    let info = LocalFontInfo {
        original_file_name,
        format,
        size: font_bytes.len() as u64,
    };
    let metadata =
        serde_json::to_vec(&info).map_err(|_| "フォント情報を作成できません".to_string())?;
    if metadata.len() > MAX_METADATA_BYTES {
        return Err("フォントのファイル名が長すぎます".to_string());
    }
    Ok(ParsedContainer { info, font_bytes })
}

fn encode_container(parsed: &ParsedContainer) -> Result<Vec<u8>, String> {
    let metadata =
        serde_json::to_vec(&parsed.info).map_err(|_| "フォント情報を作成できません".to_string())?;
    if metadata.len() > MAX_METADATA_BYTES || parsed.font_bytes.len() > MAX_FONT_BYTES {
        return Err("ローカルフォントの容量上限を超えています".to_string());
    }
    let mut container =
        Vec::with_capacity(CONTAINER_HEADER_LEN + metadata.len() + parsed.font_bytes.len());
    container.extend_from_slice(CONTAINER_MAGIC);
    container.extend_from_slice(&(metadata.len() as u32).to_le_bytes());
    container.extend_from_slice(&(parsed.font_bytes.len() as u64).to_le_bytes());
    container.extend_from_slice(&metadata);
    container.extend_from_slice(&parsed.font_bytes);
    Ok(container)
}

fn parse_container(bytes: &[u8]) -> Result<ParsedContainer, String> {
    if bytes.len() < CONTAINER_HEADER_LEN || &bytes[..8] != CONTAINER_MAGIC {
        return Err("管理コピーの形式が不正です".to_string());
    }
    let metadata_len = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    let font_len = u64::from_le_bytes(bytes[12..20].try_into().unwrap());
    if metadata_len > MAX_METADATA_BYTES || font_len > MAX_FONT_BYTES as u64 {
        return Err("管理コピーの容量が上限を超えています".to_string());
    }
    let expected_len = CONTAINER_HEADER_LEN
        .checked_add(metadata_len)
        .and_then(|value| value.checked_add(font_len as usize))
        .ok_or_else(|| "管理コピーのサイズが不正です".to_string())?;
    if bytes.len() != expected_len {
        return Err("管理コピーが不完全または破損しています".to_string());
    }
    let metadata_end = CONTAINER_HEADER_LEN + metadata_len;
    let info: LocalFontInfo = serde_json::from_slice(&bytes[CONTAINER_HEADER_LEN..metadata_end])
        .map_err(|_| "管理コピーのフォント情報が不正です".to_string())?;
    if info.size != font_len || info.original_file_name.is_empty() {
        return Err("管理コピーのフォント情報が一致しません".to_string());
    }
    let font_bytes = bytes[metadata_end..].to_vec();
    validate_signature(info.format, &font_bytes)?;
    Ok(ParsedContainer { info, font_bytes })
}

fn read_container_file(path: &Path) -> Result<Option<ParsedContainer>, String> {
    if !validate_existing_file(path)? {
        return Ok(None);
    }
    let file = File::open(path).map_err(|_| "管理コピーを開けません".to_string())?;
    let mut bytes = Vec::new();
    file.take((MAX_CONTAINER_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "管理コピーを読み込めません".to_string())?;
    if bytes.len() > MAX_CONTAINER_BYTES {
        return Err("管理コピーの容量が上限を超えています".to_string());
    }
    parse_container(&bytes).map(Some)
}

fn read_slot(dir: &Path, slot: LocalFontSlot) -> Result<Option<ParsedContainer>, String> {
    read_container_file(&dir.join(slot.file_name()))
}

fn write_container_file(
    dir: &Path,
    destination: &Path,
    temporary_file_name: &str,
    parsed: &ParsedContainer,
) -> Result<(), String> {
    let temporary = dir.join(temporary_file_name);
    validate_existing_file(destination)?;
    match fs::symlink_metadata(&temporary) {
        Ok(metadata) => {
            if !metadata.is_file() || is_reparse_or_symlink(&metadata) {
                return Err("一時管理ファイルが安全な通常ファイルではありません".to_string());
            }
            fs::remove_file(&temporary)
                .map_err(|_| "古い一時管理ファイルを削除できません".to_string())?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("一時管理ファイルを確認できません".to_string()),
    }
    let bytes = encode_container(parsed)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "一時管理ファイルを作成できません".to_string())?;
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&temporary);
        return Err(format!("一時管理ファイルを書き込めません: {error}"));
    }
    drop(file);
    if let Err(error) = replace_file(&temporary, destination) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

fn write_slot(dir: &Path, slot: LocalFontSlot, parsed: &ParsedContainer) -> Result<(), String> {
    write_container_file(
        dir,
        &dir.join(slot.file_name()),
        slot.temp_file_name(),
        parsed,
    )
}

fn discard_fixed_file(path: &Path) -> Result<(), String> {
    if validate_existing_file(path)? {
        fs::remove_file(path).map_err(|_| "候補フォントを削除できません".to_string())?;
    }
    Ok(())
}

fn commit_candidate(dir: &Path, slot: LocalFontSlot) -> Result<(), String> {
    let candidate_path = dir.join(slot.candidate_file_name());
    let parsed = read_container_file(&candidate_path)?
        .ok_or_else(|| "候補フォントがありません".to_string())?;
    write_slot(dir, slot, &parsed)?;
    discard_fixed_file(&candidate_path)
}

pub fn cleanup_local_font_candidates(app: &AppHandle) -> Result<(), String> {
    let dir = font_dir(app)?;
    for slot in [LocalFontSlot::Body, LocalFontSlot::Code] {
        discard_fixed_file(&dir.join(slot.candidate_file_name()))?;
        discard_fixed_file(&dir.join(slot.temp_file_name()))?;
    }
    Ok(())
}

#[cfg(windows)]
fn replace_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    if !destination.exists() {
        return fs::rename(temporary, destination)
            .map_err(|_| "管理コピーを確定できません".to_string());
    }
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_IGNORE_MERGE_ERRORS};
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let temporary_wide: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let replaced = unsafe {
        ReplaceFileW(
            destination_wide.as_ptr(),
            temporary_wide.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_IGNORE_MERGE_ERRORS,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if replaced == 0 {
        Err("管理コピーを原子的に置換できません".to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(temporary, destination).map_err(|_| "管理コピーを確定できません".to_string())
}

fn slot_status(dir: &Path, slot: LocalFontSlot) -> LocalFontSlotStatus {
    match read_slot(dir, slot) {
        Ok(Some(parsed)) => LocalFontSlotStatus {
            info: Some(parsed.info),
            error: None,
        },
        Ok(None) => LocalFontSlotStatus {
            info: None,
            error: None,
        },
        Err(error) => LocalFontSlotStatus {
            info: None,
            error: Some(error),
        },
    }
}

#[tauri::command]
pub async fn pick_local_font(
    app: AppHandle,
    window: WebviewWindow,
    slot: LocalFontSlot,
    state: State<'_, LocalFontState>,
    dialogs: State<'_, NativeDialogState>,
) -> Result<Option<LocalFontInfo>, String> {
    ensure_main_window(&window)?;
    let _dialog_guard = dialogs.try_acquire()?;
    let selected = app
        .dialog()
        .file()
        .add_filter("Font", &["woff2", "ttf", "otf"])
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| "選択したフォントのパスを解決できません".to_string())?;
    let parsed = read_selected_font(&path)?;
    let _guard = state
        .0
        .lock()
        .map_err(|_| "ローカルフォント管理を開始できません".to_string())?;
    let dir = font_dir(&app)?;
    let candidate = dir.join(slot.candidate_file_name());
    write_container_file(&dir, &candidate, slot.temp_file_name(), &parsed)?;
    Ok(Some(parsed.info))
}

#[tauri::command]
pub fn get_local_font_status(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, LocalFontState>,
) -> Result<LocalFontStatus, String> {
    ensure_main_window(&window)?;
    let _guard = state
        .0
        .lock()
        .map_err(|_| "ローカルフォント管理を開始できません".to_string())?;
    let dir = font_dir(&app)?;
    Ok(LocalFontStatus {
        body: slot_status(&dir, LocalFontSlot::Body),
        code: slot_status(&dir, LocalFontSlot::Code),
    })
}

#[tauri::command]
pub fn read_local_font(
    app: AppHandle,
    window: WebviewWindow,
    slot: LocalFontSlot,
    state: State<'_, LocalFontState>,
) -> Result<Response, String> {
    ensure_main_window(&window)?;
    let _guard = state
        .0
        .lock()
        .map_err(|_| "ローカルフォント管理を開始できません".to_string())?;
    let dir = font_dir(&app)?;
    let parsed =
        read_slot(&dir, slot)?.ok_or_else(|| "フォントが選択されていません".to_string())?;
    Ok(Response::new(parsed.font_bytes))
}

#[tauri::command]
pub fn read_local_font_candidate(
    app: AppHandle,
    window: WebviewWindow,
    slot: LocalFontSlot,
    state: State<'_, LocalFontState>,
) -> Result<Response, String> {
    ensure_main_window(&window)?;
    let _guard = state
        .0
        .lock()
        .map_err(|_| "ローカルフォント管理を開始できません".to_string())?;
    let dir = font_dir(&app)?;
    let parsed = read_container_file(&dir.join(slot.candidate_file_name()))?
        .ok_or_else(|| "候補フォントがありません".to_string())?;
    Ok(Response::new(parsed.font_bytes))
}

#[tauri::command]
pub fn commit_local_font_candidate(
    app: AppHandle,
    window: WebviewWindow,
    slot: LocalFontSlot,
    state: State<'_, LocalFontState>,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    let _guard = state
        .0
        .lock()
        .map_err(|_| "ローカルフォント管理を開始できません".to_string())?;
    let dir = font_dir(&app)?;
    commit_candidate(&dir, slot)
}

#[tauri::command]
pub fn discard_local_font_candidate(
    app: AppHandle,
    window: WebviewWindow,
    slot: LocalFontSlot,
    state: State<'_, LocalFontState>,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    let _guard = state
        .0
        .lock()
        .map_err(|_| "ローカルフォント管理を開始できません".to_string())?;
    let dir = font_dir(&app)?;
    discard_fixed_file(&dir.join(slot.candidate_file_name()))
}

#[tauri::command]
pub fn remove_local_font(
    app: AppHandle,
    window: WebviewWindow,
    slot: LocalFontSlot,
    state: State<'_, LocalFontState>,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    let _guard = state
        .0
        .lock()
        .map_err(|_| "ローカルフォント管理を開始できません".to_string())?;
    let dir = font_dir(&app)?;
    let path = dir.join(slot.file_name());
    if validate_existing_file(&path)? {
        fs::remove_file(path).map_err(|_| "管理コピーを削除できません".to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn font(format: LocalFontFormat, size: usize) -> ParsedContainer {
        let mut bytes = vec![0; size.max(4)];
        bytes[..4].copy_from_slice(match format {
            LocalFontFormat::Woff2 => b"wOF2",
            LocalFontFormat::Ttf => &[0x00, 0x01, 0x00, 0x00],
            LocalFontFormat::Otf => b"OTTO",
        });
        ParsedContainer {
            info: LocalFontInfo {
                original_file_name: "example.otf".to_string(),
                format,
                size: bytes.len() as u64,
            },
            font_bytes: bytes,
        }
    }

    #[test]
    fn signatures_match_supported_formats() {
        assert!(validate_signature(LocalFontFormat::Woff2, b"wOF2rest").is_ok());
        assert!(validate_signature(LocalFontFormat::Ttf, &[0, 1, 0, 0, 4]).is_ok());
        assert!(validate_signature(LocalFontFormat::Ttf, b"truefont").is_ok());
        assert!(validate_signature(LocalFontFormat::Otf, b"OTTOrest").is_ok());
        assert!(validate_signature(LocalFontFormat::Otf, b"wOF2rest").is_err());
    }

    #[test]
    fn selected_source_must_be_a_regular_file_with_matching_extension() {
        let temp = tempfile::tempdir().unwrap();
        let directory = temp.path().join("not-a-file.otf");
        fs::create_dir(&directory).unwrap();
        assert!(read_selected_font(&directory).is_err());

        let mismatched = temp.path().join("mismatched.otf");
        fs::write(&mismatched, b"wOF2rest").unwrap();
        assert!(read_selected_font(&mismatched).is_err());

        let valid = temp.path().join("日本語フォント.otf");
        fs::write(&valid, b"OTTOrest").unwrap();
        let parsed = read_selected_font(&valid).unwrap();
        assert_eq!(parsed.info.original_file_name, "日本語フォント.otf");
        let container = String::from_utf8_lossy(&encode_container(&parsed).unwrap()).into_owned();
        assert!(!container.contains(&temp.path().to_string_lossy().into_owned()));
    }

    #[test]
    fn container_round_trip_preserves_metadata_and_raw_bytes() {
        let original = font(LocalFontFormat::Otf, 128);
        let encoded = encode_container(&original).unwrap();
        let decoded = parse_container(&encoded).unwrap();
        assert_eq!(decoded.info, original.info);
        assert_eq!(decoded.font_bytes, original.font_bytes);
    }

    #[test]
    fn incomplete_and_mismatched_containers_fail_closed() {
        let original = font(LocalFontFormat::Woff2, 128);
        let mut encoded = encode_container(&original).unwrap();
        encoded.pop();
        assert!(parse_container(&encoded).is_err());

        let mut encoded = encode_container(&original).unwrap();
        let metadata_len = u32::from_le_bytes(encoded[8..12].try_into().unwrap()) as usize;
        let metadata_end = CONTAINER_HEADER_LEN + metadata_len;
        encoded[metadata_end..metadata_end + 4].copy_from_slice(b"OTTO");
        assert!(parse_container(&encoded).is_err());
    }

    #[test]
    fn slot_replacement_and_removal_use_only_fixed_files() {
        let temp = tempfile::tempdir().unwrap();
        let first = font(LocalFontFormat::Otf, 64);
        let second = font(LocalFontFormat::Woff2, 96);
        write_slot(temp.path(), LocalFontSlot::Body, &first).unwrap();
        write_slot(temp.path(), LocalFontSlot::Body, &second).unwrap();
        let stored = read_slot(temp.path(), LocalFontSlot::Body)
            .unwrap()
            .unwrap();
        assert_eq!(stored.font_bytes, second.font_bytes);
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
    }

    #[test]
    fn oversized_font_is_rejected_before_container_creation() {
        let boundary = font(LocalFontFormat::Ttf, MAX_FONT_BYTES);
        assert!(encode_container(&boundary).is_ok());

        let mut oversized = font(LocalFontFormat::Ttf, 4);
        oversized.font_bytes.resize(MAX_FONT_BYTES + 1, 0);
        oversized.info.size = oversized.font_bytes.len() as u64;
        assert!(encode_container(&oversized).is_err());
        assert_eq!(MAX_FONT_BYTES * 2, 64 * 1024 * 1024);
    }

    #[test]
    fn invalid_candidate_does_not_replace_active_slot() {
        let temp = tempfile::tempdir().unwrap();
        let active = font(LocalFontFormat::Otf, 64);
        write_slot(temp.path(), LocalFontSlot::Body, &active).unwrap();
        fs::write(temp.path().join("body.candidate"), b"broken").unwrap();

        assert!(commit_candidate(temp.path(), LocalFontSlot::Body).is_err());
        let stored = read_slot(temp.path(), LocalFontSlot::Body)
            .unwrap()
            .unwrap();
        assert_eq!(stored.font_bytes, active.font_bytes);
    }

    #[test]
    fn valid_candidate_replaces_active_and_is_removed() {
        let temp = tempfile::tempdir().unwrap();
        let active = font(LocalFontFormat::Otf, 64);
        let candidate = font(LocalFontFormat::Woff2, 96);
        write_slot(temp.path(), LocalFontSlot::Body, &active).unwrap();
        write_container_file(
            temp.path(),
            &temp.path().join("body.candidate"),
            "body.tmp",
            &candidate,
        )
        .unwrap();

        commit_candidate(temp.path(), LocalFontSlot::Body).unwrap();
        let stored = read_slot(temp.path(), LocalFontSlot::Body)
            .unwrap()
            .unwrap();
        assert_eq!(stored.font_bytes, candidate.font_bytes);
        assert!(!temp.path().join("body.candidate").exists());
    }
}
