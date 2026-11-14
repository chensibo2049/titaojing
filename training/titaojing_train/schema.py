"""数据格式：与 docs/TRACE_FORMAT.md 保持一致。"""
from __future__ import annotations

TRACE_FORMAT = "titaojing-trace"
LABELS_FORMAT = "titaojing-labels"
FORMAT_VERSION = 1

# 需要专家标注的事件类型（时间段）。与 App 的事件名对应关系见 TRACE_FORMAT.md。
EVENT_TYPES = [
    "sway",               # 左右晃动（App: sway）
    "slouch",             # 含胸 / 低头弓背（App: slouch）
    "gaze_down",          # 视线落在讲稿上（App: gaze）
    "board_no_lookback",  # 写板书时长时间不回视学生（App: board）
]

# 整体评分维度（1–5 分），参照教师资格证面试与师范生教学技能大赛常见评分要素，学院可自行细化。
RUBRIC_KEYS = ["教态", "视线交流", "板书", "语言表达", "总体"]

# 姿态 33 点中用于特征的上半身关键点（MediaPipe Pose 编号）
UPPER_BODY = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24]
L_SHOULDER, R_SHOULDER, L_HIP, R_HIP, NOSE = 11, 12, 23, 24, 0


class SchemaError(ValueError):
    pass


def validate_trace(tr: dict) -> None:
    if tr.get("format") != TRACE_FORMAT:
        raise SchemaError(f"不是轨迹文件（format={tr.get('format')!r}）")
    if tr.get("formatVersion") != FORMAT_VERSION:
        raise SchemaError(f"不支持的 formatVersion={tr.get('formatVersion')}")
    frames = tr.get("frames")
    if not isinstance(frames, list) or not frames:
        raise SchemaError("frames 为空")
    last = -1.0
    for i, f in enumerate(frames):
        t = f.get("t")
        if not isinstance(t, (int, float)) or t < last:
            raise SchemaError(f"frames[{i}].t 必须单调递增")
        last = t
        pose = f.get("pose")
        if pose is not None and len(pose) != 33:
            raise SchemaError(f"frames[{i}].pose 应有 33 个点")


def validate_labels(lb: dict) -> None:
    if lb.get("format") != LABELS_FORMAT:
        raise SchemaError(f"不是标注文件（format={lb.get('format')!r}）")
    for s in lb.get("segments", []):
        if s.get("type") not in EVENT_TYPES:
            raise SchemaError(f"未知事件类型 {s.get('type')!r}")
        if not (0 <= s["start"] <= s["end"]):
            raise SchemaError(f"时间段不合法：{s}")
    for k, v in (lb.get("rubric") or {}).items():
        if k not in RUBRIC_KEYS or not (1 <= v <= 5):
            raise SchemaError(f"评分项不合法：{k}={v}")
