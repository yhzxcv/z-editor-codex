/* 把 Z-Editor 的 6 个参考文件收进站点：reference/<Source>.js
 *
 * 用法：node tools/gen-refs.mjs
 *
 * ── 为什么内嵌成 JS 而不是放 .json 让页面 fetch ──
 * 本站要支持 file:// 双击打开，而 file:// 下 fetch 会被 CORS 拦掉，
 * <script> 不会。跟 data/templates.js 同一个理由（见 tools/gen-templates.mjs）。
 *
 * ── 为什么存的是裸字面量而不是 JSON.stringify 后的字符串 ──
 * 模板那边存的是转义字符串（`JSON.stringify(text)`），这里**故意不一样**：
 * 这些文件是「注入式自定义」的数据源，要能原样取到完整对象图，
 * 而且原文直接当对象字面量求值，仓库里那份字节就是上游那份字节 ——
 * 逐字节对账不用先解码，肉眼也还能认出它是什么。
 *
 * 代价是**裸字面量有几个经典炸点**，而且那几项性质属于上游快照、
 * 不是我们能保证的（上游仓库没有 .gitattributes，core.autocrlf 也不受我们控制）。
 * 所以下面 assertEmbeddable 逐项**主动断言**，而不是"生成的时候看过一眼没问题"。
 * 真踩上了就报错退出，生成一个会白屏的页面才是最坏的结果。
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.Z_EDITOR_REF
  ? join(process.env.Z_EDITOR_REF, 'app/src/main/assets/reference')
  : 'E:/code/PVZ2LevelEditor/app/src/main/assets/reference';
/* 输出目录。可以用 Z_EDITOR_REF_OUT 指到别处 —— 这个口子是**被自检逼出来的**：
 * tools/check-level.js 要喂一批有毒的假 JSON 进来，确认生成器拦得住并报错退出；
 * 其中还有一条反向用例（干净的输入不能误拦），而那条会**真的生成文件**。
 * 没有这个口子的话，跑一次自检就往 reference/ 里丢一个 Clean.js；
 * 写这套测试时就真丢了一个，差一步提交进去。
 * 正常生成不用管这个变量，默认就是仓库的 reference/。 */
const OUT_DIR = process.env.Z_EDITOR_REF_OUT
  ? process.env.Z_EDITOR_REF_OUT
  : join(ROOT, 'reference');

/* 只搬这 6 个 —— 就是上游 reference/ 下的全部 .json。
 * 上游资产里还出现过 SkillTypes / ProjectileTypes / ArmorTypes / ResilienceConfig
 * 等十来个来源，它们**没有**对应的参考文件，所以运行时一律走
 * external-unknown（不判），不能报错。见 js/level/refs.js。
 * reference/template/ 是子目录，放的是关卡模板，由 gen-templates.mjs 负责。 */
const SOURCES = readdirSync(SRC)
  .filter(f => f.endsWith('.json'))
  .map(f => f.replace(/\.json$/, ''))
  .sort();

/**
 * 逐项检查一段 JSON 原文能不能安全地当**裸对象字面量**嵌进 <script>。
 * 返回问题描述数组（空数组 = 可以嵌）。
 */
function assertEmbeddable(text) {
  const bad = [];
  const seen = (label, re, why) => {
    const hits = text.match(re);
    if (hits) bad.push(`${label}（${hits.length} 处）—— ${why}`);
  };

  if (text.charCodeAt(0) === 0xfeff) bad.push('开头有 BOM —— 字面量前面多一个不可见字符，直接是语法错误');
  seen('换行是 CRLF 或孤立 CR', /\r/g, '上游是纯 LF；变了说明源文件被动过，且会让生成物不再是"一行 JSON"');
  seen('含 U+2028/U+2029', /[\u2028\u2029]/g, 'ES2019 之前是非法字符串字符；虽然现代引擎已放行，但没必要赌');
  seen('含 </script', /<\/script/gi, 'HTML 解析器会在外部脚本之外的任何地方提前掐断脚本');
  seen('含 <!--', /<!--/g, '同上：脚本里的 HTML 注释开头会吃掉后面的代码');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    bad.push(`不是合法 JSON：${e.message}`);
    return { bad, parsed: null };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    bad.push('顶层不是对象');
  } else if (!Array.isArray(parsed.objects)) {
    bad.push('顶层没有 objects 数组 —— 参考文件是「关卡形状」，拿不到对象列表就没法取别名');
  }

  /* `__proto__` 是唯一一个会**悄悄改变语义**而不是抛错的炸点：
   * 对象字面量里的 `"__proto__": {...}` 是设置原型，JSON.parse 里的是普通自有属性。
   * 两者字节相同、求值结果不同，逐字节对账**发现不了** —— 所以单独查。 */
  const protoKeys = [];
  (function walk(node, path) {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    for (const k of Object.keys(node)) {
      if (k === '__proto__') protoKeys.push(path || '(顶层)');
      walk(node[k], `${path}.${k}`);
    }
  })(parsed, '');
  if (protoKeys.length) {
    bad.push(`含 __proto__ 键（${protoKeys.slice(0, 3).join(', ')}…）—— 裸字面量会把它当原型设置，`
      + '与 JSON.parse 的结果不一致，而逐字节对账看不出来');
  }

  return { bad, parsed };
}

mkdirSync(OUT_DIR, { recursive: true });

let failed = false;
const rows = [];

for (const source of SOURCES) {
  const raw = readFileSync(join(SRC, `${source}.json`), 'utf8');
  const { bad, parsed } = assertEmbeddable(raw);

  if (bad.length) {
    failed = true;
    console.error(`!!  ${source}.json 不能安全内嵌：`);
    bad.forEach(b => console.error(`      ${b}`));
    continue;
  }

  const header = `/* ${source} —— 由 tools/gen-refs.mjs 从 Z-Editor 生成，勿手改。
 *
 * 下面是上游 reference/${source}.json 的**原文，逐字节未改**（含缩进与键序），
 * 直接当 JS 对象字面量求值。tools/check-level.js 会把这段抠出来跟上游对账。
 *
 * 来源：app/src/main/assets/reference/${source}.json
 * 上游更新后重跑：node tools/gen-refs.mjs
 */
window.ZLevel = window.ZLevel || {};
window.ZLevel.RefData = window.ZLevel.RefData || {};
window.ZLevel.RefData.${source} = `;

  const out = join(OUT_DIR, `${source}.js`);
  writeFileSync(out, `${header}${raw};\n`);

  /* ── 自校验：生成物真的能用，且跟原文等价 ──
   *
   * 光写出去不算数。这里把刚写的文件在干净的 vm 里求值一遍，跟 JSON.parse 的结果
   * 深比 —— 这一步同时兜住"语法写坏了"和"求值语义跟 JSON.parse 不一致"
   * （原型、数字写法那些）两类问题。 */
  // 脚本第一句就是 `window.ZLevel = ...`，所以上下文里得先有个 window。
  // （tools/check-level.js 那边是 `global.window = global`，同一个道理。）
  const ctx = { window: {} };
  try {
    vm.runInNewContext(readFileSync(out, 'utf8'), ctx, { filename: out });
  } catch (e) {
    failed = true;
    console.error(`!!  ${source}.js 求值失败：${e.message}`);
    continue;
  }
  const got = ctx.window && ctx.window.ZLevel && ctx.window.ZLevel.RefData
    && ctx.window.ZLevel.RefData[source];
  /* 比 JSON 文本而不是 assert.deepStrictEqual：vm 里造出来的对象带的是**那个 realm
   * 的** Object.prototype，跟宿主不是同一个，deepStrictEqual 会因为原型不同报
   * "same structure but are not reference-equal"，那是跨 realm 的假差异，不是问题。
   * 序列化后比字符串既跨 realm 又顺带兜住"少了/多了键"（包括 __proto__ 被当成
   * 原型设置而整个键消失那种）。 */
  const gotText = JSON.stringify(got);
  const wantText = JSON.stringify(parsed);
  if (gotText === undefined || gotText !== wantText) {
    failed = true;
    const at = gotText === undefined ? 0 : [...gotText].findIndex((c, i) => c !== wantText[i]);
    console.error(`!!  ${source}.js 求值结果与 JSON.parse 不一致`
      + `（求值 ${gotText === undefined ? 'undefined' : gotText.length + ' 字符'}`
      + ` / 原文 ${wantText.length} 字符，第 ${at} 个字符起不同）`);
    continue;
  }
  // 逐字节：原文必须是生成物的**子串**，中间不许有任何转义或改写
  if (!readFileSync(out, 'utf8').includes(raw)) {
    failed = true;
    console.error(`!!  ${source}.js 里找不到原文子串 —— 生成过程改写了字节`);
    continue;
  }

  const aliases = new Set(parsed.objects.map(o => o.aliases && o.aliases[0]).filter(Boolean));
  rows.push({ source, bytes: Buffer.byteLength(raw), items: parsed.objects.length, aliases: aliases.size });
}

if (failed) {
  console.error('\n生成失败：上面列出的文件修好（或确认上游改动可接受）再重跑。');
  process.exit(1);
}

const kb = n => (n / 1024).toFixed(1).padStart(8);
console.log(`reference/  ${SOURCES.length} 个文件\n`);
console.log('  文件                  字节(KB)   条目   首别名去重');
let totB = 0;
for (const r of rows) {
  totB += r.bytes;
  console.log(`  ${r.source.padEnd(20)}${kb(r.bytes)}${String(r.items).padStart(7)}${String(r.aliases).padStart(13)}`);
}
console.log(`  ${'合计'.padEnd(19)}${kb(totB)}`);
console.log(`\n别名数写死在 tools/check-level.js 里，对不上要一起改。`);
