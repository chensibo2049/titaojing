# OpenPodium 主力服务器部署记录 · 2026-11-16

> 去掉装饰，留下观察；独立上线，不扰旧站。

## 实际部署

| 项目 | 结果 |
|---|---|
| 正式站 | <https://openpodium.chensibo.cn/> |
| 介绍页 | <https://openpodium.chensibo.cn/landing/> |
| 兼容入口 | <https://chensibo2049.github.io/titaojing/>，保留现有 Pages 工作流 |
| 主机 | SSH 别名 `quan2`；未使用退役 `quan` |
| buildId | `1.6.2-00087bdd`，2026-11-16 |
| 产物 | 本机 `dist/`，53,230,491 字节 / 39 文件；未上传源码和私人素材 |
| 静态根目录 | `/opt/static-sites/openpodium/current` |
| 当前版本 | `releases/20261116T102904Z-1.6.2-00087bdd` |
| 前一版本 | `releases/20261116T102648Z-1.6.2-00087bdd`（相同 buildId，首传修正后保留） |
| vhost | `/etc/nginx/sites-available/openpodium.chensibo.cn.conf`，同名 sites-enabled 软链 |
| 配置模板 | [`deploy/openpodium站点.conf`](../deploy/openpodium站点.conf) |
| 发布方式 | **本次手动部署**；没有新增服务器自动发布工作流或 GitHub SSH 密钥 |

## HTTPS 与续签

- 新域名 A 记录已解析到当前源站；未改 DNS。
- 复用 `/root/.acme.sh/acme.sh` 与 `/opt/acme-webroot`，现有 HTTP catch-all 已能响应本域名 challenge，因此不需要临时覆盖其他配置。
- 独立 Let's Encrypt ECC 证书：CN `openpodium.chensibo.cn`，颁发者 YE2，有效期 2026-11-16 09:29:12 UTC 至 2027-02-14 09:29:11 UTC。
- 独立安装目录 `/etc/nginx/ssl/openpodium.chensibo.cn/`，只在服务器保管；不读取或提交私钥、账号配置。
- 复用既有 acme cron（每天 05:17，服务器时区）；本域名续签 hook 为 `nginx -t && systemctl reload nginx`。续签配置已保存，但尚未经历下一次实际续签周期。
- 新配置启用前 `nginx -t` 成功后才 reload。原有其他站点的重复 MIME 与 server_names_hash 警告在变更前即存在；本轮未改其他项目消除警告，也未强制重启服务。

## 验收证据

全部 HTTP 证据来自普通域名公网 TLS，没有忽略证书、没有用源站 `--resolve` 冒充公网。

| 验收 | 结果 |
|---|---|
| HTTP `/` | 301 → 本域名 HTTPS |
| HTTPS `/`、`/index.html`、`/landing/`、`/version.json`、`/config.js`、`/sw.js`、应用 JS/CSS、视觉 glue、ASR worker/manifest | 200 |
| `/version.json` | `1.6.2-00087bdd`，与本地一致 |
| JS/CSS/config/SW | 完整响应 SHA-256 与本地制品一致 |
| index / SW / config / version | `Cache-Control: no-cache` |
| 未 hash JS / CSS / WASM | `max-age=3600`，不设永久 immutable |
| 模型 | `max-age=86400`；不 gzip，保留原始 Range 字节 |
| WASM MIME | `application/wasm`，视觉 SIMD/nosimd 与 ASR 均正确 |
| 模型与 WASM Range | 三个 task、两份视觉 WASM、一份 ASR WASM：206，`bytes 0-1023/总长`，1024 字节内容与本地一致 |
| 完整视觉资源下载 | 三个 task、两份视觉 WASM 公网下载 SHA-256 与制品一致 |
| JS gzip | `Content-Encoding: gzip`，含 `Vary: Accept-Encoding` |
| 设备权限响应头 | `Permissions-Policy: camera=(self), microphone=(self)` |
| 隐藏文件 | `._index.html` 返回 403 |
| Ego 浏览器 | 安全上下文、SW 正常；2D 演示→回放成功；桌面/手机三类入口共六项无横向溢出，未观察到 3D 请求 |

完整视觉资源 SHA-256：

```text
pose_landmarker_lite.task  59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a
face_landmarker.task       64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff
hand_landmarker.task       fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1
vision_wasm_internal.wasm  cb3ec20026a9aecc2a81a93c25630ceb5389297ddb7a5f0bd61dd09cde606b9b
vision_wasm_nosimd_internal.wasm 924274fcd5ac8985f6570a8573e7971b7bd2d580ba1b8f3beb0ba8f95db6347c
```

### 保护现有开讲

`kaijiang.chensibo.cn` 仍代理既有 `127.0.0.1:3216` Docker 应用，没有覆盖、停止或改动。

- 前后标题一致：`开讲 · 课件变讲解视频`。
- 前后 HTML SHA-256：`c663c56e9d9e066ed1288cf351fee5bd2b467c478b4642e1fad94440688ac97e`。
- 前后 vhost SHA-256：`a971d9c5f60393a6972986815f5120c58ccd3af4719d6ebc34d4a1f891bbb4e1`。

### 传输修正

首传 macOS tar 自动附加 50 个 AppleDouble 元数据文件，虽已被隐藏路径规则拦截，仍不符合发布白名单。修正脚本为 `COPYFILE_DISABLE=1 tar --no-xattrs`，新 release 对照 SHA-256 清单和完整文件列表，确认只有 39 个白名单文件后原子切换。旧 release 的这些元数据在逐个验证 AppleDouble 标头后清理，旧版 39 个公开文件也重新校验通过。没有删除任何用户私人素材。

## 后续手动更新

先在开发机执行：

```bash
npm run build
npm test
npm run check-docs
node scripts/检查无3D构建.mjs
bash scripts/部署静态站.sh quan2
curl --fail https://openpodium.chensibo.cn/version.json
```

[`scripts/部署静态站.sh`](../scripts/部署静态站.sh) 仅允许 `quan2`，只上传 dist；新建 release、核对每个 SHA-256 与完整文件列表、记录 previous，再原子切换 current。不改 nginx 或证书，不自动清理历史 release；切换内容无需 reload。必须再验收公网模型、入口及浏览器，不以脚本完成代替健康检查。

## 回滚

本次是新站首次部署，两个保留 release 是相同构建号；首个 release 是传输基线，不是旧 3D 版本。后续部署后 `previous` 才指向前一业务版本。

按显式版本恢复（不删除任何 release，不需要 nginx reload）：

```bash
ssh quan2 'set -eu
cd /opt/static-sites/openpodium
TARGET=releases/20261116T102648Z-1.6.2-00087bdd
test -d "$TARGET"
NEXT="current.rollback.$(date +%s)"
ln -s "$TARGET" "$NEXT"
mv -Tf "$NEXT" current'
curl --fail https://openpodium.chensibo.cn/version.json
```

如需撤销本次新增站点而非切换版本，仅禁用本域名软链，校验后 reload；保留产物/证书供恢复，不动其他站点：

```bash
ssh quan2 'set -eu
unlink /etc/nginx/sites-enabled/openpodium.chensibo.cn.conf
if nginx -t; then
  systemctl reload nginx
else
  ln -s /etc/nginx/sites-available/openpodium.chensibo.cn.conf /etc/nginx/sites-enabled/openpodium.chensibo.cn.conf
  exit 1
fi'
```

浏览器 SW 与缓存可能仍展示缓存版本，服务器软链回滚不等同于已打开页面立即回滚，须核对版本并重新加载。

## 后续发布 · 1.6.5 入口页改版（2026-11-17）

| 项目 | 结果 |
|---|---|
| buildId | `1.6.5-e670a542`，2026-11-17 |
| release | `releases/20261116T184050Z-1.6.5-e670a542` |
| 源码 | PR #12，合并提交 `31d9b82` |
| 前一版本 | 1.6.4 对应 release 保留，可用于回滚 |
| nginx / 证书 | 未改动 |

公网核验：`/version.json` 与本地制品一致；首页、介绍页、CSS、JS 均 200；普通浏览器加载无报错、无三维请求；已同意条款的状态下，1366×768 与 390×844 的「开始练习」均真实可点，回看示例卡可见，无横向溢出。

适用范围：桌面 Chromium 模拟。真实摄像头、麦克风、实体手机与语音转写仍未实测。

## 边界与未完成项

- 真实摄像头、麦克风、实体手机、视觉首帧及语音转写未在本轮实测。资源可达与哈希正确不等同于实际推理通过。
- 用户数据按 origin 隔离，新域名无法自动继承 Pages 的历史、录像或听写缓存；旧入口保留。
- 分享元数据仍保留 Pages 绝对链接，图已是公开的非 3D 图；不为此次迁移重命名存储 ID 或批量改仓库 URL。README 的正式访问入口已改为新域名。
- 服务器新站没有 main 自动发布；仅保留原有 Pages 自动构建兼容入口。未添加任何 SSH 私钥或第三方部署凭据。
- 源码提交、PR、合并状态以仓库实际 git / GitHub 记录为准；线上切换与源码提交分别验收。
