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

/** 抠出某个 @media 的**整段 body**（含嵌套规则，靠数括号配对，不是正则到第一个 `}`）。
 *
 *  为什么非得配对：`[^}]*` 那种写法在**嵌套的** @media 上会截在半路，于是断言看着
 *  在查这一段、其实只查了头几条规则 —— 一条永远绿的假断言。
 *  找不到就返回 null，由调用方自己报红，不静默通过。 */
function mediaBlock(css, query) {
  const at = css.indexOf('@media (' + query + ')');
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return null;                       // 括号不配对
}

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
  // boot() 所在，好几条"必须排在它前面"的断言都拿它当右端点
  const iBoot = srcs.findIndex(s => /editor\/main\.js$/.test(s));
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

  // report.js 把 outline / parse / conflicts 合成一份体检报告，三者都得先在
  const iReport = srcs.findIndex(s => /level\/report\.js$/.test(s));
  ok(iReport > iOutline, 'report.js 排在 outline 之后（体检报告要用它）',
    `outline@${iOutline} report@${iReport}`);

  /* codex-panel.js 在**加载期**读 window.ZEditor.Panels.el，所以必须夹在
   * panels.js 和 main.js 中间。这个顺序错了不会报错也不会白屏：el 是 undefined，
   * 直到用户点「图鉴」页签才炸 —— 正是"页面在、点谁都没反应"那类事故。 */
  const iPanels = srcs.findIndex(s => /editor\/panels\.js$/.test(s));
  const iCodex = srcs.findIndex(s => /editor\/codex-panel\.js$/.test(s));
  ok(iPanels >= 0 && iCodex > iPanels && iCodex < iBoot,
    'codex-panel.js 夹在 panels.js 与 main.js 之间（它加载期就要 Panels.el）',
    `panels@${iPanels} codex-panel@${iCodex} main@${iBoot}`);

  /* module-panel.js 同理：加载期读 window.ZEditor.Panels.el。这条跟上面那条是
   * **两个**断言不是一条 —— 合起来写的话，其中一个排错时另一个的标签也跟着红，
   * 变异测试就分不清是哪一处坏了，而且已有变异（M1a/M1b）钉的是上面那条的标签。 */
  const iModule = srcs.findIndex(s => /editor\/module-panel\.js$/.test(s));
  ok(iModule >= 0 && iModule > iPanels && iModule < iBoot,
    'module-panel.js 夹在 panels.js 与 main.js 之间（它加载期就要 Panels.el）',
    `panels@${iPanels} module-panel@${iModule} main@${iBoot}`);

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

  // 三个页签容器，外加对象栏里那两个静态子节点（#sum 汇总条 + #tree-host 树）
  ['panel-tree', 'panel-modules', 'panel-codex', 'sum', 'tree-host'].forEach(id => {
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
  const m = /\[\s*'tree'\s*,\s*'modules'\s*,\s*'codex'\s*\]/.exec(main);
  ok(!!m, 'main.js 里的页签名单是 tree/modules/codex');
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

  /* `hidden` 属性必须真的藏得住 —— 这条只能在样式表上看，**没法动态测**。
   *
   * 用户报过："没有语法错误时顶上还是会出现一块红框，修改后报错文本也不会消失"。
   * 根因是浏览器默认样式表里那条 `[hidden] { display: none }` 属于 UA 来源，
   * 而**作者样式表里任何一条设了 display 的规则都能盖掉它**（来源优先级压过
   * 选择器优先级）——`.errbar { display: flex }` 一写，`bar.hidden = true` 就
   * 成了摆设：元素照样占着位置、照样是红的。
   *
   * 为什么不在 check-boot 里用 getComputedStyle 测：**测不出来**。写了个 jsdom
   * 探针试过 —— 它自己认 hidden 属性，样式表坏掉时 getComputedStyle 照样报
   * "none"。也就是说这个 bug 在 jsdom 里 100% 隐身，只有静态读样式表才抓得住。
   * 改这条断言前先想想是不是在拆掉唯一的防线。
   *
   * `^` 加 m 标志是为了只认**行首**的那条规则：上面注释里也引了
   * `[hidden] { display: none }` 这句（没有 !important），不加锚点会认错。 */
  const hiddenRule = /^\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/m.test(css);
  ok(hiddenRule, '[hidden] 上有一条 display:none !important（否则 .errbar 那类规则会盖掉它）');

  // 置灰按钮的样子：撤销/重做常驻，不可用时靠 :disabled 变灰而不是藏起来
  ok(/\.btn:disabled\s*\{/.test(css), '样式表里有 .btn:disabled（置灰按钮的样子）');

  /* 图鉴浮层的排列密度三档。**只能静态读样式表**，两个理由：
   *
   *   1. 上面那道类名闸门只扫 `el('tag','cls')` 和 `className='…'`，而密度档位是
   *      挂在 dataset（`data-density`）上的，闸门**抓不到**。
   *   2. jsdom 不做排版，字号和列宽量不出来 —— 动态测只能测到"属性挂上了"，
   *      测不到"挂上之后真的换了挡"。
   *
   * 断言的不是"这三条规则存在"：空块 `[data-density="tight"] { }` 也能过。
   * 要的是每一档**都真的在换 --cx-\* 的挡**，而且这些 token 真的被用上了
   * （定义了没人用 = 没定义）。标准档没有自己的块 —— 它就是浮层上那组基准值
   * （JS 那边 applyDensity() 把属性删掉，回落到基准），所以基准那组单独钉。 */
  /* ⚠ 要**全局**扫再挑带 token 的那一块：`.codex-modal` 在样式表里出现两次
   * （先是布局那一大块，再是这些 token），只取第一处会永远抓不到。 */
  let baseToks = [];
  for (const b of css.matchAll(/\.codex-modal\s*\{([^}]*)\}/g)) {
    const t = [...b[1].matchAll(/--cx-[\w-]+\s*:/g)];
    if (t.length) baseToks = t;
  }
  ok(baseToks.length === 4,
    '浮层上定义了 --cx-* 基准值（标准档没有自己的块，靠这组兜底）',
    baseToks.map(t => t[0]).join(' '));
  for (const tier of ['loose', 'tight']) {
    const blk = new RegExp(`\\.codex-modal\\[data-density="${tier}"\\]\\s*\\{([^}]*)\\}`).exec(css);
    const toks = blk ? [...blk[1].matchAll(/--cx-[\w-]+\s*:/g)] : [];
    ok(!!blk && toks.length === 4,
      `[data-density="${tier}"] 那一档真的在换 --cx-* 的挡`,
      blk ? toks.map(t => t[0]).join(' ') : '样式表里没有这条规则');
  }
  ok(/\.codex-item\s*\{[^}]*font-size\s*:\s*var\(--cx-fs\)/.test(css) &&
    /\.codex-item\s*\{[^}]*padding\s*:\s*var\(--cx-py\)/.test(css),
    '条目行的字号和行距走 token（不走的话切档只动列宽，行本身没反应）');
  ok(/grid-template-columns\s*:\s*repeat\(auto-fill,\s*minmax\(var\(--cx-col\)/.test(css),
    '列表的列宽走 --cx-col');

  /* 目录索引跳转算的是 `headerEl.offsetTop - out.offsetTop`，而 offsetTop 相对最近的
   * **定位**祖先 —— .codex-out 上少了 position:relative，offsetTop 就相对 body，
   * 跳的位置整个是错的。这条在 jsdom 里**测不出来**（它根本不做排版，offsetTop 恒 0），
   * 所以只能静态钉。 */
  ok(/\.codex-out\s*\{[^}]*position\s*:\s*relative/.test(css),
    '.codex-out 上有 position:relative（目录跳转的 offsetTop 相对它算）');

  /* 宽屏（基础规则）里那一列目录**必须是收起来的**。
   *
   * 用户这轮点名的：「宽屏状态下浮窗里不需要次级目录显示了，因为和侧边栏作用一样」——
   * 侧栏那三级目录（类别 › 大类 › 次级项）排的就是同一份东西。
   *
   * 实现是"元素照建、CSS 收掉"（见 codex-panel.js「JS 只管行为，宽度只管样式」那段），
   * 所以这条**只能静态读样式表** —— jsdom 不求值 media query，"宽屏下看得见吗"在无头
   * 环境里没有观测面。窄屏那条 `display:flex` 由下面那段 + check-boot 的 10b 一处管。
   *
   * ⚠ 取的是**第一条** `.codex-midx { … }`，也就是基础规则；窄屏断点里那条靠后。
   * 这个先后顺序是**承重的**：窄屏断点必须排在基础规则后面，它那句 display:flex 才
   * 压得住 display:none。反过来写的话宽屏倒是收掉了，窄屏也跟着一起没 —— 用户报过的
   * 那个毛病原样回来。所以顺带把顺序也钉住。 */
  const baseIdx = /\.codex-midx\s*\{[^}]*\}/.exec(css);
  ok(!!baseIdx && /display\s*:\s*none/.test(baseIdx[0]),
    '宽屏（基础规则）里 .codex-midx 是 display:none（用户点名宽屏不要再显示目录列）',
    baseIdx ? baseIdx[0].replace(/\s+/g, ' ').slice(0, 90) : '样式表里没有这条规则');
  {
    /* 基础规则的位置 < 窄屏那个 @media 的位置。取 `.codex-midx {` 那一处（不是
       baseIdx 的 index —— exec 不给 index，得自己找），跟 @media 的开头比。 */
    const at = css.indexOf('@media (max-width: 939px)');
    const pos = css.search(/\.codex-midx\s*\{/);
    ok(at > 0 && pos > 0 && pos < at,
      '基础规则排在窄屏断点前面（反过来的话窄屏那句 display:flex 压不住，两边一起没）',
      `基础规则 @${pos}，窄屏断点 @${at}`);
  }

  /* 窄屏抽屉必须**贯通到底**，不能从顶栏下面开始。
   *
   * 「侧栏顶上留了一条空白，像没加载完」这个毛病用户报过**两次**：先是宽屏
   * （那时侧栏住在"topbar 下面那一行"里，见 css/app.css 的骨架注释），改完宽屏
   * 之后窄屏抽屉还留着 `top: var(--topbar-h)` —— 同一句话换了个断点又报了一次。
   * 所以这条钉在样式表上。
   *
   * 为什么只能在样式表上看：jsdom 不做排版，getComputedStyle 也拿不到
   * `position: fixed` 的实际盒子，"抽屉顶上有没有那 50px"在无头环境里完全没有
   * 观测面。改这条断言前先想想是不是在拆掉唯一的防线。 */
  const drawer = mediaBlock(css, 'max-width: 939px');
  const drawerSidebar = drawer && /\.sidebar\s*\{[^}]*\}/.exec(drawer);
  ok(!!drawerSidebar, '窄屏断点里定义 .sidebar 抽屉');
  if (drawerSidebar) {
    const body = drawerSidebar[0];
    ok(/top\s*:\s*0\s*[;}]/.test(body),
      '窄屏抽屉顶到 0（从顶栏下面起的话顶上会空一条 50px，像没加载完）',
      body.replace(/\s+/g, ' ').slice(0, 90));
    ok(/bottom\s*:\s*0\s*[;}]/.test(body),
      '窄屏抽屉底到 0（上下都顶住才叫贯通到底）',
      body.replace(/\s+/g, ' ').slice(0, 90));
  }

  /* 窄屏下目录**在**，而且是横滑的一条 —— 宽屏收起来之后，这里就是它唯一的形态。
   *
   * 用户报的「图鉴浮框的分类目录窄屏不可见」是更早的一版：那时窄屏断点里写着
   * `.codex-midx { display: none }`。理由（浮层只有一屏宽，168px 给目录不如给条目）
   * 成立、结论不成立 —— 整条藏掉之后 1048 条的类别只能硬滚，而目录正是那时候最需要
   * 的东西。窄屏侧栏还是收着的抽屉，顶上这条 chip 是唯一还看得见的分组导航。
   *
   * 为什么只能静态钉：jsdom 不做排版，**也不求值 media query**，"窄屏下长什么样"
   * 在无头环境里没有观测面。横条那三个行为由 check-boot 动态钉（见那里 10b 一节），
   * 两条防线互不掩护。 */
  const narrowIdx = drawer && /\.codex-midx\s*\{[^}]*\}/.exec(drawer);
  ok(!!narrowIdx, '窄屏断点里定义 .codex-midx');
  if (narrowIdx) {
    const body = narrowIdx[0];
    ok(!/display\s*:\s*none/.test(body),
      '窄屏的目录不是 display:none（整条藏掉就是用户报的那个毛病本身）',
      body.replace(/\s+/g, ' ').slice(0, 90));
    ok(/display\s*:\s*flex/.test(body) && /overflow-x\s*:\s*auto/.test(body),
      '窄屏的目录是一条横向滚动的条子（不是竖列，也不是收起来）',
      body.replace(/\s+/g, ' ').slice(0, 90));
  }
  const narrowBody = drawer && /\.codex-mbody\s*\{[^}]*\}/.exec(drawer);
  ok(!!narrowBody && /flex-direction\s*:\s*column/.test(narrowBody[0]),
    '窄屏把 .codex-mbody 改成上下两行（条子在列表上面）',
    narrowBody ? narrowBody[0].replace(/\s+/g, ' ').slice(0, 90) : '样式表里没有这条规则');
  const narrowOut = drawer && /\.codex-out\s*\{[^}]*\}/.exec(drawer);
  ok(!!narrowOut && /min-height\s*:\s*0/.test(narrowOut[0]),
    '窄屏的 .codex-out 带 min-height:0（column 下少了它列表滚不动，整块溢出浮层）',
    narrowOut ? narrowOut[0].replace(/\s+/g, ' ').slice(0, 90) : '样式表里没有这条规则');
  ok(/\.codex-midx\.can-left/.test(drawer) && /\.codex-midx\.can-right/.test(drawer),
    '条子藏了滚动条，两侧渐隐就在窄屏断点里（「右边还有分组」只有这一个提示）');
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

  // ── 撤销/重做的接线契约 ──
  //
  // 这几条是**静的**，为的是补 check-boot 那几条**动**的断言的漏洞：
  // "打字后插模块，撤两次一次退一步"靠的是 CM 的分组窗口（newGroupDelay 500ms）
  // —— 两条命令只要间隔超过 500ms 就会自然分成两组，于是没写 isolateHistory
  // 也照样绿。jsdom 里跑得飞快所以测得住，但那是个环境假设，不是保证。
  // 这四条直接钉住"该写的都写了"，环境再慢也塌不了。
  ok(/CM\.isolateHistory\.of\(\s*'full'\s*\)/.test(textSrc),
    "结构操作写回带了 isolateHistory.of('full')（少了它一次撤销退两步）");
  ok(/isUserEvent\(\s*'undo'\s*\)/.test(textSrc) && /isUserEvent\(\s*'redo'\s*\)/.test(textSrc),
    'updateListener 用 isUserEvent 区分撤销 / 重做（不然重做会被当成新打字）');
  ok(/CM\.undoDepth\s*\(/.test(textSrc) && /CM\.redoDepth\s*\(/.test(textSrc),
    '撤销 / 重做的可用性是问 CM 要的，不是自己数的');

  // state.js 交出了撤销的所有权：快照栈必须彻底消失，不然两套历史会各说各话。
  // 查之前先去注释 —— 注释里偏偏会提到被删掉的那些名字（那正是它该干的事），
  // 直接搜会连注释一起搜到。这是个粗糙的剥离器（不认字符串里的 //），
  // 用在这里够了：state.js 里没有 URL。
  const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const stateCode = stripComments(fs.readFileSync(path.join(jsDir, 'state.js'), 'utf8'));
  ok(!/undoStack|MAX_UNDO|canUndo|undoLabel/.test(stateCode),
    'state.js 的代码里不再有撤销快照 / 可撤销判断（历史只有 CM 那一条）');
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

  // ── 历史标签同步（Text.syncLabels） ──
  //
  // 它维护的是"第 i 条可撤销事件叫什么"，错位了的表现是撤销按钮的提示语
  // 写着另一个操作的名字。抽成纯函数就是为了能在这个裸 vm 里逐个用例钉死
  // —— 这边没有 window.CM，跑不了真编辑器。
  //
  // 不变量：labels.length === undoDepth，深度 d 的标签落在 labels[d-1]。
  {
    const S = Text2.syncLabels;
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    // 普通追加
    let r = S([], '', 'edit', 1, 0);
    ok(eq(r.labels, ['']) && r.pending === '', '第一条历史：空标签落进 labels[0]',
      JSON.stringify(r.labels));
    r = S(r.labels, '插入', 'edit', 2, 1);
    ok(eq(r.labels, ['', '插入']) && r.pending === '', '第二条追加在后面', JSON.stringify(r.labels));

    // 撤销 / 重做只是移动指针，标签一个都不能动 —— 动了的话重做之后名字就没了
    r = S(['', '插入'], 'x', 'undo', 1, 2);
    ok(eq(r.labels, ['', '插入']), '撤销不动标签（只是指针退了）', JSON.stringify(r.labels));
    r = S(['', '插入'], '', 'redo', 2, 1);
    ok(eq(r.labels, ['', '插入']), '重做也不动标签', JSON.stringify(r.labels));

    // 撤销之后又打字 -> 那条重做分支作废，它的标签也必须跟着丢。
    // 注意 prevDepth 是 1 而不是 3：撤销那一下会把 prevDepth 一起带到新深度
    // （syncFrom 里无条件更新），所以这一步落在"深度涨了"那一支上。
    // 只覆盖最后一个是不够的 —— 这是"截尾巴"，截多长由深度差决定。
    r = S(['a', 'b', 'c'], 'x', 'edit', 2, 1);
    ok(eq(r.labels, ['a', 'x']), '撤销后打字：多出来的旧标签被截掉（不只是覆盖最后一个）',
      JSON.stringify(r.labels));

    // 撞上 CM 的历史深度上限：最老的几条是从**前面**被丢掉的，标签得整体左移。
    // 实测 basicSetup 下 120 条时一次性丢 19 条（depth 120 -> 102），
    // 按"从尾巴截"写会从那一刻起整体错位，且每撞一次上限就多错一次。
    r = S(['a', 'b', 'c', 'd'], 'x', 'edit', 2, 4);
    ok(eq(r.labels, ['d', 'x']), '撞上限时从前面丢，标签跟着左移（不是从尾巴截）',
      JSON.stringify(r.labels));

    // depth < 1：给 length 赋 -1 会抛 "Invalid array length"，守卫不能省
    let threw = '';
    try { S(['a'], 'x', 'edit', 0, 1); } catch (e) { threw = e.message; }
    ok(threw === '', 'depth 为 0 时不抛异常（length 不能赋 -1）', threw);

    // 纯函数：不许改传进来的那个数组（labels 是 create() 闭包里的那个）
    const orig = ['a'];
    S(orig, 'x', 'edit', 2, 1);
    ok(orig.length === 1 && orig[0] === 'a', '不改传进来的数组', JSON.stringify(orig));

    // 深度比标签还多（状态错位）：长度要跟深度对齐，不能少
    r = S([], 'x', 'edit', 3, 0);
    ok(r.labels.length === 3 && r.labels[2] === 'x', '标签不够时按深度补齐长度',
      JSON.stringify(r.labels));
  }
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
    ['window.ZLevel.Spans', win2.ZLevel && win2.ZLevel.Spans],
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
    /* CodexPanel / ModulePanel 在**加载期**读 Panels.el，所以它们存在本身就顺带
     * 证明了 panels.js 排在它们前面（排反了这里是 undefined，见资源段那两条）。 */
    ['window.ZEditor.CodexPanel', win2.ZEditor && win2.ZEditor.CodexPanel],
    ['window.ZEditor.ModulePanel', win2.ZEditor && win2.ZEditor.ModulePanel],
    ['window.ZLevel.Report', win2.ZLevel && win2.ZLevel.Report],
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
    ['ZLevel.Spans.objectRanges', win2.ZLevel && win2.ZLevel.Spans && typeof win2.ZLevel.Spans.objectRanges],
    ['ZLevel.Refs.aliases', win2.ZLevel && win2.ZLevel.Refs && typeof win2.ZLevel.Refs.aliases],
    ['ZLevel.Parse.classifyRef', win2.ZLevel && win2.ZLevel.Parse && typeof win2.ZLevel.Parse.classifyRef],
    ['ZEditor.Text.create', win2.ZEditor && win2.ZEditor.Text && typeof win2.ZEditor.Text.create],
    ['ZEditor.Text.diagnosticOf', win2.ZEditor && win2.ZEditor.Text && typeof win2.ZEditor.Text.diagnosticOf],
    ['ZEditor.Text.syncLabels', win2.ZEditor && win2.ZEditor.Text && typeof win2.ZEditor.Text.syncLabels],
    ['ZEditor.State.create', win2.ZEditor && win2.ZEditor.State && typeof win2.ZEditor.State.create],
    ['Codex.chapters', win2.Codex && typeof win2.Codex.chapters]
  ];
  const notFn = TYPES.filter(([k, t]) => k === 'Codex.chapters' ? t === 'undefined' : t !== 'function')
    .map(([k, t]) => `${k}=${t}`);
  ok(notFn.length === 0, '界面要调用的入口函数都到位了', notFn.join(', '));
}

console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
