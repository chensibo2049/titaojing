# 移动外壳（Capacitor）骨架

尚未构建 APK / IPA。计划把同一份 `dist/` 放进系统 WebView，见 `docs/ROADMAP.md`。

注意：WebView 里一般没有网页听写；安卓尤其不能依赖谷歌语音服务。本机识别（sherpa-onnx 原生库或 WASM）是应用上架前的前置条件。iOS 14.3 起 WKWebView 支持 `getUserMedia`。国内安卓上架通常需要软著和 App 备案。

`capacitor.config.json` 是占位，供后续 `npm init @capacitor/app` 或手动补全工程后使用。
