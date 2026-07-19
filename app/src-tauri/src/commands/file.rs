#[cfg(test)]
use base64::{engine::general_purpose::STANDARD, Engine};
#[cfg(test)]
use std::fs::File;
#[cfg(test)]
use std::path::{Path, PathBuf};

pub(crate) mod dialogs;
pub(crate) mod external_editor;
mod persistent_trust;
pub(crate) mod readers;
mod safe_outline;
pub(crate) mod trusted_paths;

pub use dialogs::NativeDialogState;
pub use external_editor::ExternalEditorState;
pub(crate) use persistent_trust::restore_persisted_explorer_root;
#[cfg(test)]
use persistent_trust::validate_persisted_explorer_root;
pub use persistent_trust::PersistentExplorerRoot;
pub(crate) use readers::{
    build_markdown_content, mime_from_extension, normalize_path_for_display,
    normalize_path_for_frontend, read_dir_single_level, read_file_inner, MarkdownFileContent,
    MAX_IMAGE_BYTES, MAX_MARKDOWN_BYTES,
};
#[cfg(test)]
use readers::{
    observed_markdown_size, read_custom_css_inner, read_file_with_size_inner,
    requires_large_markdown_confirmation, LARGE_MARKDOWN_WARNING_BYTES,
};
#[cfg(test)]
use trusted_paths::dangerous_root_reason;
pub use trusted_paths::{AllowedRoots, MAX_INPUT_PATHS};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persisted_explorer_root_rejects_file_values() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("README.md");
        std::fs::write(&file, "test").unwrap();

        assert!(validate_persisted_explorer_root(&file.to_string_lossy()).is_err());
        assert!(validate_persisted_explorer_root(&dir.path().to_string_lossy()).is_ok());
    }
    use std::fs;

    /// 指定ディレクトリを信頼済みにしたAllowedRootsを生成するテストヘルパー
    fn roots_with(dir: &Path) -> AllowedRoots {
        let roots = AllowedRoots::new();
        roots
            .register(&dir.to_string_lossy())
            .expect("テスト用ルートの登録に失敗");
        roots
    }

    #[test]
    fn native_dialog_state_rejects_concurrent_dialogs_and_releases_guard() {
        let dialogs = NativeDialogState::new();
        let guard = dialogs.try_acquire().unwrap();
        assert!(dialogs.try_acquire().is_err());

        drop(guard);

        assert!(dialogs.try_acquire().is_ok());
    }

    #[test]
    fn external_editor_state_can_replace_and_clear_authorization() {
        let editors = ExternalEditorState::new();
        let first = PathBuf::from("editor-a.exe");
        let second = PathBuf::from("editor-b.exe");

        editors.set(first.clone());
        assert_eq!(editors.get(), Some(first));
        editors.set(second.clone());
        assert_eq!(editors.get(), Some(second));
        editors.clear();
        assert_eq!(editors.get(), None);
    }

    #[test]
    fn read_file_returns_error_for_missing_path() {
        let roots = AllowedRoots::new();
        let result = read_file_inner(&roots, "does-not-exist.md");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("解決に失敗"));
    }

    #[test]
    fn read_file_returns_contents_for_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, "# hello").unwrap();

        let roots = roots_with(dir.path());
        let result = read_file_inner(&roots, &path.to_string_lossy());
        assert_eq!(result.unwrap(), "# hello");
    }

    #[test]
    fn markdown_content_includes_safe_outline_below_warning_threshold() {
        let content = build_markdown_content("# One\n\n## Two\n".to_string(), 15);

        assert!(!content.requires_confirmation);
        assert_eq!(content.safe_outline.len(), 2);
        assert_eq!(content.safe_outline[0].text, "One");
        assert!(!content.safe_outline_truncated);
    }

    #[test]
    fn read_file_rejects_path_outside_root() {
        let root_dir = tempfile::tempdir().unwrap();
        let outside_dir = tempfile::tempdir().unwrap();
        let outside = outside_dir.path().join("secret.md");
        fs::write(&outside, "secret").unwrap();

        let roots = roots_with(root_dir.path());
        let result = read_file_inner(&roots, &outside.to_string_lossy());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("許可されていない"));
    }

    #[test]
    fn read_file_rejects_non_markdown_extension() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secret.txt");
        fs::write(&path, "secret").unwrap();

        let roots = roots_with(dir.path());
        let result = read_file_inner(&roots, &path.to_string_lossy());

        assert!(result.unwrap_err().contains("Markdownファイル"));
    }

    #[test]
    fn read_file_rejects_files_larger_than_limit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("huge.md");
        let file = File::create(&path).unwrap();
        file.set_len(MAX_MARKDOWN_BYTES + 1).unwrap();

        let roots = roots_with(dir.path());
        let result = read_file_inner(&roots, &path.to_string_lossy());

        assert!(result.unwrap_err().contains("10MiB"));
    }

    #[test]
    fn read_file_marks_warning_threshold_and_reports_exact_size() {
        let dir = tempfile::tempdir().unwrap();
        let below = dir.path().join("below.md");
        let at = dir.path().join("at.md");
        File::create(&below)
            .unwrap()
            .set_len(LARGE_MARKDOWN_WARNING_BYTES - 1)
            .unwrap();
        File::create(&at)
            .unwrap()
            .set_len(LARGE_MARKDOWN_WARNING_BYTES)
            .unwrap();
        let roots = roots_with(dir.path());

        let (_, below_size) = read_file_with_size_inner(&roots, &below.to_string_lossy()).unwrap();
        let (_, at_size) = read_file_with_size_inner(&roots, &at.to_string_lossy()).unwrap();

        assert_eq!(below_size, LARGE_MARKDOWN_WARNING_BYTES - 1);
        assert!(!requires_large_markdown_confirmation(below_size));
        assert_eq!(at_size, LARGE_MARKDOWN_WARNING_BYTES);
        assert!(requires_large_markdown_confirmation(at_size));
        assert!(requires_large_markdown_confirmation(MAX_MARKDOWN_BYTES));
    }

    #[test]
    fn read_file_warning_uses_larger_of_metadata_and_actual_bytes() {
        let observed = observed_markdown_size(
            LARGE_MARKDOWN_WARNING_BYTES - 1,
            LARGE_MARKDOWN_WARNING_BYTES as usize,
        );

        assert_eq!(observed, LARGE_MARKDOWN_WARNING_BYTES);
        assert!(requires_large_markdown_confirmation(observed));
    }

    #[test]
    fn read_custom_css_accepts_allowed_css() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("theme.css");
        std::fs::write(&path, "h1 { color: red; }").unwrap();
        let roots = AllowedRoots::new();
        roots.register(path.to_str().unwrap()).unwrap();

        let result = read_custom_css_inner(&roots, path.to_str().unwrap()).unwrap();

        assert_eq!(result, "h1 { color: red; }");
    }

    #[test]
    fn read_custom_css_rejects_non_css_extension() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("theme.txt");
        std::fs::write(&path, "secret").unwrap();
        let roots = AllowedRoots::new();
        roots.register(path.to_str().unwrap()).unwrap();

        let result = read_custom_css_inner(&roots, path.to_str().unwrap());

        assert!(result.unwrap_err().contains(".css"));
    }

    #[test]
    fn read_directory_entry_paths_have_no_verbatim_prefix() {
        // Windowsのcanonicalizeは `\\?\` プレフィックスを付ける。安全のため
        // canonicalize済み起点を走査しても、フロントへ返すパスからprefixが除去されることを保証する。
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("README.md"), "").unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();

        let roots = roots_with(dir.path());
        let canonical = roots.resolve(&dir.path().to_string_lossy()).unwrap();
        let entries = read_dir_single_level(&canonical, false, Some(&roots));

        assert!(!entries.is_empty());
        for e in &entries {
            assert!(
                !e.path.contains("//?/") && !e.path.contains("\\\\?\\") && !e.path.contains("?/"),
                "エントリパスにverbatimプレフィックスが混入: {}",
                e.path
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn display_path_removes_windows_verbatim_prefix() {
        assert_eq!(
            normalize_path_for_display(Path::new(r"\\?\D:\projects\notes")),
            r"D:\projects\notes"
        );
        assert_eq!(
            normalize_path_for_display(Path::new(r"\\?\UNC\server\share\notes")),
            r"\\server\share\notes"
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn display_path_preserves_non_windows_path() {
        assert_eq!(
            normalize_path_for_display(Path::new("/home/alice/notes")),
            "/home/alice/notes"
        );
    }

    #[test]
    fn read_directory_returns_single_level_with_unloaded_children() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("sub").join("child.md"), "").unwrap();
        fs::write(dir.path().join("top.md"), "").unwrap();

        let entries = read_dir_single_level(dir.path(), false, None);
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();

        // 直下のみ返し、サブフォルダの中身（child.md）は含まれない
        assert_eq!(names, vec!["sub", "top.md"]);
        // childrenは未取得（None）— フロントエンドが展開時に遅延取得する
        let sub = entries.iter().find(|e| e.name == "sub").unwrap();
        assert!(sub.is_dir);
        assert!(sub.children.is_none());
    }

    #[test]
    fn read_directory_filters_non_viewable_files_but_keeps_directories() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("note.md"), "").unwrap();
        fs::write(dir.path().join("NOTE2.MARKDOWN"), "").unwrap();
        fs::write(dir.path().join("binary.exe"), "").unwrap();
        fs::write(dir.path().join("noext"), "").unwrap();
        fs::create_dir(dir.path().join("assets")).unwrap();

        let entries = read_dir_single_level(dir.path(), false, None);
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();

        // ディレクトリは常に含め、ファイルはMarkdown系のみ（拡張子は大小文字無視）
        assert_eq!(names, vec!["assets", "note.md", "NOTE2.MARKDOWN"]);
    }

    #[test]
    fn read_directory_respects_gitignore_when_enabled() {
        let dir = tempfile::tempdir().unwrap();
        // gitリポジトリとして初期化しないと.gitignoreは適用されない（require_git）ため、
        // .gitディレクトリの体裁だけ用意する
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".gitignore"), "ignored/\nsecret.md\n").unwrap();
        fs::create_dir(dir.path().join("ignored")).unwrap();
        fs::create_dir(dir.path().join("kept")).unwrap();
        fs::write(dir.path().join("secret.md"), "").unwrap();
        fs::write(dir.path().join("visible.md"), "").unwrap();

        let names = |respect: bool| -> Vec<String> {
            read_dir_single_level(dir.path(), respect, None)
                .into_iter()
                .map(|e| e.name)
                .collect()
        };

        // 有効時: gitignore対象（ignored/ と secret.md）が除外される
        let filtered = names(true);
        assert!(!filtered.contains(&"ignored".to_string()));
        assert!(!filtered.contains(&"secret.md".to_string()));
        assert!(filtered.contains(&"kept".to_string()));
        assert!(filtered.contains(&"visible.md".to_string()));

        // 無効時: すべて含まれる
        let unfiltered = names(false);
        assert!(unfiltered.contains(&"ignored".to_string()));
        assert!(unfiltered.contains(&"secret.md".to_string()));
    }

    #[test]
    fn read_directory_applies_root_gitignore_to_subdirectory_scan() {
        // 遅延読み込みではサブフォルダ単体で走査するため、ルートの.gitignoreが
        // 親遡り（parents）で適用されることを保証する
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".gitignore"), "ignored-note.md\n").unwrap();
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("note.md"), "").unwrap();
        fs::write(sub.join("ignored-note.md"), "").unwrap();

        let names: Vec<String> = read_dir_single_level(&sub, true, None)
            .into_iter()
            .map(|e| e.name)
            .collect();

        assert!(names.contains(&"note.md".to_string()));
        assert!(!names.contains(&"ignored-note.md".to_string()));
    }

    #[test]
    fn read_directory_sorts_directories_before_files_case_insensitive() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("banana.md"), "").unwrap();
        fs::write(dir.path().join("Apple.md"), "").unwrap();
        fs::create_dir(dir.path().join("zeta")).unwrap();
        fs::create_dir(dir.path().join("alpha")).unwrap();

        let roots = roots_with(dir.path());
        let canonical = roots.resolve(&dir.path().to_string_lossy()).unwrap();
        let entries = read_dir_single_level(&canonical, false, None);
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();

        // ディレクトリ (alpha, zeta) が先、その後ファイル (Apple.md, banana.md) が大小文字無視で並ぶ
        assert_eq!(names, vec!["alpha", "zeta", "Apple.md", "banana.md"]);
    }

    #[test]
    fn read_directory_marks_dotfiles_as_hidden() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(".hidden.md"), "").unwrap();
        fs::write(dir.path().join("visible.md"), "").unwrap();

        let roots = roots_with(dir.path());
        let canonical = roots.resolve(&dir.path().to_string_lossy()).unwrap();
        let entries = read_dir_single_level(&canonical, false, None);

        let hidden = entries.iter().find(|e| e.name == ".hidden.md").unwrap();
        let visible = entries.iter().find(|e| e.name == "visible.md").unwrap();
        assert!(hidden.is_hidden);
        assert!(!visible.is_hidden);
    }

    #[test]
    fn is_allowed_true_for_path_inside_root() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        let file = sub.join("note.md");
        fs::write(&file, "").unwrap();

        let roots = roots_with(dir.path());
        assert!(roots.is_allowed(&file.to_string_lossy()));
    }

    #[test]
    fn is_allowed_false_for_path_outside_root() {
        let root_dir = tempfile::tempdir().unwrap();
        let outside_dir = tempfile::tempdir().unwrap();
        let outside_file = outside_dir.path().join("secret.md");
        fs::write(&outside_file, "").unwrap();

        let roots = roots_with(root_dir.path());
        assert!(!roots.is_allowed(&outside_file.to_string_lossy()));
    }

    #[test]
    fn is_allowed_false_for_nonexistent_path() {
        let roots = AllowedRoots::new();
        assert!(!roots.is_allowed("does-not-exist.md"));
    }

    #[test]
    fn register_file_trusts_its_parent_directory() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("note.md");
        fs::write(&file, "").unwrap();
        let sibling = dir.path().join("sibling.md");
        fs::write(&sibling, "").unwrap();

        let roots = AllowedRoots::new();
        // ファイルを登録すると親フォルダ全体が信頼される
        roots.register(&file.to_string_lossy()).unwrap();
        assert!(roots.is_allowed(&sibling.to_string_lossy()));
    }

    #[test]
    fn register_single_file_does_not_trust_its_parent_directory() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("notes.zip");
        let sibling = dir.path().join("secret.md");
        fs::write(&archive, "archive").unwrap();
        fs::write(&sibling, "secret").unwrap();

        let roots = AllowedRoots::new();
        roots.register_zip_file(&archive.to_string_lossy()).unwrap();

        assert!(roots.is_allowed(&archive.to_string_lossy()));
        assert!(!roots.is_allowed(&sibling.to_string_lossy()));
    }

    #[test]
    fn register_zip_file_rejects_non_zip_targets() {
        let dir = tempfile::tempdir().unwrap();
        let secret = dir.path().join("secret.md");
        fs::write(&secret, "secret").unwrap();
        let roots = AllowedRoots::new();

        assert!(roots.register_zip_file(&secret.to_string_lossy()).is_err());
        assert!(!roots.is_allowed(&secret.to_string_lossy()));
    }

    #[test]
    fn confirmed_zip_registration_rejects_changed_target() {
        let dir = tempfile::tempdir().unwrap();
        let expected_path = dir.path().join("expected.zip");
        let changed_path = dir.path().join("changed.zip");
        fs::write(&expected_path, "expected").unwrap();
        fs::write(&changed_path, "changed").unwrap();
        let expected =
            AllowedRoots::canonical_zip_file_path(&expected_path.to_string_lossy()).unwrap();
        let roots = AllowedRoots::new();

        assert!(roots
            .register_zip_file_if_unchanged(&changed_path.to_string_lossy(), &expected)
            .is_err());
        assert!(!roots.is_allowed(&expected_path.to_string_lossy()));
        assert!(!roots.is_allowed(&changed_path.to_string_lossy()));
    }

    #[cfg(unix)]
    #[test]
    fn register_zip_file_rejects_zip_named_symlink_to_non_zip_target() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().unwrap();
        let secret = dir.path().join("secret.md");
        let bait = dir.path().join("bait.zip");
        fs::write(&secret, "secret").unwrap();
        symlink(&secret, &bait).unwrap();
        let roots = AllowedRoots::new();

        assert!(roots.register_zip_file(&bait.to_string_lossy()).is_err());
        assert!(!roots.is_allowed(&secret.to_string_lossy()));
    }

    #[test]
    fn register_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let roots = AllowedRoots::new();
        roots.register(&dir.path().to_string_lossy()).unwrap();
        roots.register(&dir.path().to_string_lossy()).unwrap();
        assert_eq!(roots.0.lock().unwrap().roots.len(), 1);
    }

    #[test]
    fn register_returns_error_for_missing_path() {
        let roots = AllowedRoots::new();
        let result = roots.register("does-not-exist-dir");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("解決に失敗"));
    }

    #[test]
    fn register_input_paths_registers_only_first_folder_and_ignores_non_markdown_files() {
        let dir = tempfile::tempdir().unwrap();
        let mut paths = Vec::new();
        for i in 0..(MAX_INPUT_PATHS + 2) {
            let sub = dir.path().join(format!("root-{i}"));
            fs::create_dir(&sub).unwrap();
            paths.push(sub);
        }
        let ignored = dir.path().join("ignored.txt");
        fs::write(&ignored, "ignored").unwrap();
        paths.insert(0, ignored);

        let roots = AllowedRoots::new();
        roots.register_input_paths(&paths);

        assert_eq!(roots.0.lock().unwrap().roots.len(), 1);
    }

    #[test]
    fn register_input_paths_caps_markdown_file_count() {
        let dir = tempfile::tempdir().unwrap();
        let mut paths = Vec::new();
        for i in 0..(MAX_INPUT_PATHS + 2) {
            let sub = dir.path().join(format!("root-{i}"));
            fs::create_dir(&sub).unwrap();
            let note = sub.join("note.md");
            fs::write(&note, "# note").unwrap();
            paths.push(note);
        }

        let roots = AllowedRoots::new();
        roots.register_input_paths(&paths);

        assert_eq!(roots.0.lock().unwrap().roots.len(), MAX_INPUT_PATHS);
    }

    #[test]
    fn register_input_paths_trusts_only_zip_file_for_cli_and_drag_drop() {
        let dir = tempfile::tempdir().unwrap();
        let archive_dir = dir.path().join("archives");
        fs::create_dir(&archive_dir).unwrap();
        let archive = archive_dir.join("notes.ZIP");
        let sibling = archive_dir.join("secret.md");
        fs::write(&archive, b"not parsed during trust registration").unwrap();
        fs::write(&sibling, "secret").unwrap();

        let roots = AllowedRoots::new();
        roots.register_input_paths(std::slice::from_ref(&archive));

        assert!(roots.resolve(&archive.to_string_lossy()).is_ok());
        assert!(roots.resolve(&sibling.to_string_lossy()).is_err());
        let entries = roots.0.lock().unwrap();
        assert!(entries.roots.is_empty());
        assert_eq!(entries.files.len(), 1);
    }

    #[test]
    fn read_image_data_url_inner_returns_data_url_for_path_inside_root() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("pic.png");
        fs::write(&file, [0x89, 0x50, 0x4e, 0x47]).unwrap();

        let roots = roots_with(dir.path());
        let canonical = roots.resolve(&file.to_string_lossy()).unwrap();
        let bytes = std::fs::read(&canonical).unwrap();
        let data_url = format!(
            "data:{};base64,{}",
            mime_from_extension(&canonical),
            STANDARD.encode(bytes)
        );
        assert!(data_url.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn read_image_data_url_rejects_path_outside_root() {
        let root_dir = tempfile::tempdir().unwrap();
        let outside_dir = tempfile::tempdir().unwrap();
        let outside_file = outside_dir.path().join("secret.png");
        fs::write(&outside_file, [0x89, 0x50, 0x4e, 0x47]).unwrap();

        let roots = roots_with(root_dir.path());
        assert!(roots.resolve(&outside_file.to_string_lossy()).is_err());
    }

    #[test]
    fn mime_from_extension_detects_common_image_types() {
        assert_eq!(mime_from_extension(Path::new("a.PNG")), "image/png");
        assert_eq!(mime_from_extension(Path::new("a.jpg")), "image/jpeg");
        assert_eq!(mime_from_extension(Path::new("a.svg")), "image/svg+xml");
        assert_eq!(
            mime_from_extension(Path::new("a.unknown")),
            "application/octet-stream"
        );
    }

    #[test]
    fn dangerous_root_reason_flags_drive_and_system_and_profile_roots() {
        // ドライブ直下
        assert!(dangerous_root_reason(Path::new(r"C:\")).is_some());
        // システムフォルダ
        assert!(dangerous_root_reason(Path::new(r"C:\Windows")).is_some());
        assert!(dangerous_root_reason(Path::new(r"C:\Program Files")).is_some());
        // ユーザープロファイル直下
        assert!(dangerous_root_reason(Path::new(r"C:\Users\alice")).is_some());
        // 通常の作業フォルダは許可
        assert!(dangerous_root_reason(Path::new(r"C:\Users\alice\Documents\notes")).is_none());
        assert!(dangerous_root_reason(Path::new(r"D:\projects\docs")).is_none());
    }
}
