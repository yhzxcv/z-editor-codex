/* 编辑器主控 —— 把状态、文本区、对象树、侧栏面板接起来
 *
 * 数据流是单向的：
 *   用户打字 / 结构操作  ->  State（唯一的文本真源）  ->  订阅者重绘
 * 所以这里几乎所有操作都是"改 state，然后等订阅回调把界面重画一遍"。
 */
(function () {
  'use strict';

  var State = window.ZEditor.State;
  var Text = window.ZEditor.Text;
  var Tree = window.ZEditor.Tree;
  var ModulePanel = window.ZEditor.ModulePanel;
  var CodexPanel = window.ZEditor.CodexPanel;
  var Report = window.ZLevel.Report;
  var Edit = window.ZLevel.Edit;
  var Parse = window.ZLevel.Parse;

  var BY_ID = function (id) { return document.getElementById(id); };

  var state = State.create();
  var text = null;

  /** 程序性换文本时挂起 onChange，免得 setText -> onChange -> setText 来回打转。 */
  var muted = false;

  /**
   * 参考数据表（reference/*.js 挂上来的）。脚本没加载时给 null ——
   * 上层一律降级成「外部来源不判」，也就是回到不给外部引用报错的状态。
   */
  function refsTable() { return window.ZLevel.Refs || null; }

  /**
   * 校验层要用的「参考文件里的模块别名」。
   *
   * 参考文件没加载时返回 null：Parse.findInvalidLevelModuleReferences 拿到 null
   * 就跳过 `@LevelModules` 那一支，这是上游的口径（宁可漏判，也不要满屏误报）。
   * **不能返回空 Set** —— 空 Set 的含义是「LevelModules 里一个别名都没有」，
   * 那会把每一条模块引用都判成失效，正好是这个改动要修掉的那种误报。
   *
   * 改这里之前它是个 `return null` 的桩，于是真正的拼写错误一个也查不出来。
   */
  function levelModuleAliases() {
    var Refs = window.ZLevel.Refs;
    return Refs ? Refs.aliases('LevelModules') : null;
  }

  // ── 启动 ────────────────────────────────────────────────────────────

  function boot() {
    text = Text.create(BY_ID('editor'), {
      doc: '',
      onChange: function (t) { if (!muted) state.setText(t); },
      onSave: doSave,
      onOpen: function () { BY_ID('file-input').click(); }
    });

    state.subscribe(onStateChange);
    wireTabs();
    wireTopbar();
    wireSettings();
    wireKeyboard();

    // 没打开文件时给一个能立刻上手的起点：空白关卡模板
    var blank = window.ZLevel.Templates[0];
    loadDocument(blank.text, blank.title + '.json', 'template');
  }

  /**
   * 换文档：只动状态，编辑器由订阅回调跟着写。
   *
   * 顺序不能反 —— 状态是文本真源，编辑器是它的一个视图。以前这里顺手再调一次
   * setEditorText，现在写回要靠 emit 带上来的 reason 来决定怎么写（载入要连
   * 撤销历史一起换掉），多一条手动的路径反而容易写歪。
   */
  function loadDocument(t, fileName, source) {
    state.load(t, fileName, source);
  }

  /**
   * 把状态里的文本写回编辑器。reason 决定**怎么写**，三种情况互相排斥：
   *
   *   'load'        换文档了 -> 整篇重置，连撤销历史一起换（resetText）
   *   'structural'  结构操作 -> 整篇替换但**保住**历史，且自成一步（setText）
   *   'edit'/'save' 什么都不做 —— 前者编辑器本来就是改动源头，后者文本压根没变
   *
   * muted 必须包在 try/finally 里：dispatch 万一抛（比如 CM.isolateHistory 是
   * undefined），muted 卡在 true 上，之后用户在编辑器里打的字就再也同步不到
   * 状态了 —— 一个"打字没反应"的哑巴界面。
   */
  function setEditorText(t, reason, label) {
    if (reason === 'load') {
      muted = true;
      try { text.resetText(t); } finally { muted = false; }
      return;
    }
    if (reason !== 'structural') return;
    if (text.getText() === t) return;
    muted = true;
    try { text.setText(t, label); } finally { muted = false; }
  }

  // ── 状态变化 -> 重绘 ────────────────────────────────────────────────

  function onStateChange(s, reason, label) {
    // 结构操作换掉了文本，得写回编辑器；打字和保存触发的变更这里会直接返回
    setEditorText(s.text, reason, label);
    applyDiagnostics(s);

    /* 体检报告只算一次，喂给状态栏、汇总条和对象树。
     * 原先状态栏自己数一遍、校验页又数一遍（还多跑一次 Outline.build），
     * 两个数在侧栏里并排显示却可能不一样 —— 这就是那个「一件事只出现一次」
     * 要修的东西。 */
    var rep = Report.build(s.objects, refsTable(), levelModuleAliases());

    renderStatus(s, rep);
    renderSummary(s, rep);

    Tree.render(BY_ID('tree-host'), rep.outline, onPickNode, doDeleteObject, {
      invalidRefs: rep.invalidRefs,
      conflicts: rep.conflicts,
      onCleanup: doCleanup,
      onEdit: onEditNode
    });
    // 图鉴栏**不在这里**：它跟文档状态无关，重建会丢浮层里的搜索词和打开的大类
  }

  /**
   * 把 JSON 解析错误画成编辑器里的波浪线。
   *
   * 每次状态变化都重设一遍，不能只在"出错的那一刻"设一次 —— setText 走的是
   * 重建 state，重建会把诊断一起清掉，所以这里跟着状态走最省心。
   */
  function applyDiagnostics(s) {
    var d = Text.diagnosticOf(s.parseError, s.text.length);
    text.setDiagnostics(d ? [d] : []);
  }

  function renderStatus(s, rep) {
    var host = BY_ID('statusbar');
    host.textContent = '';
    host.appendChild(span('st-file', s.fileName || '未命名'));

    if (s.parseError) {
      var errTag = span('st-bad', 'JSON 有误');
      if (s.parseError.engine) errTag.title = '引擎原文：' + s.parseError.engine;
      host.appendChild(errTag);
    } else {
      host.appendChild(span(null, s.objects.length + ' 个对象'));
      /* 数字一律取 rep.counts —— 汇总条和对象树用的是同一份，三处不会各说各话。
       * rep 缺失时（理论上不该发生）宁可不显示，也不要在 renderStatus 里抛：
       * 这个函数抛一次，它后面的重绘全都不执行，表现是"页面在、点谁都没反应"。 */
      var c = rep && rep.counts;
      if (c && c.orphans) host.appendChild(span('st-warn', c.orphans + ' 个孤立模块'));
      if (c && c.invalidRefs) host.appendChild(span('st-bad', c.invalidRefs + ' 个失效引用'));
      if (c && c.conflicts) host.appendChild(span('st-bad', c.conflicts + ' 处模块冲突'));
    }

    if (s.normalized) {
      var n = span('st-dim', '已做过结构操作');
      n.title = '插入/删除会重新序列化整份 JSON：对象顺序按游戏加载顺序排好了，' +
        '数字写法可能被规范化（1.0 写成 1，两者是同一个数）。纯手打不触发这个。';
      host.appendChild(n);
    }

    BY_ID('doc-name').textContent = s.fileName || '未打开文件';

    // ⚠ 撤销/重做的可用性要问**编辑器**（历史在它那儿），不能问订阅回调收到的
    // 那份记录 —— 那是纯数据，上面没有方法。曾经写成 s.canUndo()，renderStatus
    // 当场抛异常，连带它后面的三个面板全画不出来，表现是"页面在、点谁都没反应"。
    //
    // 两个按钮的可用性都跟着深度走，所以打字、结构操作、撤销、重做都会让它们
    // 重新亮/灭 —— renderStatus 每次 emit 都会被调一遍，这条是白拿的。
    //
    // 不可用时是**置灰**（disabled）不是藏起来：藏起来会让顶栏按钮忽左忽右地跳，
    // 而且用户没法从"按钮没了"分辨出是没东西可撤、还是这功能根本不在这儿。
    // 标签在没东西可撤时本来就是空的，所以 tooltip 退回不带名字的说法。
    var canUndo = text.undoDepth() > 0;
    var canRedo = text.redoDepth() > 0;

    var undoBtn = BY_ID('btn-undo');
    undoBtn.disabled = !canUndo;
    undoBtn.title = '撤销' + (canUndo ? text.undoLabel() : '') + '（Ctrl+Z）';

    var redoBtn = BY_ID('btn-redo');
    redoBtn.disabled = !canRedo;
    redoBtn.title = '重做' + (canRedo ? text.redoLabel() : '') + '（Ctrl+Y）';

    renderErrorBar(s);
  }

  function span(cls, txt) {
    var e = document.createElement('span');
    if (cls) e.className = cls;
    e.textContent = txt;
    return e;
  }

  /** JSON 语法错误横幅 —— 出错时结构操作全被禁掉，得说清楚为什么。 */
  function renderErrorBar(s) {
    var bar = BY_ID('errbar');
    // 先清空内容，再决定藏不藏。清空这一步是**独立于 hidden 的**保险：
    // 光靠 `bar.hidden = true` 曾经不管用 —— 样式表里 `.errbar { display: flex }`
    // 盖掉了浏览器塞给 [hidden] 的 display:none（作者样式表的任何 display 规则
    // 都赢过 UA 那条，跟选择器优先级无关），于是横幅照样杵在那儿、上面还留着上
    // 一次的报错文字，看起来正是"没有语法错误时顶上还是有一块红框，改好了字也不
    // 消失"。app.css 那边补了 [hidden] { display: none !important }，这里再清一次
    // 内容 —— 两边任何一边单独失效，用户都不会看到过期文字。
    bar.textContent = '';
    if (!s.parseError) { bar.hidden = true; return; }
    bar.hidden = false;
    var msg = span('err-msg', 'JSON 语法错误：' + Text.zhError(s.parseError.message));
    if (s.parseError.engine) msg.title = '引擎原文：' + s.parseError.engine;
    bar.appendChild(msg);
    bar.appendChild(span('err-hint', '修好之后才能插入模块、清理对象。'));
    var jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'btn btn-sm';
    jump.textContent = '跳到出错处';
    jump.addEventListener('click', function () {
      text.view.dispatch({ selection: { anchor: s.parseError.pos }, scrollIntoView: true });
      text.focus();
    });
    bar.appendChild(jump);
  }

  /**
   * 对象栏顶上那条汇总。
   *
   * 原先这是「校验」页的一张「没发现问题」卡片，搬到树顶上是为了让用户切到
   * 「对象」就一眼看到有没有毛病 —— 树的各段是分开报数的，段与段之间还可能
   * 折起来，没有这一行就得自己加。
   *
   * 两种情况下**不显示**：
   *   无根      —— 树的空态（tree.js）说得更具体，这里再说一遍是重复
   *   语法错误  —— 顶上那条红横幅已经在说同一件事，而且这时候 objects 是
   *               上一次成功解析的陈旧数据，拿它报数会误导
   */
  function renderSummary(s, rep) {
    var host = BY_ID('sum');
    host.textContent = '';
    if (!rep || !rep.outline || !rep.outline.root || s.parseError) {
      host.hidden = true;
      return;
    }
    var c = rep.counts;
    var box = document.createElement('div');
    var parts = [];
    if (c.conflicts) parts.push(c.conflicts + ' 处模块冲突');
    if (c.invalidRefs) parts.push(c.invalidRefs + ' 个失效引用');
    if (c.orphans) parts.push(c.orphans + ' 个孤立模块');

    if (parts.length) {
      box.className = 'chk ' + (c.conflicts || c.invalidRefs ? 'chk-bad' : 'chk-warn');
      box.appendChild(span('chk-h', parts.join(' · ')));
    } else {
      box.className = 'chk chk-ok';
      box.appendChild(span('chk-h', '没发现问题 · ' + c.objects + ' 个对象'));
    }
    host.appendChild(box);
    host.hidden = false;
  }

  // ── 波次计数 ────────────────────────────────────────────────────────
  //
  // 「这份关卡现在有几波」。模块详情浮层里那个下拉每次打开都现问一次，所以这里
  // 不缓存 —— 缓存下来的会是"上一次打开时的世界"。

  function waveCountOf(s) {
    var wm = Parse.findByClass(s.objects, 'WaveManagerProperties');
    return (wm && wm.objdata && Array.isArray(wm.objdata.Waves)) ? wm.objdata.Waves.length : 0;
  }

  // ── 对象树交互 ──────────────────────────────────────────────────────

  /* 按名字搜 —— 只给**引用**用（失效引用那一行的 rtid 本来就是文本里的一串字符，
   * 没有对象可定位）。跳到一个对象上必须走 revealObject：这个名字在文件里往往先以
   * 别的身份出现（别的对象里一个键名 / 一个值 / 一条 `X@CurrentLevel` 引用），
   * 搜出来的位置是不是那个对象，全看这个名字有多常见。 */
  function revealOrWarn(needle) {
    if (!needle) return false;
    // 别名在文本里是带引号的字符串，优先按带引号的形式找，能避开注释里的同名文字
    if (text.reveal('"' + needle + '"')) return true;
    if (text.reveal(needle)) return true;
    toast('在文本里找不到：' + needle, true);
    return false;
  }

  /**
   * 跳到某个**对象**自己的那一段文本 —— 按结构定位，不按名字搜。
   *
   * 索引是这么来的：解析出来的 objects 数组的顺序就是文本里的顺序（解析不重排），
   * 而大纲节点上挂的就是这批实例里的某一个，所以 indexOf 认得出它是第几个。
   * 区间由 Spans.objectRanges 从文本本身扫出来（见那份文件头的"为什么"）。
   *
   * 认不出来（文本刚改成坏的、形状不是 {"objects": [...]}）就返回 false，
   * 调用方退回按名字搜。
   */
  function revealObject(obj) {
    if (!obj) return false;
    /* 这一条在**插入**的路径上也跑（插完跳到新对象），所以它绝不能抛：
     * spans.js 万一没挂上来（漏了 script 那行），抛出去的表现是"点插入什么都没发生"
     * —— 浮层不关、对象也不建，比跳错地方糟得多。取不到就退化成按名字搜。 */
    var Spans = window.ZLevel.Spans;
    if (!Spans) return false;
    var s = state.get();
    var i = Parse.asList(s.objects).indexOf(obj);
    if (i < 0) return false;
    var ranges = Spans.objectRanges(s.text);
    var r = ranges && ranges[i];
    return !!(r && text.revealRange(r.from, r.to));
  }

  /**
   * 结构操作之后跳到刚建出来的那个对象。别名在一份文件里唯一，所以它挑得出唯一一个。
   *
   * 曾经还有第二档：浮层里挑一个键，插完把光标落到**那个键的值**上（结构值那一档没有
   * 专用控件，得让用户到文本里自己填）。那一档连同「插完光标落到这个键」那排单选框
   * 一起删了 —— 用户的原话是"多余功能，光标按之前逻辑在原插入位置就行"。所以落点
   * 永远是整个新对象（下面 revealObject 选中的就是它那一整段）。
   *
   * ⚠ 选中的是整段，**光标停在哪一头**是另一件事：2026-09-22 起停在对象的**头**
   * （见 text.js 的 revealRange，那儿的 anchor/head 是反着写的）。插入这条路跟
   * 点树上的行走的是同一个 revealObject，所以两条路一起变了。
   */
  function revealCreated(alias) {
    if (!alias) return false;
    var hit = Parse.asList(state.get().objects).filter(function (o) {
      return Edit.firstAliasOf(o) === alias;
    })[0];
    if (revealObject(hit)) return true;
    return revealOrWarn(alias);
  }

  function onPickNode(node) {
    // 对象节点按结构跳；文本对不上（区间取不到）才退回按名字搜
    if (!revealObject(node.obj)) revealOrWarn(node.alias || node.objclass);
    if (window.innerWidth < 940) closeSidebar();
  }

  // ── 改一个已有对象的参数 ────────────────────────────────────────────
  //
  // 入口是对象树一行上那个 ✎。浮层住在 js/editor/module-panel.js 里 —— 它跟插入
  // 表单是同一张表（同一个键表、同一套形状控件、同一份中文说明），只是行从哪来、
  // 写回什么不一样，理由写在那个文件的头上。

  /**
   * 一个对象在文件里的**身份凭据**：位置 + objClass。
   *
   * 为什么不传对象引用：浮层不碰 state（那是这个文件的约定），而且结构操作之后
   * objects 是重新解析出来的一批新实例，留着旧引用就是在改一个文件里已经不在的对象。
   * 位置就是 objects 数组的下标（解析不重排，所以它等于文本顺序），objClass 用来复核。
   */
  function objectIdOf(obj) {
    var list = Parse.asList(state.get().objects);
    var i = list.indexOf(obj);
    if (i < 0) return null;
    return { index: i, objclass: obj.objclass };
  }

  /**
   * @param {Object} node 树上那一行
   * @param {HTMLElement} [btn] 触发它的那个 ✎（关浮层时把焦点还给它）
   */
  function onEditNode(node, btn) {
    if (!node || !node.obj) return;
    var id = objectIdOf(node.obj);
    if (!id) { toast('这个对象在文件里找不到了，先在文本里改好', true); return; }
    /* 模块浮层是**懒建**的（切到「模块」页签时才建）。对象树上的 ✎ 可能在用户
     * 从没打开过那个页签时就被点到，所以这里得先确保它建好了 —— ensure 幂等。 */
    ensureModulePanel();
    ModulePanel.openObject({
      index: id.index,
      objclass: node.objclass,
      title: node.alias ? node.objclass + '  ·  ' + node.alias : node.objclass,
      sub: '改参数  ·  文件里第 ' + (id.index + 1) + ' 个对象',
      /* 首别名 —— 浮层「代号」那一格拿它当原值（改没改是跟它比），
       * 改名也只会改这一个（见 Edit.renameObjectAlias）。 */
      alias: node.alias || '',
      /* 快照，不是引用 —— 浮层要画的只是"打开这一刻它长什么样"。 */
      data: node.obj.objdata || {}
    }, btn || null);
    if (window.innerWidth < 940) closeSidebar();
  }

  /**
   * 保存一个已有对象的参数（顺带可以改代号）。返回 {ok, reason}，跟插入那两条接缝
   * 同一个约定。
   *
   * 认人用 **(位置, objClass)**，认不上就拒绝 —— 浮层开着的时候用户完全可能（在
   * 右边的编辑器里）手打几笔，把对象挪走、删掉、或者换个 objClass。那时候写进去
   * 就是往一个已经不是它的对象上写。**不猜**，说清原因让用户重开一次。
   *
   * @param {Object} values   只含改动过的键；没改就是 {}
   * @param {string|null} newAlias 新代号；没改代号传 null（**不是原值** —— 那会被
   *        当成一次改名，白跑一遍 renameAlias。见面板的 doSave）
   */
  function doSaveObject(id, values, newAlias) {
    if (!id) return { ok: false, reason: '不知道在改哪个对象，重新点一次 ✎' };
    if (state.get().parseError) return { ok: false, reason: 'JSON 有语法错误，先修好再改' };

    var keys = (values && typeof values === 'object') ? Object.keys(values) : [];
    /* 一件都没改。这条判据原先在 Edit.updateObject 里（no-change），现在**改名也能
     * 单独成一次保存**，所以拦在更外面一层：不然"只改代号"会被 updateObject 那句
     * "一个键都没改"顶回来。 */
    if (!keys.length && !newAlias) return { ok: false, reason: '一个键都没改' };

    var aliasRes = null;
    var r = state.applyStructural(function (objects) {
      var list = Parse.asList(objects);
      var t = list[id.index];
      if (!t || t.objclass !== id.objclass) return { ok: false, error: 'moved' };
      /* 改名和改键放在**同一次**结构操作里做完 —— applyStructural 一次 = 一步撤销
       * （见 state.js）。拆成两次调用的话，用户按一次「保存」得按两次 Ctrl+Z
       * 才回到原样，中间那一步还是一个半命名半改键的怪状态。 */
      if (newAlias) {
        aliasRes = Edit.renameObjectAlias(list, t, newAlias);
        if (!aliasRes.ok) return aliasRes;
      }
      if (!keys.length) return { ok: true, keys: [] };
      return Edit.updateObject(list, t, values);
    }, 'update');

    if (!r.ok) {
      if (r.error === 'moved') {
        return { ok: false, reason: '文件里第 ' + (id.index + 1) + ' 个对象已经不是「' + id.objclass +
          '」了（浮层开着的这段时间文本改过）—— 关掉重新点一次 ✎' };
      }
      /* 这三条是改名那一路的拒绝（Edit.renameObjectAlias）。reason 是它给的原文，
       * 那句话是照用户填的那个代号写的，比这里重编一句准。 */
      if (r.error === 'bad-name' || r.error === 'ambiguous' || r.error === 'no-alias') {
        return { ok: false, reason: r.reason || '这个代号不能用' };
      }
      if (r.error === 'no-object' || r.error === 'not-found') {
        return { ok: false, reason: '这个对象在文件里找不到了 —— 关掉重新点一次 ✎' };
      }
      if (r.error === 'no-change') return { ok: false, reason: '一个键都没改' };
      if (r.error === 'parse-error') return { ok: false, reason: 'JSON 有语法错误，先修好再改' };
      return { ok: false, reason: '保存失败：' + r.error };
    }

    /* 跳到刚改的那个对象上。**按位置重新取一次**，不能拿 mutator 里那个 ——
     * applyStructural 之后 objects 是重新解析出来的一批新实例，旧引用不在里面，
     * revealObject 拿 indexOf 会认不出来（表现是"保存了但没跳"）。 */
    revealObject(Parse.asList(state.get().objects)[id.index]);

    var renamed = !!(aliasRes && !aliasRes.unchanged);
    var parts = [];
    if (r.keys.length) parts.push('改了 ' + r.keys.length + ' 个键');
    if (renamed) {
      parts.push('代号改成「' + aliasRes.alias + '」' +
        (aliasRes.refs ? '（' + aliasRes.refs + ' 处引用跟着改）' : '（没有引用要改）'));
    }
    /* 改名之后不能再报旧名字 —— 用户按完保存，标题里那个名字已经不成立了。 */
    var who = renamed
      ? id.objclass + ' · ' + aliasRes.alias
      : (id.title || id.objclass);
    toast(who + '：' + parts.join('，'));
    return { ok: true };
  }

  // ── 结构操作 ────────────────────────────────────────────────────────

  /* 插入的两条接缝。都是**返回 {ok, reason}** 而不是自己 toast 完就算 —— 调用它们
   * 的是模块详情浮层（js/editor/module-panel.js），它要靠 ok 决定浮层关不关、
   * 拿 reason 写在「插入」按钮上面。原先这两条只 toast，浮层就没法知道成没成。
   *
   * 出错时**不 toast**：那句话已经原样回到浮层里了，再弹一个就是同一件事说两遍，
   * 而 toast 在浮层底下也未必看得见（见 module-panel.js 的 say）。
   *
   * 成功的 toast 留着 —— 浮层一关，用户就只剩这一条反馈了。 */
  /**
   * 注册表里那条「波次容器」。
   *
   * 它不是一个模块（ModuleRegistry 里没有这个类），但在**插入**这条路上要当成一条条目用：
   * 波次管理器指着它。找不到就返回 null —— 那条数据没了的话，波次管理器会退回老行为
   * （写一条 `WaveManagerProps` 引用、但没有对象），不该把插入整个炸掉。
   */
  function containerMeta() {
    var hit = null;
    window.ZLevel.Modules.moduleGroups.forEach(function (g) {
      g.items.forEach(function (m) {
        if (!hit && m.isContainer) hit = m;
      });
    });
    return hit;
  }

  function doInsertModule(meta, values, newAlias) {
    /* values 是浮层表单收出来的**整棵 objdata**（没改过的键也在里面，值是骨架默认）。
     * 拿不到时（引用型模块、骨架里没这个 objClass）才回退去读骨架表 —— 那条路上
     * 本来就是"不新建对象"。
     *
     * newAlias 是用户在插入表单的「代号」那一格里填的；**没填传 null**（不是默认别名
     * —— 传了就会跳过 uniqueAlias 的去重，两次插入会当场撞名被拒）。 */
    var skeleton = values || window.ZLevel.Skeletons[meta.objClass];
    /* 这一次插入有没有顺带建出波次容器 —— 建了的话 toast 得说（文件里一下就多了两个
     * 对象，只报「已插入波次管理器」会让用户以为见鬼了）。 */
    var madeBox = false;
    var r = state.applyStructural(function (objects) {
      /* 波次管理器要一个波次容器才指得着东西（它的 WaveManagerProps 键是个 RTID），
       * 而容器不在 Modules 里、真实关卡里是跟管理器一起挂上来的 —— 这份关卡一个都没有
       * 的话，先替用户把它建出来。不建的话写下去的就是一条悬空引用：对象树里"失效引用"
       * 多一条，而用户没有任何入口能把它变好（这正是 2026-09-22 报的那条）。
       *
       * **先建容器再插管理器**是有意的：管理器那条 WaveManagerProps 得指到容器的
       * **实际别名**上（`Edit.insertModule` 插管理器时会去列表里找容器，找不到才退回
       * 字面量），所以容器得先在。
       *
       * 建失败不会留下半个东西：下面那条 ok:false 时 applyStructural 一个字节都不写
       * （连同刚建出来的容器一起不算数）。 */
      var box = null;
      if (meta.objClass === 'WaveManagerModuleProperties' &&
          !Edit.findObject(objects, 'WaveManagerProperties')) {
        var c = containerMeta();
        if (c) {
          var br = Edit.insertModule(objects, c, window.ZLevel.Skeletons[c.objClass], null);
          if (br.ok) { box = br.created; madeBox = true; }
        }
      }
      var res = Edit.insertModule(objects, meta, skeleton, newAlias);
      /* 容器写完要落在管理器**下面那一格**（2026-09-22 用户：「WaveManagerProperties
       * 创建时放在 WaveManagerModuleProperties 下面」）。两步都是往末尾追的，所以顺序
       * 正好是反的，这里挪一下 —— 9 份真实模板里 5 份带容器的，容器都在管理器后面紧挨着，
       * 照那个样子摆。同一次 applyStructural 里，撤销仍然是一步。 */
      if (box && res.ok && res.created) Edit.moveAfter(objects, box, res.created);
      return res;
    }, 'insert');

    if (!r.ok) {
      /* 'exists' 现在只剩容器那一条路会返回（同类模块重复插入是允许的，见
       * Edit.insertModule：两个都在 Modules 里，游戏挑一个用）。 */
      if (r.error === 'exists') return { ok: false, reason: '「' + r.message + '」已经在这个关卡里了（只能有一个）' };
      /* 填了代号那三条：形状不合法 / 撞名 / 代号指向别的文件。reason 是 Edit 那边
       * 给的原文，那句话是照用户填的那个代号写的，比这里重编一句准（跟 doSaveObject
       * 同一条约定）。 */
      if (r.error === 'bad-name' || r.error === 'foreign-alias') {
        return { ok: false, reason: r.reason || '这个代号不能用' };
      }
      if (r.error === 'parse-error') return { ok: false, reason: 'JSON 有语法错误，先修好再插入' };
      return { ok: false, reason: '插入失败：' + r.error };
    }
    /* refWarning 这一档是**成了但没全成**：对象建出来了，就是没能挂进 Modules。
     * 对浮层来说这算 ok（该关，东西确实进关卡了），但得把话说全。 */
    if (r.refWarning) {
      toast('对象建好了，但没能挂进 Modules（' + r.refWarning + '）—— 去「对象」栏的失效引用看看', true);
      return { ok: true };
    }
    toast('已插入「' + meta.title + '」' +
      (r.created ? (madeBox ? '，并建了一个波次容器' : '') : '（引用型，未新建对象）'));
    /* 跳到**新对象**上，不是名字第一次出现的地方 —— 插进来的模块同时在
     * LevelDefinition.Modules 里留了一条引用，而那条在文件最上面。按名字搜会跳到那儿。 */
    if (r.created) revealCreated(r.alias);
    return { ok: true };
  }

  function doInsertEvent(meta, waveIndex, values) {
    var skeleton = values || window.ZLevel.Skeletons[meta.objClass];
    var r = state.applyStructural(function (objects) {
      return Edit.insertEvent(objects, meta, waveIndex, skeleton);
    }, 'insert');

    if (!r.ok) {
      if (r.error === 'bad-wave') return { ok: false, reason: '第 ' + waveIndex + ' 波不存在' };
      if (r.error === 'no-wavemanager') return { ok: false, reason: '这份关卡没有波次管理器，先插入「波次管理器」模块' };
      if (r.error === 'parse-error') return { ok: false, reason: 'JSON 有语法错误，先修好再插入' };
      return { ok: false, reason: '插入失败：' + r.error };
    }
    toast('已插入「' + meta.title + '」到第 ' + r.waveIndex + ' 波');
    revealCreated(r.alias);
    return { ok: true };
  }

  /**
   * 删除对象。
   *
   * 先在文本外面**预演**一遍级联效果，好把话说全（"连带会清掉 N 个"），
   * 用户确认后再真正执行。预演用重新解析出来的那份对象，不能直接拿界面上的
   * 引用去比对 —— 结构操作后它们已经不是同一批实例了。
   */
  function doDeleteObject(node) {
    if (!node) return;
    var s = state.get();
    if (s.parseError) { toast('JSON 有语法错误，先修好再删', true); return; }

    var preview;
    try {
      preview = JSON.parse(s.text);
    } catch (e) { toast('解析失败，先修好语法', true); return; }

    var target = findByNode(preview.objects, node);
    if (!target) { toast('在文件里找不到这个对象', true); return; }

    var probe = preview.objects.slice();
    probe.splice(probe.indexOf(target), 1);
    var wouldCascade = Parse.findOrphanedObjects(probe).length;

    var msg = '要删掉 ' + Parse.objClassOf(target) +
      (Edit.firstAliasOf(target) ? '（' + Edit.firstAliasOf(target) + '）' : '') + ' 吗？';
    if (wouldCascade) msg += '\n\n连带会清掉 ' + wouldCascade + ' 个因此失去引用的对象。';
    msg += '\n\n用「撤销」可以找回来。';
    if (!window.confirm(msg)) return;

    var r = state.applyStructural(function (objects) {
      var t = findByNode(objects, node);
      if (!t) return { ok: false, error: 'not-found' };
      var res = Edit.removeObject(objects, t);
      return { ok: true, cascaded: res.cascaded.length };
    }, 'delete');

    if (!r.ok) { toast('删除失败：' + r.error, true); return; }
    toast('已删除' + (r.cascaded ? '，并连带清理 ' + r.cascaded + ' 个对象' : ''));
  }

  /** 按别名+objclass 在对象列表里定位（别名优先，没有别名就按 objclass 取第一个）。 */
  function findByNode(objects, node) {
    var alias = node.alias;
    if (alias) {
      var byAlias = objects.filter(function (o) { return Edit.firstAliasOf(o) === alias; })[0];
      if (byAlias) return byAlias;
    }
    if (!node.objclass) return null;
    return objects.filter(function (o) { return Parse.objClassOf(o) === node.objclass; })[0] || null;
  }

  function doCleanup() {
    var s = state.get();
    if (s.parseError) { toast('JSON 有语法错误，先修好再清理', true); return; }
    var n = Parse.findOrphanedObjects(s.objects).length;
    if (!n) { toast('没有需要清理的对象'); return; }
    if (!window.confirm('要删掉这 ' + n + ' 个没有任何对象引用的对象吗？\n\n' +
      '它们从 LevelDefinition 出发走不到（指向外部参考文件的引用不算本文件的引用），' +
      '删掉不影响关卡。\n用「撤销」可以找回来。')) return;

    var r = state.applyStructural(function (objects) {
      return { ok: true, removed: Edit.cleanupOrphaned(objects).length };
    }, 'cleanup');
    if (r.ok) toast('已清理 ' + r.removed + ' 个对象');
  }

  /**
   * 撤销 / 重做 —— 都是直接驱动 CodeMirror 的那条历史（打字和结构操作共用一条，
   * 见 js/editor/text.js 的文件头）。这里只负责把提示语说清楚。
   *
   * label 必须在**动之前**取：撤销之后深度就变了，再问 undoLabel() 拿到的是
   * 下一条的名字，提示语会张冠李戴。
   * 编辑器的 docChanged 会顺着 updateListener -> state -> onStateChange 把
   * 状态栏和两个按钮重画一遍，所以这里不用手动 renderStatus。
   */
  function doUndo() {
    var label = text.undoLabel();
    if (!text.undo()) return;
    toast('已撤销' + (label ? '「' + label + '」' : '上一步'));
  }

  function doRedo() {
    var label = text.redoLabel();
    if (!text.redo()) return;
    toast('已重做' + (label ? '「' + label + '」' : '上一步'));
  }

  /**
   * 键盘撤销 / 重做 —— 焦点不在编辑器里也要能用。
   *
   * 为什么需要：点完侧栏的「插入」按钮，焦点就留在那个按钮上了，此时按 Ctrl+Z
   * 毫无反应（CM 的键位只在编辑器有焦点时生效）。而"刚插错了想撤掉"恰恰是
   * 点完按钮立刻发生的动作。
   *
   * 两条守卫都是必须的：
   *   - `e.defaultPrevented`：编辑器有焦点时 CM 自己已经处理并 preventDefault 了
   *     （它的 keymap 认出键位、命令返回 true 就在 InputState.runHandlers 里
   *     preventDefault），这里再看一眼，否则同一件事做两遍 —— 一次退两步。
   *   - 输入框 / contenteditable：图鉴搜索框和 CM 自己的搜索面板得留着自己的撤销。
   */
  function wireKeyboard() {
    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;

      var k = e.key ? e.key.toLowerCase() : '';
      var isUndo = k === 'z' && !e.shiftKey;
      var isRedo = k === 'y' || (k === 'z' && e.shiftKey);
      if (!isUndo && !isRedo) return;

      var t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;

      e.preventDefault();
      if (isUndo) doUndo(); else doRedo();
    });
  }

  // ── 文件 ────────────────────────────────────────────────────────────

  /**
   * 保存 = 把当前文本写成一个文件下载下来。
   *
   * 浏览器里没有别的"真保存"：IndexedDB / localStorage 都可能被浏览器随时清掉
   * （Safari 的 7 天无互动清空规则最阴）。所以这个按钮的诚实名字是"下载"。
   */
  function doSave() {
    var s = state.get();
    if (s.parseError && !window.confirm(
      '当前 JSON 有语法错误：\n' + s.parseError.message +
      '\n\n仍然下载吗？（游戏大概率读不了这个文件）')) return;

    var name = s.fileName || 'level.json';
    if (!/\.json$/i.test(name)) name += '.json';

    var blob = new Blob([s.text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 立刻 revoke 在部分浏览器上会打断下载，挪到下一轮事件循环
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);

    state.markSaved();
    toast('已下载 ' + name);
  }

  function doOpenFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var t = String(reader.result).replace(/\r\n/g, '\n');
      loadDocument(t, file.name, 'file');
      toast('已打开 ' + file.name);
    };
    reader.onerror = function () { toast('读文件失败', true); };
    reader.readAsText(file, 'utf-8');
  }

  function doLoadTemplate(tpl) {
    if (!window.confirm('载入模板会丢弃当前内容（先下载保存？），确定吗？')) return;
    loadDocument(tpl.text, tpl.title + '.json', 'template');
    toast('已载入模板「' + tpl.title + '」');
  }

  // ── 顶栏 / 侧栏 / 设置 ──────────────────────────────────────────────

  function wireTabs() {
    var tabs = document.querySelectorAll('.tabs button');
    Array.prototype.forEach.call(tabs, function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(tabs, function (x) { x.classList.toggle('on', x === b); });
        ['tree', 'modules', 'codex'].forEach(function (k) {
          BY_ID('panel-' + k).hidden = (k !== b.dataset.tab);
        });
        /* 图鉴栏懒建：它一上来就要画一百多条按钮，而 boot 阶段已经扛着
         * 7.6 MB 参考数据了。ensure 是幂等的，切几次都只建一次。
         *
         * 三条接缝都在 main.js 这一侧：
         *   onInsert  插入，就是下面那个 insertSnippets
         *   onCopy    复制 + 提示，toast 是本文件的模块私有函数，面板够不到
         *   onOpen    窄屏开浮层前先把抽屉收掉（跟 btn-menu 那条同一个约定）
         * 面板自己不碰 #scrim / body.sidebar-open：那是本文件的抽屉约定，
         * 而且字面 id 'scrim' 会让 tools/check-editor.js 的 id 清单对不上。 */
        if (b.dataset.tab === 'codex') {
          CodexPanel.ensure(BY_ID('panel-codex'), {
            onInsert: insertSnippets,
            onCopy: copyToClipboard,
            onOpen: function () { if (window.innerWidth < 940) closeSidebar(); }
          });
        }
        if (b.dataset.tab === 'modules') ensureModulePanel();
      });
    });
  }

  /**
   * 建模块栏。**幂等**（ModulePanel.ensure 自己也有 built 闸），所以切页签和点对象树
   * 上那个 ✎ 都可以直接调 —— 用户很可能从没打开过「模块」页签就先点了一个 ✎。
   *
   * 它的侧栏**只建一次、之后不重建**（展开状态不会自己收回去，因为随关卡变的东西
   * —— 插入目标波次那个下拉 —— 搬进浮层了）。
   *
   * 七条接缝都在 main.js 这一侧：
   *   onInsertModule / onInsertEvent / onSaveObject  返回 {ok, reason}，见上面
   *     （onInsertModule 和 onSaveObject 都多带一个"代号"，没填传 null）
   *   onWaveCount   浮层每次打开现问一次「现在几波」
   *   onHasClass    这份关卡里有没有这个 objClass 的对象（浮层判断"有没有波次容器"用）
   *   onModuleExists 这个模块是不是已经在这份关卡里了（浮层判断"两个会相互覆盖"用）
   *   onOpen        窄屏开浮层前先把抽屉收掉（跟图鉴那条同一个约定）
   */
  function ensureModulePanel() {
    ModulePanel.ensure(BY_ID('panel-modules'), {
      onInsertModule: doInsertModule,
      onInsertEvent: doInsertEvent,
      onSaveObject: doSaveObject,
      onWaveCount: function () { return waveCountOf(state.get()); },
      onHasClass: function (objClass) {
        return !!Parse.findByClass(state.get().objects, objClass);
      },
      onModuleExists: function (meta) {
        return Edit.moduleExists(state.get().objects, meta);
      },
      onOpen: function () { if (window.innerWidth < 940) closeSidebar(); }
    });
  }

  function wireTopbar() {
    BY_ID('btn-menu').addEventListener('click', function () {
      var open = document.body.classList.toggle('sidebar-open');
      BY_ID('scrim').hidden = !open;
    });
    BY_ID('scrim').addEventListener('click', closeSidebar);

    BY_ID('btn-open').addEventListener('click', function () { BY_ID('file-input').click(); });
    BY_ID('file-input').addEventListener('change', function (e) {
      doOpenFile(e.target.files[0]);
      e.target.value = '';           // 同一个文件连选两次也要能触发
    });

    BY_ID('btn-save').addEventListener('click', doSave);
    BY_ID('btn-undo').addEventListener('click', doUndo);
    BY_ID('btn-redo').addEventListener('click', doRedo);

    var tplBtn = BY_ID('btn-templates');
    var tplPop = BY_ID('tpl-pop');
    window.ZLevel.Templates.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = t.title;
      b.addEventListener('click', function () { tplPop.hidden = true; doLoadTemplate(t); });
      tplPop.appendChild(b);
    });
    tplBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var wasOpen = !tplPop.hidden;
      closePopovers();
      if (!wasOpen) {
        tplPop.hidden = false;
        var r = tplBtn.getBoundingClientRect();
        tplPop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 200)) + 'px';
      }
    });
  }

  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    BY_ID('scrim').hidden = true;
  }

  function closePopovers() {
    [BY_ID('tpl-pop'), BY_ID('settings')].forEach(function (p) { if (p) p.hidden = true; });
  }

  function wireSettings() {
    var pop = BY_ID('settings');
    BY_ID('btn-settings').addEventListener('click', function (e) {
      e.stopPropagation();
      var wasOpen = !pop.hidden;
      closePopovers();
      pop.hidden = wasOpen;
    });

    var seg = pop.querySelector('.seg[data-key="theme"]');
    var saved = null;
    try { saved = localStorage.getItem('zeditor.theme'); } catch (err) { /* 隐私模式下会抛 */ }
    applyTheme(saved || 'auto');
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.dataset.val === (saved || 'auto'));
      b.addEventListener('click', function () {
        applyTheme(b.dataset.val);
        Array.prototype.forEach.call(seg.querySelectorAll('button'), function (x) {
          x.classList.toggle('on', x === b);
        });
        try { localStorage.setItem('zeditor.theme', b.dataset.val); } catch (err) { /* 存不上就算了 */ }
      });
    });
  }

  function applyTheme(v) {
    if (v === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', v);
    if (text) text.reconfigureTheme();
  }

  // 点空白处收浮层
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.popover') && !e.target.closest('#btn-templates') &&
        !e.target.closest('#btn-settings')) {
      closePopovers();
    }
  });

  // ── 提示条 ──────────────────────────────────────────────────────────

  var toastTimer = null;
  function toast(msg, bad) {
    var t = BY_ID('toast');
    t.textContent = msg;
    t.className = 'toast' + (bad ? ' toast-bad' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, bad ? 5200 : 2600);
  }

  // ── 插入接缝 ────────────────────────────────────────────────────────

  /**
   * 往光标处插一段文本。**图鉴栏两条接缝之一**（另一条是下面的复制；
   * 建 DOM 的那部分在 js/editor/codex-panel.js，dispatch 留在这儿）。
   *
   * 收**数组**是为了多选：图鉴栏现在恒传一条，但等它支持"勾选若干条一次插入"
   * 时，这条路径一个字都不用改。多条**必须一次 dispatch** —— 分 N 次会变成
   * N 步撤销、N 次全量重建面板。
   *
   * 插完**不抢焦点**。原先这里有一句 text.focus()：在"来插一条就走"的搜索框上
   * 没问题，但图鉴栏是常驻浏览面，用户要连着插好几条，每插一条焦点被拽回编辑器
   * 就得再点回列表。CM 的 selection 仍然落到插入内容之后（DOM 焦点跟 CM state
   * 里的 selection 是两回事），所以接着插入的位置照样正确。
   *
   * 这条路**绕过 state.applyStructural**：它是光标处的文本编辑，不是结构操作，
   * 所以不置 normalized（state.js）。多选落地时也是同一条路，别为了"顺手"改。
   */
  function insertSnippets(snippets) {
    if (!snippets || !snippets.length) return;
    var sel = text.view.state.selection.main;
    var ins = snippets.join('\n');
    text.view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: ins },
      selection: { anchor: sel.from + ins.length }
    });
    toast(snippets.length > 1 ? '已插入 ' + snippets.length + ' 条' : '已插入 ' + snippets[0]);
  }

  /**
   * 兜底复制：老 API。要在文档里**真插一个 textarea 并选中**，浏览器才认。
   *
   * 整段包在 try/catch 里，而且 textarea 用 finally 摘掉 ——
   * `document.execCommand` 在 jsdom 里根本不存在（裸调直接 TypeError），
   * 而这里抛出去就是"点一条代码，页面炸了"。
   */
  function fallbackCopy(text2) {
    var ta = null;
    try {
      ta = document.createElement('textarea');
      ta.value = text2;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      return !!document.execCommand('copy');
    } catch (e) {
      return false;
    } finally {
      if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
    }
  }

  /** 写剪贴板，返回 Promise<boolean>（true = 写成了）。**永不 reject**。 */
  function writeClipboard(s) {
    var nav = window.navigator;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function' &&
        window.isSecureContext) {
      try {
        /* writeText 可能是同步抛（权限策略），也可能是异步 reject（用户拒绝），
         * 两条都要落回兜底，不能变成"点了没反应"。 */
        return Promise.resolve(nav.clipboard.writeText(s)).then(
          function () { return true; },
          function () { return fallbackCopy(s); });
      } catch (e) {
        return Promise.resolve(fallbackCopy(s));
      }
    }
    return Promise.resolve(fallbackCopy(s));
  }

  /**
   * 复制一段文本并提示。**图鉴栏的另一条接缝。**
   *
   * 为什么复制放在 main.js 而不是面板里：toast 是本文件的模块私有函数，
   * 面板够不到；在面板里复制一份 toast 的类名和计时逻辑，就等于把"提示条长什么样"
   * 抄成两份，迟早长歪。
   *
   * ⚠ 这个 promise **必须挂 .catch**，而且 catch 里不能再抛：jsdom realm 里一个
   * 未处理的 rejection 会让 node 以退出码 1 直接终止。tools/check-boot.js 的扫雷
   * 要点几十次条目，第一次点击就能把整套打死 —— 表现是"打到扫雷就没输出、
   * 没有汇总、没有『整页跑通』"，不是一条红的断言。
   *
   * @param {string} s     已经按当前格式拼好的文本（纯代码 / 带引号 / RTID）
   * @param {string} note  可选。格式上的保留意见，比如选了 RTID 但这章没有表名，
   *                       回退成带引号时得说一声，不然用户以为是 bug。
   */
  function copyToClipboard(s, note) {
    writeClipboard(s).then(function (done) {
      if (done) toast('已复制 ' + s + (note ? '（' + note + '）' : ''));
      else toast('复制失败，请手动选中代码', true);
      /* 注意文案**不能**写"请长按"：长按在图鉴列表里已经是插入手势了，
       * 照旧图鉴站那句「请长按代码手动选择」抄会把人引到反方向。 */
    }).catch(function () {
      toast('复制失败，请手动选中代码', true);
    });
  }

  // ── 起 ──────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
