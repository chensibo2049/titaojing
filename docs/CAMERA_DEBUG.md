# 真实摄像头调试指南

体态镜的姿态 / 面部识别和口头禅听写都在浏览器里完成，所以"调试真实摄像头"其实就是三件事：

1. 让浏览器**允许**用摄像头和麦克风（安全上下文：https 或 localhost）；
2. 能看到页面的**控制台和网络**（尤其是手机上）；
3. 能看到程序内部的**判断过程**（帧率、关键点置信度、事件、语音识别），并能把出问题的那一段**留下来**复现。

第 3 点靠体态镜自带的 **调试模式 `?debug=1`**，见文末。

---

## 1. 电脑：最简单，先在这里调通

```bash
npm install          # 首次
npm run build
./start.sh           # macOS / Linux；Windows 双击 start.bat
```

终端会打印实际网址（默认 `http://127.0.0.1:8765/`，端口被占用会自动换 8766、8767……）。

| 浏览器 | 摄像头 | 口头禅听写 | 备注 |
|---|---|---|---|
| Chrome / Edge（Win、Mac） | ✓ `localhost`/`127.0.0.1` 视为安全 | ✓ 需联网（走厂商在线语音服务） | 首选。F12 打开开发者工具 |
| Safari（Mac） | ✓ | 不稳定 | 先在「设置 → 高级」勾选「在菜单栏中显示开发菜单」 |
| Firefox | ✓ | ✗（没有 Web Speech 识别） | 教态、视线可测 |

macOS 首次使用要在「系统设置 → 隐私与安全性 → 摄像头 / 麦克风」里允许对应浏览器，改完要**重启浏览器**。

常用技巧：

- **调试源码**：`npm run dev`（构建调试包并服务源码目录，不注册 Service Worker，改完 `npm run build:dev` 刷新即可）。
- **没有摄像头 / 想固定输入**：Chrome 可用假设备启动：
  `google-chrome --use-fake-device-for-media-stream --use-fake-ui-for-media-stream`；
  还可以喂一段视频（需 `.y4m` / `.mjpeg`）：`--use-file-for-fake-video-capture=/path/teach.y4m`
  （`ffmpeg -i teach.mp4 -pix_fmt yuv420p teach.y4m` 转换）。这是复现"某段试讲识别不准"最稳的方法。
- **Service Worker 缓存旧版本**：DevTools → Application → Service Workers → Unregister，或勾选 "Update on reload"。源码目录模式下不注册 SW。

## 2. 手机：必须 https

手机浏览器只在 **https** 页面开放摄像头。用电脑局域网地址 `http://192.168.x.x:8765` 打开时，页面能显示，但点「对着镜头试讲」会看到"需要 https"的说明页——这不是 bug。

三种办法，按推荐顺序：

### 方案 A：部署到 https 静态主机（最接近正式环境，推荐给测试同学）

把 `dist/` 上传到腾讯云 COS + CDN / EdgeOne、阿里云 OSS、自己的 nginx（见 [`DEPLOY.md`](DEPLOY.md)）。测试同学直接打开网址即可，也能"添加到主屏幕"测 PWA。缺点是每改一次要重新上传。

### 方案 B：内网穿透临时 https 网址（开发时最快）

本机 `./start.sh` 跑着，另开终端：

```bash
# Cloudflare Quick Tunnel：免注册，生成 https://xxxx.trycloudflare.com
cloudflared tunnel --url http://127.0.0.1:8765

# 或 ngrok（需注册拿 token）
ngrok http 8765
```

把打印出的 https 网址发到手机打开。注意：

- 两者都是境外服务，国内访问速度和稳定性不保证；首次加载要下载约 21 MB 模型，可能较慢。国内可以考虑自建 frp、或使用国内的内网穿透服务。
- 临时网址任何人拿到都能访问，**调完就关掉**，不要用它给外部测试同学长期使用。
- 网址一变，PWA 和本机历史都会当成新站点。

### 方案 C：局域网 + mkcert 本地证书（不出网、速度快）

```bash
brew install mkcert            # Windows: choco install mkcert
mkcert -install                # 在电脑上安装本地 CA
mkcert 192.168.1.23 localhost  # 换成电脑的局域网 IP，生成 *.pem
```

然后用任一支持 https 的静态服务器服务 `dist/`，例如：

```bash
npx http-server dist -S -C 192.168.1.23+1.pem -K 192.168.1.23+1-key.pem -p 8443
```

手机要**信任这个 CA**：运行 `mkcert -CAROOT` 找到 `rootCA.pem`，传到手机——

- iPhone：用 AirDrop / 邮件打开 → 安装描述文件 → 「设置 → 通用 → 关于本机 → 证书信任设置」里打开完全信任；
- 安卓：「设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书」（不同厂商路径不同；部分安卓 Chrome 不信任用户 CA，此时改用方案 A/B）。

> `rootCA-key.pem` 是你电脑的私钥，**不要**发给别人、不要提交到仓库。

## 3. 看到手机上的控制台

### iPhone / iPad Safari → Mac Safari Web Inspector

1. iPhone：「设置 → Safari → 高级 → 网页检查器」打开。
2. Mac Safari：「设置 → 高级 → 在菜单栏中显示开发菜单」。
3. 数据线连接（同一 Wi-Fi 下也可无线），在 Mac Safari 菜单「开发 → 你的 iPhone → 体态镜页面」，即可看控制台、网络、存储（IndexedDB）。
4. 添加到主屏幕后的 PWA 也会出现在这个菜单里。

iOS 上要注意：iOS 上**所有浏览器（包括 iOS 版 Chrome、Edge）都是 WebKit 内核**，表现和 Safari 基本一致；摄像头需 iOS 14.3+，屏幕常亮需 16.4+；口头禅听写依赖系统「Siri 与听写」。

### 安卓 Chrome → 电脑 Chrome `chrome://inspect`

1. 手机：「设置 → 关于手机」连点「版本号」7 次开启开发者选项 → 打开「USB 调试」。
2. 数据线连接电脑，手机上允许调试。
3. 电脑 Chrome 打开 `chrome://inspect/#devices`，找到手机上的页面点 **inspect**，可看控制台、网络，还能看到手机画面。
4. 用 **Port forwarding**（`8765 → localhost:8765`）后，手机打开 `http://localhost:8765` 也算安全上下文，**不需要 https 就能用摄像头**——这是安卓上最省事的调试方式。

### 微信内置浏览器

- 现状：iOS 微信内置浏览器通常**打不开摄像头**；安卓微信（X5/XWeb 内核）可能能开摄像头，但**没有网页语音识别**，录像格式也不稳定。体态镜会识别微信 / QQ 并提示"右上角 … → 在浏览器中打开"。
- 想在微信里看日志：临时在页面加 [vConsole](https://github.com/Tencent/vConsole)（腾讯开源的手机端控制台）。只在调试构建里加，不要发布到正式版：
  ```html
  <script src="https://unpkg.com/vconsole@latest/dist/vconsole.min.js"></script>
  <script>new VConsole();</script>
  ```
  （国内可把 vconsole.min.js 下载下来放到同目录引用。）
- 安卓微信也可以用「微信开发者工具」的公众号网页调试，或在手机微信里打开 `http://debugxweb.qq.com/?inspector=true` 后用电脑 `chrome://inspect` 调试（以微信官方当前说明为准）。
- 小程序版本不是同一套代码，见 [`ROADMAP.md`](ROADMAP.md)。

## 4. 体态镜调试模式 `?debug=1`

在网址后加 `?debug=1`（放在 `#` 前面）：

```
http://127.0.0.1:8765/?debug=1            # 封面
http://127.0.0.1:8765/?debug=1#/try       # 直接进镜头试讲
https://你的域名/?debug=1&trace=1#/try     # 每次试讲自动记录轨迹
```

左上角会出现调试面板（可点「—」收起），内容：

| 区块 | 看什么 |
|---|---|
| 来源 / 帧率 / 推理 | `camera` 或 `demo（合成）`；实时帧率（< 12 fps 标黄，App 会自动降低面部分析频率）；每帧模型推理耗时；面部模型每几帧跑一次 |
| 关键点置信度 | 鼻、双肩、双肘、双腕、双髋的 visibility（< 0.5 红，< 0.8 黄）。肩、髋长期发红 → 站位太近 / 背光 / 下半身被讲台挡住 |
| 判断 | 视线标签（class / notes / board / ceiling / away / unknown）及 yaw、pitch 原始值；当前教态标记（sway / slouch / hip / folded / out）；是否判定为写板书 |
| 已触发事件 | 最近 8 个事件和时间点，和回放时间线一致 |
| 语音识别 | 状态（starting / listening / ended / error: network / not-allowed / unsupported 等）和**原始听写结果**（■ 定稿 □ 临时）。口头禅没统计到时，先看这里有没有听写文字 |
| 模型加载 | 下载耗时、姿态模型（含 WASM 初始化）耗时、面部模型耗时、GPU/CPU、是否无 SIMD、错误信息 |
| 环境 | 构建号、安全上下文、摄像头 / 录制 / 语音 API 是否可用、是否微信、UA |

### 记录轨迹（用于提交 bug，不含视频）

1. 点「● 记录轨迹」开始（或用 `&trace=1` 让每次试讲自动开始 / 结束）；
2. 复现问题后点「■ 停止记录」，再点「下载 JSON」；
3. 把 `titaojing-trace-时间.json` 附在 Issue 或「反馈问题」里。

轨迹里只有每帧的关键点坐标、视线角度、判断结果和事件（格式见 [`TRACE_FORMAT.md`](TRACE_FORMAT.md)），**不含视频、音频、图片**。原始听写文字默认**不写入**，只有勾选「轨迹里包含原始听写文字」才会写入——提交前请确认里面没有不想公开的内容。

开发者可以在控制台用 `window.__titaojingDebug.getTrace()` 取到当前轨迹对象。轨迹也是训练数据的格式，见 [`TRAINING.md`](TRAINING.md)。

## 5. 常见问题速查

| 现象 | 先看 | 常见原因 / 解决 |
|---|---|---|
| 运行 `./start.sh` 报 `Address already in use` | — | v1.0.1 起会自动换端口；按终端里打印的网址打开 |
| 手机打开后提示需要 https | 地址栏 | 用方案 A/B/C，或安卓用 `chrome://inspect` 端口转发 |
| 一直"教态模型加载中" | 调试面板「模型加载」、Network | `.wasm` MIME 不是 `application/wasm`；CDN 拦截大文件；网络慢（首次约 21 MB）|
| 骨骼线不出现 / 时有时无 | 关键点置信度 | 离镜头太近，腰部以上要完整入镜；逆光；把手机放到胸口高度 |
| 骨骼线和人对不上（左右反） | 镜像开关 | 前置镜头默认镜像，后置不镜像；设置里可改 |
| 一直"视线在讲稿上" | yaw / pitch | 手机位置太高（俯拍）会让 pitch 偏大；把镜头放到与眼睛同高，或调低视线灵敏度 |
| 口头禅一个都没有 | 语音识别状态 | `network`：语音服务连不上；`not-allowed`：麦克风被拒；`unsupported`：浏览器不支持（Firefox、部分国产浏览器、微信）|
| 很卡 | 帧率、推理耗时 | 关掉其他标签页；低端机会自动降频；调试面板里 GPU 显示 CPU 说明 WebGL 不可用 |
