#!/usr/bin/env python3
"""小型时序基线：2 秒关键点窗口 → GRU → 4 类事件（多标签）。需要 PyTorch（CPU 即可）。
python train_gru.py [数据目录] [--epochs 12] [--rater R01] [--onnx model.onnx]

这是"脚手架"：用来验证数据管线、评测口径和导出流程。真实效果取决于真实、经过同意的标注数据。"""
import argparse, json, sys
import numpy as np

try:
    import torch
    import torch.nn as nn
except ImportError:
    sys.exit("需要 PyTorch：pip install torch（CPU 版即可），或先只跑 calibrate.py")

from titaojing_train.loader import FPS, N_FEATURES, load_dataset, windows, frame_targets
from titaojing_train.metrics import event_prf, segments_from_mask
from titaojing_train.schema import EVENT_TYPES

ap = argparse.ArgumentParser()
ap.add_argument("data", nargs="?", default="data/synthetic")
ap.add_argument("--rater", default="R01")
ap.add_argument("--epochs", type=int, default=12)
ap.add_argument("--hidden", type=int, default=32)
ap.add_argument("--onnx", default="")
ap.add_argument("--seed", type=int, default=0)
args = ap.parse_args()
torch.manual_seed(args.seed)
np.random.seed(args.seed)

ds = [s for s in load_dataset(args.data) if args.rater in s.labels]
if not ds:
    sys.exit("没有标注数据")
synthetic = any(s.synthetic for s in ds)
speakers = sorted({s.speaker for s in ds})
val_spk = set(speakers[:: max(2, len(speakers) // 3)][: max(1, len(speakers) // 4)])
tr = [s for s in ds if s.speaker not in val_spk]
va = [s for s in ds if s.speaker in val_spk]


def stack(samples):
    xs, ys = zip(*(windows(s, args.rater) for s in samples))
    return torch.tensor(np.concatenate(xs)), torch.tensor(np.concatenate(ys))


Xtr, Ytr = stack(tr)
Xva, Yva = stack(va)
mu, sd = Xtr.reshape(-1, N_FEATURES).mean(0), Xtr.reshape(-1, N_FEATURES).std(0) + 1e-4


class TinyGRU(nn.Module):
    def __init__(self, f, h, k):
        super().__init__()
        self.register_buffer("mu", mu.clone())
        self.register_buffer("sd", sd.clone())
        self.gru = nn.GRU(f, h, batch_first=True)
        self.head = nn.Linear(h, k)

    def forward(self, x):          # x: (B, T, F) 原始特征，归一化在模型内部完成，方便浏览器端直接喂
        _, hN = self.gru((x - self.mu) / self.sd)
        return self.head(hN[-1])   # logits (B, K)


model = TinyGRU(N_FEATURES, args.hidden, len(EVENT_TYPES))
pos = Ytr.mean(0).clamp(0.02, 0.98)
lossf = nn.BCEWithLogitsLoss(pos_weight=(1 - pos) / pos)
opt = torch.optim.Adam(model.parameters(), lr=3e-3)
if synthetic:
    print("⚠ 合成数据：以下指标只说明训练管线能跑通，没有任何实际意义。\n")
print(f"训练窗口 {len(Xtr)} / 验证窗口 {len(Xva)}；参数量 {sum(p.numel() for p in model.parameters())}")
for ep in range(args.epochs):
    model.train()
    perm = torch.randperm(len(Xtr))
    tot = 0.0
    for i in range(0, len(perm), 128):
        b = perm[i:i + 128]
        opt.zero_grad()
        loss = lossf(model(Xtr[b]), Ytr[b])
        loss.backward()
        opt.step()
        tot += loss.item() * len(b)
    model.eval()
    with torch.no_grad():
        pv = torch.sigmoid(model(Xva)) > 0.5
    f1 = []
    for k in range(len(EVENT_TYPES)):
        tp = (pv[:, k] & (Yva[:, k] > 0)).sum().item(); fp = (pv[:, k] & (Yva[:, k] == 0)).sum().item(); fn = (~pv[:, k] & (Yva[:, k] > 0)).sum().item()
        f1.append(2 * tp / max(1, 2 * tp + fp + fn))
    print(f"  epoch {ep + 1:>2}  loss {tot / len(Xtr):.4f}  验证窗口 F1 " + "  ".join(f"{n}={v:.2f}" for n, v in zip(EVENT_TYPES, f1)))

# 事件级评测：逐帧滑窗推理（窗口中心），连续段即事件
W, report = int(2.0 * FPS), {}
model.eval()
for k, name in enumerate(EVENT_TYPES):
    agg = {"tp": 0, "fp": 0, "fn": 0}
    for s in va:
        X = np.stack([s.x[i:i + W] for i in range(0, len(s.t) - W + 1)]).astype(np.float32)
        with torch.no_grad():
            p = torch.sigmoid(model(torch.tensor(X)))[:, k].numpy() > 0.5
        mask = np.zeros(len(s.t), bool); mask[W // 2: W // 2 + len(p)] = p
        r = event_prf(segments_from_mask(s.t, mask, 0.4), segments_from_mask(s.t, frame_targets(s, args.rater)[:, k] > 0))
        for key in agg:
            agg[key] += r[key]
    P = agg["tp"] / max(1, agg["tp"] + agg["fp"]); R = agg["tp"] / max(1, agg["tp"] + agg["fn"])
    report[name] = {"precision": round(P, 3), "recall": round(R, 3), "f1": round(2 * P * R / (P + R) if P + R else 0, 3)}
print("验证集事件级：" + "  ".join(f"{n} F1={v['f1']:.2f}" for n, v in report.items()))
torch.save({"state_dict": model.state_dict(), "features": N_FEATURES, "events": EVENT_TYPES, "synthetic": synthetic}, "tiny_gru.pt")
json.dump({"synthetic": synthetic, "event_level_val": report}, open("tiny_gru_report.json", "w"), ensure_ascii=False, indent=2)
print("→ tiny_gru.pt, tiny_gru_report.json")
if args.onnx:
    try:
        torch.onnx.export(model, torch.zeros(1, W, N_FEATURES), args.onnx, input_names=["landmarks"], output_names=["logits"],
                          dynamic_axes={"landmarks": {0: "batch"}}, opset_version=17, dynamo=False)
        print(f"→ {args.onnx}（浏览器端可用 onnxruntime-web 加载）")
    except Exception as e:  # noqa: BLE001
        print(f"ONNX 导出失败（可能需要 pip install onnx）：{e}")
