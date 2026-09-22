/* 数据层自检：不依赖浏览器，直接在 node 里加载数据文件与检索模块。
 * 用法: node tools/check.js
 * 覆盖「数据 -> 索引 -> 检索」这条链路，外加**模块注释的契约闸**（见下面
 * 「模块注释」一节 —— 词条是手写的，得跟自动读的插入骨架对账）；界面部分靠浏览器里看。
 */
'use strict';
const path = require('path');
const fs = require('fs');

global.window = global;

const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'js/pinyin-table.js'));
require(path.join(ROOT, 'js/codex.js'));
require(path.join(ROOT, 'js/search.js'));

const manifest = require(path.join(ROOT, 'js/chapters.js')) || null;
const src = fs.readFileSync(path.join(ROOT, 'js/chapters.js'), 'utf8');
const files = [...src.matchAll(/'([^']+\.js)'/g)].map(m => m[1]);
if (!files.length) { console.error('chapters.js 里没解析出任何数据文件'); process.exit(1); }
files.forEach(f => require(path.join(ROOT, f)));

/* 模块注释（data/module-docs.js）的契约闸，见下面「模块注释」一节。
 * 词条文件**可以还不存在** —— 框架先立住、词条慢慢补，但不存在时不能假装验过了。 */
require(path.join(ROOT, 'data/modules.js'));
require(path.join(ROOT, 'data/module-skeletons.js'));
const DOCS_FILE = path.join(ROOT, 'data/module-docs.js');
const hasDocs = fs.existsSync(DOCS_FILE);
if (hasDocs) require(DOCS_FILE);

let fail = 0;
function ok(cond, label, extra) {
  if (!cond) fail++;
  console.log(`  ${cond ? 'OK  ' : '!!  '}${label}${extra ? '   ' + extra : ''}`);
}

console.log(`数据文件 ${files.length} 个\n`);

// ── 结构完整性 ────────────────────────────────────────────────────────
// 复制格式选「RTID语句」时会拼成 RTID(code@表名)，表名写错不会抛错、
// 只会静默复制出错的 RTID，所以在这里拦一道。
// 校验**故意放在自检工具里**而不是 UI 里：UI 只读章节数据里的 rtid、
// 不耦合具体表名；新增章节要支持这个格式时，往这个数组里加一个表名。
// CurrentLevel 是关卡文件里自定义的僵尸用的表（僵尸章「可自定义僵尸」那一组），
// 走的是条目级 rtid 覆盖，不是章节级的。
// LevelModules 是地图章（XxxStage 那一批场景代码）的表。
const RTID_TABLES = ['PlantTypes', 'ZombieTypes', 'GridItemTypes', 'CurrentLevel', 'LevelModules'];

console.log('结构');
let totalItems = 0, totalGroups = 0;
for (const ch of Codex.chapters) {
  totalItems += ch.count;
  totalGroups += ch.groupUnits.length;

  const bad = [];
  ch.items.forEach(it => {
    if (!it.name) bad.push('无名 ' + it.code);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(it.code)) bad.push('代码可疑 ' + it.name + ' / ' + it.code);
  });
  const empties = ch.groupUnits.filter(u => !u.items.length).map(u => u.title);

  ok(bad.length === 0, `${ch.id} 字段完整`, bad.length ? bad.slice(0, 5).join('; ') : `${ch.count} 条`);
  ok(ch.rtid === '' || RTID_TABLES.includes(ch.rtid), `${ch.id} rtid 表名合法`,
    ch.rtid ? `"RTID(code@${ch.rtid})"` : '（未声明，该章复制时回退带引号）');
  // 条目级 rtid 同样拦一道。空串是「这条明确不支持 RTID」的合法写法，
  // 不是错；有值的才必须落在白名单里。
  const badIt = ch.items.filter(i => i.rtid !== undefined && i.rtid !== '' && !RTID_TABLES.includes(i.rtid));
  // 合法覆盖也要报出来。以前只统计「非法」和「空串」两种，条目级 rtid 又没人用，
  // 于是有覆盖也打印「无条目级覆盖」——等真用上了，这句话就成了误导。
  const setIt = ch.items.filter(i => i.rtid !== undefined && i.rtid !== '');
  const noIt = ch.items.filter(i => i.rtid === '').length;
  const parts = [];
  if (setIt.length) {
    parts.push(`${setIt.length} 条覆盖为 ` +
      [...new Set(setIt.map(i => '@' + i.rtid))].join('、'));
  }
  if (noIt) parts.push(`${noIt} 条声明不支持 RTID（复制时回退带引号）`);
  ok(badIt.length === 0, `${ch.id} 条目级 rtid 表名合法`,
    badIt.length ? badIt.slice(0, 5).map(i => `${i.name}@${i.rtid}`).join('; ')
                 : (parts.length ? parts.join('；') : '无条目级覆盖'));
  ok(empties.length === 0, `${ch.id} 无空分组`, empties.join('、'));
  ok(ch.items.length === ch.count, `${ch.id} 条目数与统计一致`);
  // data-i 用的是扁平下标，重复会导致点错行
  const seqs = new Set(ch.items.map(i => i.seq));
  ok(seqs.size === ch.items.length, `${ch.id} 序号唯一`);
}
console.log(`\n合计 ${Codex.chapters.length} 章 / ${totalGroups} 组 / ${totalItems} 条\n`);

// ── 检索 ──────────────────────────────────────────────────────────────
console.log('检索');
const cases = [
  ['gargantuar', '代码片段', h => h.length > 0],
  ['dark_gargantuar', '精确代码', h => h[0] && h[0].it.code === 'dark_gargantuar'],
  ['darkgargantuar', '去掉下划线的代码', h => h.some(x => x.it.code === 'dark_gargantuar')],
  ['豌豆射手', '中文名', h => h[0] && h[0].it.name === '豌豆射手'],
  ['巨人', '中文片段', h => h.length > 5],
  ['jrjs', '拼音首字母', h => h.some(x => x.it.name === '巨人僵尸')],
  ['wjajjrjs', '拼音首字母（带无尽前缀）', h => h.some(x => x.it.code === 'egypt_gargantuar_danger')],
  ['无尽黑暗巨人僵尸', '带前缀的全名', h => h[0] && h[0].it.code === 'dark_gargantuar_danger'],
  ['巨人 黑暗', '空格多关键词取交集', h => h.length > 0 && h.every(x => /巨人/.test(x.it.name) && /黑暗/.test(x.it.name))],
  ['peashooter sunflower', '两个互斥关键词 -> 空', h => h.length === 0],
  ['zzzznotexist', '无结果', h => h.length === 0],
];
for (const [q, label, check] of cases) {
  const r = CodexSearch.search(Codex.chapters, q);
  ok(check(r.hits), `${label}  "${q}"`, `${r.total} 条` + (r.hits[0] ? `，首位 ${r.hits[0].it.name} / ${r.hits[0].it.code}` : ''));
}

// 跨章节：在僵尸数据里搜植物，必须也能命中
const cross = CodexSearch.search(Codex.chapters, '豌豆射手');
ok(cross.hits.some(x => x.ch.id === 'plant'), '跨章节检索（植物名在全局结果里）');

// 拼音首字母不能把无关条目排到前面
const py = CodexSearch.search(Codex.chapters, 'hajrjs');
ok(py.hits[0] && py.hits[0].it.name === '黑暗巨人僵尸', '拼音首字母排序', py.hits[0] ? py.hits[0].it.name : '空');

// ── 无尽前缀 ──────────────────────────────────────────────────────────
console.log('\n无尽模式前缀');
const z = Codex.get('zombie');
const danger = z.items.filter(i => /danger/.test(i.code));
ok(danger.length === 21, `带 danger 的条目 21 条`, String(danger.length));
ok(danger.every(i => i.name.startsWith('无尽')), '全部带「无尽」前缀',
   danger.filter(i => !i.name.startsWith('无尽')).map(i => i.code).join(','));
ok(z.items.filter(i => i.code === 'dark_gargantuar')[0].name === '黑暗巨人僵尸',
   '主线关同名条目未被误加前缀');
ok(!z.items.some(i => /danger/.test(i.code) && i.name.replace('无尽', '') !== i.name.replace('无尽', '')),
   '前缀只加一次');

// ── 模块注释（ModuleDocs）的契约闸 ────────────────────────────────────
/* 键表是**自动读的**（插入骨架），中文说明是**人写的**（data/module-docs.js）。
 * 两边一旦分叉 —— 词条里抄错一个键名、或者挂到一个注册表里没有的 objClass 上 ——
 * 浮层上就多出一行「插入结果里根本没有的假键」，或者一条永远显示不出来的词条，
 * 而页面看起来一点毛病没有：那一行是**照人抄的样子**画出来的，看不出真假。
 * 所以拿**另一份数据**来校，跟 check-level.js 里那道「写入键名的契约闸」同一个道理
 * （那边的教训是把 WaveManagerProps 写成了小写，实现和断言自己跟自己自洽，全绿）。
 *
 * 判定写成**纯函数**，因为闸门自己也得能被验：底下拿几份假数据把它逼红一次。
 * 少了那一步，「0 个问题」既可能是数据干净，也可能是这个函数什么都没看 ——
 * 这两种在输出里长得一模一样（本仓库栽过好几次的那类坑）。 */
function docProblems(docs, modules, S) {
  const known = new Set();
  (modules.moduleGroups || []).concat(modules.eventGroups || [])
    .forEach(g => g.items.forEach(m => known.add(m.objClass)));

  const out = [];
  for (const cls of Object.keys(docs)) {
    const entry = docs[cls];
    if (!known.has(cls)) { out.push(`词条 ${cls} 不在模块注册表里（这条永远显示不出来）`); continue; }
    if (!entry || typeof entry !== 'object') { out.push(`词条 ${cls} 不是对象`); continue; }
    if (entry.desc !== undefined && (typeof entry.desc !== 'string' || !entry.desc.trim())) {
      out.push(`词条 ${cls} 的 desc 是个空说明`);
    }
    const keys = entry.keys;
    if (keys === undefined) continue;              // 只改模块级说明也合法
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
      out.push(`词条 ${cls} 的 keys 得是稀疏对象 { 键名: '说明' } ——`
        + ` v1 那种 {key,type,doc} 的数组不认（它自带键名，抄错就画出假行）`);
      continue;
    }
    const sk = S[cls];
    for (const k of Object.keys(keys)) {
      if (!sk) { out.push(`词条 ${cls} 给 ${k} 写了说明，但这个模块没有插入骨架（引用型模块没有键可注）`); continue; }
      if (!(k in sk)) out.push(`词条 ${cls} 里的 ${k} 不在插入骨架里（键名抄错了？浮层画不出这个键）`);
      else if (typeof keys[k] !== 'string') out.push(`词条 ${cls}.${k} 的说明不是字符串`);
      /* `''` 是**有意的空位**，不报：打底文件（tools/gen-module-docs.mjs 生成）里
       * 224 个键一开始全是它，报了这里头一天就打印 224 条 —— 那没人会再看它第二眼。
       * `'  '` 才报：浮层那一行的判断是真值判断，它会画出一行**看着空着**的说明，
       * 跟"还没写"长得不一样，是人手滑出来的。 */
      else if (keys[k] !== '' && !keys[k].trim()) {
        out.push(`词条 ${cls}.${k} 的说明是一串空格（不是空位，浮层上会多出一行看着空着的说明）`);
      }
    }
  }
  return out;
}

console.log('\n模块注释（ModuleDocs）');
const DOCS = (global.ZEditor && global.ZEditor.ModuleDocs) || null;
if (!DOCS) {
  /* **不报绿**：文件都还没有，没东西可校。这里照样把闸门自己验一遍（下面五条），
   * 所以这一节不是空的，只是"数据那一半还等着灌"。 */
  console.log('  --  还没有 data/module-docs.js，词条待补 —— 这一节眼下只验闸门自己');
} else {
  const probs = docProblems(DOCS, global.ZLevel.Modules, global.ZLevel.Skeletons);
  ok(probs.length === 0, 'ModuleDocs 里每条词条都对得上模块注册表与插入骨架',
    probs.length ? probs.slice(0, 3).join('；') : `${Object.keys(DOCS).length} 条词条`);
  /* 闸门管"对不对"，不管"填没填满"。打底之后**空位是正常状态**（键是给人当清单用的），
   * 所以进度单独说一句，而且打 `--` 不打 OK —— 别把"一个键都还没写"读成通过。 */
  let blank = 0, written = 0;
  Object.keys(DOCS).forEach(cls => {
    const k = DOCS[cls] && DOCS[cls].keys;
    if (!k || typeof k !== 'object' || Array.isArray(k)) return;
    Object.keys(k).forEach(n => { if (k[n] === '') blank++; else written++; });
  });
  console.log(`  --  填词进度：${written}/${blank + written} 个键有中文`
    + (blank ? `，还有 ${blank} 个是空位（'' 是打底的正常状态，闸门不报）` : ''));
}

{
  const S = { Known: { Alpha: 1, Beta: 2 } };          // 假骨架：只有两个键
  const M = { moduleGroups: [{ items: [{ objClass: 'Known' }] }], eventGroups: [] };
  const p = docs => docProblems(docs, M, S);
  const clean = p({ Known: { keys: { Alpha: '甲' } } });
  ok(clean.length === 0, '（闸门自验）对得上的词条一条都不报（否则它是台见谁报谁的机器）',
    clean.join('；'));
  const typo = p({ Known: { keys: { Nope: '甲' } } });
  ok(typo.length === 1, '（闸门自验）骨架里没有的键名被抓住', typo[0]);
  const stray = p({ Nobody: { keys: { Alpha: '甲' } } });
  ok(stray.length === 1, '（闸门自验）注册表里没有的 objClass 被抓住', stray[0]);
  const arr = p({ Known: { keys: [{ key: 'Alpha', doc: '甲' }] } });
  ok(arr.length === 1, '（闸门自验）v1 那种数组形状被抓住（它自带键名，正是要废掉的那样东西）', arr[0]);
  /* 这两条是一对，合起来才说明"空"这条界线画在哪：空串是脚手架的正常状态，
   * 一串空格不是。只验其中一条，界线两边都可能是错的。 */
  const blank = p({ Known: { keys: { Alpha: '  ' } } });
  ok(blank.length === 1, '（闸门自验）一串空格不算空位：被抓住', blank[0]);
  const empty = p({ Known: { keys: { Alpha: '' } } });
  ok(empty.length === 0, '（闸门自验）空串是空位、不报（否则打底文件一生出来就是一片红）',
    empty.join('；'));
}

console.log('\n页面挂的脚本');
{
  /* js/ 下的每个文件都必须挂进 index.html —— 这是 N27 那条变异的通用版。
   *
   * 挡的是"东西写好了、页面没挂"：`tools/check.js` 是 node 自己 require 的，跟页面
   * 怎么加载毫无关系，所以这边全绿；而页面上那个功能整个不存在，用户点开一片空白。
   * 加文件时最容易漏的就是那一行 <script>，而漏了以后**没有任何症状指向它**。
   * 反方向（挂了却不存在的文件）也查 —— 那是 404，一个静默失败的空脚本。 */
  // 相对仓库根、正斜杠 —— 要跟 index.html 里那串 src 逐字比，不能混进盘符和反斜杠
  const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(d, e.name))
      : (e.name.endsWith('.js') ? [rel(path.join(d, e.name))] : []));
  const jsFiles = walk(path.join(ROOT, 'js')).sort();
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  const missing = jsFiles.filter(f => !srcs.includes(f));
  const ghost = srcs.filter(s => s.startsWith('js/') && !jsFiles.includes(s));
  ok(missing.length === 0, `js/ 下 ${jsFiles.length} 个文件都挂进了 index.html`, missing.join(', '));
  ok(ghost.length === 0, 'index.html 里没有指向不存在的 js 文件（那是 404，静默的空脚本）',
    ghost.join(', '));
}

console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
