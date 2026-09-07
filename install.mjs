#!/usr/bin/env node
/*
ZCode+ 安装器：
- 复制 controller / inject / launcher / start 到 %LOCALAPPDATA%\ZCodePlus
- 生成独立图标与桌面快捷方式「ZCode+」（不改动原 ZCode 快捷方式）
- 探测并写入 ZCode.exe 路径与端口偏好
重复运行 = 覆盖更新（不影响已保存的页面设置）。
*/
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SRC = path.dirname(fileURLToPath(import.meta.url));
const DEST = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "ZCodePlus");
const DESKTOP = path.join(os.homedir(), "Desktop");

const CANDIDATE_ZCODE = [
  "D:\\Zcode\\ZCode.exe",
  "C:\\Program Files\\ZCode\\ZCode.exe",
  "C:\\Users\\" + os.userInfo().username + "\\AppData\\Local\\Programs\\ZCode\\ZCode.exe",
];

function findZcode() {
  for (const p of CANDIDATE_ZCODE) {
    if (fs.existsSync(p)) return p;
  }
  return null;
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
    console.error("[错误] 未找到 ZCode.exe。用法：node install.mjs <ZCode.exe 完整路径>");
    process.exit(1);
  }
  // 2) 复制文件
  fs.mkdirSync(DEST, { recursive: true });
  for (const file of ["controller.mjs", "inject.js", "launcher.vbs", "start-zcode-plus.bat"]) {
    fs.copyFileSync(path.join(SRC, file), path.join(DEST, file));
  }
  // 3) 生成图标（从 ZCode 原版图标像素级反色：白底黑 Z；源缺失时沿用已生成的 ico）
  const zcodeIcon = path.join(path.dirname(zcodePath), "resources", "icon.png");
  if (fs.existsSync(zcodeIcon)) {
    execSync(`node "${path.join(SRC, "make-icon.mjs")}" "${zcodeIcon}"`, { stdio: "inherit" });
  } else {
    console.log("[提示] 未找到 ZCode 原版图标 " + zcodeIcon + "，沿用已有 ZCodePlus.ico");
  }
  fs.copyFileSync(path.join(SRC, "ZCodePlus.ico"), path.join(DEST, "ZCodePlus.ico"));
  // 4) 配置（端口默认 9333，可用环境变量 ZCODE_PLUS_PORT 覆盖；启动前会做占用检测）
  const config = { zcodePath, port: 9333, installedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(DEST, "zcode-plus-config.json"), JSON.stringify(config, null, 2));
  // 5) 桌面快捷方式 ZCode+（独立图标，不动原 ZCode 快捷方式）
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

  console.log("");
  console.log("[完成] ZCode+ 安装到 " + DEST);
  console.log("  - 桌面快捷方式：ZCode+（独立图标，原 ZCode 快捷方式不受影响）");
  console.log("  - ZCode 路径：" + zcodePath);
  console.log("  - 调试端口：9333（被占用时自动顺延到 9334-9350）");
  console.log("  - 排错：运行 " + path.join(DEST, "start-zcode-plus.bat") + " 查看控制台；日志见 zcode-plus.log");
  console.log("  - 注意：ZCode 为单实例应用，原版与 ZCode+ 不能同时运行；");
  console.log("    若原版在运行，ZCode+ 会询问是否关闭原版后重启。");
}
main();
