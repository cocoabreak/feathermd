use crate::commands::file::{normalize_path_for_frontend, AllowedRoots};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

/// このデバウンス窓の間に届いた同一パスのイベントは最後の種別のみ送出する。
/// 本アプリはwatcherイベントが唯一の更新検知経路のため、エディタの多段階保存
/// （削除+再作成、メタデータ更新+本体書き込み等）を吸収しつつ体感遅延を避ける短めの値にする。
const DEBOUNCE_WINDOW: Duration = Duration::from_millis(400);
const WORKER_TICK: Duration = Duration::from_millis(50);
const MAX_FILE_WATCHERS: usize = 100;
const MAX_DIRECTORY_WATCHERS: usize = 65;

struct WatcherEntry {
    _watcher: RecommendedWatcher,
}

pub struct WatcherState(Mutex<HashMap<String, WatcherEntry>>);

impl WatcherState {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

/// エクスプローラー用のディレクトリ監視の集合。
/// タブで開いたファイルの監視（WatcherState）とはライフサイクルが異なる
/// （こちらはツリーの展開/折りたたみに追従する）ため、状態を分離してキー衝突を避ける。
pub struct DirWatcherState(Mutex<HashMap<String, WatcherEntry>>);

impl DirWatcherState {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

/// カスタムCSSはタブ監視と同じパスになり得るため、独立した監視台帳を持つ。
pub struct CustomCssWatcherState(pub Mutex<Option<RecommendedWatcher>>);

impl CustomCssWatcherState {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

enum DebounceMessage {
    File(String, String, DebouncedKind),
    Directory(String, String),
    CustomCss(String),
    CancelFile(String),
    CancelDirectory(String),
    CancelCustomCss,
}

/// 全監視で共有するデバウンスworker。OS watcherは対象ごとに保持するが、
/// イベント整形のための専用スレッドはパス数に比例させない。
pub struct WatcherWorker(Sender<DebounceMessage>);

impl WatcherWorker {
    pub fn new(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut files: HashMap<String, (String, DebouncedKind, Instant)> = HashMap::new();
            let mut directories: HashMap<String, (String, Instant)> = HashMap::new();
            let mut custom_css: HashMap<String, Instant> = HashMap::new();

            loop {
                match rx.recv_timeout(WORKER_TICK) {
                    Ok(DebounceMessage::File(key, path, kind)) => {
                        files.insert(key, (path, kind, Instant::now() + DEBOUNCE_WINDOW));
                    }
                    Ok(DebounceMessage::Directory(key, path)) => {
                        directories.insert(key, (path, Instant::now() + DEBOUNCE_WINDOW));
                    }
                    Ok(DebounceMessage::CustomCss(path)) => {
                        custom_css.insert(path, Instant::now() + DEBOUNCE_WINDOW);
                    }
                    Ok(DebounceMessage::CancelFile(path)) => {
                        files.remove(&path);
                    }
                    Ok(DebounceMessage::CancelDirectory(path)) => {
                        directories.remove(&path);
                    }
                    Ok(DebounceMessage::CancelCustomCss) => custom_css.clear(),
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }

                let now = Instant::now();
                files.retain(|_, (path, kind, deadline)| {
                    if *deadline <= now {
                        let _ = app.emit(kind.event_name(), path.clone());
                        false
                    } else {
                        true
                    }
                });
                directories.retain(|_, (path, deadline)| {
                    if *deadline <= now {
                        let _ = app.emit("directory-changed", path.clone());
                        false
                    } else {
                        true
                    }
                });
                custom_css.retain(|path, deadline| {
                    if *deadline <= now {
                        let _ = app.emit("custom-css-changed", path.clone());
                        false
                    } else {
                        true
                    }
                });
            }
        });
        Self(tx)
    }
}

#[tauri::command]
pub fn watch_custom_css(
    path: String,
    roots: State<'_, AllowedRoots>,
    state: State<'_, CustomCssWatcherState>,
    worker: State<'_, WatcherWorker>,
) -> Result<(), String> {
    let canonical = roots.resolve(&path)?;
    if !canonical
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("css"))
    {
        return Err("CSSファイル（.css）を選択してください".to_string());
    }
    let watched_path = canonical.to_string_lossy().replace('\\', "/");
    let tx = worker.0.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        if let Ok(event) = result {
            let targets_css = event.paths.iter().any(|event_path| {
                event_path
                    .to_string_lossy()
                    .replace('\\', "/")
                    .eq_ignore_ascii_case(&watched_path)
            });
            if targets_css && classify_event_kind(event.kind).is_some() {
                let _ = tx.send(DebounceMessage::CustomCss(watched_path.clone()));
            }
        }
    })
    .map_err(|e| e.to_string())?;
    let parent = canonical
        .parent()
        .ok_or_else(|| "CSSファイルの親フォルダーを特定できません".to_string())?;
    watcher
        .watch(parent, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    *state.0.lock().unwrap() = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_custom_css(
    state: State<'_, CustomCssWatcherState>,
    worker: State<'_, WatcherWorker>,
) {
    *state.0.lock().unwrap() = None;
    let _ = worker.0.send(DebounceMessage::CancelCustomCss);
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum DebouncedKind {
    Changed,
    Deleted,
}

impl DebouncedKind {
    fn event_name(self) -> &'static str {
        match self {
            DebouncedKind::Changed => "file-changed",
            DebouncedKind::Deleted => "file-deleted",
        }
    }
}

/// 生のnotifyイベント種別をフロントへ送出すべき種別に分類する。
/// 対象外のイベント（Access等）は None を返す。
fn classify_event_kind(kind: EventKind) -> Option<DebouncedKind> {
    match kind {
        EventKind::Modify(_) | EventKind::Create(_) => Some(DebouncedKind::Changed),
        EventKind::Remove(_) => Some(DebouncedKind::Deleted),
        _ => None,
    }
}

fn watch_path_display(path: &Path) -> String {
    normalize_path_for_frontend(path)
}

fn watch_request_display(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    normalized
        .strip_prefix("//?/UNC/")
        .map(|rest| format!("//{rest}"))
        .or_else(|| normalized.strip_prefix("//?/").map(String::from))
        .unwrap_or(normalized)
}

fn watch_key(path: &str) -> String {
    let normalized = watch_request_display(path);
    #[cfg(windows)]
    {
        normalized.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        normalized
    }
}

fn ensure_watcher_capacity(
    current_len: usize,
    already_watched: bool,
    maximum: usize,
) -> Result<(), String> {
    if !already_watched && current_len >= maximum {
        Err(format!("監視対象の上限（{maximum}件）を超えています"))
    } else {
        Ok(())
    }
}

fn create_file_watcher(
    canonical: &Path,
    emit_path: String,
    key: String,
    canonical_key: String,
    tx: Sender<DebounceMessage>,
) -> Result<WatcherEntry, String> {
    let event_key = canonical_key;
    let debounce_key = key;
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        if let Ok(event) = result {
            if let Some(kind) = classify_event_kind(event.kind) {
                if event
                    .paths
                    .iter()
                    .any(|event_path| watch_key(&event_path.to_string_lossy()) == event_key)
                {
                    let _ = tx.send(DebounceMessage::File(
                        debounce_key.clone(),
                        emit_path.clone(),
                        kind,
                    ));
                }
            }
        }
    })
    .map_err(|e| e.to_string())?;
    let parent = canonical
        .parent()
        .ok_or_else(|| "監視対象の親フォルダーを特定できません".to_string())?;
    watcher
        .watch(parent, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    Ok(WatcherEntry { _watcher: watcher })
}

fn create_directory_watcher(
    canonical: &Path,
    emit_path: String,
    key: String,
    tx: Sender<DebounceMessage>,
) -> Result<WatcherEntry, String> {
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        if let Ok(event) = result {
            if classify_event_kind(event.kind).is_some() {
                let _ = tx.send(DebounceMessage::Directory(key.clone(), emit_path.clone()));
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(canonical, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    Ok(WatcherEntry { _watcher: watcher })
}

fn resolve_directory_targets(
    paths: &[String],
    roots: &AllowedRoots,
) -> Result<Vec<(String, PathBuf, String)>, String> {
    if paths.len() > MAX_DIRECTORY_WATCHERS {
        return Err(format!(
            "ディレクトリ監視対象の上限（{MAX_DIRECTORY_WATCHERS}件）を超えています"
        ));
    }
    let mut seen = HashSet::new();
    let mut targets = Vec::new();
    for requested in paths {
        let canonical = roots.resolve(requested)?;
        if !canonical.is_dir() {
            return Err("監視対象にはフォルダーを指定してください".to_string());
        }
        let emit_path = watch_request_display(requested);
        let key = watch_key(&watch_path_display(&canonical));
        if seen.insert(key.clone()) {
            targets.push((key, canonical, emit_path));
        }
    }
    Ok(targets)
}

/// 指定パスのファイル監視を開始する。
/// 変更時は "file-changed"、削除時は "file-deleted" イベントをフロントへ送信する。
/// 生のfsイベントは DEBOUNCE_WINDOW の間コンパクションし、パスごとに
/// 最後のイベント種別のみを1回だけ送出する（保存時の連続発火を防ぐ）。
#[tauri::command]
pub fn watch_path(
    path: String,
    roots: State<'_, AllowedRoots>,
    state: State<'_, WatcherState>,
    worker: State<'_, WatcherWorker>,
) -> Result<(), String> {
    // 他のファイルシステム系コマンドと同様に信頼境界を検証する（ADR-009）。
    // 監視登録自体も任意パスへ広げないよう、信頼済みルート配下に限定する。
    let canonical = roots.resolve(&path)?;
    if !canonical.is_file() {
        return Err("監視対象にはファイルを指定してください".to_string());
    }
    let emit_path = watch_request_display(&path);
    let key = watch_key(&emit_path);
    let canonical_key = watch_key(&watch_path_display(&canonical));
    let mut watchers = state.0.lock().map_err(|e| e.to_string())?;
    let already_watched = watchers.contains_key(&key);
    ensure_watcher_capacity(watchers.len(), already_watched, MAX_FILE_WATCHERS)?;
    if already_watched {
        return Ok(());
    }
    // ファイルそのものではなく親フォルダーを監視することで、アトミック保存
    // （一時ファイル作成→元ファイル削除→リネーム）後も監視を継続する。
    let watcher = create_file_watcher(
        &canonical,
        emit_path,
        key.clone(),
        canonical_key,
        worker.0.clone(),
    )?;
    watchers.insert(key, watcher);

    Ok(())
}

/// 指定パスのファイル監視を解除する
#[tauri::command]
pub fn unwatch_path(
    path: String,
    state: State<'_, WatcherState>,
    worker: State<'_, WatcherWorker>,
) -> Result<(), String> {
    let key = watch_key(&path);
    state.0.lock().map_err(|e| e.to_string())?.remove(&key);
    let _ = worker.0.send(DebounceMessage::CancelFile(key));
    Ok(())
}

/// 指定ディレクトリ直下（1階層・NonRecursive）の変化監視を開始する（信頼済みルート配下に限る）。
/// 作成・変更・削除いずれのイベントでも、DEBOUNCE_WINDOWの間まとめた上で
/// "directory-changed"（payload=監視対象ディレクトリのパス）を1回だけ送出する。
/// どのエントリがどう変わったかはフロントエンドが該当階層を読み直して反映するため、
/// イベント種別・個別パスは通知しない（リネームの旧新パスや多段階保存の解釈を不要にする）。
#[tauri::command]
pub fn watch_directory(
    path: String,
    roots: State<'_, AllowedRoots>,
    state: State<'_, DirWatcherState>,
    worker: State<'_, WatcherWorker>,
) -> Result<(), String> {
    let canonical = roots.resolve(&path)?;
    if !canonical.is_dir() {
        return Err("監視対象にはフォルダーを指定してください".to_string());
    }
    let emit_path = watch_request_display(&path);
    let key = watch_key(&emit_path);
    let mut watchers = state.0.lock().map_err(|e| e.to_string())?;
    let already_watched = watchers.contains_key(&key);
    ensure_watcher_capacity(watchers.len(), already_watched, MAX_DIRECTORY_WATCHERS)?;
    if already_watched {
        return Ok(());
    }
    let watcher = create_directory_watcher(&canonical, emit_path, key.clone(), worker.0.clone())?;
    watchers.insert(key, watcher);

    Ok(())
}

/// 指定ディレクトリの監視を解除する
#[tauri::command]
pub fn unwatch_directory(
    path: String,
    state: State<'_, DirWatcherState>,
    worker: State<'_, WatcherWorker>,
) -> Result<(), String> {
    let key = watch_key(&path);
    state.0.lock().map_err(|e| e.to_string())?.remove(&key);
    let _ = worker.0.send(DebounceMessage::CancelDirectory(key));
    Ok(())
}

/// Explorerが現在必要とする監視集合へRust側台帳を一括で収束させる。
/// WebViewのリロードでフロント側の状態が失われても、不要な監視を確実に解除する。
#[tauri::command]
pub fn reconcile_directory_watches(
    paths: Vec<String>,
    roots: State<'_, AllowedRoots>,
    state: State<'_, DirWatcherState>,
    worker: State<'_, WatcherWorker>,
) -> Result<(), String> {
    let targets = resolve_directory_targets(&paths, roots.inner())?;
    let desired = targets
        .iter()
        .map(|(key, _, _)| key.clone())
        .collect::<HashSet<_>>();
    let mut watchers = state.0.lock().map_err(|e| e.to_string())?;

    // 追加分を先にすべて構築し、途中で失敗した場合は現行集合を変更しない。
    let mut additions = Vec::new();
    for (key, canonical, emit_path) in targets {
        if !watchers.contains_key(&key) {
            let watcher =
                create_directory_watcher(&canonical, emit_path, key.clone(), worker.0.clone())?;
            additions.push((key, watcher));
        }
    }

    let stale = watchers
        .keys()
        .filter(|key| !desired.contains(*key))
        .cloned()
        .collect::<Vec<_>>();
    for key in stale {
        watchers.remove(&key);
        let _ = worker.0.send(DebounceMessage::CancelDirectory(key));
    }
    watchers.extend(additions);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_modify_and_create_as_changed() {
        assert_eq!(
            classify_event_kind(EventKind::Modify(notify::event::ModifyKind::Any)),
            Some(DebouncedKind::Changed)
        );
        assert_eq!(
            classify_event_kind(EventKind::Create(notify::event::CreateKind::Any)),
            Some(DebouncedKind::Changed)
        );
    }

    #[test]
    fn classifies_remove_as_deleted() {
        assert_eq!(
            classify_event_kind(EventKind::Remove(notify::event::RemoveKind::Any)),
            Some(DebouncedKind::Deleted)
        );
    }

    #[test]
    fn ignores_other_kinds() {
        assert_eq!(
            classify_event_kind(EventKind::Access(notify::event::AccessKind::Any)),
            None
        );
        assert_eq!(classify_event_kind(EventKind::Other), None);
    }

    #[test]
    fn event_name_maps_to_expected_tauri_event() {
        assert_eq!(DebouncedKind::Changed.event_name(), "file-changed");
        assert_eq!(DebouncedKind::Deleted.event_name(), "file-deleted");
    }

    #[test]
    fn watcher_limits_allow_existing_entries_but_reject_new_entries_at_capacity() {
        assert!(ensure_watcher_capacity(MAX_FILE_WATCHERS, true, MAX_FILE_WATCHERS).is_ok());
        assert!(ensure_watcher_capacity(MAX_FILE_WATCHERS, false, MAX_FILE_WATCHERS).is_err());
        assert!(
            ensure_watcher_capacity(MAX_DIRECTORY_WATCHERS - 1, false, MAX_DIRECTORY_WATCHERS)
                .is_ok()
        );
        assert!(
            ensure_watcher_capacity(MAX_DIRECTORY_WATCHERS, false, MAX_DIRECTORY_WATCHERS).is_err()
        );
    }

    #[test]
    fn watcher_keys_ignore_windows_verbatim_prefixes() {
        assert_eq!(watch_key("//?/D:/notes/a.md"), watch_key("D:/notes/a.md"));
        assert_eq!(
            watch_key("//?/UNC/server/share/notes"),
            watch_key("//server/share/notes")
        );
    }

    #[test]
    fn directory_reconcile_rejects_requests_over_the_session_expansion_limit() {
        let roots = AllowedRoots::new();
        let requested = vec![String::new(); MAX_DIRECTORY_WATCHERS + 1];
        assert!(resolve_directory_targets(&requested, &roots).is_err());
    }

    #[test]
    fn directory_reconcile_deduplicates_allowed_paths_and_rejects_outside_paths() {
        let allowed = tempfile::tempdir().unwrap();
        let inside = allowed.path().join("inside");
        std::fs::create_dir(&inside).unwrap();
        let outside = tempfile::tempdir().unwrap();
        let roots = AllowedRoots::new();
        roots.register(&inside.to_string_lossy()).unwrap();

        let duplicate = inside.to_string_lossy().to_string();
        let resolved = resolve_directory_targets(&[duplicate.clone(), duplicate], &roots).unwrap();
        assert_eq!(resolved.len(), 1);
        assert!(
            resolve_directory_targets(&[outside.path().to_string_lossy().to_string()], &roots)
                .is_err()
        );
    }
}
