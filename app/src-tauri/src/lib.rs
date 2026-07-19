mod commands;
mod menu;

use commands::file::{
    AllowedRoots, ExternalEditorState, NativeDialogState, PersistentExplorerRoot,
};
use commands::launch::LaunchState;
use commands::search::SearchState;
use commands::sources::{BacklinkIndexState, SourceRegistry};
use commands::update::UpdateCheckerState;
use commands::watcher::{CustomCssWatcherState, DirWatcherState, WatcherState, WatcherWorker};
use commands::wiki::WikiIndexState;
use tauri::{Emitter, Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // single-instanceは登録順に処理されるため、他のプラグインより先に登録する必要がある
    #[cfg(desktop)]
    let builder = if cfg!(debug_assertions)
        && std::env::var_os("FEATHERMD_E2E_DISABLE_SINGLE_INSTANCE").is_some()
    {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let args = commands::launch::user_cli_args(args, std::path::Path::new(&cwd));
            app.state::<AllowedRoots>().register_input_paths(
                &args
                    .iter()
                    .map(std::path::PathBuf::from)
                    .collect::<Vec<_>>(),
            );
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            app.state::<LaunchState>().queue_cli_args(args);
            // 引数本体はRust側に保持する。イベントはフロントエンドへの起床通知のみ。
            let _ = app.emit("open-cli-args", ());
        }))
    };

    builder
        .setup(|app| {
            let _ = app.manage(WatcherWorker::new(app.handle().clone()));
            if let Err(error) = commands::file::restore_persisted_explorer_root(
                app.handle(),
                app.state::<AllowedRoots>().inner(),
                app.state::<PersistentExplorerRoot>().inner(),
            ) {
                eprintln!("failed to restore persisted Explorer root: {error}");
            }
            app.state::<AllowedRoots>().register_input_paths(
                &commands::launch::initial_cli_args()
                    .into_iter()
                    .map(std::path::PathBuf::from)
                    .collect::<Vec<_>>(),
            );
            // 保存済みの言語設定（なければOSロケール）でネイティブメニューを構築する
            let locale = menu::resolve_locale(app.handle());
            let menu = menu::build_menu(app.handle(), &locale)?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(menu::handle_menu_event)
        .on_window_event(|window, event| {
            if let WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                window.state::<AllowedRoots>().register_input_paths(paths);
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState::new())
        .manage(DirWatcherState::new())
        .manage(CustomCssWatcherState::new())
        .manage(LaunchState::new())
        .manage(SearchState::new())
        .manage(SourceRegistry::new())
        .manage(BacklinkIndexState::new())
        .manage(UpdateCheckerState::default())
        .manage(WikiIndexState::new())
        .manage(AllowedRoots::new())
        .manage(PersistentExplorerRoot::new())
        .manage(NativeDialogState::new())
        .manage(ExternalEditorState::new())
        .invoke_handler(tauri::generate_handler![
            commands::file::readers::read_file,
            commands::export::save_text_export,
            commands::export::save_binary_export,
            commands::app_state::load_app_state,
            commands::app_state::save_app_state,
            commands::file::readers::read_custom_css,
            commands::file::readers::read_directory,
            commands::file::dialogs::authorize_path,
            commands::file::dialogs::authorize_archive_path,
            commands::file::dialogs::authorize_folder_path,
            commands::file::trusted_paths::authorize_dev_path,
            commands::file::dialogs::pick_markdown_file,
            commands::file::dialogs::pick_folder,
            commands::file::dialogs::pick_zip_file,
            commands::file::dialogs::pick_custom_css,
            commands::file::external_editor::pick_external_editor,
            commands::file::external_editor::authorize_external_editor,
            commands::file::external_editor::clear_external_editor,
            commands::file::trusted_paths::is_path_allowed,
            commands::file::readers::read_image_data_url,
            commands::file::external_editor::open_in_editor,
            commands::file::readers::stat_path,
            commands::watcher::watch_path,
            commands::watcher::unwatch_path,
            commands::watcher::watch_directory,
            commands::watcher::unwatch_directory,
            commands::watcher::reconcile_directory_watches,
            commands::watcher::watch_custom_css,
            commands::watcher::unwatch_custom_css,
            commands::launch::is_fresh_launch,
            commands::launch::get_cli_args,
            commands::shell_integration::get_shell_integration_status,
            commands::shell_integration::set_shell_integration_enabled,
            commands::search::search_in_directory,
            commands::wiki::resolve_wiki_links,
            commands::sources::register_native_source,
            commands::sources::register_native_document_source,
            commands::sources::register_zip_source,
            commands::sources::reload_zip_source,
            commands::sources::unregister_source,
            commands::sources::list_source_entries,
            commands::sources::list_source_markdown_documents,
            commands::sources::read_source_markdown,
            commands::sources::read_source_image,
            commands::sources::search_source,
            commands::sources::resolve_source_wiki_links,
            commands::sources::list_source_backlinks,
            commands::update::check_for_updates,
            commands::menu::set_native_theme,
            commands::menu::set_menu_language,
            menu::show_app_menu,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
