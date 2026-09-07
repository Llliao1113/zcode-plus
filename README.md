# ZCode+ 提示词增强

WorkBuddy「提示词增强」社区移植版（非 ZCode / WorkBuddy / Augment 官方产品）。在 ZCode 输入框左下角模式切换右侧注入星芒按钮：点击把当前草稿发给模型，改写得更清晰后回填输入框，检查后发送；支持撤销。另附 `/enhance`、`/enhance-creative` 两个斜杠技能（主模型就地增强，零配置）。

## 架构

```
桌面「ZCode+」快捷方式 → launcher.vbs → node controller.mjs
  ├─ 分配空闲端口（默认 9333，占用则顺延 9334-9350，启动前 bind 检测，杜绝冲突）
  ├─ 以 --remote-debugging-port 拉起 ZCode.exe（CDP 通道，不改安装目录）
  ├─ 向页面注入 inject.js（星芒按钮/回填/撤销/设置面板；刷新自动重注入）
  ├─ 页面经 CDP binding 把草稿发给控制器 → 调用模型 → 结果回传页面回填
  └─ 自动模式：读取 ZCode 当前模型配置（~/.zcode/v2/），Key 只存控制器内存
```

原 ZCode 桌面快捷方式不受影响：想用原版直接点原版（两者是同一个单实例应用，不能同时运行）；若原版已在跑，点 ZCode+ 会询问是否关闭原版并以 ZCode+ 重启。

## 安装 / 更新

要求：Node.js 18+（控制器用 Node 22+ 原生 WebSocket，推荐 24）。

```bash
cd zcode-plus
node install.mjs            # 自动探测 D:\Zcode\ZCode.exe；非此路径时 node install.mjs "<完整路径>"
```

重复运行即覆盖更新。更新模板/脚本后无需重装，controller 每次启动读取 inject.js 最新内容。

## 使用

- 双击桌面 **ZCode+** 启动（首次注入约在窗口就绪后 1-2 秒）
- 写草稿 → 点星芒按钮 → 等待回填（最长 90 秒，再点可停止）→ 检查后发送
- 增强后左侧出现撤销按钮，点击恢复本轮增强前文案（不请求模型）
- **右键星芒按钮**打开设置：增强模式三选一——WorkBuddy 原版（简洁，约 800 字符）/ 创意增强（充分展开）/ **自定义模板**（用户模板作为 user 消息直接发给模型，`{input}` 占位符表示草稿插入位置，必填，上限 2 万字符；选中后显示模板编辑器，可一键填入示例）；连接配置
- 自定义模板注意：输出排版规则（分段/逐项换行/代码块保护）仍会附加在系统消息里生效；模板在 localStorage 持久保存，随页面同域
- 连接配置两种模式：
  - **跟随 ZCode 当前模型**（默认）：读取当前会话模型对应的供应商；凭据运行时读取，不保存不落盘
  - **手动**：填 Base URL / API Key / 模型 / 协议（Chat Completions、Responses 或 Anthropic Messages）；手动 Key 保存在页面 localStorage
- 斜杠技能：`/enhance <草稿>`（WorkBuddy 模板）、`/enhance-creative <草稿>`（创意模板），主模型就地增强，不走外部配置

## 排错

1. 前台诊断：运行安装目录下 `start-zcode-plus.bat`，看控制台输出
2. 日志：安装目录 `zcode-plus.log`
3. 按钮不出现：确认是从 ZCode+ 快捷方式启动（原版无 CDP 无注入）；等待 2 秒
4. 增强失败：右键按钮 → 设置 → 复制错误/诊断
5. 端口被外部程序占用时会自动顺延 9334-9350；全占用则启动失败并写日志
6. ZCode 大版本更新后按钮消失：DOM 结构可能变化，更新 zcode-plus 源码中的选择器

## 安全说明

- API Key / OAuth 凭据只存在于控制器进程内存；不写盘、不进日志、不回传页面
- 草稿只发给所配置的模型服务（增强请求本身），不带会话历史、附件或代码库
- CDP 调试端口仅监听 127.0.0.1；本机其他进程理论上可连接该端口（等同开着 DevTools）。介意时关闭 ZCode 即彻底关闭端口
- 手动模式 API Key 保存于页面 localStorage（与原版行为一致）；错误提示自动脱敏

## 文件

| 文件 | 职责 |
|---|---|
| `controller.mjs` | CDP 控制器：端口分配、拉起 ZCode、注入、binding 通信、LLM 调用、自动模式配置解析 |
| `inject.js` | 页面脚本：星芒按钮、回填、撤销、设置面板、Toast、诊断 |
| `launcher.vbs` / `start-zcode-plus.bat` | 隐藏启动 / 前台诊断启动 |
| `make-icon.mjs` | 从 ZCode 原版图标（黑底白 Z）像素级反色生成 ZCode+ 图标（白底黑 Z），纯 Node PNG 解码/编码 + ICO 打包 |
| `install.mjs` | 安装/更新：复制到 %LOCALAPPDATA%\ZCodePlus、建桌面快捷方式 |
