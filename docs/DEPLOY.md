# 部署指南

> 本文件内容原在 README，v1.0.1 起移到这里。

## 任意 https 静态主机

把 **`dist/` 目录里的全部文件**上传到网站根目录（或任一子路径，所有路径都是相对路径）即可。要求：

1. **必须 https**（浏览器只在 https 或 localhost 下开放摄像头）。
2. `.wasm` 的 MIME 应为 `application/wasm`；`.task` 用 `application/octet-stream`；`.webmanifest` 用 `application/manifest+json`。
3. `index.html`、`sw.js`、`config.js` 不要长缓存（`no-cache`），否则测试同学拿不到新版。
4. 单文件最大约 11 MB（`vision_wasm_internal.wasm`），总计约 31 MB；首次真实试讲实际下载约 21 MB（WASM 二选一 + 两个模型），之后走缓存。

### nginx

见仓库里的 `deploy/nginx.conf`（含 MIME、缓存头、https 跳转、`Permissions-Policy`）。上传后检查：

```bash
curl -sI https://你的域名/assets/mediapipe/wasm/vision_wasm_internal.wasm | grep -i content-type   # application/wasm
curl -sI https://你的域名/sw.js | grep -i cache-control                                            # no-cache
```

### 腾讯云 COS 静态网站 + CDN / EdgeOne

1. 新建存储桶（公有读私有写），开启「静态网站」，索引文档 `index.html`。
2. 用 COSBrowser 或 `coscli cp -r dist/ cos://桶名/` 上传 `dist/` 内容。
3. COS 会按扩展名设置 Content-Type；若 `.wasm` 不是 `application/wasm`，在对象「自定义 Headers」里把 `Content-Type` 改为 `application/wasm`（`.task` 设为 `application/octet-stream`）。
4. 绑定自定义域名并开启 **HTTPS**（COS 自定义 CDN 加速域名或 EdgeOne 站点均可，证书可用腾讯云免费证书）。
5. 在 CDN / EdgeOne 缓存规则中：`index.html`、`sw.js`、`config.js`、`manifest.webmanifest` 设为不缓存或 0 秒；`/assets/*` 可缓存 30 天。每次发版后刷新这几个文件的缓存（或整目录刷新）。
6. 面向中国大陆用户的域名需完成 ICP 备案。

### Vercel / Netlify / Cloudflare Pages

- `dist/` 里已带 `vercel.json`（Vercel）和 `_headers`（Netlify / Cloudflare Pages），直接把 `dist/` 作为发布目录即可，无需构建命令（或构建命令 `npm run build`、输出目录 `dist`）。
- 注意：这些平台在中国大陆访问速度和稳定性不保证，正式面向国内学员建议用腾讯云 / 阿里云。

### 关于 chensibo.cn 现有空间

现有空间限制为**单文件 512 KB、总量 5 MB**，而本程序的 WASM 单文件约 11 MB、模型 3.6–5.5 MB、总计约 31 MB，**无法直接放上去**。可选做法：主页面放在任意 https 静态主机（如腾讯云 COS），chensibo.cn 上只放一个跳转链接或入口按钮。本次没有部署到任何地方。

### 改成正式版 / 调整试用限制

部署后直接编辑站点根目录的 `config.js`：`edition: "pro"`，或修改 `editions.trial.maxHistory` 等，无需重新构建（`config.js` 不走长缓存）。正式上线前请清空 `testActivationCodes`。真实的激活 / 付费需要后端，届时只需替换 `src/license.js` 的 `verifyLicense()`。

### 子路径部署

所有资源都是相对路径，可以放在 `https://example.com/titaojing/` 这样的子目录下。Service Worker 的作用域就是该目录。

### 发版检查清单

1. 改 `package.json` 的 `version`，在 `CHANGELOG.md` 写更新记录。
2. `npm run build && npm run smoke`。
3. 上传 `dist/` 全部文件；刷新 CDN 上 `index.html`、`sw.js`、`config.js`、`manifest.webmanifest`、`version.json` 的缓存。
4. 打开 `https://你的域名/version.json` 确认版本号；打开 `?debug=1` 看模型加载是否正常。
5. 打 tag：`git tag v1.0.1 && git push --tags`（CI 会自动打测试包，见 `docs/ROADMAP.md`「发布与版本」）。
