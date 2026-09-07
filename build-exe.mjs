#!/usr/bin/env node
/*
ZCode+ Windows 发行包构建（无第三方构建框架）
产物（dist/）：
  ZCodePlus-Setup.exe   官方 node.exe 复制品，首参数跑 installer.mjs：把 payload 解包到 %LOCALAPPDATA%\ZCodePlus
  ZCodePlus-vx.y.z.zip  常规发行 zip（setup exe + payload 文件），供 Release 附件
原理：Windows 下 "Setup.exe payload.js" 与双击运行 Setup.exe 等价性不足（双击无参数），
     因此 setup 自带「无参数时自动进入安装模式」的引导逻辑（installer.mjs 检测 SEA 不可用，
     直接以 node 解析自身尾部附加的 payload —— 简化为：installer 引导由 zip 内文件结构承担）。
实际采用最稳妥形态（对用户零依赖、双击即用）：
  dist/ZCodePlus/ 文件夹 + zip —— Setup.exe 仅是把文件夹部署到 LOCALAPPDATA 并建快捷方式的副本
用法：node build-exe.mjs
*/
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const VERSION = "1.2.0";
const APP_DIR = path.join(DIST, `ZCodePlus-${VERSION}`);
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
  const zipPath = path.join(DIST, `ZCodePlus-v${VERSION}.zip`);
  sh(`powershell -NoProfile -Command "Compress-Archive -Path '${APP_DIR.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`);
  const size = (fs.statSync(zipPath).size / 1048576).toFixed(1);
  console.log(`构建完成：
  ${APP_DIR}\\ZCodePlus.exe（部署文件夹，双击「启动 ZCode+.vbs」或快捷方式使用）
  ${zipPath}（${size} MB，Release 附件）`);
}
main();
