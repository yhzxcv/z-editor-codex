/* 把 Z-Editor 内置的 9 个关卡模板收进站点：data/templates.js
 *
 * 用法：node tools/gen-templates.mjs
 *
 * 为什么内嵌成 JS 字符串而不是放 .json 让页面 fetch：
 * 本站要支持 file:// 双击打开，而 file:// 下 fetch 会被 CORS 拦掉。
 * 内嵌成字符串是唯一能同时支持"本地双击"和"部署上线"的形式。
 *
 * 存的是**原文件的文本**（不是解析后再序列化的结果），这样浏览器里打开模板
 * 看到的字节跟磁盘上完全一致，用户不改动就保存的话应当逐字节相同。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 检出不在默认位置的话，用 Z_EDITOR_REF 指过去（跟 tools/check-level.js 一致）
const SRC = process.env.Z_EDITOR_REF
  ? join(process.env.Z_EDITOR_REF, 'app/src/main/assets/reference/template')
  : 'E:/code/PVZ2LevelEditor/app/src/main/assets/reference/template';
const OUT = join(ROOT, 'data', 'templates.js');

// 显示顺序按文件名里的编号（readdir 的顺序不保证）
const names = readdirSync(SRC).filter(f => f.endsWith('.json')).sort((a, b) => {
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  return (isNaN(na) || isNaN(nb)) ? a.localeCompare(b, 'zh') : na - nb;
});

const entries = names.map(name => {
  // 原样读，不做任何规范化 —— 上面那句「存的是原文件的文本」要能按字面成立。
  // 换行符不用管：写出去时走的是 JSON.stringify（见下面 body），\r\n 会变成
  // 转义序列 \r\n 存进字符串字面量，既不会被本文件的换行风格污染，
  // 取出来也还是 \r\n。tools/check-level.js 拿这个字段跟源文件直接比字节，
  // 所以这边一旦「顺手统一成 \n」，那边立刻就是假差异。
  const text = readFileSync(join(SRC, name), 'utf8');
  const title = name.replace(/^\d+\./, '').replace(/\.json$/, '');
  return { name, title, text };
});

const HEADER = `/* 内置关卡模板 —— 由 tools/gen-templates.mjs 从 Z-Editor 生成，勿手改。
 *
 * 存的是**原文件的文本**，不是解析后再序列化的结果：这样打开模板看到的
 * 字节跟上游磁盘上的一致，不动它直接保存应当逐字节相同。
 *
 * 来源：E:/code/PVZ2LevelEditor/app/src/main/assets/reference/template/
 */
window.ZLevel = window.ZLevel || {};
window.ZLevel.Templates = [
`;

const body = entries.map(e =>
  `  {\n    name: ${JSON.stringify(e.name)},\n    title: ${JSON.stringify(e.title)},\n    text: ${JSON.stringify(e.text)}\n  }`
).join(',\n');

writeFileSync(OUT, HEADER + body + '\n];\n');
const kb = (readFileSync(OUT).length / 1024).toFixed(1);
console.log(`data/templates.js  ${kb} KB  ${entries.length} 个模板`);
entries.forEach(e => console.log(`  ${e.name}  ->  ${e.title}`));
