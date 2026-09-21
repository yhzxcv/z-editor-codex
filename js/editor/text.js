/* 文本编辑区 —— CodeMirror 6 的封装
 *
 * 文本是**唯一真源**：保存时落盘的就是这里的字符串，不做重新序列化。
 * 只有结构操作（插入模块/事件、删对象、清孤儿）会改文本，且改动会**写回编辑器**，
 * 用户看得见、也能用编辑器的撤销找回来。
 *
 * CM6 是 ESM-only 的，file:// 下加载不了模块，所以 vendor/cm6.js 是预先打好的
 * IIFE（见 tools/build-vendor.mjs），这里直接用 window.CM。
 */
window.ZEditor = window.ZEditor || {};
window.ZEditor.Text = (function () {
  'use strict';

  var CM = window.CM;

  /** 缩进用 2 空格 —— 跟 Gson 的 setPrettyPrinting 输出一致。 */
  var INDENT = '  ';

  function create(container, opts) {
    opts = opts || {};
    var themeComp = new CM.Compartment();

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
        if (u.docChanged && opts.onChange) opts.onChange(u.state.doc.toString());
      })
    ];

    var state = CM.EditorState.create({ doc: opts.doc || '', extensions: extensions });
    var view = new CM.EditorView({ state: state, parent: container });

    // 跟随系统主题切换编辑器配色
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onTheme = function () {
      // 页面自己设了 data-theme 时以页面为准，别被系统主题盖掉
      view.dispatch({ effects: themeComp.reconfigure(currentTheme()) });
    };
    if (mq.addEventListener) mq.addEventListener('change', onTheme);

    function currentTheme() {
      var forced = document.documentElement.getAttribute('data-theme');
      var dark = forced ? forced === 'dark' : mq.matches;
      return dark ? CM.oneDark : [];
    }

    return {
      view: view,

      getText: function () { return view.state.doc.toString(); },

      /**
       * 整体换文档（打开文件、结构操作写回）。
       *
       * 用重建 state 而不是 dispatch 替换全文：打开新文件时不该还能撤销回
       * 上一个文件的内容。代价是撤销历史清空 —— 结构操作那几处因此自己
       * 留了快照栈（见 state.js 的 undoStack）。
       */
      setText: function (text) {
        view.setState(CM.EditorState.create({ doc: text, extensions: extensions }));
      },

      focus: function () { view.focus(); },

      /** 跳到某个字符串第一次出现的位置并选中它。找不到就返回 false。 */
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
    stringify: stringify,
    diagnosticOf: diagnosticOf,
    zhError: zhError,
    INDENT: INDENT
  };
})();
