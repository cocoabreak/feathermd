use semver::Version;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::sync::Mutex;
use std::time::Duration;
use std::time::Instant;
use tauri::State;

const LATEST_RELEASE_API_URL: &str =
    "https://api.github.com/repos/cocoabreak/feathermd/releases/latest";
const RELEASES_URL: &str = "https://github.com/cocoabreak/feathermd/releases";
const MAX_RESPONSE_BYTES: u64 = 64 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const RESULT_CACHE_TTL: Duration = Duration::from_secs(30);

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    current_version: String,
    latest_version: String,
    update_available: bool,
    release_url: &'static str,
}

#[derive(Default)]
struct UpdateCheckerInner {
    in_flight: bool,
    last_result: Option<(Instant, Result<UpdateCheckResult, String>)>,
}

#[derive(Default)]
pub struct UpdateCheckerState(Mutex<UpdateCheckerInner>);

impl UpdateCheckerState {
    fn cached_or_reserve(&self) -> Result<Option<Result<UpdateCheckResult, String>>, String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "更新確認状態のロックに失敗しました".to_string())?;
        if let Some((checked_at, result)) = &state.last_result {
            if checked_at.elapsed() < RESULT_CACHE_TTL {
                return Ok(Some(result.clone()));
            }
        }
        if state.in_flight {
            return Err("更新確認はすでに実行中です".to_string());
        }
        state.in_flight = true;
        Ok(None)
    }

    fn finish(&self, result: Result<UpdateCheckResult, String>) -> Result<(), String> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| "更新確認状態のロックに失敗しました".to_string())?;
        state.in_flight = false;
        state.last_result = Some((Instant::now(), result));
        Ok(())
    }
}

fn parse_version(value: &str) -> Result<Version, String> {
    Version::parse(value.trim().strip_prefix('v').unwrap_or(value.trim()))
        .map_err(|_| "リリースのバージョン形式が正しくありません".to_string())
}

fn parse_release(body: &[u8], current_version: &str) -> Result<UpdateCheckResult, String> {
    let release: GitHubRelease = serde_json::from_slice(body)
        .map_err(|_| "GitHub Releasesの応答を解析できませんでした".to_string())?;
    let current = parse_version(current_version)?;
    let latest = parse_version(&release.tag_name)?;
    Ok(UpdateCheckResult {
        current_version: current.to_string(),
        latest_version: latest.to_string(),
        update_available: latest > current,
        release_url: RELEASES_URL,
    })
}

fn request_latest_release() -> Result<UpdateCheckResult, String> {
    let config = ureq::Agent::config_builder()
        .timeout_global(Some(REQUEST_TIMEOUT))
        .max_redirects(0)
        .build();
    let agent: ureq::Agent = config.into();
    let mut response = agent
        .get(LATEST_RELEASE_API_URL)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "FeatherMD")
        .call()
        .map_err(|error| match error {
            ureq::Error::StatusCode(404) => {
                "公開されているGitHub Releaseが見つかりませんでした".to_string()
            }
            _ => format!("GitHub Releasesへ接続できませんでした: {error}"),
        })?;
    let mut body = Vec::new();
    response
        .body_mut()
        .as_reader()
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut body)
        .map_err(|error| format!("GitHub Releasesの応答を読み取れませんでした: {error}"))?;
    if body.len() as u64 > MAX_RESPONSE_BYTES {
        return Err("GitHub Releasesの応答が大きすぎます".to_string());
    }
    parse_release(&body, env!("CARGO_PKG_VERSION"))
}

#[tauri::command(async)]
pub async fn check_for_updates(
    state: State<'_, UpdateCheckerState>,
) -> Result<UpdateCheckResult, String> {
    if let Some(cached) = state.cached_or_reserve()? {
        return cached;
    }
    let result = match tauri::async_runtime::spawn_blocking(request_latest_release).await {
        Ok(result) => result,
        Err(_) => Err("更新確認タスクを完了できませんでした".to_string()),
    };
    state.finish(result.clone())?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_comparison_accepts_v_prefix_and_detects_newer_versions() {
        let result = parse_release(br#"{"tag_name":"v0.2.0"}"#, "0.1.0").unwrap();
        assert!(result.update_available);
        assert_eq!(result.current_version, "0.1.0");
        assert_eq!(result.latest_version, "0.2.0");
        assert_eq!(result.release_url, RELEASES_URL);
    }

    #[test]
    fn release_comparison_treats_equal_and_older_versions_as_current() {
        assert!(
            !parse_release(br#"{"tag_name":"0.1.0"}"#, "0.1.0")
                .unwrap()
                .update_available
        );
        assert!(
            !parse_release(br#"{"tag_name":"v0.0.9"}"#, "0.1.0")
                .unwrap()
                .update_available
        );
    }

    #[test]
    fn release_comparison_rejects_invalid_payloads_and_versions() {
        assert!(parse_release(br#"{}"#, "0.1.0").is_err());
        assert!(parse_release(br#"{"tag_name":"latest"}"#, "0.1.0").is_err());
        assert!(parse_release(br#"{"tag_name":"v0.2.0"}"#, "invalid").is_err());
    }

    #[test]
    fn update_checker_rejects_concurrency_and_caches_results() {
        let state = UpdateCheckerState::default();
        assert!(state.cached_or_reserve().unwrap().is_none());
        assert!(state.cached_or_reserve().is_err());

        let result = UpdateCheckResult {
            current_version: "0.1.0".to_string(),
            latest_version: "0.2.0".to_string(),
            update_available: true,
            release_url: RELEASES_URL,
        };
        state.finish(Ok(result.clone())).unwrap();
        assert_eq!(state.cached_or_reserve().unwrap(), Some(Ok(result)));
    }
}
