#!/usr/bin/env python3
"""生成 ⚠合成⚠ 示例数据：python make_synthetic.py [输出目录] [数量]"""
import sys
from titaojing_train.synth import generate

out = sys.argv[1] if len(sys.argv) > 1 else "data/synthetic"
n = int(sys.argv[2]) if len(sys.argv) > 2 else 36
generate(out, n)
print(f"已生成 {n} 条合成轨迹 + 两位虚拟评分员标注 → {out}/（SYNTHETIC，仅供测试脚本）")
