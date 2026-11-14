# 代码托管：GitHub 还是 CNB？

> 数据以各平台 2026 年 11 月公开文档为准，额度可能调整。

## 对比

| | GitHub | CNB（cnb.cool，腾讯云原生构建）|
|---|---|---|
| 影响力 / 曝光 | 全球最大的开源社区；Star、Trending、搜索引擎收录好；简历和媒体报道里认可度高 | 国内新平台（2024 年起），社区还在成长，曝光面小 |
| 国内访问 | 网页一般能打开但不稳定；`git clone`、Release 下载、LFS 经常很慢或失败，需要代理 | 国内速度快、稳定；学校同学、老师不需要任何"魔法" |
| 账号 | 邮箱注册；部分同学没有账号 | 微信扫码等方式登录，门槛低 |
| CI | GitHub Actions：**公开仓库标准 runner 免费**；自带 Chrome，适合我们的无头浏览器冒烟测试 | 云原生构建（`.cnb.yml`，基于 Docker）：每个组织每月 **160 核时**免费（2 核约 80 小时），公开仓库也计入 |
| 云端开发环境 | Codespaces（免费 120 核时/月）| 云原生开发（免费 1600 核时/月），浏览器里直接写代码，适合机房电脑 |
| 大文件 | 单文件 > 100 MB 拒绝推送；Git LFS 免费 **10 GiB 存储 + 10 GiB/月下载流量**，流量算在仓库所有者头上，超了 LFS 下载会被停 | 仓库存储 100 GiB、对象存储（含 LFS）100 GiB 免费 |
| Release 附件 | 单文件 ≤ 2 GiB，适合放测试包 | 支持，国内下载快 |
| 协作功能 | Issue / PR / Discussions / Projects 成熟 | Issue / PR / 看板齐全，界面中文 |

## 我们的大文件怎么处理（与平台无关）

体态镜需要 MediaPipe 的 2 个模型（共约 9.3 MB）和 4 个 WASM 文件（共约 22 MB）：

- **模型 `.task` 直接提交到仓库**（`assets/mediapipe/models/`）。单个不到 6 MB，远低于任何平台限制；国内用户无法访问 Google 的模型存储，提交进仓库是最省心的办法；不用 LFS，就没有 LFS 流量额度问题，镜像同步也简单。
- **WASM 不提交**，由 `npm install` 时自动运行的 `scripts/fetch-models.mjs` 从 npm 包 `@mediapipe/tasks-vision` 复制（国内可用 npmmirror / 腾讯云 npm 镜像），并做 sha256 校验。
- 构建产物 `dist/`、测试包 zip 不提交，挂到 Release。

所以**不需要 Git LFS**。将来如果加入较大的语音模型（几十 MB），优先放 Release 附件或对象存储（COS）并由 `fetch-models` 下载，同样不进 LFS。

## 推荐：GitHub 为主仓库，CNB 为国内镜像 + 国内 CI

理由：开源的首要目标是"制造动静"，Star、Trending、媒体和招聘方都看 GitHub；而日常协作的同学和老师在国内，CNB 解决速度问题。

具体做法：

1. 在 GitHub 建组织（例如 `chensibo`）和公开仓库 `titaojing`，作为**唯一的主仓库**：Issue、PR、Release 都在这里。
2. 在 CNB 建同名组织和仓库，作为**只读镜像**，README 顶部注明"主仓库在 GitHub，请到那里提 Issue / PR"。同步方式二选一：
   - 在 GitHub Actions 里加一个推送到 CNB 的任务（需要在 GitHub 仓库 Secrets 里放 CNB 的访问令牌）；
   - 或在 CNB 侧配置定时从 GitHub 拉取（以 CNB 当前提供的仓库同步功能为准）。
3. 两边 CI 都配好（`.github/workflows/ci.yml`、`.cnb.yml`），国内同学在 CNB 上也能看到构建结果、用云原生开发环境改代码。
4. 如果之后发现参与者几乎都在国内、GitHub 访问成为主要障碍，可以反过来：CNB 为主、GitHub 镜像。仓库里的配置两边都兼容，切换成本低。

## 第一次推送（需要你来操作）

本地仓库已经整理好并做了初始提交，但没有配置任何远程地址，也没有推送。建好空仓库后：

```bash
cd titaojing
git remote add origin git@github.com:<组织>/titaojing.git
git push -u origin main
# CNB 镜像
git remote add cnb https://cnb.cool/<组织>/titaojing.git
git push cnb main
```

建议同时：开启 main 分支保护（必须 PR + CI 通过）、填写仓库简介和主题标签（`teacher-education`、`mediapipe`、`pwa`、`师范生`）、上传社交预览图（可用 `docs/images/` 里的截图）。
