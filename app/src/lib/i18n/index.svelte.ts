import { ja } from "./ja";
import { en } from "./en";

/** UIの表示言語 */
export type Locale = "ja" | "en";
/** 設定値としての言語（system = OSロケール準拠） */
export type LanguageSetting = "system" | Locale;

export type Messages = typeof ja;

const dictionaries: Record<Locale, Messages> = { ja, en };

/** OSロケールから表示言語を判定する（日本語系ならja、それ以外はen） */
export function detectSystemLocale(): Locale {
  return navigator.language?.toLowerCase().startsWith("ja") ? "ja" : "en";
}

/** 言語設定を実効ロケールに解決する */
export function resolveLocale(setting: LanguageSetting): Locale {
  return setting === "system" ? detectSystemLocale() : setting;
}

function createI18n() {
  let locale = $state<Locale>(detectSystemLocale());

  return {
    get locale() {
      return locale;
    },
    /** 現在言語の辞書。getterが$stateのlocaleを読むため、参照箇所は言語切替で再描画される */
    get m() {
      return dictionaries[locale];
    },
    setLocale(next: Locale) {
      locale = next;
    },
  };
}

export const i18n = createI18n();
