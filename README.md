# 沉思波 · 体态镜

对着镜头讲一段课。教态、视线、口头禅和写板后的回视，会像运动训练一样，直接画在画面上。讲完可以回放，转写里的水词会标出来。

面向师范生，也可以给把电脑放在讲台上的教师用。练习模式几分钟即可；课堂模式支持 10 到 20 分钟。

- 纯静态网页：没有后端、没有账号。
- 视频默认只留在本机，不上传。
- 姿态与面部模型（Google MediaPipe）随程序提供或在安装时校验后放入，不访问国外 CDN。
- 可安装到手机桌面或电脑（PWA），打开过一次后可以离线使用（转写除外，见下）。

> 体态与视线来自单个摄像头的估计，只作训练提示，不是精确测量，也不是心理或医学评估。

![封面](docs/images/cover.jpg)

**English (short).** Titaojing (体态镜, “a posture mirror for teaching practice”) is an open-source, in-browser trainer for student teachers and classroom lecturers. It overlays posture, gaze, filler words and “look-back after writing on the board” on a live camera view, then offers a marked replay and a transcript with filler words highlighted. Video stays on the device by default. This is a classroom training tool, not an “AI product.” See the Chinese sections below for setup, privacy, and contributing. Licensed under Apache-2.0.

---

## 功能

| 模块 | 说明 |
|---|---|
| 一键演示 | 不开摄像头，约一分钟看完叠加、回放、转写和水词标记，适合投影 |
| 对着镜头试讲 | 前置 / 后置、镜像；练习（短）或课堂（10–20 分钟）；半身 / 全身 / 自动判断构图 |
| 回放 | 时间线标记、两句说明、完整转写（水词标出，可跳转）、和上一次对比 |
| 历史与对比 | 本机保存；任选两次比较；趋势图 |
| 设置 | 模式与时长、构图、灵敏度、口头禅词表、听写语言与引擎、板书区位置 |
| 导出 | 小结图片、打印 / PDF、历史 JSON |
| 体验计划 | 默认关闭。主动参加后，才可能把词表、转写、摘要和少量截图排进本机队列；录像默认不上传。当前未配置上传地址，不会发到任何服务器 |

产品介绍页（纸色、课堂光线，不是科技宣传）：打开仓库里的 `landing/`，或构建后的 `dist/landing/`。

## 本地运行

需要 Python 3 和现代浏览器（推荐 Chrome / Edge）。

```bash
npm install          # 首次；国内可先 npm config set registry https://registry.npmmirror.com
npm run build
./start.sh           # macOS / Linux。Windows 用 start.bat
```

终端会打印**实际网址**（默认 http://127.0.0.1:8765/ ）。若 8765 已被占用，会自动改用 8766、8767……一直试到 8785，请打开终端里那一行，不要假定端口。也可 `./start.sh 9000` 或 `PORT=9000 ./start.sh`。

不要双击 `index.html`（`file://` 下不能用镜头）。手机测试必须是 **https**，见 [`docs/CAMERA_DEBUG.md`](docs/CAMERA_DEBUG.md)、[`docs/CLASSROOM.md`](docs/CLASSROOM.md)。

开发调试：`npm run dev`（源码目录，不注册离线缓存）。排错可在网址后加 `?debug=1`。

## 构图、时长与转写

- **半身**：腰部以上，电脑放在讲台上近拍。**全身**：从头到脚，镜头再远一些或放在教室侧前方，能看见站位、步伐，以及写板时是否背对学生。可指定，也可开讲后自动判断。
- **练习**：1–5 分钟（默认 2 分钟）。**课堂**：10 / 15 / 20 分钟，最长再加 2 分钟（不超过 22 分钟）。
- **转写**目前默认使用浏览器听写（Chrome / Edge 需联网，声音会经过厂商服务）。回放里可以看到全文和水词。本机中文识别（sherpa-onnx）已留下接口和下载脚本，接入后声音可以留在本机，见 [`docs/ASR.md`](docs/ASR.md)。

## 构建与目录

```bash
npm run build        # 生成 dist/（含落地页 dist/landing/）
npm run smoke        # 无头 Chrome 冒烟
python3 scripts/package.py   # 打测试包到 release/
```

```
index.html            页面（中文界面）
config.js             试用 / 正式开关、体验计划上传地址（默认空）
src/                  主程序：镜头、关键点、规则、转写、回放、同意与体验计划
assets/mediapipe/     模型（入库）与 WASM（npm 安装时校验复制）
training/             轨迹训练脚手架（合成数据可跑通）
landing/              产品介绍页
docs/                 使用、调试、训练、发布与隐私
apps/desktop|mobile   Tauri / Capacitor 外壳骨架（尚未出安装包）
```

版本号在 `package.json`。发版前改版本号并写 `CHANGELOG.md`。

## 部署

把 `dist/` 全部文件放到任意 **https** 静态主机。详见 [`docs/DEPLOY.md`](docs/DEPLOY.md)（nginx、腾讯云 COS / EdgeOne、Vercel 等）。介绍页在 `/landing/`。

## 开源与协作

Apache-2.0（与 MediaPipe 兼容），第三方说明见 `NOTICE`。品牌名「沉思波 · 体态镜」不随许可证授予商标权。

请先读 [`CONTRIBUTING.md`](CONTRIBUTING.md)、[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)、[`docs/PRIVACY.md`](docs/PRIVACY.md)、[`docs/SECURITY.md`](docs/SECURITY.md)。

代码托管建议：GitHub 作主仓库（Issue、PR、Release），CNB（cnb.cool）作国内镜像和国内 CI。比较见 [`docs/REPO_HOSTING.md`](docs/REPO_HOSTING.md)。本仓库已整理好，尚未配置远程地址，也尚未推送。

训练路线（关键点规则校准与小模型，而不是重训姿态模型）：[`docs/TRAINING.md`](docs/TRAINING.md)。平台规划（网页、Tauri 桌面、Capacitor 应用、微信小程序的限制）：[`docs/ROADMAP.md`](docs/ROADMAP.md)。

## 隐私（摘要）

视频默认不上传。历史在本机。浏览器听写会把声音送到厂商服务；本机识别接入后可避免这一点。体验计划默认关闭，见 [`docs/PRIVACY.md`](docs/PRIVACY.md)。

## 许可

[Apache License 2.0](LICENSE)。发起：南京市沉思波网络科技有限责任公司；作者同时是江苏第二师范学院汉语言文学师范专业学生。产品中不使用大学校徽。
