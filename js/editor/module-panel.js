/* 侧栏「模块」页 —— 列表留在侧栏，详情去浮层
 *
 * 这里原先是一排按钮，点一下**直接插入**（旧 js/editor/panels.js 的 renderInsert）。
 * 52 个模块加上一堆事件，每行只有标题和 objClass，用户点之前不知道插进去的是什么、
 * 会多出哪些键。现在拆成两层：
 *
 *   侧栏   分组列表，点一行 = **看详情**（不再插入）
 *   浮层   这个模块的说明 + 键表，事件还要选插到第几波；「插入」按钮在浮层里
 *
 * 侧栏一行三行文字：**中文名 + 标签 / objClass / 灰字提示**（`row`）。分组头上
 * 原先还有一句组说明，2026-09-22 用户点名去掉（"分类下的 note 多余"）—— 说明挂到
 * 那一行自己身上，用户才不用在组里对照哪句说的是哪一个。
 *
 * 「插入」按完浮层关掉、回侧栏 —— 插完一个多半还要插下一个，不该被浮层关在外面。
 * **插入失败除外**：那时候浮层留着，原因写在按钮上面（见 say）。
 *
 * ── 注释从哪来：三档降级，框架不等数据 ──
 *
 * 键表**不要求**先有人工注释才画得出来，否则这个框架得等词条写完才能上线。
 * 从有到无三档：
 *
 *   doc   词条里至少有一个键写了中文 —— 键名 / 默认值仍从骨架读，人只写说明
 *   auto  没有词条（或词条里一个中文都没填）—— 键名 + 插入时的默认值。
 *         这是**能自动生成的极限**：键的语义只有人知道，所以这一档顶上还挂一句
 *         「还没有人工说明」
 *   none  连骨架都没有 —— 引用型模块（defaultSource === 'LevelModules'，对象定义
 *         在 LevelModules 里，插入只挂一条 RTID）本来就不新建对象，没有骨架可言
 *
 * 于是「给模块加注释」这件事就是**往 ModuleDocs 里加数据**，不用改这个文件：
 * 写一个键升一个键，写满一个模块它就整体走 doc 那一档。
 *
 * 每一行底下那第三条（人工注释）**只有"在列的键"才摆占位** —— 见 docLine：判据是
 * 这个键在不在**插入骨架**里。不在骨架里的键注不进 ModuleDocs（契约闸会报键名抄错），
 * 所以不摆。改参数那一档的行有一半来自对象自己的 objdata，那条界线就是在那儿起作用的。
 *
 * ModuleDocs 的打底文件（data/module-docs.js，79 个模块 / 232 个键）**已经生成并挂进
 * 页面**，键名全在、中文全是空串（`''` = 有意的空位，契约闸不报）—— 眼下一律走 auto
 * 那一档，等中文一条条填上去。它要的形状是
 *
 *     window.ZEditor.ModuleDocs = {
 *       SeedBankProperties: {
 *         desc: '……',                       // 可选，盖过 data/modules.js 里那句
 *         keys: { SelectionMethod: '选卡方式：chooser=选卡界面，preset=预设' }
 *       }, …
 *     };
 *
 * **为什么 keys 是稀疏对象、而不是 v1 那种 {key, type, doc} 的数组**：数组要人把
 * 键名和类型抄一遍，抄错就画出一条**插入结果里根本不存在的假行** —— 而那一行是照
 * 人抄的样子画出来的，浮层上看不出真假，页面一点毛病没有。稀疏之后行**只**来自骨架
 * （键名 / 默认值都从那儿读），人只写中文，两边在结构上就没法分叉了；词条里写歪的
 * 键名由 tools/check.js 那道契约闸在自检里报出来 —— 面板**不校验**，页面不该去校验
 * 自己的数据。
 *
 * 可以像 data/ch-*.js 那样单独一个数据文件挂上去，本文件一行都不用改。
 *
 * ── 键表为什么不去读参考数据里的对象定义 ──
 *
 * 参考文件里那些对象是**别的关卡**的实例，键是人家填过的值，不是这个模块"能有哪些
 * 键"。拿它当键表会把"某个关卡恰好填了哪些键"说成"这个模块的键表"，是错的。
 * 插入骨架才是"这个模块新建出来长什么样"，跟用户按「插入」得到的东西完全一致。
 *
 * ── 键表是**插入表单**，不是一个只读的说明书 ──
 *
 * 第一版键表只念值（"插入时会写 `8`"），用户想改就得插完再去文本里找。现在标量键
 * 直接可改，改完按插入，写进去的就是改过的值。顶上那条「已改 N 个键」是**唯一的**
 * 反馈：改了几处、按下插入会写几处。
 *
 * **「还原回默认」那一套整个没有了**（2026-09-22 用户：「编辑页面去掉所有还原回默认的
 * 相关功能」）。原先每行有一个「↺ 默认」（插入那一档 = 退回骨架默认值，改参数那一档 =
 * 退回**打开时的值**），改过东西时顶上还多一条「全部恢复默认」。两档一起去掉，连带
 * 下面这些一起没了：
 *
 *   - `resetBtn` / `resetAll` 两个函数、`.mdl-reset` / `.mdl-resetall` 两个类名和它们的
 *     样式。`redrawRows` 留着（「＋ 按默认值加上」还要用它把一行从"没填"换成"有值"）。
 *   - **改过的行不再有视觉标记。** 样式表里原先写着"改过的值不是靠颜色区分的，靠多了个
 *     ↺ 默认" —— 那个标记消失了，现在只有顶上那个计数。要恢复"哪几行改过"的可见性，
 *     得另加一条（比如改过的行换个底色），别悄悄靠别的东西顶替。
 *   - **「＋ 按默认值加上」变成单向的**：加上的键原本只有那个 ↺ 能撤回，现在只能关掉
 *     浮层重来。用户知道这件事（选项里写了），要留口子的话得单独说。
 *
 * **控件按默认值的形状选，不按键名的意思猜。** 形状只有一个来源：骨架里的默认值
 * （`true`→勾选框、数字→数字框、字符串→文本框）。这一层永远不会错，因为它跟插入
 * 写进去的东西是同一份数据。
 *
 * 数组和对象一律走「**结构值**」那一档，浮层里给的是一个**原文编辑框**（textarea），
 * 里面就是这个键的 JSON，改它是真改（见 structBox / setStruct）。
 *
 * 这一档的来历值得写下来，因为它翻过一次案。第一版是**只读**的"原文照抄 + 一句
 * 实话（这个键的填写界面还没做）"，理由是：给个 JSON 文本框看着像"懂了"，实际是把
 * JSON 语法当界面，而浮层里放一个可以写坏的文本框，用户按插入时要么被拦（那他不如
 * 直接在编辑器里写），要么悄悄写进去一份坏的。2026-09-22 用户的口径是**"允许修改"**，
 * 那一版表头（「结构值」标签 + 「现在是下面这段」）和底下那句实话一起去掉了。
 *
 * 那把"写坏了"的担忧由**解析闸门**接过去：`JSON.parse` 解析不开就把提交按钮按下、
 * 把原因写在按钮上面，那个键一个字节都不写（setStruct，跟数字框那条 setNum 同一个
 * 约定）。所以"能按下去的一定解析得开"—— 原先担心的那种"悄悄写进去一份坏的"在这条
 * 路上不成立。**不装懂**这句仍然算数，只是它现在指的是别假装有专用控件。
 *
 * 曾经还有个「插完光标落到这个键」的单选框（插完把光标送到那个键的**值**上），
 * 2026-09-22 用户点名删掉："多余功能，光标按之前逻辑在原插入位置就行"。落点从此
 * 只有一个：整个新对象（见 main.js 的 revealCreated）。
 *
 * 专用控件排在后面（坐标格子 → 记录表格 → 图鉴选择器），它们要替换掉的是那个
 * **编辑框**，不是"从无到有"—— 有了这个框，用户今天就能改结构值。**要判断某个键该
 * 配哪一档，得先有 key-schema**（元素字段表，从 Kotlin 抽）—— 骨架只说得出"这个键是
 * 个空数组"，说不出里面每条的字段。那一层还没落地，所以眼下**所有**结构值键都是
 * 这个框，这是有意的。
 *
 * ── 同一个浮层，两个入口：**插入** 和 **改参数** ──
 *
 * 用户要的是"点侧栏里的对象，弹出它的编辑框，照着注释改参数"。那张编辑框跟插入
 * 表单**是同一张表**：一样的键名、一样的形状挑控件、一样的注释来源、一样的填错拦截。
 * 差别只有三处，都在下面这些 mode 分支里：
 *
 *              插入（mode='insert'）          改参数（mode='edit'）
 *   行从哪来   插入骨架 data/module-skeletons  这个对象**当前的 objdata**
 *   写回什么   整棵 objdata                    只写改动过的键（见 collectEdited）
 *   按下去     插进关卡、跳过去                改文本里那几个值、跳回那个对象
 *   代号那格   新对象的代号（预填默认别名）    首别名；改它 = 本文件所有引用一起改
 *
 * 两个入口分别是：侧栏「模块」页的一行（插入），和对象树一行上那个 ✎（改参数）。
 *
 * 为什么行从 objdata 来：要改的是**这个对象**的参数。骨架说的是"新建出来长什么样"，
 * 拿它当行表的话，用户在界面上会看不到自己（或游戏）后来加的那些键，而界面上一点
 * 异样都没有。反过来，骨架里**有**而对象**没有**的键单列一行（`.mdl-absent`），
 * 一行一个「＋ 加上」——按骨架默认值补上，这是"快速加一个结构化数据键"最老实的样子
 * （空数组就是空数组，不假装知道里面该填什么）。
 *
 * 为什么只写改动过的键：浮层开着的时候用户完全可能在右边的编辑器里手打几笔。
 * 整棵写回去 = 拿打开那一刻的快照把那些改动盖掉。而且"我没动这个键"和"我要把它写成
 * 默认值"是两件事，前者根本不该写。
 *
 * 一个对象在文件里的身份是 **(位置, objClass)**：位置是 objects 数组里的下标（解析
 * 不重排，所以它就是文本顺序），objClass 是复核。保存的那一刻拿这两个去当前解析结果里
 * 认人，认不上就拒绝并说明原因，不猜 —— 见 main.js 的 doSaveObject。
 *
 * ── 改代号那一格：两档都有，做的事不一样 ──
 *
 * 键表上面单独一格「代号」（`.mdl-alias`）。
 *
 * **改参数**那一档是图形界面相对文本模式的**补偿**：手改一处别名、漏改十处引用，
 * 改完就是一串悬空引用，而屏幕上一点异样都没有。这里把本文件里所有
 * `RTID(老代号@CurrentLevel)` 一起改掉（别的来源指的是**别的文件**，一个都不碰
 * —— 理由写在 Edit.renameAlias 头上）。
 *
 * **插入**那一档填的是**新对象的代号**（2026-09-22 用户要的："新建模块界面也要支持
 * 代号命名"），预填元数据里的默认别名。**改了才递下去**：没改的话走的还是"默认别名
 * + 去重"那条路，跟这一格出现之前一模一样（否则插第二个「可多个」的模块会当场撞名
 * 被拒，而用户什么都没填）。填了就按他填的来，**撞名一律拒绝、不静默加序号** ——
 * 理由写在 Edit.insertModule 头上。
 *
 * **指向别的文件的模块两档都改不了代号**（2026-09-22 用户要的）：defaultSource 不是
 * CurrentLevel 时，`RTID(代号@LevelModules)` 里那个代号说的是参考文件里那个对象的名字，
 * 本文件改不动它。那一格于是是灰的，底下有一句为什么。判据两档各从哪儿来见
 * renderDetail / renderObject 的注释。
 *
 * 两道闸两档共用：形状（面板自己实时判，`[A-Za-z0-9_-]`，跟 Edit.ALIAS_RE 同一套
 * 口径）和撞名（要知道整份文件的对象列表，只有 main.js 判得了 —— 它拒绝时给的那句
 * 话原样显示在按钮上面）。撞名不许"差不多就改吧"：Parse 的可达性分析、对象树、
 * findOrphanedObjects 全是按别名认人的，两个对象共用一个名字之后这一堆分析都在猜。
 *
 * 改名和改键是 main.js 里**同一次**结构操作，所以按一次「保存」= 一步撤销。
 *
 * ── 浮层底下那几条提示：灰字 / 警示色两档 ──
 *
 * `mdl-note` 说的是"这张表是怎么来的"（键表是自动读的、还没有波次），读不读都行；
 * `mdl-note-warn` 说的是"**按下去会发生什么**"——两个同类模块会相互覆盖（非
 * allowMultiple 的模块重复插入是允许的，见 Edit.insertModule）、波次管理器会顺带建一个
 * 波次容器。后者排在前、带警示色：用户按之前得看见。
 *
 * ── 跟图鉴浮层（codex-panel.js）的关系 ──
 *
 * 两套浮层长得像、接线也像，但**各写各的**。图鉴那套有目录索引、跨类搜索、筛选、
 * 密度、多选，这里只有一屏详情；合并会让图鉴那个文件里一半分支是"另一个浮层用不着"
 * 的。CSS 同理，.mdl-* 是独立一套，不去跟 .codex-* 挤同一个选择器 —— 改一边不该
 * 动到另一边。（浮层本身的三条约定是共用的，见下面 wireOverlayKeys。）
 */
window.ZEditor = window.ZEditor || {};
window.ZEditor.ModulePanel = (function () {
  'use strict';

  /* 复用 panels.js 的 el。**加载期就读**，所以 index.html 里本文件必须排在
   * panels.js 之后 —— 跟 codex-panel.js 同一个约定，check-editor.js 的早读探测器
   * 会当场报出来（el 是 undefined 时不会报错也不会白屏，直到用户点开浮层才炸）。 */
  var el = window.ZEditor.Panels.el;
  var icon = window.ZEditor.Panels.icon;
  var iconBtn = window.ZEditor.Panels.iconBtn;

  var built = false;
  var host = null;
  var ctxRef = null;

  /* open / objClass / kind / waveIndex / mode：浮层这一刻在讲哪个模块。
   * objClass 而不是 meta 对象 —— state() 要把它交给自检比对，存引用的话自检就得
   * 跟着认识 meta 的内部结构。 */
  var ui = { open: false, objClass: null, kind: 'module', waveIndex: 0, mode: 'insert' };

  /* 改参数那一档的"认人"凭据：{ index, objclass, title }。
   * **不存对象引用** —— 结构操作之后 objects 是重新解析出来的一批新实例，留着旧引用
   * 就是在写一个已经不在文件里的对象。保存时拿这两个字段去当前解析结果里认人。 */
  var editId = null;

  /* 侧栏每一行都登记在这儿。两个用处：
   *   关闭浮层时把焦点还回去（藏起来的不算数，见 closeOverlay）
   *   自检要问「这一行点开的是不是我要的那个模块」
   * 一行也没丢下 —— 分组是收着的，但行一直在 DOM 里。 */
  var rows = [];
  var lastEntry = null;

  var modal = null, mtitle = null, msub = null, mdesc = null;
  var mkeysH = null, mkeys = null, mnotes = null, merr = null;
  var waveWrap = null, waveSel = null, insertBtn = null;
  var mformBar = null, mformCount = null;
  var aliasWrap = null, aliasIn = null, aliasHint = null;

  /* ── 表单状态：只活在浮层开着的那段时间里 ──
   * 每次 openOverlay 都清空，不做持久化 —— 换一个模块看详情，上一次改的值不该
   * 跟着过去（那两个模块的键根本不是一回事）。 */
  var edits = {};          // 键名 -> 用户改过的值（没改过的键不在这里）
  var badKey = null;       // 哪个键现在填得不对；不为 null 时不许插入
  var badMsg = '';
  var lastRows = [];       // 这次渲染出来的行（collect / refresh 要用）
  var ctlRows = [];        // 行上的控件句柄，改了值只刷新这几处，不重画整张表
  var rowEls = {};         // 键名 -> 那一行的 DOM。整行要换（absent <-> 有值）时按它找

  /* 「代号」那一格（只有改参数那一档有，见 renderObject）。
   * aliasOrig 是打开这一刻这个对象的首别名 —— 判"改没改"要拿它比，
   * 不是拿输入框里上一次的值比。 */
  var aliasOrig = '';
  var aliasVal = '';

  /* 上一次画出来的键表长什么样 —— 只给 state() 用。自检要断言"这个模块读出了 4 个键"
   * 和"走的是哪一档降级"，去 DOM 里数 .mdl-krow 反推的话，把三档写岔了照样能过。 */
  var lastMode = 'none', lastKeys = 0;

  // ── 键表 ────────────────────────────────────────────────────────────

  /** 值的紧凑写法：骨架里的默认值可能是数组/对象，整串塞进表格会把行撑爆。 */
  function brief(v) {
    var s;
    try { s = JSON.stringify(v); } catch (e) { s = String(v); }
    if (s == null) s = String(v);
    return s.length > 64 ? s.slice(0, 61) + '…' : s;
  }

  /** 缩进版的原文，给「结构值」那一档当编辑框里的初始内容。
   *
   *  **不截断**（原先这里在 900 字符处切一刀，还带个省略号）—— 那一版是只读样品，
   *  截断了顶多是"看不全"；现在这一块是**可编辑的**，截断就成了改数据：用户看着
   *  一段看着完整、其实被切掉的 JSON，随手按保存，写下去的就是个残缺的数组。
   *  太长让它自己滚（.mdl-struct-code 上有 max-height）。 */
  function pretty(v) {
    var s;
    try { s = JSON.stringify(v, null, 2); } catch (e) { s = String(v); }
    if (s == null) s = String(v);
    return s;
  }

  /**
   * 这个键该画成什么控件。**只看骨架里的默认值是什么形状**。
   *
   * 数组 / 对象一律 'struct'（走结构值那一档，见 structBox）—— 不是"没认出来"，
   * 是"认出来了，专用控件还没做"：眼下那一档给的是原文编辑框，等坐标格子 /
   * 记录表格 / 图鉴选择器落地，再按 key-schema 换成对应的填写界面。
   */
  function shapeOf(v) {
    if (Array.isArray(v) || (v && typeof v === 'object')) return 'struct';
    if (typeof v === 'boolean') return 'bool';
    if (typeof v === 'number') return 'num';
    return 'str';
  }

  /** 这个键现在该是什么值：改过就用改过的，没改过就是骨架默认。 */
  function cur(r) {
    return Object.prototype.hasOwnProperty.call(edits, r.key) ? edits[r.key] : r.def;
  }

  function isEdited(r) { return Object.prototype.hasOwnProperty.call(edits, r.key); }

  function setEdit(r, v) {
    edits[r.key] = v;
    refresh();
  }

  /**
   * 数字框里那串字现在还像个数吗。
   *
   * 空格子**不算数**（`valueAsNumber` 是 NaN）—— 而"清空再重打"是编辑数字框时
   * 最常见的一个动作，中间那一瞬间必然是空的。所以这里只是把插入按钮按下、
   * 把原因写在按钮上面，**不弹错、不抢焦点、不动用户正在打的那个框**。
   */
  function setNum(r, inp) {
    var raw = inp.value;
    var n = inp.valueAsNumber;
    if (raw.trim() === '' || isNaN(n)) {
      badKey = r.key;
      badMsg = '「' + r.key + '」要填一个数字';
      delete edits[r.key];
    } else {
      edits[r.key] = n;
      if (badKey === r.key) { badKey = null; badMsg = ''; }
    }
    refresh();
  }

  /**
   * 代号那一格现在填得对不对。
   *
   * 形状这一关**面板自己就能判**（纯看字符），撞名那一关判不了 —— 那要知道整份文件
   * 的对象列表，而面板按约定不碰 state（见文件头）。所以分工是：形状在这儿实时拦
   * （用户一边打字一边看得见），撞名交给 main.js（改参数走 onSaveObject、插入走
   * onInsertModule），它拒绝时给的那句话原样显示在按钮上面。
   *
   * 允许的字符表跟 Edit.ALIAS_RE 是**同一套口径**，两处各写一遍是没办法的事
   * （面板不引 js/level/*）。写歪的代价不对称：这里松一点，用户能按保存，然后被
   * main.js 拦下来并看到原因；这里紧一点，用户看到一个自己改不掉的框。所以宁可松。
   */
  var ALIAS_RE = /^[A-Za-z0-9_-]+$/;

  /** 代号改过了吗。两个模式都算（插入那一档填的是新对象的代号）。 */
  function aliasChanged() {
    return aliasVal.trim() !== aliasOrig;
  }

  /** 代号这一格此刻的问题（没问题返回空串）。 */
  function aliasBadMsg() {
    if (!aliasChanged()) return '';
    var v = aliasVal.trim();
    if (!v) return '代号不能为空';
    if (!ALIAS_RE.test(v)) return '代号只能用字母、数字、下划线和连字符';
    return '';
  }

  /**
   * 一行上的那几处跟着改动走：勾选框旁边那个 true/false、顶上的计数、
   * 插入按钮的可按性。
   *
   * **不重画整张表** —— 用户正在框里打字，整块重建会把焦点和光标位置一起丢掉。
   */
  function refresh() {
    var any = false;
    ctlRows.forEach(function (c) {
      var ed = isEdited(c.row);
      if (ed) any = true;
      if (c.boolText) c.boolText.textContent = String(!!cur(c.row));
      if (c.input && c.row.shape === 'str' && document.activeElement !== c.input) {
        c.input.value = String(cur(c.row));
      }
      if (c.input && c.row.shape === 'num' && document.activeElement !== c.input) {
        c.input.value = String(cur(c.row));
      }
      /* 结构值那一块也要跟着 edits 走（比如把一段 JSON 打坏了，edits 里那一条被删掉，
       * 框里该显示回当前值）。同样地，**正在打字的那一块不动** —— 覆盖它等于把用户打了
       * 一半的 JSON 抹掉。只在真换了内容时才写回**并且重新量高度**（fitStruct）：每次都量
       * 的话，用户自己拖出来的高度会被下一次 refresh 抹掉。
       *
       * ↺ 删掉之后这条只剩"打坏了那一瞬间"和"提交失败"两种触发，但都得留着：
       * setStruct 解析不开时会 delete edits[key]，屏幕上不能还显示着那个坏串。 */
      if (c.input && c.row.shape === 'struct' && document.activeElement !== c.input) {
        var txt = pretty(cur(c.row));
        if (c.input.value !== txt) { c.input.value = txt; fitStruct(c.input); }
      }
    });
    if (mformBar) mformBar.hidden = !any;
    if (mformCount) {
      var n = ctlRows.filter(function (c) { return isEdited(c.row); }).length;
      mformCount.textContent = n ? '已改 ' + n + ' 个键' : '';
    }
    if (insertBtn) insertBtn.disabled = submitBlocked();
    /* 红字这一格**只由表单负责清**：填错了就写在这儿，改对了就收掉。上一次插入
     * 失败那句话会被这一句盖掉，这没关系 —— 用户再按一次插入，原因还会回来。 */
    say(badKey ? badMsg : aliasBadMsg());
  }

  /** 提交按钮此刻被什么拦着。插入那一档还要看有没有波次，改参数那一档看改了没有。 */
  function submitBlocked() {
    if (badKey) return true;
    /* 代号填歪了：两档都拦（插入那一档填的就是新对象的代号）。 */
    if (aliasBadMsg()) return true;
    if (ui.mode === 'edit') {
      /* 改参数这一档有**两件事**可以改：键和代号。只改代号也算改过 ——
       * 漏了这一半，「只改代号」这个用法按钮永远是灰的，用户会以为功能没做。 */
      return !lastRows.some(isEdited) && !aliasChanged();
    }
    if (ui.kind === 'event') return !!waveSel.disabled;
    return false;
  }

  /** 插入：整个表单收成一棵 objdata（没改过的键也在里面，值是骨架默认）。
   *  填得不对返回 null（调用方去 say）。 */
  function collectAll(rows) {
    if (badKey) return null;
    var out = {};
    rows.forEach(function (r) { out[r.key] = cur(r); });
    return out;
  }

  /**
   * 改参数：**只收改动过的键**。
   *
   * 一个键都没动过时返回**空对象**（不是 null）—— 那是"没得可写"，调用方拿它去
   * 问 Edit.updateObject 会拿到 no-change。null 是另一件事（有键填得不对），
   * 两者混在一起的话，界面上的红字和按钮状态就说不清了。
   */
  function collectEdited(rows) {
    if (badKey) return null;
    var out = {};
    rows.forEach(function (r) { if (isEdited(r)) out[r.key] = cur(r); });
    return out;
  }

  /** 这次要写回去的东西 —— 按当前是哪一档收。state().values 和提交都走它。 */
  function collect() {
    return ui.mode === 'edit' ? collectEdited(lastRows) : collectAll(lastRows);
  }

  /**
   * `Object.prototype.hasOwnProperty` 的短写法。键名来自文件（objdata / 骨架），
   * 里面完全可能有 `constructor`、`toString` 这种字面量 —— 用 `in` 或 `obj[k]` 判断
   * 会把原型链上的东西算成"有这个键"。 */
  function hasOwn(obj, k) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, k);
  }

  /**
   * 人工词条里这个模块的键级中文（稀疏对象）和整段说明。**两个入口共用一份** ——
   * 插入表单和改参数界面说的必须是同一段话，否则用户会以为注释分两套。
   */
  function docEntryOf(objClass) {
    var docs = window.ZEditor.ModuleDocs;
    var entry = (docs && objClass) ? docs[objClass] : null;
    /* 词条是**稀疏**的：{ 键名: '中文' }。键名和默认值一律从数据表读 —— 行只可能
     * 来自骨架 / objdata，人写歪的键名在这儿画不出行来（那正是 v1 数组形状的毛病，
     * 见文件头）。写成数组的旧形状**不认**：它按位置取键名，画出来的行对不上。 */
    var cn = (entry && entry.keys && typeof entry.keys === 'object'
      && !Array.isArray(entry.keys)) ? entry.keys : null;
    return { cn: cn, desc: (entry && entry.desc) || '' };
  }

  /**
   * 这个模块的键表走哪一档、表里有什么（**插入**那一档）。
   * @returns {{mode: 'doc'|'auto'|'none', desc: string, rows: Array}}
   */
  function docOf(meta) {
    var de = docEntryOf(meta.objClass);
    var desc = de.desc || meta.desc || '';

    /* 指向**别的文件**的模块没有键可列 —— 插入只往 Modules 里追一条 RTID，不新建
     * 对象，键表填了也写不下去（Edit.insertModule 只在 source 为 CurrentLevel 时
     * 才建对象，骨架那一步还被显式跳过）。
     *
     * 判据用 defaultSource 而不是"有没有骨架"：注册表里恰好有两个 @LevelModules 的
     * 条目**带着骨架**（VaseBreaker*，check-level.js 里点名的上游死数据 —— 那两个骨架
     * 永远不会被用上）。照骨架画出来的结果是"屏幕上有键表、按下去键全丢"，
     * 比不画还坏：用户会以为改的值写进去了。 */
    if (meta.defaultSource && meta.defaultSource !== 'CurrentLevel') {
      return { mode: 'none', desc: desc, rows: [] };
    }

    /* 骨架是**按 objClass** 查的，跟插入时用的是同一张表、同一个键（main.js 的
     * doInsertModule 也这么查）。两边查法一旦分叉，浮层说的和插出来的就不是一回事。
     * 没有骨架 = 引用型模块，它本来就不新建对象，也就没有键可列。 */
    var sk = window.ZLevel.Skeletons[meta.objClass];
    if (!sk) return { mode: 'none', desc: desc, rows: [] };

    var rows = Object.keys(sk).map(function (k) {
      /* 插入那一档的行**本来就全是骨架的键**，所以每一行都有位置等着中文。 */
      return { key: k, def: sk[k], shape: shapeOf(sk[k]),
               doc: (de.cn && de.cn[k]) || '', docSlot: true };
    });

    /* 一个键写了中文才算升到 doc。光挂一条词条、一个中文都没填，用户看到的还是
     * 一张"没有人工说明"的表 —— 那就该照实说，别把空壳算成"有说明"。 */
    var written = rows.some(function (r) { return r.doc; });
    return { mode: written ? 'doc' : 'auto', desc: desc, rows: rows };
  }

  /**
   * 一个**已有对象**的键表（**改参数**那一档）。
   *
   * 行的来源是这个对象自己的 objdata —— 不是骨架（理由见文件头）。骨架只用在一个
   * 地方：算出"这个对象还没有的键"，它们单列在后面，一行一个「＋ 加上」。
   *
   * @param {Object} snap  { objclass, data } —— data 是 main.js 递进来的快照
   */
  function rowsOfObject(snap) {
    var de = docEntryOf(snap.objclass);
    var data = (snap.data && typeof snap.data === 'object' && !Array.isArray(snap.data))
      ? snap.data : {};
    var sk = window.ZLevel.Skeletons[snap.objclass] || {};
    var rows = [];

    /* 对象自己的键，**按 objdata 里的顺序**（也就是文件里的顺序）。用户在文本里
     * 看到的次序跟浮层里的次序一致，找起来才不用来回扫。 */
    Object.keys(data).forEach(function (k) {
      rows.push({
        key: k, present: true, def: data[k], shape: shapeOf(data[k]),
        doc: (de.cn && de.cn[k]) || '', docSlot: hasOwn(sk, k)
      });
    });
    /* 骨架里有、这个对象没有的键。**只在骨架确实是个对象时**才列 —— 有些模块
     * （引用型）根本没有骨架，那就没有"可以加上"的键。 */
    Object.keys(sk).forEach(function (k) {
      if (hasOwn(data, k)) return;
      rows.push({
        key: k, present: false, def: sk[k], shape: shapeOf(sk[k]),
        doc: (de.cn && de.cn[k]) || '', docSlot: true
      });
    });

    var written = rows.some(function (r) { return r.doc; });
    return { mode: written ? 'doc' : 'auto', desc: de.desc, rows: rows };
  }

  // ── 侧栏 ────────────────────────────────────────────────────────────

  /**
   * 一行。**点它不开插，开详情** —— 这是这一版的核心改动，别再把 onInsert 接回来。
   *
   * 三行：**中文名 + 标签 / objClass / 灰字提示**。
   * 第一版把名字、objClass、标签全挤在第一行，说明另起一行 —— 侧栏就 200 多像素宽，
   * objClass 是等宽长串（`WaveManagerModuleProperties`），它一挤就把标签顶到看不
   * 见的地方，而"这一行叫什么、插进去是什么类"这两件事反倒分不出来了。
   */
  function row(meta, kind) {
    var r = el('div', 'ins-row');
    var main = el('button', 'ins-main');
    main.type = 'button';

    var top = el('div', 'ins-top');
    top.appendChild(el('span', 'ins-title', meta.title));
    if (meta.isCore) top.appendChild(el('span', 'tag tag-core', '核心'));
    if (meta.isContainer) {
      var tc = el('span', 'tag tag-box', '容器');
      tc.title = '一个装着数据的对象，不是模块：它不在 Modules 里，一份关卡只能有一个';
      top.appendChild(tc);
    }
    if (meta.defaultSource === 'LevelModules') {
      var t = el('span', 'tag tag-ref', '引用');
      t.title = '这个模块的对象定义在 LevelModules 里，插入只会给本关卡挂一个引用，不会新建对象';
      top.appendChild(t);
    }
    /* 得让人看出这一下是**看详情**、不是插入。原先这个按钮点下去东西就进关卡了，
     * 肌肉记忆会害人，所以行尾明写「详情」。
     * 行尾那个 › 是图标不是字（✎/⚙ 那批一起换的）—— 它跟文字同色同高，
     * 所以 .ins-more 上要挂一排内联 flex，见 css。 */
    var more = el('span', 'ins-more', '详情');
    more.appendChild(icon('right'));
    top.appendChild(more);
    main.appendChild(top);

    main.appendChild(el('div', 'ins-cls', meta.objClass));
    /* 说明也在按钮里面 —— 原先它在按钮外面，于是点到那行灰字上什么都不发生，
     * 而它看起来跟可点的那部分是一整行。 */
    if (meta.desc) main.appendChild(el('div', 'ins-desc', meta.desc));

    main.title = meta.desc || '';
    main.addEventListener('click', function () { openOverlay(meta, kind, main); });
    r.appendChild(main);
    rows.push({ btn: main, objClass: meta.objClass, kind: kind });
    return r;
  }

  /**
   * 一组（可折叠）。分组头 + 计数，跟旧版长得一样。
   * @param {string} kind  这一组是模块还是事件 —— 原样传给每一行，决定点开的是哪张
   *                       表里的条目（currentMeta 也靠它选表）
   *
   * 组说明（g.note）**没画**：2026-09-22 用户点名去掉（"分类下的 note 多余"）——
   * 一个模块插进去是干什么的，说明该挂在那**一行**上（row 的第三行），挂在组头上
   * 用户得自己在组里对照哪句说的是哪一个。
   */
  function groupBox(g, kind) {
    var box = el('div', 'ins-group');
    var head = el('button', 'ins-group-h');
    head.type = 'button';
    /* 展开状态走 aria-expanded（原先改的就是这个），三角的朝向由 CSS 看属性决定。
       这组默认是**收着**的，所以初始 'false'。
       ⚠ 三角必须是 head 的第一个子元素：css 里 `.ins-group-h > span:nth-child(2)`
       是给标题撑宽度的，挪了位置标题就顶不满。 */
    head.setAttribute('aria-expanded', 'false');
    var caret = el('span', 'sec-caret');
    caret.appendChild(icon('right'));
    head.appendChild(caret);
    head.appendChild(el('span', null, g.title));
    head.appendChild(el('span', 'sec-count', String(g.items.length)));
    var body = el('div', 'ins-group-b');
    body.hidden = true;
    g.items.forEach(function (m) { body.appendChild(row(m, kind)); });
    head.addEventListener('click', function () {
      body.hidden = !body.hidden;
      head.setAttribute('aria-expanded', String(!body.hidden));
    });
    box.appendChild(head); box.appendChild(body);
    return box;
  }

  /**
   * 侧栏**只建一次**。
   *
   * 旧版是每次插入/删除都整块重建（因为插入目标波次那个下拉住在侧栏里，波次一变就
   * 得跟着重画），代价是展开状态被丢掉。下拉搬进浮层之后侧栏就没有随关卡变的东西了,
   * 于是这里不需要任何重建路径 —— 用户展开过的组不会自己收回去。
   * 波次那份数据由浮层每次打开时现读（见 fillWave）。
   */
  function buildSide() {
    var M = window.ZLevel.Modules;
    host.textContent = '';

    host.appendChild(el('div', 'panel-h', '插入模块'));
    host.appendChild(el('p', 'panel-note',
      '点一行看详情和键表，插不插在详情里定。标「引用」的模块对象本身在 LevelModules 里，只挂引用、不新建对象。'));
    M.moduleGroups.forEach(function (g) { host.appendChild(groupBox(g, 'module')); });

    host.appendChild(el('div', 'panel-h', '插入波次事件'));
    host.appendChild(el('p', 'panel-note',
      '事件挂在具体某一波里，插到第几波在详情里选。没有波次就先插「波次管理器」。'));
    M.eventGroups.forEach(function (g) { host.appendChild(groupBox(g, 'event')); });
  }

  // ── 浮层 ────────────────────────────────────────────────────────────

  /**
   * 建**唯一一个**浮层，append 到 body，侧栏所有行共用。
   *
   * 每行各 append 一个会在 body 里叠一堆，按钮扫雷的
   * `querySelectorAll('.mdl-modal button')` 也会把它们全捞回来。ensure 幂等，
   * 天然满足。
   *
   * 它**不在 index.html 里**，所以不能用 BY_ID / getElementById 去抓 ——
   * tools/check-editor.js 要求 JS 里出现的每个字面 id 都在 HTML 里。用模块变量
   * 持引用（跟 host / rows 一样）。
   */
  function buildModal() {
    modal = el('div', 'mdl-modal');
    modal.hidden = true;
    modal.tabIndex = -1;              // 开的时候好把焦点接过来

    var head = el('div', 'mdl-mhead');
    mtitle = el('span', 'mdl-mtitle');
    head.appendChild(mtitle);
    head.appendChild(el('div', 'grow'));
    var close = iconBtn('mdl-mclose', 'x', '关闭浮层', '关闭（Esc）');
    close.addEventListener('click', closeOverlay);
    head.appendChild(close);

    msub = el('div', 'mdl-sub');
    mdesc = el('p', 'mdl-desc');
    mkeysH = el('div', 'mdl-sec-h');
    mkeys = el('div', 'mdl-keys');

    /* 「代号」那一格。**两档都有**（renderDetail / renderObject 各自填值和显隐）：
     *
     *   插入  新对象的代号。预填元数据里的默认别名，改了才递下去（见 doSubmit）；
     *         撞名由 Edit.insertModule 拒绝，**不静默加序号**。
     *   改参数 首别名。改它 = 本文件里所有指向它的引用一起改。
     *
     * 事件那一档不露（理由见 renderDetail）。
     *
     * 它跟键表用同一套网格（左边名字、右边控件），读起来才是一张表；但它在 .mdl-keys
     * 外面，因为 paint() 每次会清空 mkeys，而这一格在两次重画之间要保住用户正在打的字。 */
    aliasWrap = el('div', 'mdl-alias');
    aliasWrap.appendChild(el('span', 'mdl-alias-l', '代号'));
    var aliasCtl = el('div', 'mdl-alias-ctl');
    aliasIn = document.createElement('input');
    aliasIn.type = 'text';
    /* 类名跟键表那些框**故意不一样**（虽然样式一样，见 css 里那条并列的选择器）：
     * `.mdl-kinput` 在这个文件的含义是"键表里某一行的控件"，自检也按它数
     * "画了几个控件"。代号这一格不是键表的一行，混进去会让那些数悄悄多一个。 */
    aliasIn.className = 'mdl-alias-in';
    aliasIn.spellcheck = false;
    aliasIn.addEventListener('input', function () {
      aliasVal = aliasIn.value;
      refresh();
    });
    aliasCtl.appendChild(aliasIn);
    aliasHint = el('span', 'mdl-alias-hint');
    aliasCtl.appendChild(aliasHint);
    aliasWrap.appendChild(aliasCtl);
    aliasWrap.hidden = true;

    /* 「已改 N 个键」那条 —— 一个键也没改时整条藏着（藏在上面而不是删掉：
     * 它出现/消失会让底下的表格上下跳一格，正打着字的时候很讨厌）。
     *
     * 这里原先还有一条「全部恢复默认」，2026-09-22 跟着"还原回默认"那一套一起删了。
     * **计数留着**：它不是还原功能，而是"按下插入会写几个键"的唯一交代 —— 尤其现在
     * 改过的行不再有任何视觉标记，这个数是屏幕上唯一能看出"我动过东西"的地方。 */
    mformBar = el('div', 'mdl-formbar');
    mformCount = el('span', 'mdl-formcount');
    mformBar.appendChild(mformCount);
    /* 原先这儿还有一个 `div.grow` 把「全部恢复默认」顶到右边去。按钮没了，剩下计数
     * 一个元素，那条撑开的空档就没有意义了（.grow 在别处还有用，CSS 那条留着）。 */
    mformBar.hidden = true;
    /* 说明/降级那句都往这儿堆：可能同时有两条（"键表是自动读的" + "这份关卡还没有
       波次"），所以它是一个**容器**，不是一个 p。 */
    mnotes = el('div', 'mdl-notes');

    waveWrap = el('div', 'wave-pick');
    waveWrap.appendChild(el('span', 'wave-pick-l', '插入到第'));
    waveSel = document.createElement('select');
    waveWrap.appendChild(waveSel);
    waveWrap.appendChild(el('span', 'wave-pick-l', '波'));

    var body = el('div', 'mdl-mbody');
    body.appendChild(msub);
    body.appendChild(mdesc);
    body.appendChild(aliasWrap);
    body.appendChild(mkeysH);
    body.appendChild(mformBar);
    body.appendChild(mkeys);
    body.appendChild(waveWrap);
    body.appendChild(mnotes);

    /* 出错那句话住在按钮**上面**（不是 toast）：toast 是页面级的，浮层开着时它在
       浮层底下，用户未必看得见；而且浮层不关的理由就是"让用户看着原因把这一屏读完"。 */
    merr = el('div', 'mdl-err');
    merr.hidden = true;

    var foot = el('div', 'mdl-mfoot');
    var cancel = el('button', 'mdl-cancel', '取消');
    cancel.type = 'button';
    cancel.addEventListener('click', closeOverlay);
    insertBtn = el('button', 'mdl-insert', '插入');
    insertBtn.type = 'button';
    insertBtn.addEventListener('click', doSubmit);
    foot.appendChild(cancel);
    foot.appendChild(insertBtn);

    modal.appendChild(head);
    modal.appendChild(body);
    modal.appendChild(merr);
    modal.appendChild(foot);
    document.body.appendChild(modal);

    wireOverlayKeys();
  }

  function wireOverlayKeys() {
    /* 点浮层外面就关。`modal.contains(t)` 是最保险的判定。
     *
     * 再加两条白名单 —— 否则点侧栏那一行时事件冒到 document，浮层**刚开就被关掉**
     * （开浮层的就是这一下点击本身）。顺带一个好处：浮层开着时可以直接点侧栏另一行
     * 换个模块看、或者点对象树另一行的 ✎ 换个对象改，不用先关再开。
     *
     * #panel-objects 那条是**改参数**那一档的入口：✎ 在对象树上，不在模块页里。
     *
     * （这条独立于 main.js 那个 closePopovers() 的监听器：那个只管两个 popover。） */
    document.addEventListener('click', function (e) {
      if (!ui.open) return;
      var t = e.target;
      if (!t || !t.nodeType) return;
      /* 点中的东西**已经不在文档里了** -> 不算"点到外面"。
       *
       * 这一条不是理论上的：有的按钮点下去会**整行重画**（「＋ 按默认值加上」——
       * 行的形状从"没填"变成"有值"，只能重画）。那个按钮在这时候已经脱离了 DOM，
       * 于是 modal.contains(t) 是 false、closest 全是 null，这一下点击就被当成
       * "点到浮层外面"，浮层**当场自己关掉** —— 用户点一下「＋」，还没来得及看
       * 加上去的那一行，浮层就没了。
       *
       * isConnected 判的就是这件事：能走到这儿的点击，要么在浮层里、要么在侧栏上，
       * 要么就是被处理函数自己拆掉的 —— 第三种一律不关。 */
      if (!t.isConnected) return;
      if (modal.contains(t)) return;
      if (t.closest && (t.closest('#panel-modules') || t.closest('#panel-objects'))) return;
      closeOverlay();
    });

    /* Esc 归浮层。
     *
     * **捕获阶段 + stopPropagation**，意思是"浮层开着时 Esc 就是关浮层"，CM6
     * 根本收不到这一个 keydown。CM 的 defaultKeymap 确实绑了 Esc（simplifySelection，
     * 选区非空时才 preventDefault），所以：
     *   - 加 `if (e.defaultPrevented) return;` 是不行的 —— 浮层开着时编辑器里只要有
     *     选区，Esc 就永远关不掉浮层。
     *   - 只 preventDefault 不 stopPropagation 也不行 —— CM 的 keydown 挂在编辑器
     *     节点上，它不看 defaultPrevented。
     * 这条跟图鉴那条是**同一个约定、各写一遍**：两个浮层不会同时开着（都住在侧栏
     * 页签里），谁开着谁处理，各自的 ui.open 就是那道闸。 */
    document.addEventListener('keydown', function (e) {
      if (!ui.open || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeOverlay();
    }, true);
  }

  /** 浮层里那句红字。传空串就是收起来。 */
  function say(msg) {
    merr.textContent = msg || '';
    merr.hidden = !msg;
  }

  /** 「代号」那一格底下那句灰字。空串 = 整句收起来（不留一行空白）。 */
  function setAliasHint(text) {
    aliasHint.textContent = text || '';
    aliasHint.hidden = !text;
  }

  /**
   * 浮层底下那条灰字。
   *
   * tone 'warn' 是给**"按下去会发生什么"**那几条用的（两个模块会相互覆盖、会顺带建一个
   * 容器）—— 它们不是报错（没拦着用户），但比"这张表是自动读的"要紧，用户按之前得看见。
   * 红字那一档（.mdl-err）是另一条路：按钮上面、由 say 管，专门放"按不动、原因是这个"。
   */
  function note(text, tone) {
    mnotes.appendChild(el('p', tone ? 'mdl-note mdl-note-' + tone : 'mdl-note', text));
  }

  /** 波次下拉。**每次打开都现读**，不缓存 —— 浮层开着的时候用户可能在文本里
   *  改过波次，缓存下来的那个数是上一次打开时的世界。 */
  function fillWave() {
    var n = ctxRef.onWaveCount ? ctxRef.onWaveCount() : 0;
    waveSel.textContent = '';
    if (!n) {
      var o = document.createElement('option');
      o.textContent = '（没有波次）';
      waveSel.appendChild(o);
      waveSel.disabled = true;
      return 0;
    }
    for (var i = 1; i <= n; i++) {
      var op = document.createElement('option');
      op.value = String(i);
      op.textContent = String(i);
      waveSel.appendChild(op);
    }
    waveSel.disabled = false;
    return n;
  }

  /**
   * 问 main.js："这份关卡里有这个 objClass 的对象吗"。
   *
   * 面板**不碰 state**（那是 main.js 的约定，见 ensure 的注释）—— 浮层要判断的这两件事
   * （有没有波次容器、同类模块是不是已经有了）都得读当前解析结果，所以各走一条接缝。
   * 接缝没接上时一律当"没有"：手上没有证据就别吓唬用户，宁可少提示一句。
   */
  function hasClass(objClass) {
    return !!(ctxRef.onHasClass && ctxRef.onHasClass(objClass));
  }

  /** 问 main.js："这个模块的默认别名已经在这份关卡里了吗"。判据跟 Edit.moduleExists 同一个。 */
  function moduleExists(meta) {
    return !!(ctxRef.onModuleExists && ctxRef.onModuleExists(meta));
  }

  /** 注册表里那条「波次容器」。**没有它就不提示**（那份数据被人删了的话，
   *  提示里连该叫什么名字都说不出来），插入本身照常，由 Edit 那边兜底。 */
  function containerItem() {
    var hit = null;
    window.ZLevel.Modules.moduleGroups.forEach(function (g) {
      g.items.forEach(function (m) { if (!hit && m.isContainer) hit = m; });
    });
    return hit;
  }

  /**
   * 「结构值」那一档 —— 数组 / 对象，浮层里给一个**可编辑的框**，里面是这段 JSON。
   *
   * 最早这一档是"原文照抄 + 一句实话（专用填写界面还没做）"，不给控件：那看着像
   * 懂了，实际是把 JSON 语法当界面（文件头写了为什么不给 JSON 文本框）。2026-09-22
   * 用户的口径变了：**"允许修改"**，表头那行字（「结构值」标签 + 「现在是下面这段」）
   * 也一并去掉。于是这里就只剩一个框 —— 一行标题都不留，用户看到的直接是那个键
   * 现在的值，改它就是改它。
   *
   * 那把"写坏了怎么办"的担忧由**解析闸门**接过去（setStruct）：解析不了就当场把
   * 提交按钮按下、把原因写在按钮上面，那个键一个字节都不写。所以"看着像界面、
   * 实际会悄悄写进一份坏数据"这件事在这条路上不成立 —— 能按下去的一定解析得开。
   *
   * 专用控件（坐标格子 / 记录表格 / 图鉴选择器）仍然排在那条路上：它们是**更好的
   * 填写方式**，不是"唯一的填写方式"。有了这个框，用户今天就能改；换上去之后
   * 这一档只管那些还没配专用控件的键。
   */
  /**
   * 让结构值那个框**按内容给够高度**。
   *
   * 起因（2026-09-22 用户报的）：textarea 不给 rows 就是浏览器默认的 2 行高，一段十来行
   * 的 JSON 打开就只看得见头两行，得自己往下拖 —— 而那一档正是"到文本里自己填"最费劲
   * 的地方，看不见全貌最要命。所以按行数给高：**短的整段看得见**（这就是用户要的
   * "不太长的情况下至少得显示完整代码"），长的封顶 —— 上面还有 CSS 的 max-height: 180px
   * 兜着，超了就框内滚，不把「插入」按钮顶出屏幕。
   *
   * 下限 3 行：`{}` 这种一行内容也得有个能点的框，2 行的框看着像没画完。
   */
  function fitStruct(ta) {
    var lines = String(ta.value).split('\n').length;
    ta.rows = Math.min(Math.max(lines, 3), 12);
  }

  function structBox(r, c) {
    var box = el('div', 'mdl-struct');
    var ta = document.createElement('textarea');
    /* 类名跟原先那个只读的 <pre> 一样 —— 它在 CSS 里就是"结构值那一块"的意思。
     * ⚠ 它是 textarea 了：**内容要用 .value 读**，textContent 拿不到（那是初始的
     * 子文本节点，程序设 .value 不会动它）。自检里踩过这个。 */
    ta.className = 'mdl-struct-code';
    ta.spellcheck = false;
    /* 不折行（配合样式里那条 white-space: pre）：JSON 的缩进本身就是结构，自动折行
     * 之后层级全糊了，长行让它横向滚。 */
    ta.wrap = 'off';
    ta.setAttribute('aria-label', r.key);
    ta.value = pretty(r.def);
    fitStruct(ta);
    ta.addEventListener('input', function () { setStruct(r, ta); });
    box.appendChild(ta);
    if (c) c.input = ta;
    return box;
  }

  /**
   * 结构值这一块现在填得对不对。
   *
   * 值是一段 JSON，判断它合不合法只有一个诚实的办法：真去 JSON.parse 一次。
   * **不猜、不"差不多就行"** —— 解析不开就把提交按钮按下、把原因写在按钮上面，
   * 那个键一个字节都不写；解析得开就进表单。这跟数字框那条（setNum）是同一个约定：
   * 屏幕上说"要写这个"，写下去就必须是这个，两者之间没有第三档。
   *
   * 判空那一瞬间不算错（"全选删掉重打"是最常见的动作）—— 那个中间态就是个解析
   * 不开的串，于是按钮按下去、红字说"不是合法的 JSON"，但**不动用户正在打的那个框**。
   */
  function setStruct(r, ta) {
    var v;
    try {
      v = JSON.parse(ta.value);
    } catch (e) {
      badKey = r.key;
      badMsg = '「' + r.key + '」不是合法的 JSON：' + e.message;
      delete edits[r.key];
      refresh();
      return;
    }
    edits[r.key] = v;
    if (badKey === r.key) { badKey = null; badMsg = ''; }
    refresh();
  }

  /**
   * 键表最下面那一行：人工注释（ModuleDocs 里这个键的中文）。
   *
   * 没有注释时**摆一个占位**，不是留空 —— 留空的话一屏键表底下全是空白，用户分不出
   * "这个键还没有人写说明"和"这一段画漏了"。占位用另一种颜色（.mdl-kdoc-todo），
   * 免得被读成注释正文。
   *
   * **占位只给"在列"的键摆**（`r.docSlot`：这个键在插入骨架那张名单里）。
   * 2026-09-22 用户点名的：「待添加注释这里只应用在已经注册在列确实需要添加注释的模块，
   * 而不是遇到一个没见过的模块也显示待注释」。判据选骨架而不是"ModuleDocs 里有没有"，
   * 因为骨架**就是那份键名单**，而且契约闸只认骨架里的键名（不在骨架里的键写进
   * ModuleDocs 会被报"键名抄错了"）—— 换句话说，不在这张表里的键**根本注不进去**：
   * 给它摆一个「待添加注释」，等于指着一个填不进去的格子催人填。改参数那一档的行有一
   * 半来自对象自己的 objdata（游戏或人后来加的键、没建模的 objClass 整个都没有骨架），
   * 那些行就是这一类，所以它们**没有第三行**。
   *
   * 反过来说，"没有第三行"和"摆着占位"是两件事，屏幕上也就分得开：前者是"这个键没人
   * 给它留位置"，后者是"留了位置、还没写"。
   *
   * @returns {Element|null} null = 这一行不摆第三行（调用方负责跳过）
   */
  function docLine(r) {
    if (r.doc) return el('span', 'mdl-kdoc', r.doc);
    return r.docSlot ? el('span', 'mdl-kdoc mdl-kdoc-todo', '待添加注释') : null;
  }

  /** 这一行现在算"有值"吗。改参数那一档里，点了「＋ 加上」的行从此按有值画。 */
  function isPresent(r) {
    return r.present !== false || isEdited(r);
  }

  /** 换掉一整行（absent <-> present 那种形状变化只能重画，refresh 改不了）。 */
  function redrawRow(r) {
    var old = rowEls[r.key];
    if (!old || !old.parentNode) return;
    ctlRows = ctlRows.filter(function (c) { return c.row !== r; });
    var fresh = fieldRow(r);
    old.parentNode.replaceChild(fresh, old);
  }

  /**
   * 一个键一行：键名 + 控件（或结构值那块）。
   *
   * 改参数那一档里，**这个对象还没有**的键画成「＋ 按默认值加上」一行（见文件头：
   * 这是"快速加一个结构化数据键"最老实的样子）。行上的 `present` 说的正是这件事，
   * 别把 absent 的行画成有值的行。
   */
  function fieldRow(r) {
    if (!isPresent(r)) return absentRow(r);

    var row = el('div', 'mdl-krow');
    rowEls[r.key] = row;
    row.appendChild(el('span', 'mdl-kname', r.key));

    var ctl = el('div', 'mdl-kctl');
    var c = { row: r, input: null, boolText: null };

    if (r.shape === 'struct') {
      /* structBox 会把那个可编辑的框登记到 c.input 上 —— refresh 靠它做两件事：
       * 把框里的字跟 edits 对齐、以及**不动正在打字的那一块**。 */
      ctl.appendChild(structBox(r, c));
    } else {
      var inp = document.createElement('input');
      inp.className = 'mdl-kinput';
      inp.setAttribute('aria-label', r.key);
      if (r.shape === 'bool') {
        inp.type = 'checkbox';
        inp.checked = !!cur(r);
        inp.addEventListener('change', function () { setEdit(r, inp.checked); });
        var t = el('span', 'mdl-kbool', String(!!cur(r)));
        c.boolText = t;
        ctl.appendChild(inp);
        ctl.appendChild(t);
      } else if (r.shape === 'num') {
        inp.type = 'number';
        inp.step = 'any';
        inp.value = String(cur(r));
        inp.addEventListener('input', function () { setNum(r, inp); });
        ctl.appendChild(inp);
      } else {
        inp.type = 'text';
        inp.value = String(cur(r));
        inp.addEventListener('input', function () { setEdit(r, inp.value); });
        ctl.appendChild(inp);
      }
      c.input = inp;
    }

    row.appendChild(ctl);
    var dl = docLine(r);                 // null = 这个键不摆占位（见 docLine）
    if (dl) row.appendChild(dl);
    ctlRows.push(c);
    return row;
  }

  /**
   * 「这个对象没填」的一行 —— 骨架里有、它 objdata 里没有的键。
   *
   * 只有一个动作：按骨架默认值加上。**不给输入框** —— 给了框就得决定"框里的字算不算
   * 已经填了"，而那个决定一旦错了，屏幕和写回去的东西就对不上（这一版全在躲这件事）。
   * 加上之后这一行会换成带控件的普通行。
   *
   * ⚠ **这一步是单向的**：原先加错了还能按那一行的「↺ 默认」退回"没填"，那个按钮
   * 2026-09-22 跟着"还原回默认"那一套一起去掉了，所以现在只能关掉浮层重来。用户知道
   * 这件事（选范围时写明了"＋按默认值加上会变成单向操作"）。要留口子的话得单独说。
   */
  function absentRow(r) {
    var row = el('div', 'mdl-krow mdl-krow-absent');
    rowEls[r.key] = row;
    row.appendChild(el('span', 'mdl-kname', r.key));

    var ctl = el('div', 'mdl-kctl');
    ctl.appendChild(el('span', 'tag tag-absent', '这个对象没填'));
    /* 那个 ＋ 是图标（跟 ✎/⚙ 一起换的），所以按钮里是「图标 + 文字」两截 ——
       .mdl-add 得挂内联 flex，见 css。 */
    var add = el('button', 'mdl-add', '按默认值加上');
    add.type = 'button';
    add.insertBefore(icon('plus'), add.firstChild);
    add.title = '按插入骨架里的默认值加上这个键：' + brief(r.def);
    add.addEventListener('click', function () {
      edits[r.key] = r.def;
      redrawRow(r);                 // 从此按"有值"那一行画（带控件）
      refresh();
    });
    ctl.appendChild(add);

    row.appendChild(ctl);
    var dl = docLine(r);                 // 同上：骨架里没有这个键就不摆占位
    if (dl) row.appendChild(dl);
    return row;
  }

  /**
   * 画一屏详情。**两个模式唯一的画家** —— 标题 / 键表 / 底下的注 / 按钮文案全在这儿，
   * 上层只负责把行准备出来（docOf 或 rowsOfObject）和把接缝接上。
   *
   * @param {Object} d { mode, desc, rows, title, sub, notes: [string],
   *                     btnLabel, keysHead }
   */
  function paint(d) {
    lastMode = d.mode;
    lastKeys = d.rows.length;
    lastRows = d.rows;

    mtitle.textContent = d.title;
    msub.textContent = d.sub;
    mdesc.textContent = d.desc || '';
    mdesc.hidden = !d.desc;

    mkeys.textContent = '';
    mnotes.textContent = '';
    ctlRows = [];
    rowEls = {};

    if (d.rows.length) {
      mkeys.hidden = false;
      mkeysH.hidden = false;
      mkeysH.textContent = d.keysHead;
      d.rows.forEach(function (r) { mkeys.appendChild(fieldRow(r)); });
    } else {
      mkeys.hidden = true;
      mkeysH.hidden = true;
    }

    /* 带警告色的那几条**排在前面**：它们说的是"按下去会发生什么"，用户按之前最该看到；
     * 灰字那几条是"这张表是怎么来的"，读不读都不影响他按不按。 */
    (d.warns || []).forEach(function (n) { note(n, 'warn'); });
    (d.notes || []).forEach(function (n) { note(n); });

    insertBtn.textContent = d.btnLabel;

    /* 按钮的可按性**只由 refresh 一处说了算**（填错了 / 没波次 / 一处没改都在这儿
     * 汇总），别在这上面再补一句 insertBtn.disabled —— 两处各写各的，早晚有一处
     * 是旧的。 */
    refresh();
  }

  /** 插入那一档的详情。 */
  function renderDetail(meta) {
    var d = docOf(meta);
    ui.objClass = meta.objClass;

    var isEvent = ui.kind === 'event';
    waveWrap.hidden = !isEvent;

    /* 「代号」那一格。
     *
     *   模块  露出来，预填元数据里的默认别名。**改了才递下去**（见 doSubmit）——
     *         没改的话走的还是"默认别名 + 去重"那条路，跟这一格出现之前一模一样。
     *   事件  不露。事件的代号是 `Wave<第几波><默认别名><序号>` 拼出来的，改它就得
     *         连带改波次号，那是另一回事（见 Edit.insertEvent）。
     *
     * 指向**别的文件**的模块（defaultSource 不是 CurrentLevel）这一格是**灰的**：
     * `RTID(代号@LevelModules)` 里那个代号说的是参考文件里那个对象的名字，本文件改不动
     * 它 —— 改了写下去就是一条谁也接不上的引用。2026-09-22 用户点名的："指向
     * levelmodules 或其他地方的模块不能重命名代号，因为参考文件是不能被同步改名的"。
     * 灰着的同时底下必须有一句为什么，否则读起来像功能坏了。
     * 第二道闸在 Edit.insertModule（接缝不只浮层一个调用方）。
     */
    if (isEvent) {
      aliasWrap.hidden = true;
      aliasOrig = '';
      aliasVal = '';
    } else {
      aliasOrig = meta.defaultAlias || meta.objClass;
      aliasVal = aliasOrig;
      aliasIn.value = aliasOrig;
      var foreign = !!(meta.defaultSource && meta.defaultSource !== 'CurrentLevel');
      aliasIn.disabled = foreign;
      setAliasHint(foreign
        ? '这个模块的对象定义在 ' + meta.defaultSource + ' 里，代号说的也是那个文件里的名字 —— ' +
          '改了本文件就对不上它，所以这一格改不了'
        : '');
      aliasWrap.hidden = false;
    }
    var notes = [];
    var warns = [];

    if (d.mode === 'auto') {
      notes.push('键名和值都是从插入骨架读出来的（data/module-skeletons.js）—— 值可以直接改，' +
        '改完按插入就按改过的写。这一档还没有人工说明：给 ModuleDocs 里这个模块的键写上中文，' +
        '这里就换成带说明的版本。');
    } else if (d.mode === 'none') {
      notes.push(meta.defaultSource === 'LevelModules'
        ? '引用型模块：对象定义在 LevelModules 里，插入只给本关卡挂一条 RTID、不新建对象，所以没有可列的键。'
        : '这个模块在插入骨架表（data/module-skeletons.js）里没有条目，键表待补。');
    }

    if (!isEvent) {
      var box = containerItem();
      if (box) {
        /* 容器：一份关卡只能有一个，而且它不是模块。已经有了就别让用户白按一下
         * （Edit.insertModule 会拒，原因回到按钮上面 —— 但那要按下去才看得到）。 */
        if (meta.isContainer && hasClass(box.objClass)) {
          warns.push('这份关卡里已经有一个「' + box.title + '」了 —— 一份关卡只能有一个，再插会被拦下来。');
        }
        /* 波次管理器指着波次容器（它的 WaveManagerProps 键里是个 RTID）。这份关卡一个
         * 容器都没有时按插入会**顺带建一个** —— 容器不在 Modules 里，没有别的入口能建，
         * 不建写下去就是一条悬空引用。会多出一个对象这件事，用户按之前得知道。 */
        if (meta.objClass === 'WaveManagerModuleProperties' && !hasClass(box.objClass)) {
          warns.push('这份关卡还没有' + box.title + ' —— 按「插入」会一起建一个' +
            '（波次列表和倒计时参数都挂在那个对象上）。');
        }
      }
      /* 非 allowMultiple 的模块重复插入是**允许**的（Edit.insertModule 那边去重别名），
       * 两个都挂进 Modules、运行时只有其中一个生效 —— 2026-09-22 用户要的正是这一句提示：
       * "已有不可重复模块的话允许插入但是要提示会相互覆盖"。判据跟去重用的是同一个
       * （Edit.moduleExists），两边各判各的迟早会分叉。 */
      if (!meta.allowMultiple && !meta.isContainer && moduleExists(meta)) {
        warns.push('这份关卡里已经有一个「' + meta.title + '」了 —— 再插一个，两个都会挂进 ' +
          'Modules，运行时只有其中一个生效（相互覆盖）。');
      }
    }

    if (isEvent) {
      var n = fillWave();
      if (!n) notes.push('这份关卡还没有波次 —— 先插入「波次管理器」模块，事件才有地方挂。');
    }

    paint({
      mode: d.mode,
      desc: d.desc,
      rows: d.rows,
      title: meta.title,
      sub: meta.objClass +
        (meta.defaultAlias ? '  ·  别名 ' + meta.defaultAlias : '') +
        (meta.defaultSource ? '  ·  ' + meta.defaultSource : ''),
      notes: notes,
      warns: warns,
      keysHead: '插入时的值（' + d.rows.length + ' 个键，改完按插入就按这个写）',
      btnLabel: isEvent ? '插入到选中的波' : '插入到本关卡'
    });
  }

  /**
   * 改参数那一档的详情。
   * @param {Object} snap { index, objclass, title, sub, data }
   */
  function renderObject(snap) {
    var d = rowsOfObject(snap);
    ui.objClass = snap.objclass;
    waveWrap.hidden = true;                 // 改参数跟"插到第几波"无关

    /* 「代号」那一格。
     *
     * 这一格补的是**文本模式缺的那一层保护**：图形界面里改别名会自动同步引用，
     * 直接改文本没有，用户手改一处、漏改十处，改完就是一条条悬空引用 —— 而屏幕上
     * 一点异样都没有。这里改的是本文件里所有 `RTID(老代号@CurrentLevel)`，
     * 别的来源（@LevelModules 之类指的是别的文件）一个都不碰，理由见 Edit.renameAlias。
     *
     * 两件事把框变灰，理由不一样，底下那句灰字也跟着不一样：
     *   没有别名   改名的前提是"有个名字可改"。给它现编一个名字是另一件事（加别名），
     *              不在这版里，所以照实说。
     *   指向别处   这个 objClass 在注册表里 defaultSource 不是 CurrentLevel —— 引用指的
     *              是参考文件里的对象，本文件改不动它（2026-09-22 用户点名的）。
     *              注册表里没有这个 objClass（没建模的对象）算"指向别处"**否**：
     *              它就在本文件里，改名的后果只在本地，照旧让他改。 */
    var rmeta = currentMeta();
    var foreign = !!(rmeta && rmeta.defaultSource && rmeta.defaultSource !== 'CurrentLevel');
    aliasOrig = snap.alias || '';
    aliasVal = aliasOrig;
    aliasIn.value = aliasOrig;
    aliasIn.disabled = !aliasOrig || foreign;
    /* 底下那句"改完按保存…" 2026-09-22 用户点名去掉（灰字，跟这一格要做的事重复）。
     * 剩下这两句都**不是**在解释这个框怎么用，是在解释它为什么是灰的 —— 删了用户
     * 会以为功能坏了。 */
    setAliasHint(foreign
      ? '这个对象属于「' + rmeta.title + '」—— 那个模块的引用指向 ' + rmeta.defaultSource +
        '（别的文件），代号改不了'
      : (aliasOrig ? '' : '这个对象没有别名，改不了代号 —— 要加别名得到文本里写'));
    aliasWrap.hidden = false;

    /* 「没填」只有一个判据：isPresent（见那儿）。这里曾经写的是 `r.present === false`，
     * 于是刚点过「＋」的行**同时**算"有值"（画成了带控件的一行）和"没填"（还记在
     * absent 里）—— 两个说法对不上，屏幕上那个数字就是错的。 */
    var absent = d.rows.filter(function (r) { return !isPresent(r); }).length;
    var notes = [];
    /* 这里曾经还有一条「键名和值都是从**这个对象当前的 objdata** 读出来的……」——
     * 2026-09-22 用户点名删掉（"留着没意义"）：用户要改的是键，不是这张表从哪读的；
     * 而"这一档还没有人工说明"那句由每一行底下的「待添加注释」占位说了，不用再交代
     * 一遍（占位只摆给骨架里在列的键，见 docLine —— 没有骨架的 objClass 连一句都不说，
     * 那是对的：它没有一个键注得进去）。 */
    if (absent) {
      notes.push('最后 ' + absent + ' 个键的骨架里有、这个对象没填 —— 想加就点「＋ 按默认值加上」，' +
        '值取插入骨架里的默认值（多半是个空数组，等你到文本里填）。');
    }

    paint({
      mode: d.mode,
      desc: d.desc,
      rows: d.rows,
      title: snap.title,
      sub: snap.sub,
      notes: notes,
      keysHead: '这个对象的参数（' + (d.rows.length - absent) + ' 个键，改完按保存）',
      btnLabel: '保存'
    });
  }

  /**
   * 开浮层。
   * @param {Object} meta    Modules 里那条元数据
   * @param {string} kind    'module' | 'event'
   * @param {HTMLElement} entry 触发它的那一行，关的时候把焦点还给它
   */
  function openOverlay(meta, kind, entry) {
    ui.kind = kind;
    ui.mode = 'insert';
    editId = null;
    ui.waveIndex = 0;
    begin(entry);
    renderDetail(meta);
  }

  /**
   * 开**改参数**那一档 —— 对象树上那个 ✎ 走这儿。
   *
   * @param {Object} snap { index, objclass, title, sub, data } —— data 是**快照**
   *   （main.js 从当前解析结果里摘出来的一份 objdata）。浮层不持对象引用：结构操作
   *   之后 objects 是重新解析的一批新实例，留着旧引用就是在改一个文件里已经不在的对象。
   * @param {HTMLElement} entry 触发它的那个 ✎，关的时候把焦点还给它
   */
  function openObject(snap, entry) {
    if (!snap || !snap.objclass) return;
    ui.kind = 'module';                 // 对象编辑没有"插到第几波"这回事
    ui.mode = 'edit';
    editId = { index: snap.index, objclass: snap.objclass, title: snap.title };
    begin(entry);
    renderObject(snap);
  }

  /** 开浮层之前两档共用的那点事。 */
  function begin(entry) {
    /* 窄屏的抽屉是 main.js 的约定（body.sidebar-open 不会自己消失，不收掉的话
     * 关掉浮层后抽屉又"开着"冒出来）。 */
    if (ctxRef.onOpen) ctxRef.onOpen();
    ui.open = true;
    lastEntry = entry || null;
    /* 表单状态**每次开都清空**：换一个模块看详情，上一次改的值不该跟着过去 ——
     * 那两个模块的键根本不是一回事（改参数那一档更是另一个对象的另一批键），
     * 带着一份"上一次的改动"过去只会让人以为默认值/当前值就是那样。 */
    edits = {};
    badKey = null;
    badMsg = '';
    /* 代号那一格也清空。renderDetail / renderObject 会紧接着把值填上；留在这儿是为了
     * 两档互相切换时不会带着上一个模块/对象的代号值（切过去的那一档如果没填，
     * 显示的就是上一档的名字）。 */
    aliasOrig = '';
    aliasVal = '';
    if (aliasIn) { aliasIn.value = ''; aliasIn.disabled = false; }
    if (aliasHint) setAliasHint('');
    say('');
    modal.hidden = false;
    modal.focus();
  }

  /** 关闭。✕ / Esc / 点浮层外三路都走这里。 */
  function closeOverlay() {
    if (!ui.open) return;
    say('');
    ui.open = false;
    modal.hidden = true;
    /* 焦点还给触发它的那一行，键盘用户不至于被丢回页首。**藏起来的不算数**：
     * 窄屏时抽屉已经被 onOpen 收掉了，那一行就在 hidden 里，对 hidden 的元素
     * focus() 是空转，人还是被丢回 <body>。退路有两级：先找一行露着的（侧栏这会儿
     * 正开着的话一定有），再退到「模块」页签按钮 —— 它永远露着。 */
    var back = (lastEntry && lastEntry.closest && lastEntry.closest('[hidden]')) ? null : lastEntry;
    if (!back) {
      rows.forEach(function (r) {
        if (!back && r.btn.closest && !r.btn.closest('[hidden]')) back = r.btn;
      });
    }
    if (!back) back = document.querySelector('.tabs button[data-tab="modules"]');
    if (back && back.focus) back.focus();
  }

  /**
   * 按底下那个按钮 —— 插入那一档是「插入」，改参数那一档是「保存」。
   *
   * 接缝返回 {ok, reason}，**不是**自己 toast 完就算 —— 面板要拿 ok 决定关不关浮层。
   * 失败时浮层留着并把 reason 写在按钮上面：这一屏正是用户要读的东西（键表、是哪个
   * 模块 / 哪个对象），关掉它等于把人从案发现场赶走。
   *
   * 两档都**先问 collect()**：它是"这次到底写什么"的唯一出处。填得不对（数字框空着）
   * 时它返回 null，一个字节都不写。
   */
  function doSubmit() {
    /* 浮层关着的时候这个按钮当然看不见，但**看不见不等于按不动** —— 按钮扫雷
     * （check-boot 第 6 节）就是照 DOM 点的，看不见的它照点。少了这道闸，
     * 一次扫雷会在用户根本没看着浮层的情况下往关卡里插东西。 */
    if (!ui.open) return;

    if (ui.mode === 'edit') return doSave();

    var meta = currentMeta();
    if (!meta) return;

    /* 表单一整棵收出来交给 main.js —— 没改过的键也在里面（值就是骨架默认值）。
     * 传**整棵**而不是"改动的那几个键"：插入要的就是一份完整的 objdata，让 main.js
     * 拿着骨架再补一遍，就又多了一处"两边各拼一半"的机会。
     *
     * 一个键都没有（引用型模块、骨架里没这个 objClass）时传 null，不是 {} ——
     * `{}` 会被 Edit.insertModule 当成"有骨架"，于是给它凭空建一个空对象出来。 */
    var values = lastRows.length ? collect() : null;
    if (lastRows.length && !values) { say(badMsg || '有键填得不对'); return; }

    /* 代号只在**改过**时才递（跟 doSave 同一条约定）。递一个"没动过的默认别名"
     * 过去，会跳过 main.js / Edit 那一侧的去重（`base` → `base1`），插第二个
     * 「可多个」的模块当场撞名被拒 —— 而用户什么都没填。 */
    var alias = aliasChanged() ? aliasVal.trim() : null;

    var r;
    if (ui.kind === 'event') {
      var idx = parseInt(waveSel.value, 10) || 0;
      if (!idx) { say('这份关卡还没有波次，先插入「波次管理器」模块'); return; }
      ui.waveIndex = idx;
      r = ctxRef.onInsertEvent(meta, idx, values);
    } else {
      r = ctxRef.onInsertModule(meta, values, alias);
    }
    if (!r || !r.ok) { say((r && r.reason) || '插入失败'); return; }
    closeOverlay();
  }

  /**
   * 按「保存」（改参数那一档）。
   *
   * values 是**只含改动过的键**的一张表；第二个参数是新代号（没改就是 null）。
   * 传的是 editId（位置 + objClass）而不是对象，理由见 openObject —— 认人这一步在
   * main.js 那一侧，认不上就拒绝并说明原因，绝不"差不多就写这个吧"。
   *
   * 两件事在 main.js 那边是**同一次结构操作**（= 一步撤销），所以这里一起递过去，
   * 不拆成"先改名再保存"两次调用 —— 那样按一次保存要按两次 Ctrl+Z 才回得去。
   */
  function doSave() {
    if (!editId) return;
    var values = collect();
    if (!values) { say(badMsg || '有键填得不对'); return; }
    /* 代号只在**改过**时才递。递一个"没动过的原值"过去，main.js 那一侧要白跑一遍
     * 改名（它靠 null 判断"这次要不要改代号"）。 */
    var alias = aliasChanged() ? aliasVal.trim() : null;
    if (!Object.keys(values).length && !alias) { say('一个键都没改，代号也没改'); return; }
    var r = ctxRef.onSaveObject(editId, values, alias);
    if (!r || !r.ok) { say((r && r.reason) || '保存失败'); return; }
    closeOverlay();
  }

  /** 浮层正开着的那个模块的元数据。按 objClass 现去表里找 —— 存 meta 引用的话，
   *  数据表重建过之后浮层还捏着旧对象。 */
  function currentMeta() {
    var M = window.ZLevel.Modules;
    var groups = ui.kind === 'event' ? M.eventGroups : M.moduleGroups;
    var hit = null;
    groups.forEach(function (g) {
      g.items.forEach(function (m) { if (!hit && m.objClass === ui.objClass) hit = m; });
    });
    return hit;
  }

  // ── 组装 ────────────────────────────────────────────────────────────

  /**
   * 建面板。**幂等** —— 切页签每次都会调，只有第一次真建。
   * @param {HTMLElement} hostEl  #panel-modules
   * @param {Object} ctx  { onInsertModule(meta, values),
   *                        onInsertEvent(meta, waveIndex, values),
   *                        onSaveObject(id, values, newAlias), onWaveCount(),
   *                        onHasClass(objClass), onModuleExists(meta), onOpen() }
   *   接缝都在 main.js 那一侧：toast 是那个文件的模块私有函数，面板够不到；
   *   onWaveCount / onHasClass / onModuleExists / onSaveObject 要读当前关卡
   *   （面板不该自己去 state.get()）。
   *   onInsert* / onSaveObject 返回 {ok, reason} —— ok 决定浮层关不关，
   *   reason 是给用户看的那句话。newAlias 没改代号时是 null（见 doSave）。
   */
  function ensure(hostEl, ctx) {
    if (built) return;
    built = true;
    host = hostEl;
    ctxRef = ctx;

    buildSide();
    buildModal();
    /* 这里**不** renderDetail：浮层还藏着，没内容可画。开的时候再画。 */
  }

  return {
    ensure: ensure,
    /* 对象树上那个 ✎ 走这儿开**改参数**那一档（见 openObject）。 */
    openObject: openObject,
    /* 给自检用的只读快照。不是为了调试方便 —— check-boot 要断言
     * 「点一行开的是这个模块、浮层里画出了键表、点插入之后浮层关掉了」，它得能问出
     * "现在开着的是哪一个、键表走的是哪一档"，而不是靠读 DOM 里的 .mdl-krow 个数
     * 反推（那样把三档降级写岔了也能过）。 */
    state: function () {
      return {
        open: ui.open,
        mode: ui.mode,
        objClass: ui.objClass,
        kind: ui.kind,
        waveIndex: ui.waveIndex,
        keysMode: lastMode,
        keys: lastKeys,
        canInsert: !!(insertBtn && !insertBtn.disabled),
        insertLabel: insertBtn ? insertBtn.textContent : '',
        /* 表单这一份：自检要断言"改了值之后插进去的真的是改过的那个"，
         * 而它不能去 DOM 里读输入框 —— 那样连"输入框接没接上"都验不到。 */
        shapes: lastRows.map(function (r) { return r.shape; }),
        edited: Object.keys(edits),
        /* 这个对象**没填**的键（改参数那一档才有）。自检要断言这些行真的画成了
         * 「＋ 加上」，而不是一个有值的控件 —— 那正是"屏幕说一套、写下去另一套"的入口。 */
        absent: lastRows.filter(function (r) { return !isPresent(r); })
          .map(function (r) { return r.key; }),
        /* 这次按下去会写什么：插入是整棵 objdata，改参数只含改动过的键。 */
        values: lastRows.length ? collect() : null,
        badKey: badKey,
        /* 代号那一格（插入 / 改参数两档都有，事件那一档没有）。自检要断言"改了代号
         * 之后按保存，文本里那个对象的别名和指向它的键都变了"，而它不能去 DOM 里
         * 读输入框。 */
        alias: {
          orig: aliasOrig,
          val: aliasVal,
          changed: aliasChanged(),
          bad: aliasBadMsg(),
          shown: !!(aliasWrap && !aliasWrap.hidden),
          disabled: !!(aliasIn && aliasIn.disabled)
        }
      };
    }
  };
})();
