/** プラグインname→有効フラグ。キーは plugins/ 配下のプラグイン一覧に自動追従する */
export type RendererSettings = Record<string, boolean>;

export type AppTheme = "light" | "dark" | "system";
export type ExternalImagePolicy = "block" | "ask" | "allow";

import { defaultRendererSettings } from "$lib/plugins";
import { i18n, resolveLocale, type LanguageSetting } from "$lib/i18n/index.svelte";

export interface Settings {
  language: LanguageSetting;
  showHiddenFiles: boolean;
  respectGitignore: boolean;
  tocVisible: boolean;
  sidebarVisible: boolean;
  sidebarWidth: number;
  tocWidth: number;
  tocRatio: number;
  contentZoom: number;
  renderers: RendererSettings;
  theme: AppTheme;
  codeTheme: string;
  showLineNumbers: boolean;
  externalEditorCommand: string;
  customCssEnabled: boolean;
  customCssPath: string;
  externalImagePolicy: ExternalImagePolicy;
  checkForUpdatesOnStartup: boolean;
}

export const DEFAULT_SIDEBAR_WIDTH = 224;
export const DEFAULT_TOC_WIDTH = 208;
export const MIN_PANEL_WIDTH = 160;
export const MAX_PANEL_WIDTH = 480;
// サイドバー内で目次が占める高さの割合（エクスプローラー3:目次7がデフォルト）
export const DEFAULT_TOC_RATIO = 0.7;
export const MIN_TOC_RATIO = 0.2;
export const MAX_TOC_RATIO = 0.8;
export const DEFAULT_CONTENT_ZOOM = 100;
export const MIN_CONTENT_ZOOM = 50;
export const MAX_CONTENT_ZOOM = 200;
export const CONTENT_ZOOM_STEP = 10;

function clampPanelWidth(width: number): number {
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width));
}

function clampTocRatio(ratio: number): number {
  return Math.min(MAX_TOC_RATIO, Math.max(MIN_TOC_RATIO, ratio));
}

function clampContentZoom(zoom: number): number {
  return Math.min(MAX_CONTENT_ZOOM, Math.max(MIN_CONTENT_ZOOM, zoom));
}

const defaults: Settings = {
  language: "system",
  showHiddenFiles: false,
  respectGitignore: true,
  tocVisible: true,
  sidebarVisible: true,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  tocWidth: DEFAULT_TOC_WIDTH,
  tocRatio: DEFAULT_TOC_RATIO,
  contentZoom: DEFAULT_CONTENT_ZOOM,
  renderers: defaultRendererSettings(),
  theme: "system",
  codeTheme: "dark-plus",
  showLineNumbers: false,
  externalEditorCommand: "",
  customCssEnabled: false,
  customCssPath: "",
  externalImagePolicy: "ask",
  checkForUpdatesOnStartup: true,
};

function createSettingsStore() {
  let settings = $state<Settings>({ ...defaults, renderers: { ...defaults.renderers } });

  return {
    get settings() {
      return settings;
    },
    toggleHiddenFiles() {
      settings = { ...settings, showHiddenFiles: !settings.showHiddenFiles };
    },
    toggleRespectGitignore() {
      settings = { ...settings, respectGitignore: !settings.respectGitignore };
    },
    toggleToc() {
      settings = { ...settings, tocVisible: !settings.tocVisible };
    },
    toggleSidebar() {
      settings = { ...settings, sidebarVisible: !settings.sidebarVisible };
    },
    setSidebarVisible(visible: boolean) {
      settings = { ...settings, sidebarVisible: visible };
    },
    setSidebarWidth(width: number) {
      settings = { ...settings, sidebarWidth: clampPanelWidth(width) };
    },
    setTocWidth(width: number) {
      settings = { ...settings, tocWidth: clampPanelWidth(width) };
    },
    setTocRatio(ratio: number) {
      settings = { ...settings, tocRatio: clampTocRatio(ratio) };
    },
    setContentZoom(zoom: number) {
      settings = { ...settings, contentZoom: clampContentZoom(zoom) };
    },
    zoomIn() {
      this.setContentZoom(settings.contentZoom + CONTENT_ZOOM_STEP);
    },
    zoomOut() {
      this.setContentZoom(settings.contentZoom - CONTENT_ZOOM_STEP);
    },
    resetZoom() {
      this.setContentZoom(DEFAULT_CONTENT_ZOOM);
    },
    toggleRenderer(name: string) {
      settings = {
        ...settings,
        renderers: { ...settings.renderers, [name]: !settings.renderers[name] },
      };
    },
    setTheme(theme: AppTheme) {
      settings = { ...settings, theme };
    },
    setCodeTheme(codeTheme: string) {
      settings = { ...settings, codeTheme };
    },
    toggleLineNumbers() {
      settings = { ...settings, showLineNumbers: !settings.showLineNumbers };
    },
    setExternalEditorCommand(command: string) {
      settings = { ...settings, externalEditorCommand: command };
    },
    setCustomCssEnabled(enabled: boolean) {
      settings = { ...settings, customCssEnabled: enabled };
    },
    setCustomCssPath(path: string) {
      settings = { ...settings, customCssPath: path };
    },
    setExternalImagePolicy(policy: ExternalImagePolicy) {
      settings = { ...settings, externalImagePolicy: policy };
    },
    setCheckForUpdatesOnStartup(enabled: boolean) {
      settings = { ...settings, checkForUpdatesOnStartup: enabled };
    },
    /** 言語設定を変更し、実効ロケールをi18nに即時反映する */
    setLanguage(language: LanguageSetting) {
      settings = { ...settings, language };
      i18n.setLocale(resolveLocale(language));
    },
  };
}

export const settingsStore = createSettingsStore();
