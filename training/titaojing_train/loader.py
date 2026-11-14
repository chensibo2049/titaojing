"""读取轨迹与标注，转成固定帧率的特征序列和滑动窗口。"""
from __future__ import annotations

import glob
import json
import os
from dataclasses import dataclass, field

import numpy as np

from .schema import (EVENT_TYPES, L_HIP, L_SHOULDER, R_HIP, R_SHOULDER, UPPER_BODY,
                     validate_labels, validate_trace)

FPS = 15.0
FEATURE_NAMES = (
    [f"p{i}_{c}" for i in UPPER_BODY for c in ("x", "y", "v")]
    + ["gaze_yaw", "gaze_pitch", "on_board", "pose_present", "mid_hip_x", "mid_hip_vx"]
)
N_FEATURES = len(FEATURE_NAMES)


@dataclass
class Sample:
    trace_id: str
    speaker: str
    synthetic: bool
    t: np.ndarray                 # (T,) 秒
    x: np.ndarray                 # (T, N_FEATURES)
    raw_pitch: np.ndarray         # (T,) 规则基线要用的原始量
    raw_hip_x: np.ndarray         # (T,)
    labels: dict = field(default_factory=dict)  # rater -> {"segments": [...], "rubric": {...}}


def load_json(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def frame_features(fr: dict) -> tuple[np.ndarray, float, float]:
    out = np.zeros(N_FEATURES, dtype=np.float32)
    pose = fr.get("pose")
    gaze = fr.get("gaze") or {}
    yaw = float(gaze.get("yaw") or 0.0)
    pitch = float(gaze.get("pitch") or 0.0)
    hip_x = np.nan
    if pose and pose[L_SHOULDER] and pose[R_SHOULDER]:
        ls, rs = np.array(pose[L_SHOULDER][:2]), np.array(pose[R_SHOULDER][:2])
        center = (ls + rs) / 2
        scale = max(1e-3, float(np.linalg.norm(ls - rs)))
        for k, i in enumerate(UPPER_BODY):
            p = pose[i]
            if p:
                out[3 * k] = (p[0] - center[0]) / scale
                out[3 * k + 1] = (p[1] - center[1]) / scale
                out[3 * k + 2] = p[3]
        if pose[L_HIP] and pose[R_HIP]:
            hip_x = (pose[L_HIP][0] + pose[R_HIP][0]) / 2
        out[N_FEATURES - 3] = 1.0
    base = 3 * len(UPPER_BODY)
    out[base] = yaw
    out[base + 1] = pitch
    out[base + 2] = 1.0 if fr.get("onBoard") else 0.0
    out[N_FEATURES - 2] = 0.0 if np.isnan(hip_x) else hip_x
    return out, pitch, hip_x


def resample(trace: dict, fps: float = FPS):
    frames = trace["frames"]
    ts = np.array([f["t"] for f in frames], dtype=np.float64)
    grid = np.arange(0.0, ts[-1] + 1e-9, 1.0 / fps)
    idx = np.clip(np.searchsorted(ts, grid), 0, len(ts) - 1)
    prev = np.clip(idx - 1, 0, len(ts) - 1)
    idx = np.where(np.abs(ts[prev] - grid) < np.abs(ts[idx] - grid), prev, idx)  # 最近帧
    feats, pitch, hip = zip(*(frame_features(frames[i]) for i in idx))
    x = np.stack(feats)
    hip = np.array(hip, dtype=np.float64)
    # 髋部水平速度（画面宽度/秒），晃动主要靠它
    h = np.nan_to_num(hip, nan=np.nanmean(hip) if np.isfinite(hip).any() else 0.0)
    x[:, N_FEATURES - 1] = np.gradient(h) * fps if len(h) > 1 else 0.0
    return grid, x, np.array(pitch), hip


def load_dataset(trace_dir: str, label_dir: str | None = None) -> list[Sample]:
    label_dir = label_dir or trace_dir
    labels_by_trace: dict[str, dict] = {}
    for p in sorted(glob.glob(os.path.join(label_dir, "*.labels.json"))):
        lb = load_json(p)
        validate_labels(lb)
        labels_by_trace.setdefault(lb["traceId"], {})[lb.get("rater", "R?")] = lb
    out = []
    for p in sorted(glob.glob(os.path.join(trace_dir, "*.trace.json"))):
        tr = load_json(p)
        validate_trace(tr)
        tid = tr.get("id") or os.path.basename(p).split(".")[0]
        t, x, pitch, hip = resample(tr)
        out.append(Sample(tid, (tr.get("meta") or {}).get("speaker", tid), bool(tr.get("synthetic")), t, x, pitch, hip,
                          labels_by_trace.get(tid, {})))
    return out


def frame_targets(sample: Sample, rater: str) -> np.ndarray:
    """(T, len(EVENT_TYPES)) 0/1：该帧是否落在某类标注时间段内。"""
    y = np.zeros((len(sample.t), len(EVENT_TYPES)), dtype=np.float32)
    lb = sample.labels.get(rater)
    if not lb:
        return y
    for s in lb["segments"]:
        k = EVENT_TYPES.index(s["type"])
        y[(sample.t >= s["start"]) & (sample.t <= s["end"]), k] = 1.0
    return y


def windows(sample: Sample, rater: str, win_s: float = 2.0, hop_s: float = 0.5):
    """滑动窗口：X (N, W, F)，Y (N, K) —— 以窗口中心帧的标注为准。"""
    W, H = int(win_s * FPS), int(hop_s * FPS)
    y = frame_targets(sample, rater)
    xs, ys = [], []
    for s in range(0, len(sample.t) - W + 1, H):
        xs.append(sample.x[s:s + W])
        ys.append(y[s + W // 2])
    if not xs:
        return np.zeros((0, W, N_FEATURES), np.float32), np.zeros((0, len(EVENT_TYPES)), np.float32)
    return np.stack(xs).astype(np.float32), np.stack(ys).astype(np.float32)
