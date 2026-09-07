<div align="center">

# ZCode+ 提示词增强

**为 ZCode 桌面版注入一键式提示词增强（Prompt Enhancement）**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-blue.svg)]()
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
桌面「ZCode+」入口（vbs 无窗口启动）
   └→ 本地控制器（常驻 Node 进程，凭据仅存于此）
        ├─ 分配空闲调试端口（默认 9333，占用自动顺延 9334-9350，启动前 bind 检测）
        ├─ 以 --remote-debugging-port 拉起 ZCode.exe（不改安装目录、不碰签名）
        ├─ CDP 向页面注入增强脚本（页面刷新/新窗口自动重注入）
        ├─ 页面脚本经 Runtime binding 发送当前草稿 → 控制器调用模型 → 回传
        └─ 页面回填（回填前校验草稿未变，改稿/切任务时结果保留不覆盖）
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

## 安装（Windows）

### 方式一：下载发行包（推荐，零依赖）

1. 从 [Releases](../../releases) 下载 `ZCodePlus-vX.Y.Z.zip`
2. 解压到任意目录（推荐 `%LOCALAPPDATA%\ZCodePlus`）
3. 双击文件夹内 **「启动 ZCode+.vbs」** 即可使用；右键发送到桌面快捷方式可获得带独立图标（ZCode 原版图标反色：白底黑 Z）的「ZCode+」入口

前置条件：已安装 ZCode 桌面版（首次运行自动探测常见安装路径，未找到会弹窗提示）。

### 方式二：从源码运行（开发者）

```bash
git clone <本仓库地址>
cd zcode-plus
node install.mjs        # 部署到 %LOCALAPPDATA%\ZCodePlus 并创建桌面快捷方式
```

或前台调试模式：`node controller.mjs`（控制台直接看日志）。

## 使用

1. 通过「ZCode+」入口启动（原版 ZCode 运行中会弹窗询问是否重启）
2. 等待 2-3 秒，输入框左下角模式切换右侧出现星芒按钮 ✨
3. 写草稿 → 点击星芒（最长 90 秒，处理中再点可停止）→ 等待回填 → 检查 → 发送
4. 增强后左侧出现撤销按钮，一键恢复本轮增强前文案（不请求模型）
5. **右键星芒按钮**打开设置面板：

   - 增强模式三选一（含自定义模板编辑器，附示例模板一键填入）
   - 连接配置：跟随 ZCode 当前模型（默认，凭据不保存）/ 手动模式（Base URL、API Key、模型、协议三选）
   - 状态与诊断：最近错误、最近 8 次增强记录（脱敏）、最近一次完整结果（可复制）

## 排错

| 现象 | 处理 |
|---|---|
| 按钮不出现 | 确认从「ZCode+」入口启动（原版无 CDP 通道无注入）；等待 2-3 秒 |
| 增强失败 | 右键按钮 → 设置 → 复制错误信息到社区反馈 |
| 查看日志 | 控制台启动 `ZCodePlus.exe controller.mjs`；日志在安装目录 `zcode-plus.log` |
| 端口冲突 | 自动顺延 9334-9350；全占用则启动失败并写日志 |
| ZCode 大版本更新后按钮消失 | 页面结构可能变化，更新本仓库 inject.js 后重启 |

## 隐私与安全

- 增强请求只包含当前草稿文本，不携带会话历史、附件或代码库内容
- 自动模式凭据运行时读取（用户级 + 工作区级配置），仅存控制器内存
- 手动模式 API Key 保存于本机页面 localStorage
- CDP 调试端口仅监听 127.0.0.1（本机回环）；介意时关闭 ZCode 即彻底关闭端口

## 构建

```bash
node build-exe.mjs    # 生成 dist/ZCodePlus-vX.Y.Z.zip（内嵌官方 Node 的发行包）
node make-icon.mjs    # 从 ZCode 原版图标像素级反色生成 ZCode+ 图标
```

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
