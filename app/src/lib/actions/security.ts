import { invoke } from "@tauri-apps/api/core";
import { normalizePath as normalize } from "$lib/utils";

/** パスの親ディレクトリを返す（信頼確認ダイアログの表示用） */
export function parentDir(path: string): string {
  const normalized = normalize(path);
  return normalized.slice(0, normalized.lastIndexOf("/")) || "/";
}

/**
 * path が dir 自身または dir 配下にあるかを、テキスト正規化で軽量判定する。
 * これは「同フォルダ配下のリンクは確認不要」というUX判定のための前段フィルタであり、
 * 実際のファイルアクセス可否（信頼境界）はRust側の is_path_allowed / read_* が
 * canonicalize を用いて最終判定する。
 */
export function isWithinDir(path: string, dir: string): boolean {
  const p = normalize(path);
  const d = normalize(dir).replace(/\/$/, "");
  return p === d || p.startsWith(d + "/");
}

/**
 * フォルダまたはファイルを信頼済みルートとして登録する。
 * ファイルを渡した場合はRust側でその親フォルダが登録される。
 * 危険フォルダ（ドライブ直下・システムフォルダ・ユーザープロファイル直下）の場合は
 * Rust側がErrを返すため、呼び出し側でcatchすること。
 *
 * 信頼境界はRust側のAllowedRootsが唯一の判定者。フロントは登録を要求するだけで、
 * ファイルアクセスの可否検証はRust側（resolve / is_path_allowed）が行う。
 */
export async function authorizePath(path: string): Promise<boolean> {
  return await invoke<boolean>("authorize_path", { path });
}

/** ZIPアーカイブ単体を認可する。親フォルダーは信頼対象に含めない。 */
export async function authorizeArchivePath(path: string): Promise<boolean> {
  return await invoke<boolean>("authorize_archive_path", { path });
}

/** Explorerルートとして明示的に開き、次回起動用の唯一の永続信頼へ置換する。 */
export async function authorizeFolderPath(path: string): Promise<boolean> {
  return await invoke<boolean>("authorize_folder_path", { path });
}

export async function authorizeDevPath(path: string): Promise<void> {
  await invoke("authorize_dev_path", { path });
}
