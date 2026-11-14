#!/usr/bin/env python3
"""评分员一致性：python agreement.py [数据目录] [评分员A] [评分员B]
- 每类事件：帧级 Cohen's kappa、以 A 为参照的事件级 F1
- 整体评分：二次加权 kappa
正式标注前，先用 20–30 条样本做试标，kappa < 0.6 的类别要回去修改标注说明再标。"""
import sys
import numpy as np
from titaojing_train.loader import frame_targets, load_dataset
from titaojing_train.metrics import cohen_kappa, event_prf, segments_from_mask, weighted_kappa
from titaojing_train.schema import EVENT_TYPES, RUBRIC_KEYS

d = sys.argv[1] if len(sys.argv) > 1 else "data/synthetic"
A = sys.argv[2] if len(sys.argv) > 2 else "R01"
B = sys.argv[3] if len(sys.argv) > 3 else "R02"
ds = [s for s in load_dataset(d) if A in s.labels and B in s.labels]
if not ds:
    sys.exit("没有同时有两位评分员标注的轨迹")
if any(s.synthetic for s in ds):
    print("⚠ 含合成数据：以下数字只说明脚本能运行，没有实际意义。\n")
print(f"{len(ds)} 条轨迹，评分员 {A} vs {B}")
for k, name in enumerate(EVENT_TYPES):
    ya = np.concatenate([frame_targets(s, A)[:, k] for s in ds])
    yb = np.concatenate([frame_targets(s, B)[:, k] for s in ds])
    f1s = [event_prf(segments_from_mask(s.t, frame_targets(s, B)[:, k] > 0), segments_from_mask(s.t, frame_targets(s, A)[:, k] > 0))["f1"] for s in ds]
    print(f"  {name:<18} 帧级 kappa={cohen_kappa(ya, yb):.3f}   事件级 F1={np.mean(f1s):.3f}")
for key in RUBRIC_KEYS:
    a = [s.labels[A]["rubric"].get(key) for s in ds]
    b = [s.labels[B]["rubric"].get(key) for s in ds]
    pairs = [(x, y) for x, y in zip(a, b) if x and y]
    if pairs:
        print(f"  评分「{key}」 加权 kappa={weighted_kappa(*zip(*pairs)):.3f}")
