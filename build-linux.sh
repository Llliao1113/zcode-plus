#!/usr/bin/env bash
# ZCode+ Linux 发行包构建（在 Linux/WSL2 内运行，产物回写仓库 dist/）
# 产物：dist/ZCodePlus-v<version>-linux-x64.tar.gz（内嵌官方 Node 运行时，用户机器无需安装 Node）
# 用法：build-linux.sh <version>（版本号由 build-exe.mjs 从 controller.mjs 解析后传入，单一来源）
# 依赖：curl、tar、xz —— 均为发行版标配；Node 缓存在 ~/.cache/zcode-plus-build（重复构建不重下）
set -euo pipefail
VERSION="${1:?用法: build-linux.sh <version>}"
NODE_VERSION="${NODE_VERSION:-24.15.0}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"
APP_NAME="ZCodePlus-$VERSION-linux-x64"
CACHE="$HOME/.cache/zcode-plus-build"
NODE_TAR="$CACHE/node-v$NODE_VERSION-linux-x64.tar.xz"
NODE_DIR="$CACHE/node-v$NODE_VERSION-linux-x64"

# 源文件就位校验
for f in controller.mjs inject.js start-zcode-plus.sh README.md; do
  [ -f "$ROOT/$f" ] || { echo "[错误] 缺少 $f（应在仓库根目录运行）"; exit 1; }
done
# inject.js 不允许硬编码版本号（与 Windows 构建同一校验：版本只来自控制器注入）
if grep -qE '"1\.[0-9]+\.[0-9]+"' "$ROOT/inject.js"; then
  echo "[错误] inject.js 仍含硬编码版本号（应读 __zcodePlusControllerVersion），构建中止"
  exit 1
fi

mkdir -p "$CACHE" "$DIST"
if [ ! -f "$NODE_TAR" ]; then
  echo "[下载] node v$NODE_VERSION (linux-x64)"
  curl -fsSL -o "$NODE_TAR" "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz"
fi
if [ ! -x "$NODE_DIR/bin/node" ]; then
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xJf "$NODE_TAR" -C "$NODE_DIR" --strip-components=1
fi

# 在 ext4 临时目录组装（/mnt 9P 文件系统不保 chmod 执行位，必须先落到 Linux 原生盘再打包）
STAGE="$(mktemp -d "$CACHE/pkg.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
APP="$STAGE/$APP_NAME"
mkdir -p "$APP"
cp "$NODE_DIR/bin/node" "$APP/ZCodePlus"
cp "$ROOT/controller.mjs" "$ROOT/inject.js" "$ROOT/README.md" "$APP/"
# 包内启动器：前台运行内嵌 node（Ctrl+C 退出 ZCode+；关 ZCode 窗口时控制器随之退出）
cat > "$APP/zcode-plus.sh" <<'LAUNCH_EOF'
#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
exec ./ZCodePlus controller.mjs
LAUNCH_EOF
# 安装器：复制到 ~/.local/share/ZCodePlus 并写 .desktop 入口（WSLg 自动集成进 Windows 开始菜单）；
# 重复运行 = 覆盖更新（不触碰 zcode-plus-config.json 与页面 localStorage 设置）
cat > "$APP/install.sh" <<'INSTALL_EOF'
#!/usr/bin/env bash
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.local/share/ZCodePlus"
mkdir -p "$DEST"
cp "$SRC/ZCodePlus" "$SRC/controller.mjs" "$SRC/inject.js" "$SRC/zcode-plus.sh" "$DEST/"
chmod +x "$DEST/ZCodePlus" "$DEST/zcode-plus.sh"
DESKTOP_DIR="$HOME/.local/share/applications"
mkdir -p "$DESKTOP_DIR"
cat > "$DESKTOP_DIR/zcode-plus.desktop" <<DESKTOP_EOF
[Desktop Entry]
Type=Application
Name=ZCode+
Comment=ZCode+ 提示词增强（CDP 注入版）
Exec=$DEST/zcode-plus.sh
Terminal=false
Categories=Development;
Icon=zcode
DESKTOP_EOF
echo "[完成] 已安装到 $DEST"
echo "       应用列表入口：ZCode+（WSLg 环境下同时出现在 Windows 开始菜单）"
echo "       排错：终端运行 $DEST/zcode-plus.sh 看控制台；日志见 $DEST/zcode-plus.log"
INSTALL_EOF
chmod +x "$APP/zcode-plus.sh" "$APP/install.sh"

TARBALL="$DIST/ZCodePlus-v$VERSION-linux-x64.tar.gz"
tar -czf "$TARBALL" -C "$STAGE" "$APP_NAME"
SIZE="$(du -h "$TARBALL" | cut -f1)"
echo "[完成] $TARBALL ($SIZE)"
echo "       解压后运行 ./install.sh 安装，或直接 ./zcode-plus.sh 前台运行"
