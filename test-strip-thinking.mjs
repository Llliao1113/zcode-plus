#!/usr/bin/env node
/*
stripThinking 单测：覆盖思考链三种形态（成对块/孤立闭合/未闭合截断）、
大小写变体与真实故障样本。零依赖，直接 node test-strip-thinking.mjs 运行，
退出码非 0 表示有失败（可用于 CI）。

函数源码用正则从 controller.mjs 提取而非 import：controller 顶层即执行 main()，
且 SEA 发行形态（build-exe.mjs）下 process.argv[1] 语义不同，无法用
argv[1]===import.meta.url 守卫区分「直接运行」与「被导入」。
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "controller.mjs"), "utf8");
const m = src.match(/function stripThinking[\s\S]*?\n}/);
if (!m) { console.error("未在 controller.mjs 中找到 stripThinking"); process.exit(1); }
const stripThinking = new Function(`${m[0]}; return stripThinking;`)();

const cases = [
  // [名称, 输入, 期望输出（"" 表示应为空）]
  ["孤立闭合（真实故障样本：兼容层吞掉开标签）", "The user wants me to enhance... let me check the character count.</think>修复状态栏的显示 bug", "修复状态栏的显示 bug"],
  ["成对块", "<think>推理过程</think>正文内容", "正文内容"],
  ["成对块+首尾空白", "  <think>abc</think>  正文  ", "正文"],
  ["仅思考无正文（剥离后为空→调用方报模型未返回文本）", "<think>只有思考</think>", ""],
  ["未闭合截断（finish_reason=length）", "<think>思考到一半被截断", ""],
  ["无标签原文透传", "普通增强结果", "普通增强结果"],
  ["多组成对块", "<think>a</think>x<think>b</think>y", "xy"],
  ["成对块内嵌类标签文本", "<think>看 <div> 标签</think>结果", "结果"],
  ["大写标签成对", "<THINK>推理</THINK>正文", "正文"],
  ["混合大小写孤立闭合", "thinking</THINK>answer", "answer"],
  ["大写未闭合", "<Think>truncated", ""],
];
let failed = 0;
for (const [name, input, expected] of cases) {
  const got = stripThinking(input);
  const ok = expected === "" ? got === "" : got === expected;
  console.log(`${ok ? "PASS" : "FAIL"} | ${name} → ${JSON.stringify(got.slice(0, 50))}`);
  if (!ok) failed++;
}
console.log(failed ? `\n${failed}/${cases.length} 失败` : `\n全部 ${cases.length} 例通过`);
process.exit(failed ? 1 : 0);
