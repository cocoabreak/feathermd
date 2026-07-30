export interface DocumentRef {
  sourceId: string;
  path: string;
}

export interface SourceSpec {
  kind: "native" | "zip";
  nativePath: string;
}

export interface SourceCapabilities {
  watch: "entries" | "container" | "none";
  externalEditor: boolean;
  respectGitignore: boolean;
  fullTextSearch: boolean;
  wikiLinks: boolean;
}

export interface DocumentSourceInfo {
  id: string;
  kind: "native" | "zip";
  label: string;
  nativePath: string;
  generation?: number;
  capabilities: SourceCapabilities;
}

export interface FileEntry {
  name: string;
  path: string;
  document: DocumentRef;
  isDir: boolean;
  isHidden: boolean;
  children?: FileEntry[];
}

export type RenderMode = "full" | "safe";
export type ViewMode = "rendered" | "source";

export interface SafeOutlineHeading extends TocHeading {
  utf16Offset: number;
}

export interface Tab {
  id: string;
  path: string;
  document?: DocumentRef;
  source?: DocumentSourceInfo;
  displayPath?: string;
  title: string;
  status?: "ok" | "deleted";
  pinned?: boolean;
  renderMode?: RenderMode;
  viewMode?: ViewMode;
}

export interface TocHeading {
  level: number;
  text: string;
  id: string;
  /** レンダラー変換前の構造を保ったアンカー計算用テキスト。safe/source outlineだけが設定する。 */
  anchorText?: string;
  /** 通常レンダー時の参照用アンカー。safe/source表示のスクロールIDと異なる場合だけ設定する。 */
  referenceId?: string;
}
