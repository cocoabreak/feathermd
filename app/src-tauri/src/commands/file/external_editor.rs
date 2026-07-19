use super::{normalize_path_for_frontend, AllowedRoots, NativeDialogState};
use crate::commands::has_markdown_extension;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

pub struct ExternalEditorState(Mutex<Option<PathBuf>>);

impl ExternalEditorState {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }

    pub(super) fn set(&self, path: PathBuf) {
        *self.0.lock().unwrap() = Some(path);
    }

    pub(super) fn get(&self) -> Option<PathBuf> {
        self.0.lock().unwrap().clone()
    }

    pub(super) fn clear(&self) {
        *self.0.lock().unwrap() = None;
    }
}

#[tauri::command]
pub async fn pick_external_editor(
    app: AppHandle,
    editors: State<'_, ExternalEditorState>,
    dialogs: State<'_, NativeDialogState>,
) -> Result<Option<String>, String> {
    let _dialog_guard = dialogs.try_acquire()?;
    let selected = app
        .dialog()
        .file()
        .add_filter("Executable", &["exe", "bat", "cmd"])
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|e| format!("選択したパスを解決できません: {e}"))?;
    let canonical = validate_external_editor(&path)?;
    editors.set(canonical.clone());
    Ok(Some(normalize_path_for_frontend(&canonical)))
}

#[tauri::command]
pub async fn authorize_external_editor(
    app: AppHandle,
    path: String,
    editors: State<'_, ExternalEditorState>,
    dialogs: State<'_, NativeDialogState>,
) -> Result<bool, String> {
    let canonical = validate_external_editor(Path::new(&path))?;
    if editors.get().as_ref() == Some(&canonical) {
        return Ok(true);
    }

    let _dialog_guard = dialogs.try_acquire()?;
    let locale = crate::menu::resolve_locale(&app);
    let (title, prompt) = if locale == "ja" {
        (
            "外部エディターの確認",
            format!(
                "次のアプリケーションを外部エディターとして使用しますか？\n\n{}",
                canonical.display()
            ),
        )
    } else {
        (
            "Confirm external editor",
            format!(
                "Use this application as the external editor?\n\n{}",
                canonical.display()
            ),
        )
    };
    let approved = app
        .dialog()
        .message(prompt)
        .title(title)
        .buttons(MessageDialogButtons::YesNo)
        .blocking_show();
    if approved {
        editors.set(canonical);
    }
    Ok(approved)
}

fn validate_external_editor(path: &Path) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| format!("外部エディターのパスを解決できません: {e}"))?;
    if !canonical.is_file() {
        return Err("外部エディターにはファイルを指定してください".to_string());
    }
    #[cfg(windows)]
    if !canonical
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "exe" | "bat" | "cmd"))
    {
        return Err("実行可能ファイル（.exe / .bat / .cmd）を選択してください".to_string());
    }
    Ok(canonical)
}

#[tauri::command]
pub fn clear_external_editor(editors: State<'_, ExternalEditorState>) {
    editors.clear();
}

/// 外部エディターでファイルを開く（信頼済みルート配下に限る）
#[tauri::command(async)]
pub fn open_in_editor(
    path: String,
    state: State<'_, AllowedRoots>,
    editors: State<'_, ExternalEditorState>,
) -> Result<(), String> {
    let canonical = state.resolve(&path)?;
    if !has_markdown_extension(&canonical) {
        return Err("Markdownファイルだけを外部エディターで開けます".to_string());
    }

    // AllowedRootsを通過したMarkdownだけを、認可済みエディターまたはOS既定アプリで開く。
    let result = if let Some(editor) = editors.get() {
        open::with(&canonical, editor.to_string_lossy().into_owned())
    } else {
        open::that(&canonical)
    };
    result.map_err(|e| format!("外部エディターの起動に失敗しました: {e}"))
}
