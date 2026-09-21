/* 编辑器界面接线自检：不打开浏览器也能查出大部分"点了没反应"的错误。
 * 用法: node tools/check-editor.js
 *
 * 查的是八类事，前五节"看"代码，后三节"跑"代码：
 *   1. 语法   —— 每个 js 文件都能被解析（node --check 的等价物）
 *   2. 资源   —— index.html 里引用的文件都存在，且关键几对的顺序对
 *   3. DOM    —— JS 里 getElementById 要的每个 id，index.html 里都有
 *   4. 页签   —— data-tab="x" 对应的 panel-x 存在
 *   5. 样式   —— JS/HTML 里用到的类名，样式表里都有定义
 *   6. CM 导出 —— vendor/cm6.js 真的导出了编辑器代码要用的每个成员
 *   7. 错误定位 —— jsonpos/text/state 塞进 vm 真跑，钉死波浪线画在哪
 *   8. 加载顺序 —— 按 index.html 的顺序真加载一遍，抓"读的时候还没定义"
 *
 * 这些都是"跑起来才发现"的低级错误，但本站没有构建步骤、也没配 CI，
 * 所以只能靠这个脚本在提交前拦一道。
 *
 * 写检查时的教训：**能"事后看一眼"的断言，对加载顺序是瞎的**。
 * 第 8 节里"加载后命名空间都在"那条，顺序错了照样绿 —— 因为那时依赖早
 * 加载完了。真正管用的是 Proxy 在读的那一刻记的账（见那一节的注释）。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

let fail = 0;
function ok(cond, label, extra) {
  if (!cond) fail++;
  console.log(`  ${cond ? 'OK  ' : '!!  '}${label}${extra ? '   ' + extra : ''}`);
}

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ── 1. 语法 ───────────────────────────────────────────────────────────
console.log('语法');
function jsFiles(dir, out) {
  out = out || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // vendor 是生成物、node_modules 是依赖，都不查
      if (e.name === 'node_modules' || e.name === 'vendor') continue;
      jsFiles(p, out);
    } else if (e.name.endsWith('.js')) {
      out.push(p);
    }
  }
  return out;
}
{
  const files = jsFiles(ROOT).filter(f => !f.includes(path.sep + 'tools' + path.sep));
  let bad = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    try {
      // 只编译不执行 —— 跟 node --check 一个效果
      new vm.Script(src, { filename: f });
    } catch (e) {
      bad++;
      ok(false, path.relative(ROOT, f) + ' 语法错误', e.message);
    }
  }
  ok(bad === 0, `${files.length} 个 js 文件全部能解析`, bad ? `${bad} 个有问题` : '');
}

// ── 2. 资源存在 ───────────────────────────────────────────────────────
console.log('\n资源');
{
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
  const hrefs = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map(m => m[1]);
  ok(srcs.length > 0, `index.html 引用了 ${srcs.length} 个脚本`);
  const missing = [...srcs, ...hrefs].filter(s => !fs.existsSync(path.join(ROOT, s)));
  ok(missing.length === 0, '所有 script/link 指向的文件都存在', missing.join(', '));

  // 关卡逻辑层有加载顺序依赖：rtid 必须最先，edit 依赖 parse
  const iRtid = srcs.findIndex(s => /level\/rtid\.js$/.test(s));
  const iParse = srcs.findIndex(s => /level\/parse\.js$/.test(s));
  const iEdit = srcs.findIndex(s => /level\/edit\.js$/.test(s));
  const iOutline = srcs.findIndex(s => /level\/outline\.js$/.test(s));
  ok(iRtid >= 0 && iRtid < iParse && iParse < iEdit && iEdit < iOutline,
    '关卡逻辑层的加载顺序正确（rtid → parse → edit → outline）',
    `rtid@${iRtid} parse@${iParse} edit@${iEdit} outline@${iOutline}`);

  // vendor/cm6.js 必须排在 editor 那批之前 —— text.js 一加载就要用 window.CM
  const iCm = srcs.findIndex(s => /vendor\/cm6\.js$/.test(s));
  const iText = srcs.findIndex(s => /editor\/text\.js$/.test(s));
  ok(iCm >= 0 && iCm < iText, 'CodeMirror 在编辑器代码之前加载', `cm6@${iCm} text@${iText}`);

  // state.js 解析失败时要调 JsonPos.scan，所以 jsonpos 得排在它前面
  const iJsonPos = srcs.findIndex(s => /editor\/jsonpos\.js$/.test(s));
  const iState = srcs.findIndex(s => /editor\/state\.js$/.test(s));
  ok(iJsonPos >= 0 && iJsonPos < iState, '错误定位器在 state 之前加载',
    `jsonpos@${iJsonPos} state@${iState}`);

  /* 外部参考文件（reference/*.js，7.6 MB）。
   * refs.js 只负责读 window.ZLevel.RefData，**数据脚本放在它前面还是后面都行** ——
   * 前提是 refs.js 惰性取值（加载时不建别名集合）。唯一硬约束是数据脚本必须
   * 排在 boot() 之前，也就是在所有编辑器代码之前。
   * 顺序错了两边都不报错、页面也不白屏，只是外部引用静默回到"不判"：
   * 症状是"看起来正常但其实什么都没校验"，所以必须有断言盯着。 */
  const iRefs = srcs.findIndex(s => /level\/refs\.js$/.test(s));
  ok(iRefs >= 0 && iRefs < iOutline, 'refs.js 排在 outline 之前（outline 要用它）',
    `refs@${iRefs} outline@${iOutline}`);
  const refSrcs = srcs.map((s, i) => [s, i]).filter(([s]) => /^reference\/.*\.js$/.test(s));
  const wantRef = ['GridItemTypes', 'LevelModules', 'PlantTypes', 'PropertySheets', 'ZombieActions', 'ZombieTypes'];
  const refNames = refSrcs.map(([s]) => s.replace(/^reference\//, '').replace(/\.js$/, '')).sort();
  ok(refNames.join(',') === wantRef.join(','), `${wantRef.length} 个参考数据脚本都引了`,
    refNames.join(',') || '(一个都没有)');
  /* 判**每一个**都在 main.js 之前，不是判第一个。
   * （变异测试抓到的第一版就是这么写的：只看 Math.min，把 LevelModules 挪到
   * main.js 后面照样全绿 —— 剩下 5 个把它兜住了。） */
  const iBoot = srcs.findIndex(s => /editor\/main\.js$/.test(s));
  const lateRef = refSrcs.filter(([, i]) => i > iBoot).map(([s]) => s);
  ok(refSrcs.length > 0 && lateRef.length === 0,
    '参考数据全部排在 main.js（boot 所在）之前加载',
    lateRef.length ? lateRef.join(',') : `共 ${refSrcs.length} 个，main@${iBoot}`);
  // 7.6 MB 是同步脚本，会拖首屏。这条不是为了压体积，是为了让"又塞了一个大文件"
  // 这件事在自检里看得见，而不是等用户抱怨变慢。
  const refBytes = refSrcs.reduce((n, [s]) => {
    try { return n + fs.statSync(path.join(ROOT, s)).size; } catch (e) { return n; }
  }, 0);
  ok(refBytes > 0 && refBytes < 12 * 1024 * 1024, '参考数据总体积在预期范围内（约 7.6 MB）',
    (refBytes / 1024 / 1024).toFixed(1) + ' MB');
}

// ── 3. DOM id 对得上 ──────────────────────────────────────────────────
console.log('\nDOM id');
{
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

  const jsDir = path.join(ROOT, 'js', 'editor');
  const wanted = new Map();     // id -> 哪个文件要的
  for (const f of fs.readdirSync(jsDir)) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
    const re = /(?:BY_ID|getElementById)\(\s*'([^']+)'\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      if (!wanted.has(m[1])) wanted.set(m[1], f);
    }
    // 动态拼 id 的地方（panel-<tab>）单独查
  }
  const miss = [...wanted.keys()].filter(id => !ids.has(id));
  ok(miss.length === 0, `JS 要的 ${wanted.size} 个 id 都在 index.html 里`,
    miss.map(id => `${id}(${wanted.get(id)})`).join(', '));

  // panel-tree / panel-insert / panel-check 三个页签容器
  ['panel-tree', 'panel-insert', 'panel-check'].forEach(id => {
    ok(ids.has(id), `页签容器 ${id} 存在`);
  });
}

// ── 4. 页签与面板配对 ─────────────────────────────────────────────────
console.log('\n页签');
{
  const tabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map(m => m[1]);
  ok(tabs.length === 3, '3 个页签', tabs.join(','));
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const miss = tabs.filter(t => !ids.has('panel-' + t));
  ok(miss.length === 0, '每个 data-tab 都有对应的 panel-<tab>', miss.join(','));

  // main.js 里写死的页签名单必须跟 HTML 一致
  const main = fs.readFileSync(path.join(ROOT, 'js', 'editor', 'main.js'), 'utf8');
  const m = /\[\s*'tree'\s*,\s*'insert'\s*,\s*'check'\s*\]/.exec(main);
  ok(!!m, 'main.js 里的页签名单是 tree/insert/check');
}

// ── 5. 样式类有没有被用到（防手滑写错类名） ────────────────────────────
console.log('\n样式');
{
  const css = fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
  const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]));

  // JS 里用 el('div','a b c') / className='x' / classList 操作到的主要类名
  const used = new Set();
  const jsDir = path.join(ROOT, 'js', 'editor');
  for (const f of fs.readdirSync(jsDir)) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
    for (const m of src.matchAll(/el\(\s*'[a-z]+'\s*,\s*'([^']+)'/g)) {
      m[1].split(/\s+/).forEach(c => c && used.add(c));
    }
    for (const m of src.matchAll(/className\s*=\s*'([^']+)'/g)) {
      m[1].split(/\s+/).forEach(c => c && used.add(c));
    }
  }
  // HTML 里写死的类
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    m[1].split(/\s+/).forEach(c => c && used.add(c));
  }

  // 有些类是有意不写样式的（功能性标记、或只被 JS 查询用）
  const IGNORE = new Set(['on', 'dim', 'mono', 'grow']);
  const undef = [...used].filter(c => !defined.has(c) && !IGNORE.has(c));
  ok(undef.length === 0, `${used.size} 个用到的类名都在样式表里有定义`,
    undef.join(', '));
}

// ── 6. vendor/cm6.js 真的导出了编辑器代码要用的成员 ───────────────────
//
// 这一节是补出来的：曾经把 `CM.setDiagnostics` 写进 text.js 而没重新打包
// vendor，语法自检全绿、跑起来波浪线不出现。CM6 是打包产物，导出了什么
// 只能看产物本身，所以直接读最后那个 window.CM={...} 字面量来对账。
console.log('\nCodeMirror 导出');
{
  const bundle = fs.readFileSync(path.join(ROOT, 'vendor', 'cm6.js'), 'utf8');
  const m = /window\.CM=\{([^}]*)\}/.exec(bundle);
  ok(!!m, 'vendor/cm6.js 里有 window.CM 导出');
  const exported = new Set();
  if (m) {
    for (const kv of m[1].split(',')) {
      const k = kv.split(':')[0].trim();
      if (k) exported.add(k);
    }
  }
  ok(exported.size > 0, `导出了 ${exported.size} 个成员`, [...exported].join(' '));

  const jsDir = path.join(ROOT, 'js', 'editor');
  const want = new Map();          // 成员名 -> 哪个文件用的
  for (const f of fs.readdirSync(jsDir)) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(jsDir, f), 'utf8');
    for (const mm of src.matchAll(/\b(?:window\.)?CM\.([A-Za-z_$][\w$]*)/g)) {
      if (!want.has(mm[1])) want.set(mm[1], f);
    }
  }
  const missing = [...want.keys()].filter(k => !exported.has(k));
  ok(missing.length === 0, `编辑器用到的 ${want.size} 个 CM 成员都在打包产物里`,
    missing.map(k => `${k}(${want.get(k)})`).join(', '));

  // lintGutter 单独存在是空跑的：它只给 gutter 槽位，诊断要有人 setDiagnostics
  // 塞进去才画得出来。两者要么都有，要么都没有。
  const textSrc = fs.readFileSync(path.join(jsDir, 'text.js'), 'utf8');
  const hasGutter = /CM\.lintGutter\s*\(/.test(textSrc);
  const hasSet = /CM\.setDiagnostics\s*\(/.test(textSrc);
  ok(hasGutter === hasSet, 'lintGutter 与 setDiagnostics 成对出现（只装 gutter 是空跑）',
    `lintGutter=${hasGutter} setDiagnostics=${hasSet}`);

  // setDiagnostics 的签名是 (state, diagnostics)，少传第一个参数 effect 会被丢掉
  if (hasSet) {
    ok(/CM\.setDiagnostics\s*\(\s*view\.state\s*,/.test(textSrc),
      'setDiagnostics 有传 state（少了它 lint 扩展没装就整个失效）');
  }
}

// ── 7. 解析错误定位（真的跑一遍，不是看代码） ─────────────────────────
//
// jsonpos.js / text.js / state.js 都不碰 DOM，可以塞进 vm 里真跑。
// 这三个模块凑成的正是"手滑时波浪线画在哪、说什么"这条链路 ——
// 错了用户在界面上看到的就是误导，所以值得逐个位置钉死。
console.log('\n解析错误定位');
{
  const ctx = { window: { ZEditor: {} }, console };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  for (const f of ['js/editor/jsonpos.js', 'js/editor/text.js', 'js/editor/state.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  const JsonPos = ctx.window.ZEditor.JsonPos;
  const Text2 = ctx.window.ZEditor.Text;
  const State = ctx.window.ZEditor.State;

  // 扫描器：位置要精确到字符，话要说得像人话
  //   文本                          出错下标   消息里必须有的词
  const CASES = [
    // 最常见的手滑：括号对不上 / 内容断了 —— V8 对这两种**不给位置**
    ['{"objects": [}', 13, '值'],
    ['{"objects": [', 13, '没有收尾的 ]'],
    ['{', 1, '没有收尾的 }'],
    ['{"a": 1', 7, '没有收尾的 }'],
    ['{"objects": [1,]}', 15, '多了一个逗号'],
    ['{"a": 1,}', 8, '多了一个逗号'],
    ['{"a" 1}', 5, '冒号'],
    ['{a: 1}', 1, '双引号'],
    ['{"a": "x}', 9, '收尾的双引号'],
    ['{"a": 1} trailing', 9, '多余'],
    // 拼错的关键字：指在词首（`t`），不是词里
    ['{"a": tru}', 6, 'true'],
    ['{"a": 01}', 7, ', 或者 }'],
    ['{"a": 1 "b": 2}', 8, ', 或者 }'],
    ['{"a": "b\nc"}', 8, '换行'],
    // 指在坏掉的那个字符（`q`）上，不是反斜杠上
    ['{"a": "\\q"}', 8, '不是有效的转义']
  ];
  let bad = 0, detail = [];
  for (const [text, wantPos, wantWord] of CASES) {
    const got = JsonPos.scan(text);
    if (!got) { bad++; detail.push(`${JSON.stringify(text)} -> 扫描器说合法`); continue; }
    if (got.pos !== wantPos) { bad++; detail.push(`${JSON.stringify(text)} 位置 ${got.pos}≠${wantPos}`); }
    if (got.message.indexOf(wantWord) < 0) { bad++; detail.push(`${JSON.stringify(text)} 消息缺「${wantWord}」: ${got.message}`); }
  }
  ok(bad === 0, `${CASES.length} 个手滑样本的位置与说法都对`, detail.slice(0, 3).join(' | '));

  // 合法文本不该被报错（扫描器只在 parse 失败后才跑，但自己不能有假阳性）
  const GOOD = [
    '{"objects": []}',
    '{"a": [1, -2.5, 3e10, 0.5e-3], "b": {"c": null}, "d": [true, false]}',
    '{\n  "s": "带\\n转义和 \\u4e2d\\u6587 的字符串",\n  "t": ""\n}',
    '   [1, 2, 3]   '
  ];
  const fp = GOOD.filter(t => JsonPos.scan(t));
  ok(fp.length === 0, `${GOOD.length} 份合法 JSON 没有误报`,
    fp.map(t => JSON.stringify(t) + '->' + JSON.stringify(JsonPos.scan(t).message)).join(' | '));

  // 扫描器和 JSON.parse 的判断必须一致：合法/不合法不能各说各话
  const agree = [];
  for (const t of [...CASES.map(c => c[0]), ...GOOD]) {
    let parsesOk = true;
    try { JSON.parse(t); } catch (e) { parsesOk = false; }
    if (parsesOk !== !JsonPos.scan(t)) agree.push(JSON.stringify(t));
  }
  ok(agree.length === 0, '扫描器与 JSON.parse 的合法/不合法判断一致', agree.join(', '));

  // 整条链路：state 解析失败 -> text 算出标注区间
  const S = State.create();
  S.load('{"objects": [}', 'x.json', 'file');
  const pe = S.get().parseError;
  ok(!!pe, 'state 记下了解析错误');
  ok(pe.pos === 13, 'state 记的是扫描器给的位置（不是引擎说的 0）', `pos=${pe.pos}`);
  ok(/is not valid JSON/.test(pe.engine || ''), 'state 同时留着引擎原文给 title 用');

  const d = Text2.diagnosticOf(pe, 14);
  ok(!!d && d.from === 13 && d.to === 14, 'text 把错误转成标注区间', d && JSON.stringify(d));
  ok(d && d.severity === 'error', '标注级别是 error');

  // 文末出错：区间必须还在文档内，且不能是零长度（CM 会把零长度画成小圆点）
  const dEnd = Text2.diagnosticOf({ pos: 14, len: 1, message: 'x' }, 14);
  ok(dEnd.from === 13 && dEnd.to === 14, '出错点在文末时区间退一格', JSON.stringify(dEnd));
  ok(!Text2.diagnosticOf({ pos: 0, len: 1, message: 'x' }, 0), '空文本不产生标注');
  ok(!Text2.diagnosticOf(null, 100), '没有错误时不产生标注');

  // 引擎原文是英文（扫描器没兜住的情况）时，翻译要接得上
  const ZH = [
    ['Unexpected end of JSON input', '不完整'],
    ['Unterminated string in JSON at position 9', '双引号'],
    ['Expected property name or \'}\' in JSON at position 1', '属性名'],
    ['Bad control character in string literal in JSON at position 8', '控制字符'],
    ['Unexpected token \'}\', "{"objects": [}" is not valid JSON', '多了一个 }'],
    ['Something nobody predicted', 'Something nobody predicted']
  ];
  const zhBad = ZH.filter(([en, want]) => Text2.zhError(en).indexOf(want) < 0)
    .map(([en]) => en + ' -> ' + Text2.zhError(en));
  ok(zhBad.length === 0, `${ZH.length} 条引擎报错都能翻成人话（翻不动就原样留着）`, zhBad.join(' | '));
  // 扫描器给的中文不该被翻译规则二次加工
  ok(Text2.zhError('这个对象没有收尾的 }') === '这个对象没有收尾的 }', '中文消息原样通过');
}

// ── 8. 按 index.html 的顺序真加载一遍 ─────────────────────────────────
//
// 前面几节都是"看"代码，这一节是"跑"代码：把 index.html 里的 <script>
// 按**实际顺序**在一个 vm 里执行一遍（给一个最小 DOM 桩），任何一句在模块
// 顶层就抛异常都会被抓到。
//
// 抓的主要是加载顺序错：main.js 开头就 `var Edit = window.ZLevel.Edit;`，
// 要是 edit.js 排在它后面，Edit 就是 undefined —— 界面上每个"插入"按钮
// 都点了没反应，而且不报错。静态检查只钉了几对已知依赖，这里是全序验证。
//
// ⚠ 顺序错**不能靠"全部加载完之后再看一眼"**：那时候 edit.js 早加载完了，
// ZLevel.Edit 好好地在，断言全绿而 bug 还在（main.js 抓到的是它自己那个
// undefined 快照）。所以这里给两个命名空间套 Proxy，在**读的那一刻**记账：
// 谁读到了 undefined 就记一条。下面对 earlyReads 的断言才是真正管用的那条。
//
// 注意 boot() 不会执行（桩里 document.readyState 是 loading，只会注册
// DOMContentLoaded 回调），所以这里查的是"加载得起来"，不是"跑得对"。
console.log('\n按 HTML 顺序加载');
{
  const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);

  function stubEl() {
    const e = {
      style: {}, dataset: {}, hidden: false, value: '', textContent: '',
      className: '', title: '', type: '', placeholder: '', disabled: false,
      files: [], children: [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      appendChild(c) { e.children.push(c); return c; },
      removeChild() {}, insertBefore() {}, click() {}, focus() {}, blur() {},
      addEventListener() {}, removeEventListener() {}, stopPropagation() {},
      setAttribute() {}, getAttribute: () => null, removeAttribute() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
      querySelector: () => null, querySelectorAll: () => [],
      closest: () => null, contains: () => false,
      cloneNode() { return stubEl(); }
    };
    return e;
  }

  const doc = {
    readyState: 'loading',                 // 关键：boot() 因此不会执行
    documentElement: stubEl(), body: stubEl(), head: stubEl(),
    addEventListener() {}, removeEventListener() {},
    getElementById: () => stubEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => stubEl(),
    createTextNode: () => stubEl(),
    createDocumentFragment: () => stubEl()
  };

  const win = {
    ZEditor: {}, ZLevel: {},
    // text.js 只在 create() 里用 CM，加载期不碰；给个空对象占位
    CM: {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { href: 'file:///index.html', search: '' },
    navigator: { userAgent: 'node' },
    innerWidth: 1200, innerHeight: 800,
    setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0,
    confirm: () => true, alert() {}, addEventListener() {},
    FileReader: function () {}, Blob: function () {}, URL: { createObjectURL: () => '', revokeObjectURL() {} },
    console
  };
  // 浏览器里 window 的属性和全局变量是同一个东西（`Codex.add(...)` 和
  // `window.Codex.add(...)` 等价，data/ch-*.js 两种都用了）。所以桩也得这样：
  // sandbox 自己当 window，而不是把 window 塞成它的一个属性 ——
  // 后者会让裸标识符 `Codex` 找不到。
  const sandbox = Object.assign({}, win, {
    document: doc, console,
    setTimeout: () => 0, clearTimeout() {},
    JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error,
    isNaN, parseInt, parseFloat
  });
  sandbox.window = sandbox;

  // 监视名单：真正会被 main.js 抓成局部变量的那些模块。命名空间自己
  // （ZLevel / ZEditor）不在名单里 —— 每个文件开头的 `window.ZEditor = window.ZEditor || {}`
  // 就是故意读 undefined 的自举写法，算进去会满屏误报。
  /* Refs 在名单里：它是个模块，加载期不该被谁抓成局部量。
   *
   * RefData **故意不在**名单里。它是数据容器不是模块，而每个 reference/*.js 开头
   * 都写 `window.ZLevel.RefData = window.ZLevel.RefData || {}` —— 那是一次
   * **合法的** undefined 读，跟 ZLevel / ZEditor 自己的自举写法同一个道理
   * （上面那段注释已经解释过为什么命名空间本身不算）。放进来会必然误报。
   *
   * 「refs.js 有没有在加载期就把 RefData 抓成局部量」这个真问题由**功能断言**兜：
   * 加载完之后查一个真实别名（LevelModules 里的 StandardIntro）。加载期抓的话
   * 抓到的是 undefined，后面永远查不到东西，那条断言必红。
   * 变异测试验过：给 refs.js 加 `var RefData = window.ZLevel.RefData;` 确实会红。 */
  const WATCHED = ['Rtid', 'Order', 'Parse', 'Conflicts', 'Edit', 'Outline', 'Refs',
    'State', 'Text', 'Tree', 'Panels', 'Templates', 'Skeletons', 'Modules'];

  let loading = '';                        // 当前正在加载哪个脚本
  const earlyReads = [];
  function watch(ns) {
    return new Proxy(ns, {
      get(t, k) {
        const v = t[k];
        if (v === undefined && WATCHED.indexOf(k) >= 0) {
          earlyReads.push(`${loading} 里读 ${String(k)}（当时还没定义）`);
        }
        return v;
      }
    });
  }
  sandbox.ZLevel = watch(sandbox.ZLevel);
  sandbox.ZEditor = watch(sandbox.ZEditor);

  vm.createContext(sandbox);
  const win2 = sandbox;                    // 后面断言用这个

  const threw = [];
  for (const s of srcs) {
    if (/^https?:/.test(s)) continue;
    let code;
    try { code = fs.readFileSync(path.join(ROOT, s), 'utf8'); }
    catch (e) { threw.push(`${s}: 读不到`); continue; }
    loading = s;
    try {
      vm.runInContext(code, sandbox, { filename: s });
    } catch (e) {
      threw.push(`${s}: ${e.message}`);
    }
  }
  loading = '';
  ok(threw.length === 0, `${srcs.length} 个脚本按 HTML 顺序加载都没在顶层抛异常`,
    threw.slice(0, 3).join(' | '));

  // 这条才是真正管加载顺序的：上面那两条事后断言，顺序错了也照样绿。
  ok(earlyReads.length === 0, '没有脚本在依赖还没加载时就去读它（加载顺序正确）',
    earlyReads.slice(0, 3).join(' | '));

  // 加载完之后，界面代码要用的那几个命名空间必须真的在
  const NS = [
    ['window.ZLevel.Edit', win2.ZLevel && win2.ZLevel.Edit],
    ['window.ZLevel.Parse', win2.ZLevel && win2.ZLevel.Parse],
    ['window.ZLevel.Outline', win2.ZLevel && win2.ZLevel.Outline],
    ['window.ZLevel.Conflicts', win2.ZLevel && win2.ZLevel.Conflicts],
    ['window.ZLevel.Refs', win2.ZLevel && win2.ZLevel.Refs],
    /* RefData 是数据不是模块，存在性单独断言。它**不是**可选的装饰：
     * 少了它外部引用会静默回到"不判"，页面一切正常、只是什么都不校验。
     * 所以这里不光看它在不在，还核一个真实的别名。 */
    ['window.ZLevel.RefData', win2.ZLevel && win2.ZLevel.RefData],
    ['window.ZLevel.Templates', win2.ZLevel && win2.ZLevel.Templates],
    ['window.ZLevel.Skeletons', win2.ZLevel && win2.ZLevel.Skeletons],
    ['window.ZLevel.Modules', win2.ZLevel && win2.ZLevel.Modules],
    ['window.ZEditor.State', win2.ZEditor && win2.ZEditor.State],
    ['window.ZEditor.Text', win2.ZEditor && win2.ZEditor.Text],
    ['window.ZEditor.Tree', win2.ZEditor && win2.ZEditor.Tree],
    ['window.ZEditor.Panels', win2.ZEditor && win2.ZEditor.Panels],
    ['window.Codex', win2.Codex],
    ['window.CodexSearch', win2.CodexSearch]
  ];
  const gone = NS.filter(([, v]) => !v).map(([k]) => k);
  ok(gone.length === 0, `加载后 ${NS.length} 个命名空间都在`, gone.join(', '));

  // 参考数据在不在、活着没有。只断言"对象存在"不够 —— 空对象也能过，
  // 而空对象的表现恰好跟"没加载"一模一样（外部引用一律不判）。
  {
    const R = win2.ZLevel && win2.ZLevel.Refs;
    const d = win2.ZLevel && win2.ZLevel.RefData;
    const names = d ? Object.keys(d).sort() : [];
    ok(names.length === 6, '6 个参考来源的数据都加载了', names.join(',') || '(空)');
    ok(!!(R && R.aliases('LevelModules') && R.aliases('LevelModules').has('StandardIntro')),
      '参考数据真的能用（LevelModules 里查得到 StandardIntro）');
  }

  // main.js 顶层就把这几个抓成了局部变量（见它开头那几行）。顺序错了这里就是
  // undefined，而且要到用户点按钮时才炸 —— 所以正面钉一下类型。
  const TYPES = [
    ['ZLevel.Edit.insertModule', win2.ZLevel && win2.ZLevel.Edit && typeof win2.ZLevel.Edit.insertModule],
    ['ZLevel.Outline.build', win2.ZLevel && win2.ZLevel.Outline && typeof win2.ZLevel.Outline.build],
    ['ZLevel.Refs.aliases', win2.ZLevel && win2.ZLevel.Refs && typeof win2.ZLevel.Refs.aliases],
    ['ZLevel.Parse.classifyRef', win2.ZLevel && win2.ZLevel.Parse && typeof win2.ZLevel.Parse.classifyRef],
    ['ZEditor.Text.create', win2.ZEditor && win2.ZEditor.Text && typeof win2.ZEditor.Text.create],
    ['ZEditor.Text.diagnosticOf', win2.ZEditor && win2.ZEditor.Text && typeof win2.ZEditor.Text.diagnosticOf],
    ['ZEditor.State.create', win2.ZEditor && win2.ZEditor.State && typeof win2.ZEditor.State.create],
    ['Codex.chapters', win2.Codex && typeof win2.Codex.chapters]
  ];
  const notFn = TYPES.filter(([k, t]) => k === 'Codex.chapters' ? t === 'undefined' : t !== 'function')
    .map(([k, t]) => `${k}=${t}`);
  ok(notFn.length === 0, '界面要调用的入口函数都到位了', notFn.join(', '));
}

console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
