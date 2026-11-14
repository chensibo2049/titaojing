#!/usr/bin/env python3
"""校验轨迹 / 标注文件格式：python validate.py 文件或目录 ..."""
import glob, os, sys
from titaojing_train.loader import load_json
from titaojing_train.schema import SchemaError, validate_labels, validate_trace

paths = []
for a in sys.argv[1:] or ["data/synthetic"]:
    paths += sorted(glob.glob(os.path.join(a, "*.json"))) if os.path.isdir(a) else [a]
bad = 0
for p in paths:
    try:
        d = load_json(p)
        if d.get("format") == "titaojing-trace":
            validate_trace(d)
        elif d.get("format") == "titaojing-labels":
            validate_labels(d)
        else:
            continue
    except (SchemaError, KeyError, ValueError) as e:
        bad += 1
        print(f"✗ {p}: {e}")
print(f"检查 {len(paths)} 个文件，{bad} 个有问题")
sys.exit(1 if bad else 0)
