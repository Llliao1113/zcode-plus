@echo off
rem ZCode+ 诊断启动：前台运行控制器，可直接看控制台输出（排错用）
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] 未找到 node。请安装 Node.js 18+ 并加入 PATH。
  pause
  exit /b 1
)
echo [ZCode+] 控制器前台运行中，日志同时写入 zcode-plus.log ...
node controller.mjs
pause
