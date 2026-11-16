# 课堂人物：当前 2D 与历史 3D 管线

## 当前（v1.6.2）

- 全部装饰性 3D 已退出当前功能范围；一键演示及其回放沿用已有 Canvas 2D 人物，模拟课堂 / 路演使用已有 SVG 2D 插画、状态文字和回答气泡，不再提供 3D 人物切换。
- 演示的动作、字幕和提示均为预设，不是真实视觉识别。摄像头或导入视频的 MediaPipe 视觉推理仍在本机运行，与装饰性 3D 无关。
- 当前发布范围不含 three.js、Rocketbox 人物、Draco 解码器及旧 3D 宣传媒体。旧 3D 管线已退役，下文资源与脚本路径仅为历史记录，不表示文件当前仍存在，也不是当前构建要求；发布前须核验产物。当前组件许可与历史来源分列于 [`NOTICE`](../NOTICE)。

## 历史归档（v1.5.0–v1.6.1，以下不描述当前功能）

下文保留当时的选型、许可、构建方法与限制，路径和命令仅供追溯，不是当前构建步骤。

这一页原先记录我们怎样用 Blender 做课堂用的 3D 人物。v1.6.0–v1.6.1 期间，模拟课堂、模拟路演和封面 / 一键演示在 WebGL 可用时默认使用 Microsoft Rocketbox 人物；显卡弱、软件渲染，「流畅优先」，或在设置里选择「只用插画」时，会退回原来的插画。v1.5.0 使用的 MakeHuman / MPFB 网格在 v1.6.0 被替换掉。

### 历史来源与许可

- 人物网格、贴图与官方动画来自 [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox)。许可证为 **MIT**，Copyright (c) 2020 Microsoft。允许商业使用与再分发，须保留版权声明。与本仓库的 Apache-2.0 许可兼容。上游早期博文曾写「研究与教学使用」，以仓库中的 `LICENSE.md` 为准。
- 本仓库只收录经 Blender 转换、压缩后的 glTF（WebP 贴图、Draco 网格），不收录完整上游资源库（约 4 GB）。
- 坐姿闲置、张望、摊手、思考、讲解、放松手势、演示等动作来自同一套官方 Bip01 动画，经视觉重定向到各角色（官方动画 FBX 的绑定姿势与角色网格不同，不能把动作直接赋给角色骨骼）。举手、点头、齐读、短步行、转向黑板等缺失的动作由我们在 Bip01 上补关键帧。**不是 Mixamo。** Adobe Mixamo 不允许把原始资源单独再分发，本仓库不收录 Mixamo 文件。
- 许可摘录见仓库根目录的 `NOTICE`。three.js（MIT）和 Draco 解码器（Apache-2.0）只用于按需加载的 3D 画面。

### 历史选用角色

库中儿童看起来偏小，也不够组成一套可用的东亚中学生。因此同学选用看起来更年轻的成年休闲形象：

| 编号 | 名 | 上游 | 角色 |
|---|---|---|---|
| s1 | 林秋 | Female_Adult_05 | 同学（粉色格纹西装） |
| s2 | 许青 | Female_Adult_08 | 同学（灰色短袖） |
| s3 | 周南 | Female_Adult_11 | 同学（棕色毛衣，偏东亚面貌） |
| s4 | 陈禾 | Male_Adult_09 | 同学（深色 T 恤、马尾） |
| s5 | 马言 | Male_Adult_10 | 同学（红色运动套装） |
| g1–g3 | 嘉宾 | Business_Male_01、Business_Female_02、Business_Male_07 | 路演嘉宾 |
| teacher | 试讲老师 | Business_Female_03 | 站立讲解 |

其中周南、陈禾、马言和老师更接近东亚面貌；林秋、许青在库中可选的年轻女性里更偏欧美面孔。校服改色尚未做。

### 历史构建方法（非当前发布流程）

需要本机安装 Blender 4.x，并准备一份 Rocketbox 资源的稀疏拷贝（至少含上述九个角色的 `Export/*.fbx` 与 `Textures/`，以及 `Assets/Animations` 里对应的官方动作）。然后：

```bash
export ROCKETBOX_REPO=/path/to/Microsoft-Rocketbox
blender -b -P scripts/characters/build_rocketbox.py -- --out assets/characters
```

可加 `--one s5` 只导出单个角色做检查。

会导出（Draco 压缩，主贴图约 1024px WebP，合计约 9.3 MB，预算不超过约 25 MB）：

- `students.glb`：五位同学，含坐姿闲置、举手、点头、困惑、走神、发言，以及齐读、站起来读。
- `guests.glb`：三位路演嘉宾。
- `teacher.glb`：试讲老师（站立闲置、讲解、手势、走步、转向黑板）。
- `classroom.glb`、`podium.glb`：简易教室和讲台。

动作以 NLA 轨道导出，名字是 `{id}_{clip}`，方便 three.js 按角色前缀拆开。

重定向方法：把源动作骨骼的世界位置拷到角色骨骼，再用 Damped Track（Y 轴指向源骨末端）和 Locked Track（锁 Y、跟源骨局部 X）保住扭转，避免袖子拧皱。然后做视觉关键帧烘焙。导出前把角色脚底落到地面。

历史 MakeHuman 构建脚本路径为 `scripts/characters/build_cast.py`；该管线已退役，不再用于发布资源。

### 当时的限制（历史）

- 这是中后期 2000 年代到 2010 年代游戏风格的写实人物，不是影视级扫描。头发是卡片模型，近看会有棱角，部分刘海在侧光下更明显。
- 库中年轻、偏东亚的女同学选择有限，林秋和许青更偏欧美面孔。儿童资产偏小，没有用作中学生。
- 衣服还不是校服；棕色毛衣短裙（周南）在教室场景里也偏日常。
- 老师站在讲台时，体态镜的骨架和视线叠加来自演示用的 2D 姿态轨迹，与 3D 网格不会完全贴合。介绍页和 README 里的 16 秒演示（`docs/images/demo-3d.mp4`，另有 webp / gif）也是这样叠加的。
- 五个 glTF 合计约 9.3 MB，按需加载，目标不超过约 25 MB。

这些限制写在这里，是为了避免把未完成的效果说成已经拍完。页面在 WebGL 不可用时会退回插画，不阻挡使用。
