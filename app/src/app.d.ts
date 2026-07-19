interface AboutComponentInfo {
  displayName: string;
  version: string;
  license: string;
}

interface AboutBuildInfo {
  appVersion: string;
  components: Record<string, AboutComponentInfo>;
}

declare const __ABOUT_BUILD_INFO__: AboutBuildInfo;
