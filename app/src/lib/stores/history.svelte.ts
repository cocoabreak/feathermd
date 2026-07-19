/** 履歴の最大保持数。超えたら古いものから捨てる */
const MAX_ENTRIES = 50;

/**
 * アクティブファイルの切替履歴（戻る/進む）。ブラウザ同様の「単一リスト+カーソル」モデル。
 * 記録は+page.svelteの$effectが一元的に行う（手段を問わず「表示ファイルが変わった」ことを捕捉）。
 * 戻る/進むによる切替もeffectを発火させるが、移動先はentries[index]と一致するため
 * recordの連続重複チェックで自然に無視される（抑止フラグ不要）。
 */
export function createHistoryStore() {
  let entries = $state<string[]>([]);
  let index = $state(-1);

  return {
    get entries() {
      return entries;
    },
    get index() {
      return index;
    },
    get canGoBack() {
      return index > 0;
    },
    get canGoForward() {
      return index < entries.length - 1;
    },
    /**
     * アクティブファイルの変化を記録する。現在位置と同じパスは無視。
     * 現在位置より先（進む側）の履歴は破棄して末尾に追加する（ブラウザと同じ挙動）。
     */
    record(path: string) {
      if (entries[index] === path) return;
      entries = [...entries.slice(0, index + 1), path].slice(-MAX_ENTRIES);
      index = entries.length - 1;
    },
    /** カーソルを1つ移動し、移動先のパスを返す。端で移動できなければnull */
    step(direction: 1 | -1): string | null {
      const next = index + direction;
      if (next < 0 || next >= entries.length) return null;
      index = next;
      return entries[index];
    },
    /**
     * 開けなかった現在エントリを履歴から除去し、カーソルを移動元の位置へ戻す。
     * 直後に同じdirectionでstepすると、除去したエントリの次（同方向）を指す。
     */
    dropCurrent(direction: 1 | -1) {
      if (index < 0 || index >= entries.length) return;
      entries = entries.filter((_, i) => i !== index);
      if (direction === 1) index -= 1;
      // direction === -1 の場合、除去により移動元が現在のindex位置へ詰まるため調整不要
    },
    /** ソース再登録でDocumentRefのキーが変わった場合、現在の履歴位置を新しいキーへ移す。 */
    replaceCurrent(path: string) {
      if (index < 0 || index >= entries.length) return;
      entries = entries.map((entry, entryIndex) => (entryIndex === index ? path : entry));
    },
  };
}

export const historyStore = createHistoryStore();
