/* 关卡逻辑层自检：不依赖浏览器，直接在 node 里跑。
 * 用法: node tools/check-level.js
 *
 * 测的是 js/level/ 下四份移植代码（rtid / order / parse / conflicts）。
 * 最有力的一条是**逐字节往返**：拿 Z-Editor 内置的 9 个真实模板，
 * 解析 -> 按 ObjectOrderRegistry 排序 -> 序列化，跟原文件比对。
 * 模板本身就是 Z-Editor 写出来的，所以对得上就说明编解码层可信。
 */
'use strict';
const path = require('path');
const fs = require('fs');

global.window = global;

const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'js/level/rtid.js'));
require(path.join(ROOT, 'js/level/refs.js'));
require(path.join(ROOT, 'js/level/order.js'));
require(path.join(ROOT, 'js/level/parse.js'));
require(path.join(ROOT, 'js/level/spans.js'));
require(path.join(ROOT, 'js/level/conflicts.js'));
require(path.join(ROOT, 'js/level/edit.js'));
require(path.join(ROOT, 'js/level/outline.js'));
require(path.join(ROOT, 'js/level/report.js'));
require(path.join(ROOT, 'data/modules.js'));
require(path.join(ROOT, 'data/module-skeletons.js'));
require(path.join(ROOT, 'data/templates.js'));

/* 上游参考文件（7.6 MB）。**这行不能省** —— 少加载一个来源，下面的断言不但不会红，
 * 反而会更绿：Refs 没有数据时外部引用一律不判（fail-open），误报数照样是 0。
 * 所以「9 份模板 0 误报」这条必须有非空性守卫，见「外部参考文件」一节。 */
const REF_SOURCES = ['GridItemTypes', 'LevelModules', 'PlantTypes', 'PropertySheets', 'ZombieActions', 'ZombieTypes'];
REF_SOURCES.forEach(s => require(path.join(ROOT, 'reference', s + '.js')));

const { Rtid, Order, Parse, Conflicts, Edit, Outline, Report, Modules, Templates, Refs } = global.ZLevel;

// ── 模板从哪来 ────────────────────────────────────────────────────────
//
// 金标准是 Z-Editor 检出里那 9 个内置模板。但那个路径写死在别人机器上不存在，
// 所以仓库里放了同样 9 份 fixtures，找不到检出就用 fixtures ——
// 套件在任何机器上都能跑完整，而不是一上来就红。
//
// 两者都在时还会对一次账，用来发现「上游改了模板而 fixtures 没跟着更新」。
// 检出不在默认位置的话，用 Z_EDITOR_REF 指过去（也方便测"没有上游"那条分支）
const UPSTREAM_DIR = process.env.Z_EDITOR_REF
  ? path.join(process.env.Z_EDITOR_REF, 'app/src/main/assets/reference/template')
  : 'E:/code/PVZ2LevelEditor/app/src/main/assets/reference/template';
const FIXTURE_DIR = path.join(ROOT, 'tools/fixtures/templates');

function readJsonDir(dir) {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort(); }
  catch (e) { return null; }
}

const upstreamFiles = readJsonDir(UPSTREAM_DIR);
const TEMPLATE_DIR = upstreamFiles ? UPSTREAM_DIR : FIXTURE_DIR;

let fail = 0;
function ok(cond, label, extra) {
  if (!cond) fail++;
  console.log(`  ${cond ? 'OK  ' : '!!  '}${label}${extra ? '   ' + extra : ''}`);
}

// ── RTID ──────────────────────────────────────────────────────────────
console.log('RTID');
ok(Rtid.build('SeedBank', 'CurrentLevel') === 'RTID(SeedBank@CurrentLevel)', 'build 默认形状');
ok(Rtid.build('StandardIntro') === 'RTID(StandardIntro@LevelModules)', 'build 默认来源 LevelModules');
{
  const p = Rtid.parse('RTID(SeedBank@CurrentLevel)');
  ok(p && p.alias === 'SeedBank' && p.source === 'CurrentLevel', 'parse 基本');
  ok(Rtid.parse('SeedBank@CurrentLevel') === null, '缺 RTID(...) 外壳 -> null');
  ok(Rtid.parse('') === null && Rtid.parse(null) === null, '空串/null -> null');
  // 贪婪切分：跟 Kotlin 侧 `RTID\((.*)@(.*)\)` 行为一致
  const g = Rtid.parse('RTID(a@b@c)');
  ok(g && g.alias === 'a@b' && g.source === 'c', '多个 @ 时贪婪切分一致');
  ok(Rtid.extractAlias('RTID(SeedBank@CurrentLevel)') === 'SeedBank', 'extractAlias');
}
{
  // 扫描用的正则要求括号内无括号，比 parse 保守
  const got = Rtid.collectAliases({ a: 'RTID(X@CurrentLevel)', b: ['RTID(Y@LevelModules)'], c: 5, d: null });
  ok(got.length === 2 && got.includes('X') && got.includes('Y'), 'collectAliases 只认字符串节点', got.join(','));
  const nested = Rtid.collectAliases({ a: 'RTID(Outer(Inner)@CurrentLevel)' });
  ok(nested.length === 0, '括号嵌套不被误当引用');
}

// ── 自然序 ────────────────────────────────────────────────────────────
console.log('\n自然序');
ok(Order.naturalCompare('Wave2', 'Wave10') < 0, 'Wave2 < Wave10');
ok(Order.naturalCompare('wave2', 'wave10') < 0, 'wave2 < wave10');
ok(Order.naturalCompare('Wave10', 'Wave10') === 0, '相同 -> 0');
ok(Order.naturalCompare('Wave1', 'Wave1x') < 0, '前缀相同短的在前');
ok(Order.naturalCompare('a', 'B') > 0, '非数字按字符码（小写在后）');
// 前导零**不**相等。数字段相等时 i/j 已经推过数字段，循环靠长度差收尾，
// 于是 "Wave01"(6) > "Wave1"(5)。Kotlin 侧同样是这个结果（最后一行
// 返回 s1.length - s2.length），不是移植偏差 —— 这条断言原先写反过。
ok(Order.naturalCompare('Wave01', 'Wave1') > 0, '数字段相等时按总长度收尾（Wave01 > Wave1）');
ok(Order.naturalCompare('Wave1', 'Wave01') < 0, '同上，反向为负');
ok(Order.naturalCompare('Wave9', 'Wave10') < 0, '数值比较而非字典序（9 < 10）');

// ── 排序白名单 ────────────────────────────────────────────────────────
console.log('\n排序');
ok(Order.getPriority('LevelDefinition') === 0, 'LevelDefinition 优先级 0');
ok(Order.getPriority('ZombieType') > Order.getPriority('WaveManagerProperties'), '波次管理器在僵尸类型之前');
ok(Order.getPriority('NoSuchClass') === Number.MAX_SAFE_INTEGER, '未知 objclass 排最后');
{
  const arr = [
    { objclass: 'Unknown1', aliases: ['a'] },
    { objclass: 'WaveManagerProperties', aliases: ['WaveManagerProps'] },
    { objclass: 'LevelDefinition' },
    { objclass: 'SpawnZombiesJitteredWaveActionProps', aliases: ['Wave10Jittered0'] },
    { objclass: 'SpawnZombiesJitteredWaveActionProps', aliases: ['Wave2Jittered0'] }
  ];
  Order.sortObjects(arr);
  ok(arr[0].objclass === 'LevelDefinition', '根排第一');
  ok(arr[1].objclass === 'WaveManagerProperties', '白名单序');
  ok(arr[2].aliases[0] === 'Wave2Jittered0' && arr[3].aliases[0] === 'Wave10Jittered0',
    '同 objclass 按别名自然序（Wave2 在 Wave10 前）');
  ok(arr[4].objclass === 'Unknown1', '未知的排最后');
}

// ── 深清 ──────────────────────────────────────────────────────────────
console.log('\n深清');
{
  const cleaned = Parse.sanitizeJsonElement({ arr: [1, null, 2, null], obj: { k: null, j: 3 } });
  ok(cleaned.arr.length === 2, '数组里的 null 被剔除', JSON.stringify(cleaned.arr));
  ok('k' in cleaned.obj && cleaned.obj.k === null, '对象值为 null 的键保留（是有意写的）');
}
{
  const objs = [{ objclass: 'A', objdata: { x: [1, null] } }, null, { objclass: 'B', objdata: null }];
  const cleaned = Parse.sanitizeLevelObjects(objs);
  ok(cleaned.length === 2, '对象列表里的 null 被剔除');
  ok(cleaned[0].objdata.x.length === 1, '嵌套数组里的 null 也被剔除');
  ok(cleaned[0] === objs[0], '就地替换 objdata，对象引用不变（可达性分析依赖这点）');
}

// ── 真实模板 ──────────────────────────────────────────────────────────
console.log('\n真实模板（Z-Editor 内置 9 个）');
const files = readJsonDir(TEMPLATE_DIR) || [];
ok(files.length === 9, `模板数量 9`, String(files.length));
console.log(`  --  模板来源：${upstreamFiles ? 'Z-Editor 检出（上游）' : '仓库内 fixtures'}  ${TEMPLATE_DIR}`);

// fixtures 与上游的漂移检查。只在有上游时才有意义 —— 没有就是无处可对，
// 明确打一行说明，免得看起来像"这项被静默跳过了"。
if (upstreamFiles) {
  const drift = [];
  for (const f of upstreamFiles) {
    let fix = null;
    try { fix = fs.readFileSync(path.join(FIXTURE_DIR, f)); } catch (e) { /* 缺文件 */ }
    if (!fix || !fix.equals(fs.readFileSync(path.join(UPSTREAM_DIR, f)))) drift.push(f);
  }
  ok(drift.length === 0, 'fixtures 与上游逐字节相同（上游模板改了要同步更新 fixtures）',
    drift.join(','));
} else {
  console.log('  --  没有 Z-Editor 检出，跳过上游漂移检查');
}

// data/templates.js 是生成物，而编辑器「新建文档」写出去的就是它里面的文本 ——
// 差一个字节，用户保存的文件就跟上游不一样了。所以在这里钉死，不是靠生成的当时看过一眼。
{
  const badT = [];
  for (const f of files) {
    const t = Templates.filter(x => x.name === f)[0];
    if (!t) { badT.push(f + '(缺)'); continue; }
    if (t.text !== fs.readFileSync(path.join(TEMPLATE_DIR, f), 'utf8')) badT.push(f);
  }
  ok(Templates.length === files.length, `data/templates.js 有 ${files.length} 份`, String(Templates.length));
  ok(badT.length === 0, '每份模板的文本与源文件逐字节相同', badT.join(','));
}

for (const f of files) {
  const raw = fs.readFileSync(path.join(TEMPLATE_DIR, f), 'utf8');
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    ok(false, `${f} 能解析`, e.message);
    continue;
  }

  const objs = Parse.sanitizeLevelObjects(doc.objects);
  const def = Parse.findLevelDefinition(objs);
  const hasRoot = !!def;

  // 树结构可用性
  if (!hasRoot) { ok(false, `${f} 有 LevelDefinition`); continue; }

  // 孤立模块检测。模板 8 是**唯一**一个自带孤立模块的：tutorial_2 这个僵尸变体在文件里
  // 只出现一次（它自己的别名声明），从未被任何对象引用；tutorial_props_2 又只被
  // tutorial_2 引用。所以这两个对象是真的失效 —— 检测挑出来的正好是它们，
  // 说明可达性分析是准的（这条曾被我误判成 Z-Editor 的 bug，查证后是模板自带示例）。
  const orphans = Parse.findOrphanedObjects(doc.objects);
  const expectOrphan = (f === '8.自定义僵尸示例.json');
  if (expectOrphan) {
    const got = orphans.map(o => Parse.objClassOf(o)).sort().join(',');
    ok(got === 'ZombiePropertySheet,ZombieType', `${f} 恰好 2 个真孤立模块（模板自带的示例）`, got);
  } else {
    ok(orphans.length === 0, `${f} 无孤立模块`,
      orphans.length ? orphans.map(o => Parse.objClassOf(o)).join(',') : `${objs.length} 个对象`);
  }
}

// ── 往返 ──────────────────────────────────────────────────────────────
// "往返一致"这句结论太粗，会把三件不同的事混成一件。分开测：
//
//   语义往返 —— 排序后必须还是原来那批对象（置换，不增不减不改内容），
//               且再排一次不再变化（幂等）。9/9 必须全过，这是正确性底线。
//   字节往返 —— 6/9 完全逐字节相同。
//
// 剩下 3 个不一样，是**两类**原因，都不是丢东西：
//
//   a) 数字写法（7 僵王战 / 8 自定义僵尸）：Gson 走强类型模型，Double 字段的
//      1 会被写成 1.0；JS 的 JSON.parse 把 1.0 读成 number 1，写回就是 1。
//      JSON 里 1 与 1.0 是同一个数，游戏侧等价。把数字全部抹成 N 后两边
//      完全相同，可证差异只在数字形态。
//   b) 排序重排（3 传送带）：这份模板自身就不在 ObjectOrderRegistry 的顺序上 ——
//      文件里 Wave4ModConveyor0 排在 Wave2ModConveyor0 前面。Z-Editor 的
//      saveLevel 是无条件 sortWith(comparator) 的，所以**它自己保存一次也会
//      重排**，我们只是如实复现。这类差异是"修好了顺序"，不是损坏。
//
// 这也是本站的既定策略：纯文本编辑直接落盘原文、不重新序列化；只有结构操作
// （插入/清理/排序）才重排 + 规范化，且改动在编辑器里可见、可撤销。
console.log('\n往返（解析 -> 排序 -> 序列化）');
{
  const stripNum = s => s.replace(/-?\d+\.\d+/g, 'N').replace(/-?\d+/g, 'N');
  // 对象身份指纹：只比 objclass + 别名 + objdata 内容，用来判断"还是不是同一批"
  const fp = o => JSON.stringify(o);

  let pureByte = 0, numOnly = 0, reordered = 0;
  for (const f of files) {
    const raw = fs.readFileSync(path.join(TEMPLATE_DIR, f), 'utf8').replace(/\r\n/g, '\n');
    const doc = JSON.parse(raw);
    const beforeFps = doc.objects.map(fp);

    Order.sortObjects(doc.objects);
    const afterFps = doc.objects.map(fp);

    // 置换性：内容集合不变（排序只该改顺序）
    const permuted = JSON.stringify(beforeFps.slice().sort()) === JSON.stringify(afterFps.slice().sort());
    if (!permuted) ok(false, `${f} 排序后是原对象的置换`);

    // 幂等性：已排序的再排一次不动
    const onceSorted = doc.objects.map(fp);
    Order.sortObjects(doc.objects);
    if (JSON.stringify(onceSorted) !== JSON.stringify(doc.objects.map(fp))) {
      ok(false, `${f} 排序幂等`);
    }

    const out = JSON.stringify(doc, null, 2);
    if (out === raw || out + '\n' === raw) { pureByte++; continue; }
    if (stripNum(out) === stripNum(raw)) { numOnly++; continue; }
    reordered++;
    ok(JSON.stringify(beforeFps) !== JSON.stringify(afterFps),
      `${f} 字节差异来自排序重排（模板自身不在白名单序上，Z-Editor 保存同样会重排）`);
    ok(stripNum(out) !== stripNum(raw), `${f} 差异不只是数字写法`, '  -> 已由重排解释');
  }
  ok(pureByte + numOnly + reordered === files.length, '往返差异三分类覆盖全部模板',
    `逐字节 ${pureByte} / 仅数字写法 ${numOnly} / 排序重排 ${reordered}`);
  ok(pureByte >= 6, `逐字节往返 >= 6/9`, `${pureByte}/${files.length}`);
  ok(numOnly === 2, `仅数字写法的正好 2 个（7 僵王战、8 自定义僵尸）`, String(numOnly));
  // 模板 3 是唯一自带乱序的，这条同时钉住"重排是它、且只有它"
  ok(reordered === 1, `排序重排的正好 1 个（3 传送带）`, String(reordered));
}

// ── 对象区间（点树上的一行该跳到哪儿）────────────────────────────────────
/* js/level/spans.js 从文本里扫出每个顶层对象的区间。它撑的是"跳转"那条路：
 * 界面上点一个对象，光标要落在**那个对象**身上。
 *
 * 这里比的是**两个来源**：我的扫描器给的区间，跟引擎 JSON.parse 出来的对象。
 * 逐个元素 `JSON.parse(文本.slice(区间))` 必须正好等于解析出来的第 i 个对象 ——
 * 区间偏一个字符、少一个括号、被字符串里的 } 带偏，都会当场露馅。
 * 自己跟自己比（区间对区间）是验不出东西的。 */
console.log('\n对象区间');
const { Spans } = global.ZLevel;

/** 返回问题清单（空 = 全部对得上）。抽成纯函数是为了能拿假数据逼它红。 */
function spanProblems(text, objs, ranges) {
  const out = [];
  if (!Array.isArray(ranges)) { out.push('扫不出区间（返回的不是数组）'); return out; }
  if (ranges.length !== objs.length) {
    out.push(`区间个数 ${ranges.length} 与对象个数 ${objs.length} 对不上`);
    return out;
  }
  ranges.forEach((r, i) => {
    let got;
    try { got = JSON.parse(text.slice(r.from, r.to)); }
    catch (e) { out.push(`第 ${i} 个区间切出来的不是 JSON：${e.message}`); return; }
    if (JSON.stringify(got) !== JSON.stringify(objs[i])) {
      out.push(`第 ${i} 个区间指到了别的对象（${(got && got.objclass) || typeof got}）`);
    }
  });
  return out;
}

{
  const bad = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(TEMPLATE_DIR, f), 'utf8');
    const doc = JSON.parse(text);
    const objs = Parse.sanitizeLevelObjects(doc.objects);
    const probs = spanProblems(text, objs, Spans.objectRanges(text));
    if (probs.length) bad.push(`${f}: ${probs[0]}`);
  }
  ok(bad.length === 0, `9 份模板逐个对象：区间切出来正好是那个对象（${files.length} 份里 ${files.length - bad.length} 份全对）`,
    bad.join(' | '));
}

/* 用户报的那个毛病本身：名字先以**别的身份**在文件里出现过。
 * 一份"名字撞车"的文件，那个模块的别名同时是
 *   ① 上层对象里一个值（"Name"）② 一条 @CurrentLevel 引用的一部分
 * 按名字搜会落在 ① 上，按结构跳必须落在对象上。 */
{
  const objs = [
    { objclass: 'LevelDefinition', objdata: { Modules: ['WidgetProps@CurrentLevel'], Name: 'WidgetProps' } },
    { objclass: 'WidgetProps', objdata: { alias: 'WidgetProps', Count: 3 } }
  ];
  const text = JSON.stringify({ objects: objs }, null, 2);
  const ranges = Spans.objectRanges(text);
  ok(spanProblems(text, objs, ranges).length === 0,
    '名字撞车时，区间仍然切得出那个对象');
  const firstHit = text.indexOf('"WidgetProps"');
  ok(ranges && firstHit >= 0 && firstHit < ranges[1].from,
    '（前提）按名字搜确实会先中别处 —— 这条不成立的话上面那条就没在测东西',
    `首次出现 ${firstHit}，对象本体从 ${ranges && ranges[1].from} 开始`);
  ok(ranges && ranges[1].from <= text.indexOf('"objclass": "WidgetProps"'),
    '第 2 个区间从它自己的 { 开始，不是从名字第一次出现的地方');
}

/* 转义：`"` 前面有个反斜杠时，那个引号不是收尾的引号。这类扫描器最经典的错法。
 *
 * 那串注释是**挑过的**：里面既有转义引号、又有一个 `}`。少了那个 `}` 就照不出错来 ——
 * 探针实测（把 `i += 2` 改成 `i++` 造一个坏版扫描器）：'say "hi" } and [1,2]' 那种
 * 形状下坏版"碰巧"还是对的，得是 `}` 夹在两个转义引号中间才必然错位（坏版要么给出
 * 错的区间，要么直接放弃返回 null）。这条断言必须挑得住那个错，否则它就是摆设。 */
{
  const objs = [
    { objclass: 'A', objdata: { Note: 'a " } " b' } },
    { objclass: 'B', objdata: {} }
  ];
  const text = JSON.stringify({ objects: objs }, null, 2);
  ok(spanProblems(text, objs, Spans.objectRanges(text)).length === 0,
    '字符串里的引号（转义的）和括号不参与计数 —— 区间没错位');
}

/* 闸门自验：给它一个**故意指错**的区间，它必须报。不报就说明上面那几条
 * 是"怎么都对"，等于没验。 */
{
  const text = JSON.stringify({ objects: [{ objclass: 'A' }, { objclass: 'B' }] }, null, 2);
  const objs = JSON.parse(text).objects;
  const right = Spans.objectRanges(text);
  ok(spanProblems(text, objs, right).length === 0, '（闸门自验）区间对时不报');
  ok(spanProblems(text, objs, [{ from: right[0].from, to: right[0].to },
    { from: right[0].from, to: right[0].to }]).length > 0,
  '（闸门自验）第 2 个区间指到第 1 个对象上：报');
  ok(spanProblems(text, objs, [{ from: right[0].from, to: right[0].to - 1 },
    right[1]]).length > 0, '（闸门自验）少一个字符：报');
  ok(spanProblems(text, objs, Spans.objectRanges('{"objects": [}')).length > 0,
    '（闸门自验）文本是坏的：扫不出区间，报');
  ok(Spans.objectRanges('{"objects": []}').length === 0, '空 objects 给出空区间表（不是 null）');
  ok(Spans.objectRanges('[{"objclass": "A"}]').length === 1, '根是裸数组也认');
  ok(Spans.objectRanges('{"other": 1}') === null, '找不到 objects 返回 null（调用方那时退回按名字搜）');
}

// ── 冲突规则 ──────────────────────────────────────────────────────────
console.log('\n模块冲突');
ok(Conflicts.check(['SeedBankProperties', 'ConveyorSeedBankProperties']).length === 1, '种子库 + 传送带');
ok(Conflicts.check(['SeedBankProperties']).length === 0, '单个模块不冲突');
ok(Conflicts.check(['CustomLevelModuleProperties', 'LawnMowerProperties']).length === 1, '庭院 + 小推车');
ok(Conflicts.RULES.length === 11, '规则数 11', String(Conflicts.RULES.length));
{
  const hit = Conflicts.check(['EvilDaveProperties', 'ZombiesDeadWinConProperties']);
  ok(hit[0] && /我是僵尸/.test(hit[0].description), '描述带出来给用户看');
}

// ── 失效引用 ──────────────────────────────────────────────────────────
console.log('\n失效模块引用');
{
  const doc = {
    objects: [
      { objclass: 'LevelDefinition', objdata: { Modules: ['RTID(A@CurrentLevel)', 'RTID(Ghost@CurrentLevel)'] } },
      { objclass: 'X', aliases: ['A'], objdata: {} }
    ]
  };
  const bad = Parse.findInvalidLevelModuleReferences(doc.objects, null);
  ok(bad.length === 1 && bad[0] === 'RTID(Ghost@CurrentLevel)', '本文件缺 Ghost -> 判失效', bad.join(','));
}
{
  const doc = {
    objects: [
      { objclass: 'LevelDefinition', objdata: { Modules: ['RTID(Nope@LevelModules)'] } }
    ]
  };
  ok(Parse.findInvalidLevelModuleReferences(doc.objects, null).length === 0,
    '参考文件未加载时 @LevelModules 不参与判断（防空报）');
  ok(Parse.findInvalidLevelModuleReferences(doc.objects, new Set(['Other'])).length === 1,
    '参考文件已加载时能判出 @LevelModules 失效');
}

// ── 模块注册表 ────────────────────────────────────────────────────────
console.log('\n模块注册表');
{
  const mods = Modules.moduleGroups.reduce((a, g) => a.concat(g.items), []);
  const evs = Modules.eventGroups.reduce((a, g) => a.concat(g.items), []);
  ok(mods.length === 59, '模块 59 条', String(mods.length));
  ok(evs.length === 26, '事件 26 条', String(evs.length));
  ok(mods.every(m => m.objClass && m.title && m.defaultAlias),
    '每条模块都有 objClass/title/defaultAlias');
  // 别名是插进 RTID 里的东西，重名会让插入分配出错名
  const aliases = mods.map(m => m.defaultAlias);
  ok(new Set(aliases).size === aliases.length, '模块默认别名互不重复',
    aliases.length - new Set(aliases).size + ' 个重复');
  ok(mods.filter(m => m.allowMultiple).length > 0, '存在 allowMultiple 的模块');
}

// ── 结构编辑 ──────────────────────────────────────────────────────────
console.log('\n结构编辑');
const readTemplate = f => JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, f), 'utf8'));
const modOf = cls => {
  const all = Modules.moduleGroups.reduce((a, g) => a.concat(g.items), []);
  return all.find(m => m.objClass === cls);
};
{
  const objs = [{ aliases: ['A'] }, { aliases: ['A1'] }, { objclass: 'X' }];
  ok(Edit.aliasTaken(objs, 'A') === true, 'aliasTaken 认已占用');
  ok(Edit.aliasTaken(objs, 'B') === false, 'aliasTaken 认空闲');
  ok(Edit.uniqueAlias(objs, 'B') === 'B', '空闲别名原样返回');
  ok(Edit.uniqueAlias(objs, 'A') === 'A2', '已占用则递增到 A2（A、A1 都被占）');
  // 事件的首候选带 0，跟模块不一样
  ok(Edit.uniqueEventAlias(objs, 'Wave1Jittered') === 'Wave1Jittered0', '事件首候选是 base0');
  ok(Edit.uniqueEventAlias([{ aliases: ['Wave1Jittered0'] }], 'Wave1Jittered') === 'Wave1Jittered1',
    '事件 base0 被占则用 base1');
}

{
  // 模板 1 只有 LevelDefinition，适合测"从零插模块"
  const doc = readTemplate('1.空白关卡.json');
  const objs = doc.objects;

  // CurrentLevel + 有骨架 -> 建对象，并挂 RTID
  const r1 = Edit.insertModule(objs, modOf('WaveManagerModuleProperties'),
    { waveManagerProps: 'RTID(WaveManagerProps@CurrentLevel)' });
  ok(r1.ok && r1.alias === 'NewWaves' && r1.rtid === 'RTID(NewWaves@CurrentLevel)',
    '插入波次管理器：别名与 RTID 正确', r1.ok ? r1.rtid : r1.error);
  ok(objs.length === 2, 'CurrentLevel 模块会新建对象', String(objs.length));
  ok(Parse.levelModules(objs).indexOf(r1.rtid) >= 0, 'RTID 已进入 Modules');

  // LevelModules 来源：只挂引用，不建对象
  const before = objs.length;
  const r2 = Edit.insertModule(objs, modOf('StandardLevelIntroProperties'), { anything: 1 });
  ok(r2.ok && objs.length === before, '@LevelModules 模块不新建对象');
  ok(r2.created === null, '@LevelModules 模块 created 为 null');
  ok(Parse.levelModules(objs).indexOf('RTID(StandardIntro@LevelModules)') >= 0,
    '@LevelModules 模块的 RTID 照样进 Modules');

  // 别名冲突：非 allowMultiple 的重复插入要被拒
  const again = Edit.insertModule(objs, modOf('WaveManagerModuleProperties'), {});
  ok(again.ok === false && again.error === 'exists', '重复插入非 allowMultiple 模块被拒', again.error);

  // 手动开始：插入坚不可摧要顺带打开波次管理器的手动开始。
  // 键名是 ManualStartup（大写 M）—— 曾经这里写的是小写 manualStartup，
  // 因为断言和实现用的是同一个错名字，测试全绿却跟真实契约对不上。钉死大写形式。
  Edit.setManualStartup(objs, false);
  const wmData = () => Edit.findObject(objs, 'WaveManagerModuleProperties').objdata;
  ok(wmData().ManualStartup === null, 'ManualStartup 可关闭（写成 null）');
  ok(!('manualStartup' in wmData()), '不写出小写的 manualStartup 键');
  const ls = Edit.insertModule(objs, modOf('LastStandMinigameProperties'), null);
  ok(ls.ok && wmData().ManualStartup === true, '插入坚不可摧自动打开 ManualStartup');
}

{
  // 骨架里的 waveManagerProps 必须改写成文件里**实际那个**别名，
  // 不能写死 WaveManagerProps —— 用户改过别名的话写死就指向空气了。
  const doc = readTemplate('2.自选卡示例.json');
  const objs = doc.objects;
  // 腾出位置：去掉已有的波次管理器模块，并把管理器本体改成自定义别名
  const old = Edit.findObject(objs, 'WaveManagerModuleProperties');
  objs.splice(objs.indexOf(old), 1);
  Edit.findObject(objs, 'WaveManagerProperties').aliases = ['MyCustomWaves'];

  const r = Edit.insertModule(objs, modOf('WaveManagerModuleProperties'),
    { WaveManagerProps: 'RTID(WaveManagerProps@CurrentLevel)', DynamicZombies: null });
  ok(r.ok, '插入波次管理器成功', r.ok ? r.alias : r.error);
  ok(r.created && r.created.objdata.WaveManagerProps === 'RTID(MyCustomWaves@CurrentLevel)',
    '骨架里的 WaveManagerProps 被改写成实际别名',
    r.created ? r.created.objdata.WaveManagerProps : '(无对象)');
  ok(r.created && !('waveManagerProps' in r.created.objdata), '不写出小写的 waveManagerProps 键');
}

{
  // 事件插入：别名分配、RTID 进对应波次、objdata 只追加不重写
  const doc = readTemplate('2.自选卡示例.json');
  const objs = doc.objects;
  const wm = Edit.findObject(objs, 'WaveManagerProperties');
  const wave1Before = wm.objdata.Waves[0].length;
  // 埋一个未建模的键，验证插入事件不会把它冲掉
  wm.objdata.SomeUnknownKey = { keep: 'me' };

  const r = Edit.insertEvent(objs, Modules.eventGroups[0].items[1], 1, { Zombies: [] });
  ok(r.ok && r.alias === 'Wave1Jittered1', '事件别名跳过已占用的 Wave1Jittered0', r.alias);
  ok(wm.objdata.Waves[0].length === wave1Before + 1, 'RTID 追加进第 1 波');
  ok(wm.objdata.Waves[0][wave1Before] === r.rtid, '追加的正是新 RTID');
  ok(wm.objdata.SomeUnknownKey && wm.objdata.SomeUnknownKey.keep === 'me',
    '插入事件**不重写** objdata（未建模的键还在）');

  const bad = Edit.insertEvent(objs, Modules.eventGroups[0].items[1], 99, {});
  ok(bad.ok === false && bad.error === 'bad-wave', '越界波次被拒（不偷偷建新波）', bad.error);
}

{
  // 删除 + 级联：删掉被引用的对象，引用它的也要跟着走
  const doc = readTemplate('2.自选卡示例.json');
  const objs = doc.objects;
  const wmObj = Edit.findObject(objs, 'WaveManagerProperties');
  const r = Edit.removeObject(objs, wmObj);
  ok(r.removed === wmObj, '目标对象被删除');
  ok(r.cascaded.length > 0, '级联清掉了失去引用的对象', String(r.cascaded.length));
  ok(Parse.findOrphanedObjects(objs).length === 0, '删完后没有残留孤立模块');
  ok(Parse.levelModules(objs).indexOf('RTID(NewWaves@CurrentLevel)') >= 0,
    'Modules 里的引用不因级联被改（引用本身是悬空的，由校验层报出）');
}

{
  // 清孤立模块：模板 8 自带 2 个真孤立模块
  const doc = readTemplate('8.自定义僵尸示例.json');
  const objs = doc.objects;
  const before = objs.length;
  const removed = Edit.cleanupOrphaned(objs);
  ok(removed.length === 2, '模板 8 清掉 2 个孤立模块', String(removed.length));
  ok(objs.length === before - 2, '对象数相应减少');
  ok(Edit.cleanupOrphaned(objs).length === 0, '再清一次无事发生（幂等）');
}

{
  // 改名同步引用：只动命中的字符串，别的键原样保留
  const doc = readTemplate('2.自选卡示例.json');
  const objs = doc.objects;
  const seed = Edit.findObject(objs, 'SeedBankProperties');
  seed.objdata.SomeUnknownKey = [1, 2, 3];

  const r = Edit.renameAlias(objs, 'SeedBank', 'MyBank');
  ok(r.renamed === 1, '别名本身被改掉', String(r.renamed));
  ok(seed.aliases[0] === 'MyBank', '新别名已生效');
  ok(r.refs >= 1, '引用被同步改写', String(r.refs));
  ok(Parse.levelModules(objs).indexOf('RTID(MyBank@CurrentLevel)') >= 0,
    'Modules 里的引用跟着改了');
  ok(Parse.levelModules(objs).indexOf('RTID(SeedBank@CurrentLevel)') < 0,
    '老引用不残留');
  ok(JSON.stringify(seed.objdata.SomeUnknownKey) === '[1,2,3]', '未建模的键不受影响');
  ok(Edit.renameAlias(objs, 'SeedBank', 'X').renamed === 0, '改不存在的别名无事发生');

  // 改名后不该凭空多出悬空引用
  ok(Parse.findInvalidLevelModuleReferences(objs, null).length === 0,
    '改名后 Modules 无悬空引用');
}

{
  // 只改 @CurrentLevel 的引用 —— 别的来源指的是**别的文件**里的同名对象。
  //
  // 这条是**改动过行为**之后补的闸：renameAlias 原先不看来源，`@LevelModules` 一起改。
  // 那份文件里恰好也有个同名的东西时，改完就把一条本来指得对的引用变成了
  // "别的文件里不存在的别名" —— 而 @LevelModules 属于外部引用，分类上根本不报，
  // 屏幕上一点异样都没有。所以这里必须能红。
  const objs = [
    { aliases: ['SeedBank'], objclass: 'SeedBankProperties', objdata: {
      Local: 'RTID(SeedBank@CurrentLevel)',
      Foreign: 'RTID(SeedBank@LevelModules)'
    } },
    { aliases: ['Lvl'], objclass: 'LevelDefinition', objdata: {
      Modules: ['RTID(SeedBank@CurrentLevel)', 'RTID(SeedBank@LevelModules)']
    } }
  ];
  const r = Edit.renameAlias(objs, 'SeedBank', 'MyBank');
  ok(r.refs === 2, '只改了本文件那两处（objdata 一处 + Modules 一处）', String(r.refs));
  ok(objs[0].objdata.Local === 'RTID(MyBank@CurrentLevel)', '本文件引用改成了新代号');
  ok(objs[0].objdata.Foreign === 'RTID(SeedBank@LevelModules)',
    '@LevelModules 那处**一个字都没动**（它指的是别的文件里的同名东西）',
    objs[0].objdata.Foreign);
  ok(objs[1].objdata.Modules[1] === 'RTID(SeedBank@LevelModules)',
    'Modules 里的 @LevelModules 也没动', objs[1].objdata.Modules[1]);
}

{
  // 对象改名（面板「代号」那一格按保存走的就是 renameObjectAlias）
  const mk = () => [
    { aliases: ['Bank'], objclass: 'SeedBankProperties', objdata: {} },
    { aliases: ['Lvl'], objclass: 'LevelDefinition', objdata: {
      Modules: ['RTID(Bank@CurrentLevel)']
    } },
    { aliases: ['Other'], objclass: 'ZombieProperties', objdata: { Who: 'RTID(Bank@CurrentLevel)' } }
  ];

  let objs = mk();
  let r = Edit.renameObjectAlias(objs, objs[0], 'MyBank');
  ok(r.ok && r.alias === 'MyBank', '改名成功', JSON.stringify(r));
  ok(objs[0].aliases[0] === 'MyBank', '对象自己的别名改了');
  ok(objs[1].objdata.Modules[0] === 'RTID(MyBank@CurrentLevel)', 'Modules 里那条引用跟着改');
  ok(objs[2].objdata.Who === 'RTID(MyBank@CurrentLevel)', '别的对象 objdata 里的引用也跟着改');
  ok(r.refs === 2, 'refs 报了 2 处', String(r.refs));

  // 撞名：这份文件里已经有对象叫这个名字 -> 拒绝，且**一个字节都没改**
  objs = mk();
  const before = JSON.stringify(objs);
  r = Edit.renameObjectAlias(objs, objs[0], 'Other');
  ok(r.ok === false && r.error === 'bad-name', '撞名被拒', JSON.stringify(r));
  ok(JSON.stringify(objs) === before, '拒绝时整份对象列表一个字节都没动');
  ok(/已经有对象叫/.test(r.reason), '给的原因说清了是撞名', r.reason);

  // 改成自己现在这个名字 -> 不算改（不算错，也不写）
  objs = mk();
  r = Edit.renameObjectAlias(objs, objs[0], 'Bank');
  ok(r.ok === true && r.unchanged === true, '改成原名 = 没改', JSON.stringify(r));

  // 形状：RTID 会被这些字符切坏，一律不收
  objs = mk();
  const badNames = ['a@b', 'a(b', 'a)b', 'a b', 'a"b', 'a\\b', ''];
  badNames.forEach(n => {
    const rr = Edit.renameObjectAlias(objs, objs[0], n);
    ok(rr.ok === false && rr.error === 'bad-name',
      `「${n}」不能当代号（会被拒）`, JSON.stringify(rr));
  });
  ok(objs[0].aliases[0] === 'Bank', '上面那一串拒绝一个都没写进去', objs[0].aliases[0]);
  ok(Edit.renameObjectAlias(objs, objs[0], 'A-1_2').ok === true,
    '字母数字下划线连字符是收的（仓库里 4789 个别名的字符集）');
  ok(objs[0].aliases[0] === 'A-1_2', '收下的那个真的写进去了', objs[0].aliases[0]);

  // 没有别名的对象：改不了，照实说
  objs = mk();
  const anon = { objclass: 'Foo', objdata: {} };
  objs.push(anon);
  r = Edit.renameObjectAlias(objs, anon, 'Bar');
  ok(r.ok === false && r.error === 'no-alias', '没有别名的对象改不了代号', JSON.stringify(r));

  // 老代号被两个对象共用（坏数据）：拒绝，不替用户猜改哪一个
  objs = mk();
  objs.push({ aliases: ['Bank'], objclass: 'Twin', objdata: {} });
  const dup = JSON.stringify(objs);
  r = Edit.renameObjectAlias(objs, objs[0], 'MyBank');
  ok(r.ok === false && r.error === 'ambiguous', '重名时拒绝', JSON.stringify(r));
  ok(JSON.stringify(objs) === dup, '拒绝时没动任何一个对象');
}

{
  // 纯文本替换：只认 RTID(...) 里的别名，不误伤普通字符串
  const text = '{"A":"RTID(SeedBank@CurrentLevel)","B":"SeedBank","C":"RTID(SeedBank@LevelModules)"}';
  const r = Edit.replaceAliasInText(text, 'SeedBank', 'MyBank');
  ok(r.count === 2, '替换了 2 处 RTID', String(r.count));
  ok(r.text.indexOf('"RTID(MyBank@CurrentLevel)"') >= 0, 'CurrentLevel 那处改对了');
  ok(r.text.indexOf('"RTID(MyBank@LevelModules)"') >= 0, 'LevelModules 那处改对了');
  ok(r.text.indexOf('"B":"SeedBank"') >= 0, '普通字符串没被误伤');
}

// ── 大纲 ──────────────────────────────────────────────────────────────
console.log('\n大纲（对象树的数据来源）');
{
  const doc = readTemplate('2.自选卡示例.json');
  const o = Outline.build(doc.objects);
  ok(!!o.root && o.root.objclass === 'LevelDefinition', '根是 LevelDefinition');
  // Modules 里 @CurrentLevel 的只有 SeedBank 和 NewWaves 两条；其余都是 @LevelModules
  ok(o.modules.length === 2, '2 个对象级模块（Modules 里 @CurrentLevel 的那些）',
    o.modules.map(m => m.objclass).join(','));
  ok(o.waveManager && o.waveManager.objclass === 'WaveManagerProperties', '找到波次管理器');
  ok(o.waves.length === 10, '10 波', String(o.waves.length));
  ok(o.waves[0].items.length === 1 && o.waves[0].items[0].objclass === 'SpawnZombiesJitteredWaveActionProps',
    '第 1 波里有 1 个出怪事件');
  ok(o.waves[7].items.length === 2, '第 8 波有 2 个事件（出怪 + 裂缝）', String(o.waves[7].items.length));
  ok(o.dangling.length === 0, '这份模板没有悬空引用');
  ok(o.supporting.length === 0 && o.orphans.length === 0,
    '这份模板的每个对象都直接挂在模块或波次上', `支撑 ${o.supporting.length} / 孤立模块 ${o.orphans.length}`);
  ok(o.orphans.every(n => n.objclass), '孤立模块节点也带着 objclass');
}
{
  const doc = readTemplate('2.自选卡示例.json');
  // 制造一个悬空引用：把 Modules 里的别名改错
  const def = Parse.findLevelDefinition(doc.objects);
  def.objdata.Modules.push('RTID(Ghost@CurrentLevel)');
  const o = Outline.build(doc.objects);
  ok(o.dangling.length === 1 && o.dangling[0].alias === 'Ghost',
    '悬空引用被单独列出来', JSON.stringify(o.dangling));
  // @LevelModules 的引用不该进悬空列表（它们本来就不在本文件里）
  const o2 = Outline.build(readTemplate('1.空白关卡.json').objects);
  ok(o2.dangling.length === 0, '空白关卡的 @LevelModules 引用不算悬空',
    JSON.stringify(o2.dangling));
}
{
  // 模板 8 的两个真孤立模块。同时验证「支撑对象」那一桶确实分得开：
  // 被出怪事件引用的僵尸类型不在模块/波次里，但可达，属于支撑对象，不该混进孤立模块。
  const doc = readTemplate('8.自定义僵尸示例.json');
  const o = Outline.build(doc.objects);
  const orphanNames = o.orphans.map(n => n.objclass).sort().join(',');
  ok(orphanNames === 'ZombiePropertySheet,ZombieType', '模板 8 的 2 个真孤立模块在大纲里也是孤立模块', orphanNames);
  ok(o.supporting.length > 0, '模板 8 有支撑对象（被引用但不是模块/波次）',
    o.supporting.map(n => n.objclass).join(','));
  ok(o.supporting.every(n => n.objclass !== 'ZombieType' || n.alias !== 'tutorial_2'),
    '支撑对象里没有那个真孤立模块');
  ok(o.orphans.length + o.supporting.length + o.used === o.total,
    '三桶加总等于对象总数', `${o.orphans.length}+${o.supporting.length}+${o.used}=${o.total}`);
}

// ── 体检报告 ──────────────────────────────────────────────────────────
//
// report.js 是「这份文件有什么毛病」的单一真源，状态栏 / 汇总条 / 对象树都被
// 同一份结果喂着。它的价值全在**合并**上，所以这里用一个同时踩中 2×3 里那几格的
// 探针把它钉死：一条只被 invalid 报的、一条只被 dangling 报的、一条只被 notes
// 报的、一条两边都报的 —— 再加**对象深处**那一行两格（本文件里找不到 / 来源没有数据）。
//
// 换个说法：这几条断言反过来读就是变异测试要抓的东西 —— 把去重换成 concat
// 会多一条，把并集换成只取 invalid 会少一条，不收 notes 也会少一条。
console.log('\n体检报告');
{
  const tpl = Templates.find(t => t.title === '传送带示例');
  const doc = JSON.parse(tpl.text);
  const def = Parse.findLevelDefinition(doc.objects);
  const wm = Parse.findByClass(doc.objects, 'WaveManagerProperties');
  ok(!!def && !!wm && Array.isArray(wm.objdata.Waves) && wm.objdata.Waves.length > 0,
    '探针模板有 Modules 也有波次（两个来源都得能塞进去）',
    `${!!def} / ${wm && wm.objdata.Waves.length}`);

  const GHOST = 'RTID(GhostModule@CurrentLevel)';        // Modules 里指本文件 -> 两边都报
  const WAVE_GHOST = 'RTID(GhostInWave@CurrentLevel)';   // 第 1 波里指本文件   -> 只有 dangling 报
  const TYPO = 'RTID(NotARealModule@LevelModules)';      // Modules 里指参考文件 -> 只有 invalid 报
  const WAVE_TYPO = 'RTID(NotARealEither@LevelModules)'; // 第 1 波里指参考文件 -> 只有 notes 报
  const DEEP_GHOST = 'RTID(NotARealDeepOne@CurrentLevel)'; // 对象深处指本文件 -> 只有 dangling 报
  const DEEP_UNKNOWN = 'RTID(NotARealDeepTwo@SkillTypes)'; // 对象深处，来源我们没数据 -> 不判

  // 探针本身得先成立，否则下面那些断言全是空的
  const fileAliases = Parse.allAliases(doc.objects);
  ok(!fileAliases.has('GhostModule') && !fileAliases.has('GhostInWave'),
    '探针用的别名确实不在文件里');
  ok(Refs.has('LevelModules') && !Refs.aliases('LevelModules').has('NotARealModule')
    && !Refs.aliases('LevelModules').has('NotARealEither'),
    '探针用的 @LevelModules 别名确实不在参考数据里（参考数据没加载的话这条会红）');

  def.objdata.Modules.push(GHOST, TYPO);
  wm.objdata.Waves[0].push(WAVE_GHOST, WAVE_TYPO);

  const rep = Report.build(doc.objects, Refs, Refs.aliases('LevelModules'));
  const byRtid = {};
  rep.invalidRefs.forEach(r => { byRtid[r.rtid] = r; });

  // 不去重的话 GHOST 会被 invalid 和 dangling 各报一次，变成 5 条
  ok(rep.invalidRefs.length === 4, '四处坏点合成 4 条（不是各算各的 5 条）',
    rep.invalidRefs.map(r => r.rtid).join(' '));
  ok(rep.counts.invalidRefs === rep.invalidRefs.length, 'counts 跟数组长度对得上');

  ok(!!byRtid[GHOST] && byRtid[GHOST].kind === 'missing',
    'Modules 里指本文件的坏引用算 missing', byRtid[GHOST] && byRtid[GHOST].kind);
  ok(!!byRtid[GHOST] && byRtid[GHOST].wheres.join('|') === 'LevelDefinition.Modules',
    '……而且只算一条，出处是 Modules', byRtid[GHOST] && byRtid[GHOST].wheres.join('|'));

  ok(!!byRtid[WAVE_GHOST] && byRtid[WAVE_GHOST].wheres.join('|') === '第 1 波',
    '波次里的坏引用被收进来了（窄口径会把它整个丢掉）',
    byRtid[WAVE_GHOST] && byRtid[WAVE_GHOST].wheres.join('|'));

  ok(!!byRtid[TYPO] && byRtid[TYPO].kind === 'alias-typo',
    '@LevelModules 里查不到的别名算 alias-typo —— 不降级成灰字',
    byRtid[TYPO] && byRtid[TYPO].kind);

  /* 第四格：波次里「参考文件里没有」的别名。它原先只进 outline.notes（树上一段
   * 灰字，明确写着"不算错误"），用户要求这个判定也划进失效引用，所以现在它必须
   * 出现在这份清单里，而且出处是那一波。
   * 这条是变异 M19 盯着的：把 report.js 里收 notes 的那一段删掉，这里就变空。 */
  ok(!!byRtid[WAVE_TYPO] && byRtid[WAVE_TYPO].kind === 'alias-typo',
    '参考文件里没有的别名也进失效引用（原先只在灰字提示里）',
    byRtid[WAVE_TYPO] && byRtid[WAVE_TYPO].kind);
  ok(!!byRtid[WAVE_TYPO] && byRtid[WAVE_TYPO].wheres.join('|') === '第 1 波',
    '……而且出处是它所在的那一波', byRtid[WAVE_TYPO] && byRtid[WAVE_TYPO].wheres.join('|'));

  /* 报告里不该再有一档独立的灰字 —— 三份清单都在 invalidRefs 里，两处并存就是
   * 「同一件事出现两次」。字段本身删掉了，所以这里断言的是"没这个字段"。 */
  ok(rep.notes === undefined && rep.counts.notes === undefined,
    '报告里不再有独立的灰字一档（三份清单都并进 invalidRefs 了）',
    JSON.stringify(Object.keys(rep)));

  /* 汇总条（用 counts.orphans）和树（用 outline.orphans）必须报同一个数，
   * 否则同一份文件在侧栏里有两个互相矛盾的孤立模块计数。
   * 特意换到模板 8：它**有** 2 个真孤立模块，用探针那份的话是 0 === 0，
   * 两边同时算错也照样绿。 */
  const doc8 = readTemplate('8.自定义僵尸示例.json');
  const rep8 = Report.build(doc8.objects, Refs, Refs.aliases('LevelModules'));
  ok(rep8.counts.orphans === 2 && rep8.counts.orphans === rep8.outline.orphans.length,
    '有根时两条口径的孤立模块数相等，且确实是 2 不是 0（汇总条和树不能各说各话）',
    `${rep8.counts.orphans} vs ${rep8.outline.orphans.length}`);

  /* ── 第三行：对象深处（objdata 里）──
   *
   * 这一行的第一格**曾经是个 bug**：outline.build 只把节点级的 notes 汇总进顶层，
   * dangling 一个都不收。于是对象深处一条落空的 @CurrentLevel 引用只表现为
   * 「那个对象连带不上、变成孤立模块」，失效引用那一栏一声不吭 —— 而游戏读到落空的
   * 引用会闪退。用户报的就是这个。
   *
   * 两格一起断言：收进来（第一格），以及**没有数据的外部来源仍然不判**（第二格）。
   * 后者是那 679 个 reference 对象的回归网 —— 顺手全收上来就是满屏误报。 */
  {
    /* 只挑**真正在对象深处**的引用：LevelDefinition 的 objdata 里装的就是 Modules
     * 数组、WaveManagerProperties 里装的是每一波，那两处上面已经由 resolveList 收过，
     * 拿它们当探针等于什么都没测（出处会是 LevelDefinition.Modules）。 */
    const isContainer = o => {
      const c = Parse.objClassOf(o);
      return c === 'LevelDefinition' || c === 'WaveManagerProperties';
    };
    const pick = objs => {
      const local = Parse.allAliases(objs);
      let hit = null;
      objs.forEach(o => {
        if (hit || isContainer(o)) return;
        Rtid.collectRefs(o && o.objdata, []).forEach(r => {
          if (!hit && r.source === 'CurrentLevel' && local.has(r.alias)) hit = { obj: o, ref: r };
        });
      });
      return hit;
    };
    const found = pick(doc.objects);
    ok(!!found, '探针模板里有一个「对象深处」的 @CurrentLevel 引用可用（探针本身得成立）',
      found ? Parse.objClassOf(found.obj) + ' 里的 ' + found.ref.full : '没找到');

    const deepSet = (objs, rtid) => {
      const h = pick(objs);
      h.obj.objdata = JSON.parse(JSON.stringify(h.obj.objdata).split(h.ref.full).join(rtid));
      return { host: h.obj, alias: (h.obj.aliases || [])[0] };
    };

    const d3 = JSON.parse(JSON.stringify(doc.objects));
    const t3 = deepSet(d3, DEEP_GHOST);
    const rep3 = Report.build(d3, Refs, Refs.aliases('LevelModules'));
    const hit3 = rep3.invalidRefs.filter(r => r.rtid === DEEP_GHOST)[0];
    ok(!!hit3 && hit3.kind === 'missing',
      '对象深处落空的 @CurrentLevel 引用进失效引用（原先只多一个孤立模块）',
      rep3.invalidRefs.map(r => r.rtid).join(' ') || '一条都没有');
    ok(!!hit3 && hit3.wheres.join('|') === t3.alias,
      '……而且出处是**那个对象**（不然用户不知道该去哪儿改）',
      hit3 && hit3.wheres.join('|'));
    ok(rep3.counts.invalidRefs === rep.counts.invalidRefs + 1,
      '整份清单只多这一条', `${rep.counts.invalidRefs} -> ${rep3.counts.invalidRefs}`);
    ok(Outline.nodeOf(t3.host, Outline.contextOf(d3, Refs)).dangling
        .some(x => x.alias === 'NotARealDeepOne'),
      '……节点上那个 ⚠ 也还在（树上和清单是同一份数据的两处渲染）');

    // 第二格：来源我们**没有数据**时不判 —— external-unknown 的边界
    ok(!Refs.has('SkillTypes'),
      '探针用的 @SkillTypes 确实是我们没数据的来源（有数据的话这条测试会失真）');
    const d4 = JSON.parse(JSON.stringify(doc.objects));
    const t4 = deepSet(d4, DEEP_UNKNOWN);
    const rep4 = Report.build(d4, Refs, Refs.aliases('LevelModules'));
    ok(rep4.counts.invalidRefs === rep.counts.invalidRefs,
      '没有数据的来源（@SkillTypes）一律不判 —— 收进来就是满屏误报',
      rep4.invalidRefs.map(r => r.rtid).join(' ') || '（没有，正确）');
    ok(Outline.nodeOf(t4.host, Outline.contextOf(d4, Refs)).dangling.length === 0,
      '……那个节点上也不标 ⚠（"我们没这个源"不是"引用落空"）');
  }

  /* 无根文件：findOrphanedObjects 有 hasRoot 守卫，大纲那条路没有 ——
   * computeReachableObjects 在没有 LevelDefinition 时返回空 Set，于是大纲会把
   * **每一个**对象都判成孤立模块。树上没露馅只因为 tree.js 在无根时提前 return，
   * 而汇总条在树外面。两条都断言，是为了让"守卫为什么必须存在"有据可查。 */
  const noRoot = doc.objects.filter(o => Parse.objClassOf(o) !== 'LevelDefinition');
  const rep2 = Report.build(noRoot, Refs, Refs.aliases('LevelModules'));
  ok(rep2.counts.orphans === 0,
    '没有 LevelDefinition 的文件不报孤立模块（否则汇总条会打出满屏红字）',
    String(rep2.counts.orphans));
  ok(rep2.outline.orphans.length > 0,
    '……而大纲那边确实会把一堆对象判成孤立模块（上面那条守卫就是为它设的）',
    String(rep2.outline.orphans.length));
}

// ── 写入键名的契约闸 ──────────────────────────────────────────────────
// edit.js 会往 objdata 里写这几个键。**它们的拼写必须跟游戏认的键一致**。
// 这条闸是被一次真实错误逼出来的：原先写的是小写 waveManagerProps / manualStartup，
// 而断言和实现用的是同一个错名字，于是测试全绿、数据却是错的。
// 光靠自洽的断言抓不到这种错，必须拿**外部真源**来校。
console.log('\n写入键名的契约闸');
{
  const S = global.ZLevel.Skeletons;
  const wmSkel = S && S.WaveManagerModuleProperties;
  ok(!!wmSkel, '骨架表里有波次管理器模块');
  // 真源一：骨架表（从 Kotlin 的 @SerializedName 提取）
  ok(wmSkel && 'WaveManagerProps' in wmSkel, 'WaveManagerProps 拼写与骨架一致（大写 W）');
  ok(wmSkel && !('waveManagerProps' in wmSkel), '骨架里没有小写 waveManagerProps');
  // ManualStartup 默认是 null 所以不出现在骨架里，改从真实模板或其他途径核对：
  // 它必须**不是**小写形式，且大写的要能被 edit.js 写出来
  const probe = readTemplate('2.自选卡示例.json');
  const objs = probe.objects;
  Edit.setManualStartup(objs, true);
  const written = Object.keys(Edit.findObject(objs, 'WaveManagerModuleProperties').objdata);
  ok(written.indexOf('ManualStartup') >= 0 && written.indexOf('manualStartup') < 0,
    'ManualStartup 落盘键名正确（大写 M）');

  // 真源二：真实模板里确实出现过的键，才算数
  const templateKeys = new Set();
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, f), 'utf8'));
    (d.objects || []).forEach(o => {
      if (o && o.objdata && typeof o.objdata === 'object') {
        Object.keys(o.objdata).forEach(k => templateKeys.add(k));
      }
    });
  }
  ok(templateKeys.has('Modules'), 'Modules 在真实模板里出现过');
  ok(templateKeys.has('Waves'), 'Waves 在真实模板里出现过');
  ok(templateKeys.has('WaveManagerProps'), 'WaveManagerProps 在真实模板里出现过');

  // 骨架表覆盖度：有骨架的必须是 CurrentLevel 来源（否则插入了也不建对象，白写），
  // 没骨架的必须是 LevelModules 来源（否则插出来是个空对象）。
  // 两个集合应当**完全重合**，这是一条很强的交叉验证。
  const allMeta = Modules.moduleGroups.concat(Modules.eventGroups)
    .reduce((a, g) => a.concat(g.items), []);
  const withSkel = allMeta.filter(m => m.objClass in S);
  const noSkel = allMeta.filter(m => !(m.objClass in S));
  ok(noSkel.every(m => m.defaultSource === 'LevelModules'),
    '没骨架的都是 @LevelModules 来源（只挂引用不建对象）',
    noSkel.filter(m => m.defaultSource !== 'LevelModules').map(m => m.objClass).join(',') || '无');
  // 反过来不成立：有两个模块有骨架却声明 @LevelModules，于是骨架永远用不上
  // （insertModule 只在 source 为 CurrentLevel 时才建对象）。这是上游就有的死数据，
  // 保留是为了跟 Z-Editor 注册表逐条对得上；列在这里，将来改了能被看见。
  const deadSkel = withSkel.filter(m => m.defaultSource === 'LevelModules')
    .map(m => m.objClass).sort();
  ok(deadSkel.join(',') === 'VaseBreakerArcadeModuleProperties,VaseBreakerFlowModuleProperties',
    '有骨架但 @LevelModules 的恰好这 2 个（骨架是上游死数据，不会被用上）',
    deadSkel.join(',') || '无');
  // 其余有骨架的必须是 CurrentLevel（事件条目没有 source 字段，按 CurrentLevel 处理）
  const oddSkel = withSkel.filter(m =>
    m.defaultSource && m.defaultSource !== 'CurrentLevel' && deadSkel.indexOf(m.objClass) < 0);
  ok(oddSkel.length === 0, '除上述 2 个外，有骨架的都是 @CurrentLevel',
    oddSkel.map(m => m.objClass).join(',') || '无');

  // 地底出怪：修过的那个 bug，钉住它别再退回去
  const ground = S.SpawnZombiesFromGroundSpawnerProps;
  ok(ground && 'ColumnStart' in ground && 'ColumnEnd' in ground,
    '地底出怪骨架带列范围（修过 Z-Editor 的工厂错配）', JSON.stringify(ground));
}

// ── 外部参考文件 ──────────────────────────────────────────────────────
/* 关卡的 RTID 有两种来源，性质完全不同：
 *   @CurrentLevel —— 对象就在本文件里，解不开是真错；
 *   @LevelModules / @ZombieTypes … —— 按定义就在**别的文件**里，本文件找不到是正常的。
 * 网页版原先只认本文件，于是把外部引用全判成「找不到引用」（9 份模板 153 条去重引用里
 * 71 条是误报）。搬进上游 reference/*.json 之后才分得清这两类。
 *
 * 这一节真正要钉住的**不是"误报变成 0"** —— 那条断言是假的：
 * 参考数据没加载时外部来源一律不判（fail-open），误报同样是 0，
 * 「数据是活的」和「数据压根没进来」输出完全一样。所以下面有一条非空性守卫。
 */
console.log('\n外部参考文件');
{
  const want = REF_SOURCES.slice().sort();
  ok(Refs.knownSources().join(',') === want.join(','), '6 个参考来源都加载了',
    Refs.knownSources().join(',') || '(空)');

  /* 别名数逐个钉住。数字变了只有两种可能：上游更新了（重跑 gen-refs.mjs 并同步这里），
   * 或者取值口径坏了 —— 比如没跳过取不到首别名的条目。GridItemTypes 里有 48 条取不到
   * （11 条把 aliases 拼成 alises、37 条本身没有别名），直接 o.aliases[0] 会在这 48 条上
   * 得到 undefined，混进集合就会多出 1 个元素（Set 去重后是同一个 undefined）。 */
  const WANT_COUNTS = {
    GridItemTypes: 460, LevelModules: 356, PlantTypes: 383,
    PropertySheets: 1922, ZombieActions: 536, ZombieTypes: 1029
  };
  const badCount = Object.keys(WANT_COUNTS)
    .filter(s => Refs.aliases(s).size !== WANT_COUNTS[s])
    .map(s => `${s} ${Refs.aliases(s).size}≠${WANT_COUNTS[s]}`);
  ok(badCount.length === 0, '各来源别名数与生成时一致（口径：只看首别名、跳过缺失的）',
    badCount.join('；') || Object.keys(WANT_COUNTS).length + ' 个来源');

  const junk = [];
  REF_SOURCES.forEach(s => Refs.aliases(s).forEach(a => {
    if (typeof a !== 'string' || !a) junk.push(s + ': ' + String(a));
  }));
  ok(junk.length === 0, '别名集合里没有空值（无别名条目确实被跳过了）', junk.slice(0, 3).join('; '));

  // 抽样。个数对得上不代表内容对得上，挑几个模板里真引用到的别名核一下。
  const spots = [
    ['LevelModules', 'StandardIntro'], ['ZombieTypes', 'tutorial'],
    ['GridItemTypes', 'rocket_landing'], ['PlantTypes', 'sunflower'],
    ['PropertySheets', 'DefaultGameProps'], ['ZombieActions', 'ZombieGeneralIdle']
  ];
  const noSpot = spots.filter(p => !Refs.aliases(p[0]).has(p[1]));
  ok(noSpot.length === 0, '抽样别名都取得到',
    noSpot.map(p => p.join('@')).join(',') || spots.map(p => p[1]).join(','));
}
{
  /* 分类判据。全站唯一的判据就是这个函数 —— 对象树的 ⚠/灰点、校验面板、可达性
   * 三处都走它，所以口径写错一处会同时错三处，值得单独钉死。 */
  const local = new Set(['SeedBank']);
  const C = (alias, source) => Parse.classifyRef(alias, source, local, Refs);
  ok(C('SeedBank', 'CurrentLevel') === 'local', '@CurrentLevel 且本文件有 -> 正常');
  ok(C('SeedBank', null) === 'local', '不写来源按 CurrentLevel 算 -> 正常');
  ok(C('Ghost', 'CurrentLevel') === 'missing', '@CurrentLevel 且本文件没有 -> 真失效');
  ok(C('Ghost', null) === 'missing', '不写来源且本文件没有 -> 真失效');
  ok(C('StandardIntro', 'LevelModules') === 'external', '外部来源里有这个别名 -> 正常');
  ok(C('StandardIntroTypo', 'LevelModules') === 'external-typo',
    '外部来源里没有 -> 只提示不算错（上游 ReferenceRepository 也是这个口径）');
  // 这个来源上游就没有对应的参考文件，而 data/module-skeletons.js 真在发它
  // （「阳光上限」那批核心模块），所以"没数据"必须是合法状态而不是错误
  ok(C('LevelModuleDifficultyMaxSun', 'LevelModulesDifficulty') === 'external-unknown',
    '我们没有数据的来源 -> 一律不判');
  ok(Refs.has('LevelModulesDifficulty') === false, '前提：LevelModulesDifficulty 确实没有参考文件');
  ok(Refs.aliases('LevelModulesDifficulty') === null, '没数据时 aliases 返回 null（不是空 Set）');
}
{
  /* 9 份模板：去重后 153 条引用 = 82 条本文件 + 71 条外部。
   * **71 这个数字就是非空性守卫**：数据没加载时 external 是 0、external-unknown 是 71，
   * 而"悬空 0 条、灰点 0 条"在两种情况下都成立。只断言 0 抓不住假绿，
   * 必须同时断言那 71 条**确实被判成了 external**（也就是确实查了数据、也确实查到了）。 */
  const tally = { local: 0, missing: 0, external: 0, 'external-typo': 0, 'external-unknown': 0 };
  const unknownSources = new Set();
  let dangling = 0, notes = 0, nodeDangling = 0, nodeNotes = 0, nodeCount = 0, objTotal = 0, consulted = 0;

  /* 树上的 ⚠ 和灰点走的是**节点级**的 dangling/notes，跟 outline 顶层的
   * dangling/notes 不是同一条路径：顶层那两个只由 Modules/Waves 的列表解析
   * （resolveList）产出，而节点级由 nodeOf 逐个对象产出。
   * 只断言顶层就等于完全放过了 nodeOf —— 变异测试验过：把 nodeOf 改回
   * 「所有查不到的别名都算 dangling」，顶层数字一点不变、整套照样全绿。
   * 而用户看到的那一排 ⚠ 恰恰来自节点级。所以两边都要断言。 */
  const nodesOf = o => {
    const out = [];
    const push = n => { if (n) out.push(n); };
    push(o.root); push(o.waveManager);
    o.modules.forEach(push); o.supporting.forEach(push); o.orphans.forEach(push);
    o.waves.forEach(w => w.items.forEach(push));
    return out;
  };
  // 记账替身：万一将来 outline 不再把 refs 传下去（比如参数漏了），
  // 分类就会全部走 external-unknown 而上面那些断言照样是 0 —— 这里记一笔就现形了。
  const counting = {
    has: function (s) { consulted++; return Refs.has(s); },
    aliases: function (s) { consulted++; return Refs.aliases(s); }
  };
  for (const f of files) {
    const objs = readTemplate(f).objects;
    const local = Parse.allAliases(objs);
    const seen = new Set();
    objs.forEach(o => Rtid.collectRefs(o && o.objdata, []).forEach(r => {
      if (seen.has(r.full)) return;
      seen.add(r.full);
      const c = Parse.classifyRef(r.alias, r.source, local, Refs);
      tally[c]++;
      if (c === 'external-unknown') unknownSources.add(r.source);
    }));
    const o = Outline.build(objs, counting);
    dangling += o.dangling.length;
    notes += o.notes.length;
    const ns = nodesOf(o);
    nodeCount += ns.length;
    ns.forEach(n => { nodeDangling += n.dangling.length; nodeNotes += n.notes.length; });
    objTotal += o.total;
  }
  ok(tally.missing === 0, '9 份模板的 @CurrentLevel 引用全部解得开', String(tally.missing));
  ok(tally['external-typo'] === 0, '9 份模板没有"外部来源里查不到"的别名',
    String(tally['external-typo']));
  ok(tally['external-unknown'] === 0, '9 份模板没用到我们没有数据的来源',
    [...unknownSources].join(',') || '无');
  ok(tally.external === 71, '71 条外部引用被参考数据真正解析了（假绿防线，不是"没判"）',
    String(tally.external));
  ok(tally.local === 82, '82 条本文件引用', String(tally.local));
  ok(tally.local + tally.external === 153, '两类加总等于去重引用总数（旧口径下 71 条是误报）',
    `${tally.local}+${tally.external}=153`);
  ok(dangling === 0 && notes === 0, '大纲顶层 0 条悬空、0 条灰点', `悬空 ${dangling} / 灰点 ${notes}`);
  ok(nodeDangling === 0 && nodeNotes === 0,
    '对象树的节点上 0 个 ⚠、0 个灰点（用户真正看到的那一排）',
    `⚠ ${nodeDangling} / 灰点 ${nodeNotes}`);
  ok(nodeCount >= objTotal, '节点数不少于对象数（上面那些 0 不是"没节点可标"）',
    `${nodeCount} 个节点 / ${objTotal} 个对象`);
  ok(consulted > 0, '大纲确实把引用拿去查了参考数据（记账替身被调用）', `${consulted} 次`);
}
{
  /* 可达性 —— 「清理」判孤立模块/失效模块的依据。这里有一处**对上游的刻意偏离**：
   * 上游 LevelParser.kt 用 substringBefore("@") 丢掉来源，于是 RTID(x@ZombieTypes)
   * 会给本文件里同名的 x 造一条假边，把真孤立模块藏起来、让「清理」漏掉它。
   * 偏离只走到"能证明这个别名属于别的文件"为止：来源我们没有数据时不猜。
   * 因为清理是**破坏性操作**，宁可漏报孤立模块，不可误删对象。 */
  const mk = ref => ([
    { objclass: 'LevelDefinition', aliases: ['Def'], objdata: { Modules: [ref] } },
    // 本文件里真有个叫 tutorial 的对象，ZombieTypes 里也有个 tutorial —— 同名不同物。
    // 这正是上游那个 bug 的场景：外部引用把本文件里同名的对象拉成了"可达"。
    { objclass: 'ZombieType', aliases: ['tutorial'], objdata: {} }
  ]);
  const orphans = ref => Parse.findOrphanedObjects(mk(ref), Refs).length;
  ok(Refs.aliases('ZombieTypes').has('tutorial'), '前提：ZombieTypes 里真有 tutorial');
  ok(orphans('RTID(tutorial@ZombieTypes)') === 1,
    '指向已加载外部来源的引用不算本文件的边（本地同名对象仍是孤立模块）');
  ok(orphans('RTID(tutorial@CurrentLevel)') === 0, '@CurrentLevel 的引用算边');
  ok(orphans('RTID(tutorial)') === 0, '不写来源的引用按 CurrentLevel 算边（上游有意容忍）');
  ok(orphans('RTID(tutorial@NoSuchSourceEver)') === 0,
    '来源我们没有数据时不猜（fail-open）—— 宁可漏报孤立模块，不可误删对象');

  /* 只是"算出来是孤立模块"还不够 —— 用户看见的那棵树和「清理」真删掉的东西
   * 必须对得上。这两条路径传 refs 的方式不一样：树那边是显式的
   * Outline.build(objs, refsTable())，而「清理」走 Edit.cleanupOrphaned ->
   * Parse.findOrphanedObjects(objects)（**省略** refs，靠 parse.js 里那个全局回退）。
   * 两边现在同一个来源所以一致，但这个一致性是隐式的 —— 谁改了回退或改了传参，
   * 结果就是"树说这 3 个能删、真删掉的是另外 3 个"，而那是**破坏性操作**。 */
  const collision = mk('RTID(tutorial@ZombieTypes)');
  const shown = Outline.build(collision, Refs).orphans.length;
  const removed = Edit.cleanupOrphaned(collision.slice()).length;
  ok(shown === 1 && removed === 1,
    '树上标出的孤立模块数 = 「清理」真删掉的数（这次是那条冲突引用造成的孤立模块）',
    `树 ${shown} / 清理 ${removed}`);

  // 9 份真模板上四种算法（隐式 refs / 显式 refs / 树 / 真清理）也必须一致
  const mism = [];
  for (const f of files) {
    const objs = readTemplate(f).objects;
    const implicit = Parse.findOrphanedObjects(objs).length;         // 省略 refs，走全局回退
    const explicit = Parse.findOrphanedObjects(objs, Refs).length;
    const tree = Outline.build(objs, Refs).orphans.length;
    const wiped = Edit.cleanupOrphaned(readTemplate(f).objects).length;
    if (!(implicit === explicit && explicit === tree && tree === wiped)) {
      mism.push(`${f} ${implicit}/${explicit}/${tree}/${wiped}`);
    }
  }
  ok(mism.length === 0, '9 份模板上「隐式 refs / 显式 refs / 对象树 / 真清理」四种算法一致',
    mism.join('; ') || '全部一致');
}
{
  /* build 的第二个参数有三种传法，语义**不一样**，而且区别不容易看出来：
   * 「省略」会去取全局表（parse.js 的 refsTable），只有「明确传 null」才是降级。
   * 这条区别原先在注释里写反过（写成"省略或传 null 都不判"），所以各钉一条。
   * 用"注入一个假外部别名"当探针：判得出就有灰点，不判就没有。 */
  const probe = () => {
    const d = readTemplate('2.自选卡示例.json');
    d.objects[0].objdata.Modules.push('RTID(__nope__@LevelModules)');
    return d.objects;
  };
  ok(Outline.build(probe(), Refs).notes.length === 1, '传表 -> 按它判（假别名进灰点）');
  ok(Outline.build(probe()).notes.length === 1,
    '省略 -> 取全局表，不是降级（假别名照样进灰点）');
  ok(Outline.build(probe(), null).notes.length === 0,
    '明确传 null -> 一律不判（不降级就不是降级）');
  ok(Outline.build(probe(), null).dangling.length === 0,
    '明确传 null 时误报仍然是 0');
}

{
  /* 降级：参考数据没进来（脚本没加载、或将来某个环境里挂了）时，
   * 外部来源一律不判 —— 误报必须仍然是 0，而不是满屏红。
   * 同时本文件内的真失效必须照报，降级不能把真错误一起吞掉。 */
  const saved = window.ZLevel.RefData;
  try {
    delete window.ZLevel.RefData;
    ok(Refs.has('LevelModules') === false, '数据没了：has 返回 false');
    ok(Refs.knownSources().length === 0, '数据没了：knownSources 为空');
    /* 别名集合此刻**仍然拿得到**（前面几节已经建好并缓存了），跟 has() 不一致。
     * 这是有意的、也是安全的：判分类的入口是 has()，缓存里的旧集合不会让
     * 上面那条 external-unknown 失效。这里把不一致本身钉住，免得后人"顺手修好"
     * 把缓存加进 has()，那才会真让 fail-open 失效。 */
    ok(Refs.aliases('LevelModules') !== null,
      '数据没了但别名集合还在缓存里（与 has 不一致，是有意的）');
    ok(Parse.classifyRef('StandardIntro', 'LevelModules', new Set(), Refs) === 'external-unknown',
      '数据没了：外部来源走「不判」');
    ok(Parse.classifyRef('Ghost', 'CurrentLevel', new Set(), Refs) === 'missing',
      '数据没了：@CurrentLevel 的失效照报（降级不吞真错误）');
    let dangling = 0;
    for (const f of files) dangling += Outline.build(readTemplate(f).objects, Refs).dangling.length;
    ok(dangling === 0, '数据没了也不会把外部引用误报成悬空', String(dangling));
  } finally {
    window.ZLevel.RefData = saved;
  }
  // 「没数据」不是可缓存的结果，恢复后必须能重新取到 —— 缓存里存了空结果就再也回不来了
  ok(Refs.aliases('LevelModules') !== null && Refs.aliases('LevelModules').has('StandardIntro'),
    '恢复数据后别名集合又能取到（空结果没被写进缓存）');
}
{
  /* 与上游逐字节对账。参考文件 7.6 MB 不进 fixtures（放一份仓库就翻倍），
   * 所以这条只在有 Z-Editor 检出时跑；没有就**明说跳过**，不静默降级（README 的规矩）。 */
  const refDir = process.env.Z_EDITOR_REF
    ? path.join(process.env.Z_EDITOR_REF, 'app/src/main/assets/reference')
    : 'E:/code/PVZ2LevelEditor/app/src/main/assets/reference';
  if (!readJsonDir(refDir)) {
    console.log('  --  没有 Z-Editor 检出，跳过参考文件字节对账');
  } else {
    const bad = [];
    for (const s of REF_SOURCES) {
      let up;
      try { up = fs.readFileSync(path.join(refDir, s + '.json'), 'utf8'); } catch (e) { bad.push(s + '(上游缺)'); continue; }
      if (!fs.readFileSync(path.join(ROOT, 'reference', s + '.js'), 'utf8').includes(up)) bad.push(s);
    }
    ok(bad.length === 0,
      'reference/*.js 里嵌的原文与上游逐字节相同（上游更新后重跑 gen-refs.mjs）', bad.join(','));
  }
}
{
  /* 生成器的安全闸反向用例。内嵌裸字面量有几个经典炸点（</script 让 HTML 解析器
   * 提前掐断脚本、CRLF、__proto__ 静默改语义……），assertEmbeddable 拦的就是它们。
   * 但"拦得住"这件事光看它今天没报错证明不了 —— 要喂一个**真有毒**的输入，
   * 确认它报错退出，而不是默默生成一个会白屏的文件。
   *
   * 用真实进程跑（不是把函数抠出来单测）：这样连"发现问题后到底退没退"也一起验了。 */
  const { execFileSync } = require('child_process');
  const os = require('os');
  /* 输入和**输出**都指到临时目录。输出那个口子（Z_EDITOR_REF_OUT）是必须的：
   * 生成器默认往仓库的 reference/ 里写，而下面那条"干净输入不误拦"的用例
   * 会真的生成一个文件 —— 第一版没这个变量，跑一次自检就往仓库里丢了个
   * reference/Clean.js，差一步提交进去。自检**不该有副作用**。 */
  const genEnv = tmp => Object.assign({}, process.env, {
    Z_EDITOR_REF: tmp,
    Z_EDITOR_REF_OUT: path.join(tmp, 'out')
  });
  const POISON = [
    ['含 </script', '{"objects":[{"aliases":["A"]}],"note":"</script>"}'],
    ['含 CRLF', '{\r\n"objects":[{"aliases":["A"]}]\r\n}'],
    ['含 __proto__ 键', '{"objects":[{"aliases":["A"]}],"__proto__":{"x":1}}'],
    ['不是合法 JSON', '{"objects":['],
    ['顶层没有 objects', '{"version":1}'],
    ['开头有 BOM', '\ufeff{"objects":[{"aliases":["A"]}]}']
  ];
  const missed = [];
  for (const [label, text] of POISON) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zref-'));
    const src = path.join(tmp, 'app/src/main/assets/reference');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'Poison.json'), text);
    let status = 0, out = '';
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'tools/gen-refs.mjs')],
        { env: genEnv(tmp), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      status = e.status;
      out = (e.stderr || '') + (e.stdout || '');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    // 退出码必须是 1 且确实报了 Poison 这个名字 —— 只判退出码的话，
    // 生成器因为别的原因（比如路径写错）挂掉也会"通过"
    if (status !== 1 || out.indexOf('Poison') < 0) missed.push(`${label}(退出 ${status})`);
  }
  ok(missed.length === 0, '生成器拦得住每一种不能安全内嵌的输入并报错退出',
    missed.join('; ') || `${POISON.length} 种毒输入`);

  // 反向的反向：干净的输入不能被误拦（否则上面那条"拦得住"可以用"见谁都拦"骗过去）
  // 顺带验证产物真的落在 Z_EDITOR_REF_OUT 指的地方 —— 不然这个口子坏了，
  // 自检又会开始往仓库里丢文件，而"退出码 0"照样绿。
  const tmpOk = fs.mkdtempSync(path.join(os.tmpdir(), 'zref-'));
  const srcOk = path.join(tmpOk, 'app/src/main/assets/reference');
  fs.mkdirSync(srcOk, { recursive: true });
  fs.writeFileSync(path.join(srcOk, 'Clean.json'),
    '{"objects":[{"objclass":"A","aliases":["A"],"objdata":{}}]}');
  let okStatus = 0;
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'tools/gen-refs.mjs')],
      { env: genEnv(tmpOk), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { okStatus = e.status; } finally {
    ok(okStatus === 0, '干净的输入不误拦（否则上面那条用"见谁都拦"也能通过）', `退出 ${okStatus}`);
    okStatus = fs.existsSync(path.join(tmpOk, 'out', 'Clean.js')) ? 0 : 1;
    // 仓库里不该多出东西 —— 自检有副作用的话，下一次 git status 就会看见它
    ok(!fs.existsSync(path.join(ROOT, 'reference', 'Clean.js')) &&
       !fs.existsSync(path.join(ROOT, 'reference', 'Poison.js')),
      '自检没有往仓库的 reference/ 里写文件（生成器的输出口子生效）');
    fs.rmSync(tmpOk, { recursive: true, force: true });
  }
  ok(okStatus === 0, '产物落在 Z_EDITOR_REF_OUT 指的地方', `退出 ${okStatus}`);
}

console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
