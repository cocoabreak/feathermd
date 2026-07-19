use tauri::{AppHandle, Theme};

// uxthemeの非公開ordinalを実機確認済みのWindows 10 1903〜Windows 11範囲に限定する。
#[cfg(windows)]
const SET_PREFERRED_APP_MODE_MIN_BUILD: u32 = 18_362;
#[cfg(windows)]
const SET_PREFERRED_APP_MODE_MAX_BUILD: u32 = 26_200;

#[cfg(windows)]
fn supports_preferred_app_mode(build: u32) -> bool {
    (SET_PREFERRED_APP_MODE_MIN_BUILD..=SET_PREFERRED_APP_MODE_MAX_BUILD).contains(&build)
}

pub(crate) fn parse_theme(theme: &str) -> Result<Option<Theme>, String> {
    match theme {
        "light" => Ok(Some(Theme::Light)),
        "dark" => Ok(Some(Theme::Dark)),
        "system" => Ok(None),
        _ => Err(format!("unsupported theme: {theme}")),
    }
}

/// WebViewのテーマ設定に合わせて、ネイティブメニューなどの外観を更新する。
#[tauri::command]
pub fn set_native_theme(app: AppHandle, theme: String) -> Result<(), String> {
    let parsed = parse_theme(&theme)?;
    app.set_theme(parsed);
    set_windows_app_theme(&theme)?;
    Ok(())
}

#[cfg(not(windows))]
fn set_windows_app_theme(_theme: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn set_windows_app_theme(theme: &str) -> Result<(), String> {
    use std::sync::OnceLock;
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

    const ALLOW_DARK: i32 = 1;
    const FORCE_DARK: i32 = 2;
    const FORCE_LIGHT: i32 = 3;

    #[repr(C)]
    struct OsVersionInfo {
        size: u32,
        major: u32,
        minor: u32,
        build: u32,
        platform_id: u32,
        service_pack: [u16; 128],
    }

    type RtlGetVersion = unsafe extern "system" fn(*mut OsVersionInfo) -> i32;
    type SetPreferredAppMode = unsafe extern "system" fn(i32) -> i32;
    type RefreshTheme = unsafe extern "system" fn();

    #[derive(Clone, Copy)]
    struct ThemeApi {
        set_preferred_app_mode: SetPreferredAppMode,
        refresh_policy: RefreshTheme,
        flush_menu_themes: RefreshTheme,
    }

    fn windows_build() -> Result<u32, String> {
        use windows_sys::Win32::Foundation::FreeLibrary;
        use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

        let name: Vec<u16> = "ntdll.dll\0".encode_utf16().collect();
        let module = unsafe { LoadLibraryW(name.as_ptr()) };
        if module.is_null() {
            return Err("ntdll.dll could not be loaded".to_string());
        }
        let result = (|| {
            let procedure = unsafe { GetProcAddress(module, c"RtlGetVersion".as_ptr().cast()) }
                .ok_or_else(|| "RtlGetVersion is unavailable".to_string())?;
            let get_version: RtlGetVersion = unsafe { std::mem::transmute(procedure) };
            let mut info: OsVersionInfo = unsafe { std::mem::zeroed() };
            info.size = std::mem::size_of::<OsVersionInfo>() as u32;
            if unsafe { get_version(&mut info) } != 0 {
                return Err("RtlGetVersion failed".to_string());
            }
            Ok(info.build)
        })();
        unsafe { FreeLibrary(module) };
        result
    }

    static THEME_API: OnceLock<Result<ThemeApi, String>> = OnceLock::new();
    let build = windows_build()?;
    if !supports_preferred_app_mode(build) {
        return Ok(());
    }
    let api =
        THEME_API
            .get_or_init(|| {
                // Taoと同じuxtheme ordinalを利用する。対応build以外では上記で呼び出さない。
                // 成功時のモジュール参照はプロセス寿命で1回だけ保持する。
                let name: Vec<u16> = "uxtheme.dll\0".encode_utf16().collect();
                let module = unsafe { LoadLibraryW(name.as_ptr()) };
                if module.is_null() {
                    return Err("uxtheme.dll could not be loaded".to_string());
                }
                let set = unsafe { GetProcAddress(module, 135usize as *const u8) };
                let refresh = unsafe { GetProcAddress(module, 104usize as *const u8) };
                let flush = unsafe { GetProcAddress(module, 136usize as *const u8) };
                let (Some(set), Some(refresh), Some(flush)) = (set, refresh, flush) else {
                    unsafe { windows_sys::Win32::Foundation::FreeLibrary(module) };
                    return Err("required uxtheme functions are unavailable".to_string());
                };
                Ok(ThemeApi {
                    set_preferred_app_mode: unsafe {
                        std::mem::transmute::<
                            unsafe extern "system" fn() -> isize,
                            SetPreferredAppMode,
                        >(set)
                    },
                    refresh_policy: unsafe {
                        std::mem::transmute::<unsafe extern "system" fn() -> isize, RefreshTheme>(
                            refresh,
                        )
                    },
                    flush_menu_themes: unsafe {
                        std::mem::transmute::<unsafe extern "system" fn() -> isize, RefreshTheme>(
                            flush,
                        )
                    },
                })
            })
            .as_ref()
            .map_err(Clone::clone)?;
    let mode = match theme {
        "light" => FORCE_LIGHT,
        "dark" => FORCE_DARK,
        _ => ALLOW_DARK,
    };
    unsafe {
        (api.set_preferred_app_mode)(mode);
        (api.refresh_policy)();
        (api.flush_menu_themes)();
    }
    Ok(())
}

/// フロントエンドの言語切替に合わせてネイティブメニューを再構築する。
/// メニューIDは言語に依存しないため、切替後もコマンドルーティングはそのまま機能する。
#[tauri::command]
pub fn set_menu_language(app: AppHandle, locale: String) -> Result<(), String> {
    let menu = crate::menu::build_menu(&app, &locale).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_themes() {
        assert!(matches!(parse_theme("light"), Ok(Some(Theme::Light))));
        assert!(matches!(parse_theme("dark"), Ok(Some(Theme::Dark))));
        assert!(matches!(parse_theme("system"), Ok(None)));
    }

    #[test]
    fn rejects_unsupported_theme() {
        assert_eq!(
            parse_theme("unknown").unwrap_err(),
            "unsupported theme: unknown"
        );
    }

    #[cfg(windows)]
    #[test]
    fn gates_undocumented_windows_api_to_verified_builds() {
        assert!(!supports_preferred_app_mode(18_361));
        assert!(supports_preferred_app_mode(18_362));
        assert!(supports_preferred_app_mode(26_200));
        assert!(!supports_preferred_app_mode(26_201));
    }
}
