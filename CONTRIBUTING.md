# 参与体态镜

欢迎提 Issue、改进规则、补测试和写文档。语言以中文为主，代码里的用户可见文案必须是中文。英文补一段 README 即可。

## 怎样商量一件事

- 先在 Issue 里说清现象或想法。教学规则（什么样算晃动、什么样算没回视）请用「教学规则建议」模板，最好附上轨迹 JSON（`?debug=1` 导出，不含视频）。
- 修 bug 请用「故障」模板，写上设备、浏览器和版本号（封面右下角）。
- 开始写代码前，先让维护者表示「可以做」，以免和正在进行的工作重复。

## 本地开发

```bash
npm install          # 国内可先 npm config set registry https://registry.npmmirror.com
npm run dev          # 构建调试包并在源码目录启动
# 或
npm run build && ./start.sh
```

终端会打印实际网址（端口被占用时自动更换）。请用 Chrome 或 Edge 打开。不要用 `file://` 打开页面。

```bash
npm run smoke        # 无头 Chrome 冒烟（约 1 分钟）
npm run qa           # 更完整的页面验收（需先自行用 8877 端口服务 dist/）
cd training && bash run_synthetic_demo.sh   # 训练脚手架（合成数据）
```

不要提交 `node_modules/`、`dist/`、`assets/mediapipe/wasm/`、真实试讲数据或体验计划队列导出。模型 `.task` 已在仓库中；WASM 由 `npm run fetch-models` 从 npm 包复制。

## 文案和外观

这是一面给课堂用的镜子，不是「AI 产品」。请避免「赋能」「大模型」「智能诊断」以及霓虹、渐变的科技口号。语气平实，像一位站在教室里的老师在说话。视觉保持纸色、墨色、黑板和朱砂，与现有页面一致。

请勿在产品界面或文档中使用大学校徽或校名 Logo。品牌名称是「沉思波 · 体态镜」。

## 提交说明

用现在时、说清做了什么，例如「延长课堂模式至 20 分钟」。一次提交只做一件事。提交前至少 `npm run build && npm run smoke`。

法律上，贡献将按 Apache-2.0 授权（见 LICENSE 与 NOTICE）。请确认你有权提交这些内容，并且其中没有未同意公开的真实学生或教师录像、轨迹或转写。
