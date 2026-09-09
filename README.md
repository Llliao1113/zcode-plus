<div align="center">

# ZCode+ 提示词增强

**为 ZCode 桌面版注入一键式提示词增强（Prompt Enhancement）**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: Windows | Linux | macOS](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-blue.svg)]()
[![Dependencies: Zero](https://img.shields.io/badge/Dependencies-Zero-green.svg)]()

在输入框旁注入一颗星芒按钮 ✨ —— 点击把当前草稿发给模型，改写得更清晰后回填，检查后发送，支持撤销。

**社区支持 · [LINUX DO](https://linux.do/)**

</div>

---

## 项目介绍

写提示词时经常词不达意：想法很多，表达模糊，模型理解偏差。ZCode+ 把 WorkBuddy 的「提示词增强」体验带到 ZCode 桌面版——你写草稿，它交给模型改写成一份更清晰、更具体、更可执行的提示词，回填输入框由你检查后发送；不满意一键撤销，原文永远不丢。

```
写好草稿 → 点击 ✨ → 模型改写 → 回填输入框 → 你检查 → 发送
                ↘ 一键撤销，恢复原文
```

内置三套增强模式可切换，并支持完全自定义模板：

| 模式 | 风格 | 适用 |
|---|---|---|
| **WorkBuddy 原版** | 简洁精确，约 800 字符上限 | 日常任务，快进快出 |
| **创意增强** | 充分展开，无字数限制，保留代码/报错原文 | 开放性需求、复杂设计 |
| **自定义模板** | 你的模板即 user 消息，`{input}` 占位符插入草稿 | 完全掌控增强行为 |

连接配置默认「跟随 ZCode 当前模型」：自动匹配输入框当前显示的供应商与模型（含自定义请求头透传），凭据只在本地控制器内存中使用。也支持手动配置任意 OpenAI 兼容 / Anthropic 协议服务。

## 运行原理

ZCode 桌面版是 Electron 应用，UI 为 Chromium 渲染的 Web DOM，但没有官方用户脚本或扩展机制。ZCode+ 通过 Chrome DevTools Protocol 实现非侵入注入：

```
桌面「ZCode+」入口（Windows: 快捷方式/vbs 无窗口启动；Linux: .desktop 应用入口；macOS: ZCode+.app 双击启动，可驻 Dock）
   └→ 本地控制器（常驻 Node 进程，凭据仅存于此；单实例锁，重复点击只聚焦已运行的 ZCode+）
        ├─ 分配空闲调试端口（默认 9333，占用自动顺延 9334-9350，启动前 bind 检测）
        ├─ 以 --remote-debugging-port 拉起 ZCode（Windows: ZCode.exe；Linux: /opt/ZCode/zcode；macOS: ZCode.app；不改安装目录、不碰签名）
        ├─ CDP 向页面注入增强脚本（页面刷新/新窗口自动重注入）
        ├─ 页面脚本经 Runtime binding 发送当前草稿 → 控制器调用模型 → 回传
        └─ 页面回填（受信全选按键 Windows Ctrl+A / macOS Cmd+A；回填前校验草稿未变，改稿/切任务时结果保留不覆盖）
```

关键设计：

- **原版 ZCode 零影响**：不改安装目录、不破坏签名、不干扰自动更新；想用原版直接点原版快捷方式
- **凭据不落盘**：API Key / OAuth 凭据仅存于控制器进程内存，不写盘、不进日志、不回传页面，错误信息自动脱敏
- **端口防冲突**：bind 预检 + 顺延策略，杜绝端口冲突
- **单实例友好**：原版 ZCode 运行中时，ZCode+ 弹窗询问是否关闭重启

## 技术栈

- **零第三方依赖**——控制器与页面脚本均为原生 JavaScript
- [Node.js](https://nodejs.org) 18+（推荐 22+，使用原生 WebSocket / fetch）；发行包内嵌官方 Node 运行时，**用户机器无需安装 Node**
- Chrome DevTools Protocol（`Target.setAutoAttach`、`Page.addScriptToEvaluateOnNewDocument`、`Runtime.addBinding`）
- Electron 远程调试（`--remote-debugging-port`）
- 图标与安装器同为纯 Node 实现（PNG 解码 → ICO 打包）

## 安装

### Windows：方式一（下载发行包，推荐，零依赖）

1. 从 [Releases](../../releases) 下载 `ZCodePlus-vX.Y.Z-win-x64.zip`
2. 解压到任意目录（推荐 `%LOCALAPPDATA%\ZCodePlus`）
3. 双击文件夹内 **「启动 ZCode+.vbs」** 即可使用；右键发送到桌面快捷方式可获得带独立图标（ZCode 原版图标反色：白底黑 Z）的「ZCode+」入口

前置条件：已安装 ZCode 桌面版。首次运行自动探测安装位置（ZCode+ 所在目录及上级、各盘符 `\zcode` 目录、标准安装位置、PATH）；探测失败会弹窗引导，在安装目录的 `zcode-plus-config.json` 中手动填写 `zcodePath` 即可（首次运行自动生成该文件）。

### Windows：方式二（从源码运行，开发者）

```bash
git clone <本仓库地址>
cd zcode-plus
node install.mjs        # 部署到 %LOCALAPPDATA%\ZCodePlus 并创建桌面快捷方式
```

或前台调试模式：`node controller.mjs`（控制台直接看日志）。

### Linux / WSL2（下载发行包，推荐，零依赖）

1. 从 [Releases](../../releases) 下载 `ZCodePlus-vX.Y.Z-linux-x64.tar.gz`
2. 解压并安装（WSLg 环境下「ZCode+」入口会自动出现在 Windows 开始菜单）：

```bash
tar -xzf ZCodePlus-vX.Y.Z-linux-x64.tar.gz
cd ZCodePlus-X.Y.Z-linux-x64
./install.sh           # 安装到 ~/.local/share/ZCodePlus 并注册应用入口
```

或解压后直接前台运行：`./zcode-plus.sh`（Ctrl+C 退出；排错时看控制台输出）。

前置条件：已安装 ZCode 桌面版（Linux deb 等）。自动探测覆盖 PATH（`command -v zcode` 及其指向的真实二进制）、`/opt/ZCode/zcode` 等标准位置；探测失败时按提示编辑同目录 `zcode-plus-config.json` 填 `zcodePath`（如 `/opt/ZCode/zcode`）。

### Linux：从源码运行（开发者）

```bash
git clone <本仓库地址>
cd zcode-plus
node controller.mjs     # 需本机已装 Node 18+（推荐 22+）
```

### WSL2 双系统同跑说明

WSL2 若启用镜像网络（`networkingMode=mirrored`），Windows 侧与 Linux 侧的 127.0.0.1 互通：ZCode+ 已内置平台判别，Windows 控制器只附着 Windows 实例、Linux 控制器只附着 Linux 实例，两侧同时启动互不干扰；端口冲突时自动顺延（9334-9350）。

### macOS（从源码运行）

前置条件：已安装 ZCode 桌面版 + [Node.js](https://nodejs.org) 18+（推荐 22+）。

```bash
git clone <本仓库地址>
cd zcode-plus
node install.mjs        # 部署到 ~/Library/Application Support/ZCodePlus
```

安装后获得真正的应用入口（无终端窗口，图标为 ZCode 原版反色：白底黑 Z）：

- **桌面「ZCode+.app」** 与 **`~/Applications/ZCode+.app`**（启动台可见）：双击即启动 ZCode+ 并自动注入，可拖入 Dock 常驻
- 重复点击入口不会重复注入：控制器单实例锁，只把已运行的 ZCode+ 窗口带到前台
- 自动探测 `/Applications`、`~/Applications` 与 Spotlight 索引中的 `ZCode.app`；失败时弹窗引导编辑 `zcode-plus-config.json`（支持 `.app` 包路径或内部可执行文件路径）
- 前台调试模式：`node controller.mjs`，或运行安装目录内 `ZCode+.command`（Terminal 可见日志）

## 使用

1. 通过「ZCode+」入口启动（原版 ZCode 运行中会弹窗询问是否重启）
2. 等待 2-3 秒，输入框左下角模式切换右侧出现星芒按钮 ✨
3. 写草稿 → 点击星芒（最长 90 秒，处理中再点可停止）→ 等待回填 → 检查 → 发送
4. 增强后左侧出现撤销按钮，一键恢复本轮增强前文案（不请求模型）
5. **右键星芒按钮**打开设置面板：

   - 增强模式三选一（含自定义模板编辑器，附示例模板一键填入）
   - 连接配置：跟随 ZCode 当前模型（默认，凭据不保存）/ 手动模式（Base URL、API Key、模型、协议三选）
   - 状态与诊断：最近错误、最近 8 次增强记录（脱敏）、最近一次完整结果（可复制）

## 配置文件

安装目录下的 `zcode-plus-config.json`（首次运行自动生成，带 `_readme` 说明）：

| 字段 | 说明 |
|---|---|
| `zcodePath` | ZCode 路径；留空 `""` 表示自动探测。Windows 填 `ZCode.exe` 完整路径（推荐正斜杠 `E:/zcode/ZCode.exe`，反斜杠需 `\\`）；Linux 填 `/opt/ZCode/zcode`；macOS 填 `.app` 包（如 `/Applications/ZCode.app`）或内部可执行文件 |
| `port` | 调试端口，默认 9333；被占用自动顺延 9334-9350 |

优先级：环境变量 `ZCODE_PLUS_ZCODE_PATH` > 配置文件 `zcodePath` > 自动探测。配置了 `zcodePath` 但路径无效时会明确报错，不会静默回退。

## 排错

| 现象 | 处理 |
|---|---|
| 提示"未找到 ZCode"（Windows: ZCode.exe / Linux: zcode / macOS: ZCode.app） | 按弹窗指引编辑安装目录下 `zcode-plus-config.json`，把 `zcodePath` 填为 ZCode 路径（Windows 示例 `E:/zcode/ZCode.exe`；Linux 示例 `/opt/ZCode/zcode`；macOS 示例 `/Applications/ZCode.app`），保存后重试 |
| 按钮不出现 | 确认从「ZCode+」入口启动（原版无 CDP 通道无注入）；等待 2-3 秒 |
| 增强失败 | 右键按钮 → 设置 → 复制错误信息到社区反馈 |
| 查看日志 | Windows 控制台启动 `ZCodePlus.exe controller.mjs`，Linux 前台运行 `./zcode-plus.sh`，macOS 运行安装目录 `ZCode+.command`（前台）或 `node controller.mjs`；日志在安装目录 `zcode-plus.log` |
| macOS 重复点击 ZCode+.app | 正常：单实例锁生效，仅聚焦已运行的 ZCode+ 窗口，不重复注入 |
| macOS 提示未找到 node | node 升级/移动后重跑 `node install.mjs` 重新生成 ZCode+.app（启动器内烘焙 node 路径） |
| 端口冲突 | 自动顺延 9334-9350；全占用则启动失败并写日志 |
| ZCode 大版本更新后按钮消失 | 页面结构可能变化，更新本仓库 inject.js 后重启 |

## 隐私与安全

- 增强请求只包含当前草稿文本，不携带会话历史、附件或代码库内容
- 自动模式凭据运行时读取（用户级 + 工作区级配置），仅存控制器内存
- 手动模式 API Key 保存于本机页面 localStorage
- CDP 调试端口仅监听 127.0.0.1（本机回环）；介意时关闭 ZCode 即彻底关闭端口

## 构建

```bash
node build-exe.mjs    # Windows 上运行：生成 win-x64.zip（本地）+ linux-x64.tar.gz（委托 WSL）双发行包
node make-icon.mjs    # 从 ZCode 原版图标像素级反色生成 ZCode+ 图标（Windows ico；mac icns 由 install.mjs 生成）
```

macOS 无需打包：`node install.mjs` 源码部署即可（发行包形态目前为 Windows / Linux）。

## 许可证与免责声明

### 开源许可

本项目以 [MIT License](LICENSE) 开源。

页面内图标改编自 [Lucide](https://lucide.dev)（ISC License）。

### 免责声明

- 本项目为**社区兴趣驱动的非官方移植**，与 ZCode 官方无任何关系；ZCode、其名称、商标、官方资源（含原版图标）归其权利人所有，本项目未获得其官方授权或认可
- 项目灵感来源于腾讯 WorkBuddy（桌面端 Agent 应用）的提示词增强功能，同样与腾讯 WorkBuddy 官方无隶属关系
- 本项目依赖 ZCode 桌面版的非公开内部接口（Chrome DevTools Protocol 注入与页面 DOM 结构），**不承诺对未来 ZCode 版本的兼容性**；ZCode 更新导致功能失效属预期风险，请谨慎用于生产环境
- 增强请求会将当前草稿发送至你配置的模型服务，可能消耗 API 额度；发送前请自行确认内容与配置
- 软件按「现状」提供，使用产生的一切后果由使用者自行承担

## 社区

感谢 [LINUX DO](https://linux.do/) 社区的支持。

问题反馈、功能讨论与交流，欢迎前往 [LINUX DO](https://linux.do/)。

<div align="center">

**ZCode+ —— 把模糊的想法，变成清晰的指令。**

</div>
