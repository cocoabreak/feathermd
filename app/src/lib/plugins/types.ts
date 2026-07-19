import type MarkdownIt from "markdown-it";
import type { Locale } from "$lib/i18n/index.svelte";
import type { DocumentRef, DocumentSourceInfo } from "$lib/types";

/**
 * 言語別の表示文字列。プラグインの表示名・説明や実行時文言に使う。
 * コアの辞書（$lib/i18n）には載せず、各プラグインが自分のディレクトリ内で
 * 全対応言語分を保持する（自己完結の規約。plugins/README.md参照）。
 */
export type LocalizedText = Record<Locale, string>;

/**
 * postRenderにコアが注入するコンテキスト。
 * プラグインがストアを直接importせずに表示中ファイルの情報へアクセスするための口。
 */
export interface PostRenderContext {
  /** バックエンド非依存の表示中ドキュメント参照 */
  document: DocumentRef | null;
  /** 表示中ドキュメントのソース情報 */
  source: DocumentSourceInfo | null;
  /** 表示中ファイルの絶対パス（スラッシュ区切り） */
  filePath: string | null;
  /** エクスプローラーで開いているルートフォルダ（未設定ならnull） */
  rootPath: string | null;
  /** .gitignore考慮設定（ツリー・全文検索と共通） */
  respectGitignore: boolean;
  /** 現在の表示言語（プラグインが実行時文言を選ぶために使う） */
  locale: Locale;
  /** 遅延生成される外部画像を読み込んでよいか */
  externalImagesAllowed?: boolean;
  /** 遅延生成された外部画像をブロックした件数の通知先 */
  onExternalImagesBlocked?: (count: number) => void;
}

/**
 * ビューワーの表現拡張（レンダラー）プラグイン。
 * `plugins/<name>/index.ts` が default export し、ビルド時に自動収集される。
 * 作成規約は plugins/README.md を参照。
 *
 * markdown-itのfenceルールは同期関数のため、非同期・DOM必須のレンダリングは
 * 「fenceで同期的にプレースホルダーを返し、postRenderで実レンダリングする」
 * 二段構えで実装する（Mermaidが実例）。
 */
export interface ViewerPlugin {
  /** 設定キー兼識別子（settings.renderers のキーになる） */
  name: string;
  /** FeatherMD内蔵プラグインとしてのバージョン */
  version: string;
  /** 外部レンダリングエンジンを利用する場合の表示名とnpmパッケージ名 */
  engine?: { displayName: string; packageName: string };
  /** 設定パネルに表示する名前（言語別） */
  displayName: LocalizedText;
  /** 設定パネルに表示する補足説明（言語別） */
  description: LocalizedText;
  /** 初回起動時のON/OFF初期値 */
  defaultEnabled: boolean;

  /**
   * 構文拡張型の介入（KaTeXの $...$ など）。md構築時にawaitされる。
   * 重いライブラリはこの中で動的importし、チャンク分割・遅延ロードを保つこと。
   */
  extendMarkdownIt?(md: MarkdownIt): Promise<void> | void;

  /** fenceコードブロックの引き受け（Mermaidなど）。renderは同期でHTML文字列を返す */
  fence?: {
    /** 引き受ける言語名（小文字） */
    languages: string[];
    render(code: string, lang: string): string;
  };

  /**
   * DOM挿入後の後処理。cleanup関数を返す。
   * プラグインの有効/無効に関わらず毎回呼ばれるため、自プラグインの
   * マーカー要素が存在しないときは何もしないこと。
   */
  postRender?(container: HTMLElement, context: PostRenderContext): (() => void) | void;

  /**
   * 印刷（PDF出力）直前の準備。遅延レンダリング等の未完了処理をここで完了させる
   * （画面外で未レンダリングの要素が空のまま印刷されるのを防ぐ）。
   * postRenderと同様に毎回呼ばれるため、対象要素がなければ何もしないこと。
   */
  beforePrint?(container: HTMLElement, context: PostRenderContext): Promise<void> | void;
}
