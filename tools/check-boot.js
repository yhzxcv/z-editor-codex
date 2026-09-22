/* 把整页在无头 DOM 里真跑一遍：node tools/check-boot.js
 *
 * 前面三个套件都是"静态看"或"单模块跑"。这个不一样 —— 它按 index.html
 * 的顺序加载全部脚本、触发 DOMContentLoaded、等 boot() 跑完，然后**真的去点**。
 * 抓的是只有整页跑起来才会暴露的错误：CM6 初始化抛异常、事件没接上、
 * 点击回调里引用错东西……也就是"点了没反应"那一类。
 *
 * 用法上它是开发时的诊断工具，不进 npm run check（jsdom 是 devDependency，
 * 而 check 那套要保证 clone 下来不装依赖也能跑）。
 *
 * 它**不能**替代人眼：布局、hover、滚动、真实渲染效果都测不出来。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 自己按顺序注入脚本，不让 jsdom 去异步取资源 —— 顺序确定、报错归因清楚。
// 所以先把 HTML 里的 <script src> 摘掉。
const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
const shell = html.replace(/<script src="[^"]+"><\/script>/g, '');

const problems = [];
const logs = [];
const vc = new VirtualConsole();
// 注意：DOM 事件监听器里抛的异常**不会**传回 dispatchEvent —— 规范规定要报到
// 全局错误处理上。所以这个 virtualConsole 是唯一能看见"点了没反应"真正原因的地方。
// 栈一定要带上：光看消息只知道炸了，不知道炸在哪一行。
vc.on('jsdomError', e => {
  const err = e.detail || e;
  problems.push('jsdomError: ' + (err.message || e.message) +
    '\n      ' + String(err.stack || '').split('\n').slice(1, 5).join('\n      '));
});
vc.on('error', (...a) => { problems.push('console.error: ' + a.join(' ')); });
vc.on('warn', (...a) => { logs.push('warn: ' + a.join(' ')); });
vc.on('log', (...a) => logs.push('log: ' + a.join(' ')));

const dom = new JSDOM(shell, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,          // 给 requestAnimationFrame
  url: 'http://localhost:8000/',
  virtualConsole: vc
});
const win = dom.window;

// jsdom 没有的浏览器 API，按 CM6 的最低需要补上
win.matchMedia = win.matchMedia || (q => ({
  matches: false, media: q, addEventListener() {}, removeEventListener() {},
  addListener() {}, removeListener() {}
}));
if (!win.ResizeObserver) {
  win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
// CM6 量文本尺寸要用 canvas 的 measureText；jsdom 没实现，给个假的
win.HTMLCanvasElement.prototype.getContext = function () {
  return {
    measureText: t => ({ width: String(t).length * 7 }),
    font: '', fillText() {}, save() {}, restore() {}, scale() {}, clearRect() {},
    setTransform() {}, drawImage() {}
  };
};

/* CM6 量选区时要读 Range.getClientRects / getBoundingClientRect，jsdom 的 Range
 * 两个都没实现。**只要有人动了焦点**（图鉴浮层把焦点接到自己身上、或者还给侧栏
 * 那个入口按钮）CM 就会走这条路 —— 报出来的是一条 jsdomError，扫雷那一节会红，
 * 而红得莫名其妙（看起来跟焦点八竿子打不着）。浏览器里这两个方法都有。 */
if (win.Range && !win.Range.prototype.getClientRects) {
  win.Range.prototype.getClientRects = function () { return []; };
  win.Range.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  };
}

/* 剪贴板桩。jsdom 里 navigator.clipboard / isSecureContext 都是 undefined，
 * document.execCommand 干脆不存在。
 *
 * 装它**不是为了"别炸"** —— 不装也不会红，只是"图鉴点击复制"这条路一次都验不了。
 * 它是**唯一能验证三档格式（纯代码 / 带引号 / RTID）的抓手**，顺带还能验
 * "长按之后有没有误触发复制"。copied 是给下面「侧栏」一节读的。 */
const copied = [];
win.isSecureContext = true;
Object.defineProperty(win.navigator, 'clipboard', {
  value: { writeText: t => { copied.push(String(t)); return Promise.resolve(); } },
  configurable: true
});

/* 提示条的**历史**。
 *
 * 为什么要拦 `textContent` 的写入：图鉴的复制走 navigator.clipboard（异步 API），
 * "已复制 …"那句 toast 写在一个 .then 里，而这个文件**整个是同步的** —— 微任务要等
 * 脚本跑完才排。等它能读的时候，后面的扫雷已经又复制了几十次、提示条早被覆盖了。
 *
 * 所以记下**每一次**写入，断言时用**下标**（追加式列表里下标是定的），而不是
 * "现在提示条上写着什么"。写入本身还是异步的，那些断言得攒到 deferred 里、
 * 汇总前统一跑（那时微任务已经排干）。
 *
 * 只拦这一个元素，而且只拦 textContent —— 读还是走原样（前面几节有读它做断言的）。 */
const toastHistory = [];
const deferredChecks = [];
/** 记下一条"要等 Promise 落地才判得了"的断言。 */
function afterMicrotasks(fn) { deferredChecks.push(fn); }

/** from 之后（含）有没有出现过**正好是** msg 的那条提示。
 *
 *  为什么不能按下标取"那一条"：同步的 toast 当场就写进历史了，而复制是异步的 ——
 *  所有"已复制 …"要等脚本跑完、微任务排干才落地，落在历史**末尾**，跟点击顺序
 *  对不上。所以只能问"这之后出现过没有"，而且要用**整串相等**去问：
 *  复制出来的字符串本身就是独一无二的，拿它当判据最结实。 */
function toastSaidAfter(from, msg) {
  return toastHistory.slice(from).indexOf(msg) >= 0;
}

{
  const t = win.document.getElementById('toast');   // 这里 doc 还没定义，直接问 win 要
  let last = t.textContent;
  Object.defineProperty(t, 'textContent', {
    configurable: true,
    get() { return last; },
    set(v) { last = String(v); toastHistory.push(last); }
  });
}

// ── 1. 按 HTML 顺序把脚本塞进去 ────────────────────────────────────────
console.log('加载脚本');
const loadErrors = [];
for (const s of srcs) {
  const code = fs.readFileSync(path.join(ROOT, s), 'utf8');
  try {
    win.eval(code);
  } catch (e) {
    loadErrors.push(`${s}: ${e.message}`);
  }
}
console.log(`  ${loadErrors.length ? '!!' : 'OK'}  ${srcs.length} 个脚本注入完毕`);
loadErrors.forEach(e => console.log('      ' + e));

// ── 2. 触发 DOMContentLoaded，让 boot() 跑起来 ─────────────────────────
console.log('\nboot()');
let bootErr = null;
try {
  win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));
} catch (e) {
  bootErr = e;
}
const bootProblems = problems.slice();
console.log(`  ${bootErr ? '!!' : 'OK'}  boot() 没有抛异常`);
if (bootErr) console.log('      ' + bootErr.message + '\n' + (bootErr.stack || '').split('\n').slice(1, 4).join('\n'));

// ── 3. boot() 之后页面该有的东西 ───────────────────────────────────────
console.log('\n页面状态');
// 断言失败必须影响退出码。曾经这里只往控制台打 `!!`，退出码只看
// "有没有抛异常"，于是断言全红也照样 `整页跑通` + exit 0 —— 一个假绿生成器。
const failures = [];
function ok(cond, label, extra) {
  console.log(`  ${cond ? 'OK  ' : '!!  '}${label}${extra ? '   ' + extra : ''}`);
  if (!cond) failures.push(label);
  return cond;
}
const doc = win.document;

const editorHost = doc.getElementById('editor');
ok(editorHost && editorHost.querySelector('.cm-editor'),
  'CodeMirror 编辑器渲染出来了',
  editorHost ? `子元素 ${editorHost.children.length} 个` : '找不到 #editor');

ok(!!editorHost.querySelector('.cm-content'),
  '编辑器有内容区（.cm-content）');
const gutter = editorHost.querySelector('.cm-gutters');
ok(!!gutter, '行号 gutter 在');
ok(!!editorHost.querySelector('.cm-gutter-lint'), 'lint gutter 在（错误波浪线靠它）');

const treeHtml = doc.getElementById('panel-tree').innerHTML;
ok(treeHtml.trim().length > 0, '对象树渲染了内容', `panel-tree ${treeHtml.length} 字符`);
ok(/LevelDefinition/.test(treeHtml), '对象树里有 LevelDefinition');

const status = doc.getElementById('statusbar').textContent;
ok(status.trim().length > 0, '状态栏有文字', JSON.stringify(status.slice(0, 60)));
ok(doc.getElementById('doc-name').textContent !== '未打开文件',
  '顶栏显示了文件名', doc.getElementById('doc-name').textContent);

/* 撤销/重做按钮是**常驻**的：刚打开文件时历史是空的，两个按钮该在、但置灰。
 * 曾经它们靠 hidden 属性藏起来，于是顶栏的按钮忽左忽右地跳，用户也没法从
 * "按钮没了"分辨出是没东西可撤、还是这功能不在这儿。
 * 下面同时钉住两件事：`hidden` 必须是 false（常驻），`disabled` 必须是 true（置灰）。 */
{
  const u = doc.getElementById('btn-undo');
  const r = doc.getElementById('btn-redo');
  ok(!!u && !!r, '顶栏有撤销和重做两个按钮');
  ok(u && r && !u.hidden && !r.hidden, '两个按钮常驻，不是藏起来的',
    `undo.hidden=${u && u.hidden} redo.hidden=${r && r.hidden}`);
  ok(u && r && u.disabled && r.disabled, '刚打开文件没有历史，两个按钮都是置灰的',
    `undo.disabled=${u && u.disabled} redo.disabled=${r && r.disabled}`);
  ok(u && r && /Ctrl\+Z/.test(u.title) && /Ctrl\+Y/.test(r.title),
    '置灰时 tooltip 也说明了快捷键', JSON.stringify([u && u.title, r && r.title]));
}

/* 刚打开、没有语法错误的时候，顶上那条红色横幅必须是空的。
 * 用户报的"没有语法错误时顶上还是会出现一块红框"就是这个位置。 */
{
  const bar = doc.getElementById('errbar');
  ok(bar.hidden, '没有语法错误，横幅是藏着的');
  ok(bar.textContent === '', '而且里面一点字都没有', JSON.stringify(bar.textContent.slice(0, 40)));
}

// ── 4. 真的去点 ────────────────────────────────────────────────────────
console.log('\n交互');

function click(el, label) {
  const before = problems.length;
  try {
    el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  } catch (e) {
    problems.push(`点击「${label}」时抛异常: ${e.message}`);
  }
  const news = problems.slice(before);
  const bad = news.filter(p => !/Not implemented|Could not parse CSS/.test(p));
  return bad;
}

// 4a. 页签切换
{
  const tabs = [...doc.querySelectorAll('.tabs button')];
  ok(tabs.length === 3, '3 个页签按钮', String(tabs.length));
  const bad = click(tabs[1], '模块');
  const shown = doc.getElementById('panel-modules');
  const hiddenTree = doc.getElementById('panel-tree').hidden;
  ok(shown && !shown.hidden && hiddenTree, '点「模块」页签后两个面板正确互换',
    `modules.hidden=${shown && shown.hidden} tree.hidden=${hiddenTree}`);
  if (bad.length) console.log('      点击报错: ' + bad[0]);

  // 模块面板里该有模块分组
  const insHtml = shown.innerHTML;
  ok(insHtml.length > 200, '模块面板有内容', `${insHtml.length} 字符`);
  click(tabs[0], '对象');
}

// 4b. 顶栏按钮
{
  const bad = click(doc.getElementById('btn-templates'), '模板');
  const pop = doc.getElementById('tpl-pop');
  ok(!pop.hidden, '点「模板」弹层打开了', `hidden=${pop.hidden}`);
  ok(pop.children.length >= 9, '模板列表有 9 项', `${pop.children.length} 项`);
  if (bad.length) console.log('      点击报错: ' + bad[0]);
  click(doc.getElementById('btn-settings'), '设置');
  ok(!doc.getElementById('settings').hidden, '点 ⚙ 设置弹层打开了');
}

// 4c. 对象树里点一行 —— 这才是"跳转"那条路
{
  const go = doc.querySelector('#panel-tree .node-go');
  ok(!!go, '对象树里有可点的行');
  if (go) {
    const bad = click(go, '对象树行');
    if (bad.length) console.log('      点击报错: ' + bad[0]);
    const sel = win.document.querySelector('.cm-content');
    ok(!!sel, '点了对象树之后编辑器还在');
  }
}

// ── 5. 核心操作：插入 / 撤销 / 语法错误 / 主题 ────────────────────────
//
// 前面几节只证明"页面画出来了"。真正要证明的是"点了有用" —— 所以这里
// 从头走一遍用户会走的路径，每一步都拿编辑器的实际文本来验，不看界面文字。
console.log('\n核心操作');

// CM6 把 view 挂在 DOM 上，可以通过它拿到编辑器状态
function view() {
  return win.CM.EditorView.findFromDOM(doc.querySelector('.cm-editor'));
}
function cmText() { return view().state.doc.toString(); }
function treeCount() { return doc.querySelectorAll('#panel-tree .node-go').length; }
function objCount() { return JSON.parse(cmText()).objects.length; }

// 删除要弹 confirm。jsdom 的 confirm 是「未实现」，直接会报 Not implemented，
// 而且返回 undefined（=取消）。这里替掉它 —— 替的是浏览器对话框，不是被测代码。
win.confirm = function () { return true; };

ok(!!view(), '能通过 DOM 拿到 EditorView');

const blankText = cmText();
const treeBefore = treeCount();
const objsBefore = objCount();

// 5a/5b 各自的产物文本，5c 要靠它们验"撤销/重做能原路走回去"。
// 拿对象个数验是不够的 —— 结构操作会重新序列化整份 JSON，对象数一样、
// 文本不一样的组合多得很，只有比文本才知道是不是真的回到了那一步。
let insertedText = '';
let deletedText = '';

/* 5a. 插入一个模块 —— 走「模块」页的新路子：**点一行看详情，浮层里按「插入」**
 *
 * 这一节是模块详情浮层的**主测试用例**。它要钉住的是整条新链路：
 *   点行**不插**（旧行为是点一下就进关卡）→ 浮层开出来、开的是这个模块 →
 *   键表按插入骨架画出来 → 降级接缝活着（加一条 ModuleDocs 就从 auto 升到 doc，
 *   而词条只写中文：抄错的键名画不出假行、中文挂在对的那个键上）→
 *   按「插入」才真插 → 插完浮层关掉、回侧栏。
 *
 * 最后一段（文本变了 / 是合法 JSON / 撤销亮起来）是**老断言，一条没动** ——
 * 换了入口之后插入本身还得跟以前一模一样，那也是这条用例的一半价值。
 */
{
  const tabs = [...doc.querySelectorAll('.tabs button')];
  click(tabs[1], '模块');

  /* 词条文件必须**真的被 index.html 注进来**。光看 `tools/check.js` 绿没用：那边是 node
   * 自己 require 的，跟页面怎么加载无关 —— index.html 里漏挂一行，用户把 224 个键全填满
   * 也是白填（浮层永远停在 auto 那一档），而两边的自检**全都还是绿的**。 */
  ok(!!win.ZEditor.ModuleDocs, 'data/module-docs.js 被 index.html 注进来了（词条文件真到得了页面）');

  const groupHead = doc.querySelector('#panel-modules .ins-group-h');
  ok(!!groupHead, '模块面板有模块分组');
  click(groupHead, '展开分组');

  const btn = doc.querySelector('#panel-modules .ins-group-b .ins-main');
  ok(!!btn, '分组里能点到模块行');
  const meta = win.ZLevel.Modules.moduleGroups[0].items[0];
  ok(btn && btn.textContent.indexOf(meta.title) >= 0, '第一行就是注册表里的第一个模块',
    btn && btn.textContent.slice(0, 30));

  /* ── 一行的样子：中文名 + 标签 / objClass / 灰字提示（2026-09-22 用户点名改的）──
   *
   * 原先名字、objClass、标签、说明全挤在一行里，而侧栏只有 200 多像素宽：objClass 是
   * 等宽长串（`WaveManagerModuleProperties`），它一挤就把标签（"核心"/"可多个"/"引用"）
   * 顶到看不见的地方。改完是**三行**，所以要钉的是"哪一块在第几行"和"标签确实跟名字
   * 同一行"。
   *
   * 只钉得住结构（三块各是什么字、什么顺序）；"字号行距看着顺不顺"是排版，jsdom 不做
   * 排版 —— 那种事得人眼看。 */
  const slots = [...btn.children].map(c => c.className);
  ok(slots.join('|') === 'ins-top|ins-cls|ins-desc' || slots.join('|') === 'ins-top|ins-cls',
    '行里就三块，顺序是：名字那一行 / objClass / 灰字提示（没有 desc 时第三块不画）',
    slots.join('|'));
  const top = btn.querySelector('.ins-top');
  const clsEl = btn.querySelector('.ins-cls');
  ok(!!top && !!top.querySelector('.ins-title'),
    '第一块里是中文名（不是 objClass 顶在第一行）', top && top.textContent);
  ok(!!clsEl && clsEl.textContent === meta.objClass,
    '第二块就是 objClass —— 插进去的是哪个类，得看得见',
    clsEl && clsEl.textContent);
  /* 标签跟名字**同一行**：分两行的话第一行只剩名字，而"核心/可多个/引用"这三个标
   * 正是决定"要不要插、能不能插第二个"的东西。这里挑一个真带标签的模块来验（第一个
   * 模块未必有），免得断言在"这一行本来就没标签"的情况下恒真。 */
  const tagged = [...doc.querySelectorAll('#panel-modules .ins-main')]
    .find(b => b.querySelector('.ins-top .tag'));
  ok(!!tagged, '（前提）列表里找得到一个带标签的模块行');
  ok(!!tagged && [...tagged.querySelector('.ins-top').children]
    .every(c => /ins-title|tag|ins-more/.test(c.className)),
    '标签画在**名字那一行**里（跟着名字走，不被 objClass 挤到下一行）',
    tagged && tagged.querySelector('.ins-top').textContent);
  ok(!!btn.querySelector('.ins-more'), '行尾那个「详情 ›」在（点它是看详情，不是插入）');
  /* 分组底下那段灰字（g.note）没了 —— 用户原话"分类下的 note 多余，就是每个关卡这些
   * 灰字"。说明该挂在**那一行**上：挂在组头上，用户得在组里对照哪句说的是哪一个。
   *
   * 拿注册表里的 note 原文去对侧栏的字（一边是数据、一边是页面），不去猜它原先叫什么
   * 类名 —— 猜类名的断言在"类名猜错了"和"那段灰字真没了"两种情况下都是绿的。 */
  const M0 = win.ZLevel.Modules;
  const gnotes = M0.moduleGroups.concat(M0.eventGroups).map(g => g.note).filter(Boolean);
  ok(gnotes.length > 0, '（前提）注册表里确实有分组说明，下面那条才说明得了问题',
    String(gnotes.length));
  const panelText = doc.getElementById('panel-modules').textContent;
  const leaked = gnotes.filter(n => panelText.indexOf(n) >= 0);
  ok(leaked.length === 0, '分组底下那段灰字说明没画出来（用户点名去掉的那句）',
    leaked[0] || '');

  /* 下面这一节验的是**三档降级本身**，不是眼下那份词条数据。而词条是会长大的（用户一个个
   * 填中文），所以先把 ModuleDocs 换成一个空的、跑完原样还回去 —— 不然哪天谁给这个模块
   * 填上一句中文，「第一行走 auto 那一档」就会在系统完全正确的情况下变红。 */
  const prevDocs = win.ZEditor.ModuleDocs;
  win.ZEditor.ModuleDocs = {};

  /* 点一行**不再**直接插入。这条必须钉死：旧行为要是悄悄回来了（比如谁把
   * openOverlay 又接回了 doInsertModule），别处的断言全都还是绿的 ——
   * 文本会变、树会长，看起来一切正常。 */
  const textBeforeDetail = cmText();
  const badOpen = click(btn, '打开模块详情');
  if (badOpen.length) console.log('      报错: ' + badOpen[0]);
  ok(cmText() === textBeforeDetail, '点模块行**没有**往关卡里插东西（开的是详情，不是插入）');

  const modal = doc.querySelector('.mdl-modal');
  ok(!!modal && !modal.hidden, '点一行弹出了模块详情浮层');

  const st = win.ZEditor.ModulePanel.state();
  ok(st.open && st.objClass === meta.objClass && st.kind === 'module',
    '浮层开着的就是这个模块（state 里问出来的，不是读 DOM 反推）',
    `${st.open}/${st.objClass}/${st.kind}`);

  /* 键表：条数必须**等于插入骨架的键数**。
   * 只断言"浮层里有「键表」三个字"是不够的 —— 空表也满足，而这一屏的全部价值
   * 就是把骨架里的键摊开给用户看。 */
  const sk = win.ZLevel.Skeletons[meta.objClass];
  const wantKeys = sk ? Object.keys(sk).length : 0;
  ok(wantKeys > 0, '（前提）这个模块在插入骨架表里有条目，键表才有得画', String(wantKeys));
  ok(st.keys === wantKeys && st.keysMode === 'auto',
    '键表按插入骨架画出来了（条数对得上，眼下走 auto 那一档）',
    `keys=${st.keys}/${wantKeys} mode=${st.keysMode}`);
  ok(modal.querySelectorAll('.mdl-krow').length === wantKeys,
    '浮层里真画出来了这么多行键', String(modal.querySelectorAll('.mdl-krow').length));
  ok(/从插入骨架读出来的/.test(modal.textContent) && /没有人工说明/.test(modal.textContent),
    'auto 那一档明说"值是从插入骨架读出来的、还没有人工说明"，用户知道这一档的来路');

  /* 「结构值」那一档那个框里装的是**真值**，不是一个占位符。
   * WaveManagerModuleProperties 的 DynamicZombies 骨架里带着一条完整记录，所以框里
   * 必须看得见那条记录的字段名 —— 换成 `[]` 或者一句"（空）"就说明这一段是在装样子。
   * 拿骨架里的字段名去对 DOM 里的字，两边不是一个来源。
   *
   * ⚠ 读的是 **.value**，不是 textContent：这一块 2026-09-22 从只读的 <pre> 换成了
   * 可编辑的 <textarea>，而 textarea 的 textContent 是"初始的子文本节点"—— 程序设
   * .value 不会动它，读出来永远是空的。写成 textContent 的话这条断言会变成一句
   * 恒假的空话（而且变异测试里也照样"变红"，看不出区别）。 */
  const dbg = [...modal.querySelectorAll('.mdl-krow')]
    .find(r => r.querySelector('.mdl-kname').textContent === 'DynamicZombies');
  ok(!!dbg && /PointIncrementPerWave/.test(dbg.querySelector('.mdl-struct-code').value),
    '结构值那个框里是骨架里那段真值（不是占位符）');

  /* 三档降级里 doc 那一档**现在还没有真数据**（ModuleDocs 还没写），所以临时注入
   * 一条词条，验完立刻删掉。验的是**接缝**而不是那份数据：加一条词条就该从 auto
   * 升到 doc，module-panel.js 一行都不用改 —— 「以后再加具体注释」那条路走不走得通，
   * 就是这一条在管。 */
  win.ZEditor.ModuleDocs[meta.objClass] = {
    desc: '（测试用的临时说明）',
    /* 词条是**稀疏**的：键名 / 默认值一律从骨架读，人只写中文。这一份里刻意埋了两处：
     *   `Nope` —— 骨架里没有的键名（人抄错的样子），它**不该**变出一行来；
     *   写中文的那个键**不是第一行**（骨架里头一个是 DynamicZombies），
     *   用来验"中文挂在对的那个键上"、不是按位置发下去的。 */
    keys: { WaveManagerProps: '甲', Nope: '乙' }
  };
  /** 某一行键的整格文字。按 .mdl-kname 找，不是按行号 —— 行号正是不能信的东西。 */
  const rowOf = k => {
    const hit = [...modal.querySelectorAll('.mdl-krow')]
      .find(r => r.querySelector('.mdl-kname').textContent === k);
    return hit ? hit.textContent : '';
  };
  try {
    click(btn, '再开一次详情');
    const st2 = win.ZEditor.ModulePanel.state();
    ok(st2.keysMode === 'doc',
      '往 ModuleDocs 里加一条词条，同一个模块就从 auto 升到 doc（面板代码不用动）',
      `mode=${st2.keysMode} keys=${st2.keys}`);
    /* 两半各是一种坏法：行数多了 = 词条自带键名；界面里出现 Nope = 那个错键名被画出来
     * 了。写成一条是因为它们是同一件事（行从哪来）的两面，而出错时得看得见是哪一面。 */
    ok(st2.keys === wantKeys && !/Nope/.test(modal.textContent),
      '词条里抄错的键名不会变出一行（行只来自插入骨架，不来自人手抄的键名）',
      `keys=${st2.keys}/${wantKeys}，界面上出现了那个错键名=${/Nope/.test(modal.textContent)}`);
    ok(/甲/.test(rowOf('WaveManagerProps')),
      '说明挂在了它对应的那个键上（不是按位置发下去的）');
    /* ── 键表最下面那一行：人工注释，没写就摆占位（2026-09-22 用户点名的字）──
     *
     * 两半都得测：只测"有注释的显示中文"的话，"没注释的整行留白"照样绿（用户分不出
     * "还没人写"和"这一段画漏了"，那正是留白的问题）；只测占位那半的话，"所有键都
     * 显示占位"（注释根本没挂上去）也照样绿。 */
    const rowNode = k => [...modal.querySelectorAll('.mdl-krow')]
      .find(r => r.querySelector('.mdl-kname').textContent === k);
    const withDoc = rowNode('WaveManagerProps');
    const noDoc = rowNode('DynamicZombies');
    ok(!!withDoc && !!withDoc.querySelector('.mdl-kdoc')
      && !withDoc.querySelector('.mdl-kdoc-todo'),
      '有说明的键：最下面那行就是那段中文，而且不是占位那一档',
      withDoc && withDoc.querySelector('.mdl-kdoc') && withDoc.querySelector('.mdl-kdoc').textContent);
    ok(!!noDoc && !!noDoc.querySelector('.mdl-kdoc-todo')
      && noDoc.querySelector('.mdl-kdoc-todo').textContent === '待添加注释',
      '还没人写说明的键：摆「待添加注释」占位（不留白，也不冒充注释正文）',
      noDoc && noDoc.querySelector('.mdl-kdoc-todo') && noDoc.querySelector('.mdl-kdoc-todo').textContent);
  } finally {
    /* 原样还回去，不是 delete —— 真实词条文件是页面加载进来的，删了它后面所有断言都
     * 在"没有词条的世界"里跑，而那种红跟"代码坏了"混在一起分不清。 */
    if (prevDocs === undefined) delete win.ZEditor.ModuleDocs;
    else win.ZEditor.ModuleDocs = prevDocs;
  }

  const ins = modal.querySelector('.mdl-insert');
  ok(!!ins && !ins.disabled, '浮层里有可点的「插入」');
  const bad = click(ins, '按浮层里的插入');
  if (bad.length) console.log('      报错: ' + bad[0]);

  /* 插完浮层关掉、回侧栏 —— 插完一个多半还要插下一个，不该被浮层关在外面。 */
  ok(modal.hidden, '插入之后浮层关掉了');
  ok(!win.ZEditor.ModulePanel.state().open, '……state 里也是关着的');

  const after = cmText();
  ok(after !== blankText, '插入后编辑器文本变了', `${blankText.length} -> ${after.length} 字符`);
  ok(after.indexOf('Modules') >= 0, '文本里出现了 Modules（RTID 挂上了）');
  ok(treeCount() > treeBefore, '对象树多了行', `${treeBefore} -> ${treeCount()}`);

  const undoBtn = doc.getElementById('btn-undo');
  ok(!undoBtn.disabled, '「撤销」按钮亮了（不再是置灰的）');
  ok(/已做过结构操作/.test(doc.getElementById('statusbar').textContent),
    '状态栏提示"已做过结构操作"');

  // 插入的内容必须是合法 JSON —— 结构操作会重新序列化整份文件
  let parsed = null;
  try { parsed = JSON.parse(after); } catch (e) { /* 下面断言会报 */ }
  ok(!!parsed, '插入后整体仍是合法 JSON');
  ok(parsed && parsed.objects.length > objsBefore, '对象数确实增加了',
    parsed && `${objsBefore} -> ${parsed.objects.length}`);
  ok(/插入/.test(doc.getElementById('btn-undo').title), '撤销按钮说的是「撤销插入」',
    JSON.stringify(doc.getElementById('btn-undo').title.slice(0, 24)));
  insertedText = after;
}

// 5b. 从对象树删掉刚插进来的那个 —— 走的是另一条结构操作路径
{
  const alias = win.ZLevel.Modules.moduleGroups[0].items[0].defaultAlias;
  // 树里这个对象所在的行；行内 ✕ 才是删除
  const rows = [...doc.querySelectorAll('#panel-tree .node')];
  const row = rows.find(r => r.textContent.indexOf(alias) >= 0);
  ok(!!row, `对象树里能找到刚插入的 ${alias}`);
  const del = row && row.querySelector('.node-del');
  ok(!!del, '这一行有删除按钮（根对象的行不该有，模块的行该有）');

  const bad = del ? click(del, '删除对象') : [];
  if (bad.length) console.log('      报错: ' + bad[0]);

  ok(objCount() === objsBefore, `删除后对象数回到 ${objsBefore}`, String(objCount()));
  ok(/删除/.test(doc.getElementById('btn-undo').title), '撤销按钮现在说的是「撤销删除」');
  deletedText = cmText();
}

/* 5c. 撤销/重做是一条**能来回走的栈**：连撤两次，再连重做两次，要原路走回去。
 *
 * 每一步都比文本，不比对象个数 —— 撤销必须把文档还原成**当时那一串字节**，
 * 而对象个数相同、文本不同的情况太多了（结构操作会重新序列化）。
 * 三份文本的来路：blankText 是载入时的原文，insertedText 是插入后，
 * deletedText 是删除后。 */
{
  const undoBtn = doc.getElementById('btn-undo');
  const redoBtn = doc.getElementById('btn-redo');

  click(undoBtn, '撤销删除');
  ok(cmText() === insertedText, '撤销一次：文档原样回到"插入之后"',
    `${deletedText.length} -> ${cmText().length} 字符`);
  ok(!undoBtn.disabled, '还有得撤，撤销按钮还亮着');

  ok(!redoBtn.disabled, '撤销之后「重做」按钮亮了');
  ok(/删除/.test(redoBtn.title), '重做按钮说的是「重做删除」',
    JSON.stringify(redoBtn.title.slice(0, 24)));

  const before = cmText();
  click(undoBtn, '撤销插入');
  ok(cmText() === blankText, '再撤销一次：文本回到最初', `${before.length} -> ${cmText().length} 字符`);
  ok(undoBtn.disabled, '栈空了，撤销按钮置灰');

  // ── 重做：得能把刚才那两步按原路走回来 ──
  ok(!redoBtn.disabled, '撤销到底之后，重做按钮还亮着');
  click(redoBtn, '重做插入');
  ok(cmText() === insertedText, '重做一次：回到"插入之后"', `${cmText().length} 字符`);
  ok(!undoBtn.disabled, '重做之后撤销按钮又亮了');
  ok(/删除/.test(redoBtn.title), '接着要重做的是「删除」', JSON.stringify(redoBtn.title.slice(0, 24)));

  click(redoBtn, '重做删除');
  ok(cmText() === deletedText, '重做两次：回到"删除之后"');
  ok(redoBtn.disabled, '重做走到底，重做按钮置灰');

  // ── 收尾：把文档倒回最初。
  //    后面的用例都建立在"当前文档是空白关卡"上，不能把脏状态漏出去。 */
  click(undoBtn, '撤销删除（收尾）');
  click(undoBtn, '撤销插入（收尾）');
  ok(cmText() === blankText, '收尾：文档回到最初', `${cmText().length} 字符`);
  // 撤销不清空重做分支 —— 这是 CM 的行为，也是对的（不然"撤过头了"就没法回头）。
  // 下一节要是不重新载入文档，这个还亮着的重做按钮就是"脏状态"。
  ok(undoBtn.disabled, '撤销到底，撤销按钮置灰');
  ok(!redoBtn.disabled, '但重做分支还在（撤销不清空重做）');
}

// 5d. 语法错误 -> 波浪线 -> 修好
{
  const v = view();
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: '{"objects": [}' } });

  ok(!doc.getElementById('errbar').hidden, '语法错误时红色横幅出现',
    JSON.stringify(doc.getElementById('errbar').textContent.slice(0, 50)));
  // 横幅要写人话，不是引擎的英文
  ok(!/Unexpected|JSON\.parse/.test(doc.getElementById('errbar').textContent),
    '横幅里不是引擎的英文原文');

  ok(!!doc.querySelector('.cm-lintRange'), '编辑器里画出了波浪线（.cm-lintRange）');
  ok(!!doc.querySelector('.cm-gutter-lint .cm-lint-marker'),
    'gutter 上有错误标记');
  ok(/JSON 有误/.test(doc.getElementById('statusbar').textContent), '状态栏说 JSON 有误');

  // 结构操作必须在语法错误时被拒 —— 否则会把半截文本序列化成
  // 一个"合法但不是用户想要"的文件，比直接报错危险得多
  const tabs = [...doc.querySelectorAll('.tabs button')];
  click(tabs[1], '模块');
  const groupHead = doc.querySelector('#panel-modules .ins-group-h');
  ok(!!groupHead, '语法错误时模块面板还在（没塌）');
  if (groupHead) click(groupHead, '展开分组');
  const row = doc.querySelector('#panel-modules .ins-group-b .ins-main');
  ok(!!row, '语法错误时模块行仍然可点（拒绝要发生在点之后，不能靠藏按钮）');
  const txt = cmText();
  const badRow = row ? click(row, '语法错误时看详情') : [];
  const modal = doc.querySelector('.mdl-modal');
  const insBtn = modal && !modal.hidden ? modal.querySelector('.mdl-insert') : null;
  ok(!!insBtn, '（前提）详情浮层开出来了，「插入」在');
  const bad = insBtn ? click(insBtn, '语法错误时插入') : [];
  ok(cmText() === txt, '语法错误时插入被拒绝（文本没动）');
  /* 只看"文本没动"是不够的 —— 抛异常也是"没动"。得看用户收到的是不是一句人话。
   * （这条是被变异测试逼出来的：把 state.js 的守卫拿掉后，插入改成抛异常，
   *   "文本没动"照样绿。）
   *
   * 这句话现在写在**浮层里**（.mdl-err），不再是 toast：浮层开着时 toast 在它底下，
   * 用户未必看得见；而且浮层**不关**正是为了让用户看着这句话把这一屏读完。 */
  const err = modal && modal.querySelector('.mdl-err');
  ok(err && !err.hidden && /语法错误/.test(err.textContent),
    '拒绝时给了提示，不是默默失败', JSON.stringify(err && err.textContent));
  ok(modal && !modal.hidden, '被拒绝时浮层**不关** —— 用户正看着的那一屏还在');
  ok(badRow.length === 0 && bad.length === 0, '拒绝的过程本身没有抛异常');

  // 修好 -> 波浪线和横幅都该消失
  const v2 = view();
  v2.dispatch({ changes: { from: 0, to: v2.state.doc.length, insert: blankText } });
  const bar2 = doc.getElementById('errbar');
  ok(bar2.hidden, '修好之后横幅消失');
  /* 而且**里面的字也得清掉**。用户报的正是"错误改好了，报错文本还留在上面"——
   * 那次的根因在 CSS（`.errbar { display: flex }` 盖掉了 [hidden] 的 display:none，
   * 见 check-editor.js 里那条静态断言），但过期文字还能被看见这件事本身，
   * 说明 renderErrorBar 的提前 return 把上一次的节点留在了 DOM 里。
   * 两条防线各管一边：CSS 那条保证藏得住，这条保证就算藏不住也不是旧内容。 */
  ok(bar2.textContent === '', '修好之后横幅里的报错文字也清空了',
    JSON.stringify(bar2.textContent.slice(0, 40)));
  ok(!doc.querySelector('.cm-lintRange'), '修好之后波浪线消失');

  /* 被拒绝时浮层留着是有意的，但这一节该把状态还回去。后面每一节都会重新点页签，
   * 而"点页签 = 点在浮层外面"会让浮层自己收起来 —— 与其依赖那个副作用，
   * 不如在这儿点一次 ✕，顺便把这条路径也走一遍。 */
  const mclose = modal && modal.querySelector('.mdl-mclose');
  if (mclose) click(mclose, '关掉详情浮层');
  ok(!modal || modal.hidden, '点 ✕ 能关掉浮层（这一节结束时它是关着的）');
}

/* 5d-3. 外部参考引用：满屏「找不到引用」那个 bug 的回归测试。
 *
 * 这一节是**唯一**能抓到 main.js 里那个接线断掉的地方：
 *   check-level.js 直接调 Outline.build(objs, Refs)，绕过了界面；
 *   check-editor.js 只看命名空间在不在，不看有没有接上。
 * 只有整页跑起来、真的开一份模板，才看得见「所有 @LevelModules 都被标成
 * 找不到引用」——那是用户报的原话。
 *
 * 反过来说，这一节红了**也可能**是接线断了（main.js 里 refsTable() 返回 null）。
 * 那种情况下表现是"页面一切正常、只是外部引用又全变悬空"，属于静默失效，
 * 所以「0 个 ⚠」这条必须配上后面「注入一个真错必须报」那条一起看：
 * 只有后者证明判据是活的，前者的 0 才有意义。 */
{
  /* 本段只借用一下"有内容的文档"，用完必须把文档还原成进来时的样子。
   * 不还原的话后面 5e 会拿到「坚不可摧」而不是它预期的空白关卡 ——
   * 那份模板里第一个模块已经存在，插入按钮会拒绝，于是
   * 「切主题之后结构操作仍然有用」凭空变红。（第一版就是这么挂的。） */
  const docIn = cmText();
  click(doc.getElementById('btn-templates'), '模板');
  const it = [...doc.querySelectorAll('#tpl-pop button')].find(x => /坚不可摧/.test(x.textContent));
  ok(!!it, '找到「坚不可摧示例」（这份模板里 @LevelModules / @ZombieTypes 引用最多）');
  if (it) click(it, '选坚不可摧');

  const tree = doc.getElementById('panel-tree');
  const warns = [...tree.querySelectorAll('.node-warn')];
  ok(warns.length === 0, '对象树里 0 个 ⚠（外部引用不再被误报成悬空）',
    warns.map(w => w.title).join(' | ') || '无');
  /* 「参考文件里没有」现在是失效引用的一档，所以它既不该单独成段，也不该
   * 在 ⚠ 的提示里出现 —— 这份模板的别名在参考数据里查得到。 */
  ok(!/参考文件里没有/.test(tree.textContent), '对象树里没有「参考文件里没有」那一段（已并进失效引用）');
  ok(!doc.querySelector('#panel-tree .sec-warn .sec-title') ||
     !/失效引用/.test(tree.textContent), '对象树里没有「失效引用」那一段');

  const st = doc.getElementById('statusbar').textContent;
  ok(!/个失效引用/.test(st), '状态栏没说有失效引用', JSON.stringify(st.slice(0, 80)));

  // 反过来：判据得是活的。注入一个 @LevelModules 的假别名，必须冒出来 ——
  // 不然上面那几个 0 也可能只是"什么都没在判"（fail-open 的静默降级）。
  {
    const v = view();
    const before = cmText();
    const after = before.replace(/RTID\(([A-Za-z0-9_]+)@LevelModules\)/,
      'RTID(__definitely_not_a_real_module__@LevelModules)');
    ok(after !== before, '改写出一处 @LevelModules 的假别名');
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: after } });
    const t2 = doc.getElementById('panel-tree');
    const n2 = [...t2.querySelectorAll('.node-warn')];
    ok(n2.some(w => /参考文件里没有/.test(w.title)),
      '假的 @LevelModules 别名冒出来了（判据是活的，上面那几个 0 不是"什么都没在判"）',
      n2.map(w => w.title).join(' | ') || '一个都没有');
    /* 报的必须是「参考文件里没有」这一档，不是「本文件里找不到」—— 两者混了
     * 的话用户按提示去本文件里找，什么都找不到。 */
    ok(!n2.some(w => /本文件里找不到/.test(w.title)),
      '……而且分得清是哪一档（@LevelModules 的别名要去参考数据里找）',
      n2.map(w => w.title).join(' | '));
    ok(/1 个失效引用/.test(doc.getElementById('statusbar').textContent),
      '状态栏把它算成失效引用（这个判定原先走灰字、明确写着"不算错误"）',
      JSON.stringify(doc.getElementById('statusbar').textContent.slice(0, 80)));

    // 收尾：还原假别名
    const v2 = view();
    v2.dispatch({ changes: { from: 0, to: v2.state.doc.length, insert: before } });
    ok(cmText() === before, '假别名已撤回');
  }

  // 还原成本段进来之前的那份文档（见开头 docIn 的注释：不还原会连累 5e）
  const v3 = view();
  v3.dispatch({ changes: { from: 0, to: v3.state.doc.length, insert: docIn } });
  ok(cmText() === docIn, '本段借用的文档已还原（不把状态漏给后面的用例）');
}

/* 5d-4. 事件那一半 —— 波次选择器搬进浮层了
 *
 * 5a 在空白关卡上跑，那里一个波次都没有，正好是「没有波次」那一档。**有波次**那一档
 * 得借一份有内容的文档。
 *
 * ⚠ 这一段**必须排在历史那几条（5c）后面**：还原文档走的是 `dispatch(整篇替换)`，
 * 它会往历史里压一条。放在前面的话 5c 的"撤销两次回到最初"就得多撤一次 ——
 * 第一版就是搁在 5a 后面，把 5c 的「文本回到最初」「栈空了」两条打红了。
 * 跟 5d 一样借完就还，不把状态漏出去。 */
{
  const docIn = cmText();

  ok(loadTemplate(/坚不可摧/), '（前提）载入一份有波次的关卡');

  const modCount = win.ZLevel.Modules.moduleGroups
    .reduce((a, g) => a + g.items.length, 0);
  /* 事件行排在模块行**后面**（同一个侧栏，先模块后事件），所以按扁平下标取。
   * 用偏移量而不是"找一个 objClass 像事件的"：后者要猜，猜错了这条用例会静默地
   * 测到别的行上，而且照样全绿。 */
  const evRow = [...doc.querySelectorAll('#panel-modules .ins-main')][modCount];
  ok(!!evRow, '（前提）侧栏里有事件行（模块行之后第一条）', `偏移 ${modCount}`);

  click(evRow, '打开事件详情');
  const modal = doc.querySelector('.mdl-modal');
  const st = win.ZEditor.ModulePanel.state();
  ok(st.open && st.kind === 'event', '事件行弹出来的详情是 event 那一档',
    `${st.open}/${st.kind}`);

  /* 波次那一行只对事件有意义。模块的详情里它是藏着的（5a 那一段没验，
   * 因为模块详情根本没往下滚到那儿 —— 这里顺手补上）。 */
  const waveRow = modal.querySelector('.wave-pick');
  ok(waveRow && !waveRow.hidden, '事件的详情里有「插入到第 N 波」');

  const sel = waveRow.querySelector('select');
  const wm = JSON.parse(cmText()).objects.find(o => o.objclass === 'WaveManagerProperties');
  const want = (wm && wm.objdata && Array.isArray(wm.objdata.Waves)) ? wm.objdata.Waves.length : 0;
  ok(want > 0, '（前提）这份关卡真的有波次，才验得了"有波次"这一档', String(want));
  ok(!sel.disabled && sel.options.length === want,
    '波次下拉列出来的就是真实波数（现读的，不是缓存的下拉）',
    `${sel.options.length} vs ${want}`);

  const ins = modal.querySelector('.mdl-insert');
  ok(ins && !ins.disabled, '有波次时「插入」是可点的');
  sel.value = '2';
  const objsBefore2 = objCount();
  const bad = click(ins, '插入事件到第 2 波');
  if (bad.length) console.log('      报错: ' + bad[0]);

  ok(modal.hidden, '插完事件浮层也关掉了（跟模块那条一样的约定）');
  ok(objCount() > objsBefore2, '事件真的插进关卡了', `${objsBefore2} -> ${objCount()}`);
  ok(win.ZEditor.ModulePanel.state().waveIndex === 2, '……插的是选中的第 2 波');

  const v = view();
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: docIn } });
  ok(cmText() === docIn, '本段借用的文档已还原（不把状态漏给后面的用例）');
}

/* 5d-5. 插入界面：键表是**能改的表单**，改过的值真的写进关卡里
 *
 * 5a 验到"键表按骨架画出来了"为止 —— 那时候它还是一张只读的表。这一节验的是它变成
 * 表单之后的每一件事：控件按形状画、改的值进得了文本、数字框填坏了插不进去、
 * 「恢复默认」退得回去、结构值那一档插完把光标送到那个键上。
 *
 * ⚠ 挑的是种子库（SeedBankProperties）：骨架里 5 个键三种形状都有，3 个结构值
 * （三个数组）、1 个字符串、1 个数字。
 *
 * ⚠ **不能**拿 5a 那个 WaveManagerModuleProperties 来验"改过的值写进去了"：
 * Edit.insertModule 对它有一条特例，插入时会把 WaveManagerProps 那个键改写成文件里
 * 真实的那个 RTID —— 而它正好是那个模块唯一的字符串键。拿它验只会得到一个假红。
 *
 * ⚠ 排在 5d-4 后面，并跟它一样"借完就还"：这一段也要借文档（要挑模块）。 */
{
  const docIn = cmText();
  const modal = doc.querySelector('.mdl-modal');
  const stNow = () => win.ZEditor.ModulePanel.state();

  const meta = win.ZLevel.Modules.moduleGroups[0].items
    .find(m => m.objClass === 'SeedBankProperties');
  ok(!!meta, '（前提）注册表里有种子库这个模块');
  const sk = win.ZLevel.Skeletons.SeedBankProperties;
  ok(!!sk, '（前提）种子库在插入骨架表里有条目');

  const isStruct = v => Array.isArray(v) || (v && typeof v === 'object');
  const keysOf = t => Object.keys(sk).filter(k => typeof sk[k] === t);
  const structKeys = Object.keys(sk).filter(k => isStruct(sk[k]));
  const strKeys = keysOf('string');
  const numKeys = keysOf('number');
  ok(structKeys.length === 3 && strKeys.length === 1 && numKeys.length === 1,
    '（前提）这个模块的键三种形状都有，才验得了"按形状挑控件"',
    `结构 ${structKeys.length} / 字符串 ${strKeys.length} / 数字 ${numKeys.length}`);

  const rowEl = k => [...modal.querySelectorAll('.mdl-krow')]
    .find(r => r.querySelector('.mdl-kname').textContent === k);
  const inputOf = k => { const r = rowEl(k); return r && r.querySelector('.mdl-kinput'); };
  const fire = (node, type) => node.dispatchEvent(new win.Event(type, { bubbles: true }));

  const btn = [...doc.querySelectorAll('#panel-modules .ins-main')]
    .find(b => b.querySelector('.ins-cls')
      && b.querySelector('.ins-cls').textContent === 'SeedBankProperties');
  ok(!!btn, '（前提）侧栏里找得到种子库那一行');
  click(btn, '打开种子库详情');
  ok(stNow().objClass === 'SeedBankProperties', '浮层开的是种子库');
  /* 「代号」那一格**两档都有**（2026-09-22 用户要的："新建模块界面也要支持代号命名"）。
   * 插入这一档填的是新对象的代号，预填元数据里的默认别名 —— 得看得见，不然用户不知道
   * 插进去会叫什么名字。**没动它**这件事也有意义：没动就传 null，走的还是"默认别名 +
   * 去重"那条老路（改成别的才按填的来，见下面 mock 那一段）。 */
  ok(meta.defaultAlias, '（前提）这个模块的元数据里有默认别名', String(meta.defaultAlias));
  ok(stNow().alias.shown === true, '插入这一档也有「代号」那一格');
  ok(stNow().alias.orig === meta.defaultAlias && stNow().alias.changed === false,
    '……预填的是元数据里的默认别名，用户没动它（所以走的还是"默认别名 + 去重"那条路）',
    `orig=${stNow().alias.orig} changed=${stNow().alias.changed}`);
  /* DOM 那一份也要对：状态里说"填了"而框里是空的，正是那种"屏幕说一套、写下去另一套"
   * 的入口（自检读状态变量读不出来）。 */
  const aliasField0 = modal.querySelector('.mdl-alias-in');
  ok(!!aliasField0 && aliasField0.value === meta.defaultAlias,
    '……而且那个框里真填上了这个名字（不是只在状态里）',
    aliasField0 && aliasField0.value);
  /* 控件按**形状**挑，而形状只有一个来源：骨架里的默认值。这里不重算一遍那个规则
   * （那是自己跟自己比），而是拿 DOM 里画出来的控件去对骨架里的值 —— 一边是页面，
   * 一边是数据。 */
  const nStruct = modal.querySelectorAll('.mdl-struct-code').length;
  const nNum = modal.querySelectorAll('.mdl-kinput[type="number"]').length;
  const nStr = modal.querySelectorAll('.mdl-kinput[type="text"]').length;
  ok(nStruct === structKeys.length && nNum === numKeys.length && nStr === strKeys.length,
    '控件按值的形状挑：数组画一个 JSON 框、数字画数字框、字符串画文本框',
    `结构 ${nStruct} / 数字 ${nNum} / 文本 ${nStr}`);
  ok(modal.querySelectorAll('.mdl-krow').length === Object.keys(sk).length,
    '每个键一行，一个不多一个不少', String(modal.querySelectorAll('.mdl-krow').length));

  /* ── 改一个键 → 顶上的计数出现 → ↺ 退回默认 ── */
  const strKey = strKeys[0];
  const strIn = inputOf(strKey);
  ok(!!strIn && strIn.value === String(sk[strKey]),
    '文本框预填的就是骨架里的默认值', strIn && strIn.value);
  strIn.value = 'preset';
  fire(strIn, 'input');
  ok(stNow().edited.join() === strKey && stNow().values[strKey] === 'preset',
    '改了之后值进了表单（不是只在输入框里躺着）', JSON.stringify(stNow().values));

  const bar = modal.querySelector('.mdl-formbar');
  ok(bar && !bar.hidden && /已改 1 个键/.test(bar.textContent),
    '顶上出现「已改 1 个键」，用户知道自己动过东西', bar && bar.textContent.trim());

  click(rowEl(strKey).querySelector('.mdl-reset'), '按「↺ 默认」');
  ok(stNow().edited.length === 0 && inputOf(strKey).value === String(sk[strKey]),
    '「↺ 默认」把这个键退回骨架默认值，计数也收了', inputOf(strKey).value);

  /* ── 改两个键 → 「全部恢复默认」两个一起退 ── */
  const numKey = numKeys[0];
  const numIn = inputOf(numKey);
  ok(!!numIn && numIn.value === String(sk[numKey]), '数字框预填的也是默认值', numIn && numIn.value);
  strIn.value = 'preset'; fire(strIn, 'input');
  numIn.value = '12'; fire(numIn, 'input');
  ok(stNow().edited.length === 2, '两个键都算改过了', stNow().edited.join());

  click(modal.querySelector('.mdl-resetall'), '按「全部恢复默认」');
  ok(stNow().edited.length === 0 && inputOf(strKey).value === String(sk[strKey])
    && inputOf(numKey).value === String(sk[numKey]),
    '「全部恢复默认」把两个键一起退回去');

  /* ── 数字框：整数和小数都得吃（数值是双精度浮点） ──
   * 上游那些模块的数字参数不全是整数（速度、时长、倍率、坐标都是小数）。这里拿
   * 同一个数字键连打两个值：整数的 12 和 6.5，**写进去的必须还是 number**、而且
   * 不能被磨成整数 —— `parseInt` 那种写法在界面上一点异样都没有，只有文件里的值
   * 不对（6.5 变成 6）。 */
  numIn.value = '6.5'; fire(numIn, 'input');
  ok(stNow().values[numKey] === 6.5 && typeof stNow().values[numKey] === 'number',
    '数字框吃小数：6.5 进去还是 6.5（没被磨成整数）',
    JSON.stringify(stNow().values[numKey]));
  numIn.value = '-0.25'; fire(numIn, 'input');
  ok(stNow().values[numKey] === -0.25, '负小数也认',
    JSON.stringify(stNow().values[numKey]));
  numIn.value = '12'; fire(numIn, 'input');

  /* ── 数字框填成不是数的东西：插入必须被拦住（而且要说是哪个键） ──
   * 清空是最常见的中间态（"全选再重打"），所以这里验的正是那一瞬间。 */
  numIn.value = ''; fire(numIn, 'input');
  ok(stNow().canInsert === false && stNow().badKey === numKey,
    '数字框空了（打一半的中间态）时插入被拦住');
  ok(/要填一个数字/.test(modal.textContent),
    '并且说清了是哪个键不对，不是默默禁用按钮');
  numIn.value = '12'; fire(numIn, 'input');
  ok(stNow().canInsert === true && !stNow().badKey, '填回一个数就又能插了');

  /* ── 落点：这儿**没有**落点可选（那个功能用户点名删了） ──
   * 原先每个结构值键配一个「插完光标落到这个键」的单选框，插完把光标送到那个键的
   * **值**上。用户的原话是"多余功能，光标按之前逻辑在原插入位置就行"。
   * 这里盯两件事：控件真的没了（不是藏起来），以及下面那条"落点 = 整个新对象"。 */
  ok(modal.querySelectorAll('input[type="radio"]').length === 0,
    '浮层里已经没有「插完光标落到这个键」那排单选框了（用户点名删掉的功能）',
    String(modal.querySelectorAll('input[type="radio"]').length));

  /* ── 插入：写进去的必须是改过的值 ── */
  strIn.value = 'preset'; fire(strIn, 'input');
  numIn.value = '12'; fire(numIn, 'input');
  const objsBefore2 = objCount();
  const bad = click(modal.querySelector('.mdl-insert'), '按插入（表单选过的值）');
  if (bad.length) console.log('      报错: ' + bad[0]);
  ok(modal.hidden, '插完浮层关掉');
  ok(objCount() > objsBefore2, '对象真的建出来了', `${objsBefore2} -> ${objCount()}`);

  const created = (JSON.parse(cmText()).objects || [])
    .find(o => o.objclass === 'SeedBankProperties');
  ok(!!created, '关卡里多了一个种子库对象');
  ok(created && created.objdata.SelectionMethod === 'preset',
    '改过的字符串键：插进去的就是改过的值', created && String(created.objdata.SelectionMethod));
  ok(created && created.objdata.OverrideSeedSlotsCount === 12
    && typeof created.objdata.OverrideSeedSlotsCount === 'number',
    '改过的数字键：插进去的是**数字** 12，不是字符串 "12"',
    created && typeof created.objdata.OverrideSeedSlotsCount);
  ok(created && JSON.stringify(created.objdata.PresetPlantList) === '[]',
    '没改过的键照旧写骨架默认值（改了俩键不等于把别的丢了）');
  ok(created && Object.keys(created.objdata).length === Object.keys(sk).length,
    '写进去的键一个不多一个不少',
    created && `${Object.keys(created.objdata).length}/${Object.keys(sk).length}`);

  /* 光标：插完落在**刚建出来的那个对象**上（"之前那个逻辑"）。
   * 断言分两半，缺一不可：右边那段得解得开，而且解得开的得**正是刚插进去的那个
   * 对象** —— 光看"选中的是一段 JSON"不够，落在别处任何一个对象身上都成立。 */
  const sel = view().state.selection.main;
  const text = cmText();
  let landed = null;
  try { landed = JSON.parse(text.slice(sel.from, sel.to)); } catch (e) { /* 下面报 */ }
  ok(landed !== null && sel.to > sel.from,
    '插完选中的是一整段（不是空光标、也不是一小截）', `${sel.from}..${sel.to}`);
  ok(landed && landed.objclass === 'SeedBankProperties'
    && landed.objdata && landed.objdata.OverrideSeedSlotsCount === 12,
    '落下的那一个正是刚插进去的那个对象（带着刚填的值），不是别处同名的东西',
    JSON.stringify(landed && { objclass: landed.objclass, v: landed.objdata && landed.objdata.OverrideSeedSlotsCount }));

  /* ── 「代号」那一格：填了就用填的那个 ──
   *
   * 上面那次插入**没动**那一格，走的是"默认别名 + 去重"那条路（对象叫 SeedBank）。
   * 这一段验另一半：填了别的名字，插出来的对象就得叫那个名字。
   *
   * 种子库是 allowMultiple（可多个），所以再插一个是被允许的 —— 正好用来看见"填了"
   * 和"没填"两条路走出来的名字不一样。 */
  ok(aliasField0 && aliasField0.value === meta.defaultAlias,
    '（前提）上面那次插入没动过那一格', JSON.stringify(aliasField0 && aliasField0.value));
  click(btn, '再开一次种子库详情');
  const aliasField1 = modal.querySelector('.mdl-alias-in');
  ok(!!aliasField1, '（前提）「代号」那一格又在 DOM 里了');
  /* 重开一次必须**回到默认别名**。带着上一次的字（或者上一次插出来的名字）过来的话，
   * 用户会以为这个名字是"这个模块的名字"，而它其实只是上一屏的残留。 */
  ok(aliasField1 && aliasField1.value === meta.defaultAlias && !stNow().alias.changed,
    '重开一次：那一格填的是默认别名，没带着上一屏的字',
    JSON.stringify(aliasField1 && aliasField1.value));
  const typeAlias = v => {
    if (!aliasField1) { ok(false, '（前提）代号那一格在 DOM 里'); return; }
    aliasField1.value = v; fire(aliasField1, 'input');
  };

  const objsBefore3 = objCount();
  typeAlias('MyBank');
  ok(stNow().alias.changed === true && stNow().canInsert === true,
    '代号填成别的：算"改过了"，「插入」照旧可按', JSON.stringify(stNow().alias));
  click(modal.querySelector('.mdl-insert'), '按插入（带自定义代号）');
  ok(modal.hidden, '插完浮层关掉');
  ok(objCount() === objsBefore3 + 1, '对象真的建出来了', `${objsBefore3} -> ${objCount()}`);
  {
    const banks = (JSON.parse(cmText()).objects || [])
      .filter(o => o.objclass === 'SeedBankProperties');
    ok(banks.length === 2 && banks[1].aliases[0] === 'MyBank',
      '填了代号：新对象就叫这个名字（不是默认的 SeedBank）',
      JSON.stringify(banks.map(o => o.aliases)));
    ok(banks.length === 2 && banks[0].aliases[0] === 'SeedBank',
      '……先插的那个还是原来的名字（改代号不该动到别人）',
      JSON.stringify(banks.map(o => o.aliases)));
  }

  /* 形状填歪了：当场按住（跟改参数那一档同一道闸）。 */
  click(btn, '再开一次（填个歪代号）');
  typeAlias('a@b');
  ok(stNow().canInsert === false, '带 @ 的代号：插入当场变灰', String(stNow().canInsert));
  ok(/不能当代号/.test(modal.textContent), '……而且说清了为什么');

  /* 撞名：**拒绝**，不是"悄悄加个序号"。这一条是这条路的核心约定 —— 用户亲手打的
   * 名字被换成别的，跟没填代号是两码事，屏幕上还什么都看不出来。 */
  typeAlias('MyBank');
  ok(stNow().canInsert === true, '（前提）撞名的那个代号形状是合法的，按钮没被形状闸住',
    String(stNow().canInsert));
  const objsBefore4 = objCount();
  click(modal.querySelector('.mdl-insert'), '按插入（撞名）');
  ok(!modal.hidden, '撞名被拒：浮层**不关**（原因就在按钮上面，用户得看得见）');
  ok(/已经有对象叫「MyBank」/.test(modal.textContent),
    '……而且说清了是撞名（不是默默插一个叫 MyBank1 的出来）');
  ok(objCount() === objsBefore4, '……一个对象都没多', `${objsBefore4} -> ${objCount()}`);
  /* 收尾：把那一格退回默认、把浮层关掉，免得后面几段接手时这一屏还开着 */
  typeAlias(meta.defaultAlias);
  click(modal.querySelector('.mdl-cancel'), '关掉浮层');
  ok(modal.hidden, '浮层已关（不把"开着浮层"这个状态漏给后面的用例）');

  const v = view();
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: docIn } });
  ok(cmText() === docIn, '本段借用的文档已还原（不把状态漏给后面的用例）');
}

/* 5d-6. 对象树上那个 ✎：**改已有对象的参数**（跟插入表单是同一张表的另一档）
 *
 * 5d-5 验的是"插进去的时候写什么"，这一段验"改一个已经在文件里的对象"：
 *   行从哪来   这个对象**当前的 objdata**（不是骨架）
 *   写回什么   **只写改动过的键**
 *
 * 于是这一节的重点全在"没动的东西一点都不能动"上：
 *   - 文件里是 6 而骨架默认是 8 的那个键，只改别的键之后必须还是 6
 *   - 结构值（PresetPlantList）没做控件，必须原样保留
 *   - **骨架里没有的键**（CustomUnmodeledKey）必须原样保留 —— 这是 Z-Editor 那个
 *     "重新序列化整个 objData 就把未建模的键吞掉"的坑，也是这个仓库反复要躲的事
 *   - 点「保存」是**一步撤销**，不是改了三个键就要撤三次
 *
 * ⚠ 夹具是**直接拼进文档**的（不是走插入表单）：这一段要验的是"改"，插那件事 5d-5
 * 已经验透了。拼进去的对象故意跟骨架错开：少三个键（验「＋ 加上」）、多一个键
 * （验未建模的键活着）、数字跟骨架默认值不同（验"行从 objdata 来"）。
 *
 * ⚠ 排在 5d-5 后面，同样"借完就还"。 */
{
  const docIn = cmText();
  const modal = doc.querySelector('.mdl-modal');
  const stNow = () => win.ZEditor.ModulePanel.state();

  const ALIAS = 'EditTestBank';
  const d0 = JSON.parse(docIn);
  d0.objects.push({
    aliases: [ALIAS],
    objclass: 'SeedBankProperties',
    objdata: {
      OverrideSeedSlotsCount: 6,        // 骨架默认是 8 —— 没动它就绝不能变成 8
      PresetPlantList: ['moonflower'],  // 结构值：没有控件，只该原样保留
      CustomUnmodeledKey: 42            // 骨架里没有的键：写完必须还在
    }
  });
  const sk = win.ZLevel.Skeletons.SeedBankProperties;
  ok(!!sk && sk.OverrideSeedSlotsCount !== 6 && sk.SelectionMethod === 'chooser',
    '（前提）夹具的键跟骨架故意错开：数字 6≠骨架默认，且缺三个骨架键',
    `骨架 ${JSON.stringify(sk)}`);

  /* 把文档整篇换成夹具。走编辑器 dispatch（用户打字那条路），不是直接改 state ——
   * 那样才顺带验到"打字之后树跟着重画、✎ 在新对象上也画得出来"。 */
  const setDoc = obj => {
    const v = view();
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: JSON.stringify(obj, null, 2) }
    });
  };
  setDoc(d0);
  ok(objCount() === d0.objects.length, '（前提）夹具对象已经在文档里', String(objCount()));

  /* 树上那一行。按别名找 —— objClass 会撞（别的对象也可能是种子库）。 */
  const rowOf = alias => [...doc.querySelectorAll('#panel-tree .node')].find(r => {
    const a = r.querySelector('.node-alias');
    return a && a.textContent === alias;
  });
  const node = rowOf(ALIAS);
  ok(!!node, '对象树里出现了夹具对象那一行');
  const pencil = node && node.querySelector('.node-edit');
  ok(!!pencil, '那一行上有「改参数」那个 ✎');

  if (pencil) click(pencil, '✎ 改参数');
  const st0 = stNow();
  ok(st0.open && st0.mode === 'edit', '✎ 打开的是**改参数**那一档（不是插入）',
    `${st0.open}/${st0.mode}`);
  ok(st0.objClass === 'SeedBankProperties', '浮层认的是这个对象', String(st0.objClass));
  ok(st0.insertLabel === '保存', '底下那个按钮写的是「保存」', JSON.stringify(st0.insertLabel));

  /* ── 「代号」那一格：有别名时能改、而且**底下不再挂一句解释**（2026-09-22 用户点名的
   *    "改完按保存：…" 那行灰字）──
   * 那句话是在解释一个已经写明白了的框怎么用（填了名字，按保存就改了），跟这一格要做的
   * 事重复。只有"没有别名所以改不了"那一档才留一句 —— 那是在解释它**为什么是灰的**，
   * 删了用户会以为功能坏了（那一档在 5d-7 里验）。 */
  const aliasIn0 = modal.querySelector('.mdl-alias-in');
  ok(!!aliasIn0 && aliasIn0.value === ALIAS && !aliasIn0.disabled,
    '有别名：「代号」那一格填着它自己的别名，而且能改',
    aliasIn0 && `${aliasIn0.value} disabled=${aliasIn0.disabled}`);
  const aliasHint0 = modal.querySelector('.mdl-alias-hint');
  ok(!!aliasHint0 && aliasHint0.hidden && !aliasHint0.textContent,
    '……而且这一格底下**没有**那行灰字（用户点名去掉的"改完按保存：本关卡里所有指向它的引用一起改"）',
    JSON.stringify(aliasHint0 && aliasHint0.textContent));

  ok(st0.canInsert === false, '一个键都没改的时候「保存」是灰的（没得可写）');
  ok(!modal.querySelector('.wave-pick') || modal.querySelector('.wave-pick').hidden,
    '改参数里没有「插入到第 N 波」那个下拉（那是插入才有的）');

  /* 行 = objdata 的 3 个键 + 骨架里缺的 3 个。 */
  const keysInModal = [...modal.querySelectorAll('.mdl-krow .mdl-kname')].map(e => e.textContent);
  ok(st0.keys === 6, '一共 6 行（object 里 3 个 + 骨架里缺的 3 个）', String(st0.keys));
  ok(st0.absent.length === 3 && st0.absent.indexOf('SelectionMethod') >= 0
    && st0.absent.indexOf('PlantWhiteList') >= 0,
    '而且分出哪三个是"这个对象没填"', JSON.stringify(st0.absent));
  ok(keysInModal[0] === 'OverrideSeedSlotsCount',
    '第一行是对象自己 objdata 里的第一个键（顺序照文件，不照骨架）', keysInModal[0]);

  const rowEl = k => [...modal.querySelectorAll('.mdl-krow')]
    .find(r => r.querySelector('.mdl-kname').textContent === k);
  const inputOf = k => { const r = rowEl(k); return r && r.querySelector('.mdl-kinput'); };
  const fire = (node, type) => node.dispatchEvent(new win.Event(type, { bubbles: true }));

  /* ── 结构值那一档：只剩那个框 ──
   * 用户点名的两句（表头的「结构值」标签 + 「现在是下面这段」，以及底下那句「这个键的
   * 专用填写界面还没做」）都该没了。
   *
   * 钉的是**结构**：那个框里除了它自己没别的块，它所在的格子里也只剩「↺ 默认」那个
   * 按钮（表头要是搬到了框外面，这一条照样抓得住）。
   * 不去全屏搜"结构值"三个字 —— 那三个字会随用户填的 ModuleDocs 中文回来（某个键的
   * 说明里提一句就够了），那种红跟"表头又长回来了"混在一起分不清。 */
  const structRow0 = rowEl('PresetPlantList');
  const structHost = structRow0 && structRow0.querySelector('.mdl-struct');
  ok(!!structHost && structHost.children.length === 1
    && structHost.children[0].className === 'mdl-struct-code',
    '结构值那一档里就剩那个框了（表头那两行字、底下那句"专用填写界面还没做"都没了）',
    structHost && [...structHost.children].map(c => c.className).join('|'));
  /* 那个格子里允许有的**只有**「↺ 默认」那一个按钮（它是这一行的动作，排在框前面）。
   * 多出来的任何一块 —— 包括"表头搬到框外面"那种改法 —— 都在这儿露馅。 */
  const structCtl = structHost && structHost.parentElement;
  ok(!!structCtl && [...structCtl.children].every(c => c === structHost || c.className === 'mdl-reset'),
    '……而且那个框的格子里除了框就只有「↺ 默认」那个按钮（表头搬到框外面也跑不掉）',
    structCtl && [...structCtl.children].map(c => c.className).join('|'));

  /* ── 行从 objdata 来，不从骨架来 ── */
  ok(inputOf('OverrideSeedSlotsCount') && inputOf('OverrideSeedSlotsCount').value === '6',
    '数字框里是**文件里的 6**，不是骨架默认的 8',
    inputOf('OverrideSeedSlotsCount') && inputOf('OverrideSeedSlotsCount').value);

  /* ── "这个对象没填"的行：只有一个「＋ 加上」，**不给输入框** ──
   * 给了框就得回答"框里那串字算不算已经填了"，答错了就是屏幕说一套、写下去另一套。 */
  {
    const absentRow = rowEl('SelectionMethod');
    ok(absentRow && absentRow.querySelector('.tag-absent'), '没填的键标着「这个对象没填」');
    ok(absentRow && !absentRow.querySelector('.mdl-kinput'),
      '没填的键**不给输入框**（免得看着像有值）');
    ok(absentRow && !!absentRow.querySelector('.mdl-add'), '给的是一个「＋ 加上」按钮');
  }

  /* ── 改一个数字，再撤回 ── */
  const numIn = inputOf('OverrideSeedSlotsCount');
  numIn.value = '9'; fire(numIn, 'input');
  ok(stNow().edited.join() === 'OverrideSeedSlotsCount',
    '改一个数字：只有它进了"要写回去"的那张表', JSON.stringify(stNow().edited));
  ok(stNow().canInsert === true, '改过之后「保存」亮起来');
  ok(/已改 1 个键/.test(modal.querySelector('.mdl-formbar').textContent),
    '顶上那条如实数了「已改 1 个键」');
  const undoOne = rowEl('OverrideSeedSlotsCount').querySelector('.mdl-reset');
  ok(undoOne && !undoOne.hidden, '改过的那一行露出「↺ 默认」');
  click(undoOne, '↺ 默认（数字）');
  ok(stNow().edited.length === 0 && inputOf('OverrideSeedSlotsCount').value === '6',
    '「↺ 默认」把它退回**打开时的值 6**（改参数这一档的"默认"就是原样）',
    inputOf('OverrideSeedSlotsCount').value);
  ok(stNow().canInsert === false, '退回去之后「保存」又灰了');

  /* ── 「＋ 加上」：加一个标量键 ── */
  click(rowEl('SelectionMethod').querySelector('.mdl-add'), '＋ 加上 SelectionMethod');
  /* 这一条是给一个**真出现过**的 bug 立的桩：「＋」按下之后这一行要整行重画（"没填"的行
   * 变成带控件的行，只能重画），于是刚被点中的那个按钮**脱离了 DOM**，而它那一下点击
   * 还在往上冒泡 —— 文档上那个"点到浮层外面就关掉"的监听器一看 modal.contains(它) 是
   * false、closest 也全是 null，就当成用户点了外面，**浮层当场自己关掉**。用户点一下
   * 「＋」，还没看见加上去的那一行，浮层就没了。
   * 后面所有断言都在读这个浮层，所以它必须排在最前面：浮层一关，下面全是在读空气。 */
  ok(!modal.hidden, '点「＋ 加上」不会把浮层关掉（那一行要重画，点中的按钮随即脱离 DOM）');
  ok(stNow().edited.join() === 'SelectionMethod', '加上这个键 = 记下要写它',
    JSON.stringify(stNow().edited));
  ok(stNow().absent.indexOf('SelectionMethod') < 0, '它不再是"没填"那一档了');
  ok(inputOf('SelectionMethod') && inputOf('SelectionMethod').value === 'chooser',
    '加上的行带上了控件，值是骨架默认（chooser）',
    inputOf('SelectionMethod') && inputOf('SelectionMethod').value);
  ok(rowEl('SelectionMethod') && !!rowEl('SelectionMethod').querySelector('.mdl-reset'),
    '加上的行也有「↺ 默认」，能把这次添加撤回来');

  click(rowEl('SelectionMethod').querySelector('.mdl-reset'), '↺ 默认（刚加上的）');
  ok(stNow().absent.indexOf('SelectionMethod') >= 0
    && !!rowEl('SelectionMethod').querySelector('.mdl-add'),
    '撤回之后那一行变回「＋ 加上」（不是留着一个有值的空架子）');

  /* ── 加一个结构值键 + 改一个数字，然后保存 ── */
  click(rowEl('SelectionMethod').querySelector('.mdl-add'), '＋ 加上 SelectionMethod（再来一次）');
  click(rowEl('PlantWhiteList').querySelector('.mdl-add'), '＋ 加上 PlantWhiteList');
  const added = rowEl('PlantWhiteList').querySelector('.mdl-struct-code');
  ok(!!added, '结构值键加上之后画的是那个可编辑的 JSON 框');
  /* ⚠ 读 .value：这一块是可编辑的 <textarea>（2026-09-22 从只读的 <pre> 换过来），
   * textContent 永远是空的。 */
  ok(added && added.value.trim() === '[]',
    '加上的就是骨架里的空数组（不假装知道里面该填什么）',
    added && added.value.trim());

  /* ── 结构值那个框**是可编辑的**（用户点名："允许修改"）──
   *   1. 写一段合法 JSON：进表单，保存时真写进去
   *   2. 写一段写坏的 JSON：**当场按住**，那个键一个字节都不写（跟数字框同一个约定）
   * 两条缺一不可 —— 只测第 1 条的话，"把解析失败也照收"这种改法照样全绿。 */
  const typeStruct = txt => {
    if (!added) { ok(false, '（前提）结构值那个框在 DOM 里'); return; }
    added.value = txt; fire(added, 'input');
  };
  typeStruct('["peashooter", "sunflower"]');
  ok(stNow().canInsert === true && !stNow().badKey,
    '框里写一段合法 JSON：算改过了，插入按钮照旧可按',
    JSON.stringify(stNow().values && stNow().values.PlantWhiteList));
  ok(JSON.stringify(stNow().values.PlantWhiteList) === '["peashooter","sunflower"]',
    '……而且进表单的是**解析出来的数组**，不是一段字符串',
    typeof (stNow().values || {}).PlantWhiteList);
  typeStruct('["peashooter",');
  ok(stNow().canInsert === false && stNow().badKey === 'PlantWhiteList',
    '写坏的 JSON：插入被拦住（不是悄悄写进去一份坏的）');
  ok(/不是合法的 JSON/.test(modal.textContent), '……而且说清了是哪个键、为什么',
    modal.querySelector('.mdl-err') && modal.querySelector('.mdl-err').textContent);
  typeStruct('[]');
  ok(stNow().canInsert === true && !stNow().badKey, '改回合法 JSON 就又能插了');
  const numIn2 = inputOf('OverrideSeedSlotsCount');
  numIn2.value = '12'; fire(numIn2, 'input');
  ok(stNow().edited.length === 3, '三个键进表：一个改的、两个加上的',
    JSON.stringify(stNow().edited));

  const objsBeforeSave = objCount();
  const saveBad = click(modal.querySelector('.mdl-insert'), '按保存');
  if (saveBad.length) console.log('      报错: ' + saveBad[0]);
  ok(modal.hidden, '保存完浮层关掉');
  ok(objCount() === objsBeforeSave, '保存**不新建对象**（不像插入那样多一个）',
    `${objsBeforeSave} -> ${objCount()}`);

  const after = JSON.parse(cmText()).objects.find(o => o.objclass === 'SeedBankProperties'
    && o.aliases && o.aliases.indexOf(ALIAS) >= 0);
  ok(!!after, '对象还在文件里');
  const od = (after && after.objdata) || {};
  ok(od.OverrideSeedSlotsCount === 12, '改过的数字键写进去了', String(od.OverrideSeedSlotsCount));
  ok(od.SelectionMethod === 'chooser', '加上的标量键写进去了', String(od.SelectionMethod));
  ok(JSON.stringify(od.PlantWhiteList) === '[]', '加上的结构值键写进去了',
    JSON.stringify(od.PlantWhiteList));
  /* ↓↓ 这三条是这一节的**正题**：没动的键一个都不能变 ↓↓ */
  ok(JSON.stringify(od.PresetPlantList) === '["moonflower"]',
    '没动过的结构值原样保留（没被骨架里的空数组盖掉）', JSON.stringify(od.PresetPlantList));
  ok(od.CustomUnmodeledKey === 42,
    '**骨架里没有的键原样保留**（重新序列化整个 objdata 会把它吞掉 —— Z-Editor 那个坑）',
    JSON.stringify(od.CustomUnmodeledKey));
  ok(od.OverrideSeedSlotsCount !== sk.OverrideSeedSlotsCount,
    '（对照）这个键确实跟骨架默认值不一样，上面那条才说明得了问题',
    `${od.OverrideSeedSlotsCount} vs ${sk.OverrideSeedSlotsCount}`);
  ok(Object.keys(od).length === 5, '键数 = 原来 3 个 + 加上 2 个（一个不多一个不少）',
    Object.keys(od).join());

  /* ── 一次保存 = 一步撤销 ── */
  click(doc.getElementById('btn-undo'), '撤销');
  const back = JSON.parse(cmText()).objects.find(o => o.objclass === 'SeedBankProperties'
    && o.aliases && o.aliases.indexOf(ALIAS) >= 0);
  const bd = (back && back.objdata) || {};
  ok(bd.OverrideSeedSlotsCount === 6 && bd.SelectionMethod === undefined
    && bd.PlantWhiteList === undefined,
    '一次撤销退回保存前那一版（三个键一起退，不是要撤三次）',
    JSON.stringify(bd));
  click(doc.getElementById('btn-redo'), '重做');
  const again = JSON.parse(cmText()).objects.find(o => o.objclass === 'SeedBankProperties'
    && o.aliases && o.aliases.indexOf(ALIAS) >= 0);
  ok(again && again.objdata.OverrideSeedSlotsCount === 12, '重做把它原样做回来');

  /* ── 浮层开着的时候文本被改动了：认不出人就**拒绝**，不猜 ──
   * 认人靠 (位置, objClass)。这里把整份文档换成一份空的 —— 那个位置上什么都没有了。 */
  const node2 = rowOf(ALIAS);
  if (node2) click(node2.querySelector('.node-edit'), '✎（第二次）');
  ok(stNow().mode === 'edit' && stNow().open, '（前提）又打开了改参数');
  const n3 = inputOf('OverrideSeedSlotsCount');
  n3.value = '99'; fire(n3, 'input');
  const textBeforeStale0 = cmText();
  setDoc({ objects: [] });                     // 浮层开着的时候把对象抽走
  const textBeforeStale = cmText();
  ok(textBeforeStale !== textBeforeStale0, '（前提）文档真的被换掉了');
  const staleBad = click(modal.querySelector('.mdl-insert'), '保存（对象已经不在那个位置了）');
  if (staleBad.length) console.log('      报错: ' + staleBad[0]);
  ok(!modal.hidden, '认不出人时浮层**不关**（用户得看得见原因）');
  ok(cmText() === textBeforeStale, '而且一个字节都没写（宁可什么都不做，也不写错对象）');
  ok(/已经不是/.test(modal.textContent), '原因说清了是"那个位置已经不是这个对象了"',
    JSON.stringify((modal.querySelector('.mdl-err') || {}).textContent || ''));

  /* 上面那一版把对象**整个抽走**了（那个位置上什么都没有）。再走一版更常见的：
   * 那个位置上**站着另一个对象** —— 用户在前面插了个模块、删了个对象，后面的整体
   * 挪位。这一版才是 (位置, objClass) 里 objClass 那一半真正管的事：只看位置的话，
   * 这一下会把种子库的参数写到**猎人僵尸**身上，而且画面上没有任何异常。
   * 上一版（空文档）碰巧连只看位置的实现也能拦住（`!t` 就返回了），所以单靠它
   * 验不出 objClass 那一半 —— 这一条是补这个洞的。 */
  {
    setDoc({
      objects: [
        { aliases: ['Lvl'], objclass: 'LevelDefinition', objdata: {} },
        { aliases: ['Hunter'], objclass: 'ZombieProperties', objdata: { Speed: 3 } }
      ]
    });
    const text2 = cmText();
    const bad2 = click(modal.querySelector('.mdl-insert'), '保存（那个位置上已经是别的对象了）');
    if (bad2.length) console.log('      报错: ' + bad2[0]);
    ok(cmText() === text2, '那个位置上换成了别的对象时也一个字节都没写');
    ok(JSON.parse(cmText()).objects[1].objdata.Speed === 3,
      '尤其**没有**把参数写到那个无辜的对象身上',
      JSON.stringify(JSON.parse(cmText()).objects[1].objdata));
  }

  const v = view();
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: docIn } });
  ok(cmText() === docIn, '本段借用的文档已还原（不把状态漏给后面的用例）');
}

/* 5d-7. 改代号（「代号」那一格）：改的不只是对象自己，还有**本文件里所有指向它的键**
 *
 * 这是图形界面相对文本模式的补偿：手改一处别名、漏改十处引用，改完就是一串悬空引用，
 * 而屏幕上一点异样都没有。这一节要钉住四件事：
 *
 *   1. 只改代号**不改键**也算一次保存（不然这个用法按钮永远是灰的）
 *   2. 本文件里的 `RTID(老代号@CurrentLevel)` 全部跟着改（Modules 里的、别的对象
 *      objdata 里的都算）
 *   3. **`@LevelModules` 的那种一个字都不能动** —— 它指的是**别的文件**里的同名对象，
 *      跟着改就是把一条本来指得对的引用改成别的文件里不存在的东西，而那一类属于
 *      "外部引用"，分类上根本不报，屏幕上照样一点异样都没有
 *   4. 代号和那些引用是**一步撤销**（一次结构操作），不是要撤好几次
 *
 * 撞名和形状这两道闸也在这一节：形状面板自己实时拦（不写进去），撞名得知道整份文件
 * 的对象列表，只有 main.js 判得了 —— 它拒绝时那句话原样显示在按钮上面。
 *
 * ⚠ 夹具是直接拼进文档的，跟 5d-5/5d-6 一样"借完就还"。 */
{
  const docIn = cmText();
  const modal = doc.querySelector('.mdl-modal');
  const stNow = () => win.ZEditor.ModulePanel.state();
  const setDoc = obj => {
    const v = view();
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: JSON.stringify(obj, null, 2) }
    });
  };
  const rowOf = alias => [...doc.querySelectorAll('#panel-tree .node')].find(r => {
    const a = r.querySelector('.node-alias');
    return a && a.textContent === alias;
  });
  const fire = (node, type) => node.dispatchEvent(new win.Event(type, { bubbles: true }));
  const aliasBox = () => modal.querySelector('.mdl-alias');
  const aliasIn = () => aliasBox() && aliasBox().querySelector('.mdl-alias-in');
  /* 往代号那一格里打字。**判空是必须的**，不是防御性编程：这一段是给变异测试
   * 当靶子的，源码被改坏之后 aliasIn() 可能是 null —— 直接 `.value =` 会抛出去，
   * 整个套件当场停在这一行，后面所有断言都不跑了（看起来"红了"，其实什么都没验）。
   * 那种红最误导：分不清是这一条抓到了还是后面的根本没执行。 */
  const typeAlias = v => {
    const i = aliasIn();
    if (!i) { ok(false, '（前提）代号那一格在 DOM 里'); return; }
    i.value = v;
    fire(i, 'input');
  };

  /* 夹具：三条引用指着一个名字，其中**两条是本文件的、一条是别的文件的同名对象**。
   * `Taken` 这个对象专门用来验撞名。`Anon` 没有别名，用来验那一格的禁用态。 */
  setDoc({
    objects: [
      { aliases: ['Lvl'], objclass: 'LevelDefinition', objdata: {
        Modules: ['RTID(RenTest@CurrentLevel)', 'RTID(RenTest@LevelModules)']
      } },
      { aliases: ['RenTest'], objclass: 'SeedBankProperties', objdata: {
        OverrideSeedSlotsCount: 6
      } },
      { aliases: ['Taken'], objclass: 'ZombieProperties', objdata: {
        Who: 'RTID(RenTest@CurrentLevel)',
        NotMine: 'RTID(RenTest@LevelModules)'
      } },
      { objclass: 'NoAliasThing', objdata: { A: 1 } }
    ]
  });

  const node = rowOf('RenTest');
  ok(!!node, '（前提）对象树里有 RenTest 那一行');
  if (node) click(node.querySelector('.node-edit'), '✎ 改参数');
  const st0 = stNow();
  ok(st0.open && st0.mode === 'edit', '（前提）改参数浮层开着', `${st0.open}/${st0.mode}`);
  ok(st0.alias.shown === true, '改参数这一档有「代号」那一格');
  ok(st0.alias.orig === 'RenTest', '格子的原值是这个对象的首别名', st0.alias.orig);
  ok(aliasIn() && aliasIn().value === 'RenTest',
    '文本框里也填着它（不是只记在 state 里）', aliasIn() && aliasIn().value);
  ok(st0.canInsert === false, '（对照）什么都还没动时「保存」是灰的');

  /* ── 只改代号、一个键都不改 ──
   * 这条钉的是 submitBlocked 那一半：漏了它，「只改代号」这个用法按钮永远是灰的，
   * 用户会以为功能没做。 */
  typeAlias('NewBank');
  ok(stNow().alias.changed === true, '改代号被认成"改过了"');
  ok(stNow().edited.length === 0, '（对照）键一个都没动');
  ok(stNow().canInsert === true, '**只改代号也能保存**');

  /* ── 形状：会被 RTID 切坏的字符当场拦下，连试都不试 ── */
  typeAlias('Bad@Name');
  ok(stNow().canInsert === false, '带 @ 的代号：保存当场变灰');
  ok(stNow().alias.bad !== '', '并且 state 里也记着"这一格现在不对"', stNow().alias.bad);
  ok(/只能用字母/.test(modal.textContent), '红字说清了为什么',
    JSON.stringify((modal.querySelector('.mdl-err') || {}).textContent || ''));

  /* ── 撞名：形状挑不出毛病，面板自己判不了（它按约定不读 state）── */
  typeAlias('Taken');
  ok(stNow().canInsert === true, '（前提）撞名这一关面板判不了，按钮是亮的');
  const textBefore = cmText();
  click(modal.querySelector('.mdl-insert'), '保存（撞名）');
  ok(!modal.hidden, '撞名时浮层**不关**（用户得看得见原因）');
  ok(cmText() === textBefore, '而且一个字节都没写');
  ok(/已经有对象叫/.test(modal.textContent), '原因说清了是撞名',
    JSON.stringify((modal.querySelector('.mdl-err') || {}).textContent || ''));

  /* ── 正式改：这一个名字，四条引用等着看谁跟着动 ── */
  typeAlias('NewBank');
  const renameBad = click(modal.querySelector('.mdl-insert'), '保存（改名）');
  if (renameBad.length) console.log('      报错: ' + renameBad[0]);
  ok(modal.hidden, '改完浮层关掉');

  const after = JSON.parse(cmText());
  const byAlias = a => after.objects.find(o => (o.aliases || []).indexOf(a) >= 0);
  ok(!!byAlias('NewBank') && !byAlias('RenTest'), '对象自己的代号改了');
  ok(after.objects[0].objdata.Modules[0] === 'RTID(NewBank@CurrentLevel)',
    'LevelDefinition.Modules 里那条引用跟着改',
    after.objects[0].objdata.Modules[0]);
  ok(after.objects[2].objdata.Who === 'RTID(NewBank@CurrentLevel)',
    '**别的对象** objdata 里指向它的键也一起改',
    after.objects[2].objdata.Who);
  /* ↓↓ 这一节的正题 ↓↓ */
  ok(after.objects[0].objdata.Modules[1] === 'RTID(RenTest@LevelModules)',
    '@LevelModules 那条**一个字都不能动**（它指的是别的文件里的同名对象，跟着改就成了悬空引用）',
    after.objects[0].objdata.Modules[1]);
  ok(after.objects[2].objdata.NotMine === 'RTID(RenTest@LevelModules)',
    '别的对象里那条 @LevelModules 也没动', after.objects[2].objdata.NotMine);
  /* 判空再取键：源码被改坏时对象可能压根没改名，这里直接 .objdata 会抛出去，
   * 把整个套件停在这一行（后面全不跑，看起来像"抓到了"）。 */
  const nb = byAlias('NewBank');
  if (nb) {
    ok(nb.objdata.OverrideSeedSlotsCount === 6,
      '一个键都没改的对象，参数原样（只动了代号）', JSON.stringify(nb.objdata));
  }
  ok(after.objects[2].aliases[0] === 'Taken', '（对照）只是被改了引用的那个对象自己没改名');
  ok(!!rowOf('NewBank'), '对象树上那一行也跟着改名了（不用刷新页面）');

  /* ── 一次保存 = 一步撤销（代号和那些引用一起退） ── */
  click(doc.getElementById('btn-undo'), '撤销');
  const back = JSON.parse(cmText());
  ok(!!back.objects.find(o => (o.aliases || []).indexOf('RenTest') >= 0),
    '一次撤销把代号退回去');
  ok(back.objects[0].objdata.Modules[0] === 'RTID(RenTest@CurrentLevel)'
    && back.objects[2].objdata.Who === 'RTID(RenTest@CurrentLevel)',
    '引用也**一起**退回去（不是只退代号、留下一批指着新名字的键）',
    `${back.objects[0].objdata.Modules[0]} / ${back.objects[2].objdata.Who}`);
  click(doc.getElementById('btn-redo'), '重做');
  ok(JSON.parse(cmText()).objects[0].objdata.Modules[0] === 'RTID(NewBank@CurrentLevel)',
    '重做把它原样做回来');
  click(doc.getElementById('btn-undo'), '再撤销（回到夹具原样）');

  /* ── 没有别名的对象：那一格禁掉，并说明为什么 ── */
  {
    setDoc({
      objects: [
        { aliases: ['Lvl'], objclass: 'LevelDefinition', objdata: { Modules: [] } },
        { objclass: 'NoAliasThing', objdata: { A: 1 } }
      ]
    });
    const anonRow = [...doc.querySelectorAll('#panel-tree .node')].find(r => {
      const c = r.querySelector('.node-cls');
      return c && c.textContent === 'NoAliasThing';
    });
    ok(!!anonRow, '（前提）树上找得到那个没有别名的对象');
    if (anonRow) click(anonRow.querySelector('.node-edit'), '✎（没有别名的对象）');
    const stA = stNow();
    ok(stA.mode === 'edit' && stA.open, '（前提）改参数浮层开着');
    ok(stA.alias.disabled === true, '没有别名的对象：「代号」那一格是禁用的');
    ok(stA.alias.orig === '', '格子里也没有编出来的名字', JSON.stringify(stA.alias.orig));
    ok(/没有别名/.test(aliasBox() ? aliasBox().textContent : ''), '并且说明了为什么改不了',
      JSON.stringify(aliasBox() ? aliasBox().textContent : ''));
    if (modal && !modal.hidden) click(modal.querySelector('.mdl-cancel'), '取消');
  }

  /* ── 从改参数切到插入：那一格里装的东西必须**换成新对象的默认代号** ──
   *
   * 这一条 2026-09-22 翻过案。原先两档不一样（插入那一档没有代号），所以这里测的是
   * "换一档会不会把它收回去"。用户要求"新建模块界面也要支持代号命名"之后，两档**都
   * 有**这一格，于是要盯的变成了另一件事：**它得跟着换内容**。
   *
   * 这一条是**真状态迁移**，不是又一次"它生来就是这样"（那个教训见 `N51`）：上一步开
   * 的是那个**没有别名**的对象（那一格里是空的、禁用着），切过来必须变成种子库自己的
   * 默认别名 `SeedBank`。忘了重填的话，框里留着的是上一个对象那一档的残留，用户按插入
   * 就会拿它当新对象的名字 —— 屏幕上一点异样都没有。
   *
   * （早先这一格的靶子是"插入那一档根本没有这一格"，用户要求新建模块也能命名之后那条
   * 翻案了，对应的变异 `N51` 一起作废，见 README。） */
  {
    const insBtn = [...doc.querySelectorAll('#panel-modules .ins-main')]
      .find(b => b.querySelector('.ins-cls')
        && b.querySelector('.ins-cls').textContent === 'SeedBankProperties');
    ok(!!insBtn, '（前提）侧栏里找得到种子库那一行');
    if (insBtn) click(insBtn, '打开插入详情');
    const stI = stNow();
    ok(stI.mode === 'insert' && stI.open, '（前提）现在开的是插入那一档',
      `${stI.mode}/${stI.open}`);
    ok(stI.alias.shown === true, '插入那一档也有「代号」那一格（用户要的：新建也能命名）');
    const insAlias = modal.querySelector('.mdl-alias-in');
    ok(stI.alias.orig === 'SeedBank' && stI.alias.changed === false,
      '……而且填的是**种子库自己的**默认别名，不是上一个对象留在框里的那个',
      `orig=${stI.alias.orig} changed=${stI.alias.changed}`);
    ok(!!insAlias && insAlias.value === 'SeedBank' && !insAlias.disabled,
      '……框里那份文字也对得上（不是只在状态里），而且没被禁掉',
      JSON.stringify(insAlias && insAlias.value));

    /* 再切回去：又得换回**那个对象**的代号。两个方向都测，是因为"重填"这件事
     * 只在切换时发生 —— 只测一个方向，另一种写反了照样全绿。
     *
     * 锚点用上面那份"没有别名的对象"夹具里的 LevelDefinition（它别名是 `Lvl`，
     * 而且 objdata 在、✎ 画得出来）。 */
    const lvlRow = [...doc.querySelectorAll('#panel-tree .node')].find(r => {
      const a = r.querySelector('.node-alias');
      return a && a.textContent === 'Lvl';
    });
    ok(!!lvlRow, '（前提）树上找得到那份夹具里的 LevelDefinition');
    if (lvlRow) click(lvlRow.querySelector('.node-edit'), '✎ 切回改参数');
    const stE2 = stNow();
    ok(stE2.mode === 'edit' && stE2.alias.shown === true, '（前提）切回改参数那一档了');
    ok(stE2.alias.orig === 'Lvl',
      '切回去填的是**那个对象**的代号（两边不会串）', JSON.stringify(stE2.alias.orig));

    if (modal && !modal.hidden) click(modal.querySelector('.mdl-cancel'), '取消');
  }

  const v7 = view();
  v7.dispatch({ changes: { from: 0, to: v7.state.doc.length, insert: docIn } });
  ok(cmText() === docIn, '本段借用的文档已还原（不把状态漏给后面的用例）');
}

// 5e. 主题切换。风险点是换文档会重建 state（resetText -> view.setState），
//     而 Compartment 实例要复用，所以切完主题必须再做一次结构操作，确认两边都没坏。
{
  // 前面的点击可能把弹层关掉了，先确保它是开的（弹层关着按钮仍然在 DOM 里，
  // 直接点会点到一个用户点不到的东西 —— 那样测出来的结论没有意义）
  if (doc.getElementById('settings').hidden) click(doc.getElementById('btn-settings'), '设置');
  const seg = doc.querySelector('#settings .seg[data-key="theme"] button[data-val="dark"]');
  ok(!!seg && !doc.getElementById('settings').hidden, '设置弹层开着，里面有深色主题按钮');
  const bad = click(seg, '切深色');
  if (bad.length) console.log('      报错: ' + bad[0]);
  ok(doc.documentElement.getAttribute('data-theme') === 'dark', 'html 上写了 data-theme=dark');
  ok(!!doc.querySelector('.cm-editor'), '切主题后编辑器还在');

  // 换文档（重建 state）+ 再插一次，确认 Compartment 没被打坏
  const tabs = [...doc.querySelectorAll('.tabs button')];
  click(tabs[1], '模块');
  const gh = doc.querySelector('#panel-modules .ins-group-h');
  if (gh) click(gh, '展开分组');
  const row5e = doc.querySelector('#panel-modules .ins-group-b .ins-main');
  ok(!!row5e, '切主题后模块行还在');
  const before = cmText();
  /* 换文档会重建 state，但侧栏**不重建** —— 它现在跟文档无关了（见
   * module-panel.js 的 buildSide）。这条同时钉住"面板不跟着文档走"这件事。 */
  if (row5e) click(row5e, '切主题后看详情');
  const m5e = doc.querySelector('.mdl-modal');
  ok(!!m5e && !m5e.hidden, '切主题后浮层照样能打开');
  if (m5e && !m5e.hidden) click(m5e.querySelector('.mdl-insert'), '切主题后插入');
  ok(cmText() !== before, '切主题之后结构操作仍然有用（Compartment 复用没坏）');
  ok(!!doc.querySelector('.cm-editor'), '操作后编辑器还在');

  // 切回浅色
  const light = doc.querySelector('#settings .seg[data-key="theme"] button[data-val="light"]');
  if (light) click(light, '切浅色');
  ok(doc.documentElement.getAttribute('data-theme') === 'light', '能切回浅色');
}

// ── 5f~5h 的三个小工具 ────────────────────────────────────────────────

/** 从模板弹层里载入一份模板（confirm 已被替成"确定"）。 */
function loadTemplate(re) {
  click(doc.getElementById('btn-templates'), '模板');
  const it = [...doc.querySelectorAll('#tpl-pop button')].find(x => re.test(x.textContent));
  if (it) click(it, '选模板 ' + it.textContent.trim());
  return !!it;
}

/**
 * 在「模块」页里插第一个模块。
 *
 * 这一版点一行是**看详情**，插入要进浮层按「插入」，所以每处"点一下插个模块"
 * 都得走这三步：展开分组 → 点行 → 点浮层里的「插入」。调用方自己断言文本变了 ——
 * 这里不发断言，免得同一个 helper 被调几次就往结果里塞几条重复的。
 *
 * @returns {boolean} 三步都点到了才算 true。少一步就说明面板结构跟这个 helper
 *   对不上了 —— 调用方的「插一个模块」断言会当场变红，比 helper 自己吞掉好。
 */
function insertFirstModule() {
  click([...doc.querySelectorAll('.tabs button')][1], '模块');
  /* 侧栏**只建一次、之后不重建**（随关卡变的东西都搬进浮层了），所以展开状态会
   * 留在那儿；但仍然按现状判断，不假设 —— 收着的时候点一下是展开，展开时点一下
   * 反而会把它收起来。 */
  const body = doc.querySelector('#panel-modules .ins-group-b');
  if (body && body.hidden) {
    const head = doc.querySelector('#panel-modules .ins-group-h');
    if (head) click(head, '展开分组');
  }
  const row = doc.querySelector('#panel-modules .ins-group-b .ins-main');
  if (!row) return false;
  click(row, '打开模块详情');

  /* 按**看得见**来判，不是按"元素在不在"：浮层藏着的时候 .mdl-insert 照样查得到，
   * 照点下去就是"点了个寂寞"，而这个 helper 还会返回 true。 */
  const modal = doc.querySelector('.mdl-modal');
  if (!modal || modal.hidden) return false;
  const ins = modal.querySelector('.mdl-insert');
  if (!ins) return false;
  click(ins, '插入模块');
  return true;
}

/** 造一个 keydown 事件。jsdom 里 CM 的键位要靠 key/keyCode 同时给才认得出。 */
function keyEvent(key, code, keyCode, shift) {
  return new win.KeyboardEvent('keydown', {
    key: key, code: code, keyCode: keyCode, shiftKey: !!shift,
    ctrlKey: true, bubbles: true, cancelable: true
  });
}

/* 5f. 打字和结构操作**共用一条历史** —— 撤销必须一次退一步。
 *
 * 这一节是 isolateHistory 存在的全部理由。结构操作写回是"整篇替换"，如果不带
 * 这个注解，CM 会把它并进前一次**打字**的历史分组（两者改动区间重叠，间隔又远
 * 小于 newGroupDelay 500ms），于是一次 Ctrl+Z 把打字和插入一起退掉 —— 退多了。
 * 把 text.js 里的 isolateHistory 拿掉，这一节必须红。
 *
 * 时间相关性得说清楚：CM 的分组条件是"两次改动间隔 < 500ms"。这里两条命令是
 * 同步连着发的，实际间隔远小于 1ms，所以测的确实是"同一次输入分组"这件事；
 * 而不是碰巧因为慢了分成了两组 —— 那样即使没写 isolateHistory 也会绿。
 */
{
  ok(loadTemplate(/空白/), '载入空白关卡（这一节要从干净的文档开始）');
  const pristine = cmText();

  // 1) 打一段字。标成 input.type，跟真人打字走的是同一条路。
  const v = view();
  v.dispatch({
    changes: { from: v.state.doc.length - 1, insert: '\n' },
    userEvent: 'input.type'
  });
  const typed = cmText();
  ok(typed !== pristine, '打字进了编辑器', `${pristine.length} -> ${typed.length} 字符`);
  ok(!doc.getElementById('btn-undo').disabled,
    '打字本身就能撤销（改了以前那种"结构操作把编辑器历史整个清掉"的做法）');

  // 2) 紧接着插一个模块 —— 这一步是整篇替换，自成一步
  ok(insertFirstModule(), '插入面板里有模块按钮');
  const withModule = cmText();
  ok(withModule !== typed, '插入改了文本', `${typed.length} -> ${withModule.length} 字符`);

  const vu = view();
  ok(win.CM.undoDepth(vu.state) === 2, '打字和插入各占一步（两条都在栈上）',
    `undoDepth=${win.CM.undoDepth(vu.state)}`);

  // 3) 光标在编辑器里按 Ctrl+Z。这一步同时钉两件事：
  //      - 退掉的是"插入"而不是"插入+打字"（isolateHistory）
  //      - 只退一步，不是两步（document 级监听器没在 CM 已经处理过之后再补一刀
  //        —— 那会一次退两步，而且界面上完全看不出来）
  const ev = keyEvent('z', 'KeyZ', 90);
  vu.contentDOM.dispatchEvent(ev);
  ok(ev.defaultPrevented, 'Ctrl+Z 被 CM 的键位接住了（它自己 preventDefault）');
  ok(win.CM.undoDepth(vu.state) === 1, '编辑器里的 Ctrl+Z 只退一步（监听器没有重复执行）',
    `undoDepth 2 -> ${win.CM.undoDepth(vu.state)}`);
  ok(cmText() === typed, '退掉的是插入，打字还在（isolateHistory 生效）',
    `${withModule.length} -> ${cmText().length} 字符`);

  // 4) 再撤销一次：这次该退掉打字了
  click(doc.getElementById('btn-undo'), '撤销打字');
  ok(cmText() === pristine, '再撤销一次：打字也退掉了', `${cmText().length} 字符`);
  ok(doc.getElementById('btn-undo').disabled, '历史走到底，撤销按钮置灰');

  // 5) 重做两次，按原路走回去
  click(doc.getElementById('btn-redo'), '重做打字');
  ok(cmText() === typed, '重做一次：打字回来了');
  click(doc.getElementById('btn-redo'), '重做插入');
  ok(cmText() === withModule, '重做两次：插入也回来了');

  // 6) 撤销之后又打字 -> 重做分支必须作废（不然重做会跳到一个不存在的未来）
  click(doc.getElementById('btn-undo'), '再撤一次');
  ok(!doc.getElementById('btn-redo').disabled, '撤销之后重做按钮还亮着');
  const v6 = view();
  v6.dispatch({
    changes: { from: v6.state.doc.length - 1, insert: '\n' },
    userEvent: 'input.type'
  });
  ok(doc.getElementById('btn-redo').disabled, '撤销之后新打字，重做分支作废（按钮置灰）');
}

/* 5g. 换文档必须把历史一起换掉 —— 不该还能撤销回上一个文件。
 *
 * 两种情形都测，(b) 是最容易漏的那个：
 *   (a) 内容不同的两份文档
 *   (b) **内容一模一样**的两份 —— 写回时要是先做"文本相同就跳过"的短路
 *       （setText 里确实有这条，因为它不能把同样的串当成一次新的可撤销改动），
 *       历史就留着了，于是还能撤销回"上一个文件"。resetText 不能有那个短路。
 */
{
  ok(loadTemplate(/空白/), '载入空白关卡（这一节要从干净的文档开始）');
  const blank = cmText();
  const undoBtn = doc.getElementById('btn-undo');
  const redoBtn = doc.getElementById('btn-redo');

  // ── (a) 内容不同 ──
  ok(insertFirstModule(), '插一个模块，攒出一段历史');
  ok(cmText() !== blank, '插入改了文本');
  ok(!undoBtn.disabled, '有历史，撤销按钮亮着');

  ok(loadTemplate(/坚不可摧/), '换一份内容不同的模板');
  const other = cmText();
  ok(other !== blank, '文档真的换了');
  ok(undoBtn.disabled && redoBtn.disabled, '换文档之后两个按钮都置灰（历史被清掉了）');
  // 光看按钮还不够 —— 键盘那条路不依赖按钮显隐，得单独证明它也不通
  doc.body.dispatchEvent(keyEvent('z', 'KeyZ', 90));
  ok(cmText() === other, '换文档之后 Ctrl+Z 也撤不回上一个文件');

  // ── (b) 内容相同 ──
  ok(loadTemplate(/空白/), '回到空白关卡');
  const blank2 = cmText();
  ok(blank2 === blank, '空白模板每次载入都是同一串文本（下面那句"内容相同"靠这条成立）');
  ok(insertFirstModule(), '再插一个模块，攒出一段历史');
  ok(cmText() !== blank2, '插入改了文本');
  click(undoBtn, '撤销插入');
  ok(cmText() === blank2, '撤销回到模板原文');
  // 现在的局面正是要测的：**文本等于模板原文，但历史非空**
  ok(!redoBtn.disabled, '此时重做分支还活着，证明历史确实没断');

  ok(loadTemplate(/空白/), '再载入同一份空白关卡（内容与当前文本完全相同）');
  ok(cmText() === blank2, '内容确实没变');
  ok(undoBtn.disabled && redoBtn.disabled, '内容相同也要断历史：两个按钮都置灰');
  doc.body.dispatchEvent(keyEvent('z', 'KeyZ', 90));
  ok(cmText() === blank2, '内容相同的那次换文档之后，Ctrl+Z 也撤不回去');
}

/* 5h. 焦点不在编辑器里时，键盘也要能撤销 / 重做。
 *
 * 真实场景：点完侧栏的「插入」按钮，焦点就留在那个按钮上了，此时按 Ctrl+Z
 * 原本毫无反应（CM 的键位只在编辑器有焦点时才生效）。而"刚插错了想撤掉"
 * 恰恰是点完按钮立刻就会做的动作。
 */
{
  ok(loadTemplate(/空白/), '载入空白关卡（这一节要从干净的文档开始）');
  const blank = cmText();
  ok(insertFirstModule(), '插一个模块');
  const withModule = cmText();
  ok(cmText() !== blank, '插入改了文本');

  // 焦点放到顶栏按钮上（不是编辑器）—— 就是点完插入按钮之后的处境
  const undoBtn = doc.getElementById('btn-undo');
  undoBtn.focus();
  ok(doc.activeElement === undoBtn, '焦点在按钮上，不在编辑器里');

  const ev = keyEvent('z', 'KeyZ', 90);
  undoBtn.dispatchEvent(ev);
  ok(ev.defaultPrevented, 'document 级监听器接住了这个 Ctrl+Z');
  ok(cmText() === blank, '焦点在按钮上也能撤销', `${withModule.length} -> ${cmText().length} 字符`);

  const ev2 = keyEvent('y', 'KeyY', 89);
  undoBtn.dispatchEvent(ev2);
  ok(cmText() === withModule, 'Ctrl+Y 重做回去了', `${cmText().length} 字符`);

  /* 输入框里不该抢键盘：浮层的搜索框有自己的撤销。
   * ⚠ 图鉴栏是**懒建**的（切到那个页签才建 DOM），而且搜索框现在住在**浮层**里
   *   （浮层更是要点了入口才显形），所以必须先点页签、再点开一个入口 ——
   *   否则 q 是 null，下一行 dispatchEvent 直接抛，整套套件崩在这儿：
   *   那句不在 try 里、不在监听器里，没人接管 → node 退出码 1，
   *   下面「侧栏」和「扫雷」两节**根本不执行**，表现是"打到 5h 就没了、没有汇总"。 */
  click([...doc.querySelectorAll('.tabs button')][2], '图鉴页');
  /* ⚠ 入口用 `.codex-ch`（类别行）点名找。2026-09-22 之前这儿点的是
     `.codex-entry-all`（「搜索全部代码」），那个入口本身被删了；现在三级目录里
     最外那一级（类别行）就是"开浮层看这一类"。别改用光秃秃的 `.codex-entry`
     —— 那会拿到 DOM 里第一个次级项，"碰巧"靠的是建树的顺序，谁挪一行就换人，
     而换人之后这条断言照样绿。 */
  const entry0 = doc.querySelector('#panel-codex .codex-ch');
  ok(!!entry0, '图鉴面板里有类别行入口（切到该页签就建出来了）');
  if (entry0) click(entry0, '开浮层');
  const q = doc.querySelector('.codex-modal .codex-q');
  ok(!!q, '浮层里有搜索框');
  const before = cmText();
  const ev3 = keyEvent('z', 'KeyZ', 90);
  if (q) q.dispatchEvent(ev3);
  ok(!!q && !ev3.defaultPrevented, '输入框里的 Ctrl+Z 不被抢（留给它自己的撤销）');
  ok(cmText() === before, '输入框里的 Ctrl+Z 没有动文档');

  // 顺手把"Esc 关浮层"这条独立于后面「侧栏」那一节先钉一次（那边还有一遍三选一）
  const esc0 = new win.KeyboardEvent('keydown',
    { key: 'Escape', bubbles: true, cancelable: true });
  doc.dispatchEvent(esc0);
  ok(doc.querySelector('.codex-modal').hidden, 'Esc 关掉了浮层');
  click([...doc.querySelectorAll('.tabs button')][0], '对象页');

  // ⚠ jsdom 测不到的：contenteditable 那条守卫。jsdom 里 isContentEditable
  //   是 undefined（contentEditable 也不实现），所以 CM 的编辑器内容区在
  //   浏览器里靠 isContentEditable 命中，在 jsdom 里命中的是……命中不了。
  //   这条守卫只能靠人眼在浏览器里过（见 README 的手工验证清单）。
}

/* 5i. 侧栏：图鉴的入口索引 + 浮层，以及合并后失效引用只数一遍。
 *
 * 这一节的每条断言各自对应一个**会悄悄溜过去**的错误实现：
 *   - 图鉴栏被塞进 onStateChange  -> 每打一个字浮层里的列表和搜索词就没了
 *   - renderBrowse 忽略 ui.section -> 入口点了没用，浮层永远画第一个大类
 *   - ensure() 每次重置 ui        -> 切走再切回来，打开的大类跳回第一个
 *   - 点击还留在"插入"语义上      -> 用户查一条就误插一条（这次要修的就是它）
 *   - 长按不吞掉尾巴那次 click    -> 长按插入之后又复制一遍
 *   - 侧栏冒出输入框              -> 用户要的是"侧栏只给入口"
 *   - report.js 不去重            -> 同一条烂引用数两遍
 * 所以每条都配了一条变异（见 tools/mutate.js 的 M14~M17、M20~M23）。
 */
console.log('\n侧栏');

function codexPanel() { return doc.getElementById('panel-codex'); }
function codexModal() { return doc.querySelector('.codex-modal'); }
function modalItems() { return [...codexModal().querySelectorAll('.codex-item')]; }

/** 测试侧的「章 -> 大类」，跟 codex-panel.js 同一个口径。 */
function sectionsOfT(ch) {
  const seen = new Set(), list = [];
  ((ch && ch.groupUnits) || []).forEach(u => {
    const s = u.section || '未分类';
    if (!seen.has(s)) { seen.add(s); list.push(s); }
  });
  return list;
}

/** 侧栏里「某章」那一整块目录（`.codex-tree`）。
 *  五章的块**都在 DOM 里**（建一次、永不重建），只有当前章那块不是 hidden ——
 *  所以这里按内容找，不看可见性：测试要能在任何时候点到任何一章的行。 */
function chBlock(chTitle) {
  return [...codexPanel().querySelectorAll('.codex-tree')]
    .find(t => {
      const h = t.querySelector('.codex-side-h');
      return h && h.textContent === chTitle + ' · 目录';
    }) || null;
}

/** 总目录里「某章」那一行（`.codex-ch`）。 */
function chRowFor(chTitle) {
  return [...codexPanel().querySelectorAll('.codex-ch')]
    .find(b => {
      const t = b.querySelector('.codex-entry-t');
      return t && t.textContent === chTitle;
    }) || null;
}

/** 侧栏里「某章 › 某大类 › 某次级项」那个入口按钮。
 *  **三级都要对上**：大类名只在章内唯一（18 个大类分属 5 章），次级项名只在
 *  大类内唯一（「其他」这种名字一章里能有好几个）。少匹配一级就会拿到别的行，
 *  而且是**静默**拿错 —— 断言照样绿，点的却是另一条路。 */
function unitFor(chTitle, secName, unitTitle) {
  const box = chBlock(chTitle);
  if (!box) return null;
  let inSec = false;
  for (const n of [...box.children]) {
    if (n.classList.contains('codex-sec')) { inSec = n.textContent === secName; continue; }
    if (inSec && n.classList.contains('codex-entry') &&
        n.querySelector('.codex-entry-t').textContent === unitTitle) return n;
  }
  return null;
}

/** 这一条在当前格式下该复制什么 —— 跟 codex-panel.js 的 textFor 同一个口径。
 *  测试自己算一遍是**故意的**：拿被测代码去算期望值，等于什么都没验。 */
function expectTextOf(it, ch, fmt) {
  const table = it.rtid !== undefined ? it.rtid : ch.rtid;
  if (fmt === 'plain') return it.code;
  if (fmt === 'rtid' && table) return '"RTID(' + it.code + '@' + table + ')"';
  return '"' + it.code + '"';
}

/* 提示条历史 / 延后断言住在上面（剪贴板桩那一节），因为它们要在第一个 toast 之前装好 */


/** 把 setTimeout / clearTimeout 换成"记账不执行"的桩，返回一个还原函数。
 *  用来在**同步**套件里测长按：500ms 的定时器等不到，改成手动取出回调调用。
 *  ⚠ 必须**记录**而不是丢弃 —— main.js 的 toast 计时和 revokeObjectURL 也走它。 */
function stubTimers() {
  const realSet = win.setTimeout, realClear = win.clearTimeout;
  const timers = [];
  win.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  win.clearTimeout = (id) => { if (id) timers[id - 1] = null; };
  return {
    /** 跑掉所有还挂着的定时器（被 clearTimeout 过的不会跑） */
    fire() { timers.filter(Boolean).forEach(fn => fn()); },
    restore() { win.setTimeout = realSet; win.clearTimeout = realClear; }
  };
}

/** 把任意值安全地写成一行 —— 断言**失败**时的说明文字也得能打出来。
 *
 *  `JSON.stringify(undefined)` 返回的是 undefined（值，不是字符串），后面接
 *  `.slice` 当场 TypeError。复制桩一次都没被调到时 copied[n] 正是 undefined，
 *  于是"M20 把点击换回插入"这种变异会以**崩溃**收场：套件红是红了，可红在错的
 *  地方，而且汇总、扫雷、后面的断言一条都不跑 —— 变异工具只看 `!!` 行，直接
 *  判它"没被抓住"。 */
function show(v) {
  return String(v === undefined ? '(没复制)' : JSON.stringify(v)).slice(0, 60);
}

function pointerDown(el, x, y) {
  el.dispatchEvent(new win.PointerEvent('pointerdown',
    { bubbles: true, cancelable: true, button: 0, clientX: x || 0, clientY: y || 0 }));
}
function pointerUp(el) {
  el.dispatchEvent(new win.PointerEvent('pointerup',
    { bubbles: true, cancelable: true, button: 0 }));
}

{
  ok(loadTemplate(/空白/), '载入空白关卡');
  click([...doc.querySelectorAll('.tabs button')][2], '图鉴页');
  const panel = codexPanel();

  // ── 1. 侧栏只当目录索引：85 个入口、零个输入框 ──
  const chs = win.Codex.chapters;
  const unitsWanted = chs.reduce((n, c) => n + c.groupUnits.length, 0);      // 80 个次级项
  /* `.codex-entry` = 5 个章行 + 80 个次级项。章行跟次级项共用一套排版（多个
     .codex-ch 区分），所以它们也带这个类 —— 这个数要跟着一起动。
     2026-09-22 之前这儿还有个 +1：侧栏顶上「搜索全部代码」那个入口。它删了
     （用户原话「不需要侧边栏的搜索入口」），所以数从 86 落到 85。 */
  const entriesWanted = chs.length + unitsWanted;
  {
    const entries = [...panel.querySelectorAll('.codex-entry')];
    ok(entries.length === entriesWanted,
      '侧栏正好是「5 个类别行 + 80 个次级项」这些入口',
      `${entries.length} 个（数据算出来 ${entriesWanted} 个）`);
    ok(panel.querySelectorAll('input').length === 0,
      '侧栏里一个输入框都没有（搜索搬进浮层了）',
      `${panel.querySelectorAll('input').length} 个 input`);
    ok(panel.querySelectorAll('.codex-side-h').length === chs.length,
      '每个类别一段目录，各有一个「类名 · 目录」标题',
      `${panel.querySelectorAll('.codex-side-h').length} 个标题`);
    const secBtns = [...panel.querySelectorAll('.codex-tree .codex-sec')];
    ok(secBtns.length === chs.reduce((n, c) => n + sectionsOfT(c).length, 0),
      '18 个大类名一个不少',
      `${secBtns.length} 个大类名`);
    /* 2026-09-22：大类名从"纯标签"变成**入口**（用户原话「侧边栏点击上面的大类
       浮窗就应该跟着切换」），所以现在每一条都得是 <button>。留 .codex-sec 这个
       类是为了让它还能被点名数出来，但**不能**再给它 .codex-entry：上面那条入口
       数是按 `5 + 80` 算出来的，多戴一顶帽子数就对不上了。 */
    ok(secBtns.length > 0 && secBtns.every(b => b.tagName === 'BUTTON'),
      '18 个大类名都是按钮了（点它浮层就切过去）',
      secBtns.map(b => b.tagName).join(','));
    ok(entries.every(e => !e.classList.contains('codex-sec')),
      '大类名没混进 .codex-entry 那一档（入口数会被算重）');
    /* 那个入口删了，但"删干净"得有断言钉着 —— 不然谁把 buildSide 里那段抄回来，
       下面就只是多一行没人点，看不出来。 */
    ok(panel.querySelectorAll('.codex-entry-all').length === 0,
      '侧栏里没有「搜索全部代码」入口（用户点名删掉的）',
      `${panel.querySelectorAll('.codex-entry-all').length} 个`);
    // 列表不在侧栏里 —— 它在浮层里，而浮层挂在 body 下
    ok(panel.querySelectorAll('.codex-item').length === 0,
      '侧栏里没有条目列表（列表搬去浮层了）');
  }

  /* -- 2. 点次级项开浮层：画的是**一整个类别** --
   *
   * 挑**最后一个大类**里的次级项。挑第一组的话，"只画第一个大类"那种实现的首组
   * 标题会跟正确实现一模一样，断言就抓不住它 —— 所以下面专门钉了一条前提断言，
   * 免得这份数据哪天变了、这条测试悄没声地退化成永远通过（`0 === 0` 是恒真的）。 */
  const zch = win.Codex.chapters.find(c => /僵尸/.test(c.title));
  const zsecs = sectionsOfT(zch);
  const secName = zsecs[zsecs.length - 1];
  const units = zch.groupUnits.filter(u => (u.section || '未分类') === secName);
  const wantHeads = units.map(u => u.title);
  /* 整个类别的次级项名（**跨大类**）—— 浮层标题栏底下的分组标题应当正好是这一列。 */
  const allHeads = zch.groupUnits.map(u => u.title);
  const chTotal = zch.groupUnits.reduce((n, u) => n + u.items.length, 0);
  const secTotal = units.reduce((n, u) => n + u.items.length, 0);
  /* **整个类别**摊平之后的条目（不是单个大类的）—— 浮层现在画的就是这一份，
     所以"第 n 条该复制什么"要按它算。 */
  const flat = [];
  zch.groupUnits.forEach(u => u.items.forEach(i => flat.push(i)));

  ok(secTotal > 0, '（前提）挑中的大类有货，下面两条才有得比', `${secName} ${secTotal} 条`);
  ok(wantHeads.length > 0 && wantHeads[0] !== zch.groupUnits[0].title,
    '（前提）挑中的大类不是类别里第一组，否则下面那条分辨不出过滤有没有失效', secName);
  ok(chTotal > secTotal,
    '（前提）整个类别比单一个大类大，否则"只画第一个大类"那种实现分辨不出来',
    `${chTotal} vs ${secTotal}`);

  const pick = unitFor(zch.title, secName, units[0].title);
  ok(!!pick, `侧栏里有「${zch.title} › ${secName} › ${units[0].title}」这个入口`);
  if (pick) click(pick, '开 ' + secName);

  ok(!codexModal().hidden, '点入口把浮层打开了');
  /* 标题**只有类别名**。以前这儿是「章名 · 大类名」—— 浮层按大类切的时候那一段
   * 是必要的；现在大类名在列表里当分隔标题，再挂一个到标题栏上就是重复。 */
  ok(codexModal().querySelector('.codex-mtitle').textContent === zch.title,
    '浮层标题只有类别名，不带「 · 大类名」',
    JSON.stringify(codexModal().querySelector('.codex-mtitle').textContent));
  {
    /* 大类名一层：**正好是这个类别的全部大类，顺序一致**。这条同时抓着两件事 ——
     * "只画点进来的那个大类"（会少几项）和"整个类别画了但大类名没插"（会一项都没有）。 */
    const secHeads = [...codexModal().querySelectorAll('.codex-sec-h')].map(h => h.textContent);
    ok(secHeads.length === zsecs.length && secHeads.every((t, i) => t === zsecs[i]),
      '大类名正好是这个类别的全部大类，顺序一致',
      `${secHeads.length}/${zsecs.length} 个：${secHeads.join(' / ')}`);

    /* 次级标题一层：**全等**，不是前缀。列表一次画完（没有分页截断这回事了），
     * 所以正确实现必然一组不差；写成前缀就比实现能保证的弱，会放过"最后一组丢了"。 */
    const heads = [...codexModal().querySelectorAll('.codex-group-h')].map(h => h.textContent);
    ok(heads.length === allHeads.length && heads.every((t, i) => t === allHeads[i]),
      '次级标题正好是整个类别的全部次级项，一组不多一组不少',
      `${heads.length}/${allHeads.length} 组，首组 "${heads[0]}" 应为 "${allHeads[0]}"`);

    /* 条数必须**正好**是整个类别的条数。这条抓的是"点次级项只画它所在的那个大类"：
     * 大类 382 ≠ 整类 1048，怎么截都对不上。 */
    ok(modalItems().length === chTotal,
      '画出来的条数正好是整个类别的条数（一条不多一条不少）',
      `${modalItems().length} vs 类别 ${chTotal}`);

    /* 大类名在**它那一组次级项之前**。少了这条，把大类名统一挪到列表末尾（或者
     * 挪到列表外面）也能过上面两条 —— 而那样"这条属于哪一类"就答不上来了。 */
    const kids = [...codexModal().querySelector('.codex-out').children];
    const iSec = kids.findIndex(n => n.classList.contains('codex-sec-h'));
    const iGrp = kids.findIndex(n => n.classList.contains('codex-group-h'));
    const iLastSec = kids.map(n => n.classList.contains('codex-sec-h')).lastIndexOf(true);
    ok(iSec >= 0 && iGrp > iSec && iLastSec > iGrp,
      '大类名排在它那一组次级项之前（DOM 顺序）',
      `第一个大类名 @${iSec}，第一个次级标题 @${iGrp}，最后一个大类名 @${iLastSec}`);
  }

  // ── 3. 浮层跨打字存活（M14b 的落点） ──
  {
    const item = modalItems()[0];
    const q = codexModal().querySelector('.codex-q');
    q.value = '巨人';                 // 先在搜索框里留点东西（不派发 input，只是留个痕）
    const v = view();
    v.dispatch({ changes: { from: v.state.doc.length, insert: ' ' } });   // 打一个字
    ok(!!item && modalItems()[0] === item && q.value === '巨人',
      '编辑器里打字之后，浮层没被重建（列表节点和搜索词都还在）');
    v.dispatch({ changes: { from: v.state.doc.length - 1, to: v.state.doc.length } });
  }

  /* -- 4. 搜索只搜**当前这一类**，清空回到原类别 --
   *
   * 2026-09-22 改的。以前这一节叫「搜索仍是跨类别全局」，钉的是"结果里有多个类名"。
   * 用户原话：「图鉴栏浮窗里搜索仅允许在当前类别里搜寻代码…例如在查看植物页面时
   * 浮层顶部的搜索只能搜索到植物代码」。所以那条断言整个反过来。
   *
   * **两个方向都要走，缺一个就是假绿**：
   *   - 拿一个只有别类才有的词搜，必须 0 条 —— 跨类别搜索的实现在这儿露馅
   *   - 拿一个本类有的词搜，必须有货且类名全是本类 —— 只有前半条的话，把
   *     searchScope() 改成 `return []` 也照样绿。 */
  {
    const q = codexModal().querySelector('.codex-q');
    /* 前提：下面那个"搜不到"的词**确实存在于别的类别**。不然它只是个拼错的词，
       "0 条"是句废话，测不出任何东西。 */
    const elsewhere = win.CodexSearch.search(
      win.Codex.chapters.filter(c => c.id !== zch.id), 'potatomine');
    ok(elsewhere.hits.length > 0,
      '（前提）「potatomine」在别的类别里搜得到，"搜不到"才说明得了问题',
      `${elsewhere.hits.length} 条`);

    q.value = 'potatomine';
    q.dispatchEvent(new win.Event('input', { bubbles: true }));
    ok(modalItems().length === 0,
      '搜一个只存在于**别的类别**的词，当前这一类里一条都不返回（搜索不跨类别）',
      `${modalItems().length} 条`);
    const empty = codexModal().querySelector('.codex-hint');
    ok(!!empty && empty.textContent.indexOf(zch.title) >= 0,
      '空结果提示里点名了当前是哪一类（不然用户只会以为搜索坏了）',
      empty ? empty.textContent : '(没有提示)');

    q.value = 'mummy';
    q.dispatchEvent(new win.Event('input', { bubbles: true }));
    const hitChs = new Set(modalItems().map(e => e.querySelector('.codex-ch').textContent));
    ok(modalItems().length > 0 && hitChs.size === 1 && hitChs.has(zch.title),
      '搜本类有的词：结果只属于当前这一类', [...hitChs].join(','));
    ok(/搜索「mummy」/.test(codexModal().querySelector('.codex-mtitle').textContent),
      '标题切成了「搜索「…」」');

    q.value = '';
    q.dispatchEvent(new win.Event('input', { bubbles: true }));
    const back = win.ZEditor.CodexPanel.state();
    /* `section` 这个键**没有了** —— 浮层不再属于任何一个大类，只属于一个类别。
       所以这里问的是 chapterId 一个字，顺带把"多出来的 section 还留着"也钉死。
       `searchIn` 是这轮加的：它跟 chapterId 恒等，所以这条断言其实是在钉"搜索的
       作用域没有第二个数"—— 哪天谁又加回一个能跟 chapterId 分叉的范围，这里就红。 */
    ok(back.open && back.chapterId === zch.id && back.section === undefined,
      '清空搜索框回到浏览，打开的那个类别原样还在',
      `${back.chapterId}/${back.section}`);
    ok(back.searchIn === back.chapterId,
      '搜索的作用域就是当前类别（state 里没有第二个能跟它分叉的数）',
      `${back.searchIn}/${back.chapterId}`);
    ok([...codexModal().querySelectorAll('.codex-group-h')].map(h => h.textContent)[0]
      === allHeads[0], '而且画的还是那个类别（第一组是类别里的第一组，不是点进来的那一组）');
  }

  // ── 5. 三条关闭路径：Esc / ✕ / 点浮层外 ──
  {
    const esc = new win.KeyboardEvent('keydown',
      { key: 'Escape', bubbles: true, cancelable: true });
    doc.dispatchEvent(esc);
    ok(codexModal().hidden, 'Esc 关得掉浮层');
    ok(doc.activeElement === pick, '关掉之后焦点回到侧栏那个入口按钮',
      doc.activeElement && (doc.activeElement.className || doc.activeElement.tagName));

    click(pick, '再开');
    ok(!codexModal().hidden, '再点入口又打开了');
    click(doc.getElementById('statusbar'), '点浮层外面');
    ok(codexModal().hidden, '点浮层外面也关得掉');

    click(pick, '三开');
    ok(!codexModal().hidden, '第三次打开');
    const bad = click(codexModal().querySelector('.codex-mclose'), '✕');
    ok(codexModal().hidden, '点 ✕ 也关得掉');
    if (bad.length) console.log('      点击报错: ' + bad[0]);
  }

  /* -- 6. 点击 = 复制（不是插入），三档格式都对 --
   *
   * 这是本次要修的那个 bug 的落点：M20 把 click 换回 onInsert，这一节必须红。 */
  {
    click(pick, '开浮层做复制');
    const fmt0 = win.ZEditor.CodexPanel.state().fmt;
    const want0 = expectTextOf(flat[0], zch, fmt0);
    const textBefore = cmText();
    const n = copied.length;
    const t0 = toastHistory.length;
    click(modalItems()[0], '点一条');
    ok(copied.length === n + 1 && copied[n] === want0,
      `点击 = 复制（当前 ${fmt0} 档那段文本），不是插入`,
      show(copied[n]) + ' 应为 ' + show(want0));
    ok(cmText() === textBefore, '点击**没有**往文档里插东西（这就是这次要修的 bug）');
    afterMicrotasks(function () {
      ok(toastSaidAfter(t0, '已复制 ' + want0),
        '复制之后给了「已复制 …」提示，且报的就是刚写进去的那一串',
        JSON.stringify(toastHistory.slice(t0).join(' | ')).slice(0, 120));
    });

    // RTID 档：拼得出表名的那一条要真的带上表名
    const iRtid = flat.findIndex(i => (i.rtid !== undefined ? i.rtid : zch.rtid));
    ok(flat.length === chTotal && modalItems().length === chTotal,
      '（前提）扁平化之后条数跟画出来的一致（第 n 条对第 n 个节点才成立）',
      `${flat.length} vs 画出来 ${modalItems().length} vs 类别 ${chTotal}`);
    ok(iRtid >= 0, '（前提）这个类别里有拼得出 RTID 表名的条目');
    /* 格式控件在**侧栏**顶上（#panel-codex），不在浮层里 —— 它是全局设置，
       localStorage 的 zeditor.copyFormat 跟旧图鉴站共用。 */
    const fmtRtid = panel.querySelector('.seg button[data-fmt="rtid"]');
    ok(!!fmtRtid, '侧栏顶部有 RTID 那一档格式控件');
    click(fmtRtid, '切 RTID 档');
    ok(win.ZEditor.CodexPanel.state().fmt === 'rtid', '格式切到了 RTID');
    if (iRtid >= 0) {
      const n2 = copied.length;
      click(modalItems()[iRtid], '点一条（RTID 档）');
      ok(copied[n2] === expectTextOf(flat[iRtid], zch, 'rtid'),
        'RTID 档复制出来是 "RTID(代码@表名)"',
        show(copied[n2]));
      ok(/RTID\(/.test(copied[n2] || ''), '确实带上了表名');
    }
    /* 「选了 RTID 但这条没有表名 → 回退带引号 + 提示里交代一句」这段回退，
     * **不能靠在僵尸类里碰运气找一条没有表名的**：僵尸类每组都继承类级
     * rtid='ZombieTypes'，条目级 rtid 也从没写过空串，所以那样找的结果恒为 -1，
     * `if (i >= 0)` 里那条断言一次都没跑过 —— 绿着，但什么都没测。
     *
     * 改成确定性的靶子：「其他代码」整个类别四个大类都没有 RTID 表
     * （data/ch-status.js 的文件头就是这么写的），下面第一条前提断言钉住它。 */
    const nch = win.Codex.chapters.find(c => /其他/.test(c.title));
    ok(nch && !nch.rtid,
      '（前提）挑中一个没有类级 RTID 表的类别，回退那段才有得测', nch && String(nch.rtid));
    if (nch && !nch.rtid) {
      const nsec = sectionsOfT(nch)[0];
      const nunits = nch.groupUnits.filter(u => (u.section || '未分类') === nsec);
      /* 摊平的是**整个类别**（浮层画的那一份），不是 nsec 那一个大类 —— 类别里
         每个大类的 rtid 都是空的，所以第一个条目跟 nsec 的第一个条目同款。 */
      const nflat = [];
      nch.groupUnits.forEach(u => u.items.forEach(i => nflat.push(i)));
      const npick = unitFor(nch.title, nsec, nunits[0].title);
      ok(!!nflat.length && !!npick,
        `侧栏里有「${nch.title} › ${nsec} › ${nunits[0].title}」这个入口`);
      if (nflat.length && npick) {
        click(npick, '换一个类别：' + nsec);
        ok(win.ZEditor.CodexPanel.state().fmt === 'rtid',
          '（前提）换类别之后仍是 RTID 档，不然下面测的还是带引号那档');
        const n3 = copied.length, t3 = toastHistory.length;
        click(modalItems()[0], '点一条没有 RTID 表的');
        ok(copied[n3] === expectTextOf(nflat[0], nch, 'rtid'),
          '拼不出表名时回退成带引号，而不是拼出个 "RTID(x@undefined)"',
          show(copied[n3]));
        ok(!/RTID\(/.test(copied[n3] || ''), '回退出来的串里没有半个 RTID');
        afterMicrotasks(function () {
          ok(toastHistory.slice(t3).some(function (s) { return /回退带引号/.test(s); }),
            '选 RTID 但这条没有表名时，提示里交代了一句（不说明会以为是 bug）',
            JSON.stringify(toastHistory.slice(t3).join(' | ')).slice(0, 120));
        });
        click(pick, '换回原来的类别');
        const fmtQuoted = panel.querySelector('.seg button[data-fmt="quoted"]');
        ok(!!fmtQuoted, '侧栏顶部有「带引号」那一档格式控件');
        click(fmtQuoted, '格式切回带引号档');
      }
    }
  }

  /* -- 7. 长按 = 插入；短按不插入；长按的尾巴不复制 --
   *
   * 500ms 的定时器在同步套件里等不到，所以把 setTimeout 换成记账桩，手动触发。
   * 跑完必须还原 —— toast 的计时也走 win.setTimeout。 */
  {
    const fmtPlain = panel.querySelector('.seg button[data-fmt="plain"]');
    ok(!!fmtPlain, '侧栏顶部有「纯代码」那一档格式控件');
    click(fmtPlain, '切回纯代码档');
    const it0 = flat[0];

    // 7a. 长按 -> 插入，而且**不**复制
    {
      const target = modalItems()[0];
      const text0 = cmText(), n0 = copied.length;
      const stub = stubTimers();
      try {
        pointerDown(target);
        ok(true, '按下去（长按计时开始）');
        stub.fire();
        ok(cmText() !== text0 && cmText().indexOf(it0.code) >= 0,
          '长按到点：代码插进了文档', `${text0.length} -> ${cmText().length} 字符`);
        ok(copied.length === n0, '长按**没有**顺手复制一次');
        pointerUp(target);
        click(target, '长按之后那一次 click');
        ok(copied.length === n0, '长按的尾巴不算"点击"，不会再复制一遍（M22 的落点）');
      } finally {
        stub.restore();
      }
    }

    // 7b. 短按 -> 只复制，文档一个字不动
    {
      const target = modalItems()[0];
      const text0 = cmText(), n0 = copied.length;
      const stub = stubTimers();
      try {
        pointerDown(target);
        pointerUp(target);            // 定时器在这一步被 clearTimeout 掉
        click(target, '短按');
        ok(copied.length === n0 + 1, '短按（按一下就松）= 复制');
        ok(cmText() === text0, '短按没往文档里插东西');
      } finally {
        stub.restore();
      }
    }

    /* 7c. 按住往下拖 -> 取消。
     * 触屏滚列表时浏览器越过 pan 阈值才发 pointercancel，阈值内的小幅慢拖不发，
     * 所以面板自己按位移补了一刀。少了这一刀，滑动列表就会插进一堆代码。 */
    {
      const target = modalItems()[0];
      const text0 = cmText(), n0 = copied.length;
      const stub = stubTimers();
      try {
        pointerDown(target, 10, 10);
        target.dispatchEvent(new win.PointerEvent('pointermove',
          { bubbles: true, cancelable: true, clientX: 10, clientY: 60 }));
        stub.fire();
        pointerUp(target);
        click(target, '拖过之后再点');
        ok(cmText() === text0, '按住往下拖过阈值：不算长按，没插进文档');
        ok(copied.length === n0 + 1, '拖完松开算一次普通点击（复制）');
      } finally {
        stub.restore();
      }
    }
  }

  /* -- 8. 切走再切回来：ensure 幂等，ui 不重置（M15 的落点） --
   *
   * 问的是 state()，不是读 DOM 里的 .on 反推 —— 后者连"状态本来就存在 DOM 里"
   * 那种错误实现也能通过。
   * 切页签**等于点了浮层外面**（页签在侧栏里，不在 #panel-codex 里），所以浮层
   * 会自己收起来；这一条顺手也钉了"点外面就关"这个约定。 */
  {
    const st = win.ZEditor.CodexPanel.state();
    ok(st.open, '（前提）这会儿浮层是开着的');
    click([...doc.querySelectorAll('.tabs button')][0], '对象页');
    ok(codexModal().hidden, '切到别的页签等于点在外面，浮层自己收起来');
    click([...doc.querySelectorAll('.tabs button')][2], '图鉴页');

    const st2 = win.ZEditor.CodexPanel.state();
    /* ⚠ 这儿本来还有半截 `st2.section === st.section`。`section` 早就不是 state 的
       字段了，两边都是 undefined —— **恒真**，等于没写。删掉不是省事，是因为一条
       永远绿的断言会让人以为"切页签不会改到 section"这件事被测过了。 */
    ok(st2.chapterId === st.chapterId,
      '切走再切回来，打开的那个类别没被重置（state 里问出来的，不是读 DOM 反推）',
      `${st.chapterId} -> ${st2.chapterId}`);
    /* ensure() 每次重新跑一遍的**可见**后果：往 body 里再 append 一个浮层。
     * 每个入口各建一个的话，扫雷的 querySelectorAll('.codex-modal button')
     * 会把它们全捞回来，而 codexModal() 拿到的永远是第一个（陈旧的那个）。 */
    ok(doc.querySelectorAll('.codex-modal').length === 1,
      '浮层还是那一个（切页签不会又 append 一个）',
      `${doc.querySelectorAll('.codex-modal').length} 个`);
    ok(panel.querySelectorAll('.codex-entry').length === entriesWanted,
      '侧栏入口（含目录那三级）也没被重建出一份重复的',
      `${panel.querySelectorAll('.codex-entry').length} vs ${entriesWanted}`);

    click(pick, '再开');
    ok(!codexModal().hidden && modalItems().length === chTotal,
      '关掉之后还能再打开，内容照样对', `${modalItems().length} vs ${chTotal}`);
    doc.dispatchEvent(new win.KeyboardEvent('keydown',
      { key: 'Escape', bubbles: true, cancelable: true }));
  }

  /* -- 9. 一次画完，没有分页（D1）--
   *
   * 挑**最大的**那个类别（僵尸代码，1048 条 / 31 组）。这条比"挑一个不到一页
   * 的"强：它同时证明了"画得完"和"没有第二道闸门"。 */
  let big = null, bigTotal = 0;
  win.Codex.chapters.forEach(c => {
    const n = c.groupUnits.reduce((a, u) => a + u.items.length, 0);
    if (n > bigTotal) { big = c; bigTotal = n; }
  });
  /* 侧栏入口取**最后一个大类**里的次级项 —— 这样它的扁平下标（bigStart）跟
     "本大类之内的下标"（0）是**两个不同的数**，第 15 节那条断言才分得出侧栏写的
     是哪一个。取第一个大类的话两者恒等，那条断言就成了空的。 */
  const bigSecs = sectionsOfT(big);
  const bigSec = bigSecs[bigSecs.length - 1];
  const bigUnits = big.groupUnits.filter(u => (u.section || '未分类') === bigSec);
  const bigStart = big.groupUnits.length - bigUnits.length;   // 最后一个大类的扁平起点

  ok(bigTotal > 400, '（前提）最大的类别远超过一页，不然"全量显示"这条测不出差别',
    `${big && big.title} ${bigTotal} 条 / ${big.groupUnits.length} 组`);
  ok(bigStart > 0 && bigUnits.length > 1,
    '（前提）挑中的大类不是类别里第一个，否则下面分不出"扁平下标"和"组内下标"',
    `起点 ${bigStart}，${bigUnits.length} 组`);
  const bpick = unitFor(big.title, bigSec, bigUnits[0].title);
  ok(!!bpick, `侧栏里有「${big.title} › ${bigSec} › ${bigUnits[0].title}」这个入口`);
  if (bpick) click(bpick, '开最大的类别');

  ok(modalItems().length === bigTotal,
    '最大的类别一次全画出来，一条都不留到"显示更多"里',
    `${modalItems().length} vs ${bigTotal}`);
  ok(!codexModal().querySelector('.codex-more'),
    '列表底下没有「还有 N 条，显示更多」这种东西了（分页整套删掉了）');

  /* -- 10. 次级目录索引（D2）--
   *
   * 索引列的是**整个类别底下**的分组（僵尸代码 31 个），不是 18 个大类 ——
   * 一级目录（类别 › 大类）已经在侧栏了，再列一遍是重复。宽屏下这一列被 CSS
   * 收起来、窄屏才是那条横滑 chip，但**元素照建**，所以这里照常量得到。 */
  {
    const idx = [...codexModal().querySelectorAll('.codex-idx')];
    const want = big.groupUnits.map(u => u.title);
    ok(idx.length === want.length && idx.every((b, i) =>
      b.querySelector('.codex-idx-t').textContent === want[i]),
      '目录索引正好列着整个类别的分组，顺序一致',
      `${idx.length}/${want.length} 条`);
    ok(idx.length > 1 && idx[0].querySelector('.codex-idx-n').textContent
      === String(big.groupUnits[0].items.length),
      '每条目录右边跟着这一组的条数',
      idx[0] && idx[0].querySelector('.codex-idx-n').textContent);
    /* 侧栏点进来的落点是**点的那一组**（见第 15e 节），所以这儿不是 0 而是那个
       扁平下标 —— 拿 0 去比会红，而且红得有道理：真按大类开头落才是错的。 */
    ok(win.ZEditor.CodexPanel.state().at === bigStart,
      '刚打开时高亮停在点进来的那一组（不是类别开头）',
      `${win.ZEditor.CodexPanel.state().at} 期望 ${bigStart}`);

    /* jsdom 不做排版：offsetTop 恒 0、scrollTop 读回来也是 0，所以**自己造几何**。
     * ⚠ scrollTop 必须带 writable: true —— 不带的话面板里那句
     * `out.scrollTop = …`（'use strict' 下给只读属性赋值）直接抛 TypeError，
     * 表现是整套崩掉，而不是某条变红。 */
    const heads = [...codexModal().querySelectorAll('.codex-group-h')];
    heads.forEach((h, i) => Object.defineProperty(h, 'offsetTop',
      { value: i * 200, configurable: true }));
    const outEl = codexModal().querySelector('.codex-out');
    Object.defineProperty(outEl, 'offsetTop', { value: 0, configurable: true });
    Object.defineProperty(outEl, 'scrollTop',
      { value: 0, writable: true, configurable: true });

    click(idx[2], '点目录第 3 条');
    ok(win.ZEditor.CodexPanel.state().at === 2,
      '点目录第 3 条，高亮跟过去（问 state().at，不是读 DOM 的 .on 反推）',
      String(win.ZEditor.CodexPanel.state().at));
    ok(outEl.scrollTop === heads[2].offsetTop,
      '而且列表真的滚到那一组的位置', `${outEl.scrollTop} vs ${heads[2].offsetTop}`);

    /* 滚动高亮：造一个"滚到最后一组"的位置。
     * ⚠ 目标组必须跟上面点出来的那个（第 3 组，下标 2）**不是同一个** —— 不然
     * `at` 不动也能过，这条断言就成了空的（第一版就写的 410 → 期望 2，正好还是 2，
     * 把 spy() 整个删掉它照样绿）。 */
    const kLast = heads.length - 1;
    ok(kLast !== 2, '（前提）最后一组不是第 3 组，否则下面这条分辨不出滚动有没有生效',
      `${heads.length} 组`);
    outEl.scrollTop = kLast * 200 + 10;
    outEl.dispatchEvent(new win.Event('scroll'));
    ok(win.ZEditor.CodexPanel.state().at === kLast,
      '滚动时高亮跟着走（滚到底 = 最后一组亮，说明扫的是真实滚动位置）',
      `${win.ZEditor.CodexPanel.state().at} 应为 ${kLast}`);
    outEl.scrollTop = 0;
    outEl.dispatchEvent(new win.Event('scroll'));
    ok(win.ZEditor.CodexPanel.state().at === 0, '滚回顶上，高亮回到第一组');

    // 搜索态没有"分组"这回事，索引收起来；清空搜索框又回来。M29 的落点。
    const q = codexModal().querySelector('.codex-q');
    q.value = '僵尸';
    q.dispatchEvent(new win.Event('input', { bubbles: true }));
    ok(codexModal().querySelector('.codex-midx').hidden,
      '搜索态把目录索引收起来（搜索结果里没有分组）');
    q.value = '';
    q.dispatchEvent(new win.Event('input', { bubbles: true }));
    ok(!codexModal().querySelector('.codex-midx').hidden,
      '清空搜索框，目录索引回来');
  }

  /* -- 10b. 窄屏那条横滑的 chip 条（目录的窄屏形态）--
   *
   * jsdom **不求值 media query**，所以这里测的不是"窄屏下长什么样" —— 那是
   * check-editor.js 的静态断言 + 人眼的事。这里测的是横条那三件**行为**：
   * 高亮滑进视野、两侧渐隐、滚轮横滚。三件在宽屏（竖列）下都是空转，所以几何
   * 全部自己造出来，让它们在无头环境里有东西可测。 */
  {
    const idxEl = codexModal().querySelector('.codex-midx');
    const chips = [...idxEl.querySelectorAll('.codex-idx')];
    ok(chips.length >= 4,
      '（前提）目录里的 chip 够多，下面几条才测得动', `${chips.length} 条`);

    /* 造几何。**全部按 chips.length 算出来，不写死** —— 这一列现在是整个类别的
       次级项（31 个），跟以前"一个小组"的 10 个不是一回事；写死 900 的话下面"滚到
       右端"那条会永远滚不到头。
       ⚠ 第一格**故意不从 0 开始**（起点给 18px）：真实的 `offsetLeft` 量的是到
       offsetParent 内边距边的距离，条子自己的 padding-left 也在里头，所以它带着一个
       常量偏置。从 0 开始的话，"减掉第一格的位置"那一步就成了空转 —— 去掉它这条断言
       照样绿（这正是 M39 要证明的事）。 */
    const VIEW = 300, PAD0 = 18, CHIP_W = 90, CHIP_STEP = 100;
    const contentW = PAD0 + chips.length * CHIP_STEP;
    const idxMax = contentW - VIEW;                  // 条子能滚到的最大值
    Object.defineProperty(idxEl, 'clientWidth', { value: VIEW, configurable: true });
    Object.defineProperty(idxEl, 'scrollWidth', { value: contentW, configurable: true });
    Object.defineProperty(idxEl, 'scrollLeft',
      { value: 0, writable: true, configurable: true });
    chips.forEach((c, i) => {
      Object.defineProperty(c, 'offsetLeft',
        { value: PAD0 + i * CHIP_STEP, configurable: true });
      Object.defineProperty(c, 'offsetWidth', { value: CHIP_W, configurable: true });
    });

    /* 点最右边那一格：高亮跟过去之外，条子还得把那一格**滑进视野** —— 不滑的话
       高亮落在可视区外面，等于没高亮（旧站 markActive 里就是干这个的）。
       期望值按"居中、再钳到 [0, max]"整条算，不写死：写死就只在格数够多时才
       成立，格数一少这条会变成瞎红。 */
    const kFar = chips.length - 1;
    const wantLeft = Math.max(0, Math.min(
      chips[kFar].offsetLeft - chips[0].offsetLeft - VIEW / 2 + CHIP_W / 2, idxMax));
    click(chips[kFar], '点最后一格目录 chip');
    ok(win.ZEditor.CodexPanel.state().at === kFar,
      '点最后一格 chip，高亮跟过去', String(win.ZEditor.CodexPanel.state().at));
    ok(idxEl.scrollLeft === wantLeft && wantLeft > 0,
      '条子把高亮那一格滑进了视野（居中 + 钳在边界内，不滑过头）',
      `${idxEl.scrollLeft} 应为 ${wantLeft}`);

    /* 再点**中间**的一格：这一条不会被钳到边界，才量得准"居中"本身。
       点最右那一格怎么算都会被钳成 max，常量偏置正好被边界吃掉 —— M39 第一版就栽在
       这儿（去掉"减第一格的位置"它照样绿：两边都钳成 max）。 */
    const kMid = Math.floor(chips.length / 2);
    const wantMid = (chips[kMid].offsetLeft - chips[0].offsetLeft) - VIEW / 2 + CHIP_W / 2;
    click(chips[kMid], '点中间那一格目录 chip');
    ok(wantMid > 0 && wantMid < idxMax,
      '（前提）中间那一格没挨着边界，下面这条才量得到居中',
      `${wantMid} 应落在 (0, ${idxMax}) 里`);
    ok(idxEl.scrollLeft === wantMid,
      '中间那一格是**居中**的（不含 offsetLeft 里那截 padding 偏置）',
      `${idxEl.scrollLeft} 应为 ${wantMid}`);

    /* 两侧渐隐跟着横向滚动位置走。滚到右端之后右边那道必须消掉 —— 1px 余量就是
       为这个留的，不消的话看着像"还没到头"。
     *
     * ⚠ 扫之前先把两个 class **清空**。不清的话，上面点最后一格留下的状态正好是
       「can-left、没有 can-right」，跟"滚到右端"的期望撞个正着 —— 于是把 scroll
       监听整个删掉它也照样绿（M35 第一版就是这么漏过去的：三条里只红了前两条）。
       清空之后每一档都得自己算出来才算过。 */
    idxEl.classList.remove('can-left', 'can-right');
    idxEl.scrollLeft = 0;
    idxEl.dispatchEvent(new win.Event('scroll'));
    ok(idxEl.classList.contains('can-right') && !idxEl.classList.contains('can-left'),
      '条子在左端：右边有渐隐、左边没有', idxEl.className);
    idxEl.scrollLeft = Math.floor(idxMax / 2);
    idxEl.dispatchEvent(new win.Event('scroll'));
    ok(idxEl.classList.contains('can-left') && idxEl.classList.contains('can-right'),
      '条子在中间：两侧都有渐隐', idxEl.className);
    idxEl.scrollLeft = idxMax;
    idxEl.dispatchEvent(new win.Event('scroll'));
    ok(idxEl.classList.contains('can-left') && !idxEl.classList.contains('can-right'),
      '条子滚到右端：右边那道渐隐消掉（不消的话像"还没到头"）', idxEl.className);

    /* 滚轮横滚：竖着滚滚轮 → 条子横向走，并且这一下被吃掉
       （不吃掉的话列表跟着一起滚，条子在那儿抖）。 */
    idxEl.scrollLeft = 300;
    const w1 = new win.WheelEvent('wheel',
      { deltaY: 40, deltaMode: 0, cancelable: true, bubbles: true });
    idxEl.dispatchEvent(w1);
    ok(idxEl.scrollLeft === 340 && w1.defaultPrevented,
      '滚轮竖着滚，条子横向走一格，且这一下被 preventDefault',
      `scrollLeft=${idxEl.scrollLeft} prevented=${w1.defaultPrevented}`);

    /* 条子没溢出时**不许**抢滚轮：它没地方可去，这一下该原样放给列表。 */
    Object.defineProperty(idxEl, 'scrollWidth', { value: 300, configurable: true });
    idxEl.scrollLeft = 0;
    const w2 = new win.WheelEvent('wheel',
      { deltaY: 40, deltaMode: 0, cancelable: true, bubbles: true });
    idxEl.dispatchEvent(w2);
    ok(!w2.defaultPrevented && idxEl.scrollLeft === 0,
      '条子没溢出时不抢滚轮（抢了的话列表就滚不动了）',
      `scrollLeft=${idxEl.scrollLeft} prevented=${w2.defaultPrevented}`);
  }

  /* -- 11. 含单组大类的类别照样画得全 --
   *
   * 这里原先测的是「某个大类只有一组时，目录索引收起来」—— 那条分支**已经删了**：
   * 浮层现在按整个类别画，最少的类别也有 7 组（其他代码），`units.length < 2` 那条
   * 守卫永远触发不到，留着就是一条变异打不红的死代码。
   *
   * 换成一个还测得动的形状：挑一个**含单组大类**的类别（其他代码·主题代码），
   * 开它，断言整个类别的次级项一个不少、目录索引也在（宽窄两态都建出来了）。 */
  {
    /* 扫**全部** (类别, 大类) 组合找那个只有一组的 —— 只看每个类别第一个大类是不够
     * 的，各位置的大类都多于一组。 */
    let one = null, oneSec = '', oneUnits = null;
    win.Codex.chapters.forEach(c => sectionsOfT(c).forEach(s => {
      if (one) return;
      const us = c.groupUnits.filter(u => (u.section || '未分类') === s);
      if (us.length === 1) { one = c; oneSec = s; oneUnits = us; }
    }));
    ok(!!one, '（前提）数据里有一个"只有一组"的大类，这条才测得动',
      one && one.title + ' · ' + oneSec);
    if (one) {
      const p1 = unitFor(one.title, oneSec, oneUnits[0].title);
      ok(!!p1, `侧栏里有「${one.title} › ${oneSec} › ${oneUnits[0].title}」这个入口`);
      if (p1) {
        click(p1, '开含单组大类的类别');
        /* 问的是**整个类别**：含单组的那一段在里头，别的段也一条不少。 */
        const want11 = one.groupUnits.reduce((n, u) => n + u.items.length, 0);
        const idx11 = [...codexModal().querySelectorAll('.codex-idx')];
        ok(modalItems().length === want11 && modalItems().length > oneUnits[0].items.length,
          '含单组大类的类别：整个类别的条目照样画全（不是只画那一组）',
          `${modalItems().length} 条，其中单组那段 ${oneUnits[0].items.length} 条`
          + `，整个类别 ${want11} 条`);
        ok(idx11.length === one.groupUnits.length && !codexModal()
          .querySelector('.codex-midx').hidden,
          '目录索引也照建（整个类别的次级项都列着）',
          `${idx11.length}/${one.groupUnits.length} 条`);
        ok([...codexModal().querySelectorAll('.codex-group-h')]
          .some(h => h.textContent === oneUnits[0].title),
          '那个单组大类的次级标题还在列表里');
      }
    }
  }

  /* -- 12. 复制格式在侧栏顶上（D3）--
   *
   * 它原先在浮层里，可它是**全局设置**（localStorage 的 zeditor.copyFormat，
   * 跟旧图鉴站共用），却要开浮层才能改 —— 说不通。 */
  {
    const fmts = [...panel.querySelectorAll('[data-fmt]')];
    ok(fmts.length === 3, '侧栏图鉴页顶部正好三档复制格式', `${fmts.length} 档`);
    const fmtOn = fmts.filter(b => b.classList.contains('on'));
    ok(fmtOn.length === 1 && fmtOn[0].dataset.fmt === win.ZEditor.CodexPanel.state().fmt,
      '标着 .on 的那一档就是当前档（state 里问出来的）',
      `${fmtOn.map(b => b.dataset.fmt).join(',')} vs ${win.ZEditor.CodexPanel.state().fmt}`);
    ok(panel.querySelectorAll('input').length === 0,
      '格式控件是按钮不是输入框 —— 侧栏仍然一个输入框都没有');
  }

  /* -- 13. 搜索范围（筛选）· 整套已删 --
   *
   * 2026-09-22 用户原话：「不需要筛选范围按钮」。搜索的作用域**就是**浮层当前那一类
   * （见 codex-panel.js 的 searchScope），没有第二个能跟它不一致的数。
   *
   * 这一节以前测的是「清空 / 只勾一类 / 一个都不勾 / 走出口」那一整套。现在留着它
   * 是**反向**用的：钉住这套界面没有偷偷长回来。范围是"看起来很方便、加回去也没人
   * 反对"的那种东西，所以它值得一条明着说"不许有"的断言 —— 光靠 §4 那两条只能证明
   * 搜索的行为对，证明不了控件不在。 */
  {
    const st = win.ZEditor.CodexPanel.state();
    ok(st.scope === undefined,
      '浮层状态里没有 scope（作用域不是一维独立状态）', String(st.scope));
    ok(codexModal().querySelectorAll('.codex-fchk').length === 0 &&
      codexModal().querySelectorAll('.codex-fbtn').length === 0 &&
      codexModal().querySelectorAll('.codex-fpop').length === 0,
      '浮层里没有「范围」按钮 / 勾选小浮层 / 全选清空那一套（用户点名删掉的）',
      `${codexModal().querySelectorAll('.codex-fbtn').length} 个按钮`);
    ok(codexModal().querySelectorAll('.codex-hint-a').length === 0,
      '空结果里也没有「改为搜索全部代码」那个出口（它存在的理由随范围一起没了）');
    /* 格式和密度这两排还在，顺便钉住"删范围没顺手把旁边的东西一起删了"：
       上面那几条断言全是 count === 0，一条被删空的工具条也能让它们全绿。
       ⚠ 复制格式那一排住在**侧栏**（.codex-fmt），不在浮层里 —— 两个选择器
       各查各的容器，别合起来写。 */
    ok(codexPanel().querySelectorAll('.codex-fmt button').length === 3,
      '侧栏的「复制格式」三档照旧还在（别把「删范围」做成「删整条工具条」）',
      `${codexPanel().querySelectorAll('.codex-fmt button').length} 个`);
    ok(codexModal().querySelectorAll('.codex-mbar button').length === 3,
      '浮层里只剩排列密度三档（搜索框旁边那个「范围」是删掉的第四个）',
      `${codexModal().querySelectorAll('.codex-mbar button').length} 个`);
  }

  /* -- 14. 排列密度三档（D4.2）--
   *
   * 状态挂在 .codex-modal 的 data-density 上，**不挂 :root** —— 旧图鉴站整站只有
   * 图鉴，这里 :root 上的 data-density 会漏进编辑器和另外两个页签。
   * 标准档 = 属性被**删掉**（不是写成 "standard"），跟旧站 applyDensity 一致。 */
  {
    const modal = codexModal();
    const dbtn = k => [...modal.querySelectorAll('button[data-density]')]
      .find(b => b.dataset.density === k);
    ok(['loose', 'standard', 'tight'].every(dbtn),
      '浮层里三档密度都在', [...modal.querySelectorAll('button[data-density]')]
        .map(b => b.dataset.density).join(','));
    ok(!modal.hasAttribute('data-density'),
      '默认是标准档 —— 属性直接不写（CSS 的基准值就是标准档）',
      String(modal.getAttribute('data-density')));

    click(dbtn('tight'), '切紧凑');
    ok(modal.dataset.density === 'tight', '切到紧凑，属性写上了 tight');
    ok(win.localStorage.getItem('zeditor.codexDensity') === 'tight',
      '密度落进了 localStorage（不落的话刷新一下就丢）',
      String(win.localStorage.getItem('zeditor.codexDensity')));

    click(dbtn('loose'), '切宽松');
    ok(modal.dataset.density === 'loose', '切到宽松');
    click(dbtn('standard'), '切回标准');
    ok(!modal.hasAttribute('data-density'),
      '切回标准档是**删掉属性**，不是写成 data-density="standard"',
      String(modal.getAttribute('data-density')));

    click(dbtn('tight'), '再切紧凑');
    doc.dispatchEvent(new win.KeyboardEvent('keydown',
      { key: 'Escape', bubbles: true, cancelable: true }));
    click(bpick, '关掉再开');
    ok(codexModal().dataset.density === 'tight',
      '关掉再打开，密度还是刚选的那一档（它挂在浮层上，浮层是常驻的）',
      String(codexModal().dataset.density));
    click(dbtn('standard'), '收尾：切回标准档');
    doc.dispatchEvent(new win.KeyboardEvent('keydown',
      { key: 'Escape', bubbles: true, cancelable: true }));
  }

  /* -- 15. 三级目录：总目录 → 大类名 → 次级项（照旧图鉴站的侧栏）--
   *
   * **三级每一级都是入口**，点了都是"切到这一类"，越深的那一级顺带滚到它那一段。
   * 2026-09-22 之前大类名是纯标签、类别行只翻目录不动浮层 —— 两条都是用户点名
   * 反过来的（原话见 codex-panel.js 里 buildTree / buildSide 上面那两段）。
   *
   * 这一节盯的是这几种"看着像做了、其实没做"的实现：
   *   - 目录只列当前类别          -> 点总目录换不动
   *   - 点类别行只翻目录不切浮层  -> 浮层里还是旧那一类（这轮刚反过来的那条）
   *   - 点大类名不滚到那一段      -> 承诺"跳到「X」"没兑现，落在类别开头
   *   - 切类别靠重建 DOM          -> 节点换了人，焦点和滚动位置一起丢
   *   - 点次级项没滚到那一组      -> 第三级白列，点了跟点类别没区别
   *   - 侧栏高亮只在打开时算一次  -> 浮层里滚到第 5 组，侧栏还亮着第 1 组
   *   - 侧栏 dataset.idx 写组内下标 -> 扁平下标和组内下标是两个数，高亮跳到别的大类
   * 每条都配了变异（tools/mutate.js 的 N1~N9 与这轮新增的几条）。
   */
  {
    const P = win.ZEditor.CodexPanel;
    const trees = () => [...panel.querySelectorAll('.codex-tree')];
    const visTrees = () => trees().filter(t => !t.hidden);

    /* 15a. 总目录：一个类别一行，类名和条数都要跟数据对得上。
       ⚠ 找不着 .codex-entry-t / -n 时写成"红"，**别让它抛** —— 抛出回调整节崩掉，
       变异工具只会看到"没抓住"，而那正是它最该防的静默失效。 */
    const chRowEls = [...panel.querySelectorAll('.codex-ch')];
    ok(chRowEls.length === chs.length && chRowEls.every((b, i) => {
      const t = b.querySelector('.codex-entry-t'), n = b.querySelector('.codex-entry-n');
      return !!t && !!n && t.textContent === chs[i].title
        && n.textContent === String(chs[i].count);
    }), '总目录一个类别一行，类名和条数都跟 Codex.chapters 对得上（顺序也一样）',
      chRowEls.map(b => b.textContent).join(' | '));

    /* 15b. 五个类别的目录块都建出来了，露着的**恰好一块**，就是 chapterId 那一类。
       "都在 DOM 里"不是实现细节 —— 切类别不重建（15d）全靠它。
       ⚠ 以前这儿问的是 state().viewCh。那个数 2026-09-22 被合进了 chapterId
       （点类别行现在会切浮层，两个数永远相等），留着它就是一条恒真断言。 */
    ok(trees().length === chs.length && visTrees().length === 1
      && visTrees()[0].dataset.ch === P.state().chapterId,
      '五个类别的目录块都在 DOM 里，露出来的恰好是 chapterId 那一类（其余挂 hidden，不是删掉）',
      `${trees().length} 块，露着 ${visTrees().length} 块，chapterId=${P.state().chapterId}`);

    /* 15c. 点另一个类别行：浮层**立刻跟着切**（2026-09-22 改的）。
       这一条以前测的是反面 —— "点类别行只翻目录，不动浮层里正在读的那一类"。
       用户原话：「侧边栏点击上面的大类浮窗就应该跟着切换，而不是等到选择了次级分类」，
       所以断言整个反过来。 */
    click(bpick, '先开浮层');
    const s0 = P.state();
    const block0 = trees().find(t => t.dataset.ch === s0.chapterId);
    const s0ch = chs.find(c => c.id === s0.chapterId);
    const other = chs.find(c => c.id !== s0.chapterId);
    /* （前提）两类的条数得不一样，否则"列表换成新那一类了"是恒真的。 */
    ok(other.count !== s0ch.count, '（前提）两类的条数不同，"列表换了"才看得出来',
      `${other.count} vs ${s0ch.count}`);
    click(chRowFor(other.title), `切到「${other.title}」`);
    const s1 = P.state();

    ok(s1.chapterId === other.id && s1.section === undefined
      && !codexModal().hidden && modalItems().length === other.count,
      '点类别行浮层立刻切到那一类（不是等次级项被选中才切）',
      `${s1.chapterId}/${s1.section}，${modalItems().length} 条，期望 ${other.count}`);
    ok(codexModal().querySelector('.codex-mtitle').textContent === other.title,
      '浮层标题也跟着换了（列表换了标题还写着旧的那一类，是半切）',
      codexModal().querySelector('.codex-mtitle').textContent);
    /* ⚠ 别写成 `chRowFor(other.title).classList`：查不到时它是 null，这一行会抛、
       整套崩在那儿 —— 变异工具只看到"没抓住"，而且崩掉之后 §15 后面一条都跑不了。
       仓库里 15h 那条同样的教训（null 要落成红，不是落成崩）。 */
    const otherRow = chRowFor(other.title);
    ok(!!otherRow && otherRow.classList.contains('on'),
      '总目录那一行亮着（点完自己就失去高亮 = 等于告诉你没点上）',
      otherRow ? otherRow.className : '(没找到那一行)');
    ok(visTrees().length === 1 && visTrees()[0].dataset.ch === other.id,
      '下面那整段目录换成了那一类的（同一时刻只有一块露着，不是几块叠起来）',
      visTrees().map(t => t.dataset.ch).join(','));

    /* 15c-2. 点**大类名**：浮层切到那一类 + 滚到**那一段**。
       这是用户那两条里第二条的正落点：点的是大类，不是它底下的次级项，所以"落在哪一组"
       必须由面板自己算（本大类的扁平起点），没有现成的 dataset.unit 可抄。
       上一步刚切到 other 那一类，所以这一下**顺带**又切回了 big —— 两件事一起验。 */
    {
      const secBtn = [...(chBlock(big.title) || { children: [] }).children]
        .find(n => n.classList.contains('codex-sec') && n.textContent === bigSec);
      ok(!!secBtn, `侧栏里有「${big.title} › ${bigSec}」那个大类名`);
      /* （前提）挑中的大类不是类别里第一组 —— 是的话扁平起点就是 0，
         "滚到那一组"跟"滚到类别开头"是同一个位置，这条断言就成了空的。 */
      ok(bigStart !== 0, '（前提）这一大类的扁平起点不是 0，下面那条才分得出"那一段"和"开头"',
        `起点 ${bigStart}`);
      if (secBtn) click(secBtn, '点大类名');
      const s3 = P.state();
      ok(s3.chapterId === big.id && !codexModal().hidden && modalItems().length === bigTotal,
        '点大类名浮层就切到那一类（点的是大类名，不是底下的次级项）',
        `${s3.chapterId}，${modalItems().length} 条 vs ${bigTotal}`);
      ok(s3.at === bigStart,
        '而且落点是**这一大类的开头**，不是类别开头 —— title 里那句"跳到「X」"要兑现',
        `at=${s3.at} 期望 ${bigStart}`);
    }

    /* 15d. 切回去，那一块必须还是**同一个节点**。这条只能这么测 —— 重建之后
       数个数是一样的，数不出来。 */
    const backRow = chRowFor(s0ch.title);
    click(backRow, '切回原来那一类');
    ok(trees().find(t => t.dataset.ch === s0.chapterId) === block0,
      '切类别没有重建目录节点（建一次、永不重建：重建会把焦点和滚动位置一起丢掉）',
      `${visTrees().length} 块露着，节点${trees().find(t => t.dataset.ch === s0.chapterId) === block0 ? '还是原来那个' : '被换掉了'}`);
    ok(P.state().chapterId === s0.chapterId,
      '（前提）切回来了，下面 15e 的落点才对得上', P.state().chapterId);

    /* 15e. 点一个次级项：浮层停在**那一组**，不是停在类别开头。
       **挑它所属大类里的第一个**，而这个大类是类别里的**最后一个** —— 于是"整个
       类别里的扁平下标"（bigStart）跟"本大类之内的下标"（0）是两个不同的数。
       丢掉 opts.unit 的实现会落在 0；把扁平下标写成组内下标的实现也会落在 0。
       两者都跟 bigStart 对不上。
       ⚠ 15d 是点**类别行**切回来的（没带 unit），所以这会儿 at 是 0；下面那一点
       从 0 跳到 bigStart，正是这条要分辨的东西。这一点得**显式断言**：15c-2 点大类名
       时也落在 bigStart，要是不先确认这会儿 at 不是 bigStart，"丢掉 opts.unit"的
       实现就会因为 at 本来就在那儿而蒙混过去。 */
    const kU = 0;
    const kUFlat = bigStart + kU;
    ok(kUFlat !== kU, '（前提）扁平下标跟组内下标不是同一个数，下面这条才分辨得出',
      `扁平 ${kUFlat} vs 组内 ${kU}`);
    ok(P.state().at !== kUFlat,
      '（前提）点之前 at 不在那一组上（否则"点它没反应"也照样绿）',
      `at=${P.state().at}，目标 ${kUFlat}`);
    const uRow = unitFor(big.title, bigSec, bigUnits[kU].title);
    ok(!!uRow, `侧栏三级都列着：「${big.title} › ${bigSec} › ${bigUnits[kU].title}」`);
    if (uRow) click(uRow, '点那个次级项');
    const s2 = P.state();
    ok(!codexModal().hidden && s2.chapterId === big.id && s2.section === undefined
      && s2.at === kUFlat,
      '点次级项：浮层开在那一类，落点是点的那一组（扁平下标，不是类别开头）',
      `at=${s2.at} 期望 ${kUFlat}`);
    /* 侧栏那一行亮的是**同一个扁平下标** —— 两端问的是同一个数，不用换算。
       少了这条，"侧栏写组内下标、浮层用扁平下标"那种实现只在第一个大类里才对得上。 */
    {
      const litU = [...panel.querySelectorAll('.codex-tree .codex-entry.on')];
      ok(litU.length === 1 && litU[0].dataset.idx === String(kUFlat)
        && litU[0].dataset.sec === bigSec,
        '侧栏亮着的那一行，dataset.idx 跟 state().at 是**同一个数**（不是组内下标）',
        `亮着 idx=${litU.map(b => b.dataset.idx).join(',') || '无'}，`
        + `at=${s2.at}，期望都是 ${kUFlat}`);
    }

    /* 15f. 在浮层里滚：侧栏那一行跟着亮，**跨大类也跟**。
       几何得自己造（jsdom 不做排版，offsetTop 恒 0）。**滚动这条路不重画**，
       所以造出来的几何能活到 dispatch 之后 —— 换成点次级项那条路就不行，
       它每次都重建列表，几何当场作废（那条只断言 at，滚动的实现在第 10 节
       用同一个 gotoGroup 已经量过了）。
       滚到的那一组取**同一个大类里的下一组**（bigStart+1），这样"侧栏亮的是不是
       本大类里的行"也一并钉住；离点进去的那一组也够远，at 不动同样过不了。 */
    const heads15 = [...codexModal().querySelectorAll('.codex-group-h')];
    const kMid = bigStart + 1;
    ok(heads15.length > kMid && kMid !== kUFlat && kMid < bigStart + bigUnits.length,
      '（前提）滚到的那一组跟上面点的那一组不是同一个，且还在同一个大类里',
      `${heads15.length} 组，点第 ${kUFlat} 组，滚到第 ${kMid} 组`);
    heads15.forEach((h, i) => Object.defineProperty(h, 'offsetTop',
      { value: i * 200, configurable: true }));
    const out15 = codexModal().querySelector('.codex-out');
    Object.defineProperty(out15, 'offsetTop', { value: 0, configurable: true });
    Object.defineProperty(out15, 'scrollTop',
      { value: 0, writable: true, configurable: true });
    out15.scrollTop = kMid * 200 + 10;
    out15.dispatchEvent(new win.Event('scroll'));
    const lit15 = [...panel.querySelectorAll('.codex-tree .codex-entry.on')];
    ok(P.state().at === kMid && lit15.length === 1
      && lit15[0].dataset.idx === String(kMid) && lit15[0].dataset.sec === bigSec,
      '在浮层里往下滚，侧栏那一项的高亮跟着走（两边问的是同一个 at）',
      `at=${P.state().at}，侧栏亮着 「${lit15.map(b => b.dataset.idx).join(',') || '无'}」`);

    /* 15g. 折叠：默认展开、点一下收起、状态落 localStorage、再点回来。 */
    const foldBtn = panel.querySelector('.codex-fold');
    const chlist = panel.querySelector('.codex-chlist');
    ok(!!foldBtn && !!chlist, '侧栏里有「类别」这个折叠开关和它管着的那一段');
    if (foldBtn) {
      ok(!chlist.hidden && foldBtn.getAttribute('aria-expanded') === 'true'
        && win.localStorage.getItem('zeditor.codexFoldChapters') !== '1',
        '类别列表默认是展开的（折叠是类别多到挤目录时才要的动作，不该第一次来就面对）',
        `hidden=${chlist.hidden} aria=${foldBtn.getAttribute('aria-expanded')}`);
      click(foldBtn, '收起类别列表');
      ok(chlist.hidden && foldBtn.getAttribute('aria-expanded') === 'false',
        '点一下「类别」，整段类别列表收起来（不是只换个箭头）',
        `hidden=${chlist.hidden} aria=${foldBtn.getAttribute('aria-expanded')}`);
      ok(win.localStorage.getItem('zeditor.codexFoldChapters') === '1',
        '折叠状态落进了 localStorage（不落的话切个页签又自己展开，用户以为没记住）',
        String(win.localStorage.getItem('zeditor.codexFoldChapters')));
      click(foldBtn, '再展开');
      ok(!chlist.hidden && win.localStorage.getItem('zeditor.codexFoldChapters') === '0',
        '再点一下展开，落回去的也是展开态');
    }

    /* 15h. 关浮层时焦点不能落在**藏起来**的按钮上：对 hidden 的元素 focus() 是空转，
       人会掉回 <body>（键盘用户从这里继续不了）。

       ⚠ 局面 2026-09-22 换了一种造法。以前是"从次级项点开浮层 → 点类别行把目录翻到
       另一类"，那一下现在会**切浮层**、顺手把 lastEntry 换成点的那一行（露着的），
       局面当场没了 —— 变异 N9 于是变成了恒真。
       现在只有**类别行**藏得住：它在 `.codex-chlist` 里，折「类别」就一起收走了。
       （目录块挂在 chlist 外面，折不到，所以从次级项开的浮层永远露着 —— 这也是
       closeOverlay 那条退路为什么退到目录块而不是总目录那一行。） */
    click(chRowFor(big.title), '从类别行点开浮层');
    click(foldBtn, '把「类别」那一段折起来');
    const hiddenEntry = chRowFor(big.title);
    /* ⚠ 不能写成 `hiddenEntry.closest(...)` 之前不判空：查不到时它是 null，
       这一行会抛，整套崩掉 —— 变异工具只看到"没抓住"。null 要落成红，不是落成崩。 */
    ok(!!hiddenEntry && !!hiddenEntry.closest('[hidden]'),
      '（前提）刚点过的那个入口这会儿确实藏起来了（整个类别列表都折着）');
    doc.dispatchEvent(new win.KeyboardEvent('keydown',
      { key: 'Escape', bubbles: true, cancelable: true }));
    ok(codexModal().hidden, '（前提）Esc 把浮层关掉了');
    const landed = doc.activeElement;
    ok(!!landed && landed !== doc.body && !(landed.closest && landed.closest('[hidden]')),
      '关浮层时焦点落在**露着的**东西上，没掉回 <body>、也没留在藏起来的按钮上',
      landed && (landed.className || landed.tagName));
    /* 露着的那个东西得**在这一类里**，不能是随便哪个露着的按钮 ——
       "焦点掉到别的类别的第一行"也是错的，只是比掉回 <body> 体面一点。 */
    ok(!!landed && landed.dataset && landed.dataset.ch === big.id,
      '而且落在这个类别自己的目录块里（不是随便哪个露着的按钮）',
      landed && landed.dataset ? landed.dataset.ch : '(没有 dataset)');
    click(foldBtn, '收尾：把类别列表展回来');
  }
}

/* 5i-b. 剪贴板兜底那一路。
 *
 * navigator.clipboard 是主路，但 jsdom 里没有、部分浏览器也真的会 reject。
 * 这条兜底唯一的测试就是这儿：把桩摘掉，点一次，看提示条说的是不是失败文案。
 *
 * 兜底里那句 `document.execCommand` 在 jsdom 里**根本不存在**（裸调直接 TypeError），
 * 全靠 fallbackCopy 的 try/catch。那个 try/catch 要是松了，异常会从点击回调里抛出去、
 * 被 jsdom 报到 problems 上，整页以"有未捕获的错误"收场（见下面的汇总） ——
 * 所以这里不必再单独断言一遍"没抛异常"，那只会把同一件事报两遍。 */
{
  const desc = Object.getOwnPropertyDescriptor(win.navigator, 'clipboard');
  const safe = { value: desc.value, configurable: true };
  delete win.navigator.clipboard;
  const entry = doc.querySelector('#panel-codex .codex-entry-all');
  if (entry) click(entry, '开浮层（兜底那一路）');
  const item = doc.querySelector('.codex-modal .codex-item');
  ok(!!item, '浮层里有条目可以点');
  const t = toastHistory.length;
  if (item) click(item, '点一条（没有剪贴板 API）');
  afterMicrotasks(function () {
    ok(toastHistory.slice(t).some(function (s) { return /复制失败/.test(s); }),
      '两条路都写不进去时给的是失败文案（不是默默什么都没发生）',
      JSON.stringify(toastHistory.slice(t).join(' | ')).slice(0, 120));
  });
  Object.defineProperty(win.navigator, 'clipboard', safe);
  doc.dispatchEvent(new win.KeyboardEvent('keydown',
    { key: 'Escape', bubbles: true, cancelable: true }));
}

/* 5j. 失效引用只数一遍。
 *
 * 这一格是本次重构要修的老问题：`LevelDefinition.Modules` 里一条解不开的引用
 * 同时被 findInvalidLevelModuleReferences（窄而深）和 Outline.dangling（宽而浅）
 * 报出来，原先两个渲染面各数一遍。现在 Report.build 按整串 RTID 去重，
 * 状态栏和树上那段必须报同一个数。
 */
{
  ok(loadTemplate(/坚不可摧/), '载入坚不可摧（这份有几个模块）');
  const text0 = cmText();
  const doc0 = JSON.parse(text0);
  const ld = doc0.objects.find(o => o.objclass === 'LevelDefinition');
  ok(!!ld && Array.isArray(ld.objdata && ld.objdata.Modules) && ld.objdata.Modules.length > 0,
    'LevelDefinition 里有 Modules 数组');

  const rtid = ld.objdata.Modules[0];
  const v = view();
  v.dispatch({
    changes: { from: 0, to: v.state.doc.length, insert: text0.split(rtid).join('RTID(NoSuchModule@CurrentLevel)') }
  });
  ok(cmText() !== text0, '把 Modules 里的第一条引用改成解不开的', rtid);

  const sum = doc.getElementById('sum').textContent;
  const tree = doc.getElementById('panel-tree').textContent;
  ok(/1 个失效引用/.test(sum), '汇总条报「1 个失效引用」', JSON.stringify(sum));
  const sec = [...doc.querySelectorAll('#panel-tree .sec')]
    .find(s => /失效引用/.test(s.querySelector('.sec-title').textContent));
  ok(!!sec && sec.querySelector('.sec-count').textContent === '1',
    '树上那段也报 1（同一份数据，不是各数各的）',
    sec ? sec.querySelector('.sec-count').textContent : '没找到那一段');

  /* 汇总条必须用 Parse.findOrphanedObjects，不能用 outline.orphans ——
   * 没有 LevelDefinition 时 computeReachableObjects 返回空 Set，于是**所有**
   * 对象都会被判成孤立模块。树上没露馅只因为 tree.js 在无根时提前 return 了，
   * 而汇总条住在树外面。 */
  ok(loadTemplate(/空白/), '载入空白关卡');
  const noRoot = JSON.parse(cmText());
  noRoot.objects = noRoot.objects.filter(o => o.objclass !== 'LevelDefinition');
  const v2 = view();
  v2.dispatch({ changes: { from: 0, to: v2.state.doc.length, insert: JSON.stringify(noRoot, null, 2) } });
  ok(doc.getElementById('sum').hidden, '无根文件上汇总条是藏着的（不是报一堆孤立模块）',
    JSON.stringify(doc.getElementById('sum').textContent));
}

/* 5k. 对象**深处**落空的引用也必须报出来。
 *
 * 用户的原话：「部分指向当前关卡的 RTID 语句失效了没有当成失效引用，只会增加孤立
 * 对象，但实际上这种情况是需要报错的，只要找不到对象落空就会引发闪退」。
 * 上面 5j 改的是 LevelDefinition.Modules 里那一条（窄口径本来就看得见它），
 * 这一节改的是某个对象 objdata 深处那一条 —— 原先它只让被引用的对象变成孤立模块，
 * 失效引用那一栏一声不吭（outline.build 只汇总节点级的 notes，不收 dangling）。
 *
 * 走完整条界面链路：改文本 -> 状态栏 / 汇总条 / 对象树那一段 / 那个节点上的 ⚠。 */
{
  ok(loadTemplate(/坚不可摧/), '载入坚不可摧（这份里有写在对象深处的 @CurrentLevel 引用）');
  const doc0 = JSON.parse(cmText());
  const Z = win.ZLevel;
  const isContainer = o =>
    o.objclass === 'LevelDefinition' || o.objclass === 'WaveManagerProperties';
  const local = Z.Parse.allAliases(doc0.objects);
  let host = null, ref = null;
  doc0.objects.forEach(o => {
    if (host || isContainer(o)) return;
    Z.Rtid.collectRefs(o && o.objdata, []).forEach(r => {
      if (!host && r.source === 'CurrentLevel' && local.has(r.alias)) { host = o; ref = r; }
    });
  });
  ok(!!host, '找得到一条写在对象深处的 @CurrentLevel 引用（探针本身得成立）',
    host ? host.aliases[0] + ' 里的 ' + ref.full : '没找到');

  if (host) {
    const rtid = 'RTID(NoSuchDeepAlias@CurrentLevel)';
    const text0 = cmText();
    ok(text0.split(ref.full).length - 1 === 1,
      '这条引用在全文只出现一次（改它不会连带改到 Modules 里的那条）',
      String(text0.split(ref.full).length - 1));
    const v = view();
    v.dispatch({
      changes: { from: 0, to: v.state.doc.length, insert: text0.split(ref.full).join(rtid) }
    });
    ok(cmText() !== text0, '把它改成一个不存在的别名', rtid);

    const sum = doc.getElementById('sum').textContent;
    ok(/1 个失效引用/.test(sum),
      '汇总条报出这条失效引用（原先这里一个数都不变，只多一个孤立模块）',
      JSON.stringify(sum));
    const st = doc.getElementById('statusbar').textContent;
    ok(/1 个失效引用/.test(st), '状态栏也报了', JSON.stringify(st.slice(0, 60)));

    const sec = [...doc.querySelectorAll('#panel-tree .sec')]
      .find(s => /失效引用/.test(s.querySelector('.sec-title').textContent));
    ok(!!sec && sec.querySelector('.sec-count').textContent === '1',
      '对象树上「失效引用」那一段也报 1（与汇总条同一个数）',
      sec ? sec.querySelector('.sec-count').textContent : '没找到那一段');
    ok(!!sec && /ChallengeModule/.test(sec.textContent),
      '……而且写出了出处（用户得知道去哪儿改）',
      sec ? sec.textContent.replace(/\s+/g, ' ').slice(0, 80) : '');

    /* ── 这一段**长什么样**（2026-09-22 用户点名改的）──
     *
     * 用户原话：「侧边栏失效引用直接红字写失效代号，字体大小和其他 ui 保持统一，现在过大了。
     * 这些引用落空了：这一段灰色字以及后面参考文件没有这些提示去掉。」
     * 也就是：行里只剩**失效的那个代号**和它出现在哪儿。
     *
     * ⚠ 这里钉得住的是**结构**（行里是什么字、底下那段灰字在不在）。"红字"和"字号跟
     * 别处一样"是排版，jsdom 不做排版 —— 那两条得人眼看（.node-bad 是 div，不继承
     * .node-go 那条 .86em，2026-09-22 那次正是栽在这儿）。 */
    const badRow = sec && sec.querySelector('.node-bad');
    ok(!!badRow && !!badRow.querySelector('.node-cls')
      && badRow.querySelector('.node-cls').textContent === 'NoSuchDeepAlias',
      '失效那一行写的是**失效的代号本身**（不是"某处一个引用坏了"这种话）',
      badRow && badRow.querySelector('.node-cls') && badRow.querySelector('.node-cls').textContent);
    ok(!!badRow && !/找不到|参考文件里没有/.test(badRow.textContent),
      '行里不再插一个"哪种坏法"的词（那个区分退进 title 了，扫一列代号时不该有噪音）',
      badRow && badRow.textContent);
    /* 只要求"区分在 title 里"，不在这儿重钉它是哪一档 —— 档位本身由上面那条 ⚠ 的 title
     * 断言钉着（`本文件里找不到：NoSuchDeepAlias`），这里再钉一遍是重复，而且一旦哪天
     * 判档口径动了，两处会一起红、分不清是谁的事。 */
    ok(!!badRow && /本文件里找不到|参考文件里没有/.test(badRow.querySelector('.node-cls').title),
      '……区分还留着，只是在 title 里（鼠标停上去才看）',
      badRow && badRow.querySelector('.node-cls').title);
    ok(!!sec && !sec.querySelector('.sec-note'),
      '段落底下那段灰字说明没了（用户点名去掉的那句"这些引用落空了…"）');

    const warns = [...doc.querySelectorAll('#panel-tree .node-warn')];
    ok(warns.length === 1 && /本文件里找不到：NoSuchDeepAlias/.test(warns[0].title),
      '那个对象自己的 ⚠ 上也写着"本文件里找不到"',
      warns.map(w => w.title.replace(/\n/g, ' / ')).join(' | ') || '一个 ⚠ 都没有');

    // 孤立模块确实也多了（用户看到的那一半现象），但报错才是这一节的重点
    ok(/孤立模块/.test(doc.getElementById('panel-tree').textContent),
      '原本被指着的那个对象同时变成孤立模块（两个现象并存，不冲突）');
  }
}

// ── 6. 按钮扫雷 ────────────────────────────────────────────────────────
//
// 上面几节只覆盖我想得到的路径。这一节换个思路：把每个面板里的按钮逐个点一遍，
// 只问一件事 —— 有没有抛异常。第二个 bug（在订阅回调里调记录上没有的方法）
// 就是这一类，任何一个小面板里再犯一次都该被这里抓住。
//
// 两条规则是必须的，否则这一节会变成"点了个寂寞"：
//
//   1. **每次都现查 DOM**。面板是整块重建的，先收集 NodeList 再遍历的话，
//      点到一半节点就全成了游离节点，点的是旧闭包，测不出任何东西。
//   2. **先造出一个"脏"文档**，让修东西的按钮真的存在。空关卡是干净的，
//      校验面板一个按钮都不渲染 —— 第一版就是这样：号称扫了 600 个按钮，
//      其实 96 个插入按钮来回点了几轮，校验面板一次都没进去。
//
// 放在最后：这一节有副作用（真的插、真的删、真的清），前面那些精确断言
// 用的是干净的初始文档。
console.log('\n按钮扫雷（每个按钮点一次，只看有没有抛异常）');

// 下载会走 createObjectURL + a.click()，jsdom 两样都没实现
win.URL.createObjectURL = function () { return 'blob:stub'; };
win.URL.revokeObjectURL = function () {};

/**
 * 点某个面板里的所有按钮，每次现查 DOM，同一个节点只点一次。
 * @param {string} firstSel  可选。主循环**之前**先点它（只点第一个），并记进 hit。
 *   给"跟它要动的那些行挤在同一段里"的按钮用：树上的「清理」按钮住在孤立模块段，
 *   主循环按 DOM 顺序走会先点掉那几行的 ✕，孤立模块一没，按钮就消失了 ——
 *   于是覆盖断言变红，而它红得对（确实没扫到）。
 */
function sweep(panelId, cap, expandSel, firstSel) {
  // 先展开所有折叠段 —— 收着的段里的按钮用户点不到，但它们是渲染过的
  const seen = new WeakSet();
  const hit = [];
  if (firstSel) {
    const b = doc.querySelector(panelId + ' ' + firstSel);
    if (b) {
      seen.add(b);
      hit.push(String(b.className || b.tagName));
      click(b, '先点 ' + b.textContent.slice(0, 16));
    }
  }
  for (let guard = 0; guard < cap; guard++) {
    if (expandSel) {
      const folded = [...doc.querySelectorAll(panelId + ' ' + expandSel)]
        .find(h => !seen.has(h) && /▸/.test(h.textContent));
      if (folded) {
        seen.add(folded);
        hit.push(String(folded.className || folded.tagName));
        click(folded, '展开 ' + folded.textContent.slice(0, 10));
        continue;
      }
    }
    const b = [...doc.querySelectorAll(panelId + ' button')]
      .find(x => !x.disabled && !seen.has(x));
    if (!b) break;
    seen.add(b);
    hit.push(String(b.className || b.tagName));
    if (process.env.SWEEP_VERBOSE) console.log("        -> " + panelId + " " + (b.className||b.tagName) + " | " + String(b.textContent).slice(0,20));
    click(b, (b.className || b.tagName) + ' ' + String(b.textContent).slice(0, 16));
  }
  return hit;
}

{
  // 先造"脏"状态：载入模板 -> 从对象树删几个对象（会留下失去引用的空壳），
  // 这样校验面板才会渲染出「清理这 N 个孤立模块」和孤立模块列表
  click(doc.getElementById('btn-templates'), '模板');
  const items = [...doc.querySelectorAll('#tpl-pop button, #tpl-pop .tpl-item')];
  ok(items.length >= 9, '模板弹层里有 9 份模板', `${items.length} 份`);
  // 要挑一份**有内容**的：空白关卡只有 LevelDefinition，一个可删的对象都没有，
  // 校验面板也就一个按钮都不渲染（第一版就栽在这）
  const item = items.find(x => /坚不可摧/.test(x.textContent)) || items[items.length - 1];
  ok(!!item, '找到一份有内容的模板', item && item.textContent.trim().slice(0, 20));
  if (item) {
    click(item, '选模板');
    ok(/LevelDefinition/.test(doc.getElementById('panel-tree').textContent),
      '选了模板之后对象树有内容');
  }

  const objs = objCount();
  ok(objs > 2, '这份模板里有多个对象（不然删无可删）', `${objs} 个`);
  // 删掉几个：级联会顺手清掉失去引用的对象，所以这一步只造出**失效引用**
  // （引用还在、对象没了）—— 校验面板的「失效引用」那一段
  const dels = [...doc.querySelectorAll('#panel-tree .node-del')].slice(0, 3);
  ok(dels.length > 0, '对象树里有可删的行', `${dels.length} 个删除按钮`);
  dels.forEach(d => click(d, '删一个对象'));
  ok(objCount() < objs, '删完之后对象变少了（脏状态成立）', `${objs} -> ${objCount()}`);

  // 再手改出一批**孤立模块**（对象还在、没人引用）。删是删不出孤立模块的 ——
  // removeObject 会级联清理，这是设计如此。孤立模块只能从"引用被改没了"来，
  // 而那正是用户手改 JSON 时最常干的事，也是「清理」按钮唯一出现的情形。
  {
    const doc0 = JSON.parse(cmText());
    const victim = doc0.objects.find(o =>
      o.objclass !== 'LevelDefinition' && o.aliases && o.aliases.length);
    ok(!!victim, '找得到一个有引用的对象来制造孤立模块',
      victim && victim.aliases[0]);
    if (victim) {
      const rtid = `RTID(${victim.aliases[0]}@CurrentLevel)`;
      const before = cmText();
      const after = before.split(rtid).join('RTID(LevelDefinition@CurrentLevel)');
      ok(after !== before, `把 ${rtid} 的引用改指到别处`, `${rtid}`);
      const v = view();
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: after } });
      // 「清理」按钮原先在校验页，现在挂在对象树的孤立模块段里。
      // 树是**无条件**渲染的（不懒建），所以不用先点页签 —— 但显式切一下更贴近用户。
      click([...doc.querySelectorAll('.tabs button')][0], '对象页');
      ok(/清理这/.test(doc.getElementById('panel-tree').textContent),
        '对象树上出现了「清理这 N 个孤立模块」按钮');
    }
  }

  /* 顺序是排过的，而且是被断言逼出来的。
   *
   * 合并之前「清理」按钮在校验页，所以校验页必须第一个扫 —— 树那边点 node-del 会
   * 级联，孤立模块一没，「清理」按钮就消失了。合并之后按钮**搬进了树里**，
   * 那份顺序保护随之失效：树这一步的 node-del 会把孤立模块行删光，等主循环走到
   * 「清理」时它已经不在 DOM 里了。所以改成 **first 参数显式点名先点**，
   * 而不是靠"哪个面板先扫"。
   *
   * #panel-tree 出现两次，一次脏文档（专门伺候「清理」）、一次干净模板
   * （扫树的其余按钮）。swept 是按 id **累加**的，同名不会互相冲掉。
   *
   * 图鉴拆成两步，而且都必须排最后：
   *   #panel-codex  85 个入口（5 类别行 + 80 次级项）+ 18 个大类名 + 折叠 + 三档格式
   *                 —— 三级目录**每一级点下去都会开/切浮层**（2026-09-22 起，
   *                 以前类别行那一档只翻目录，见 §15）。所以这一步点完，浮层是开着的。
   *   .codex-modal  **条目在浮层里，浮层挂在 body 下**，sweep('#panel-codex', …)
   *                 永远碰不到 .codex-item。这是"覆盖悄悄失效"的典型形态，
   *                 所以下面的覆盖断言必须把这一步也数进去。
   * 浮层还**懒开**：不先在 pre 里点开，querySelectorAll('.codex-modal button')
   * 是空集，sweep 自己不报错（got.length === 0），全靠覆盖断言兜。
   * pre 里先搜一个词，把结果集压小 —— 点击虽然改成复制了，长按仍然是插入，
   * 而且浏览态最坏 1048 行（僵尸代码，整个类别一次画完），慢慢点一遍没必要。
   * ⚠ 搜的那个词必须**从当前这一类的数据里取**，不能写死：搜索现在只搜当前这一类
   *   （用户 2026-09-22 点名要的），写死「豌豆射手」而浮层正开在「障碍物代码」上，
   *   结果就是 0 条 —— `.codex-item` 一个都扫不到，覆盖断言红得莫名其妙。
   */
  const tabs = [...doc.querySelectorAll('.tabs button')];
  const plan = [
    { id: '#panel-tree', tab: 0, expand: '.sec-head', first: '.btn-fix' },
    {
      id: '#panel-tree', tab: 0, expand: '.sec-head',
      // 上一步把孤立模块清掉了，文档这会儿只剩一副骨架，树里一个可删的行都没有，
      // .node-del 就扫不到（覆盖率断言会当场报出来）。重新开一份有内容的。
      pre: function () {
        click(doc.getElementById('btn-templates'), '再开模板');
        const it = [...doc.querySelectorAll('#tpl-pop button')]
          .find(x => /坚不可摧/.test(x.textContent));
        if (it) click(it, '再选坚不可摧');
      }
    },
    { id: '#panel-modules', tab: 1, expand: '.ins-group-h' },
    {
      /* 模块详情浮层跟图鉴浮层同一个形态：**挂在 body 下**，所以
       * sweep('#panel-modules', …) 永远碰不到 .mdl-insert / .mdl-mclose，
       * 这是"覆盖悄悄失效"的典型样子，必须单列一步 + 下面的覆盖断言兜底。
       * 它也懒开：不先在 pre 里点开一行，querySelectorAll 是空集，
       * 而 sweep 自己不报错（got.length === 0）。 */
      id: '.mdl-modal', tab: 1, expand: null,
      pre: function () {
        const head = doc.querySelector('#panel-modules .ins-group-h');
        if (head && /▸/.test(head.textContent)) click(head, '展开分组');
        const row = doc.querySelector('#panel-modules .ins-group-b .ins-main');
        if (row) click(row, '开模块详情');
      }
    },
    { id: '#panel-codex', tab: 2, expand: null },
    {
      id: '.codex-modal', tab: 2, expand: null,
      pre: function () {
        /* 类别行 = 开浮层（三级目录每一级都是入口）。先点它，浮层才有内容可扫。 */
        const entry = doc.querySelector('#panel-codex .codex-ch');
        if (entry) click(entry, '开浮层');
        const q = doc.querySelector('.codex-modal .codex-q');
        if (!q) return;
        /* 词从**当前这一类自己的数据**里取 —— 见上面那段 ⚠。取第一条的代码：
           它一定搜得到自己，`res.hits` 非空，`.codex-item` 才有得扫。 */
        const st = win.ZEditor.CodexPanel.state();
        const cur = win.Codex.chapters.find(c => c.id === st.chapterId);
        if (!cur || !cur.items.length) return;
        q.value = cur.items[0].code;
        q.dispatchEvent(new win.Event('input', { bubbles: true }));
      }
    }
  ];
  const before = problems.length;
  const swept = {};                 // id -> 点过的 className 列表，**累加**
  plan.forEach(step => {
    if (step.pre) step.pre();
    click(tabs[step.tab], '页签 ' + (step.tab + 1));
    if (process.env.SWEEP_VERBOSE) {
      console.log('       [' + step.id + '] 按钮: ' +
        [...doc.querySelectorAll(step.id + ' button')].map(b => b.className).join(', '));
    }
    /* 图鉴那两处要给 140：浮层里除了搜索框和条目，还有三档密度、最多 31 个目录索引
       按钮（整个类别的次级项数，僵尸代码）—— 60 会在走到 .codex-item 之前就用完，
       而覆盖断言点名要 .codex-item。用完不是报错，是**悄悄少点**，所以下面那条
       断言是闸门。（侧栏那边也吃紧：85 个入口 + 18 个大类名 + 折叠 + 三档格式。） */
    const cap = /^#panel-(codex|tree)$/.test(step.id) ||
      step.id === '.codex-modal' || step.id === '.mdl-modal' ? 140 : 60;
    const got = sweep(step.id, cap, step.expand, step.first);
    swept[step.id] = (swept[step.id] || []).concat(got);
    console.log(`       ${step.id}  点了 ${got.length} 个按钮`);
  });
  const clicked = Object.keys(swept).reduce((a, k) => a + swept[k].length, 0);

  // 把"覆盖到哪了"也断言掉。这一节的价值全在覆盖上，而覆盖是会**悄悄失效**的：
  // 面板随文档状态重建，某个按钮不存在时就少测一条路，扫雷照样全绿。
  // 所以点名要求几个关键按钮必须真的被点到。
  // .codex-item 只在 .codex-modal 那一步里 —— 它挂在 body 下，不在 #panel-codex 里。
  for (const cls of ['node-go', 'node-del', 'node-edit', 'sec-head', 'ins-group-h', 'ins-main',
    'codex-item', 'mdl-insert', 'mdl-mclose']) {
    ok(swept['#panel-tree'].concat(swept['#panel-modules'], swept['#panel-codex'],
      swept['.codex-modal'] || [], swept['.mdl-modal'] || []).some(c => c.indexOf(cls) >= 0),
      `扫到了 .${cls}`);
  }
  ok(swept['#panel-tree'].some(c => /btn-fix/.test(c)),
    '扫到了树上的「清理」按钮（孤立模块被清掉了才算真点到）');

  /* 侧栏这一轮长成了三级，而且**三级都是入口**。这几条点名要章行、大类名和折叠
     开关 —— 它们跟 80 个次级项**共用 `.codex-entry` 那套排版**（大类名是
     `.codex-sec` + `.codex-sec-btn`，另外两级才是 `.codex-entry`），所以只点名
     `.codex-entry` 的话，"章行一个都没扫到"会藏在那 85 个同类里头，看不出来。
     大类名尤其要单独点名：它是 2026-09-22 才变成按钮的，加个类忘了接线，
     扫雷不会自己发现。 */
  for (const cls of ['codex-ch', 'codex-fold', 'codex-sec-btn']) {
    ok(swept['#panel-codex'].some(c => c.indexOf(cls) >= 0), `扫到了 .${cls}`);
  }

  // 顶栏和弹层也是"点了没反应"的重灾区
  const chrome = ['btn-templates', 'btn-settings', 'btn-undo', 'btn-redo', 'btn-save', 'btn-open', 'btn-clear']
    .map(id => doc.getElementById(id)).filter(Boolean);
  let chromeClicked = 0;
  chrome.forEach(b => { if (!b.disabled && !b.hidden) { click(b, b.id); chromeClicked++; } });
  click(doc.getElementById('scrim'), '遮罩');

  ok(clicked > 30, `面板里一共点了 ${clicked} 个按钮（太少说明选择器没选中东西）`,
    `顶栏另点 ${chromeClicked} 个`);

  const thrown = problems.slice(before).filter(p => !/Not implemented|Could not parse CSS/.test(p));
  ok(thrown.length === 0, '扫的过程中没有抛异常', thrown.slice(0, 2).join(' | '));
  if (thrown.length) thrown.slice(0, 5).forEach(t => console.log('      ' + t));
}

// ── 6b. 点树上的一行：光标落在**那个对象**身上 ──────────────────────────
/* 用户 2026-09-22 报的毛病：文件里别处有个键名 / 值 / 引用恰好跟目标同名时，点一行
 * 会跳到那儿去，而不是那个对象自己的位置（旧实现是 `text.indexOf('"别名"')`，
 * 谁先出现谁赢）。
 *
 * 这份人造文件把两种情况占了一样：那个模块的别名同时是上层对象里的一个**值**
 * （`"Name": "WidgetProps"`，在文本里出现得更早），也是 Modules 里一条
 * @CurrentLevel 引用的一部分。按名字搜必中前一个 —— 那正是用户看到的现象。
 *
 * 断言不是"跳到了第几个字符"（那是实现口径），而是**选中的那一段文本解析出来
 * 正好是点的那一个对象** —— 位置对不对，由这段 JSON 自己说了算。 */
{
  const objs = [
    { objclass: 'LevelDefinition', aliases: ['LevelDefinition'],
      objdata: { Modules: ['WidgetProps@CurrentLevel'], Name: 'WidgetProps' } },
    { objclass: 'WidgetProps', aliases: ['WidgetProps'], objdata: { Count: 3 } }
  ];
  const v = view();
  v.dispatch({
    changes: { from: 0, to: v.state.doc.length, insert: JSON.stringify({ objects: objs }, null, 2) }
  });

  const rows = [...doc.querySelectorAll('#panel-tree .node-go')];
  const target = rows.filter(r => {
    const c = r.querySelector('.node-cls');
    return c && c.textContent === 'WidgetProps';
  })[0];
  ok(!!target, '人造文件的对象树上有 WidgetProps 那一行', `${rows.length} 行`);
  if (target) {
    /* 前提：这个名字在文件里**先以别的身份**出现（那个 Name 值），
     * 到它自己声明的地方还有一段。这条不成立的话，下面那条断言就退化成
     * "只要跳了就对"，等于没测。 */
    const nameAt = cmText().indexOf('"WidgetProps"');
    const selfAt = cmText().indexOf('"objclass": "WidgetProps"');
    ok(nameAt >= 0 && selfAt > nameAt,
      '（前提）这个名字在文件里先以别的身份出现过（否则这一节测的是空气）',
      `首次出现 ${nameAt}，它自己的 objclass 在 ${selfAt}`);
    click(target, '对象树行（名字撞车）');
    const sel = view().state.selection.main;
    let got = null;
    // 切出来不是一整段 JSON，本身就说明选错了地方 —— 这里不额外报错，交给断言说
    try { got = JSON.parse(cmText().slice(sel.from, sel.to)); } catch (e) { /* 见上 */ }
    ok(!!got && got.objclass === 'WidgetProps',
      '点名字撞车的对象：选中的那一段就是它自己，不是别处那个同名的值',
      `选中 ${sel.from}..${sel.to} -> ${got && got.objclass ? got.objclass : JSON.stringify(got)}`);
    ok(sel.to - sel.from > 20, '选中的是整段对象（不是一个字符串字面量）', `${sel.to - sel.from} 字符`);
  }
}

// ── 7. 汇总 ────────────────────────────────────────────────────────────
/* 收尾排到一个**宏任务**里，不是直接往下跑。
 *
 * 图鉴的复制走的是 Promise（navigator.clipboard 是异步 API），"已复制 …"那句
 * toast 写在 .then 里；同步代码跑到这一行时，前面那些 .then 一个都还没执行。
 * setTimeout(...,0) 是宏任务，node 会先把微任务队列排干 —— 到这儿它们都跑完了，
 * deferredChecks 里攒的那些断言才判得了。 */
setTimeout(summarize, 0);

function summarize() {
  deferredChecks.forEach(function (fn) {
    try { fn(); } catch (e) { problems.push('延后断言抛异常: ' + e.message); }
  });

  console.log('\n控制台输出');
  if (problems.length) {
    problems.slice(0, 15).forEach(p => console.log('  !!  ' + p));
  } else {
    console.log('  OK  没有未捕获的错误');
  }
  if (logs.length) {
    console.log('  --  其他输出:');
    logs.slice(0, 8).forEach(l => console.log('      ' + l));
  }

  if (failures.length) {
    console.log(`\n${failures.length} 条断言没过：`);
    failures.forEach(f => console.log('  !!  ' + f));
  }
  const fatal = loadErrors.length + (bootErr ? 1 : 0) + problems.length + failures.length;
  console.log(fatal ? `\n${fatal} 处问题` : '\n整页跑通，没有错误');
  process.exit(fatal ? 1 : 0);
}
