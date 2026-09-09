/*
ZCode+ 提示词增强注入脚本（WorkBuddy 社区移植，非 ZCode / WorkBuddy / Augment 官方产品）
- 注入星芒按钮（位于输入框左下角模式切换右侧）；点击把当前草稿发给 ZCode+ 控制器
- 控制器调用模型增强后回传，经快照校验回填输入框；支持撤销
- 右键星芒按钮打开设置面板；凭据不进页面，页面只与本地控制器通信
Icons adapted from Lucide v1.8.0 (Sparkles, LoaderCircle, Undo2, X), ISC License.
*/
(() => {
  // 版本由控制器注入（globalThis.__zcodePlusControllerVersion）；直接在浏览器调试时回退 "dev"。
  // 该值同时是运行时身份：控制器版本变化后重注入会替换旧运行时
  const VERSION = globalThis.__zcodePlusControllerVersion || "dev";
  const RUNTIME_KEY = "__zcodePlusEnhanceRuntime";
  const OWNER = "zcode-plus-v1";
  const SETTINGS_KEY = "zcodePlusEnhance.settings.v1";
  const BUTTON_ID = `wb-enhance-btn-${OWNER}`;
  const UNDO_ID = `wb-enhance-undo-${OWNER}`;
  const STYLE_ID = `wb-enhance-style-${OWNER}`;
  const TOAST_ID = `wb-enhance-toast-${OWNER}`;
  const PANEL_ID = `wb-enhance-panel-${OWNER}`;
  const REQUEST_TIMEOUT_MS = 90000;
  const POLL_MS = 1200;

  // ZCode 稳定锚点：composer 容器 / 输入框 / 模式切换 / 发送按钮（均带兜底）
  const COMPOSER_SELECTORS = [
    '[data-testid="v4-composer"]',
    '[data-testid="chat-composer"]',
    '[data-testid="chat-input"]',
  ];
  const INPUT_SELECTORS = [
    '[data-testid="v4-composer-input"]',
    '[data-testid="chat-input"]',
  ];
  const MODE_ANCHOR_SELECTORS = [
    '[data-testid="chat-mode-select-trigger"]',
    '[data-testid="chat-thought-level-select-trigger"]',
    '[data-testid="chat-attachment-button"]',
    '[data-testid="v4-composer-cua-entry"]',
    '[data-testid="chat-send-button"]',
    '[data-testid="v4-composer-send"]',
  ];
  const MODEL_LABEL_SELECTORS = [
    '[data-testid="chat-model-select-trigger"]',
    '[data-testid="v4-model-config"]',
  ];

  let disposed = false;
  const listeners = [];
  function listen(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    listeners.push(() => target.removeEventListener(event, handler, options));
  }

  // ---- 设置（仅模式与手动连接配置；自动凭据由控制器运行时读取，不落页面）----
  function defaultSettings() {
    return { mode: "auto", enhanceMode: "workbuddy", customTemplate: "", baseUrl: "", apiKey: "", model: "", protocol: "chat", omitStore: false, thinking: { enabled: false, effort: "medium" } };
  }
  function loadSettings() {
    const base = defaultSettings();
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return base;
      const p = JSON.parse(raw);
      if (!p || typeof p !== "object") return base;
      return {
        mode: p.mode === "manual" ? "manual" : "auto",
        enhanceMode: ["workbuddy", "creative", "custom"].includes(p.enhanceMode) ? p.enhanceMode : "workbuddy",
        customTemplate: typeof p.customTemplate === "string" ? p.customTemplate : "",
        baseUrl: typeof p.baseUrl === "string" ? p.baseUrl.trim() : base.baseUrl,
        apiKey: typeof p.apiKey === "string" ? p.apiKey : base.apiKey,
        model: typeof p.model === "string" ? p.model.trim() : base.model,
        protocol: ["responses", "chat", "anthropic"].includes(p.protocol) ? p.protocol : base.protocol,
        omitStore: p.omitStore === true,
        thinking: p.thinking && typeof p.thinking === "object" ? {
          enabled: p.thinking.enabled === true,
          effort: ["low", "medium", "high"].includes(p.thinking.effort) ? p.thinking.effort : "medium",
        } : base.thinking,
      };
    } catch { return base; }
  }
  function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      ...defaultSettings(),
      ...s,
      enhanceMode: ["workbuddy", "creative", "custom"].includes(s.enhanceMode) ? s.enhanceMode : "workbuddy",
    }));
  }

  // ---- 与控制器的 binding 通信 ----
  const pendingRequests = new Map();
  let requestSeq = 0;
  window.__wbEnhanceReply = function reply(id, payloadJson) {
    const entry = pendingRequests.get(Number(id));
    if (!entry) return;
    pendingRequests.delete(Number(id));
    let data;
    try { data = JSON.parse(payloadJson); } catch { data = { ok: false, error: "控制器返回无效数据" }; }
    if (data && data.ok) entry.resolve(data);
    else entry.reject(new Error((data && data.error) || "控制器处理失败"));
  };
  function readWorkspacePaths() {
    // 从 localStorage 的 last-session 键提取工作区路径（控制器据此读工作区级 provider 池）
    try {
      const prefix = "zcode-v4-last-session:v1:";
      return Object.keys(localStorage)
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
        // ZCode Windows 存盘符路径、Linux 存 POSIX 绝对路径（/home/...），两种形态都放行
        .filter((p) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("/"));
    } catch { return []; }
  }
  function controllerRequest(type, extra = {}, manualOverride) {
    if (typeof window.__wbEnhance !== "function") {
      return Promise.reject(new Error("ZCode+ 控制器未连接：请从「ZCode+」快捷方式启动"));
    }
    const id = ++requestSeq;
    const s = loadSettings();
    // manualOverride：设置面板传入表单当前值（未保存即生效）；null 表示显式走自动模式
    const manual = manualOverride !== undefined ? manualOverride
      : s.mode === "manual"
        ? { baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model, protocol: s.protocol, omitStore: s.omitStore }
        : null;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error("请求超过 90 秒，原文已保留"));
      }, REQUEST_TIMEOUT_MS);
      pendingRequests.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      try {
        window.__wbEnhance(JSON.stringify({ type, id, manual, thinking: s.thinking, modelLabel: readModelLabel(), workspacePaths: readWorkspacePaths(), ...extra }));
      } catch (error) {
        pendingRequests.delete(id);
        clearTimeout(timer);
        reject(new Error("无法联系 ZCode+ 控制器：" + String(error?.message || error)));
      }
    });
  }
  function readModelLabel() {
    for (const sel of MODEL_LABEL_SELECTORS) {
      const el = document.querySelector(sel);
      const label = (el?.textContent || "").trim();
      if (label && label.length < 80) return label;
    }
    return "";
  }

  // ---- Composer 定位与读写 ----
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function findComposerScope() {
    // 分屏可能有多个 composer：优先包含焦点的，其次最靠下（当前视图主输入区）
    const scopes = [];
    for (const sel of COMPOSER_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        if (el && isVisible(el) && !scopes.includes(el)) scopes.push(el);
      }
    }
    if (!scopes.length) return null;
    const focused = scopes.find((s) => s.contains(document.activeElement));
    if (focused) return focused;
    return scopes.reduce((best, el) => {
      const top = el.getBoundingClientRect().top;
      const bestTop = best.getBoundingClientRect().top;
      return top > bestTop ? el : best;
    }, scopes[0]);
  }
  function findComposerInput() {
    const scope = findComposerScope();
    const root = scope || document;
    // 先按精确 testid，再在 scope 内找可编辑元素，最后全页启发式（输入区在窗口下部）
    for (const sel of INPUT_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el) && (el.tagName === "TEXTAREA" || el.isContentEditable)) return el;
    }
    const candidates = root.querySelectorAll('textarea, [contenteditable="true"]');
    let best = null, bestTop = -Infinity;
    for (const el of candidates) {
      if (el.closest(`#${PANEL_ID}`) || !isVisible(el) || el.disabled || el.readOnly) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 200 || r.height < 24) continue;
      if (scope && !scope.contains(el)) continue;
      if (r.top < window.innerHeight * 0.3) continue;
      if (r.top > bestTop) { bestTop = r.top; best = el; }
    }
    return best;
  }
  function readText(el) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value;
    return el.innerText || el.textContent || "";
  }
  // 富文本编辑器（如 Lexical）在微任务里异步提交 DOM：写入后轮询回读，等提交落地再校验
  function waitEditorAccept(el, text, timeoutMs = 900) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      (function poll() {
        if (readText(el) === text) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(poll, 40);
      })();
    });
  }
  async function writeText(el, rawText) {
    const text = String(rawText).replace(/\r\n?/g, "\n");
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
      if (desc && desc.set) desc.set.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      const focus = document.activeElement;
      const selection = window.getSelection();
      const ranges = Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange());
      const original = readText(el);
      // 普通 white-space 会把纯文本回填中的换行及连续空格折叠
      el.style.whiteSpace = "pre-wrap";
      const selectAll = () => {
        el.focus({ preventScroll: true });
        const sel = window.getSelection();
        sel.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.addRange(range);
      };
      let done = false;
      // 通道1：控制器受信输入。控制器先发受信 Ctrl+A 全选再插入，镜像真实用户操作。
      // ZCode 3.11+ 的 Lexical 输入框对程序化选区与合成事件不认账（丢弃 execCommand、
      // 回滚直接 DOM 改写、粘贴按内部选区追加），受信按键走真实输入管线才可靠
      if (typeof window.__wbEnhance === "function") {
        try {
          el.focus({ preventScroll: true });
          if (document.activeElement === el) {
            await controllerRequest("insertText", { text });
            done = await waitEditorAccept(el, text);
          }
        } catch { done = false; }
      }
      // 通道2：合成粘贴（控制器不在时的降级；部分编辑器只按粘贴处理多行文本）
      if (!done) {
        try {
          selectAll();
          const data = new DataTransfer();
          data.setData("text/plain", text);
          el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
          done = await waitEditorAccept(el, text, 600);
        } catch { done = false; }
      }
      // 通道3：旧路径兜底（简单 contenteditable 编辑器；execCommand 产生真实 input 事件，
      // 受控组件的草稿状态才能同步）
      if (!done) {
        try {
          selectAll();
          document.execCommand("insertText", false, text);
        } catch {}
        done = await waitEditorAccept(el, text, 500);
        if (!done) {
          el.textContent = text;
          const caret = document.createRange();
          caret.selectNodeContents(el);
          caret.collapse(false);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(caret);
          el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
          done = await waitEditorAccept(el, text, 500);
        }
      }
      if (focus !== el && focus?.isConnected) {
        focus.focus({ preventScroll: true });
        if (document.activeElement === el) el.blur();
        selection.removeAllRanges();
        for (const range of ranges) {
          if (range.commonAncestorContainer.isConnected) selection.addRange(range);
        }
      }
      if (!done) {
        // 三通道全败：尽力恢复原草稿，避免半写入内容（如换行被丢弃的文本）覆盖原文
        if (readText(el) !== original) {
          try {
            el.focus({ preventScroll: true });
            if (document.activeElement === el && typeof window.__wbEnhance === "function") {
              await controllerRequest("insertText", { text: original });
            } else {
              selectAll();
              const data = new DataTransfer();
              data.setData("text/plain", original);
              el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
            }
            await waitEditorAccept(el, original, 500);
          } catch {}
        }
        throw new Error("输入框未完整接受写入内容，结果已保留");
      }
    }
    if (readText(el) !== text) throw new Error("输入框未完整接受写入内容，结果已保留");
  }
  function editorSnapshot(input) {
    return { text: readText(input), value: input.tagName === "TEXTAREA" ? input.value : null };
  }
  function snapshotMatches(input, snapshot) {
    const current = editorSnapshot(input);
    return current.text === snapshot.text && current.value === snapshot.value;
  }
  function captureTarget(input) {
    const scope = findComposerScope();
    return { input, scope, route: window.location.href };
  }
  function resolveTarget(target) {
    if (!target || target.route !== window.location.href) return null;
    if (!target.scope?.isConnected) return null;
    if (target.input?.isConnected && target.scope.contains(target.input) && isVisible(target.input)) return target.input;
    const candidates = [...target.scope.querySelectorAll('textarea, [contenteditable="true"]')]
      .filter((el) => isVisible(el) && !el.disabled && !el.readOnly);
    return candidates.length === 1 ? candidates[0] : null;
  }
  function safeError(error, secrets = []) {
    let text = String(error?.message || error || "未知错误");
    for (const secret of secrets) {
      if (secret) text = text.split(secret).join("[redacted]");
    }
    return text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 500);
  }

  // ---- 按钮注入（模式切换右侧；找不到则插到发送按钮前）----
  function findModeAnchor(scope) {
    if (!scope) return null;
    // 依次在 scope 及其上两层容器内找锚点；父层命中时校验锚点归属当前 composer，避免分屏插错面板
    const containers = [scope, scope.parentElement, scope.parentElement?.parentElement];
    for (let depth = 0; depth < containers.length; depth++) {
      const node = containers[depth];
      if (!node) continue;
      for (const sel of MODE_ANCHOR_SELECTORS) {
        const anchor = node.querySelector(sel);
        if (!anchor || !isVisible(anchor)) continue;
        if (depth > 0 && anchor.closest(COMPOSER_SELECTORS.join(",")) !== scope) continue;
        return { anchor, insertAfter: !/send-button|composer-send/.test(sel) };
      }
    }
    return null;
  }
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
      #${BUTTON_ID}, #${UNDO_ID} {
        display: inline-flex; align-items: center; justify-content: center;
        box-sizing: border-box; flex: 0 0 30px;
        width: 30px; min-width: 30px; height: 30px; padding: 0; margin: 0 2px;
        border: none; border-radius: 8px; cursor: pointer;
        background: transparent; color: inherit; opacity: 1; line-height: 1;
        transition: background .15s ease; vertical-align: middle;
      }
      #${BUTTON_ID}:hover, #${UNDO_ID}:hover:not(:disabled) { background: rgba(127,127,127,.18); }
      #${UNDO_ID} { flex-basis: 26px; width: 26px; min-width: 26px; }
      #${UNDO_ID}[hidden] { display: none !important; }
      #${UNDO_ID}:disabled { opacity: .4; cursor: default; }
      #${UNDO_ID} svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
      #${BUTTON_ID} .wb-enhance-icon {
        position: relative; display: block; flex: 0 0 18px; width: 18px; height: 18px;
        pointer-events: none;
      }
      #${BUTTON_ID} svg {
        position: absolute; inset: 0; display: block; width: 18px; height: 18px;
        fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round;
      }
      #${BUTTON_ID} .wb-enhance-sparkles { stroke-width: 1.75; }
      #${BUTTON_ID} .wb-enhance-spinner { visibility: hidden; stroke-width: 2.2; transform-origin: 50% 50%; }
      #${BUTTON_ID}[data-loading="1"] .wb-enhance-sparkles { visibility: hidden; }
      #${BUTTON_ID}[data-loading="1"] .wb-enhance-spinner {
        visibility: visible; animation: wbEnhanceIconSpin .9s linear infinite;
      }
      @keyframes wbEnhanceIconSpin { from { transform: rotate(-45deg); } to { transform: rotate(315deg); } }
      #${TOAST_ID} {
        position: fixed; bottom: 140px; left: 50%; transform: translateX(-50%);
        display: flex; align-items: center; gap: 10px;
        box-sizing: border-box; padding: 8px 12px; border-radius: 8px; z-index: 2147483647;
        background: rgba(30,30,30,.92); color: #fff; font: 13px/20px system-ui, sans-serif;
        box-shadow: 0 4px 16px rgba(0,0,0,.25); pointer-events: none;
        opacity: 0; visibility: hidden; transition: opacity .15s ease;
        width: max-content; max-width: min(560px, calc(100vw - 32px)); overflow-wrap: anywhere;
      }
      #${TOAST_ID}[data-show="1"] { opacity: 1; visibility: visible; pointer-events: auto; }
      #${TOAST_ID} span { min-width: 0; max-height: 144px; overflow-y: auto; }
      #${TOAST_ID} button {
        flex: 0 0 24px; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px;
        display: flex; align-items: center; justify-content: center; margin: 0; box-sizing: border-box;
        background: transparent; color: inherit; cursor: pointer; touch-action: manipulation;
      }
      #${TOAST_ID}[data-show="1"] button { pointer-events: auto; }
      #${TOAST_ID} button svg { display: block; width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; pointer-events: none; }
      #${TOAST_ID} button:hover { background: rgba(255,255,255,.15); }
      #${TOAST_ID}[data-kind="err"] { background: rgba(160,40,40,.95); }
      #${PANEL_ID} {
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center;
        font: 13px/1.5 system-ui, sans-serif; padding: 16px; color-scheme: light dark;
      }
      #${PANEL_ID}, #${PANEL_ID} * { box-sizing: border-box; letter-spacing: 0; }
      #${PANEL_ID} [hidden] { display: none !important; }
      #${PANEL_ID} .wb-panel {
        width: 560px; max-width: 100%; background: var(--theme-surface-color, light-dark(#fff, #242424));
        color: var(--theme-color-text, light-dark(#222, #eee));
        border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,.3);
        max-height: calc(100dvh - 32px); display: flex; flex-direction: column; overflow: hidden;
      }
      #${PANEL_ID} .wb-header, #${PANEL_ID} .wb-footer {
        display: flex; align-items: center; gap: 8px; padding: 14px 20px; flex: 0 0 auto;
      }
      #${PANEL_ID} .wb-header { border-bottom: 1px solid rgba(127,127,127,.22); }
      #${PANEL_ID} h3 { margin: 0; font-size: 16px; font-weight: 600; flex: 1; min-width: 0; }
      #${PANEL_ID} h3 small { font-size: 12px; font-weight: 400; color: light-dark(#666, #bbb); white-space: nowrap; }
      #${PANEL_ID} .wb-body { padding: 18px 20px; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
      #${PANEL_ID} section + section { margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(127,127,127,.22); }
      #${PANEL_ID} h4 { margin: 0 0 12px; font-size: 13px; font-weight: 600; }
      #${PANEL_ID} .wb-fields { display: grid; grid-template-columns: 88px minmax(0,1fr); gap: 12px; align-items: center; margin-top: 16px; }
      #${PANEL_ID} label { margin: 0; font-weight: 500; min-width: 0; }
      #${PANEL_ID} input:not([type="checkbox"]):not([type="radio"]):not([type="url"]), #${PANEL_ID} select, #${PANEL_ID} textarea {
        display: block; width: 100%; min-width: 0; padding: 7px 10px; border-radius: 6px;
        border: 1px solid rgba(127,127,127,.4); background: transparent;
        color: inherit; font: inherit;
      }
      #${PANEL_ID} input:not([type="checkbox"]):not([type="radio"]), #${PANEL_ID} select { height: 36px; }
      #${PANEL_ID} .wb-enhance-modes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); max-width: 480px; border: 1px solid rgba(127,127,127,.4); border-radius: 6px; }
      #${PANEL_ID} .wb-enhance-modes label { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; padding: 6px; font-size: 13px; cursor: pointer; overflow-wrap: anywhere; }
      #${PANEL_ID} .wb-enhance-modes label + label { border-left: 1px solid rgba(127,127,127,.4); }
      #${PANEL_ID} .wb-enhance-modes label:has(:checked) { background: light-dark(#e9eaeb, #404244); }
      #${PANEL_ID} .wb-enhance-modes input { appearance: auto; flex: 0 0 16px; width: 16px; height: 16px; margin: 0; accent-color: light-dark(#535557, #ddd); }
      #${PANEL_ID} .wb-custom-template { margin-top: 12px; }
      #${PANEL_ID} .wb-custom-template[hidden] { display: none !important; }
      #${PANEL_ID} .wb-template-hint { margin: 0 0 8px; font-size: 12px; color: light-dark(#666, #bbb); overflow-wrap: anywhere; }
      #${PANEL_ID} .wb-template-hint code { font: 12px ui-monospace, monospace; background: rgba(127,127,127,.15); padding: 1px 4px; border-radius: 3px; }
      #${PANEL_ID} textarea[data-wb="customTemplate"] { height: 180px; resize: vertical; margin: 0; }
      #${PANEL_ID} .wb-template-actions { display: flex; gap: 8px; margin-top: 8px; }
      #${PANEL_ID} .wb-check { display: flex; align-items: flex-start; gap: 9px; font-weight: 400; }
      #${PANEL_ID} .wb-check input[type="checkbox"] { appearance: auto; display: block; flex: 0 0 16px; width: 16px; height: 16px; margin: 2px 0 0; padding: 0; }
      #${PANEL_ID} .wb-check span { min-width: 0; overflow-wrap: anywhere; }
      #${PANEL_ID} .wb-model { display: flex; gap: 8px; min-width: 0; }
      #${PANEL_ID} [data-wb="status"] { min-height: 20px; max-height: 120px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
      #${PANEL_ID} [data-wb="status"][data-error="1"] { color: light-dark(#a52626, #ffaaaa); }
      #${PANEL_ID} details { margin-top: 12px; min-width: 0; }
      #${PANEL_ID} summary { cursor: pointer; font-weight: 500; }
      #${PANEL_ID} pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.6 ui-monospace, monospace; max-height: 160px; overflow-y: auto; margin: 10px 0; }
      #${PANEL_ID} textarea { height: 150px; resize: vertical; margin: 10px 0; }
      #${PANEL_ID} .wb-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
      #${PANEL_ID} button { flex-shrink: 0; min-height: 36px; padding: 6px 12px; border-radius: 6px; border: 1px solid rgba(127,127,127,.4); background: transparent; color: inherit; cursor: pointer; font: inherit; }
      #${PANEL_ID} button:hover:not(:disabled) { background: rgba(127,127,127,.12); }
      #${PANEL_ID} :disabled { opacity: .6; cursor: default; }
      #${PANEL_ID} :focus-visible { outline: 2px solid light-dark(#2773c7, #88bfff); outline-offset: 2px; }
      #${PANEL_ID} .wb-footer { border-top: 1px solid rgba(127,127,127,.22); }
      #${PANEL_ID} [data-wb="reset"] { margin-right: auto; border-color: transparent; }
      #${PANEL_ID} button.wb-primary { background: light-dark(#222, #eee); color: light-dark(#fff, #222); border-color: transparent; font-weight: 600; }
      #${PANEL_ID} button.wb-primary:hover { background: light-dark(#444, #ccc); }
      #${PANEL_ID} button.wb-icon { display: grid; place-items: center; width: 32px; min-height: 32px; padding: 0; border: 0; }
      #${PANEL_ID} .wb-icon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.75; }
      @media (max-width: 440px) {
        #${PANEL_ID} { padding: 8px; }
        #${PANEL_ID} .wb-panel { max-height: calc(100dvh - 16px); }
        #${PANEL_ID} .wb-header, #${PANEL_ID} .wb-footer { padding: 12px; }
        #${PANEL_ID} .wb-body { padding: 14px 12px; }
        #${PANEL_ID} .wb-fields { grid-template-columns: minmax(0,1fr); gap: 6px; }
        #${PANEL_ID} .wb-fields > label:not(:first-child) { margin-top: 6px; }
        #${PANEL_ID} h3 { font-size: 14px; }
      }
    `;
    document.head.appendChild(st);
  }
  function ensureToast() {
    if (document.getElementById(TOAST_ID)) return;
    const t = document.createElement("div");
    t.id = TOAST_ID;
    t.setAttribute("aria-live", "polite");
    t.setAttribute("aria-atomic", "true");
    const message = document.createElement("span");
    message.dataset.wb = "message";
    const close = document.createElement("button");
    close.type = "button";
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"/></svg>';
    close.title = "关闭提示";
    close.setAttribute("aria-label", "关闭提示");
    close.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); hideToast(); });
    t.append(message, close);
    t.addEventListener("mouseenter", () => clearTimeout(toastTimer));
    t.addEventListener("mouseleave", () => scheduleToast(t));
    t.addEventListener("focusin", () => clearTimeout(toastTimer));
    t.addEventListener("focusout", () => scheduleToast(t));
    document.body.appendChild(t);
  }
  let toastTimer = 0;
  let lastDiagnostic = "";
  function hideToast() {
    if (disposed) return;
    clearTimeout(toastTimer);
    const t = document.getElementById(TOAST_ID);
    if (t) t.dataset.show = "0";
  }
  function scheduleToast(t) {
    clearTimeout(toastTimer);
    if (t.dataset.kind === "progress" || t.dataset.show !== "1" || t.matches(":hover, :focus-within")) return;
    toastTimer = setTimeout(hideToast, t.dataset.kind === "err" ? 5000 : 2000);
  }
  function toast(msg, kind) {
    if (disposed) return;
    if (kind === "err") lastDiagnostic = msg;
    ensureToast();
    const t = document.getElementById(TOAST_ID);
    if (!t) return;
    t.querySelector('[data-wb="message"]').textContent = msg;
    t.dataset.kind = kind === "err" ? "err" : kind === "progress" ? "progress" : "ok";
    t.setAttribute("role", kind === "err" ? "alert" : "status");
    t.dataset.show = "1";
    scheduleToast(t);
  }

  // ---- 增强 / 撤销 ----
  let lastState = null;
  let buttonInput = null;
  let loading = false;
  let retainedResult = null;
  let enhanceController = null;
  const requestHistory = [];
  let refreshSettingsActivity = () => {};
  function enhancementInput() {
    const scope = document.getElementById(BUTTON_ID)?.closest(COMPOSER_SELECTORS.join(","));
    if (!scope) return buttonInput?.isConnected ? buttonInput : findComposerInput();
    if (buttonInput?.isConnected && scope.contains(buttonInput)) return buttonInput;
    const candidates = [...scope.querySelectorAll('textarea, [contenteditable="true"]')].filter(isVisible);
    return candidates.length === 1 ? candidates[0] : findComposerInput();
  }
  async function applyEnhancement(target, before, text) {
    const input = resolveTarget(target);
    if (!input) return { state: "stale", reason: "输入区域已变化或页面已切换" };
    if (!snapshotMatches(input, before)) return { state: "conflict", reason: "原文已修改" };
    lastState = null;
    await writeText(input, text);
    const written = resolveTarget(target);
    if (!written) throw new Error("回填后无法确认输入框状态，结果已保留，可在设置中复制");
    if (!readText(written).trim()) throw new Error("编辑器回填内容为空，结果已保留，可在设置中复制");
    if (!snapshotMatches(written, before)) lastState = { target: { ...target, input: written }, before, after: editorSnapshot(written) };
    return { state: "applied" };
  }
  function undoAvailability() {
    if (!lastState) return { reason: "没有可撤销的增强", input: null };
    const input = resolveTarget(lastState.target);
    if (!input) return { reason: "输入区域已变化，不能撤销", input: null };
    if (loading) return { reason: "增强中，暂不可撤销", input };
    try {
      if (snapshotMatches(input, lastState.before)) {
        return { reason: "已恢复增强前内容", input: null, restored: true };
      }
      if (!snapshotMatches(input, lastState.after)) return { input, reason: "内容已修改，不能直接撤销" };
      return { input, reason: "" };
    } catch (error) {
      return { input, reason: safeError(error) };
    }
  }
  function updateUndoButton() {
    if (disposed) return;
    const undo = document.getElementById(UNDO_ID);
    if (!undo) return;
    const state = undoAvailability();
    if (state.restored) lastState = null;
    undo.hidden = !state.input;
    undo.disabled = !!state.reason;
    undo.title = state.reason || "撤销本轮增强";
    undo.setAttribute("aria-label", undo.title);
  }
  async function onUndo() {
    if (disposed) return;
    const { input, reason } = undoAvailability();
    if (reason) {
      updateUndoButton();
      toast(reason + "，未覆盖输入框", "err");
      return;
    }
    try {
      const before = lastState.before;
      await writeText(input, before.text);
      const written = resolveTarget(lastState.target);
      if (!written || !snapshotMatches(written, before)) {
        lastState = null;
        throw new Error("无法确认原文已完整恢复，请检查输入框");
      }
      lastState = null;
      setLoading(false);
      toast("已撤销本轮增强", "ok");
    } catch (error) {
      updateUndoButton();
      toast(safeError(error), "err");
    }
  }
  function activityText() {
    return requestHistory.map((r) => {
      const elapsed = ((r.finished || Date.now()) - r.started) / 1000;
      return `${r.id} | ${new Date(r.started).toLocaleTimeString()} | ${r.outcome || "进行中"} | ${elapsed.toFixed(1)} 秒\n`
        + `${r.stage || "-"}${r.error ? "\n" + r.error : ""}`;
    }).join("\n\n");
  }
  function setLoading(on) {
    if (disposed) return;
    loading = on;
    const b = document.getElementById(BUTTON_ID);
    if (b) {
      b.dataset.loading = on ? "1" : "0";
      b.title = on ? "增强中，点击停止" : "增强提示词；右键打开设置";
      b.setAttribute("aria-label", b.title);
    }
    updateUndoButton();
  }
  async function onEnhance() {
    if (disposed) return;
    if (loading) { enhanceController?.reject?.(new Error("已停止")); return; }
    hideToast();
    const input = enhancementInput();
    if (!input) { toast("未找到输入框", "err"); return; }
    let before, target;
    try {
      before = editorSnapshot(input);
      target = captureTarget(input);
    } catch (error) { toast(safeError(error), "err"); return; }
    const cur = before.text;
    if (!cur.trim()) { toast("输入为空，先写点内容", "err"); return; }
    const s = loadSettings();
    setLoading(true);
    // 可中断句柄：enhanceController 必须是带 reject 的对象（Promise 实例没有 reject
    // 方法，误存 Promise 会让点停止时的调用抛 TypeError 且被 async 静默吞掉）
    const stopHandle = { reject: null };
    const request = new Promise((resolve, reject) => {
      stopHandle.reject = reject;
      controllerRequest("enhance", { draft: cur, enhanceMode: s.enhanceMode, customTemplate: s.enhanceMode === "custom" ? s.customTemplate : undefined }).then(resolve, reject);
    });
    enhanceController = stopHandle;
    const record = { id: `ZP-${Date.now().toString(36)}`, started: Date.now(), stage: "读取配置", outcome: "" };
    requestHistory.unshift(record);
    requestHistory.length = Math.min(requestHistory.length, 8);
    const progressTimer = setInterval(() => {
      if (record.stage === "读取配置") record.stage = "等待服务响应";
    }, 1500);
    toast("增强中 · 等待服务响应（点击增强按钮停止）", "progress");
    try {
      const result = await request;
      const cleaned = String(result.text || "").trim();
      if (!cleaned) throw new Error("增强结果为空");
      record.stage = "写回输入框";
      retainedResult = { text: cleaned, at: Date.now() };
      const current = resolveTarget(target);
      if (!current || !snapshotMatches(current, before)) {
        record.outcome = "结果已保留";
        record.error = "输入区已变化，未覆盖输入框";
        toast("增强已完成，但输入区已变化，结果已保留，可在设置中复制。", "err");
        return;
      }
      await writeText(current, cleaned);
      lastState = { target: { ...target, input: current }, before, after: editorSnapshot(current) };
      record.outcome = "已写回";
      toast("已增强，请检查后发送", "ok");
    } catch (error) {
      const stopped = /已停止|AbortError/.test(String(error?.message || ""));
      if (stopped) {
        record.outcome = "已取消";
        toast("已停止，原文未改动", "ok");
      } else {
        record.outcome = "失败";
        record.error = safeError(error, [s.apiKey, cur]);
        toast("增强失败: " + record.error + (retainedResult?.at >= record.started ? "\n最近结果已保留，可在设置中复制。" : ""), "err");
      }
    } finally {
      clearInterval(progressTimer);
      record.finished = Date.now();
      if (enhanceController === stopHandle) { enhanceController = null; setLoading(false); }
      refreshSettingsActivity();
    }
  }

  // ---- 设置面板（右键增强按钮打开）----
  function openSettings() {
    ensureStyles();
    hideToast();
    const old = document.getElementById(PANEL_ID);
    if (old) old.querySelector('[data-wb="close"]').click();
    const s = loadSettings();
    const overlay = document.createElement("div");
    overlay.id = PANEL_ID;
    overlay.innerHTML = `
      <div class="wb-panel" role="dialog" aria-modal="true" aria-labelledby="wb-settings-title" tabindex="-1">
        <header class="wb-header">
          <h3 id="wb-settings-title">ZCode+ 增强设置 <small>${VERSION}</small></h3>
          <button class="wb-icon" data-wb="close" type="button" aria-label="关闭设置" title="关闭设置"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12"/></svg></button>
        </header>
        <div class="wb-body">
        <section>
        <h4>增强模式</h4>
        <div class="wb-enhance-modes" role="group" aria-label="增强模式">
          <label><input type="radio" name="wb-enhance-mode" data-wb="workbuddyMode" value="workbuddy" />WorkBuddy 原版</label>
          <label><input type="radio" name="wb-enhance-mode" data-wb="creativeMode" value="creative" />创意增强</label>
          <label><input type="radio" name="wb-enhance-mode" data-wb="customMode" value="custom" />自定义模板</label>
        </div>
        <div class="wb-custom-template" data-wb="templateSection" hidden>
          <p class="wb-template-hint">模板将以用户消息直接发给模型；用 <code>{input}</code> 表示草稿插入位置（必填）。输出排版规则仍会附加在系统消息里。</p>
          <textarea data-wb="customTemplate" aria-label="自定义提示词模板" placeholder="你是提示词增强助手。把下面的草稿改写得更清晰、更具体，保持原语言：

{input}"></textarea>
          <div class="wb-template-actions">
            <button data-wb="fillExample" type="button">填入示例</button>
            <button data-wb="clearTemplate" type="button">清空</button>
          </div>
        </div>
        </section>
        <section>
        <h4>连接配置</h4>
        <label class="wb-check"><input data-wb="auto" type="checkbox" /><span>跟随 ZCode 当前模型（自动读取，凭据不保存）</span></label>
        <div class="wb-fields">
        <label for="wb-base-url">Base URL</label>
        <input id="wb-base-url" data-wb="baseUrl" type="text" />
        <label for="wb-api-key">API Key</label>
        <input id="wb-api-key" data-wb="apiKey" type="password" aria-label="API Key（你的服务密钥）" autocomplete="off" />
        <label for="wb-model">模型</label>
        <div class="wb-model">
          <input id="wb-model" data-wb="model" list="wb-model-list" />
          <button data-wb="fetchModels" type="button">拉取模型</button>
        </div>
        <label for="wb-protocol">API 协议</label>
        <select id="wb-protocol" data-wb="protocol">
          <option value="chat">Chat Completions</option>
          <option value="responses">Responses</option>
          <option value="anthropic">Anthropic Messages</option>
        </select>
        </div>
        <datalist id="wb-model-list"></datalist>
        <label class="wb-check"><input data-wb="omitStore" type="checkbox" /><span>Responses 兼容：省略 store（保存策略由服务端决定）</span></label>
        <label class="wb-check"><input data-wb="thinkingEnabled" type="checkbox" /><span>模型思考模式（推理更深但更慢；自动/手动连接均生效）</span></label>
        <div class="wb-fields">
        <label for="wb-thinking-effort">思考强度</label>
        <select id="wb-thinking-effort" data-wb="thinkingEffort" disabled>
          <option value="low">低（快速）</option>
          <option value="medium">中（均衡）</option>
          <option value="high">高（深入）</option>
        </select>
        </div>
        <div class="wb-row">
          <button data-wb="readZcode" type="button">读取 ZCode 配置</button>
          <button data-wb="testConn" type="button">测试连接</button>
        </div>
        </section>
        <section>
        <h4>状态与诊断</h4>
        <div data-wb="status" role="status" aria-live="polite">尚未测试连接</div>
        <details data-wb="diagnostic">
          <summary>最近一次错误</summary>
          <pre data-wb="errorDetail"></pre>
          <button data-wb="copyError" type="button">复制错误</button>
        </details>
        <details data-wb="activity">
          <summary>最近增强记录</summary>
          <pre data-wb="activityDetail"></pre>
          <button data-wb="copyActivity" type="button">复制诊断</button>
        </details>
        </section>
        <section data-wb="resultSection" hidden>
          <h4>最近增强结果 <small data-wb="resultTime"></small></h4>
          <textarea data-wb="result" readonly aria-label="最近增强结果"></textarea>
          <button data-wb="copyResult" type="button">复制结果</button>
        </section>
        </div>
        <footer class="wb-footer">
          <button data-wb="reset">恢复默认</button>
          <button data-wb="cancel">取消</button>
          <button data-wb="save" class="wb-primary">保存</button>
        </footer>
      </div>`;
    document.body.appendChild(overlay);
    const q = (k) => overlay.querySelector(`[data-wb="${k}"]`);
    const previousFocus = document.activeElement;
    let busy = false;
    refreshSettingsActivity = () => {
      if (!overlay.isConnected) return;
      q("activity").hidden = !requestHistory.length;
      q("activityDetail").textContent = activityText();
      q("diagnostic").hidden = !lastDiagnostic;
      if (q("errorDetail").textContent !== lastDiagnostic) q("errorDetail").textContent = lastDiagnostic;
      q("resultSection").hidden = !retainedResult;
      if (retainedResult && q("result").value !== retainedResult.text) {
        q("result").value = retainedResult.text;
        q("resultTime").textContent = new Date(retainedResult.at).toLocaleTimeString();
      }
    };
    refreshSettingsActivity();
    for (const [button, field, label] of [["copyActivity", "activityDetail", "诊断"], ["copyResult", "result", "结果"], ["copyError", "errorDetail", "错误信息"]]) {
      q(button).addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(field === "result" ? q(field).value : q(field).textContent);
          q("status").textContent = `${label}已复制`;
        } catch {
          q("status").textContent = `无法访问剪贴板，请选中${label}复制`;
          if (field === "result") { q(field).focus(); q(field).select(); }
        }
      });
    }
    q("auto").checked = s.mode === "auto";
    q("workbuddyMode").checked = s.enhanceMode === "workbuddy";
    q("creativeMode").checked = s.enhanceMode === "creative";
    q("customMode").checked = s.enhanceMode === "custom";
    q("customTemplate").value = s.customTemplate;
    q("baseUrl").value = s.baseUrl;
    q("apiKey").value = s.apiKey;
    q("model").value = s.model;
    q("protocol").value = s.protocol;
    q("omitStore").checked = s.omitStore;
    q("thinkingEnabled").checked = s.thinking.enabled;
    q("thinkingEffort").value = s.thinking.effort;
    q("thinkingEffort").disabled = !s.thinking.enabled;
    q("errorDetail").textContent = lastDiagnostic;
    function close() {
      overlay.remove();
      refreshSettingsActivity = () => {};
      if (previousFocus?.isConnected) previousFocus.focus();
    }
    function formSettings() {
      return {
        mode: q("auto").checked ? "auto" : "manual",
        enhanceMode: q("customMode").checked ? "custom" : q("creativeMode").checked ? "creative" : "workbuddy",
        customTemplate: q("customTemplate").value,
        baseUrl: q("baseUrl").value.trim(), apiKey: q("apiKey").value.trim(),
        model: q("model").value.trim(), protocol: q("protocol").value,
        omitStore: q("omitStore").checked,
        thinking: { enabled: q("thinkingEnabled").checked, effort: q("thinkingEffort").value },
      };
    }
    // 拉取模型/测试连接用表单当前值实时请求，无需先保存
    function formManual() {
      if (q("auto").checked) return null;
      return {
        baseUrl: q("baseUrl").value.trim(), apiKey: q("apiKey").value.trim(),
        model: q("model").value.trim(), protocol: q("protocol").value, omitStore: q("omitStore").checked,
      };
    }
    const TEMPLATE_EXAMPLE = `你是提示词增强助手。把下面的用户草稿改写成一个更清晰、更具体、更可执行的请求，交给下游编程助手使用。

规则：
- 与草稿完全同语言（中文进中文出）
- 保留原意、约束与代码/路径/报错原文，逐字不改动
- 只输出改写后的提示词本身，不带解释或前言

草稿：
{input}`;
    function syncTemplateSection() {
      q("templateSection").hidden = !q("customMode").checked;
    }
    for (const key of ["workbuddyMode", "creativeMode", "customMode"]) {
      q(key).addEventListener("change", syncTemplateSection);
    }
    q("fillExample").addEventListener("click", () => {
      q("customTemplate").value = TEMPLATE_EXAMPLE;
      q("customTemplate").focus();
    });
    q("clearTemplate").addEventListener("click", () => {
      q("customTemplate").value = "";
      q("customTemplate").focus();
    });
    function updateMode() {
      const auto = q("auto").checked;
      for (const field of ["baseUrl", "apiKey", "model", "protocol"]) q(field).disabled = auto;
      if (auto) {
        q("apiKey").value = "";
        q("apiKey").placeholder = "运行时读取，不保存";
      } else {
        q("apiKey").placeholder = "";
        // 从「自动」切到「手动」：清空由 readZcode 回填的网关地址与模型，避免
        // 继承一套用户没有 key 的私有网关配置（协议保持用户选择，chat 默认）
        if (q("baseUrl").dataset.fromAuto === "1") {
          q("baseUrl").value = "";
          q("model").value = "";
          delete q("baseUrl").dataset.fromAuto;
        }
      }
    }
    // 读取 ZCode 配置：只回填 baseUrl/model；协议保持用户上次选择（chat 为默认）。
    // 不回填 protocol：auto 解析出的协议（如内置 plan 端点 anthropic）是网关实现细节，
    // 回填会让手动模式继承一套与用户真实服务不匹配的协议，造成交叉污染
    async function run(action) {
      if (busy) return;
      busy = true;
      for (const key of ["readZcode", "fetchModels", "testConn"]) q(key).disabled = true;
      q("status").textContent = "处理中…";
      q("status").dataset.error = "0";
      try {
        if (action === "read") {
          const cfg = await controllerRequest("readConfig");
          q("baseUrl").value = cfg.baseUrl || "";
          q("baseUrl").dataset.fromAuto = "1";
          q("model").value = cfg.model || "";
          q("status").textContent = `已读取当前模型：${cfg.model}\n供应商 ${cfg.providerId}；凭据来源 ${cfg.keySource}（不保存）`;
        } else if (action === "models") {
          const result = await controllerRequest("models", {}, formManual());
          const list = overlay.querySelector("#wb-model-list");
          list.replaceChildren();
          for (const id of result.models || []) {
            const option = document.createElement("option");
            option.value = id;
            list.appendChild(option);
          }
          // 模型输入框是受控 React 组件：datalist 塞 option 不触发重渲。这里主动清空一次
          // 值（触发 input 事件让 React 状态更新），恢复后输入任意前缀即弹出目录下拉；
          // 当前值若在目录中则保留显示
          const modelInput = q("model");
          const current = modelInput.value.trim();
          const models = result.models || [];
          if (current && models.includes(current)) {
            modelInput.dataset.cataloged = "1";
          } else {
            modelInput.value = "";
            modelInput.dataset.cataloged = "1";
            modelInput.dispatchEvent(new Event("input", { bubbles: true }));
            modelInput.focus();
            modelInput.placeholder = models.length ? "输入过滤，从下拉选择" : "(服务返回空模型列表)";
          }
          q("status").textContent = models.length ? `已拉取 ${models.length} 个模型` : "服务返回空模型列表";
        } else {
          const result = await controllerRequest("test", {}, formManual());
          q("status").textContent = result.message || "连接成功";
        }
      } catch (error) {
        const detail = safeError(error, [q("apiKey").value]);
        q("status").textContent = detail;
        q("status").dataset.error = "1";
        lastDiagnostic = detail;
        q("errorDetail").textContent = detail;
        q("diagnostic").hidden = false;
      } finally {
        busy = false;
        for (const key of ["readZcode", "fetchModels", "testConn"]) q(key).disabled = false;
      }
    }
    q("readZcode").addEventListener("click", () => void run("read"));
    q("fetchModels").addEventListener("click", () => void run("models"));
    q("testConn").addEventListener("click", () => void run("test"));
    q("thinkingEnabled").addEventListener("change", () => {
      q("thinkingEffort").disabled = !q("thinkingEnabled").checked;
    });
    q("auto").addEventListener("change", () => {
      updateMode();
      q("status").textContent = "";
      q("status").dataset.error = "0";
      if (q("auto").checked) void run("read");
    });
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) close();
    });
    q("reset").addEventListener("click", () => {
      const d = defaultSettings();
      q("auto").checked = true;
      q("workbuddyMode").checked = true;
      q("creativeMode").checked = false;
      q("customMode").checked = false;
      q("customTemplate").value = d.customTemplate;
      q("baseUrl").value = d.baseUrl;
      q("apiKey").value = d.apiKey;
      q("model").value = d.model;
      q("protocol").value = d.protocol;
      q("omitStore").checked = d.omitStore;
      q("thinkingEnabled").checked = d.thinking.enabled;
      q("thinkingEffort").value = d.thinking.effort;
      q("thinkingEffort").disabled = !d.thinking.enabled;
      updateMode();
      syncTemplateSection();
      q("status").dataset.error = "0";
    });
    q("cancel").addEventListener("click", close);
    q("close").addEventListener("click", close);
    overlay.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); }
      if (ev.key !== "Tab") return;
      const controls = [...overlay.querySelectorAll('button,input,select,textarea,summary,[tabindex="0"]')]
        .filter((el) => !el.disabled && el.getClientRects().length > 0);
      const index = controls.indexOf(document.activeElement);
      if (ev.shiftKey ? index <= 0 : index === controls.length - 1 || index < 0) {
        ev.preventDefault();
        (ev.shiftKey ? controls.at(-1) : controls[0])?.focus();
      }
    });
    q("save").addEventListener("click", () => {
      try {
        const next = formSettings();
        if (next.enhanceMode === "custom") {
          if (!next.customTemplate.trim()) throw new Error("自定义模板为空：请编辑模板或切换增强模式");
          if (next.customTemplate.length > 20000) throw new Error("自定义模板过长（上限 20000 字符）");
          if (!next.customTemplate.includes("{input}")) throw new Error("自定义模板缺少 {input} 占位符（草稿插入位置）");
        }
        saveSettings(next);
        close();
        toast("设置已保存", "ok");
      } catch (error) {
        q("status").textContent = safeError(error, [q("apiKey").value]);
        q("status").dataset.error = "1";
        q("status").scrollIntoView({ block: "nearest" });
      }
    });
    updateMode();
    syncTemplateSection();
    if (s.mode === "auto") void run("read");
    q("auto").focus();
  }

  // ---- 按钮生命周期 ----
  function ensureUndoButton(button) {
    let undo = document.getElementById(UNDO_ID);
    if (!undo) {
      undo = document.createElement("button");
      undo.id = UNDO_ID;
      undo.type = "button";
      undo.hidden = true;
      undo.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/></svg>';
      undo.addEventListener("click", onUndo);
    }
    if (undo.nextElementSibling !== button) button.before(undo);
    updateUndoButton();
  }
  function findAnchorFallback(input) {
    // 兜底：从输入框向上找含可见按钮的容器，插到最后一个按钮前（原 Codex 版策略）
    let node = input;
    for (let i = 0; i < 8 && node; i++) {
      node = node.parentElement;
      if (!node) break;
      const btns = [...node.querySelectorAll("button")].filter(isVisible);
      if (btns.length) return { anchor: btns[btns.length - 1], insertAfter: false };
    }
    return null;
  }
  function ensureButton() {
    if (disposed) return;
    const existing = document.getElementById(BUTTON_ID);
    if (existing) { ensureUndoButton(existing); return; }
    buttonInput = findComposerInput();
    if (!buttonInput) return;
    const scope = findComposerScope();
    const found = findModeAnchor(scope) || findAnchorFallback(buttonInput);
    if (!found) return;
    ensureStyles();
    ensureToast();
    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.type = "button";
    btn.title = "增强提示词；右键打开设置";
    btn.innerHTML = `<span class="wb-enhance-icon" aria-hidden="true">
      <svg class="wb-enhance-sparkles" viewBox="0 0 24 24" focusable="false">
        <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>
        <path d="M20 2v4M22 4h-4"/>
      </svg>
      <svg class="wb-enhance-spinner" viewBox="0 0 24 24" focusable="false">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
    </span>`;
    btn.addEventListener("click", (ev) => {
      if (ev.detail > 1) return; // 双击只执行第一下
      void onEnhance();
    });
    btn.addEventListener("contextmenu", (ev) => { ev.preventDefault(); openSettings(); });
    try {
      if (found.insertAfter) found.anchor.after(btn);
      else found.anchor.before(btn);
    } catch {
      found.anchor.parentNode?.appendChild(btn);
    }
    ensureUndoButton(btn);
    setLoading(loading);
  }

  let mutationTimer = 0;
  const previousRuntime = globalThis[RUNTIME_KEY];
  if (previousRuntime?.version === VERSION && !previousRuntime.disposed) return;
  previousRuntime?.dispose();
  let pollTimer = 0;
  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(ensureButton, 200);
  });
  function start() {
    if (disposed) return;
    ensureStyles();
    ensureButton();
    listen(document, "input", updateUndoButton, true);
    listen(document, "keyup", updateUndoButton, true);
    listen(document, "compositionend", updateUndoButton, true);
    pollTimer = setInterval(ensureButton, POLL_MS);
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  }
  globalThis[RUNTIME_KEY] = {
    version: VERSION,
    get disposed() { return disposed; },
    dispose() {
      if (disposed) return;
      disposed = true;
      enhanceController?.reject?.(new Error("脚本已卸载"));
      enhanceController = null;
      observer.disconnect();
      clearTimeout(mutationTimer);
      clearInterval(pollTimer);
      clearTimeout(toastTimer);
      for (const remove of listeners.splice(0)) remove();
      document.getElementById(PANEL_ID)?.querySelector('[data-wb="close"]')?.click();
      for (const id of [BUTTON_ID, UNDO_ID, TOAST_ID, PANEL_ID, STYLE_ID]) document.getElementById(id)?.remove();
      lastState = null;
      retainedResult = null;
      refreshSettingsActivity = () => {};
    },
  };
  if (document.readyState === "loading") listen(document, "DOMContentLoaded", start);
  else start();
})();
