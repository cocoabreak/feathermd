pub mod app_state;
pub mod export;
pub mod file;
pub mod launch;
pub mod menu;
pub mod search;
pub mod shell_integration;
pub mod sources;
pub mod update;
pub mod watcher;
pub mod wiki;

use std::path::Path;

/// エクスプローラー表示・ディレクトリ検索・Wikiリンク解決で対象とするMarkdownファイルの
/// 拡張子（小文字・ドットなし）。各コマンドでの二重定義を避けるためここに集約する。
pub const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown"];

/// 拡張子文字列（ドットなし）がMarkdown対象かを大文字小文字を無視して判定する
pub fn is_markdown_extension(ext: &str) -> bool {
    MARKDOWN_EXTENSIONS
        .iter()
        .any(|e| ext.eq_ignore_ascii_case(e))
}

/// パスの拡張子がMarkdown対象かを判定する
pub fn has_markdown_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(is_markdown_extension)
}
