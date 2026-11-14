# 轨迹与标注格式（v1）

体态镜在调试模式（`?debug=1`）下可以导出**轨迹**：一次试讲中每一帧的关键点、视线角度、规则判断和事件。它同时用于 bug 复现和训练数据。专家对轨迹的人工判断保存为**标注**文件。两种文件都是 UTF-8 JSON。

> 轨迹**不含视频、音频、图片**。但关键点序列仍然是个人的行为数据（体型、动作习惯），收集用于研究时必须按 [`TRAINING.md`](TRAINING.md)「数据伦理」获得知情同意。

## 1. 轨迹 `*.trace.json`（format = `titaojing-trace`）

```jsonc
{
  "format": "titaojing-trace",
  "formatVersion": 1,
  "id": "4b0c…",                       // 随机 UUID，标注文件用它关联
  "app": { "name": "沉思波 · 体态镜", "version": "1.0.1", "buildId": "1.0.1-xxxxxxxx" },
  "createdAt": "2026-11-14T10:00:00.000Z",
  "startedAt": "2026-11-14T09:58:00.000Z",
  "source": "camera",                  // camera | demo（演示合成数据）| synthetic（训练脚本生成）
  "synthetic": false,                  // true = 合成数据，不能当真实数据用
  "device": { "ua": "…", "ios": false, "android": false, "wechat": false, "screen": [1440, 900, 2] },
  "vision": { "delegate": { "pose": "GPU", "face": "GPU" }, "loadMs": 513,
              "timings": { "downloadMs": 170, "poseMs": 221, "faceMs": 122, "simd": true }, "error": null },
  "settings": { "boardSide": "right", "sens": { "posture": "mid", "gaze": "mid", "filler": "mid", "board": "mid" },
                "mirror": true, "speechLang": "zh-CN" },
  "meta": { "kind": "camera", "camera": "FaceTime HD Camera", "mic": true, "aspect": 1.777 },
  "poseLandmarkOrder": "MediaPipe Pose 33（BlazePose）…",
  "faceSubset": [1, 4, 10, 33, 133, 152, 263, 362, 468, 473],
  "frames": [
    {
      "t": 3.2133,                     // 秒，从试讲开始计；单调递增；帧率随设备（通常 10–30 fps）
      "ms": 18.4,                      // 本帧模型推理耗时（ms），演示数据为 null
      "pose": [[0.5123, 0.2311, -0.31, 0.998], …],   // 33 个点 [x, y, z, visibility]，没检测到人时为 null；单个点缺失为 null
      "face": [[1, 0.51, 0.22, -0.02], …],            // faceSubset 里的点 [编号, x, y, z]；没检测到为 null
      "gaze": { "label": "class", "yaw": 0.03, "pitch": 0.05 },
      "flags": ["sway"],               // 本帧规则标记：sway | slouch | hip | folded | out
      "onBoard": false                 // 本帧是否判定为面向板书
    }
  ],
  "fillers": [{ "t": 12.4, "word": "然后" }],          // 口头禅（规则从听写中识别）
  "transcriptsIncluded": false,                        // 默认 false：不写入原始听写文字
  "transcripts": [{ "t": 12.1, "text": "然后我们来看", "final": true }],
  "speechLog": [{ "t": 0.4, "state": "listening", "detail": "restarts=0" }],
  "events": [{ "t": 8.53, "type": "gaze", "label": "视线落下" }],   // App 规则触发的事件
  "diagnosis": { "counts": { … } },
  "stats": { "avgFps": 24.1, "poseSeen": 0.97, … }
}
```

坐标约定：

- `x`、`y` 是**画面归一化坐标**（0–1，左上角为原点），已经按画面镜像处理，和用户看到的预览一致；`z` 是 MediaPipe 的相对深度，只能参考。
- `visibility` 是 MediaPipe 给出的该点可见置信度（0–1）。
- 视线 `yaw`/`pitch` 是体态镜根据面部几何算出的**无量纲**指标（不是角度）：`pitch` 越大越低头，`yaw` 符号与板书区方向有关。

数值保留 4 位小数。一次 3 分钟试讲约 1–3 MB。

## 2. 标注 `*.labels.json`（format = `titaojing-labels`）

一位评分员对一条轨迹一份文件，建议命名 `<轨迹id>.<评分员>.labels.json`。

```jsonc
{
  "format": "titaojing-labels",
  "formatVersion": 1,
  "traceId": "4b0c…",
  "rater": "R01",                  // 评分员编号（不要写真名）
  "synthetic": false,
  "segments": [                    // 事件时间段（秒）
    { "type": "gaze_down", "start": 12.3, "end": 14.0 },
    { "type": "sway", "start": 30.0, "end": 34.5 }
  ],
  "rubric": { "教态": 4, "视线交流": 3, "板书": 4, "语言表达": 3, "总体": 4 },   // 1–5 分
  "notes": "可选：评分员备注"
}
```

事件类型与 App 规则的对应：

| 标注 `type` | 含义（标注说明里要给出正例 / 反例视频） | App 事件 |
|---|---|---|
| `sway` | 无目的的左右来回晃动（有目的的走动不算） | `sway` 晃动 |
| `slouch` | 含胸、弓背、低头缩肩 | `slouch` 含胸 |
| `gaze_down` | 视线落在讲稿 / 讲台上超过约 1 秒 | `gaze` 视线落下 |
| `board_no_lookback` | 写板书期间长时间（约 5 秒以上）不回头看学生 | `board` 写板未回视 |

（口头禅以听写文字为准，后续会另定转写 + 标注格式。）

## 3. 版本规则

- 新增字段不升 `formatVersion`，读取方忽略不认识的字段；
- 改变已有字段含义或删除字段时 `formatVersion` +1，并在本文件记录迁移方法。
- 校验：`python training/validate.py 文件或目录`。
