@echo off
chcp 65001 >nul
REM 沉思波 · 体态镜 —— Windows 本地测试：双击运行，再打开窗口里显示的网址
cd /d "%~dp0"
set "SERVER=scripts\serve.py"
if not exist "%SERVER%" set "SERVER=serve.py"
set "DIR=."
if exist "dist\index.html" set "DIR=dist"
where py >nul 2>nul && (py -3 "%SERVER%" "%DIR%" %* & goto :end)
where python >nul 2>nul && (python "%SERVER%" "%DIR%" %* & goto :end)
echo 没有找到 Python 3。请到 https://www.python.org/downloads/ 安装，安装时勾选 "Add python.exe to PATH"。
:end
pause
