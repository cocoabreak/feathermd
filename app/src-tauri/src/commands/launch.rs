use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::State;

use super::file::MAX_INPUT_PATHS;

#[derive(Default)]
struct CliDispatchState {
    initial_args_taken: bool,
    pending_args: Vec<String>,
}

pub struct LaunchState {
    fresh: AtomicBool,
    cli: Mutex<CliDispatchState>,
}

impl LaunchState {
    pub fn new() -> Self {
        Self {
            fresh: AtomicBool::new(false),
            cli: Mutex::new(CliDispatchState::default()),
        }
    }

    fn take_fresh(&self) -> bool {
        !self.fresh.swap(true, Ordering::SeqCst)
    }

    /// CLI要求の本体はRust側に保持し、イベントはフロントエンドを起こす通知にだけ使う。
    /// WebView再読み込み中に通知を取りこぼしても、次のget_cli_argsで回収できる。
    pub fn queue_cli_args(&self, args: Vec<String>) {
        let mut state = self.cli.lock().unwrap_or_else(|error| error.into_inner());
        let remaining = MAX_INPUT_PATHS.saturating_sub(state.pending_args.len());
        state.pending_args.extend(args.into_iter().take(remaining));
    }

    fn take_cli_args(&self, initial_args: Vec<String>) -> Vec<String> {
        let mut state = self.cli.lock().unwrap_or_else(|error| error.into_inner());
        let mut args = Vec::with_capacity(MAX_INPUT_PATHS);
        if !state.initial_args_taken {
            args.extend(initial_args.into_iter().take(MAX_INPUT_PATHS));
            state.initial_args_taken = true;
        }
        let remaining = MAX_INPUT_PATHS.saturating_sub(args.len());
        args.extend(state.pending_args.drain(..).take(remaining));
        state.pending_args.clear();
        args
    }
}

/// このプロセスで初めて呼ばれた場合のみtrueを返す。
/// Ctrl+R/F5によるWebViewの再読み込みはRustプロセスを再起動しないため、
/// 2回目以降の呼び出しはアプリ本来の再起動ではなくリロード起因と判定できる。
#[tauri::command]
pub fn is_fresh_launch(state: State<'_, LaunchState>) -> bool {
    state.take_fresh()
}

#[tauri::command]
pub fn get_cli_args(state: State<'_, LaunchState>) -> Vec<String> {
    state.take_cli_args(initial_cli_args())
}

pub fn initial_cli_args() -> Vec<String> {
    let cwd = std::env::current_dir().unwrap_or_default();
    user_cli_args(std::env::args().collect(), &cwd)
}

pub fn user_cli_args(args: Vec<String>, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .take(MAX_INPUT_PATHS)
        .map(PathBuf::from)
        .filter_map(|path| {
            if path.is_absolute() {
                Some(path)
            } else if cwd.is_absolute() {
                Some(cwd.join(path))
            } else {
                None
            }
        })
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_call_is_fresh_subsequent_are_not() {
        let state = LaunchState::new();
        assert!(state.take_fresh());
        assert!(!state.take_fresh());
        assert!(!state.take_fresh());
    }

    #[test]
    fn cli_args_stay_queued_until_frontend_takes_them() {
        let state = LaunchState::new();
        state.queue_cli_args(vec!["second.md".into()]);

        assert_eq!(
            state.take_cli_args(vec!["first.md".into()]),
            vec!["first.md", "second.md"]
        );
        state.queue_cli_args(vec!["third.md".into()]);
        assert_eq!(state.take_cli_args(Vec::new()), vec!["third.md"]);
    }

    #[test]
    fn queued_cli_args_are_bounded_and_initial_args_are_only_taken_once() {
        let state = LaunchState::new();
        let queued = (0..(MAX_INPUT_PATHS + 2))
            .map(|i| format!("queued-{i}.md"))
            .collect();
        state.queue_cli_args(queued);

        let first = state.take_cli_args(vec!["initial.md".into()]);
        assert_eq!(first.len(), MAX_INPUT_PATHS);
        assert_eq!(first[0], "initial.md");
        assert_eq!(first[1], "queued-0.md");
        assert!(state.take_cli_args(vec!["initial.md".into()]).is_empty());
    }

    #[test]
    fn user_cli_args_excludes_executable_and_keeps_32_inputs() {
        let mut args = vec!["feathermd.exe".to_string()];
        args.extend((0..(MAX_INPUT_PATHS + 2)).map(|i| format!("note-{i}.md")));
        let cwd = std::env::temp_dir().join("feathermd-cli-test");

        let result = user_cli_args(args, &cwd);

        assert_eq!(result.len(), MAX_INPUT_PATHS);
        assert_eq!(PathBuf::from(&result[0]), cwd.join("note-0.md"));
        assert_eq!(
            PathBuf::from(&result[MAX_INPUT_PATHS - 1]),
            cwd.join("note-31.md")
        );
    }

    #[test]
    fn user_cli_args_resolves_relative_paths_against_request_cwd() {
        let cwd = std::env::temp_dir().join("feathermd-project");
        let result = user_cli_args(vec!["feathermd.exe".into(), "docs/guide.md".into()], &cwd);

        assert_eq!(PathBuf::from(&result[0]), cwd.join("docs/guide.md"));
    }

    #[test]
    fn user_cli_args_keeps_absolute_paths() {
        let absolute = std::env::temp_dir()
            .join("feathermd-notes")
            .join("README.md");
        let ignored_cwd = std::env::temp_dir().join("ignored");
        let result = user_cli_args(
            vec![
                "feathermd.exe".into(),
                absolute.to_string_lossy().into_owned(),
            ],
            &ignored_cwd,
        );

        assert_eq!(PathBuf::from(&result[0]), absolute);
    }

    #[test]
    fn user_cli_args_drops_relative_paths_when_request_cwd_is_invalid() {
        let result = user_cli_args(
            vec!["feathermd.exe".into(), "README.md".into()],
            Path::new(""),
        );

        assert!(result.is_empty());
    }
}
