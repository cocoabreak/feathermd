import { describe, expect, it } from "vitest";
import { viewerPlugins } from "$lib/plugins";
import { aboutBuildInfo, buildPluginEntries } from "./about-info";

describe("About build information", () => {
  it("アプリと主要コンポーネントのビルド時バージョンを持つ", () => {
    expect(aboutBuildInfo.appVersion).toMatch(/^\d+\.\d+\.\d+$/);
    for (const packageName of ["mermaid", "katex", "markdown-it", "shiki", "dompurify"]) {
      expect(aboutBuildInfo.components[packageName]?.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(aboutBuildInfo.components[packageName]?.license.length).toBeGreaterThan(0);
    }
  });

  it("プラグインの有効状態とエンジン情報を結合する", () => {
    const entries = buildPluginEntries(viewerPlugins, { mermaid: false });
    const mermaid = entries.find((entry) => entry.name === "mermaid");
    expect(mermaid?.enabled).toBe(false);
    expect(mermaid?.engine?.displayName).toBe("Mermaid");
    expect(mermaid?.engine?.version).toBe(aboutBuildInfo.components.mermaid.version);
  });
});
