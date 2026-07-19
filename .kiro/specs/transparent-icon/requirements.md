# 透過アイコン 要求定義

## 要求

- 既存の羽根と`md`の形状・青系グラデーションを維持する。
- 白い角丸プレートと影を除去し、背景を透過する。
- Windows ICO、macOS ICNS、Tauri用PNG、Web faviconを同一原本から生成する。
- 英語・日本語READMEで透過原本のロゴを表示する。
- PNGの四隅は完全透過とし、小サイズでも主要形状を判別できること。

## 受け入れ条件

- `icon-source.png`が1024×1024のRGBA画像である。
- 生成対象PNGの四隅のalpha値が0である。
- Tauri設定が参照するICO・ICNS・PNGが再生成されている。
