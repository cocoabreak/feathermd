use crate::commands::file::NativeDialogState;
use std::path::PathBuf;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;

fn text_export_spec(format: &str) -> Result<(&'static str, &'static str), String> {
    match format {
        "html" => Ok(("HTML Document", "html")),
        "svg" => Ok(("SVG Image", "svg")),
        _ => Err("未対応のテキスト出力形式です".to_string()),
    }
}

fn binary_export_spec(format: &str) -> Result<(&'static str, &'static str), String> {
    match format {
        "png" => Ok(("PNG Image", "png")),
        _ => Err("未対応のバイナリ出力形式です".to_string()),
    }
}

fn validate_export_size(length: usize) -> Result<(), String> {
    if length > MAX_EXPORT_BYTES {
        Err(format!(
            "出力データが上限（{} MiB）を超えています",
            MAX_EXPORT_BYTES / 1024 / 1024
        ))
    } else {
        Ok(())
    }
}

fn suggested_file_name(suggested: &str, extension: &str) -> String {
    let leaf = suggested
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .trim();
    let mut sanitized = leaf
        .chars()
        .take(120)
        .map(|character| {
            if character.is_control()
                || matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
            {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();
    sanitized = sanitized.trim_matches([' ', '.']).to_string();
    if sanitized.is_empty() {
        sanitized = "export".to_string();
    }
    if !sanitized
        .to_ascii_lowercase()
        .ends_with(&format!(".{extension}"))
    {
        sanitized.push('.');
        sanitized.push_str(extension);
    }
    sanitized
}

fn validate_selected_extension(path: PathBuf, extension: &str) -> Result<PathBuf, String> {
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(extension))
    {
        Ok(path)
    } else {
        Err(format!("保存先には.{extension}ファイルを指定してください"))
    }
}

fn pick_export_path(
    app: &AppHandle,
    filter_name: &'static str,
    extension: &'static str,
    suggested_name: &str,
) -> Result<Option<PathBuf>, String> {
    let selected = app
        .dialog()
        .file()
        .add_filter(filter_name, &[extension])
        .set_file_name(suggested_file_name(suggested_name, extension))
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|error| format!("選択した保存先を解決できません: {error}"))?;
    Ok(Some(validate_selected_extension(path, extension)?))
}

#[tauri::command]
pub async fn save_text_export(
    app: AppHandle,
    dialogs: State<'_, NativeDialogState>,
    format: String,
    suggested_name: String,
    contents: String,
) -> Result<bool, String> {
    let (filter_name, extension) = text_export_spec(&format)?;
    validate_export_size(contents.len())?;
    let _dialog_guard = dialogs.try_acquire()?;
    let Some(path) = pick_export_path(&app, filter_name, extension, &suggested_name)? else {
        return Ok(false);
    };
    std::fs::write(path, contents.as_bytes()).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn save_binary_export(
    app: AppHandle,
    dialogs: State<'_, NativeDialogState>,
    format: String,
    suggested_name: String,
    contents: Vec<u8>,
) -> Result<bool, String> {
    let (filter_name, extension) = binary_export_spec(&format)?;
    validate_export_size(contents.len())?;
    let _dialog_guard = dialogs.try_acquire()?;
    let Some(path) = pick_export_path(&app, filter_name, extension, &suggested_name)? else {
        return Ok(false);
    };
    std::fs::write(path, contents).map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_formats_are_separated_by_content_type() {
        assert!(text_export_spec("html").is_ok());
        assert!(text_export_spec("svg").is_ok());
        assert!(text_export_spec("png").is_err());
        assert!(binary_export_spec("png").is_ok());
        assert!(binary_export_spec("html").is_err());
    }

    #[test]
    fn suggested_name_cannot_inject_a_path_or_invalid_filename_characters() {
        assert_eq!(
            suggested_file_name("../../report<draft>", "html"),
            "report_draft_.html"
        );
        assert_eq!(suggested_file_name("notes.svg", "svg"), "notes.svg");
        assert_eq!(suggested_file_name("...", "png"), "export.png");
    }

    #[test]
    fn export_size_limit_accepts_boundary_and_rejects_one_byte_over() {
        assert!(validate_export_size(MAX_EXPORT_BYTES).is_ok());
        assert!(validate_export_size(MAX_EXPORT_BYTES + 1).is_err());
    }

    #[test]
    fn selected_path_must_match_the_confirmed_format_extension() {
        assert!(validate_selected_extension(PathBuf::from("report.txt"), "html").is_err());
        assert_eq!(
            validate_selected_extension(PathBuf::from("diagram.SVG"), "svg").unwrap(),
            PathBuf::from("diagram.SVG")
        );
    }
}
