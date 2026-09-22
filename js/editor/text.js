/* 文本编辑区 —— CodeMirror 6 的封装
 *
 * 文本是**唯一真源**：保存时落盘的就是这里的字符串，不做重新序列化。
 * 只有结构操作（插入模块/事件、删对象、清孤立模块）会改文本，且改动会**写回编辑器**，
 * 用户看得见、也能用编辑器的撤销找回来。
 *
 * CM6 是 ESM-only 的，file:// 下加载不了模块，所以 vendor/cm6.js 是预先打好的
 * IIFE（见 tools/build-vendor.mjs），这里直接用 window.CM。
 *
 * ── 撤销/重做：只有一套历史，就是 CM 这一套 ──
 * 打字和结构操作都是文档改动，**共用 basicSetup 里带的那条撤销栈**（键位也由
 * basicSetup 绑好：Mod-z / Mod-y / Mod-Shift-z）。界面上的按钮只是驱动它。
 * 所以本模块要额外做两件事：
 *
 *   1. 结构操作写回时**不能**用 view.setState —— 那会把整条历史清掉
 *      （实测 undoDepth 1→0，而且 setState **不触发** updateListener）。
 *      要走 dispatch 整篇替换，并用 isolateHistory 让它自成一步。
 *   2. CM 的历史不存元数据，所以另维护一份平行的 labels[] 给按钮当提示语，
 *      在 updateListener 里跟着 undoDepth 同步。
 */
window.ZEditor = window.ZEditor || {};
window.ZEditor.Text = (function () {
  'use strict';

  var CM = window.CM;

  /** 缩进用 2 空格 —— 跟 Gson 的 setPrettyPrinting 输出一致。 */
  var INDENT = '  ';

  /**
   * 历史标签的同步 —— **纯函数**，不碰 CM，所以 tools/check-editor.js 能在
   * 裸 vm 里逐个用例钉死它（那边没有 window.CM，也就跑不了真编辑器）。
   *
   * labels[i] 是第 i 条可撤销事件的名字（用户打的字没有名字，是空串）。
   * 返回新数组，不改传进来的那个。
   *
   * kind: 'edit' 一次真的改动 | 'undo'/'redo' 只是移动指针 | '' 与历史无关
   * depth: 这次更新之后的 undoDepth
   * prevDepth: 更新之前的 undoDepth
   *
   * ── 为什么需要 prevDepth 这一路 ──
   * CM 的历史有条数上限（basicSetup 的 history() 用默认值：到 120 条时
   * 一次性从**前面**丢掉 18 条再继续）。实测 `undoDepth` 是 120→102 地掉，
   * 不是涨。只按「新事件落在 depth-1」写的话，标签会从那一刻起整体错位 18、
   * 然后 36…… 表现是按钮提示语写着另一个操作的名字。
   * 所以 depth 没涨时要先把**前面**那么多条 splice 掉。
   */
  function syncLabels(labels, pending, kind, depth, prevDepth) {
    var out = labels.slice();
    /* depth < 1 的守卫不能省：下面 `out.length = Math.min(..., depth - 1)`
     * 在 depth 为 0 时是给 length 赋 -1，直接抛 "Invalid array length"。 */
    if (kind !== 'edit' || depth < 1) return { labels: out, pending: pending };

    if (depth <= prevDepth) {
      // 新事件把最老的挤掉了：旧的 done[drop..] 平移到了 done[0..]
      out.splice(0, Math.max(0, prevDepth + 1 - depth));
    } else {
      // 撤销之后又打字 -> 那条重做分支作废，它的标签也得跟着丢
      out.length = Math.min(out.length, depth - 1);
    }
    out[depth - 1] = pending;
    return { labels: out, pending: '' };
  }

  function create(container, opts) {
    opts = opts || {};
    var themeComp = new CM.Compartment();

    // ⚠ 顺序要紧：下面建 extensions 时就会调 currentTheme()，而它要读 mq。
    // 这三样必须都排在 extensions 前面 —— 曾经把 mq 写在 extensions 之后，
    // 靠 var 提升拿到一个 undefined，于是 create() 第一句就抛
    // "Cannot read properties of undefined (reading 'matches')"，
    // boot() 当场死掉：页面画得出来、按钮 hover 有手型、但点谁都没反应。
    var mq = window.matchMedia('(prefers-color-scheme: dark)');

    function currentTheme() {
      // 页面自己设了 data-theme 时以页面为准，别被系统主题盖掉
      var forced = document.documentElement.getAttribute('data-theme');
      var dark = forced ? forced === 'dark' : mq.matches;
      return dark ? CM.oneDark : [];
    }

    var onTheme = function () {
      view.dispatch({ effects: themeComp.reconfigure(currentTheme()) });
    };

    // 历史标签：labels[i] 对应第 i 条可撤销事件；pendingLabel 是「下一次文档改动
    // 该叫什么」，由 setText 在 dispatch 前置好、updateListener 里消费掉。
    var labels = [];
    var pendingLabel = '';
    var prevDepth = 0;

    /**
     * 把一次 ViewUpdate 折算成 syncLabels 的入参。
     * 与历史无关的更新（setDiagnostics、Compartment 重配、reveal 的纯选区块）
     * 不改 depth，直接跳过 —— 但 prevDepth 还是要跟着走，免得下次算错。
     */
    function syncFrom(u) {
      var depth = CM.undoDepth(u.state);
      var tr = u.transactions[u.transactions.length - 1];
      var kind = '';
      if (tr) {
        if (tr.isUserEvent('undo')) kind = 'undo';
        else if (tr.isUserEvent('redo')) kind = 'redo';
        else if (u.docChanged) kind = 'edit';
      }
      if (kind) {
        var next = syncLabels(labels, pendingLabel, kind, depth, prevDepth);
        labels = next.labels;
        pendingLabel = next.pending;
      }
      prevDepth = depth;
    }

    // 扩展列表只建一次，setText 重建 state 时复用同一份（Compartment 实例必须
    // 跟着复用，否则主题那条 reconfigure 会打到已经作废的 compartment 上）
    var extensions = [
      CM.basicSetup,
      CM.json(),
      CM.lintGutter(),
      CM.keymap.of([
        { key: 'Mod-s', run: function () { if (opts.onSave) opts.onSave(); return true; } },
        { key: 'Mod-o', run: function () { if (opts.onOpen) opts.onOpen(); return true; } }
      ]),
      CM.EditorView.lineWrapping,
      themeComp.of(currentTheme()),
      CM.EditorView.updateListener.of(function (u) {
        syncFrom(u);
        if (u.docChanged && opts.onChange) opts.onChange(u.state.doc.toString());
      })
    ];

    var state = CM.EditorState.create({ doc: opts.doc || '', extensions: extensions });
    var view = new CM.EditorView({ state: state, parent: container });

    // 跟随系统主题切换编辑器配色
    if (mq.addEventListener) mq.addEventListener('change', onTheme);

    return {
      view: view,

      getText: function () { return view.state.doc.toString(); },

      /**
       * 结构操作写回：整篇替换，但**保住撤销历史**，并让这次操作自成一步。
       *
       * 为什么不能用 setState：那会清空历史，于是每插一个模块，用户之前打的字
       * 就永远撤不回来了。为什么必须带 isolateHistory：实测不带的话，整篇替换会
       * **并进前一次输入的分组**（undoDepth 不涨），一次 undo 把打字和替换一起
       * 退掉 —— 退多了。用 'full' 而不是 'before'：还要挡住**后面**接着打的字
       * 并进来，否则下一次打字会把结构操作吞掉，同样是一步退两下。
       *
       * 光标：setState 那会儿是回到文首（重建 state 的默认值），改走 dispatch
       * 之后位置会被映射到插入内容的末尾 —— 也就是文件结尾。两个都不怎么样，
       * 但「跳到文末」会让下一次按键落到最后一个 } 后面，比文首更糟，
       * 所以这里显式夹住原光标。删对象/清理那两条路径后面没有 reveal 兜底，
       * 就靠它。
       */
      setText: function (text, label) {
        var cur = view.state;
        /* 文本没变时**不能**放过：CM 的 ChangeSet 不比内容，替换成一样的串照样
         * 算一次改动、照样进历史 —— 白占一条，还会让撤销按钮凭空亮起来。 */
        if (cur.doc.toString() === text) return;
        var keep = Math.min(cur.selection.main.anchor, text.length);
        pendingLabel = label || '';
        try {
          view.dispatch({
            changes: { from: 0, to: cur.doc.length, insert: text },
            selection: { anchor: keep },
            annotations: CM.isolateHistory.of('full')
          });
        } finally {
          /* dispatch 万一抛（最典型的是改了 cm6-entry.mjs 却没重跑
           * npm run build，CM.isolateHistory 是 undefined），标签不能漏给
           * 下一次改动。异常本身照旧往上抛，别吞。 */
          pendingLabel = '';
        }
      },

      /**
       * 整篇换文档（打开文件、选模板）—— **并清空撤销历史**。
       *
       * 打开新文件时不该还能撤销回上一个文件的内容，所以这条走 setState。
       * 注意 setState **不触发 updateListener**，所以 labels / prevDepth 得
       * 在这里手动归零，不能指望 syncFrom 帮忙 —— 漏了的话按钮提示语会拿
       * 新文档的历史深度去索引旧文档的标签，写出「撤销：undefined」。
       *
       * 也不做「文本相同就跳过」的短路：一模一样的内容照样是另一个文件，
       * 历史该断就得断。
       */
      resetText: function (text) {
        view.setState(CM.EditorState.create({ doc: text, extensions: extensions }));
        labels.length = 0;
        pendingLabel = '';
        prevDepth = 0;
      },

      undo: function () { return CM.undo(view); },
      redo: function () { return CM.redo(view); },
      undoDepth: function () { return CM.undoDepth(view.state); },
      redoDepth: function () { return CM.redoDepth(view.state); },
      /** 下一次撤销会退掉的那一步叫什么（用户打的字没有名字 -> 空串）。 */
      undoLabel: function () { return labels[CM.undoDepth(view.state) - 1] || ''; },
      /** 下一次重做会重做的那一步叫什么。 */
      redoLabel: function () { return labels[CM.undoDepth(view.state)] || ''; },

      focus: function () { view.focus(); },

      /** 跳到某个字符串第一次出现的位置并选中它。找不到就返回 false。
       *
       * 这是"按名字搜"那条路 —— 只该用在**引用**上（失效引用那一行的 rtid 本来
       * 就是文本里的一串字符，没有"对象"可定位）。跳到一个**对象**上要走
       * revealRange，见下面：名字在文件里重复出现时，先中谁全看运气。 */
      reveal: function (needle) {
        if (!needle) return false;
        var text = view.state.doc.toString();
        var idx = text.indexOf(needle);
        if (idx < 0) return false;
        view.dispatch({
          selection: { anchor: idx, head: idx + needle.length },
          scrollIntoView: true
        });
        view.focus();
        return true;
      },

      /**
       * 选中 [from, to) 这一段（按结构算出来的区间，见 js/level/spans.js）。
       * 区间不合法就返回 false —— 调用方那时退回 reveal。
       *
       * ⚠ `anchor`/`head` 是**反着**写的，别"顺手顺过来"。CM 里 `head` 才是**活动端**
       * —— 光标停在那一头。原先写成 `{anchor: from, head: to}`，于是跳过去之后光标
       * 落在**对象末尾**，`scrollIntoView` 也是奔着 head 去的，长一点的模块会把你
       * 直接送到尾巴上。2026-09-22 用户报的就是这个：「跳转到模块时光标位置在模块尾，
       * 改成放在模块头」。反着写之后选中的区间**一模一样**（还是整段），变的只是
       * 光标在哪一头 —— 所以下面两条断言（`check-boot.js` 里只看 from/to）照样绿。
       */
      revealRange: function (from, to) {
        var len = view.state.doc.length;
        if (!(from >= 0) || !(to > from) || to > len) return false;
        view.dispatch({
          selection: { anchor: to, head: from },
          scrollIntoView: true
        });
        view.focus();
        return true;
      },

      /**
       * 语法错误标注（JSON.parse 失败时把位置画出来）。
       *
       * CM6 的 lint 是"有人往状态里塞诊断"才显示的：basicSetup 里的 lintGutter
       * 只提供了一条 gutter 槽位和一个空的 StateField，不主动塞东西那条槽就是空跑的。
       *
       * 签名是 setDiagnostics(state, diagnostics) —— 第一个参数不是可有可无的，
       * 它用来判断 lint 扩展装了没有（没装的话返回的 effect 会被直接丢掉）。
       * 传空数组即清除。
       */
      setDiagnostics: function (list) {
        view.dispatch(CM.setDiagnostics(view.state, list || []));
      },

      reconfigureTheme: onTheme,

      destroy: function () {
        if (mq.removeEventListener) mq.removeEventListener('change', onTheme);
        view.destroy();
      }
    };
  }

  /** 用 2 空格缩进序列化一个 JSON 树（结构操作写回文本时用）。 */
  function stringify(obj) {
    return JSON.stringify(obj, null, INDENT);
  }

  // ── 解析错误 -> 编辑器标注 ──────────────────────────────────────────

  /**
   * 把 state.js 记下的解析错误转成一条 CM 诊断。没有错误就传 null / 空文本。
   *
   * 报错点常在行尾或文末，往后取一个字符画波浪线；到末尾没得取了就往前退一格
   * —— CM 不接受零长度区间（会退化成一个小圆点 widget，很难看）。
   */
  function diagnosticOf(pe, textLen) {
    if (!pe || !textLen) return null;
    var from = Math.max(0, Math.min(pe.pos, textLen - 1));
    var to = Math.min(textLen, from + Math.max(1, pe.len || 1));
    if (to <= from) from = Math.max(0, to - 1);
    return { from: from, to: to, severity: 'error', message: zhError(pe.message) };
  }

  /**
   * 把引擎的英文报错翻成人话。翻不动就原样返回 —— 英文总比什么都不说强。
   * 原文留着给横幅的 title 用，真想看细节也看得到。
   */
  var ERR_ZH = [
    [/unexpected end of (json input|data)/i, '内容不完整：多半是少了一个 } 或 ]'],
    [/unterminated string/i, '字符串少了收尾的双引号'],
    [/expected double-quoted property name/i, '属性名必须用双引号包起来'],
    [/expected property name or '\}'/i, '这里应该是一个属性名，或者 }'],
    [/expected ',' or '\}' after property value/i, '这里少了一个逗号，或者该补上 }'],
    [/expected ',' or '\]' after array element/i, '这里少了一个逗号，或者该补上 ]'],
    [/bad control character/i, '字符串里有没转义的控制字符（比如直接敲了回车）'],
    [/bad escaped character/i, '字符串里有无效的转义（\\ 后面跟的字符不对）'],
    [/unexpected non-whitespace character after json/i, 'JSON 结束之后还有多余的内容'],
    [/unexpected token '?([^'\s,]+)'?/i, '这里多了一个 $1，或者它前面少了点什么'],
    [/unexpected character/i, '这里有个不该出现的字符']
  ];

  function zhError(msg) {
    msg = String(msg || '');
    for (var i = 0; i < ERR_ZH.length; i++) {
      var m = ERR_ZH[i][0].exec(msg);
      if (m) return ERR_ZH[i][1].replace('$1', m[1] || '');
    }
    return msg;
  }

  return {
    create: create,
    syncLabels: syncLabels,
    stringify: stringify,
    diagnosticOf: diagnosticOf,
    zhError: zhError,
    INDENT: INDENT
  };
})();
