# 部署指南：制品入库不等于主站上线

> 2026-11-17 修订。基线 `7b9f12e` / package v1.6.4，本轮目标 v1.7.0；本文是流程说明，不是本轮部署或公网验收记录。

## 1. 三条发布路径分别记录

| 路径 | 触发与结果 | 边界 |
|---|---|---|
| 主力站 `https://openpodium.chensibo.cn/` | **手动**发布白名单 `dist/`，核对清单与哈希，保留 previous 后原子切 current | 不随 main、tag、Release 或 Pages 成功自动切换；还需 HTTPS、公网资源和交互验收。 |
| GitHub Pages 兼容入口 | `.github/workflows/pages.yml` 在 main push 或手动触发时构建部署 | 只证明兼容入口部署，不代表主站上线，也不迁移另一域的历史与模型缓存。 |
| GitHub Release 测试包 | `v*` tag 触发 CI，测试通过且 tag 与 package 一致后构建 zip 并上传 | 不是原生安装包，也不是主站根目录；不自动部署主站或创建 beta 站。 |

本项目不操作独立产品 kaijiang.chensibo.cn。旧 `titaojing` 仓库、测试包和存储技术 ID 保留，不应为更名破坏兼容。

## 2. 构建与制品范围

由负责版本的会话同步 `package.json`、变更记录与实际发布范围；目标版本不能充当已经发布的版本。构建前运行：

```bash
npm ci
npm run check-docs
npm test
npm run build
npm run smoke
```

这些是发布检查步骤，不表示本文修订时已全部执行。构建生成的 `dist/` 才是网页制品；**只上传 dist 内容，不上传整个工作区、源码、私人素材或 Release zip 解压根目录**。

- `scripts/build.mjs` 显式复制资源，landing 也采用白名单；部署前必须再运行既有构建范围检查 `node scripts/检查无3D构建.mjs dist`。脚本名称沿用历史，实际边界以其实现为准：真实练习零 Three，demo 独立懒加载的轻量 Three 可用；不恢复旧 Rocketbox／Draco 与私人宣传素材。
- 中文 ASR 权重按需下载，不随普通站点制品分发；sherpa 引擎、VAD 和清单随站点提供。镜像文件托管不是服务器 ASR 上线。
- 制品大小以本次构建输出及文件清单为准；不要继续把早期约 31 MB、单文件约 11 MB 写成所有版本恒定值。
- `version.json` 中 buildId 是 `版本-内容哈希`；后缀不是 Git SHA，也不是完整资源清单哈希。追溯时分别保存源码提交、package 版本、构建号、全文件 sha256、测试范围。

## 3. 主站手动发布与回滚

使用现有 `scripts/部署静态站.sh`，先审阅制品和发布范围再执行。脚本只允许既有主机白名单，不能更换目标或混发其他站点；不在本文提供可照抄的生产 release 路径。

脚本的实际流程：

1. 检查本地 dist，读取 buildId，生成逐文件 sha256 清单。
2. 上传至新的 release 目录，不覆盖现有服务文件。
3. 服务端逐文件校验哈希，核对文件集合，拒绝额外文件或软链。
4. 将旧 current 保存为 previous，再通过临时软链与原子 rename 切换 current；不改 nginx、证书，不自动完成公网验收。

发布前记录**当次实际** current / previous 和对应制品清单。回滚时由发布负责人核对当次 previous 的目标、清单与哈希，再原子回切 current；不要照抄历史 release 目录或假定 previous 一定存在。回切后重新验收公网，已打开页面与 Service Worker 缓存不会保证立即回退，需检查刷新／更新行为。

主站历史见 [2026-11-16 部署记录](OpenPodium部署记录-20261116.md)、[轻量 demo 记录](轻量3D演示验收-20261116.md)、[结束补丁记录](演示结束补丁发布-20261116.md)。它们只覆盖各自日期、版本与测试范围，不是本轮上线凭证。

## 4. HTTPS 静态托管要求

其他 HTTPS 静态主机也可承载 dist，子路径部署需验证资源相对路径与 Service Worker 作用域。

- 摄像头与麦克风需要 HTTPS 或 localhost 安全上下文，不用 `file://`。
- `.wasm` 使用 `application/wasm`，`.task` 使用 `application/octet-stream`，`.webmanifest` 使用 `application/manifest+json`；demo 的独立 ESM 需正确 JavaScript MIME。
- `index.html`、`sw.js`、`config.js`、`manifest.webmanifest`、`version.json` 不应长缓存；无内容指纹的 JS/CSS 与模型也要明确刷新／版本策略，不能盲目设置全部 assets 长缓存。
- nginx、Netlify / Cloudflare Pages、Vercel 参考配置在 `deploy/`；部署前复核实际主机的 MIME、缓存与权限策略，不为更新静态制品擅改生产 nginx。
- COS + CDN / EdgeOne 等需单独配置 HTTPS、缓存刷新与文件类型；大陆域名备案和配额按实际平台政策核实，不能沿用旧额度结论。

例如只读检查主站头部：

```bash
curl -fsSI https://openpodium.chensibo.cn/assets/mediapipe/wasm/vision_wasm_internal.wasm
curl -fsSI https://openpodium.chensibo.cn/sw.js
curl -fsS https://openpodium.chensibo.cn/version.json
```

这些命令在此只是示例，不表示本轮已执行。

## 5. tag / Release 的可执行契约

`.github/workflows/ci.yml` 支持 main push、PR、手动运行和 `v*` tag push。tag 先完成普通 CI；package job 仅对 tag 执行，检查 tag 名恰好为 `v<package.version>` 后生成 `release/*.zip`，用 job 级 `contents: write` 发布 Release。含 `-` 的版本标为预发布。

确认版本、检查和审阅完成后，仅推本次标签，不用 `git push --tags` 顺带推出其他标签。例如目标版本确为 1.7.0 时：

```bash
git tag v1.7.0
git push origin v1.7.0
```

普通 CI 默认仅只读仓库权限；Release 写权限不扩大到 PR 检查。手动在 tag ref 运行也必须通过同样版本校验。测试包旧文件名由 `scripts/package.py` 决定，不因产品更名擅改技术 ID。GitHub Release 成功后，主站仍需独立手动发布和验收。

## 6. 上线验收与交付口径

- 公网 `version.json` 与目标构建一致，关键 JS、demo ESM、模型／WASM 哈希与归档制品对应；仅 version 返回 200 不足以证明全量制品一致。
- 验证根入口、landing、真实／demo 来源标签、提前结束、2D 降级、权限拒绝和缺语音状态；真人摄像头／麦克风与实体手机另列，桌面视口不冒充真机。
- 核对 HTTPS、MIME、缓存头和 SW 更新；没有上传音视频的许可不做真人服务端测试。
- 服务器 ASR provider 正在实施，公网与上线未获确认前标为未上线；静态站部署不等于推理服务上线。
- 前端 `edition`、历史上限、激活码不是安全付费授权；没有已上线账号／团队／收费后台。未来服务需独立安全与隐私验收。
- 交付分别报告**本地检查、源码提交、制品入库、主站切换**。未做或未核验的明确标注，不以 Pages／CI 成功冒充上线。

## 历史说明

早期指南曾写“本次未部署”，并讨论 chensibo.cn 某静态空间单文件 512 KB／总量 5 MB 的限制。这些是当时环境说明，不是当前主站不可托管的结论，也不是该平台今天的配额承诺；2026-11-16 起的主站部署另有上述日期记录。历史保留在 Git 与日期记录中，不覆盖成新的实测。
