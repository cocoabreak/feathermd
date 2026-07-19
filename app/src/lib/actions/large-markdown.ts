import type { RenderMode, SafeOutlineHeading } from "$lib/types";

export interface MarkdownFileContent {
  raw: string;
  byteSize: number;
  requiresConfirmation: boolean;
  safeOutline: SafeOutlineHeading[];
  safeOutlineTruncated: boolean;
}

export interface LoadedMarkdown {
  raw: string;
  byteSize: number;
  renderMode: RenderMode;
  safeOutline: SafeOutlineHeading[];
  safeOutlineTruncated: boolean;
}

export interface MarkdownLoadOptions {
  currentMode?: RenderMode;
  reason?: "open" | "watch";
}

export class LargeMarkdownApprovalSession {
  private readonly approvedPaths = new Set<string>();
  private readonly pendingSafePrompts = new Map<string, Promise<boolean>>();
  private readonly pendingFullPrompts = new Map<string, Promise<boolean>>();

  async load(
    path: string,
    content: MarkdownFileContent,
    options: MarkdownLoadOptions,
    confirm: () => Promise<boolean>
  ): Promise<LoadedMarkdown | undefined> {
    if (options.currentMode === "safe") return this.result(content, "safe");
    if (!content.requiresConfirmation || this.approvedPaths.has(path)) {
      return this.result(content, "full");
    }
    if (options.reason === "watch") return this.result(content, "safe");
    if (!(await this.runPrompt(path, this.pendingSafePrompts, confirm))) return undefined;
    return this.result(content, "safe");
  }

  async approveFull(path: string, confirm: () => Promise<boolean>): Promise<boolean> {
    if (this.approvedPaths.has(path)) return true;
    if (!(await this.runPrompt(path, this.pendingFullPrompts, confirm))) return false;
    this.approvedPaths.add(path);
    return true;
  }

  private result(content: MarkdownFileContent, renderMode: RenderMode): LoadedMarkdown {
    return {
      raw: content.raw,
      byteSize: content.byteSize,
      renderMode,
      safeOutline: content.safeOutline,
      safeOutlineTruncated: content.safeOutlineTruncated,
    };
  }

  private runPrompt(
    path: string,
    pendingPrompts: Map<string, Promise<boolean>>,
    confirm: () => Promise<boolean>
  ): Promise<boolean> {
    const existing = pendingPrompts.get(path);
    if (existing) return existing;

    const created = Promise.resolve()
      .then(confirm)
      .catch(() => false);
    pendingPrompts.set(path, created);
    void created.finally(() => {
      if (pendingPrompts.get(path) === created) pendingPrompts.delete(path);
    });
    return created;
  }
}
