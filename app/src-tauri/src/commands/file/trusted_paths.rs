use crate::commands::has_markdown_extension;
use std::collections::HashSet;
use std::fs::File;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::State;

pub const MAX_INPUT_PATHS: usize = 32;

/// ユーザーが明示的に許可したフォルダールートと単一ファイルの集合。
/// 全ファイルアクセスはルート配下、または単一ファイルとの完全一致に限定される。
/// 信頼起点をフロントエンド（WebView）ではなくRust側に置くことで、
/// 万一WebView側でスクリプトが実行されても任意ファイル読み取りを防ぐ。
#[derive(Default)]
pub(super) struct AllowedEntries {
    pub(super) roots: Vec<PathBuf>,
    pub(super) files: HashSet<PathBuf>,
}

#[derive(Default, Clone)]
pub struct AllowedRoots(pub(super) Arc<Mutex<AllowedEntries>>);

impl AllowedRoots {
    pub fn new() -> Self {
        Self::default()
    }

    /// pathを信頼済みルートとして登録する。pathがファイルの場合はその親フォルダを登録する。
    /// 危険なフォルダ（ドライブ直下・システムフォルダ・ユーザープロファイル直下）は拒否する。
    pub(super) fn root_for_path(path: &str) -> Result<PathBuf, String> {
        let canonical =
            std::fs::canonicalize(path).map_err(|e| format!("パスの解決に失敗しました: {}", e))?;
        let root = if canonical.is_dir() {
            canonical
        } else {
            canonical
                .parent()
                .ok_or_else(|| "親フォルダーを特定できません".to_string())?
                .to_path_buf()
        };

        if let Some(reason) = dangerous_root_reason(&root) {
            return Err(reason.to_string());
        }

        Ok(root)
    }

    pub(crate) fn register(&self, path: &str) -> Result<(), String> {
        let root = Self::root_for_path(path)?;

        self.register_root_path(root);
        Ok(())
    }

    pub(super) fn register_root_path(&self, root: PathBuf) {
        let mut entries = self.0.lock().unwrap();
        if !entries.roots.iter().any(|registered| registered == &root) {
            entries.roots.push(root);
        }
    }

    pub(super) fn canonical_zip_file_path(path: &str) -> Result<PathBuf, String> {
        let canonical =
            std::fs::canonicalize(path).map_err(|e| format!("パスの解決に失敗しました: {e}"))?;
        if !canonical.is_file() {
            return Err("ファイルを指定してください".to_string());
        }
        if !canonical
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
        {
            return Err("ZIPファイル（.zip）を指定してください".to_string());
        }
        Ok(canonical)
    }

    /// ZIP単体だけを信頼対象として登録する。canonicalize後の実体もZIPでなければ拒否する。
    pub(crate) fn register_zip_file(&self, path: &str) -> Result<(), String> {
        let canonical = Self::canonical_zip_file_path(path)?;
        self.0.lock().unwrap().files.insert(canonical);
        Ok(())
    }

    /// 確認画面を表示した時点と承認後で、選択パスの実体が変わっていない場合だけ登録する。
    pub(super) fn register_zip_file_if_unchanged(
        &self,
        path: &str,
        expected: &Path,
    ) -> Result<(), String> {
        let current = Self::canonical_zip_file_path(path)?;
        if current != expected {
            return Err("確認中にアーカイブファイルの参照先が変更されました".to_string());
        }
        self.0.lock().unwrap().files.insert(current);
        Ok(())
    }

    /// pathをcanonicalizeし、信頼済みルートのいずれかの配下にあることを検証する。
    /// シンボリックリンクは解決済みのパスで判定するため、リンク経由の脱出も防ぐ。
    pub(crate) fn resolve(&self, path: &str) -> Result<PathBuf, String> {
        let canonical =
            std::fs::canonicalize(path).map_err(|e| format!("パスの解決に失敗しました: {}", e))?;
        let entries = self.0.lock().unwrap();
        if entries.files.contains(&canonical)
            || entries.roots.iter().any(|root| canonical.starts_with(root))
        {
            Ok(canonical)
        } else {
            Err("許可されていないファイルです".to_string())
        }
    }

    pub(super) fn resolve_opened_path(&self, canonical: PathBuf) -> Result<PathBuf, String> {
        let entries = self.0.lock().unwrap();
        if entries.files.contains(&canonical)
            || entries.roots.iter().any(|root| canonical.starts_with(root))
        {
            Ok(canonical)
        } else {
            Err("許可されていないファイルです".to_string())
        }
    }

    pub(super) fn is_allowed(&self, path: &str) -> bool {
        self.resolve(path).is_ok()
    }

    pub(crate) fn register_input_paths(&self, paths: &[PathBuf]) {
        let mut folder_registered = false;
        for path in paths.iter().take(MAX_INPUT_PATHS) {
            if path.is_dir() && !folder_registered {
                folder_registered = self.register(&path.to_string_lossy()).is_ok();
            } else if path.is_file() {
                let is_zip = path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"));
                if has_markdown_extension(path) || is_zip {
                    let result = if is_zip {
                        self.register_zip_file(&path.to_string_lossy())
                    } else {
                        self.register(&path.to_string_lossy())
                    };
                    let _ = result;
                }
            }
        }
    }
}

/// 信頼済みルートとして登録すべきでない危険なフォルダかを判定する。
/// Windowsを主対象とし、canonicalize後のパス（verbatimプレフィックス付き）でも
/// 正しく判定できるよう、Normalコンポーネントだけを取り出して評価する。
pub(super) fn dangerous_root_reason(path: &Path) -> Option<&'static str> {
    let normals: Vec<String> = path
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().to_lowercase()),
            _ => None,
        })
        .collect();

    // ドライブ直下 / ファイルシステムルート直下（例: C:\ , / ）
    if normals.is_empty() {
        return Some("ドライブ直下は信頼フォルダーに指定できません");
    }

    // Windowsのシステムフォルダ（先頭コンポーネントで判定）
    if matches!(
        normals[0].as_str(),
        "windows" | "program files" | "program files (x86)" | "programdata"
    ) {
        return Some("システムフォルダーは信頼フォルダーに指定できません");
    }

    // ユーザープロファイル直下（例: C:\Users\<name>）。配下のDocuments等は許可する。
    if normals.len() == 2 && normals[0] == "users" {
        return Some("ユーザープロファイル直下は信頼フォルダーに指定できません");
    }

    None
}

/// CDPを使う開発時E2Eフック専用。リリースビルドでは信頼登録しない。
#[tauri::command]
pub fn authorize_dev_path(path: String, state: State<'_, AllowedRoots>) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let is_zip = Path::new(&path)
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"));
        if is_zip {
            state.register_zip_file(&path)
        } else {
            state.register(&path)
        }
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (path, state);
        Err("開発ビルドでのみ利用できます".to_string())
    }
}

/// pathが信頼済みルートのいずれかの配下にあるかを判定する
#[tauri::command]
pub fn is_path_allowed(path: String, state: State<'_, AllowedRoots>) -> bool {
    state.is_allowed(&path)
}

pub(crate) fn open_allowed_file(
    state: &AllowedRoots,
    path: &str,
) -> Result<(File, PathBuf), String> {
    let canonical = state.resolve(path)?;
    let file = File::open(&canonical).map_err(|e| format!("ファイル読み込みエラー: {}", e))?;
    let opened_path = final_path_for_file(&file)?;
    let verified = state.resolve_opened_path(opened_path)?;
    Ok((file, verified))
}

#[cfg(windows)]
pub(super) fn final_path_for_file(file: &File) -> Result<PathBuf, String> {
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;

    let handle = file.as_raw_handle();
    let required = unsafe { GetFinalPathNameByHandleW(handle, std::ptr::null_mut(), 0, 0) };
    if required == 0 {
        return Err(format!(
            "ファイル最終パスの取得に失敗しました: {}",
            std::io::Error::last_os_error()
        ));
    }
    let mut buffer = vec![0u16; required as usize + 1];
    let written =
        unsafe { GetFinalPathNameByHandleW(handle, buffer.as_mut_ptr(), buffer.len() as u32, 0) };
    if written == 0 || written as usize >= buffer.len() {
        return Err(format!(
            "ファイル最終パスの取得に失敗しました: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(std::ffi::OsString::from_wide(&buffer[..written as usize]).into())
}

#[cfg(target_os = "linux")]
pub(super) fn final_path_for_file(file: &File) -> Result<PathBuf, String> {
    use std::os::fd::AsRawFd;
    std::fs::canonicalize(format!("/proc/self/fd/{}", file.as_raw_fd()))
        .map_err(|e| format!("ファイル最終パスの取得に失敗しました: {}", e))
}

#[cfg(target_os = "macos")]
pub(super) fn final_path_for_file(file: &File) -> Result<PathBuf, String> {
    use std::os::fd::AsRawFd;
    use std::os::unix::ffi::OsStrExt;

    let mut buffer = vec![0i8; libc::PATH_MAX as usize];
    let result = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETPATH, buffer.as_mut_ptr()) };
    if result == -1 {
        return Err(format!(
            "ファイル最終パスの取得に失敗しました: {}",
            std::io::Error::last_os_error()
        ));
    }
    let bytes = unsafe { std::ffi::CStr::from_ptr(buffer.as_ptr()) }.to_bytes();
    Ok(std::ffi::OsStr::from_bytes(bytes).into())
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
pub(super) fn final_path_for_file(_file: &File) -> Result<PathBuf, String> {
    Err("このOSでは安全なファイル読込を利用できません".to_string())
}
