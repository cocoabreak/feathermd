interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

/** 最新snapshotだけを残し、同じkindの永続化を必ず直列実行する。 */
export class LatestSaveQueue<T> {
  private pending: T | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private waiters: Waiter[] = [];

  constructor(
    private readonly persist: (value: T) => Promise<void>,
    private readonly delayMs: number
  ) {}

  enqueue(value: T): Promise<void> {
    this.pending = value;
    const promise = new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject }));
    if (!this.running) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.drain(), this.delayMs);
    }
    return promise;
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.running && this.pending === undefined) return;
    const completion = new Promise<void>((resolve, reject) =>
      this.waiters.push({ resolve, reject })
    );
    if (!this.running) void this.drain();
    await completion;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.timer = undefined;
    let lastError: unknown;
    while (this.pending !== undefined) {
      const value = this.pending;
      this.pending = undefined;
      try {
        await this.persist(value);
        lastError = undefined;
      } catch (error) {
        lastError = error;
      }
    }
    this.running = false;

    const waiters = this.waiters.splice(0);
    if (lastError === undefined) {
      waiters.forEach(({ resolve }) => resolve());
    } else {
      waiters.forEach(({ reject }) => reject(lastError));
    }
  }
}
