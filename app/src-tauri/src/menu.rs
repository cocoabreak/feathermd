use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, Wry};
use tauri_plugin_store::StoreExt;

/// メニューラベルの言語別辞書。フロントエンドの `$lib/i18n` と対になるRust側の辞書で、
/// メニューIDは言語に依存させない（コマンドルーティングはIDのみで行う）。
struct MenuLabels {
    file_menu: &'static str,
    file_open: &'static str,
    folder_open: &'static str,
    archive_open: &'static str,
    quick_open: &'static str,
    folder_close: &'static str,
    external_editor: &'static str,
    print: &'static str,
    settings: &'static str,
    quit: &'static str,
    edit_menu: &'static str,
    reopen_closed_tab: &'static str,
    search_page: &'static str,
    search_global: &'static str,
    view_menu: &'static str,
    toggle_sidebar: &'static str,
    toggle_toc: &'static str,
    command_palette: &'static str,
    help_menu: &'static str,
    about: &'static str,
}

const JA: MenuLabels = MenuLabels {
    file_menu: "ファイル",
    file_open: "ファイルを開く...",
    folder_open: "フォルダーを開く...",
    archive_open: "アーカイブを開く...",
    quick_open: "クイックオープン...",
    folder_close: "エクスプローラーを閉じる",
    external_editor: "外部エディターで開く",
    print: "印刷 / PDFとして保存...",
    settings: "設定",
    quit: "終了",
    edit_menu: "編集",
    reopen_closed_tab: "閉じたタブを再度開く",
    search_page: "ページ内検索",
    search_global: "ディレクトリ検索",
    view_menu: "表示",
    toggle_sidebar: "サイドバーの表示/非表示",
    toggle_toc: "目次の表示/非表示",
    command_palette: "コマンドパレット...",
    help_menu: "ヘルプ",
    about: "FeatherMDについて",
};

const EN: MenuLabels = MenuLabels {
    file_menu: "File",
    file_open: "Open File...",
    folder_open: "Open Folder...",
    archive_open: "Open Archive...",
    quick_open: "Quick Open...",
    folder_close: "Close Explorer",
    external_editor: "Open in External Editor",
    print: "Print / Save as PDF...",
    settings: "Settings",
    quit: "Quit",
    edit_menu: "Edit",
    reopen_closed_tab: "Reopen Closed Tab",
    search_page: "Find in Page",
    search_global: "Search in Directory",
    view_menu: "View",
    toggle_sidebar: "Toggle Sidebar",
    toggle_toc: "Toggle Table of Contents",
    command_palette: "Command Palette...",
    help_menu: "Help",
    about: "About FeatherMD",
};

fn labels(locale: &str) -> &'static MenuLabels {
    if locale.to_lowercase().starts_with("ja") {
        &JA
    } else {
        &EN
    }
}

/// 起動時のメニュー言語を決める。settings.jsonの明示設定（ja/en）を優先し、
/// "system"・未設定・読み込み失敗時はOSロケールから判定する
/// （フロントエンド側 `resolveLocale` と同じ規則）。
pub fn resolve_locale(app: &AppHandle) -> String {
    let saved = app
        .store("settings.json")
        .ok()
        .and_then(|store| store.get("settings"))
        .and_then(|settings| {
            settings
                .get("language")
                .and_then(|lang| lang.as_str().map(String::from))
        });
    match saved.as_deref() {
        Some(locale @ ("ja" | "en")) => locale.to_string(),
        _ => {
            let os_locale = sys_locale::get_locale().unwrap_or_default();
            if os_locale.to_lowercase().starts_with("ja") {
                "ja".to_string()
            } else {
                "en".to_string()
            }
        }
    }
}

pub fn build_menu(app: &AppHandle, locale: &str) -> tauri::Result<Menu<Wry>> {
    let l = labels(locale);

    let file_open = MenuItemBuilder::new(l.file_open)
        .id("file.open")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let folder_open = MenuItemBuilder::new(l.folder_open)
        .id("file.openFolder")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;
    let archive_open = MenuItemBuilder::new(l.archive_open)
        .id("file.openArchive")
        .build(app)?;
    let quick_open = MenuItemBuilder::new(l.quick_open)
        .id("quickOpen.open")
        .accelerator("CmdOrCtrl+P")
        .build(app)?;
    let folder_close = MenuItemBuilder::new(l.folder_close)
        .id("file.closeFolder")
        .build(app)?;
    let settings = MenuItemBuilder::new(l.settings)
        .id("settings.open")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let external_editor = MenuItemBuilder::new(l.external_editor)
        .id("file.openExternalEditor")
        .accelerator("CmdOrCtrl+E")
        .build(app)?;
    let print = MenuItemBuilder::new(l.print)
        .id("export.print")
        .build(app)?;

    let file_menu = SubmenuBuilder::new(app, l.file_menu)
        .item(&file_open)
        .item(&folder_open)
        .item(&archive_open)
        .item(&quick_open)
        .item(&folder_close)
        .separator()
        .item(&external_editor)
        .item(&print)
        .separator()
        .item(&settings)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some(l.quit))?)
        .build()?;

    let toggle_sidebar = MenuItemBuilder::new(l.toggle_sidebar)
        .id("panel.toggleSidebar")
        .accelerator("CmdOrCtrl+B")
        .build(app)?;
    let toggle_toc = MenuItemBuilder::new(l.toggle_toc)
        .id("panel.toggleToc")
        .accelerator("CmdOrCtrl+J")
        .build(app)?;
    let command_palette = MenuItemBuilder::new(l.command_palette)
        .id("commandPalette.open")
        .accelerator("CmdOrCtrl+Shift+P")
        .build(app)?;

    let view_menu = SubmenuBuilder::new(app, l.view_menu)
        .item(&command_palette)
        .separator()
        .item(&toggle_sidebar)
        .item(&toggle_toc)
        .build()?;

    let reopen_closed_tab = MenuItemBuilder::new(l.reopen_closed_tab)
        .id("tab.reopenClosed")
        .accelerator("CmdOrCtrl+Shift+T")
        .build(app)?;
    let search_page = MenuItemBuilder::new(l.search_page)
        .id("search.open")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let search_global = MenuItemBuilder::new(l.search_global)
        .id("globalSearch.open")
        .accelerator("CmdOrCtrl+Shift+F")
        .build(app)?;

    let edit_menu = SubmenuBuilder::new(app, l.edit_menu)
        .item(&reopen_closed_tab)
        .separator()
        .item(&search_page)
        .item(&search_global)
        .build()?;

    let about = MenuItemBuilder::new(l.about).id("help.about").build(app)?;
    let help_menu = SubmenuBuilder::new(app, l.help_menu).item(&about).build()?;

    MenuBuilder::new(app)
        .items(&[&file_menu, &edit_menu, &view_menu, &help_menu])
        .build()
}

pub fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();
    let _ = app.emit("menu-action", id);
}

/// カスタムタイトルバーのボタン位置に、既存のアプリメニューをネイティブ表示する。
#[tauri::command]
pub fn show_app_menu(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    if !x.is_finite() || !y.is_finite() || x < 0.0 || y < 0.0 {
        return Err("メニュー位置が不正です".to_string());
    }
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "メインウィンドウが見つかりません".to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let size = window
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    if x > size.width || y > size.height {
        return Err("メニュー位置がウィンドウ範囲外です".to_string());
    }
    let menu = app
        .menu()
        .ok_or_else(|| "アプリメニューが見つかりません".to_string())?;
    window
        .popup_menu_at(&menu, LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}
