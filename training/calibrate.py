#!/usr/bin/env python3
"""基线：用专家标注校准 App 规则的阈值（不训练模型）。
python calibrate.py [数据目录] [--rater R01] [--out calibration.json]

目前校准两条规则（其余规则同理扩展）：
  gaze_down：视线 pitch > θ 持续 ≥ d 秒 → 一次「视线落下」（App 默认 θ=0.20, d=1.15）
  sway     ：2.4 秒窗口内髋部中点水平摆幅 > θ 持续 ≥ d 秒 → 一次「晃动」（App 默认 θ=0.035, d=0.85）
按说话人划分训练 / 验证，在训练集上网格搜索事件级 F1 最高的 (θ, d)，在验证集上报告，并和 App 默认值比较。"""
import argparse, json, sys
import numpy as np
from titaojing_train.loader import FPS, frame_targets, load_dataset
from titaojing_train.metrics import event_prf, segments_from_mask
from titaojing_train.schema import EVENT_TYPES

ap = argparse.ArgumentParser()
ap.add_argument("data", nargs="?", default="data/synthetic")
ap.add_argument("--rater", default="R01")
ap.add_argument("--out", default="calibration.json")
args = ap.parse_args()

ds = [s for s in load_dataset(args.data) if args.rater in s.labels]
if not ds:
    sys.exit("没有标注数据")
synthetic = any(s.synthetic for s in ds)
speakers = sorted({s.speaker for s in ds})
val_spk = set(speakers[:: max(2, len(speakers) // 3)][: max(1, len(speakers) // 4)])
train = [s for s in ds if s.speaker not in val_spk]
val = [s for s in ds if s.speaker in val_spk]


def sway_signal(s):
    w = int(2.4 * FPS)
    x = np.nan_to_num(s.raw_hip_x, nan=np.nanmean(s.raw_hip_x))
    amp = np.zeros_like(x)
    for i in range(len(x)):
        seg = x[max(0, i - w + 1): i + 1]
        amp[i] = seg.max() - seg.min()
    return amp


RULES = {
    "gaze_down": (lambda s: s.raw_pitch, np.round(np.arange(0.08, 0.42, 0.02), 3), [0.5, 0.8, 1.0, 1.15, 1.5, 2.0], (0.20, 1.15)),
    "sway": (sway_signal, np.round(np.arange(0.01, 0.09, 0.005), 4), [0.3, 0.5, 0.85, 1.2, 1.6], (0.035, 0.85)),
}


def score(samples, rule, th, d):
    sig, k = RULES[rule][0], EVENT_TYPES.index(rule)
    agg = {"tp": 0, "fp": 0, "fn": 0}
    for s in samples:
        pred = segments_from_mask(s.t, sig(s) > th, min_len=d)
        gold = segments_from_mask(s.t, frame_targets(s, args.rater)[:, k] > 0)
        r = event_prf(pred, gold)
        for key in agg:
            agg[key] += r[key]
    p = agg["tp"] / max(1, agg["tp"] + agg["fp"])
    r = agg["tp"] / max(1, agg["tp"] + agg["fn"])
    return {"precision": round(p, 3), "recall": round(r, 3), "f1": round(2 * p * r / (p + r) if p + r else 0.0, 3)}


if synthetic:
    print("⚠ 合成数据：结果只说明脚本能运行，不能用于修改 App 的真实阈值。\n")
print(f"训练 {len(train)} 条 / 验证 {len(val)} 条（按说话人划分，验证说话人：{sorted(val_spk)}）")
result = {"synthetic": synthetic, "rater": args.rater, "rules": {}}
for rule, (_, ths, ds_, default) in RULES.items():
    best = max(((th, d) for th in ths for d in ds_), key=lambda p: score(train, rule, *p)["f1"])
    r_best, r_def = score(val, rule, *best), score(val, rule, *default)
    result["rules"][rule] = {"threshold": float(best[0]), "minDurationSec": best[1], "val": r_best,
                             "appDefault": {"threshold": default[0], "minDurationSec": default[1], "val": r_def}}
    print(f"  {rule:<10} 校准 θ={best[0]:<6} d={best[1]:<5} 验证 F1={r_best['f1']:.3f}   | App 默认 θ={default[0]} d={default[1]} 验证 F1={r_def['f1']:.3f}")
json.dump(result, open(args.out, "w"), ensure_ascii=False, indent=2)
print(f"→ {args.out}")
