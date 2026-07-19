use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationStatus {
    supported: bool,
    registered: bool,
}

#[cfg(windows)]
mod platform {
    use super::ShellIntegrationStatus;
    use std::ffi::OsStr;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{
        ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS, WIN32_ERROR,
    };
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegOpenKeyExW, RegQueryValueExW,
        RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE,
        REG_OPTION_NON_VOLATILE, REG_SZ,
    };
    use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};

    const VERB_PATHS: [&str; 2] = [
        r"Software\Classes\SystemFileAssociations\.md\shell\FeatherMD.Open",
        r"Software\Classes\SystemFileAssociations\.markdown\shell\FeatherMD.Open",
    ];
    const VERB_LABEL: &str = "FeatherMDで開く";

    struct OwnedKey(HKEY);

    impl Drop for OwnedKey {
        fn drop(&mut self) {
            // SAFETY: RegCreateKeyExW/RegOpenKeyExWで取得した所有中のHKEYを一度だけ閉じる。
            unsafe {
                RegCloseKey(self.0);
            }
        }
    }

    fn wide(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(once(0)).collect()
    }

    fn win32_error(operation: &str, code: WIN32_ERROR) -> String {
        format!(
            "{operation}に失敗しました: {} (code={code})",
            std::io::Error::from_raw_os_error(code as i32)
        )
    }

    fn create_key(path: &str) -> Result<OwnedKey, String> {
        let path = wide(OsStr::new(path));
        let mut key = null_mut();
        // SAFETY: NUL終端済みパス、有効なHKCU、書き込み権限、出力HKEYポインタを渡す。
        let code = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                path.as_ptr(),
                0,
                null(),
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE,
                null(),
                &mut key,
                null_mut(),
            )
        };
        if code != ERROR_SUCCESS {
            return Err(win32_error("レジストリキーの作成", code));
        }
        Ok(OwnedKey(key))
    }

    fn open_key(path: &str) -> Result<Option<OwnedKey>, String> {
        let path = wide(OsStr::new(path));
        let mut key = null_mut();
        // SAFETY: NUL終端済みパス、有効なHKCU、読み取り権限、出力HKEYポインタを渡す。
        let code = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                path.as_ptr(),
                0,
                KEY_QUERY_VALUE,
                &mut key,
            )
        };
        if code == ERROR_FILE_NOT_FOUND || code == ERROR_PATH_NOT_FOUND {
            return Ok(None);
        }
        if code != ERROR_SUCCESS {
            return Err(win32_error("レジストリキーの読み取り", code));
        }
        Ok(Some(OwnedKey(key)))
    }

    fn set_string(key: &OwnedKey, name: Option<&str>, value: &str) -> Result<(), String> {
        let name = name.map(|value| wide(OsStr::new(value)));
        let name_ptr = name.as_ref().map_or(null(), |value| value.as_ptr());
        let value = wide(OsStr::new(value));
        let byte_len = value
            .len()
            .checked_mul(std::mem::size_of::<u16>())
            .and_then(|length| u32::try_from(length).ok())
            .ok_or_else(|| "レジストリ文字列が長すぎます".to_string())?;
        // SAFETY: name/valueは呼び出し中有効なNUL終端UTF-16で、byte_lenはvalueのバイト長。
        let code =
            unsafe { RegSetValueExW(key.0, name_ptr, 0, REG_SZ, value.as_ptr().cast(), byte_len) };
        if code != ERROR_SUCCESS {
            return Err(win32_error("レジストリ値の書き込み", code));
        }
        Ok(())
    }

    fn query_default_string(key: &OwnedKey) -> Result<Option<String>, String> {
        let mut value_type = 0;
        let mut byte_len = 0;
        // SAFETY: 有効なHKEYに対し、まず必要なバッファ長と型だけを問い合わせる。
        let code = unsafe {
            RegQueryValueExW(
                key.0,
                null(),
                null(),
                &mut value_type,
                null_mut(),
                &mut byte_len,
            )
        };
        if code == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }
        if code != ERROR_SUCCESS {
            return Err(win32_error("レジストリ値の長さ取得", code));
        }
        if value_type != REG_SZ {
            return Ok(None);
        }

        let unit_len = (byte_len as usize).div_ceil(std::mem::size_of::<u16>());
        let mut value = vec![0u16; unit_len.max(1)];
        // SAFETY: valueはbyte_len以上の連続バッファで、APIが更新する長さポインタも有効。
        let code = unsafe {
            RegQueryValueExW(
                key.0,
                null(),
                null(),
                &mut value_type,
                value.as_mut_ptr().cast(),
                &mut byte_len,
            )
        };
        if code != ERROR_SUCCESS {
            return Err(win32_error("レジストリ値の読み取り", code));
        }
        let used_units = (byte_len as usize / std::mem::size_of::<u16>()).min(value.len());
        value.truncate(used_units);
        while value.last() == Some(&0) {
            value.pop();
        }
        Ok(Some(String::from_utf16_lossy(&value)))
    }

    fn expected_values() -> Result<(String, String), String> {
        let executable = std::env::current_exe()
            .map_err(|error| format!("実行ファイルのパスを取得できませんでした: {error}"))?;
        let executable = executable.into_os_string().into_string().map_err(|_| {
            "実行ファイルのパスにレジストリ登録できない文字が含まれています".to_string()
        })?;
        Ok((
            format!(r#""{executable}" "%1""#),
            format!(r#""{executable}",0"#),
        ))
    }

    fn command_path(verb_path: &str) -> String {
        format!(r"{verb_path}\command")
    }

    fn delete_verb(verb_path: &str) -> Result<(), String> {
        let path = wide(OsStr::new(verb_path));
        // SAFETY: NUL終端済み固定パスと有効なHKCUを渡す。削除対象はFeatherMD所有verbのみ。
        let code = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, path.as_ptr()) };
        if code == ERROR_SUCCESS || code == ERROR_FILE_NOT_FOUND || code == ERROR_PATH_NOT_FOUND {
            return Ok(());
        }
        Err(win32_error("右クリックメニューの削除", code))
    }

    fn remove_all_verbs() -> Result<(), String> {
        let mut first_error = None;
        for verb_path in VERB_PATHS {
            if let Err(error) = delete_verb(verb_path) {
                first_error.get_or_insert(error);
            }
        }
        if let Some(error) = first_error {
            return Err(error);
        }
        Ok(())
    }

    fn notify_association_changed() {
        // SAFETY: SHCNE_ASSOCCHANGED + SHCNF_IDLISTではdwitem1/dwitem2をNULLにするのがAPI契約。
        unsafe {
            SHChangeNotify(SHCNE_ASSOCCHANGED as i32, SHCNF_IDLIST, null(), null());
        }
    }

    fn is_registered(expected_command: &str) -> Result<bool, String> {
        for verb_path in VERB_PATHS {
            let Some(command_key) = open_key(&command_path(verb_path))? else {
                return Ok(false);
            };
            if query_default_string(&command_key)?.as_deref() != Some(expected_command) {
                return Ok(false);
            }
        }
        Ok(true)
    }

    pub fn status() -> Result<ShellIntegrationStatus, String> {
        let (expected_command, _) = expected_values()?;
        Ok(ShellIntegrationStatus {
            supported: true,
            registered: is_registered(&expected_command)?,
        })
    }

    pub fn set_enabled(enabled: bool) -> Result<ShellIntegrationStatus, String> {
        if !enabled {
            remove_all_verbs()?;
            notify_association_changed();
            return status();
        }

        let (expected_command, expected_icon) = expected_values()?;
        // 古い実行パスや予期しないサブキーを残さず、固定した値だけで作り直す。
        remove_all_verbs()?;
        let result = (|| {
            for verb_path in VERB_PATHS {
                let verb_key = create_key(verb_path)?;
                set_string(&verb_key, None, VERB_LABEL)?;
                set_string(&verb_key, Some("Icon"), &expected_icon)?;
                set_string(&verb_key, Some("MultiSelectModel"), "Document")?;

                let command_key = create_key(&command_path(verb_path))?;
                set_string(&command_key, None, &expected_command)?;
            }
            Ok::<(), String>(())
        })();

        if let Err(error) = result {
            let rollback_error = remove_all_verbs().err();
            return Err(match rollback_error {
                Some(rollback) => format!("{error}。ロールバックにも失敗しました: {rollback}"),
                None => error,
            });
        }

        notify_association_changed();
        status()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn command_path_appends_command_subkey() {
            assert_eq!(
                command_path(r"Software\Classes\Example"),
                r"Software\Classes\Example\command"
            );
        }

        #[test]
        fn verb_paths_cover_both_markdown_extensions() {
            assert!(VERB_PATHS.iter().any(|path| path.contains(r"\.md\")));
            assert!(VERB_PATHS.iter().any(|path| path.contains(r"\.markdown\")));
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::ShellIntegrationStatus;

    pub fn status() -> Result<ShellIntegrationStatus, String> {
        Ok(ShellIntegrationStatus {
            supported: false,
            registered: false,
        })
    }

    pub fn set_enabled(_enabled: bool) -> Result<ShellIntegrationStatus, String> {
        status()
    }
}

#[tauri::command]
pub fn get_shell_integration_status() -> Result<ShellIntegrationStatus, String> {
    platform::status()
}

#[tauri::command]
pub fn set_shell_integration_enabled(enabled: bool) -> Result<ShellIntegrationStatus, String> {
    platform::set_enabled(enabled)
}
