import { describe, expect, it } from "vitest";
import { defaultRendererSettings, viewerPlugins } from "./index";
import { aboutBuildInfo } from "$lib/about-info";

// plugins/配下の全プラグインが作成規約（README.md）を満たすことの契約テスト。
// 個別プラグインの描画結果ではなく、自動収集に依存するコア側の前提を守る。
describe("viewerPlugins（プラグイン契約）", () => {
  it("1つ以上のプラグインが収集される", () => {
    expect(viewerPlugins.length).toBeGreaterThan(0);
  });

  it("全プラグインが必須フィールドを持つ", () => {
    for (const plugin of viewerPlugins) {
      expect(plugin, "index.tsはViewerPluginをdefault exportすること").toBeDefined();
      expect(plugin.name).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(typeof plugin.defaultEnabled).toBe("boolean");
      if (plugin.engine) {
        expect(plugin.engine.displayName.length).toBeGreaterThan(0);
        expect(aboutBuildInfo.components[plugin.engine.packageName]).toBeDefined();
      }
    }
  });

  it("displayName/descriptionが全対応言語を網羅する", () => {
    const locales = ["ja", "en"] as const;
    for (const plugin of viewerPlugins) {
      for (const locale of locales) {
        expect(
          plugin.displayName[locale]?.length,
          `${plugin.name} のdisplayName.${locale} が空`
        ).toBeGreaterThan(0);
        expect(
          plugin.description[locale]?.length,
          `${plugin.name} のdescription.${locale} が空`
        ).toBeGreaterThan(0);
      }
    }
  });

  it("nameが一意である（設定キーが衝突しない）", () => {
    const names = viewerPlugins.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("fenceを持つプラグイン同士で言語が衝突しない", () => {
    const seen = new Map<string, string>();
    for (const plugin of viewerPlugins) {
      for (const lang of plugin.fence?.languages ?? []) {
        const owner = seen.get(lang.toLowerCase());
        expect(owner, `言語 "${lang}" が ${owner} と ${plugin.name} で重複`).toBeUndefined();
        seen.set(lang.toLowerCase(), plugin.name);
      }
    }
  });

  it("defaultRendererSettingsが全プラグインのキーを持つ", () => {
    const defaults = defaultRendererSettings();
    for (const plugin of viewerPlugins) {
      expect(defaults[plugin.name]).toBe(plugin.defaultEnabled);
    }
  });

  it("fence型プラグインがカスタムCSS用の統一ルート属性を出力する", () => {
    for (const plugin of viewerPlugins.filter((candidate) => candidate.fence)) {
      const html = plugin.fence!.render("test", plugin.fence!.languages[0]);
      expect(html).toContain("viewer-plugin");
      expect(html).toContain(`viewer-plugin--${plugin.name}`);
      expect(html).toContain(`data-viewer-plugin="${plugin.name}"`);
    }
  });
});
