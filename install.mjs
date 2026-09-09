#!/usr/bin/env node
/*
ZCode+ 安装器：
- Windows：复制 controller / inject / launcher / start 到 %LOCALAPPDATA%\ZCodePlus，
  生成独立图标与桌面快捷方式「ZCode+」（不改动原 ZCode 快捷方式）
- macOS：复制 controller / inject 到 ~/Library/Application Support/ZCodePlus，
  生成可双击的「ZCode+.command」启动器（安装目录 + 桌面）
- 探测并写入 ZCode 路径与端口偏好
重复运行 = 覆盖更新（不影响已保存的页面设置）。
*/
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decodePng, invert, resize, encodePng, packIcns } from "./make-icon.mjs";

const SRC = path.dirname(fileURLToPath(import.meta.url));
const IS_MAC = process.platform === "darwin";
// 版本号唯一来源是 controller.mjs 的 CONTROLLER_VERSION（与 build-exe.mjs 同源）
const VERSION = fs.readFileSync(path.join(SRC, "controller.mjs"), "utf8")
  .match(/const CONTROLLER_VERSION = "([^"]+)"/)?.[1] || "0.0.0";
const DEST = IS_MAC
  ? path.join(os.homedir(), "Library", "Application Support", "ZCodePlus")
  : path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "ZCodePlus");
const DESKTOP = path.join(os.homedir(), "Desktop");

function listDriveRoots() {
  const roots = [];
  for (let code = "C".charCodeAt(0); code <= "Z".charCodeAt(0); code++) {
    const root = `${String.fromCharCode(code)}:\\`;
    try { if (fs.existsSync(root)) roots.push(root); } catch {}
  }
  return roots;
}
// macOS：ZCode 桌面版是 .app 包，存 .app 路径即可（controller 会解析到内部可执行文件）
function findZcodeMac() {
  const candidates = [
    "/Applications/ZCode.app",
    path.join(os.homedir(), "Applications", "ZCode.app"),
  ];
  try {
    const out = execSync(`mdfind "kMDItemFSName == 'ZCode.app'"`, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] });
    candidates.push(...out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 10));
  } catch {}
  for (const p of candidates) {
    try { if (fs.statSync(p).isDirectory()) return p; } catch {}
  }
  return null;
}
// 与 controller.mjs 的探测链保持一致：不硬编码本机路径
function findZcode() {
  if (IS_MAC) return findZcodeMac();
  const candidates = [
    path.join(SRC, "ZCode.exe"),
    "C:\\Program Files\\ZCode\\ZCode.exe",
    "C:\\Program Files (x86)\\ZCode\\ZCode.exe",
    path.join(os.homedir(), "AppData", "Local", "Programs", "ZCode", "ZCode.exe"),
  ];
  for (const root of listDriveRoots()) {
    candidates.push(path.join(root, "zcode", "ZCode.exe"));
  }
  try {
    const out = execSync("where ZCode.exe", { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] });
    candidates.push(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0]);
  } catch {}
  for (const p of candidates) {
    try { if (p && fs.statSync(p).isFile()) return p; } catch {}
  }
  return null;
}
// macOS 双击启动器：经 Terminal 打开（登录 shell，PATH 含 node）；前台排错用
function writeMacLauncher(file, targetDir) {
  const script = `#!/bin/bash\n# ZCode+ 启动器（macOS）\ncd "${targetDir.replace(/"/g, '\\"')}"\nexec node controller.mjs\n`;
  fs.writeFileSync(file, script, "utf8");
  fs.chmodSync(file, 0o755);
}
// macOS：生成 ZCode+.app 应用包（LSUIElement 后台型：自身无 Dock 图标无窗口，点击即拉起控制器）
// 图标优先用 ZCode 原版图标像素级反色（与 Windows 同源逻辑）；失败回退原版 icns
function buildIcns(sourcePng) {
  const { rgba, width, height } = decodePng(sourcePng);
  invert(rgba);
  const types = [["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024]]
    .filter(([, size]) => size <= Math.max(width, height)); // 不放大超过源尺寸
  return packIcns(types.map(([type, size]) => ({ type, png: encodePng(resize(rgba, width, height, size, size), size, size) })));
}
function macAppBundleDir(zcodePath) {
  if (/\.app\/?$/i.test(zcodePath)) return zcodePath;
  const m = String(zcodePath).match(/^(.*?\.app)\//);
  return m ? m[1] : null; // 配置填的是内部可执行文件路径时向上找 .app 根
}
function buildMacApp(appDir, { targetDir, nodeBin, version, iconPng, iconIcns }) {
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(appDir, "Contents", "MacOS"), { recursive: true });
  fs.mkdirSync(path.join(appDir, "Contents", "Resources"), { recursive: true });
  // 启动器：优先安装时烘焙的 node 绝对路径；失效回退 PATH 与常见安装位置（Finder 启动无登录 shell PATH）
  const q = (s) => String(s).replace(/"/g, '\\"');
  const launcher = [
    "#!/bin/bash",
    "# ZCode+ 启动器（macOS 应用包）",
    `NODE_BIN="${q(nodeBin)}"`,
    'if [ ! -x "$NODE_BIN" ]; then',
    '  NODE_BIN="$(command -v node || true)"',
    '  [ -x "$NODE_BIN" ] || NODE_BIN="$(ls -1 /opt/homebrew/bin/node /usr/local/bin/node 2>/dev/null | head -1)"',
    "fi",
    'if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then',
    `  osascript -e 'display dialog "未找到 node（可能已升级或卸载），请重跑 node install.mjs 重新生成 ZCode+.app" with title "ZCode+" buttons ["好"] default button "好" with icon caution' >/dev/null 2>&1`,
    "  exit 1",
    "fi",
    // 后台拉起控制器后本进程立即退出：否则 Launch Services 认为应用常驻，
    // 后续点击 .app/Dock 只向本进程发激活事件而不再启动，窗口聚焦逻辑失效。
    // 控制器自身有单实例锁：重复点击 → 锁命中 → 激活已运行的 ZCode+ 后退出。
    `"$NODE_BIN" "${q(targetDir)}/controller.mjs" &`,
    "exit 0",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(appDir, "Contents", "MacOS", "ZCode+"), launcher);
  fs.chmodSync(path.join(appDir, "Contents", "MacOS", "ZCode+"), 0o755);
  let iconOk = false;
  if (iconPng && fs.existsSync(iconPng)) {
    try {
      fs.writeFileSync(path.join(appDir, "Contents", "Resources", "app.icns"), buildIcns(iconPng));
      iconOk = true;
    } catch (error) {
      console.log("[提示] 反色图标生成失败，回退 ZCode 原版图标：" + String(error?.message || error));
    }
  }
  if (!iconOk && iconIcns && fs.existsSync(iconIcns)) {
    fs.copyFileSync(iconIcns, path.join(appDir, "Contents", "Resources", "app.icns"));
    iconOk = true;
  }
  let plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>ZCode+</string>
  <key>CFBundleDisplayName</key><string>ZCode+</string>
  <key>CFBundleIdentifier</key><string>com.zcodeplus.launcher</string>
  <key>CFBundleExecutable</key><string>ZCode+</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleIconFile</key><string>app.icns</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict>
</plist>
`;
  if (!iconOk) plist = plist.replace('  <key>CFBundleIconFile</key><string>app.icns</string>\n', "");
  fs.writeFileSync(path.join(appDir, "Contents", "Info.plist"), plist);
}
function main() {
  // 1) node 检查
  try { execSync("node -v", { stdio: "pipe" }); }
  catch {
    console.error("[错误] 未找到 node。请安装 Node.js 18+（https://nodejs.org）并加入 PATH 后重试。");
    process.exit(1);
  }
  const zcodePath = process.argv[2] || findZcode();
  if (!zcodePath || !fs.existsSync(zcodePath)) {
    console.error(`[错误] 未找到 ZCode${IS_MAC ? " 应用（ZCode.app）" : ".exe"}。`
      + (IS_MAC ? "用法：node install.mjs <ZCode.app 路径>" : "用法：node install.mjs <ZCode.exe 完整路径>"));
    console.error(IS_MAC ? "       已尝试：/Applications、~/Applications、Spotlight。" : "       已尝试：源码目录、各盘符 zcode 目录、标准安装位置、PATH。");
    process.exit(1);
  }
  // 2) 复制文件
  fs.mkdirSync(DEST, { recursive: true });
  const files = IS_MAC ? ["controller.mjs", "inject.js"] : ["controller.mjs", "inject.js", "launcher.vbs", "start-zcode-plus.bat"];
  for (const file of files) {
    fs.copyFileSync(path.join(SRC, file), path.join(DEST, file));
  }
  // 3) 平台专属：Windows 生成图标 + 快捷方式；macOS 生成 .command 排错入口 + ZCode+.app 应用包
  if (IS_MAC) {
    writeMacLauncher(path.join(DEST, "ZCode+.command"), DEST); // 前台排错入口（Terminal 可见日志）
    const bundle = macAppBundleDir(zcodePath);
    const res = bundle ? path.join(bundle, "Contents", "Resources") : null;
    const appDir = path.join(os.homedir(), "Applications", "ZCode+.app");
    buildMacApp(appDir, {
      targetDir: DEST,
      nodeBin: process.execPath,
      version: VERSION,
      iconPng: res ? path.join(res, "icon.png") : null,
      iconIcns: res ? path.join(res, "icon.icns") : null,
    });
    // 桌面入口 = .app 副本（覆盖旧版 .command 入口）
    fs.rmSync(path.join(DESKTOP, "ZCode+.command"), { force: true });
    fs.rmSync(path.join(DESKTOP, "ZCode+.app"), { recursive: true, force: true });
    fs.cpSync(appDir, path.join(DESKTOP, "ZCode+.app"), { recursive: true });
  } else {
    // 生成图标（从 ZCode 原版图标像素级反色：白底黑 Z；源缺失时沿用已生成的 ico）
    const zcodeIcon = path.join(path.dirname(zcodePath), "resources", "icon.png");
    if (fs.existsSync(zcodeIcon)) {
      execSync(`node "${path.join(SRC, "make-icon.mjs")}" "${zcodeIcon}"`, { stdio: "inherit" });
    } else {
      console.log("[提示] 未找到 ZCode 原版图标 " + zcodeIcon + "，沿用已有 ZCodePlus.ico");
    }
    fs.copyFileSync(path.join(SRC, "ZCodePlus.ico"), path.join(DEST, "ZCodePlus.ico"));
  }
  // 4) 配置（探测/手动指定的 zcodePath 落盘，controller 启动时直接使用；zcodePath 留空则启动时重新探测）
  const config = {
    _readme: [
      "ZCode+ 配置文件(JSON 格式，不支持注释)",
      IS_MAC
        ? 'zcodePath：ZCode 桌面版路径；留空 "" 表示自动探测。支持 .app 包（如 "/Applications/ZCode.app"）或内部可执行文件。'
        : 'zcodePath：ZCode 桌面版 ZCode.exe 的完整路径；留空 "" 表示自动探测。',
      IS_MAC
        ? null
        : '推荐用正斜杠，例如 "E:/zcode/ZCode.exe"；用反斜杠则必须写成双反斜杠。',
      "port：调试端口，默认 9333；被占用时自动顺延(9334-9350)。",
    ].filter(Boolean),
    zcodePath,
    port: 9333,
    installedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(DEST, "zcode-plus-config.json"), JSON.stringify(config, null, 2));
  // 5) 桌面入口：Windows 用 .lnk 快捷方式，macOS 用 .command（上方已生成）
  if (!IS_MAC) {
    const ps = `
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut('${DESKTOP.replace(/\\/g, "\\") + "\\\\ZCode+.lnk"}')
$lnk.TargetPath = 'C:\\\\Windows\\\\System32\\\\wscript.exe'
$lnk.Arguments = '"${DEST.replace(/\\/g, "\\\\")}\\\\launcher.vbs"'
$lnk.WorkingDirectory = '${DEST.replace(/\\/g, "\\\\")}'
$lnk.IconLocation = '${DEST.replace(/\\/g, "\\\\")}\\\\ZCodePlus.ico,0'
$lnk.Description = 'ZCode+ 提示词增强版'
$lnk.Save()
Write-Output 'shortcut created'
`.trim();
    fs.writeFileSync(path.join(SRC, "install-shortcut.ps1"), ps);
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(SRC, "install-shortcut.ps1")}"`, { stdio: "inherit" });
    fs.rmSync(path.join(SRC, "install-shortcut.ps1"), { force: true });
  }

  console.log("");
  console.log("[完成] ZCode+ 安装到 " + DEST);
  if (IS_MAC) {
    console.log("  - 桌面入口：ZCode+.app（双击启动 ZCode+，无终端窗口；可拖入 Dock 常驻）");
    console.log("  - 应用入口：~/Applications/ZCode+.app（启动台可见）");
    console.log("  - ZCode 路径：" + zcodePath);
  } else {
    console.log("  - 桌面快捷方式：ZCode+（独立图标，原 ZCode 快捷方式不受影响）");
    console.log("  - ZCode 路径：" + zcodePath);
  }
  console.log("  - 调试端口：9333（被占用时自动顺延到 9334-9350）");
  console.log("  - 排错：运行 " + (IS_MAC ? path.join(DEST, "ZCode+.command") : path.join(DEST, "start-zcode-plus.bat")) + " 查看控制台；日志见 zcode-plus.log");
  console.log("  - 注意：ZCode 为单实例应用，原版与 ZCode+ 不能同时运行；");
  console.log("    若原版在运行，ZCode+ 会询问是否关闭原版后重启。");
}
main();
