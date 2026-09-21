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
  const bad = click(tabs[1], '插入');
  const shown = doc.getElementById('panel-insert');
  const hiddenTree = doc.getElementById('panel-tree').hidden;
  ok(shown && !shown.hidden && hiddenTree, '点「插入」页签后两个面板正确互换',
    `insert.hidden=${shown && shown.hidden} tree.hidden=${hiddenTree}`);
  if (bad.length) console.log('      点击报错: ' + bad[0]);

  // 插入面板里该有模块分组
  const insHtml = shown.innerHTML;
  ok(insHtml.length > 200, '插入面板有内容', `${insHtml.length} 字符`);
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

// 5a. 插入一个模块
{
  const tabs = [...doc.querySelectorAll('.tabs button')];
  click(tabs[1], '插入');

  const groupHead = doc.querySelector('#panel-insert .ins-group-h');
  ok(!!groupHead, '插入面板有模块分组');
  click(groupHead, '展开分组');

  const btn = doc.querySelector('#panel-insert .ins-group-b .ins-main');
  ok(!!btn, '分组里能点到模块按钮');
  const meta = win.ZLevel.Modules.moduleGroups[0].items[0];
  ok(btn && btn.textContent.indexOf(meta.title) >= 0, '第一个按钮就是注册表里的第一个模块',
    btn && btn.textContent.slice(0, 30));

  const bad = click(btn, '插入模块');
  if (bad.length) console.log('      报错: ' + bad[0]);

  const after = cmText();
  ok(after !== blankText, '插入后编辑器文本变了', `${blankText.length} -> ${after.length} 字符`);
  ok(after.indexOf('Modules') >= 0, '文本里出现了 Modules（RTID 挂上了）');
  ok(treeCount() > treeBefore, '对象树多了行', `${treeBefore} -> ${treeCount()}`);

  const undoBtn = doc.getElementById('btn-undo');
  ok(!undoBtn.hidden, '「撤销」按钮出现了');
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
}

// 5c. 撤销是一个**栈**：连撤两次，第二次要能撤掉插入
{
  click(doc.getElementById('btn-undo'), '撤销删除');
  ok(objCount() === objsBefore + 1, '撤销一次：删掉的对象回来了', String(objCount()));
  ok(!doc.getElementById('btn-undo').hidden, '还有得撤，按钮还在');

  const before = cmText();
  click(doc.getElementById('btn-undo'), '撤销插入');
  ok(cmText() === blankText, '再撤销一次：文本回到最初', `${before.length} -> ${cmText().length}`);
  ok(doc.getElementById('btn-undo').hidden, '栈空了，撤销按钮藏起来');
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
  click(tabs[1], '插入');
  const groupHead = doc.querySelector('#panel-insert .ins-group-h');
  ok(!!groupHead, '语法错误时插入面板还在（没塌）');
  if (groupHead) click(groupHead, '展开分组');
  const insBtn = doc.querySelector('#panel-insert .ins-group-b .ins-main');
  ok(!!insBtn, '语法错误时按钮仍然可点（拒绝要发生在点之后，不能靠藏按钮）');
  const txt = cmText();
  const toast = doc.getElementById('toast');
  toast.hidden = true;
  const bad = insBtn ? click(insBtn, '语法错误时插入') : [];
  ok(cmText() === txt, '语法错误时插入被拒绝（文本没动）');
  // 只看"文本没动"是不够的 —— 抛异常也是"没动"。得看用户收到的是不是一句人话。
  // （这条是被变异测试逼出来的：把 state.js 的守卫拿掉后，插入改成抛异常，
  //   "文本没动"照样绿。）
  ok(!toast.hidden && /语法错误/.test(toast.textContent),
    '拒绝时给了提示，不是默默失败', JSON.stringify(toast.textContent));
  ok(bad.length === 0, '拒绝的过程本身没有抛异常');

  // 修好 -> 波浪线和横幅都该消失
  const v2 = view();
  v2.dispatch({ changes: { from: 0, to: v2.state.doc.length, insert: blankText } });
  ok(doc.getElementById('errbar').hidden, '修好之后横幅消失');
  ok(!doc.querySelector('.cm-lintRange'), '修好之后波浪线消失');
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
  const notes = [...tree.querySelectorAll('.node-note')];
  ok(notes.length === 0, '对象树里 0 个灰点（参考数据里查得到这些别名）',
    notes.map(w => w.title).join(' | ') || '无');
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
    const n2 = [...t2.querySelectorAll('.node-note')];
    ok(n2.length > 0, '假的 @LevelModules 别名进了灰色提示（判据是活的）',
      n2.map(w => w.title).join(' | ') || '一个都没有');
    // 而且必须是"灰"不是"红"：来源我们有数据、只是别名不在里面，属于可能拼错，
    // 上游 ReferenceRepository 的口径也是不算错误
    ok([...t2.querySelectorAll('.node-warn')].length === 0,
      '它没有被算成错误（@LevelModules 是外部来源，不算本文件的悬空引用）');
    ok(!/个失效引用/.test(doc.getElementById('statusbar').textContent),
      '状态栏也没把它算成失效引用');

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

// 5e. 主题切换。风险点是 setText 会重建 state 而 Compartment 实例要复用，
//     所以切完主题必须再做一次结构操作，确认两边都没坏。
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
  click(tabs[1], '插入');
  const gh = doc.querySelector('#panel-insert .ins-group-h');
  if (gh) click(gh, '展开分组');
  const btn = doc.querySelector('#panel-insert .ins-group-b .ins-main');
  ok(!!btn, '切主题后插入按钮还在');
  const before = cmText();
  if (btn) click(btn, '切主题后插入');
  ok(cmText() !== before, '切主题之后结构操作仍然有用（Compartment 复用没坏）');
  ok(!!doc.querySelector('.cm-editor'), '操作后编辑器还在');

  // 切回浅色
  const light = doc.querySelector('#settings .seg[data-key="theme"] button[data-val="light"]');
  if (light) click(light, '切浅色');
  ok(doc.documentElement.getAttribute('data-theme') === 'light', '能切回浅色');
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

/** 点某个面板里的所有按钮，每次现查 DOM，同一个节点只点一次。 */
function sweep(panelId, cap, expandSel) {
  // 先展开所有折叠段 —— 收着的段里的按钮用户点不到，但它们是渲染过的
  const seen = new WeakSet();
  const hit = [];
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
  // 这样校验面板才会渲染出「清理这 N 个对象」和孤儿列表
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

  // 再手改出一批**孤儿**（对象还在、没人引用）。删是删不出孤儿的 ——
  // removeObject 会级联清理，这是设计如此。孤儿只能从"引用被改没了"来，
  // 而那正是用户手改 JSON 时最常干的事，也是「清理」按钮唯一出现的情形。
  {
    const doc0 = JSON.parse(cmText());
    const victim = doc0.objects.find(o =>
      o.objclass !== 'LevelDefinition' && o.aliases && o.aliases.length);
    ok(!!victim, '找得到一个有引用的对象来制造孤儿',
      victim && victim.aliases[0]);
    if (victim) {
      const rtid = `RTID(${victim.aliases[0]}@CurrentLevel)`;
      const before = cmText();
      const after = before.split(rtid).join('RTID(LevelDefinition@CurrentLevel)');
      ok(after !== before, `把 ${rtid} 的引用改指到别处`, `${rtid}`);
      const v = view();
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: after } });
      click([...doc.querySelectorAll('.tabs button')][2], '校验页');
      ok(/清理这/.test(doc.getElementById('panel-check').textContent),
        '校验面板出现了「清理这 N 个对象」按钮');
    }
  }

  // 顺序是排过的，而且是被断言逼出来的：孤儿一被清掉/被级联删掉，
  // 「清理」按钮就不存在了。所以校验页必须**第一个**扫 —— 对象树那边点
  // node-del 时 removeObject 会级联，插入那 55 下又会把文档改得认不出来，
  // 哪个先来都会让孤儿消失，然后这一节悄没声地退化成点了个寂寞。
  const tabs = [...doc.querySelectorAll('.tabs button')];
  const plan = [
    { id: '#panel-check', tab: 2, expand: null },
    {
      id: '#panel-tree', tab: 0, expand: '.sec-head',
      // 上一段把孤儿清掉了，文档这会儿只剩一副骨架，树里一个可删的行都没有，
      // .node-del 就扫不到（覆盖率断言会当场报出来）。重新开一份有内容的。
      pre: function () {
        click(doc.getElementById('btn-templates'), '再开模板');
        const it = [...doc.querySelectorAll('#tpl-pop button')]
          .find(x => /坚不可摧/.test(x.textContent));
        if (it) click(it, '再选坚不可摧');
      }
    },
    { id: '#panel-insert', tab: 1, expand: '.ins-group-h' }
  ];
  const before = problems.length;
  const swept = {};
  plan.forEach(step => {
    if (step.pre) step.pre();
    click(tabs[step.tab], '页签 ' + (step.tab + 1));
    if (process.env.SWEEP_VERBOSE) {
      console.log('       [' + step.id + '] 按钮: ' +
        [...doc.querySelectorAll(step.id + ' button')].map(b => b.className).join(', '));
    }
    swept[step.id] = sweep(step.id, 140, step.expand);
    console.log(`       ${step.id}  点了 ${swept[step.id].length} 个按钮`);
  });
  const clicked = Object.keys(swept).reduce((a, k) => a + swept[k].length, 0);

  // 把"覆盖到哪了"也断言掉。这一节的价值全在覆盖上，而覆盖是会**悄悄失效**的：
  // 面板随文档状态重建，某个按钮不存在时就少测一条路，扫雷照样全绿。
  // 所以点名要求几个关键按钮必须真的被点到。
  for (const cls of ['node-go', 'node-del', 'sec-head', 'ins-group-h', 'ins-main']) {
    ok(swept['#panel-tree'].concat(swept['#panel-insert'], swept['#panel-check'])
      .some(c => c.indexOf(cls) >= 0), `扫到了 .${cls}`);
  }
  ok(swept['#panel-check'].some(c => /btn-fix/.test(c)),
    '扫到了校验面板的「清理」按钮（孤儿被清掉了才算真点到）');

  // 顶栏和弹层也是"点了没反应"的重灾区
  const chrome = ['btn-templates', 'btn-settings', 'btn-undo', 'btn-save', 'btn-open', 'btn-clear']
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

// ── 7. 汇总 ────────────────────────────────────────────────────────────
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
