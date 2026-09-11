#!/usr/bin/env bash
# ZCode+ macOS 发行包构建（在 Linux/WSL2 内运行，产物回写仓库 dist/）
# 产物：dist/ZCodePlus-v<version>-macos-arm64-beta.tar.gz（内嵌官方 darwin-arm64 Node，用户机器无需安装 Node）
# 用法：build-macos.sh <version>（版本号由 build-exe.mjs 从 controller.mjs 解析后传入，单一来源）
# 依赖：curl、tar、xz —— 均为发行版标配；Node 缓存在 ~/.cache/zcode-plus-build（与 linux 构建共用）
#
# 形态说明：mac 包与 linux 包同构（tar.gz + install.sh），但 install.sh 是薄壳——
# 不用 bash 重写安装逻辑（那会引入未经真机验证的新代码），复制文件到
# ~/Library/Application Support/ZCodePlus 后直接用内嵌 node 跑 install.mjs，
# 复用 PR#2 作者在真机上实测过的 mac 安装逻辑（.app 探测 / ZCode+.app 生成 / 图标反色）。
# Mach-O 在 Linux 侧仅作数据复制，不执行，签名位由 tar 原样保留（官方 node 自带有效签名，
# 复制不破坏嵌入签名；安装经 curl/浏览器下载后 macOS 可能要求 xattr 解隔离，README 有说明）。
# 注意：本包为 beta——发行链路（install.sh/解压）未经 mac 真机验证，核心注入链路已由社区真机实测。
set -euo pipefail
VERSION="${1:?用法: build-macos.sh <version>}"
NODE_VERSION="${NODE_VERSION:-24.15.0}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"
APP_NAME="ZCodePlus-$VERSION-macos-arm64-beta"
CACHE="$HOME/.cache/zcode-plus-build"
NODE_TAR="$CACHE/node-v$NODE_VERSION-darwin-arm64.tar.gz"
NODE_DIR="$CACHE/node-v$NODE_VERSION-darwin-arm64"

# 源文件就位校验
for f in controller.mjs inject.js install.mjs make-icon.mjs README.md; do
  [ -f "$ROOT/$f" ] || { echo "[错误] 缺少 $f（应在仓库根目录运行）"; exit 1; }
done
# inject.js 不允许硬编码版本号（与 win/linux 构建同一校验：版本只来自控制器注入）
if grep -qE '"1\.[0-9]+\.[0-9]+"' "$ROOT/inject.js"; then
  echo "[错误] inject.js 仍含硬编码版本号（应读 __zcodePlusControllerVersion），构建中止"
  exit 1
fi

mkdir -p "$CACHE" "$DIST"
if [ ! -f "$NODE_TAR" ]; then
  echo "[下载] node v$NODE_VERSION (darwin-arm64)"
  curl -fsSL -o "$NODE_TAR" "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-arm64.tar.gz"
fi
if [ ! -x "$NODE_DIR/bin/node" ]; then
  # Mach-O 无执行位也可 stat 校验（-x 对复制来的文件会成立；首次解压用 -f 判断避免误判缓存）
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xzf "$NODE_TAR" -C "$NODE_DIR" --strip-components=1
fi
[ -f "$NODE_DIR/bin/node" ] || { echo "[错误] darwin-arm64 node 解压失败"; exit 1; }

# 在 ext4 临时目录组装（与 linux 包同理：/mnt 9P 文件系统不保 chmod 执行位，必须先落到 Linux 原生盘）
STAGE="$(mktemp -d "$CACHE/pkg.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
APP="$STAGE/$APP_NAME"
mkdir -p "$APP/bin"
# node 原名放入 bin/（不伪装成 ZCodePlus：install.mjs 会用 process.execPath 烘焙绝对路径，
# 装到用户机器后路径含 bin/node 语义更清晰；install.sh 薄壳引用 ./bin/node）
cp "$NODE_DIR/bin/node" "$APP/bin/node"
chmod 755 "$APP/bin/node"
cp "$ROOT/controller.mjs" "$ROOT/inject.js" "$ROOT/install.mjs" "$ROOT/make-icon.mjs" "$ROOT/README.md" "$APP/"

# install.sh 薄壳：复制源文件到 mac 标准安装位，再用内嵌 node 跑 install.mjs（mac 逻辑真机实测过）
cat > "$APP/install.sh" <<'INSTALL_EOF'
#!/usr/bin/env bash
# ZCode+ macOS 安装器（薄壳）：复制文件后委托内嵌 node 执行 install.mjs
# install.mjs 负责：探测 /Applications 等位置的 ZCode.app、生成 ZCode+.app 入口（反色 icns 图标）、
# 烘焙本包内嵌 node 的绝对路径（升级/卸载系统 node 不影响启动）
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/ZCodePlus"
mkdir -p "$DEST"
cp "$SRC/controller.mjs" "$SRC/inject.js" "$SRC/install.mjs" "$SRC/make-icon.mjs" "$SRC/README.md" "$DEST/"
"$SRC/bin/node" "$DEST/install.mjs"
echo "[完成] 已安装到 $DEST（桌面入口 ZCode+.app）"
echo "       排错：终端运行 $DEST/ZCode+.command 看控制台；日志见 $DEST/zcode-plus.log"
INSTALL_EOF
chmod 755 "$APP/install.sh"

# 包内直跑启动器（免安装体验/排错；同样用内嵌 node）
cat > "$APP/zcode-plus.sh" <<'LAUNCH_EOF'
#!/usr/bin/env bash
# ZCode+ 前台直跑（macOS beta）：无需安装，Ctrl+C 退出；关 ZCode 窗口时控制器随之退出
cd "$(dirname "$0")" || exit 1
exec ./bin/node controller.mjs
LAUNCH_EOF
chmod 755 "$APP/zcode-plus.sh"

TARBALL="$DIST/ZCodePlus-v$VERSION-macos-arm64-beta.tar.gz"
# 排除 macOS 无关的 win/linux 产物混入（按显式文件清单打包更稳妥）
tar -czf "$TARBALL" -C "$STAGE" "$APP_NAME"
SIZE="$(du -h "$TARBALL" | cut -f1)"
echo "[完成] $TARBALL ($SIZE)"
echo "       解压后运行 ./install.sh 安装，或直接 ./zcode-plus.sh 前台运行（beta）"
