use std::{collections::HashSet, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use super::{
    file::AllowedRoots,
    sources::{
        get_source_link_context, DocumentRef, LinkContextResponse, LinkIndexState, SourceRegistry,
    },
};

pub(crate) const LINK_GRAPH_WINDOW_LABEL: &str = "link-graph";
pub(crate) const MAIN_WINDOW_LABEL: &str = "main";
const LINK_GRAPH_OPEN_DOCUMENT_EVENT: &str = "link-graph-open-document";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinkGraphWindowContext {
    document: DocumentRef,
    source_generation: u64,
    revision: u64,
    show_hidden_files: bool,
    respect_gitignore: bool,
    include_wiki_links: bool,
    locale: String,
    dark: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinkGraphWindowSnapshot {
    context_version: u64,
    context: Option<LinkGraphWindowContext>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkGraphWindowContextUpdate {
    session_id: String,
    sequence: u64,
    context: Option<LinkGraphWindowContext>,
}

#[derive(Debug, Default)]
struct LinkGraphWindowStateInner {
    active_session_id: Option<String>,
    last_sequence: u64,
    snapshot: LinkGraphWindowSnapshot,
    openable_documents: HashSet<DocumentRef>,
}

#[derive(Debug, Default)]
pub struct LinkGraphWindowState(Mutex<LinkGraphWindowStateInner>);

impl LinkGraphWindowState {
    pub(crate) fn allows_preview(
        &self,
        current: &DocumentRef,
        target: &DocumentRef,
    ) -> Result<bool, String> {
        let state = self.0.lock().map_err(|error| error.to_string())?;
        Ok(state
            .snapshot
            .context
            .as_ref()
            .is_some_and(|context| &context.document == current)
            && (target == current || state.openable_documents.contains(target)))
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkGraphDocumentOpenRequest {
    context_version: u64,
    origin: DocumentRef,
    target: DocumentRef,
}

fn require_window(window: &WebviewWindow, expected: &str) -> Result<(), String> {
    if window.label() == expected {
        Ok(())
    } else {
        Err("このウィンドウからは実行できません".to_string())
    }
}

fn begin_context_session(
    current: &mut LinkGraphWindowStateInner,
    session_id: String,
) -> LinkGraphWindowSnapshot {
    current.active_session_id = Some(session_id);
    current.last_sequence = 0;
    current.snapshot.context_version += 1;
    current.snapshot.context = None;
    current.openable_documents.clear();
    current.snapshot.clone()
}

fn apply_context_update(
    current: &mut LinkGraphWindowStateInner,
    update: LinkGraphWindowContextUpdate,
) -> LinkGraphWindowSnapshot {
    if current.active_session_id.as_deref() == Some(&update.session_id)
        && update.sequence > current.last_sequence
    {
        current.last_sequence = update.sequence;
        current.snapshot.context_version += 1;
        current.snapshot.context = update.context;
        current.openable_documents.clear();
    }
    current.snapshot.clone()
}

#[tauri::command]
pub async fn open_link_graph_window(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    require_window(&window, MAIN_WINDOW_LABEL)?;
    if let Some(window) = app.get_webview_window(LINK_GRAPH_WINDOW_LABEL) {
        window.remove_menu().map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.unminimize().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        &app,
        LINK_GRAPH_WINDOW_LABEL,
        WebviewUrl::App("link-graph".into()),
    )
    .title("FeatherMD - Link Graph")
    .inner_size(900.0, 650.0)
    .min_inner_size(520.0, 360.0)
    .resizable(true)
    .build()
    .map_err(|error| error.to_string())?;
    window.remove_menu().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn close_link_graph_window(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    require_window(&window, MAIN_WINDOW_LABEL)?;
    if let Some(window) = app.get_webview_window(LINK_GRAPH_WINDOW_LABEL) {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn begin_link_graph_window_context_session(
    session_id: String,
    window: WebviewWindow,
    state: State<'_, LinkGraphWindowState>,
) -> Result<LinkGraphWindowSnapshot, String> {
    require_window(&window, MAIN_WINDOW_LABEL)?;
    let mut current = state.0.lock().map_err(|error| error.to_string())?;
    Ok(begin_context_session(&mut current, session_id))
}

#[tauri::command]
pub fn update_link_graph_window_context(
    update: LinkGraphWindowContextUpdate,
    window: WebviewWindow,
    state: State<'_, LinkGraphWindowState>,
) -> Result<LinkGraphWindowSnapshot, String> {
    require_window(&window, MAIN_WINDOW_LABEL)?;
    let mut current = state.0.lock().map_err(|error| error.to_string())?;
    Ok(apply_context_update(&mut current, update))
}

#[tauri::command]
pub fn get_link_graph_window_context(
    window: WebviewWindow,
    state: State<'_, LinkGraphWindowState>,
) -> Result<LinkGraphWindowSnapshot, String> {
    require_window(&window, LINK_GRAPH_WINDOW_LABEL)?;
    state
        .0
        .lock()
        .map(|current| current.snapshot.clone())
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn get_link_graph_data(
    context_version: u64,
    force_refresh: bool,
    window: WebviewWindow,
    graph_state: State<'_, LinkGraphWindowState>,
    roots: State<'_, AllowedRoots>,
    registry: State<'_, SourceRegistry>,
    indexes: State<'_, LinkIndexState>,
) -> Result<LinkContextResponse, String> {
    require_window(&window, LINK_GRAPH_WINDOW_LABEL)?;
    let snapshot = graph_state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .snapshot
        .clone();
    if snapshot.context_version != context_version {
        return Err("リンクグラフの表示対象が更新されました".to_string());
    }
    let context = snapshot
        .context
        .ok_or_else(|| "表示中のMarkdownがありません".to_string())?;

    let response = get_source_link_context(
        context.document,
        context.show_hidden_files,
        context.respect_gitignore,
        context.include_wiki_links,
        force_refresh,
        roots,
        registry,
        indexes,
    )
    .await?;
    let openable_documents = response.openable_documents();
    let mut current = graph_state.0.lock().map_err(|error| error.to_string())?;
    if current.snapshot.context_version == context_version {
        current.openable_documents = openable_documents;
    }
    Ok(response)
}

#[tauri::command]
pub fn request_link_graph_document_open(
    context_version: u64,
    origin: DocumentRef,
    target: DocumentRef,
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, LinkGraphWindowState>,
) -> Result<(), String> {
    require_window(&window, LINK_GRAPH_WINDOW_LABEL)?;
    let current = state.0.lock().map_err(|error| error.to_string())?;
    let snapshot = &current.snapshot;
    let Some(context) = &snapshot.context else {
        return Err("表示中のMarkdownがありません".to_string());
    };
    if snapshot.context_version != context_version
        || context.document != origin
        || target.source_id != origin.source_id
        || !current.openable_documents.contains(&target)
    {
        return Err("リンクグラフの表示対象が更新されました".to_string());
    }
    drop(current);

    app.emit_to(
        MAIN_WINDOW_LABEL,
        LINK_GRAPH_OPEN_DOCUMENT_EVENT,
        LinkGraphDocumentOpenRequest {
            context_version,
            origin,
            target,
        },
    )
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        apply_context_update, begin_context_session, LinkGraphWindowContext,
        LinkGraphWindowContextUpdate, LinkGraphWindowState, LinkGraphWindowStateInner,
    };
    use crate::commands::sources::DocumentRef;
    use std::sync::Mutex;

    #[test]
    fn older_context_cannot_overwrite_newer_context_and_reload_starts_a_new_session() {
        let mut current = LinkGraphWindowStateInner::default();
        begin_context_session(&mut current, "first".to_string());
        apply_context_update(
            &mut current,
            LinkGraphWindowContextUpdate {
                session_id: "first".to_string(),
                sequence: 2,
                context: None,
            },
        );
        let latest = apply_context_update(
            &mut current,
            LinkGraphWindowContextUpdate {
                session_id: "first".to_string(),
                sequence: 1,
                context: None,
            },
        );
        assert_eq!(latest.context_version, 2);

        let reloaded = begin_context_session(&mut current, "second".to_string());
        assert_eq!(reloaded.context_version, 3);
        let stale = apply_context_update(
            &mut current,
            LinkGraphWindowContextUpdate {
                session_id: "first".to_string(),
                sequence: 3,
                context: None,
            },
        );
        assert_eq!(stale.context_version, 3);
    }

    #[test]
    fn graph_preview_is_limited_to_current_and_returned_documents() {
        let current_document = DocumentRef {
            source_id: "source-1".to_string(),
            path: "current.md".to_string(),
        };
        let returned_document = DocumentRef {
            source_id: "source-1".to_string(),
            path: "returned.md".to_string(),
        };
        let unreturned_document = DocumentRef {
            source_id: "source-1".to_string(),
            path: "secret.md".to_string(),
        };
        let mut inner = LinkGraphWindowStateInner::default();
        inner.snapshot.context = Some(LinkGraphWindowContext {
            document: current_document.clone(),
            source_generation: 0,
            revision: 0,
            show_hidden_files: false,
            respect_gitignore: true,
            include_wiki_links: true,
            locale: "ja".to_string(),
            dark: false,
        });
        inner.openable_documents.insert(returned_document.clone());
        let state = LinkGraphWindowState(Mutex::new(inner));

        assert!(state
            .allows_preview(&current_document, &current_document)
            .unwrap());
        assert!(state
            .allows_preview(&current_document, &returned_document)
            .unwrap());
        assert!(!state
            .allows_preview(&current_document, &unreturned_document)
            .unwrap());
        assert!(!state
            .allows_preview(&unreturned_document, &returned_document)
            .unwrap());
    }
}
