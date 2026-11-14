# 课堂人物建模管线

这一页记录我们怎样用 Blender 做「自己二改」的课堂人物。应用里的模拟课堂目前仍用原来的插画，因为衣服和坐姿还没有达到能替换插画的程度。

## 来源与许可

- 人物底模来自 [MakeHuman Plugin For Blender（MPFB）](https://static.makehumancommunity.org/mpfb.html)。程序本身是 AGPL-3.0，官方说明捆绑的 MakeHuman 资产以及导出的人物网格为 **CC0**，可以放进本仓库（Apache-2.0）再分发。
- 衣服、发型、动作是我们在 Blender 里写脚本做的二改，不是 Mixamo 资源。Adobe Mixamo 不允许把原始资源单独再分发，本仓库不收录 Mixamo 文件。
- 许可摘录见仓库根目录的 `NOTICE`。

## 怎么构建

需要本机安装 Blender 4.x（可用官方 Linux 压缩包），并把 MPFB 装进 Blender 的扩展目录。然后：

```bash
blender -b -P scripts/characters/build_cast.py -- --out /tmp/characters
```

不写 `--out` 时，默认写到 `assets/characters/`（该目录目前不随版本发布模型文件）。

会导出：

- `students.glb`：五位中学生（林秋、周南、陈禾、马言、许青），含坐姿、举手、点头、困惑、走神、发言，以及齐读、站起来读。
- `guests.glb`：三位路演嘉宾。
- `teacher.glb`：试讲老师，含站立讲解、走步、转向黑板。
- `classroom.glb`、`podium.glb`：简易教室和讲台。

动作以 NLA 轨道导出，便于在页面里按名字播放。网格使用 glTF Draco 压缩。不要把 MakeHuman 的生殖器或辅助贴图打进文件。

## 目前的限制

- 衣服是在身体网格上做的壳，再体素重网格，看起来像连体校服，腋下和坐姿处还容易露缝或穿模。
- 坐姿的骨骼轴向还在调整，目前更像蹲坐，而不是安稳坐在椅子上。
- 发型是简单的发帽，没有按发丝造型。
- 身高、体型的区分还不明显。

这些做稳以后，再考虑在模拟课堂和封面演示里用 3D 人物，并在 WebGL 弱的机器上退回插画。
