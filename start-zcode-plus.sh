#!/usr/bin/env bash
# ZCode+ 诊断启动：前台运行控制器，可直接看控制台输出（排错用）
# 日志同时写入同目录 zcode-plus.log；Ctrl+C 结束
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] 未找到 node。请安装 Node.js 18+（推荐 22+）并加入 PATH。"
  exit 1
fi
echo "[ZCode+] 控制器前台运行中，日志同时写入 zcode-plus.log ..."
exec node controller.mjs
