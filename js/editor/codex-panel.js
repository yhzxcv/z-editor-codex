/* 图鉴：侧栏只当入口索引，列表在一个盖住编辑区的浮层里
 *
 * 数据层是现成的（js/codex.js 的 Codex + data/ch-*.js，2333 条 / 5 类）。
 * 这个文件管两件事，分得很开：
 *
 *   侧栏（#panel-codex）  顶上一排「复制格式」三档，底下是**三级目录**，照旧图鉴站的
 *                         侧栏：可折叠的类别总目录 → 大类名 → 次级项。**一个输入框都
 *                         没有**，列表也不在这儿。三级**每一级都能点**，点了都是"切到
 *                         这一类" —— 越深的那一级顺带滚到它那一段（2026-09-22 定的，
 *                         见下面 searchScope 与 buildTree）。
 *   浮层（.codex-modal）  搜索框 + 排列密度 + 次级目录 + 条目列表。内容是**一整个类别**
 *                         （大类名分隔、次级标题分段，全平铺）。搜索**只搜当前这一类**，
 *                         没有范围筛选（同上）。
 *                         次级目录宽屏收起来（跟侧栏重复），窄屏换成顶上一行横滑
 *                         的 chip（仿旧站的 .groupbar，见 setAt 下面那段）。
 *
 * ── 为什么列表要搬出侧栏 ──
 *
 * 侧栏是 310px。最坏的类别（僵尸代码）有 1048 条，条目行要摆「名字 / 代码 /
 * 类名」三段，塞进那条窄缝里全靠省略号活。图鉴不是"来插一条就走"的面板，它是
 * 常驻浏览面 —— 所以侧栏退回它擅长的角色（一列入口），列表搬到一个有宽度的地方。
 *
 * ── 手势：点击复制 / 长按插入 ──
 *
 * 反过一次。上一版是「点一下 = 往光标处插一条」，于是每查一条就误插一条 ——
 * 在这里"查"才是主要动作，"插"是少数。现在跟旧图鉴站一致：**点击 = 复制**，
 * 插入走**长按**（500ms）。
 *
 * 插入**没有可见按钮**，是本次唯一一处"变差"的地方：长按不好发现。代价写进了
 * docs/design-notes.md。换成给每行加个插入按钮的话，一屏几百行就多出几百个按钮，
 * 而行的宽度本来就紧。也因为长按占了手势，行内文字**不能再选中**
 * （.codex-item 的 user-select:none）
 * —— 旧站给 .it-code 留 user-select:text 是为了"复制失败时手动选"，那理由在这里
 * 跟长按打架。
 *
 * ── 为什么状态放模块作用域，而且面板只建一次 ──
 *
 * 侧栏其他面板都是**整块重建**的（panels.js / tree.js 都以 host.textContent = ''
 * 开头），重建就丢输入框内容、焦点、展开态、滚动位置。它们各自有对策：
 * 对象树靠模块级的 collapsed 兜住折叠态，模块栏靠 main.js 的 insertPanelState
 * 节流兜住搜索框。
 *
 * 图鉴栏两条都用不上，因为它跟**文档状态毫无关系** —— 关卡的增删改不会让图鉴
 * 多出一条植物。所以最省心也最正确的做法是**建一次、永不重建**：DOM 常驻，
 * ui 只作为渲染输入。这就是 main.js 的 onStateChange 里**没有**这个面板的原因，
 * 也是浮层能扛住"浮层开着时在编辑器里打字"的原因。
 *
 * 拦住"顺手重建"的是 ensure() 开头那句 `if (built) return;` —— **它是承重的，
 * 不是省几毫秒的优化**：去掉它，切走再切回来就会重置 ui，打开的浮层当场跳回
 * 第一个类别。（tools/check-boot.js 的「侧栏」一节 + tools/mutate.js 的 M14/M15
 * 盯着这件事。）那句在文件里**必须只有一处**，别在新代码里再抄一遍。
 *
 * ── 加载顺序 ──
 *
 * 下面第一行在**加载期**读 window.ZEditor.Panels.el，所以 index.html 里本文件
 * 必须排在 panels.js 之后。排错的话 check-editor.js 的早读探测器会当场报出来。
 */
window.ZEditor = window.ZEditor || {};
window.ZEditor.CodexPanel = (function () {
  'use strict';

  var el = window.ZEditor.Panels.el;
  var icon = window.ZEditor.Panels.icon;
  var iconBtn = window.ZEditor.Panels.iconBtn;

  /* 长按判定阈值。跟系统"长按弹菜单"的观感对齐；短于这个数是点击。 */
  var HOLD_MS = 500;

  var FORMATS = [['plain', '纯代码'], ['quoted', '带引号'], ['rtid', 'RTID']];
  /* 跟原图鉴站共用这个键：两边改格式互相同步，用户不用改两次。
     ⚠ 默认档 `quoted` 别动 —— tools/mutate.js 的 M20 期望文案里写着它。 */
  var FMT_KEY = 'zeditor.copyFormat';

  /* 排列密度三档。照旧图鉴站的形状（属性 + CSS token 换挡），但**挂在浮层上、
     不挂 :root** —— 旧站整站只有图鉴，这个应用里 :root 上的 data-density 会漏进
     编辑器和另外两个页签。标准档 = **把属性删掉**，跟旧站 applyDensity 一样。 */
  var DENSITIES = [['loose', '宽松'], ['standard', '标准'], ['tight', '紧凑']];
  var DENS_KEY = 'zeditor.codexDensity';

  /* 「类别」那一段折叠着没有。一个布尔而已，就存 '1' / '0'，不值得为它上 JSON。 */
  var FOLD_KEY = 'zeditor.codexFoldChapters';

  var ui = {
    chapterId: null, q: '',
    fmt: 'quoted', density: 'standard',
    open: false
  };
  /* 当前高亮的分组下标 —— **类别之内**的扁平下标，同时是 groupEls / idxBtns 的下标、
     侧栏那一行的 dataset.idx。它跟滚动位置绑，不跟文档状态绑。
     （浮层曾经按大类切，那时它是"大类之内"的下标；改成整个类别之后列表长了，但
     这个恒等式没变，所以侧栏高亮仍然是一次整数比较，不用换算。） */
  var at = 0;

  /* 侧栏目录翻到哪一类、浮层在读哪一类 —— **现在是同一个数**（ui.chapterId），
   * 所以这儿没有第二个变量。
   *
   * 原先切过一刀：viewCh（目录翻到哪）跟 ui.chapterId（浮层在读哪）各记各的，点类别行
   * 只翻目录、不动浮层。2026-09-22 用户点名把这一刀合上，原话是「侧边栏点击上面的
   * 大类浮窗就应该跟着切换，而不是等到选择了次级分类」。于是三级目录**每一级都成了
   * 入口**：类别行切到那一类，大类名切到那一类并滚到那一段，次级项切到那一段。
   *
   * ⚠ 别再照着"两边各记各的"改回去。两个数一旦能分叉，markActive() 里那几条比较
   * （章行高亮、露哪一块、次级项亮哪一行）就必然有一条退化成恒真 —— check-boot 里
   * `st.section === st.section` 那条恒真断言就是因为同样的理由被删掉的，同一类毛病。
   */

  /* 「类别」那一段折叠着没有。默认展开 —— 折叠是类别多到开始挤目录时才需要的
   * 动作，不该让第一次来的人先面对一个收起来的东西（旧站 foldChapters 同理）。 */
  var foldChs = false;

  /* 多选**预留**：结构在这儿，行为没写。见 row() 与 foot 的说明。 */
  var selected = Object.create(null);
  var multi = false;

  var built = false;
  var ctxRef = null;
  var host = null;                       // #panel-codex，只放入口
  /* [{chapterId, idx, btn}] 次级项行。idx 是**类别之内**的扁平下标，跟浮层的 `at`
     是同一个数 —— 侧栏那一行亮不亮，靠的就是这一次整数比较。 */
  var entryBtns = [];
  var chRows = [];                       // [{chapterId, btn}] 总目录那一列
  var treeBlocks = [];                   // [{chapterId, block}] 每个类别一个目录块
  var chlist = null, foldBtn = null, foldIco = null;
  var lastEntry = null;                  // 关浮层时把焦点还给它

  var modal = null, mtitle = null, mclose = null;
  var input = null, fmtSeg = null, dseg = null;
  var midx = null, out = null, foot = null;

  /* 当前浏览态里各分组标题的元素，按下标对齐**整个类别的扁平分组列表**。
   * 滚动高亮扫的是**它**，不是全部条目 —— 最多 31 个，所以不必像旧站那样上
   * requestAnimationFrame 节流（旧站扫的是上千条 .item）。不加节流还有个实在的
   * 好处：check-boot.js 是全同步套件，rAF 回调跑不到，加了节流那条断言就只能靠
   * 打桩才测得动。 */
  var groupEls = [];
  var idxBtns = [];

  /* ── 长按状态机 ──────────────────────────────────────────────────────
   *
   * 只有**一个**"当前按压"，不是每行一个闭包。三个残留逼出来的：
   *
   *   触屏长按弹原生菜单之后浏览器**可能不发 click** —— 每行一个 held 布尔
   *   会永久留 true，那行以后点不动。
   *   列表重画 / 浮层关闭时挂起的定时器**不会自动清** —— 到点对着一个游离
   *   节点调 onInsert()，往文档里插一条用户根本没长按的东西。
   *   同一时刻只可能有一个指针在按。
   */
  var press = null;      // { timer, btn, x, y }
  var heldBtn = null;    // 长按已经触发过的那一行；它接下来那次 click 不算"点击"

  function cancelPress() {
    if (press) { clearTimeout(press.timer); press = null; }
  }
  /** 重画和关浮层都要走这个：取消挂起的定时器**并且**清掉长按残留。 */
  function resetPress() { cancelPress(); heldBtn = null; }

  // ── 数据 ────────────────────────────────────────────────────────────

  function chapters() {
    return (window.Codex && window.Codex.chapters) || [];
  }

  function chapterById(id) {
    var list = chapters();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0] || null;
  }

  /** 这一个类别有哪几个大类，按数据里的先后顺序（也就是图鉴原来的顺序）。 */
  function sectionsOf(ch) {
    var seen = Object.create(null), list = [];
    ((ch && ch.groupUnits) || []).forEach(function (u) {
      var s = u.section || '未分类';
      if (!seen[s]) { seen[s] = 1; list.push(s); }
    });
    return list;
  }

  function sectionUnits(ch, section) {
    return ((ch && ch.groupUnits) || []).filter(function (u) {
      return (u.section || '未分类') === section;
    });
  }

  /** 把一个类别 id 归一成真实存在的那个。浮层是按**整个类别**画的，不再需要
   *  「把章和大类配成一对、配不上就退回第一类」那套（那套是浮层还按大类切的时候
   *  要的：侧栏目录可以翻到一类、而上次读的是另一类）。 */
  function normCh(id) {
    var ch = chapterById(id);
    return ch ? ch.id : null;
  }

  // ── 持久化的三样设置 ────────────────────────────────────────────────

  function readFmt() {
    try { return localStorage.getItem(FMT_KEY) || 'quoted'; } catch (e) { return 'quoted'; }
  }
  function writeFmt(f) {
    try { localStorage.setItem(FMT_KEY, f); } catch (e) { /* 隐私模式存不了，不影响本次 */ }
  }

  function readDensity() {
    try {
      var v = localStorage.getItem(DENS_KEY);
      for (var i = 0; i < DENSITIES.length; i++) if (DENSITIES[i][0] === v) return v;
      return 'standard';
    } catch (e) { return 'standard'; }
  }
  function writeDensity(d) {
    try { localStorage.setItem(DENS_KEY, d); } catch (e) { /* 同上 */ }
  }

  function readFold() {
    try { return localStorage.getItem(FOLD_KEY) === '1'; } catch (e) { return false; }
  }
  function writeFold(v) {
    try { localStorage.setItem(FOLD_KEY, v ? '1' : '0'); } catch (e) { /* 同上 */ }
  }

  // ── 格式 ────────────────────────────────────────────────────────────

  /** 这一条按当前格式该复制什么。纯展示，不碰 DOM。 */
  function textFor(it, ch) {
    // 条目级 rtid 覆盖类别的；「写成空串」= 这条明确没有 RTID 表，回退带引号
    var table = it.rtid !== undefined ? it.rtid : ch.rtid;
    if (ui.fmt === 'plain') return it.code;
    if (ui.fmt === 'rtid' && table) return '"RTID(' + it.code + '@' + table + ')"';
    return '"' + it.code + '"';
  }

  /**
   * 选了 RTID 却拼不出表名时的保留意见，拼在成功提示后面。
   *
   * 旧图鉴站的 formatCopy 就是这么做的，理由是**诚实**：用户选了 RTID、拿到手的
   * 却是带引号的裸代码，不说明会以为是 bug。回退本身是对的（条目级 rtid 是空串
   * 表示这条明确没有 RTID 表），但必须说一声。
   */
  function noteFor(it, ch) {
    var table = it.rtid !== undefined ? it.rtid : ch.rtid;
    return (ui.fmt === 'rtid' && !table) ? '本类别无 RTID 表，回退带引号' : '';
  }

  // ── 渲染 ────────────────────────────────────────────────────────────

  /**
   * 列表里的一行。浏览态和搜索态**共用这一个工厂** —— 两套行渲染迟早会长歪，
   * 而它们要显示的东西本来就一样（名字 / 代码 / 类名）。
   */
  function row(it, ch) {
    var b = el('button', 'codex-item');
    b.type = 'button';
    b.appendChild(el('span', 'codex-name', it.name));
    b.appendChild(el('span', 'codex-code', it.code));
    b.appendChild(el('span', 'codex-ch', ch.title));
    b.title = '点击复制，长按插入：' + textFor(it, ch);

    /* 只有主键起手势，右键留给原生菜单。 */
    b.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      cancelPress();
      heldBtn = null;                 // 无条件清残留：触屏长按弹菜单后可能没有 click
      var p = press = { btn: b, x: e.clientX || 0, y: e.clientY || 0, timer: 0 };
      p.timer = setTimeout(function () {
        if (press !== p) return;      // 早就被 pointerup / 位移取消了
        press = null;
        heldBtn = b;
        /* 传给 main.js 的是**数组**。现在恒为一条，但多选落地时这里会变成选中的
         * 那几条，而插入路径一个字都不用改。一次 dispatch 是关键：分 N 次会变成
         * N 步撤销。 */
        ctxRef.onInsert([textFor(it, ch)]);
      }, HOLD_MS);
    });

    /* 触屏拖动想滚列表：浏览器决定接管时发 pointercancel，但那要越过 pan 阈值，
     * 阈值内的小幅慢拖不发。所以自己再按位移补一刀。 */
    b.addEventListener('pointermove', function (e) {
      if (!press || press.btn !== b) return;
      if (Math.abs((e.clientX || 0) - press.x) > 10 ||
          Math.abs((e.clientY || 0) - press.y) > 10) cancelPress();
    });

    b.addEventListener('pointerup', cancelPress);
    b.addEventListener('pointercancel', cancelPress);   // 触屏滚动的正主
    b.addEventListener('pointerleave', cancelPress);    // 鼠标拖出按钮；触屏有隐式捕获，不触发

    b.addEventListener('click', function () {
      if (heldBtn === b) { heldBtn = null; return; }    // 这是长按的尾巴，不算点击
      ctxRef.onCopy(textFor(it, ch), noteFor(it, ch));
    });

    /* 触屏长按到点后浏览器还会弹原生菜单，盖在浮层上很难看。只在这条手势真的
     * 发生了时拦 —— 桌面右键在上面的 pointerdown 里就 return 了，不会有 timer，
     * 照旧能用。 */
    b.addEventListener('contextmenu', function (e) {
      if (heldBtn === b || (press && press.btn === b)) e.preventDefault();
    });

    /* 多选预留：将来在这里（name 之前）插一个 .codex-pick 复选框，
     * 并把 ui 的 selected 传给它。行的节点顺序固定，所以只改这一处。 */
    return b;
  }

  /* ── 搜索的类别作用域 ────────────────────────────────────────────────
   *
   * 搜索**只在浮层当前打开的那一个类别里**。2026-09-22 用户定的，原话：「图鉴栏浮窗里
   * 搜索仅允许在当前类别里搜寻代码，不需要侧边栏的搜索入口，不需要筛选范围按钮。
   * 例如在查看植物页面时浮窗顶部的搜索只能搜索到植物代码」。
   *
   * 所以这里没有"勾了哪几类"这回事：作用域就是 ui.chapterId 一个 id。浏览态和搜索态
   * 于是永远看同一类，也就没有"上次筛完忘了改、这次搜什么都搜不到"那个坑 —— 上一版
   * 为了那个坑专门给了条「改为搜索全部代码」的出口，连它一起删了。
   *
   * 实现上是**把这一类喂给 search()**，不是事后过滤 hits —— 事后过滤会让
   * res.total / res.truncated 开始说谎（提示条说"只取了前 400 条"而实际只有 30 条）。
   * M30 的落点。
   */
  function searchScope() {
    var ch = chapterById(ui.chapterId);
    return ch ? [ch] : [];
  }

  // ── 排列密度 ────────────────────────────────────────────────────────

  function applyDensity() {
    if (!modal) return;
    if (ui.density === 'standard') modal.removeAttribute('data-density');
    else modal.setAttribute('data-density', ui.density);
    if (dseg) {
      Array.prototype.forEach.call(dseg.querySelectorAll('button'), function (b) {
        b.classList.toggle('on', b.dataset.density === ui.density);
      });
    }
  }

  function setDensity(d) {
    ui.density = d;
    writeDensity(d);
    applyDensity();
  }

  // ── 次级目录索引 ────────────────────────────────────────────────────
  //
  // 照旧图鉴站：一列分组目录，点一下滚到那一段，滚动时高亮跟着走。
  // 它是「次级」的 —— 一级目录（类别 › 大类）在侧栏，这里列的是**当前类别底下**
  // 的分组。实测每个类别 7~31 组，所以这一列在窄屏那条 chip 上要横着滑。

  function resetIdx() {
    groupEls = [];
    idxBtns = [];
    /* `at` 也得跟着归零。目录收起来的时候没人看它，看着无害 —— 但
       markActive() 现在按 `at` 点侧栏那一行，一个上个类别留下来的 `at`
       就会去点新类别里同号的那一项。今天每次换类别都先经过 openOverlay
       （那儿有 at = 0），所以够不着；靠"够不着"活着的东西不该留着。 */
    at = 0;
    if (!midx) return;
    midx.textContent = '';
    midx.hidden = true;
  }

  /** 画目录。**列的是整个类别的次级项**（不是浮层现在滚到的那一个大类）——
   *  宽屏这一列被 CSS 收起来了，窄屏才是那条横滑 chip，两种形态共用这一份 DOM。
   *
   *  原来这儿有一条 `units.length < 2` 的守卫（"只有一组时不画目录"）。现在整类
   *  最少 7 组（其他代码），永远触发不到 —— 留着的是一条**变异打不红**的分支，
   *  所以删掉而不是留着。 */
  function renderIdx(units) {
    midx.textContent = '';
    midx.hidden = false;
    idxBtns = units.map(function (u, i) {
      var b = el('button', 'codex-idx');
      b.type = 'button';
      b.appendChild(el('span', 'codex-idx-t', u.title));
      b.appendChild(el('span', 'codex-idx-n', String(u.items.length)));
      b.addEventListener('click', function () { gotoGroup(i); });
      midx.appendChild(b);
      return b;
    });
    setAt(0);
  }

  function setAt(i) {
    at = i;
    idxBtns.forEach(function (b, k) { b.classList.toggle('on', k === i); });
    keepChipVisible();
    /* 侧栏那一行跟着亮。`at` 同时是"次级项**在本类别里**的扁平下标"、groupEls /
       idxBtns 的下标、侧栏那行的 dataset.idx —— 四个是同一个数，所以这儿不用换算。
       滚动浮层时 spy() 会走到这儿，侧栏高亮于是跟着列表跨大类走，跟旧站
       markActive() 按 state.activeGroup 点 .side-g 是同一手。 */
    markActive();
  }

  /* ── 窄屏那条横滑的 chip 条 ──────────────────────────────────────────
   *
   * 宽屏下 .codex-midx 整列**收起来**（跟侧栏那份三级目录作用重复，用户点名不要了）；
   * 窄屏下它才是顶上一条横滑的 chip（见 css/app.css 那个断点）。下面三件事只对横的
   * 那一版有意义，宽屏下是**空转** —— 那一列 display:none，scrollLeft 恒 0，也没有
   * 左右边界。
   *
   * 空转，而不是加一句"现在是不是窄屏"：那得问 matchMedia，而它跟样式表里那个断点
   * 是两份真源，迟早对不上（旧站就是让两边各管各的：JS 只管行为，宽度只管样式）。 */

  /** 把当前高亮的那一格滑进视野。**用 scrollLeft 赋值，不是旧站的
   *  `scrollTo({behavior:'smooth'})`** —— jsdom 里 Element.scrollTo 压根不存在
   *  （undefined），照搬会让整套 check-boot 当场炸；而且浮层里的跳转本来就定的
   *  瞬时（见 gotoGroup），高亮跟着列表滚的时候也不该在后面慢慢追。 */
  function keepChipVisible() {
    if (!midx) return;
    var b = idxBtns[at];
    if (!b || !idxBtns.length) return;
    var max = midx.scrollWidth - midx.clientWidth;
    /* ⚠ 减掉第一格的位置：`offsetLeft` 量的是到 **offsetParent 内边距边**的距离
       （这里是 position:fixed 的 .codex-modal），不是到条子滚动原点的距离 ——
       它把条子自己的 padding-left 也算了进去，于是"居中"会恒定偏十几像素。
       第一格的 offsetLeft 正好就是那个常量（内容坐标里它永远是 0），减掉即精确。
       顺带：宽屏那一版这里恒等于 0，`left` 跟着落到负数、被钳回 0，也就是空转。 */
    var left = (b.offsetLeft - idxBtns[0].offsetLeft)
      - midx.clientWidth / 2 + b.offsetWidth / 2;
    midx.scrollLeft = Math.max(0, Math.min(left, max));
    syncBarEdges();
  }

  /** 条子两侧的渐隐跟着横向滚动位置走。1px 的余量留给亚像素取整 —— 少了它，
   *  滚到底时右边那道渐隐会一直挂着不消（旧站同样的数）。 */
  function syncBarEdges() {
    if (!midx) return;
    var max = midx.scrollWidth - midx.clientWidth;
    midx.classList.toggle('can-left', midx.scrollLeft > 1);
    midx.classList.toggle('can-right', max > 1 && midx.scrollLeft < max - 1);
  }

  /** 滚轮横向滚 chip 条。条子藏了滚动条（scrollbar-width:none），鼠标又无从横向滚
   *  （触控板双指和 shift+滚轮是例外），不接管的话这一条就是个死区：滚轮放上去
   *  什么都不发生。只在**真的滚动了**的时候 preventDefault，没溢出就把事件放走。 */
  function onWheel(ev) {
    if (!midx) return;
    if (midx.scrollWidth - midx.clientWidth <= 1) return;
    /* deltaMode: 0=像素 1=行 2=页。Firefox 常见的是「行」，不换算的话一格滚轮只挪
       3px，比不动还难受。横向分量优先，不然触控板的斜向滑动会被 deltaY 抢走。 */
    var unit = ev.deltaMode === 1 ? 16 : (ev.deltaMode === 2 ? midx.clientWidth : 1);
    var d = (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY) * unit;
    if (!d) return;
    var before = midx.scrollLeft;
    midx.scrollLeft = before + d;
    if (midx.scrollLeft !== before) ev.preventDefault();
  }

  /** 滚到第 i 组。瞬时，不用 smooth —— 旧站的理由是"内容整块重画，条子自己
   *  在那儿慢慢滑显得很脱节"，这里同样是整列重画。
   *  `offsetTop` 是相对最近的**定位**祖先算的，所以 .codex-out 上有
   *  `position: relative`（见 css/app.css），少了那条这里跳的位置整个是错的。 */
  function gotoGroup(i) {
    setAt(i);
    var h = groupEls[i];
    if (h && out) out.scrollTop = h.offsetTop - out.offsetTop;
  }

  /** 滚动高亮。扫的是分组标题（≤31 个），不是条目，所以不加 rAF 节流。 */
  function spy() {
    if (!groupEls.length || !out) return;
    var top = out.scrollTop + 4;
    var cur = 0;
    for (var i = 0; i < groupEls.length; i++) {
      var e = groupEls[i];
      if (e && e.offsetTop <= top) cur = i; else break;
    }
    if (cur !== at) setAt(cur);
  }

  // ── 画列表 ──────────────────────────────────────────────────────────

  function renderBrowse() {
    var ch = chapterById(ui.chapterId);
    if (!ch) { resetIdx(); out.appendChild(el('div', 'codex-hint', '这个类别的条目找不到。')); return; }

    /* 先把整个类别的 (大类, 次级项) 摊平成一列，再一层 forEach 画。
     *
     * **摊平是为了保持下面 `u.items.forEach(...)` 那一行的缩进不变** —— mutate.js
     * 的 M26 精确匹配那一行，多套一层 forEach 缩进就变了，得连带改变异。
     *
     * 两个标题层都留着，一层都不能少：次级项名只在**大类内**唯一，实测障碍物代码
     * 里「回忆之旅」出现两次（主线与回忆 29 条、裂缝合集 23 条）。只有一层标题的话，
     * 平铺之后连"这条属于哪一类"都答不上来。 */
    var flat = [];
    sectionsOf(ch).forEach(function (s) {
      sectionUnits(ch, s).forEach(function (u) { flat.push({ sec: s, u: u }); });
    });
    resetIdx();
    if (!flat.length) {
      out.appendChild(el('div', 'codex-hint', '这个类别的条目找不到。'));
      return;
    }

    /* **一次画完，不分页。** 旧图鉴站就是一次性画完整章 2333 条；上一版在这里
     * 加了「还有 N 条，显示更多」，用户报"点了没反应"。全量显示既回到旧站的
     * 样子，也把那处没能复现的毛病整个绕开。最坏的类别 1048 条（僵尸代码），
     * 换来的是"打开就是全部"这个不需要解释的行为。 */
    var frag = document.createDocumentFragment();
    var last = null;
    flat.forEach(function (g, gi) {
      /* 大类名只在大类换头时插一次，给底下那几组当分隔。 */
      if (g.sec !== last) {
        frag.appendChild(el('div', 'codex-sec-h', g.sec));
        last = g.sec;
      }
      var h = el('div', 'codex-group-h', g.u.title);
      frag.appendChild(h);
      groupEls[gi] = h;                     // 滚动高亮按这个顺序扫
      if (g.u.note) frag.appendChild(el('div', 'codex-group-note', g.u.note));
      g.u.items.forEach(function (it) { frag.appendChild(row(it, ch)); });
    });
    out.appendChild(frag);
    renderIdx(flat.map(function (g) { return g.u; }));
  }

  function renderSearch() {
    var res = window.CodexSearch.search(searchScope(), ui.q);
    if (!res.hits.length) {
      var ch = chapterById(ui.chapterId);
      var hint = el('div', 'codex-hint',
        ch ? '「' + ch.title + '」里没有匹配的条目' : '没有匹配的条目');
      /* 明写"只搜这一类"。搜索的作用域就是浮层当前这一类，不写清楚的话，
         用户会以为搜索坏了 —— 想搜别的类得回侧栏点过去。 */
      if (ch) hint.appendChild(document.createTextNode(
        '（搜索只在当前这一类里 —— 换一类回侧栏点）'));
      out.appendChild(hint);
      return;
    }
    var frag = document.createDocumentFragment();
    if (res.truncated) {
      frag.appendChild(el('div', 'codex-hint',
        '结果太多，按相关度只取了前 ' + window.CodexSearch.MAX_RESULTS + ' 条，再输精确点'));
    }
    res.hits.forEach(function (h) { frag.appendChild(row(h.it, h.ch)); });
    out.appendChild(frag);
  }

  function setTitle() {
    var q = ui.q.trim();
    var ch = chapterById(ui.chapterId);
    /* 搜索框的占位文案跟着当前类别走 —— 搜索被收在这一类里（见 searchScope），
       占位里点名是哪一类，用户才不会以为搜的是全书。 */
    if (input) {
      input.placeholder = ch
        ? '在「' + ch.title + '」里搜：名字 / 代码 / 拼音首字母'
        : '搜索';
    }
    if (q) {
      mtitle.textContent = '搜索「' + q + '」';
      return;
    }
    /* 只有类别名。以前这儿拼的是「类别 · 大类名」，浮层按大类切的时候那是必要的
       （不说就不知道底下这 382 条是哪一段）；现在浮层画的是**整个类别**，大类名
       在里面当分隔标题，再挂一个到标题栏上就是重复。 */
    mtitle.textContent = ch ? ch.title : '';
  }

  function rerender() {
    resetPress();
    setTitle();
    out.textContent = '';
    /* 搜索**只搜当前这一类**（2026-09-22 改的，以前是跨类别全局）。清空搜索框就回到
     * 浏览 —— 同一类的完整目录，内容其实没换过类别，只是从"搜出来的那几条"回到全部。
     * 搜索态没有"分组"这回事，所以目录索引这时候收起来（旧站 is-searching 时
     * 把两条 bar 都收起的同一手）。 */
    if (ui.q.trim()) { resetIdx(); renderSearch(); }
    else renderBrowse();
  }

  /** 侧栏该指着哪里。跟浮层的开关绑在一起，不跟文档状态绑。
   *
   *  三件事其实是一件事：
   *    总目录那一列  按 ui.chapterId 亮（目录翻到了哪个类别）
   *    五个目录块    只有 ui.chapterId 那一个露出来，其余 hidden
   *    次级项那一行  按"浮层正开在它头上"亮
   *  at 随浮层滚动变（setAt 会调过来），所以在浮层里翻到哪一组，侧栏那一行就
   *  跟到哪一行，**跨大类也照样跟**（at 是整个类别里的扁平下标）—— 跟旧站按
   *  activeGroup 点 .side-g 是同一手。
   *
   * ⚠ 三个地方问的都是**同一个** ui.chapterId（以前章行和目录块问的是 viewCh，
   *  见文件头上那段"两边各记各的"的来龙去脉）。
   */
  function markActive() {
    chRows.forEach(function (r) {
      r.btn.classList.toggle('on', r.chapterId === ui.chapterId);
    });
    treeBlocks.forEach(function (t) {
      t.block.hidden = t.chapterId !== ui.chapterId;
    });
    /* 搜索态不算"浮层正开在某一组上"：命中的是一条条散着的，没有"当前这一组"
       这回事，留着上一轮那一行高亮是指向一个已经不在显示的东西。
       （搜索现在只搜当前这一类，但"结果里没有分组"这点没变。） */
    var lit = ui.open && !ui.q.trim();
    entryBtns.forEach(function (e) {
      /* 只有浮层开着的那个类别的次级项才亮（两个数其实是同一个，写全是为了读起来
         看得见"在比什么"）。`e.idx === at` 是同一个数比同一个数 —— 侧栏那行的
         dataset.idx 是整个类别里的扁平下标，`at` 也是，所以跨大类滚动时高亮能跟着
         换行，不需要换算。 */
      e.btn.classList.toggle('on', lit &&
        e.chapterId === ui.chapterId && e.idx === at);
    });
  }

  // ── 侧栏：复制格式 + 搜索入口 + 三级目录，只建一次 ───────────────────
  //
  // 目录的**形状**照旧图鉴站的侧栏（备份里 app.js 的 renderSidebar）：可折叠的类别
  // 列表 → `类名 · 目录` → 大类名（纯标签）→ 次级项（可点，右边带条数）。
  //
  // 两处**故意不一样**，别照着旧站"改回去"：
  //   - 旧站侧栏每次切章都重画（renderSidebar 从头拼一遍 innerHTML），这儿是**五个
  //     类别的目录块一次全建出来**，切换只切 hidden。
  //   - 旧站侧栏只有当前章那一份目录；这儿五份都在 DOM 里，靠 hidden 露一份。
  // 不重建的两个理由：
  //   - 这是本文件"建一次、永不重建"那堵承重墙的延伸（见文件头）。重建会顺带把
  //     entryBtns、lastEntry（关浮层时要把焦点还回去的那个按钮）一起作废 ——
  //     后者会变成一个游离节点，focus() 空转，键盘用户被丢回 <body>。
  //   - 更硬的一条：tools/check-boot.js 的扫雷拿 WeakSet 记"点过的按钮"，**节点
  //     一换新，记的那批就不作数**。要是"点目录里的东西"会触发整块重画，扫雷就会
  //     一圈一圈点刚冒出来的新行，140 次配额全喂在这里。同一个坑筛选浮层踩过一次，
  //     见 buildFilter 上面那段注释。
  //
  // 旧站侧栏其实是**两级**（章 → 次级项），`.side-sec` 是遍历 groupUnits 时顺手插的
  // 标签。这儿把这个标签也算一级，因为大类名只在**类别内**唯一（数据层的约定），跨类
  // 不重名只是当前数据碰巧如此：「图鉴中的植物」「主线僵尸」不告诉用户它属于哪个类别，
  // 条数也只有配上类别才有意义。把 18 个大类平铺就是拿巧合当契约。

  /** 一个类别的目录块：`类名 · 目录` + 每个大类一行 + 大类底下的次级项。 */
  function buildTree(ch) {
    var box = el('div', 'codex-tree');
    box.dataset.ch = ch.id;
    box.hidden = true;                    // 由 markActive 按 ui.chapterId 掀开
    box.appendChild(el('div', 'codex-side-h', ch.title + ' · 目录'));
    /* 扁平下标的起点。**不能用外层累加变量**：`var flat = 0; flat++` 配 forEach
       闭包，所有监听器会共享同一个末值 —— 每个次级项点开都跳到最后一组。用
       "本大类起点 + 组内下标"，每次迭代算出来都是定值。 */
    var base = 0;
    sectionsOf(ch).forEach(function (s) {
      var start = base, units = sectionUnits(ch, s);
      base += units.length;
      /* 大类名**也是入口**（2026-09-22 改的）。以前它是纯标签，理由是"点它没有
         '只看这个大'这回事，让它可点等于许一个这里并不存在的承诺" —— 那个理由成
         立的前提是"承诺只能是只看这一大类"。用户要的不是这个：他原话是「侧边栏
         点击上面的大类浮窗就应该跟着切换，而不是等到选择了次级分类」。所以现在
         点它 = 切到这一类 + 滚到这一段（用本大类的扁平起点 start），跟点它底下
         第一个次级项等效 —— 承诺兑现得了。

         ⚠ 别加 `codex-entry` 这个类：侧栏入口数在 check-boot 里是按
         `5 类别行 + 80 次级项` 数出来的，多戴一顶帽子数就对不上了；
         `.codex-sec` 那份排版 + `.codex-sec-btn` 的按钮复位已经够。 */
      var secBtn = el('button', 'codex-sec codex-sec-btn');
      secBtn.type = 'button';
      secBtn.textContent = s;
      secBtn.title = '切到「' + ch.title + '」并跳到「' + s + '」';
      secBtn.addEventListener('click', function () {
        openOverlay(ch.id, { entry: secBtn, unit: start });
      });
      box.appendChild(secBtn);
      /* i 是**大类之内**的下标，gi 是**本类别之内**的扁平下标。dataset.idx 和
         openOverlay 的 unit 都要 gi —— 那是 groupEls / idxBtns / `at` 用的数。 */
      units.forEach(function (u, i) {
        var gi = start + i;
        var b = el('button', 'codex-entry');
        b.type = 'button';
        /* 扁平下标和大类名也写进 dataset：自检得能问出"侧栏里第 idx 项那行亮没亮"
           （滚动联动那条），靠 .on 反推等于把"状态就在 DOM 里"这种实现也放过去。 */
        b.dataset.ch = ch.id;
        b.dataset.sec = s;
        b.dataset.idx = String(gi);
        b.appendChild(el('span', 'codex-entry-t', u.title));
        b.appendChild(el('span', 'codex-entry-n', String(u.items.length)));
        b.addEventListener('click', function () {
          openOverlay(ch.id, { entry: b, unit: gi });
        });
        entryBtns.push({ chapterId: ch.id, idx: gi, btn: b });
        box.appendChild(b);
      });
    });
    return box;
  }

  function syncFold() {
    if (chlist) chlist.hidden = foldChs;
    /* 三角的朝向不用在这儿改了 —— 它由下面那条 aria-expanded 经 CSS 决定
       （原先这里改的是 foldIco.textContent，换成 SVG 之后没有字形可换）。 */
    if (foldBtn) {
      foldBtn.setAttribute('aria-expanded', foldChs ? 'false' : 'true');
      foldBtn.title = foldChs ? '展开类别列表' : '折叠类别列表';
    }
  }

  /** 折叠/展开类别列表。只动这一个容器，**不重画侧栏** —— 重画会把目录的滚动
   *  位置丢回顶部，而点折叠的人十有八九正是为了去看目录（旧站 toggleFold 同款）。 */
  function setFold(v) {
    foldChs = !!v;
    writeFold(foldChs);
    syncFold();
  }

  function buildSide() {
    host.textContent = '';
    entryBtns = [];
    chRows = [];
    treeBlocks = [];

    /* 复制格式放这儿，不放浮层里：它是**全局设置**（localStorage 共用键，
       `zeditor.copyFormat`），却要开浮层才能改，说不通。 */
    var fmtWrap = el('div', 'codex-fmt');
    fmtWrap.appendChild(el('span', 'codex-fmt-h', '复制格式'));
    fmtSeg = el('div', 'seg');
    FORMATS.forEach(function (f) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = f[1];
      b.dataset.fmt = f[0];
      b.classList.toggle('on', f[0] === ui.fmt);
      b.addEventListener('click', function () {
        ui.fmt = f[0];
        writeFmt(ui.fmt);
        Array.prototype.forEach.call(fmtSeg.querySelectorAll('button'), function (x) {
          x.classList.toggle('on', x === b);
        });
        /* 每行的 title 里写着当前格式，所以换格式要重画列表 —— 但只在浮层开着时
           画。`openOverlay` 是先 ui.open = true 再 rerender() 的，漏不掉。 */
        if (ui.open) rerender();
      });
      fmtSeg.appendChild(b);
    });
    fmtWrap.appendChild(fmtSeg);
    host.appendChild(fmtWrap);

    /* 这儿原先还有一个「搜索全部代码」入口 —— 2026-09-22 删了。用户原话：
     * 「不需要侧边栏的搜索入口」。搜索框还在浮层里，打开浮层（点三级目录里任何一级）
     * 就能搜；它也不再需要一个"把焦点放进搜索框"的特例，所以 openOverlay 的
     * focusSearch 选项跟着一起删了。 */

    /* ── 类别总目录（可折叠）── */
    var useChs = chapters().filter(function (ch) { return sectionsOf(ch).length; });

    foldBtn = el('button', 'codex-fold');
    foldBtn.type = 'button';
    foldIco = el('span', 'sec-caret');
    foldIco.appendChild(icon('right'));
    foldBtn.appendChild(foldIco);
    foldBtn.appendChild(el('span', null, '类别'));
    foldBtn.appendChild(el('span', 'sec-count', String(useChs.length)));
    foldBtn.addEventListener('click', function () { setFold(!foldChs); });
    host.appendChild(foldBtn);

    chlist = el('div', 'codex-chlist');
    host.appendChild(chlist);

    useChs.forEach(function (ch) {
      /* 类别行也是 .codex-entry（多带一个 .codex-ch 做区分）—— 名字和条数于是白拿
         .codex-entry-t / .codex-entry-n 的排版，高亮也白拿 .codex-entry.on。 */
      var b = el('button', 'codex-entry codex-ch');
      b.type = 'button';
      b.appendChild(el('span', 'codex-entry-t', ch.title));
      b.appendChild(el('span', 'codex-entry-n', String(ch.count)));
      /* 点类别行**切浮层**（2026-09-22 改的）。以前是"只翻目录、不开浮层" ——
         用户当时点名要那个最小改动，现在点名要反过来，原话是「侧边栏点击上面的
         大类浮窗就应该跟着切换，而不是等到选择了次级分类」。于是侧栏三级每一级
         都成了入口，一级比一级深：类别行到这一类，大类名到这一段，次级项到这一组。
         `unit` 不给，所以落在类别开头（不是"停在上一类读过的地方"）。 */
      b.addEventListener('click', function () {
        openOverlay(ch.id, { entry: b });
      });
      chRows.push({ chapterId: ch.id, btn: b });
      chlist.appendChild(b);

      var box = buildTree(ch);
      treeBlocks.push({ chapterId: ch.id, block: box });
      host.appendChild(box);
    });

    syncFold();
    markActive();
  }

  // ── 浮层 ────────────────────────────────────────────────────────────

  /**
   * 建**唯一一个**浮层，append 到 body，侧栏**所有**入口（搜索 + 5 个类别行 +
   * 80 个次级项）共用。
   *
   * 每个入口各 append 一个会在 body 里叠一堆，而且扫雷的
   * `querySelectorAll('.codex-modal button')` 会把它们全捞回来。ensure 幂等，
   * 天然满足。
   *
   * 它**不在 index.html 里**，所以不能用 BY_ID / getElementById 去抓 ——
   * tools/check-editor.js 要求 JS 里出现的每个字面 id 都在 HTML 里。用模块变量
   * 持引用（跟 host / out 一样）。
   */
  function buildModal() {
    modal = el('div', 'codex-modal');
    modal.hidden = true;
    modal.tabIndex = -1;              // 开的时候好把焦点接过来

    var head = el('div', 'codex-mhead');
    mtitle = el('span', 'codex-mtitle');
    head.appendChild(mtitle);
    head.appendChild(el('div', 'grow'));
    mclose = iconBtn('codex-mclose', 'x', '关闭浮层', '关闭（Esc）');
    mclose.addEventListener('click', closeOverlay);
    head.appendChild(mclose);

    var bar = el('div', 'codex-mbar');
    input = document.createElement('input');
    input.type = 'search';
    input.className = 'codex-q';
    /* 占位文案在 setTitle() 里按当前类别写 —— 搜索被收在这一类里（见 searchScope），
       这儿写死的"跨全部 N 类"那种文案跟着范围筛选一起删了。 */
    input.autocomplete = 'off';
    input.addEventListener('input', function () {
      ui.q = input.value;
      rerender();
    });
    bar.appendChild(input);

    /* 这儿原先有个「☑ 范围」按钮 + 一个小浮层（勾哪几类）。2026-09-22 删了 ——
       用户原话：「不需要筛选范围按钮」。搜索的作用域就是当前这一类，没有"范围"
       这个概念了，见 searchScope。 */

    dseg = el('div', 'seg seg-sm');
    DENSITIES.forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = d[1];
      b.dataset.density = d[0];
      b.title = '条目排列密度：' + d[1];
      b.addEventListener('click', function () { setDensity(d[0]); });
      dseg.appendChild(b);
    });
    bar.appendChild(dseg);

    var body = el('div', 'codex-mbody');
    midx = el('nav', 'codex-midx');
    midx.hidden = true;
    /* 横条那三件事的接线（见上面那段）。scroll 可以 passive，它只读滚动位置；
       wheel 必须 passive:false —— 它要 preventDefault 才能吃掉这一下滚轮。 */
    midx.addEventListener('scroll', syncBarEdges, { passive: true });
    midx.addEventListener('wheel', onWheel, { passive: false });
    out = el('div', 'codex-out');
    out.addEventListener('scroll', spy);
    body.appendChild(midx);
    body.appendChild(out);

    /* 多选落地时「插入选中 N 条」住这儿。现在就建出来并 styling 好，
     * 免得那时候还要重排布局。multi / selected 同理，都先摆着不接线。 */
    foot = el('div', 'codex-foot');
    foot.hidden = true;

    modal.appendChild(head);
    modal.appendChild(bar);
    modal.appendChild(body);
    modal.appendChild(foot);
    document.body.appendChild(modal);

    /* 读到的那一档要**在首次渲染前**就应用上（旧站 boot() 同款理由：不然会先按
       标准档画一遍再跳成紧凑）。容器一直藏着，所以这里只是把属性挂上。 */
    applyDensity();
    wireOverlayKeys();
  }

  function wireOverlayKeys() {
    /* 点浮层外面就关。
     *
     * `modal.contains(t)` 是最保险的判定：浮层里的搜索框、密度分段、目录索引、
     * 条目、✕ 全都算"里面"。再加一条 #panel-codex 白名单 —— 否则点侧栏那个入口
     * 按钮时事件冒到 document，浮层**刚开就被关掉**。
     *
     * （这条独立于 main.js 那个 closePopovers() 的监听器：那个只管两个 popover。）
     *
     * 里面原先还有一层"点别处收掉筛选小浮层"。2026-09-22 跟范围筛选一起删了，
     * 所以现在点浮层里面 = 什么都不做。 */
    document.addEventListener('click', function (e) {
      if (!ui.open) return;
      var t = e.target;
      if (!t || !t.nodeType) return;
      if (modal.contains(t)) return;
      if (t.closest && t.closest('#panel-codex')) return;
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
     * 以前这儿是"一个 Esc 关一层"（先收筛选小浮层）。筛选没了，Esc 只剩"关浮层"
     * 这一件事，就别再给别的浮层留分层的余地了。
     * 这是本仓库第一处 Esc 处理；它跟浮层同生共死，所以住在这个文件里。
     * （main.js 的 wireKeyboard 只管 Ctrl+Z/Y，不动。） */
    document.addEventListener('keydown', function (e) {
      if (!ui.open || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeOverlay();
    }, true);
  }

  /**
   * 开浮层。浮层画的是**一整个类别**，所以只有类别这一个粒度。
   * @param {string} chapterId
   * @param {Object} opts  { entry, unit }
   *   entry       触发它的那个侧栏按钮，关的时候把焦点还给它
   *   unit        次级项在**本类别之内**的扁平下标；给了就滚到那一组（侧栏点进来的
   *               那条路才有）。不换算成别的下标 —— 它跟 groupEls / idxBtns / `at`
   *               本来就是同一个数。
   */
  function openOverlay(chapterId, opts) {
    opts = opts || {};
    resetPress();
    /* 窄屏的抽屉是 main.js 的约定（body.sidebar-open 不会自己消失，不收掉的话
     * 关掉浮层后抽屉又"开着"冒出来）。 */
    if (ctxRef.onOpen) ctxRef.onOpen();

    ui.chapterId = normCh(chapterId);
    ui.q = '';
    input.value = '';
    ui.open = true;
    at = 0;
    lastEntry = opts.entry || null;
    modal.hidden = false;
    markActive();
    rerender();
    /* 滚到点的那一组。**必须排在 rerender() 后面** —— gotoGroup 走的是 groupEls，
       那是画完才有的东西。 */
    if (typeof opts.unit === 'number') gotoGroup(opts.unit);
    /* 浮层自己拿焦点（不是搜索框）。以前「搜索全部代码」那个入口进来会 focusSearch，
       那个入口和那个选项一起删了；搜索现在只搜当前这一类，没有"从搜索进来"的路。 */
    modal.focus();
  }

  /** 关闭。✕ / Esc / 点浮层外三路都走这里。 */
  function closeOverlay() {
    if (!ui.open) return;
    resetPress();
    ui.open = false;
    modal.hidden = true;
    markActive();
    /* 焦点还给触发它的那个入口按钮，键盘用户不至于被丢回页首。**藏起来的按钮
       不算数** —— 对 hidden 的元素 focus() 是空转，人还是被丢回 <body>。
       ⚠ 能藏起来的是**类别行**：它在 `.codex-chlist` 里，折「类别」就一起收走了
       （2026-09-22 之后点类别行也会开浮层，所以它现在是 lastEntry 的常见来源）。
       目录块挂在 chlist **外面**，折不到它 —— 所以折起来那一刻，退路只剩
       "这一类目录块里的第一个入口"，这个数一定露着。
       （原先这儿退的是"总目录里当前那一行"，理由是"它一定露着"。折叠一来这句话
       就不成立了，那一行跟 lastEntry 一起 hidden，等于没有退路 —— 换成目录块。） */
    var vis = function (el) {
      return el && !(el.closest && el.closest('[hidden]')) ? el : null;
    };
    var back = vis(lastEntry);
    if (!back) {
      entryBtns.forEach(function (e) {
        if (!back && e.chapterId === ui.chapterId) back = vis(e.btn);
      });
    }
    if (back && back.focus) back.focus();
  }

  // ── 组装 ────────────────────────────────────────────────────────────

  /**
   * 建面板。**幂等** —— 切页签每次都会调，只有第一次真建。
   * @param {HTMLElement} hostEl  #panel-codex
   * @param {Object} ctx          { onInsert(snippets), onCopy(text, note), onOpen() }
   */
  function ensure(hostEl, ctx) {
    if (built) return;
    built = true;
    host = hostEl;
    ctxRef = ctx;

    /* 设置都要在 buildSide()/buildModal() **之前**读好：格式按钮要标对 .on，
       密度要一次挂对属性（挂晚了会先按标准档画一遍），折叠状态要赶上第一次
       syncFold()（晚了会先铺开再"啪"地收起来）。 */
    ui.fmt = readFmt();
    ui.density = readDensity();
    foldChs = readFold();
    var list = chapters();
    ui.chapterId = list.length ? list[0].id : null;
    /* 上一步不只是"给浮层挑个默认类"：ui.chapterId 同时是**侧栏目录露哪一块**的依据
       （markActive 照它掀），所以一开始浮层虽然没开，总目录也已经落在默认要读的那一类
       上 —— 侧栏第一次画出来就有内容，而不是五个块全 hidden 的空目录。 */

    buildSide();
    buildModal();
    /* 转屏 / 拉窗口会改变横条的可视宽度，边界状态得重算（内容没变，不会自己触发
       scroll）。挂在 window 上：面板只建一次，所以这条监听也只会有一条。 */
    window.addEventListener('resize', syncBarEdges);
    /* 这里**不** rerender：浮层还藏着，没必要一上来就画 430 行。开的时候再画。 */
  }

  return {
    ensure: ensure,
    /* 给自检用的只读快照。不是为了调试方便 —— check-boot 要断言
     * 「切走再切回来，打开的类别还在」，它得能问出"现在打开的是哪一个"，
     * 而不是靠读 DOM 里的 .on 反推（那样连"状态本来就存在 DOM 里"这种
     * 错误实现也能通过）。目录索引高亮那条同理，问的是 at 不是读 .on。 */
    state: function () {
      return { chapterId: ui.chapterId, q: ui.q, fmt: ui.fmt,
        density: ui.density, open: ui.open,
        /* 搜索的作用域**就是** chapterId，没有第二个数 —— 所以这里故意不返一个
           `scope` 字段：返了就等于承认"范围"还是一维可以跟当前类别不一致的状态。
           自检要问"搜索在搜哪一类"，问 chapterId 就是问全部。见 searchScope()。 */
        searchIn: ui.chapterId,
        /* fold 是**侧栏目录**的状态（哪几类收起来了），不是浮层的。自检要断言
           「点了折叠箭头，那一类收起来」，问的是它 —— 照旧从 DOM 的 .on / hidden
           反推的话，把箭头标记和"真收没收"写岔了也照样能过。
           （目录**露哪一块**已经不在这儿了：那就是 chapterId，见上面。） */
        fold: foldChs,
        at: at, multi: multi, selected: Object.keys(selected).length };
    }
  };
})();
