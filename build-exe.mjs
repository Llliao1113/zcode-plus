#!/usr/bin/env node
/*
ZCode+ 发行包构建（无第三方构建框架；Windows 包本地构建，Linux 包委托 WSL 执行 build-linux.sh）
产物（dist/）：
  ZCodePlus-vx.y.z-win-x64.zip   Windows 发行包（Release 附件）
  ZCodePlus-vx.y.z-linux-x64.tar.gz  Linux 发行包（Release 附件，含 install.sh）
实际采用最稳妥形态（对用户零依赖、双击即用）：
  dist/ZCodePlus-<ver>-win-x64/ 文件夹 + zip —— Setup.exe 仅是把文件夹部署到 LOCALAPPDATA 并建快捷方式的副本
  Linux 包解压后 ./install.sh 安装或 ./zcode-plus.sh 直接运行
用法：node build-exe.mjs
*/
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
// 版本号唯一来源是 controller.mjs 的 CONTROLLER_VERSION，构建时解析（避免多处维护漏同步）
const VERSION = fs.readFileSync(path.join(ROOT, "controller.mjs"), "utf8")
  .match(/const CONTROLLER_VERSION = "([^"]+)"/)?.[1];
if (!VERSION) throw new Error("controller.mjs 中未找到 CONTROLLER_VERSION，构建中止");
const APP_DIR = path.join(DIST, `ZCodePlus-${VERSION}-win-x64`);
const NODE_HOST_DIR = path.join(ROOT, "build", "node-host", "node-v24.15.0-win-x64");

function sh(cmd) { execSync(cmd, { stdio: "inherit" }); }
function ensureOfficialNode() {
  const nodeExe = path.join(NODE_HOST_DIR, "node.exe");
  if (fs.existsSync(nodeExe)) return nodeExe;
  fs.mkdirSync(path.dirname(nodeExe), { recursive: true });
  const zip = path.join(ROOT, "build", "node-v24.15.0-win-x64.zip");
  if (!fs.existsSync(zip)) {
    sh(`curl -sL -o "${zip}" "https://nodejs.org/dist/v24.15.0/node-v24.15.0-win-x64.zip"`);
  }
  execSync(`unzip -o -q "${zip}" -d "${path.join(ROOT, "build", "node-host")}"`, { stdio: "inherit" });
  return nodeExe;
}

function main() {
  if (process.platform !== "win32") {
    // 本脚本在 Windows 上是双平台构建入口（win 包本地构建 + 委托 WSL 构建 linux 包）；
    // macOS 用 node install.mjs 源码部署，Linux 机器上可直接运行 build-linux.sh
    console.error("[跳过] build-exe.mjs 需在 Windows 上运行（win 包本地构建 + WSL 委托 linux 包）；macOS 用 node install.mjs 源码部署，Linux 可直接运行 build-linux.sh。");
    process.exit(1);
  }
  // inject.js 版本必须来自控制器注入（面板显示），不允许再硬编码数字版本
  if (/"1\.\d+\.\d+"/.test(fs.readFileSync(path.join(ROOT, "inject.js"), "utf8"))) {
    throw new Error("inject.js 仍含硬编码版本号（应读 __zcodePlusControllerVersion），构建中止");
  }
  // 不删除既有目录（可能被运行中的 controller 占用）；逐文件覆盖写入
  fs.mkdirSync(APP_DIR, { recursive: true });
  const nodeExe = ensureOfficialNode();
  // 1) 运行形态：node.exe 作为 ZCodePlus.exe，controller 作为入口脚本（vbs 同源方式，但免 node 依赖）
  fs.copyFileSync(nodeExe, path.join(APP_DIR, "ZCodePlus.exe"));
  for (const f of ["controller.mjs", "inject.js", "ZCodePlus.ico", "launcher.vbs", "README.md"]) {
    fs.copyFileSync(path.join(ROOT, f), path.join(APP_DIR, f));
  }
  // 2) 无窗口启动器（双击 ZCodePlus.exe 会弹控制台；vbs 隐藏拉起）
  //    结构已实测：命令行先拼进变量再 sh.Run，避免深层引号嵌套
  const vbsLines = [
    `' ZCode+ launcher: run controller without a console window`,
    `Set sh = CreateObject("WScript.Shell")`,
    `Set fso = CreateObject("Scripting.FileSystemObject")`,
    `appDir = fso.GetParentFolderName(WScript.ScriptFullName)`,
    `cmd = """" & appDir & "\\ZCodePlus.exe"" """ & appDir & "\\controller.mjs"""`,
    `sh.CurrentDirectory = appDir`,
    `sh.Run cmd, 0, False`,
  ];
  fs.writeFileSync(path.join(APP_DIR, "启动 ZCode+.vbs"), vbsLines.join("\r\n") + "\r\n", "latin1");
  // 3) README 使用说明（简版，指向主 README）
  // 4) 打 zip（Windows 自带 tar 支持 zip? 用 PowerShell Compress-Archive 保证兼容）
  const zipPath = path.join(DIST, `ZCodePlus-v${VERSION}-win-x64.zip`);
  sh(`powershell -NoProfile -Command "Compress-Archive -Path '${APP_DIR.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`);
  const size = (fs.statSync(zipPath).size / 1048576).toFixed(1);
  console.log(`构建完成：
  ${APP_DIR}\\ZCodePlus.exe（部署文件夹，双击「启动 ZCode+.vbs」或快捷方式使用）
  ${zipPath}（${size} MB，Release 附件）`);
  buildLinuxPackage(VERSION);
  buildMacPackage(VERSION);
}

// Linux 包：委托 WSL 内执行 build-linux.sh（同一份源码同一版本；无 WSL 的机器跳过，
// 贡献者可在原生 Linux 上直接运行该脚本）
function buildLinuxPackage(version) {
  console.log("\n[linux] 尝试构建 Linux 发行包（经 WSL）…");
  runWslBuild("build-linux.sh", "linux");
}
// macOS 包（beta）：同款 WSL 委托 build-macos.sh——Linux 侧只复制 darwin node 二进制不执行，
// 组装逻辑与 linux 包同构。附件名带 beta 后缀，发行链路待 mac 真机验证
function buildMacPackage(version) {
  console.log("\n[macos] 尝试构建 macOS 发行包（经 WSL，beta）…");
  runWslBuild("build-macos.sh", "macos");
}
function runWslBuild(script, tag) {
  try {
    const wslRoot = ROOT.replace(/^([A-Za-z]):[\\/]/, (_m, drive) => `/mnt/${drive.toLowerCase()}/`).replace(/\\/g, "/");
    const r = spawnSync("wsl.exe", ["-e", "bash", path.posix.join(wslRoot, script), VERSION], {
      encoding: "utf8", timeout: 600000, stdio: ["ignore", "pipe", "pipe"],
    });
    if (r.status === 0) return;
    console.log(`[${tag}] 构建失败（status=${r.status}）：${String(r.stderr || r.stdout || "").slice(0, 400)}`);
  } catch (error) {
    console.log(`[${tag}] 无可用 WSL，跳过（可在 Linux 内直接运行 ${script}）：${error?.message || error}`);
  }
}
main();
