#!/usr/bin/env python3
"""沉思波 · 体态镜 —— 本地测试用静态服务器（仅用于本机测试，正式上线请用 https 静态主机）。

- 正确的 .wasm / .task / .webmanifest MIME；入口、SW、config.js 不缓存。
- 端口被占用时自动尝试下一个（默认 8765..8785），并打印实际网址。

用法：
  python3 scripts/serve.py [目录] [端口]
  python3 scripts/serve.py dist 9000
  PORT=9000 HOST=0.0.0.0 python3 scripts/serve.py dist
优先级：命令行端口 > 环境变量 PORT > 默认 8765。
  PORT_TRIES   向后尝试的端口数（默认 20，即 8765..8785）
  QUIET=1      不打印每个请求
  URL_FILE=路径  把实际网址写进这个文件（start.sh 用）
"""
import errno
import functools
import http.server
import os
import socket
import sys

DEFAULT_PORT = 8765

# Windows 旧控制台 / 重定向时避免中文或符号打印报错
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(errors="replace")
    except Exception:
        pass


def parse_args(argv):
    root, port = ".", None
    rest = [a for a in argv if a not in ("-h", "--help")]
    if len(rest) != len(argv):
        print(__doc__)
        sys.exit(0)
    for a in rest:
        if a.isdigit():
            port = int(a)
        else:
            root = a
    if port is None:
        env = os.environ.get("PORT", "").strip()
        if env:
            if not env.isdigit():
                print(f"环境变量 PORT={env!r} 不是数字，已改用默认端口 {DEFAULT_PORT}。")
            else:
                port = int(env)
    return root, port or DEFAULT_PORT


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".task": "application/octet-stream",
        ".webmanifest": "application/manifest+json",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
    }

    def end_headers(self):
        p = self.path.split("?")[0]
        if p in ("/", "/index.html", "/sw.js", "/config.js", "/manifest.webmanifest", "/version.json"):
            self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Permissions-Policy", "camera=(self), microphone=(self), screen-wake-lock=(self)")
        super().end_headers()

    def log_message(self, fmt, *args):
        if os.environ.get("QUIET"):
            return
        super().log_message(fmt, *args)


class Server(http.server.ThreadingHTTPServer):
    # 不复用端口：否则在 macOS / 新版 Python 上可能和另一个正在运行的服务"共用"同一端口，
    # 浏览器打开的其实是旧服务。被占用就老老实实换下一个端口。
    allow_reuse_address = False
    allow_reuse_port = False
    daemon_threads = True


def port_answers(host, port):
    """有别的程序在这个端口上监听吗？（比 bind 更可靠：能发现绑在 0.0.0.0 / ::1 上的旧服务）"""
    probe = "127.0.0.1" if host in ("0.0.0.0", "", "::") else host
    try:
        with socket.create_connection((probe, port), timeout=0.3):
            return True
    except OSError:
        return False


def bind_first_free(host, start, tries, handler):
    last_err = None
    for port in range(start, min(start + tries + 1, 65536)):
        if port_answers(host, port):
            last_err = OSError(errno.EADDRINUSE, "in use")
            continue
        try:
            return Server((host, port), handler), port
        except OSError as e:
            last_err = e
            if e.errno in (errno.EADDRINUSE, errno.EACCES) or getattr(e, "winerror", None) in (10048, 10013):
                continue
            raise
    return None, last_err


def main():
    root, start = parse_args(sys.argv[1:])
    host = os.environ.get("HOST", "127.0.0.1")
    tries = int(os.environ.get("PORT_TRIES", "20") or 20)
    root = os.path.abspath(root)
    if not os.path.isdir(root):
        print(f"找不到要服务的目录：{root}")
        sys.exit(2)
    handler = functools.partial(Handler, directory=root)

    httpd, port = bind_first_free(host, start, tries, handler)
    if httpd is None:
        end = min(start + tries, 65535)
        print()
        print(f"  ✗ 端口 {start}–{end} 都被占用了，没能启动。")
        print("  多半是之前启动的体态镜还在后台运行。可以：")
        print(f"    1) 关掉之前的终端窗口，或运行：lsof -ti:{start} | xargs kill   （Windows：netstat -ano | findstr {start}）")
        print("    2) 换一个端口：python3 scripts/serve.py dist 9000   或   PORT=9000 ./start.sh")
        print()
        sys.exit(1)

    shown_host = "127.0.0.1" if host in ("0.0.0.0", "", "::") else host
    url = f"http://{shown_host}:{port}/"
    if os.environ.get("URL_FILE"):
        try:
            with open(os.environ["URL_FILE"], "w", encoding="utf-8") as f:
                f.write(url + "\n")
        except OSError:
            pass
    print()
    if port != start:
        print(f"  ! 端口 {start} 已被占用（可能是之前启动的体态镜还没关），已自动改用 {port}。")
    print(f"  ✓ 体态镜已启动，请用 Chrome / Edge / Safari 打开：  {url}")
    if host in ("0.0.0.0", "::"):
        print("    （已监听所有网卡；手机通过局域网 http 访问时浏览器不允许摄像头，见 docs/CAMERA_DEBUG.md）")
    print(f"    服务目录：{root}")
    print("    按 Ctrl+C 结束。")
    print(flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  已停止。")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
