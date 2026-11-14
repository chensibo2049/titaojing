本目录：本机听写（sherpa-onnx WebAssembly）。

- `engine/`：识别引擎（wasm + glue + Silero VAD + worker），随网站发布，约 12 MB。
- `manifest.json`：引擎文件与中文模型的清单（大小、sha256、下载镜像）。
- 中文模型（约 78 MB）**不进 git**，由用户的浏览器按需从镜像下载并缓存。
  如需自建镜像：`npm run fetch-asr` 下载并校验到 `assets/asr/model/`（已被 .gitignore 忽略），再上传到自己的对象存储，并在 `config.js` 填写 `asrModelBase`。

详见 docs/ASR.md。
