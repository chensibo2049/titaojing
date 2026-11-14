#!/usr/bin/env bash
# 沉思波 · 体态镜 —— 本地测试
# 需要以网址打开（https 或 localhost）；直接双击 index.html（file://）时浏览器不允许镜头。
# 用法：./start.sh [src] [端口]      例：./start.sh 9000    PORT=9000 ./start.sh
set -euo pipefail
cd "$(dirname "$0")"
DIR="."
if [ -f dist/index.html ]; then DIR="dist"; fi
ARGS=()
for a in "$@"; do
  case "$a" in
    src) DIR="." ;;
    *[!0-9]*|"") echo "未知参数：$a（可用：src 或 端口号）"; exit 2 ;;
    *) ARGS+=("$a") ;;
  esac
done
SERVER="scripts/serve.py"
[ -f "$SERVER" ] || SERVER="serve.py"
if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python >/dev/null 2>&1; then PY=python
else echo "需要 Python 3：macOS 可运行 xcode-select --install，或到 python.org 下载。"; exit 1; fi
echo
echo "  沉思波 · 体态镜    目录：${DIR}"
echo "  · 不要用 file:// 直接打开页面。"
echo "  · 手机测试镜头需要 https 网址（见 docs/CAMERA_DEBUG.md），局域网 http://IP 会被手机浏览器拒绝摄像头。"
# 实际网址由服务器在启动后打印（端口被占用时会自动换端口）。
exec "$PY" "$SERVER" "$DIR" ${ARGS[@]+"${ARGS[@]}"}
