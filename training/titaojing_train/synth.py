"""⚠ 合成数据生成器（SYNTHETIC）：只用于验证脚本能跑通，不代表任何真实师范生的数据，
不能用来得出任何关于教学表现的结论，也不能用来"训练出可用的模型"。

模拟一个站立讲课的人：随机插入晃动、含胸、低头看稿、转身写板书（是否回视）等片段，
生成 titaojing-trace v1 轨迹和两位"虚拟评分员"的 titaojing-labels v1 标注（第二位带边界抖动和漏标）。
"""
from __future__ import annotations

import json
import os

import numpy as np

from .schema import FORMAT_VERSION, LABELS_FORMAT, TRACE_FORMAT

FPS = 15


def _episodes(rng, dur, kind, n_range, len_range):
    eps = []
    for _ in range(rng.integers(*n_range)):
        L = rng.uniform(*len_range)
        s = rng.uniform(2, max(2.5, dur - L - 1))
        if all(s > e["end"] + 1.5 or s + L < e["start"] - 1.5 for e in eps):
            eps.append({"type": kind, "start": round(s, 2), "end": round(s + L, 2)})
    return eps


def make_trace(rng, idx: int, dur: float):
    eps = (_episodes(rng, dur, "sway", (1, 4), (2.5, 6))
           + _episodes(rng, dur, "slouch", (0, 3), (2, 5))
           + _episodes(rng, dur, "gaze_down", (1, 5), (1.5, 4))
           + _episodes(rng, dur, "board_no_lookback", (0, 3), (5, 9)))
    # 另加几段"写板书但会回视"的负例
    good_board = _episodes(rng, dur, "board_ok", (0, 3), (4, 8))
    active = lambda t, k: any(e["type"] == k and e["start"] <= t <= e["end"] for e in eps + good_board)
    base_x = rng.uniform(0.45, 0.55)
    sw = rng.uniform(0.18, 0.24)  # 肩宽（画面归一化）
    noise = rng.uniform(0.002, 0.006)
    frames = []
    for i in range(int(dur * FPS)):
        t = i / FPS
        hip_x = base_x + 0.01 * np.sin(t * 0.3)
        if active(t, "sway"):
            hip_x += 0.035 * np.sin(2 * np.pi * 0.9 * t)
        slouch = active(t, "slouch")
        down = active(t, "gaze_down")
        board = active(t, "board_no_lookback") or active(t, "board_ok")
        look_back = active(t, "board_ok") and (int(t * 2) % 5 == 0)  # 写板时每隔一会回头
        sh_y = 0.36 + (0.03 if slouch else 0.0)
        hip_y = 0.66
        yaw = 0.0
        pitch = 0.32 if down else (0.12 if slouch else -0.02)
        if board and not look_back:
            yaw, pitch = 0.55, 0.0
        yaw += rng.normal(0, 0.04)
        pitch += rng.normal(0, 0.03)
        pose = [None] * 33
        def put(k, x, y, v=0.95):
            pose[k] = [round(x + rng.normal(0, noise), 4), round(y + rng.normal(0, noise), 4), 0.0, round(min(1.0, v + rng.normal(0, 0.02)), 4)]
        cx = hip_x
        put(11, cx - sw / 2 + (0.02 if slouch else 0), sh_y); put(12, cx + sw / 2 - (0.02 if slouch else 0), sh_y)
        put(23, cx - sw * 0.35, hip_y); put(24, cx + sw * 0.35, hip_y)
        put(0, cx + yaw * 0.04, sh_y - 0.12 + (0.04 if slouch or down else 0))
        put(2, cx - 0.02 + yaw * 0.03, sh_y - 0.14); put(5, cx + 0.02 + yaw * 0.03, sh_y - 0.14)
        put(7, cx - 0.04, sh_y - 0.13, 0.8); put(8, cx + 0.04, sh_y - 0.13, 0.8)
        put(13, cx - sw * 0.6, sh_y + 0.13); put(14, cx + sw * 0.6 + (0.1 if board else 0), sh_y + (0.0 if board else 0.13))
        put(15, cx - sw * 0.45, sh_y + 0.24); put(16, cx + sw * 0.5 + (0.18 if board else 0), sh_y + (-0.12 if board else 0.24))
        label = "board" if (board and not look_back) else ("notes" if pitch > 0.2 else "class")
        frames.append({"t": round(t, 4), "ms": None, "pose": pose, "face": None,
                       "gaze": {"label": label, "yaw": round(yaw, 4), "pitch": round(pitch, 4)},
                       "flags": [], "onBoard": bool(board and not look_back)})
    tid = f"synthetic-{idx:03d}"
    trace = {
        "format": TRACE_FORMAT, "formatVersion": FORMAT_VERSION, "id": tid, "synthetic": True,
        "_警告": "SYNTHETIC 合成数据：仅用于测试脚本，不代表真实师范生。",
        "app": {"name": "synthetic-generator", "version": "0"}, "source": "synthetic",
        "meta": {"speaker": f"S{idx % 12:02d}"}, "frames": frames, "fillers": [], "transcripts": [],
        "transcriptsIncluded": False, "events": [],
    }
    return trace, eps


def make_labels(rng, tid, eps, rater, jitter=0.0, miss=0.0):
    segs = []
    for e in eps:
        if rng.random() < miss:
            continue
        s = max(0.0, e["start"] + rng.normal(0, jitter))
        en = max(s + 0.3, e["end"] + rng.normal(0, jitter))
        segs.append({"type": e["type"], "start": round(s, 2), "end": round(en, 2)})
    n_bad = sum(1 for e in eps if e["type"] != "board_ok")
    score = int(np.clip(5 - n_bad // 3 + rng.integers(-1, 1), 1, 5))
    return {"format": LABELS_FORMAT, "formatVersion": FORMAT_VERSION, "traceId": tid, "rater": rater, "synthetic": True,
            "segments": segs, "rubric": {"教态": score, "视线交流": score, "板书": score, "语言表达": 3, "总体": score}}


def generate(out_dir: str, n: int = 36, seed: int = 7):
    rng = np.random.default_rng(seed)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "README.txt"), "w", encoding="utf-8") as f:
        f.write("⚠ 本目录是脚本生成的合成数据（SYNTHETIC），只用于测试训练脚手架能否运行，不代表任何真实的人。\n")
    for i in range(n):
        tr, eps = make_trace(rng, i, float(rng.uniform(50, 80)))
        real_eps = list(eps)  # board_ok 不在 eps 里（是负例），只出现在轨迹中
        json.dump(tr, open(os.path.join(out_dir, f"{tr['id']}.trace.json"), "w"), ensure_ascii=False)
        json.dump(make_labels(rng, tr["id"], real_eps, "R01", jitter=0.15), open(os.path.join(out_dir, f"{tr['id']}.R01.labels.json"), "w"), ensure_ascii=False)
        json.dump(make_labels(rng, tr["id"], real_eps, "R02", jitter=0.5, miss=0.12), open(os.path.join(out_dir, f"{tr['id']}.R02.labels.json"), "w"), ensure_ascii=False)
    return out_dir
