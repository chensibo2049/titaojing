# 桌面外壳（Tauri 2）骨架

尚未构建安装包。计划用同一份 `dist/` 网页，加上系统 WebView，见 `docs/ROADMAP.md`。

推荐 Tauri 而不是 Electron：安装包和内存更小。两者都没有 Web Speech，口头禅要等本机识别（`docs/ASR.md`）再作为完整功能发布；在此之前可以先出「只含教态和视线」的体验版。

## 计划中的命令（需本机安装 Rust 与 Tauri CLI 后再补全）

```bash
npm run build
# npx tauri dev   /   npx tauri build
```

`tauri.conf.json` 是占位配置：摄像头 / 麦克风权限说明、macOS 签名所需的 entitlements 字段已写下，供后续补全 `src-tauri` 工程。
