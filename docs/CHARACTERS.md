# 课堂人物建模管线

这一页记录我们怎样用 Blender 做「自己二改」的课堂人物。自 v1.5.0 起，模拟课堂、模拟路演和封面 / 一键演示在 WebGL 可用时默认使用这些 3D 人物；显卡弱、软件渲染，「流畅优先」，或在设置里选择「只用插画」时，会退回原来的插画。

## 来源与许可

- 人物底模来自 [MakeHuman Plugin For Blender（MPFB）](https://static.makehumancommunity.org/mpfb.html)。程序本身是 AGPL-3.0，官方说明捆绑的 MakeHuman 资产以及导出的人物网格为 **CC0**，可以放进本仓库（Apache-2.0）再分发。
- 皮肤、眼睛、眉毛、睫毛、牙齿、舌头、发型与衣服来自 MakeHuman Community 的 **CC0** 资产包，在 Blender 里用官方 MHCLO 代理拟合到完好的底模上（不会先删辅助顶点）。
- 课堂动作是我们在默认 MakeHuman 骨骼上写的关键帧，不是 Mixamo。Adobe Mixamo 不允许把原始资源单独再分发，本仓库不收录 Mixamo 文件。
- 许可摘录见仓库根目录的 `NOTICE`。three.js（MIT）和 Draco 解码器（Apache-2.0）只用于按需加载的 3D 画面。

## 怎么构建

需要本机安装 Blender 4.x，并把 MPFB 与 CC0 资产包装进 Blender 的用户数据目录。然后：

```bash
export BLENDER_USER_RESOURCES=/path/to/blender-user
blender -b -P scripts/characters/build_cast.py -- --out assets/characters --preview
```

不写 `--out` 时，默认写到 `assets/characters/`。`--preview` 会同时输出审查用的静帧。

会导出（Draco 压缩，贴图约 384px JPEG，合计约 13.5 MB）：

- `students.glb`：五位中学生（林秋、周南、陈禾、马言、许青），含坐姿闲置、举手、点头、困惑、走神、发言，以及齐读、站起来读。
- `guests.glb`：三位路演嘉宾。
- `teacher.glb`：试讲老师（站立讲解、手势、走步、转向黑板）。
- `classroom.glb`、`podium.glb`：简易教室和讲台。

动作以 NLA 轨道导出，名字是 `{id}_{clip}`。不要把 MakeHuman 的生殖器或辅助贴图打进文件。

坐姿用默认 rig 指向下方的肢体骨（`upperleg02` / `lowerleg02`）做髋、膝弯曲，再把根骨落到椅面高度；不要旋转成对的 01 扭转骨，也不要使用会改写 bone roll 的 BVH 导入。

## 目前的限制

- 这是风格化的写实人物，不是影视级扫描。坐姿可用，但手臂接近 A-pose（大幅度肩部旋转会撕开 MHCLO 袖子），部分裤脚在踝部会露一点缝，校色后面料有时接近同一颜色。
- 部分 T 恤上仍可见淡淡的 MakeHuman 标志，校色只能减弱，不能完全去掉。
- 老师站在讲台时，体态镜的骨架和视线叠加来自演示用的 2D 姿态轨迹，与 3D 网格不会完全贴合。
- 体型、发型已有区分，但仍是少数几种官方发型代理。

这些限制写在这里，是为了避免把未完成的效果说成已经拍完。页面在 WebGL 不可用时会退回插画，不阻挡使用。
