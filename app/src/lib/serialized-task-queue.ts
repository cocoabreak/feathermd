/** 同じキーの非同期処理を、失敗時も停止させず登録順に実行する。 */
export class SerializedTaskQueue<Key> {
  private readonly tails = new Map<Key, Promise<void>>();

  enqueue(key: Key, task: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.tails.set(key, current);
    void current.then(
      () => this.deleteIfCurrent(key, current),
      () => this.deleteIfCurrent(key, current)
    );
    return current;
  }

  private deleteIfCurrent(key: Key, current: Promise<void>): void {
    if (this.tails.get(key) === current) this.tails.delete(key);
  }
}
