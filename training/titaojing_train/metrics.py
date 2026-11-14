"""评测：事件级 P/R/F1（时间段重叠匹配）、帧级 Cohen's kappa、评分的加权 kappa。"""
from __future__ import annotations

import numpy as np


def segments_from_mask(t: np.ndarray, mask: np.ndarray, min_len: float = 0.0):
    segs, start = [], None
    for i, m in enumerate(mask):
        if m and start is None:
            start = t[i]
        if (not m or i == len(mask) - 1) and start is not None:
            end = t[i] if m else t[i - 1]
            if end - start >= min_len:
                segs.append((float(start), float(end)))
            start = None
    return segs


def event_prf(pred, gold, tol: float = 0.5):
    """一个预测事件与一个标注事件（容差 tol 秒内）有重叠即算命中；一对一贪心匹配。"""
    used, tp = set(), 0
    for ps, pe in pred:
        for j, (gs, ge) in enumerate(gold):
            if j not in used and ps <= ge + tol and pe >= gs - tol:
                used.add(j)
                tp += 1
                break
    fp, fn = len(pred) - tp, len(gold) - tp
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return {"tp": tp, "fp": fp, "fn": fn, "precision": p, "recall": r, "f1": f}


def cohen_kappa(a, b) -> float:
    a, b = np.asarray(a).astype(int), np.asarray(b).astype(int)
    cats = np.union1d(a, b)
    po = float(np.mean(a == b))
    pe = sum(float(np.mean(a == c)) * float(np.mean(b == c)) for c in cats)
    return 1.0 if pe == 1 else (po - pe) / (1 - pe)


def weighted_kappa(a, b, k: int = 5) -> float:
    """二次加权 kappa，用于 1–5 分评分的一致性。"""
    a, b = np.asarray(a, int) - 1, np.asarray(b, int) - 1
    O = np.zeros((k, k))
    for x, y in zip(a, b):
        O[x, y] += 1
    W = np.array([[(i - j) ** 2 / (k - 1) ** 2 for j in range(k)] for i in range(k)])
    E = np.outer(O.sum(1), O.sum(0)) / max(1, O.sum())
    den = (W * E).sum()
    return 1.0 if den == 0 else 1 - (W * O).sum() / den
