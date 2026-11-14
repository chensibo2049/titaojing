# 转写与水词：现在用什么，下一步怎么做

口头禅（水词）和别扭的口气，不能只靠屏幕上闪一下「然后」。回放必须留下**整段转写**，并把词表里的水词标出来。要做到这一点，识别本身要可靠，而且尽量把声音留在本机。

## v1.2.0：本机听写已经接入（声音不离开这台设备）

**默认推荐本机听写。** 下载一次中文模型后，转写完全在浏览器里完成，不经过沉思波，也不经过浏览器厂商，不需要连外网。没下载时，「自动」仍会先用浏览器听写（Web Speech）；它报 `network` 失败时，横幅里直接给出下载按钮，下载完在本次试讲中立刻切过去。

### 组成

| 部分 | 说明 | 体积 | 许可 | 从哪里来 |
|---|---|---|---|---|
| 识别引擎 | sherpa-onnx WebAssembly（含 onnxruntime），离线识别 + VAD 的 C API | 11.2 MB wasm + 约 0.15 MB JS | Apache-2.0（onnxruntime：MIT） | 随网站发布：`assets/asr/engine/`。取自 k2-fsa 官方 Space [`web-assembly-vad-asr-sherpa-onnx-zh-zipformer-ctc`](https://huggingface.co/spaces/k2-fsa/web-assembly-vad-asr-sherpa-onnx-zh-zipformer-ctc)（2026-03-12，提交 9d5fc71），去掉了 glue 里自动下载 367 MB 预载数据包的那一段，改为运行时把模型写进虚拟文件系统 |
| 切句（VAD） | Silero VAD | 0.6 MB | MIT | 随网站发布：`assets/asr/engine/silero_vad.onnx` |
| 中文识别模型 | Paraformer 中文小模型 int8（`sherpa-onnx-paraformer-zh-small-2024-03-09`，FunASR 训练、k2-fsa 导出） | 78 MB（81 828 675 字节）+ tokens 74 KB | 模型卡标注 Apache-2.0；原始权重来自 FunASR（阿里巴巴达摩院），请保留出处 | **按需下载**，不进 git |

模型下载顺序（每个文件都校验 sha256，见 `assets/asr/manifest.json`）：

1. 部署方镜像：`config.js` 的 `asrModelBase`（可选，需允许跨域）；
2. 魔搭 ModelScope：`https://www.modelscope.cn/models/pengzhendong/sherpa-onnx-paraformer-zh-small/resolve/master/`（已验证 200 / 206，`Access-Control-Allow-Origin: *`，CDN 为 `cdn-lfs-cn-1.modelscope.cn`，与 Hugging Face 上的文件 sha256 一致）；
3. hf-mirror.com：`https://hf-mirror.com/csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09/resolve/main/`（我们的测试机在海外，看到它 308 跳转到 Hugging Face，跳转那一步没有跨域头，浏览器会拒绝，于是继续下一个；在国内网络下它通常直接提供文件，但这一点我们没能在国内网络实测）；
4. Hugging Face：`https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09/resolve/main/`。

下载按 4 MB 分段（断了重试，最多 4 次），全部到齐并校验通过才写入浏览器 Cache Storage（`titaojing-asr-model-<模型名>`），并请求持久存储。升级网站不会清掉它；「设置」里可删除。识别引擎由 Service Worker 缓存在 `titaojing-asr-engine-*`，下载模型时会顺带取一遍，之后可完全离线。

### 运行方式

- `src/asr-sherpa.js`：在 Web Worker（`assets/asr/engine/asr-worker.js`）里载入引擎；worker 自己从 Cache Storage 读模型，不占页面主线程。
- 麦克风：克隆摄像头那条音轨，AudioWorklet 降到 16 kHz 单声道，用 MessageChannel 直接送进 worker。旧浏览器退回 ScriptProcessor。
- Silero VAD 在停顿约 0.35 秒后切出一句（单句最长 12 秒），Paraformer 识别后把文字发回页面，走与浏览器听写相同的 `onTranscript` / `onFiller`。时间戳按「这句话开始的时刻」回推，并扣除消息排队的延迟。
- 进入站位页时就在后台预热（载入模型、建好音频管线但不送声音），开讲即转写；结束时先把最后一句识别完（最多等 2.5 秒）再出回放。
- 「试一下听写」：模型已下载且未选「仅浏览器听写」时，测的是本机听写（载入后听 5 秒）。
- 调试：`?debug=1` 时控制台会打印 `[本机听写]` 的载入、切句、每句结果和每 2 秒的送入秒数 / 峰值。

### 实测

`node scripts/asr-real.mjs`（无头 Chrome，`--use-file-for-fake-audio-capture` 把 WAV 当麦克风，真实从镜像下载模型）：

- 默认输入：k2-fsa 公开测试音频 `test_wavs/0.wav`（真人普通话，5.6 秒）。
- 2026-11-14 在测试机上：模型从 ModelScope 下载并校验约 24 秒；引擎载入约 1.4–1.9 秒；
  - 「试一下听写」：`本机听写听到了：「对我做了介绍啊那么我想说的是呢大家如果对我的研究感兴趣呢」`
  - 20 秒试讲（音频循环播放）的回放转写逐句出现，口头禅卡片统计到「啊」。
- 合成语音输入（`ASR_WAV=… ASR_EXPECT=勾股定理,直角三角形`）：「试一下听写」写出「同学们好嗯今天我们来讲一下勾股定理这个定理呢」；试讲回放逐句出现「同学们好 / 嗯 / 今天我们来讲一下勾股定理 / 这个定理呢就是直角三角形两条直角边的平方和等于斜边的平方」，「嗯」被统计，但这一次句首的「啊」漏掉了。
- 用合成语音「同学们好，嗯，今天我们来讲一下勾股定理。啊，这个定理呢……」离线对比：Paraformer 小模型写出了「嗯」和「啊」，Zipformer CTC 小模型把单独的「嗯」「啊」丢掉了，所以选了 Paraformer。

这个测试较重（下载约 90 MB），不在每次 CI 里跑；可在 GitHub Actions 里手动触发「本机听写真机测试」。

### 限制（如实说明）

- 只识别普通话；「识别语言」设置只对浏览器听写生效。
- 不是逐字出现：说完一句、停顿约半秒后整句出现。
- 很短、很轻、与前后字粘在一起的「嗯」「啊」可能漏掉；也偶有把停顿前的气声写成「呃」。口头禅次数是下限估计。
- 第一次需要下载约 90 MB；之后离线可用。浏览器在隐私模式或存储空间不足时可能清掉缓存，需要重新下载。
- 需要较新的 Chrome / Edge / Safari / Firefox（WebAssembly、Web Worker、AudioWorklet），并通过 https 或 localhost 打开。识别在一个后台线程里进行，老电脑上会占用一部分 CPU。

## v1.1.0 时的情况（留作记录）

- 试讲过程中收集完整转写，回放里标出水词；开讲前可「试一下听写」；浏览器听写报 `network` 时说明这不是电脑没网。
- 当时本机识别还没有接入，只有一个不会假装可用的占位模块。

## 为什么 Web Speech 不够

| | 说明 |
|---|---|
| 隐私 | Chrome / Edge 会把声音送到浏览器厂商的在线服务（不经过沉思波）。对外只能诚实写明这一点。 |
| 覆盖 | Safari 依赖系统听写，不稳定；Firefox、多数国产浏览器、微信内置浏览器没有网页听写。 |
| 水词 | 不少在线服务会把「嗯、啊、呃」当噪声丢掉，而这正是要数的。连续听写有时会把一句话切断或改写。 |
| 课堂 | 10–20 分钟、教室回声、师生对话，在线短句听写并不为这种场景设计。 |
| 桌面 / App | 系统 WebView、Tauri、Electron 里通常**没有** Web Speech，多端发布前必须有本机方案。 |

所以：这一版把转写和标亮先做进产品，识别引擎做成可替换；下一步换成声音不出本机的中文识别。

## 当初比较过的本机方案

### 1. sherpa-onnx + 中文流式模型（首选）

- 许可证：Apache-2.0，和本项目兼容。
- 可在浏览器里用 WebAssembly 跑，也可在桌面 / 安卓用原生库，同一套模型。
- 可选模型：
  - **SenseVoice Small**（FunAudioLLM）：情感 / 事件标记能力强，对语气词相对友好，适合事后转写；
  - **Zipformer 流式中文**（icefall / wenet 训练的 sherpa 模型）：适合边讲边出字；
  - **关键词检测（KWS）**：专门盯「嗯、啊、然后、就是」等，作为转写的补充，避免被 ASR 滤掉。
- 体积：量化后通常几十 MB，按需下载并缓存，不要塞进首屏。
- 仓库里已留下脚手架：`src/asr-sherpa.js`、`scripts/fetch-asr.mjs`、`assets/asr/`。运行 `npm run fetch-asr` 下载模型后，`asr.js` 在「自动」模式下会优先选它。当前版本检测到模型也还不会真正跑识别（接入尚未完成），会说明并回退到浏览器听写。

### 2. FunASR（Paraformer 等）

中文效果好，更适合作为**学校版的校内服务**（服务器转写，数据不出校），而不是塞进手机浏览器。许可证和使用条件需单独核对。

### 3. Whisper small 的 WASM / whisper.cpp

英文尚可；中文小模型容易改写口语、丢掉语气词，更大的模型对手机浏览器太重。只建议作为对照，不作为主方案。

## 接下来

1. 用真实教室录音（10–20 分钟、有回声和学生插话）对照 `?debug=1&trace=1` 的轨迹，看语气词保留率和长时间稳定性。
2. 评估 SenseVoice Small int8（约 230 MB，语气词更友好但太大）和关键词检测（KWS，专门盯「嗯、啊、然后」）作为补充。
3. 桌面版（`apps/desktop/`）可以直接复用同一个 worker 和模型。
4. 若国内访问魔搭 CDN 不稳，可把模型放进自己的对象存储，在 `config.js` 填 `asrModelBase`（`npm run fetch-asr` 会下载并校验）。
