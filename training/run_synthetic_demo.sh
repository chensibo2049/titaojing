#!/usr/bin/env bash
# 一键跑通训练脚手架（⚠ 合成数据，仅验证流程）：bash run_synthetic_demo.sh
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-python3}"
"$PY" make_synthetic.py data/synthetic 36
"$PY" validate.py data/synthetic
"$PY" agreement.py data/synthetic R01 R02
mkdir -p out
"$PY" calibrate.py data/synthetic --out out/calibration.json
if "$PY" -c "import torch" 2>/dev/null; then
  (cd out && "$PY" ../train_gru.py ../data/synthetic --epochs 12 --onnx tiny_gru.onnx)
else
  echo "（未安装 PyTorch，跳过 GRU 基线：pip install torch）"
fi
