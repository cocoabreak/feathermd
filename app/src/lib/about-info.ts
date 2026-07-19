/* global __ABOUT_BUILD_INFO__ */
import type { LocalizedText, ViewerPlugin } from "$lib/plugins";

export interface AboutComponentInfo {
  displayName: string;
  version: string;
  license: string;
}

export interface AboutBuildInfo {
  appVersion: string;
  components: Record<string, AboutComponentInfo>;
}

export interface AboutPluginEntry {
  name: string;
  displayName: LocalizedText;
  version: string;
  enabled: boolean;
  engine?: AboutComponentInfo;
}

export const aboutBuildInfo: AboutBuildInfo = __ABOUT_BUILD_INFO__;

export function buildPluginEntries(
  plugins: ViewerPlugin[],
  rendererSettings: Record<string, boolean>
): AboutPluginEntry[] {
  return plugins.map((plugin) => ({
    name: plugin.name,
    displayName: plugin.displayName,
    version: plugin.version,
    enabled: rendererSettings[plugin.name] ?? plugin.defaultEnabled,
    engine: plugin.engine ? aboutBuildInfo.components[plugin.engine.packageName] : undefined,
  }));
}
