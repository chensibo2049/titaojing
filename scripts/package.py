#!/usr/bin/env python3
"""打测试包：python3 scripts/package.py  → release/titaojing-v<版本>.zip
包含 dist/（成品）、deploy/、启动脚本、给测试同学看的文档。需先 npm run build。"""
import json, os, sys, zipfile

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ver = json.load(open(os.path.join(root, "package.json"), encoding="utf-8"))["version"]
if not os.path.isfile(os.path.join(root, "dist", "index.html")):
    sys.exit("没有 dist/，请先 npm run build")
built = json.load(open(os.path.join(root, "dist", "version.json"), encoding="utf-8"))
if built.get("version") != ver:
    sys.exit(f"dist/ 是 v{built.get('version')}，package.json 是 v{ver}，请重新 npm run build")

name = f"titaojing-v{ver.split('.')[0]}"
out_dir = os.path.join(root, "release")
os.makedirs(out_dir, exist_ok=True)
out = os.path.join(out_dir, f"titaojing-v{ver}.zip")

readme_first = f"""沉思波 · 体态镜 v{ver}（测试包）

macOS / Linux：在本文件夹打开终端，运行 ./start.sh
               （或双击 start.command；第一次若提示"无法验证开发者"，请右键 → 打开）
Windows：      双击 start.bat（需要先安装 Python 3：https://www.python.org/downloads/ ，安装时勾选 Add to PATH）

启动后终端会打印实际网址（默认 http://127.0.0.1:8765/ ；端口被占用时会自动换成 8766、8767……），
请用 Chrome / Edge / Safari 打开终端里显示的那个网址。

dist/        —— 可直接上传到任意 https 静态主机的成品（上传 dist 里面的全部文件）
deploy/      —— nginx / Netlify(_headers) / Vercel 配置示例
README.md    —— 产品说明、运行、构建、部署
TESTING.md   —— 给测试同学的中文测试清单与反馈方法
CAMERA_DEBUG.md —— 手机 / 真实摄像头调试方法（含 ?debug=1 调试模式）
CHANGELOG.md —— 更新记录

请不要双击 dist/index.html（file:// 下无法使用镜头）。
源码与开发文档见开源仓库。
"""

files = [
    ("scripts/serve.py", "serve.py", 0o755),
    ("start.sh", "start.sh", 0o755),
    ("start.command", "start.command", 0o755),
    ("start.bat", "start.bat", 0o644),
    ("README.md", "README.md", 0o644),
    ("TESTING.md", "TESTING.md", 0o644),
    ("CHANGELOG.md", "CHANGELOG.md", 0o644),
    ("LICENSE", "LICENSE", 0o644),
    ("NOTICE", "NOTICE", 0o644),
    ("docs/CAMERA_DEBUG.md", "CAMERA_DEBUG.md", 0o644),
    ("docs/CLASSROOM.md", "CLASSROOM.md", 0o644),
    ("docs/PRIVACY.md", "PRIVACY.md", 0o644),
    ("docs/ASR.md", "ASR.md", 0o644),
]

def add(z, src, arc, mode):
    info = zipfile.ZipInfo.from_file(src, f"{name}/{arc}")
    info.external_attr = (0o100000 | mode) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    with open(src, "rb") as f:
        z.writestr(info, f.read())

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    z.writestr(zipfile.ZipInfo(f"{name}/先看我.txt"), readme_first.encode("utf-8"))
    for src, arc, mode in files:
        p = os.path.join(root, src)
        if os.path.isfile(p):
            add(z, p, arc, mode)
    for base in ("deploy", "dist", "landing"):
        for d, _, fs in os.walk(os.path.join(root, base)):
            for f in sorted(fs):
                p = os.path.join(d, f)
                add(z, p, os.path.relpath(p, root).replace(os.sep, "/"), 0o644)
print(f"✓ {out}  {os.path.getsize(out) / 1048576:.1f} MB")
