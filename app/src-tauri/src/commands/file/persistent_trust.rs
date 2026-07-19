use super::trusted_paths::{dangerous_root_reason, AllowedRoots};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const TRUST_STORE_FILE: &str = "trusted-root.json";
const TRUST_STORE_KEY: &str = "root";

pub struct PersistentExplorerRoot(Mutex<Option<PathBuf>>);

impl PersistentExplorerRoot {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }

    pub(super) fn matches(&self, root: &Path) -> bool {
        self.0.lock().unwrap().as_deref() == Some(root)
    }

    pub(super) fn replace(&self, root: PathBuf) {
        *self.0.lock().unwrap() = Some(root);
    }
}

pub(super) fn persist_explorer_root(
    app: &AppHandle,
    persistent: &PersistentExplorerRoot,
    root: &Path,
) -> Result<(), String> {
    let store = app.store(TRUST_STORE_FILE).map_err(|e| e.to_string())?;
    store.clear();
    store.set(
        TRUST_STORE_KEY,
        serde_json::Value::String(root.to_string_lossy().replace('\\', "/")),
    );
    store.save().map_err(|e| e.to_string())?;
    persistent.replace(root.to_path_buf());
    Ok(())
}

pub(crate) fn restore_persisted_explorer_root(
    app: &AppHandle,
    roots: &AllowedRoots,
    persistent: &PersistentExplorerRoot,
) -> Result<(), String> {
    let store = app.store(TRUST_STORE_FILE).map_err(|e| e.to_string())?;
    let Some(path) = store
        .get(TRUST_STORE_KEY)
        .and_then(|value| value.as_str().map(str::to_owned))
    else {
        return Ok(());
    };

    match validate_persisted_explorer_root(&path) {
        Ok(root) => {
            roots.register_root_path(root.clone());
            persistent.replace(root);
            Ok(())
        }
        _ => {
            store.clear();
            store.save().map_err(|e| e.to_string())
        }
    }
}

pub(super) fn validate_persisted_explorer_root(path: &str) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| format!("保存済みExplorerルートを解決できません: {e}"))?;
    if !canonical.is_dir() {
        return Err("保存済みExplorerルートはフォルダーではありません".to_string());
    }
    if let Some(reason) = dangerous_root_reason(&canonical) {
        return Err(reason.to_string());
    }
    Ok(canonical)
}
