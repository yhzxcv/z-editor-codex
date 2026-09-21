/* 文档状态 —— 文本与对象树之间的唯一协调者
 *
 * ── 两条表示，一个真源 ──
 *   text    权威。用户打的字、保存时落盘的都是它。
 *   objects 派生。解析 text 得到，喂给对象树、校验、插入面板。
 *
 * 解析失败时 objects 保留**上一次成功的结果**，同时记事本里记下错误；
 * 这样用户打字打到一半（JSON 暂时不合法）时树不会整个塌掉，
 * 但所有结构操作会被拒 —— 那才是安全的做法。
 *
 * ── 结构操作的撤销 ──
 * 结构操作（插入模块/事件、删对象、清孤儿）绕过 CodeMirror 直接换文本，
 * 所以 CM 自己的撤销栈管不到它们。这里另存一个文本快照栈补上。
 */
window.ZEditor = window.ZEditor || {};
window.ZEditor.State = (function () {
  'use strict';

  var MAX_UNDO = 50;
  var UNDO_LABEL = { insert: '插入', delete: '删除', cleanup: '清理' };

  function create() {
    var listeners = [];
    var s = {
      fileName: '',
      text: '',
      objects: [],
      parseError: null,
      /** 发生过结构操作 —— 数字写法可能已被规范化 */
      normalized: false,
      /** 文件是从磁盘读的还是从模板载入的（决定"保存"是下载还是覆盖提示） */
      source: '',
      undoStack: []
    };

    /**
     * 通知订阅者。
     *
     * 传出去的是**纯数据记录**（`s` 本身），它上面只有 fileName / text /
     * objects / parseError / normalized / source —— **没有任何方法**。
     * 订阅者要用 canUndo() / undo() 这些，得去调 create() 返回的那个对象。
     *
     * 这条分界踩过一次：renderStatus 里写了 `s.canUndo()`，抛异常，
     * 连带它后面的三个面板全画不出来，表现是"页面在、点谁都没反应"。
     */
    function emit() { listeners.forEach(function (fn) { fn(s); }); }

    function parseInto(text) {
      try {
        var doc = JSON.parse(text);
        if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
          s.parseError = { message: '顶层必须是一个对象', pos: 0, len: 1 };
          return false;
        }
        if (!Array.isArray(doc.objects)) {
          s.parseError = { message: '缺少 objects 数组', pos: 0, len: Math.min(1, text.length) };
          return false;
        }
        s.objects = doc.objects;
        s.parseError = null;
        return true;
      } catch (e) {
        s.parseError = errorPos(e, text);
        return false;
      }
    }

    /**
     * 解析失败时的错误记录。
     *
     * 位置**不取引擎的**，自己扫一遍（见 jsonpos.js）：V8 对最常见的
     * "少了一个括号""内容断了"根本不给位置，取引擎的话波浪线永远在第一行。
     *
     * 引擎原文留在 engine 里 —— 它是权威，扫描器只是更会指路。
     */
    function errorPos(e, text) {
      var engine = String(e && e.message || '解析失败')
        .replace(/\s*\(line \d+ column \d+\)\s*$/, '')
        .replace(/^JSON\.parse: /, '');

      var found = window.ZEditor.JsonPos.scan(text);
      if (!found) {
        // 扫描器说没问题（只有 parse 失败才会走到这，理论上不该发生）——
        // 那就老实承认不知道在哪，标在开头。
        return { message: engine, engine: engine, pos: 0, len: 1 };
      }
      return {
        message: found.message,
        engine: engine,
        pos: Math.max(0, Math.min(found.pos, Math.max(0, text.length - 1))),
        len: 1
      };
    }

    return {
      get: function () { return s; },

      subscribe: function (fn) { listeners.push(fn); },

      /** 用户在编辑器里打字。不碰撤销栈（那是结构操作专用的）。 */
      setText: function (text) {
        s.text = text;
        parseInto(text);
        emit();
      },

      /**
       * 载入一份新文档（打开文件 / 选模板）。
       * 换文档会清空撤销栈 —— 上一个文件的快照对新文件没有意义。
       */
      load: function (text, fileName, source) {
        s.text = text;
        s.fileName = fileName || '';
        s.source = source || '';
        s.normalized = false;
        s.undoStack.length = 0;
        parseInto(text);
        emit();
      },

      /**
       * 结构操作：拿一份新的对象列表，序列化回文本。
       *
       * 调用方（main.js / 各结构操作）只管改对象，快照压栈和写回都在这里。
       * 返回是否成功 —— 解析都不通过时拒绝执行，免得把半截文本序列化成
       * 一个"合法但不是用户想要"的文件。
       */
      applyStructural: function (mutate, label) {
        if (s.parseError) return { ok: false, error: 'parse-error' };

        var snapshot = s.text;
        var doc = JSON.parse(s.text);
        var result = mutate(doc.objects, doc);
        if (result && result.ok === false) return result;   // 操作自己拒绝了，别动文本

        var next = window.ZEditor.Text.stringify(doc);
        s.undoStack.push({ text: snapshot, label: label || '修改' });
        if (s.undoStack.length > MAX_UNDO) s.undoStack.shift();

        s.text = next;
        s.normalized = true;
        parseInto(next);
        emit();
        return result || { ok: true };
      },

      canUndo: function () { return s.undoStack.length > 0; },
      undoLabel: function () {
        var top = s.undoStack[s.undoStack.length - 1];
        return top ? (UNDO_LABEL[top.label] || top.label) : '';
      },

      undo: function () {
        var snap = s.undoStack.pop();
        if (!snap) return false;
        s.text = snap.text;
        parseInto(s.text);
        // 撤销回快照后，之前的结构操作可能全部回退了；保守起见保留 normalized 标记，
        // 因为只要这一轮里发生过规范化，文本就已经不是原始字节了
        emit();
        return true;
      },

      /** 保存成功后复位"已规范化"提示。 */
      markSaved: function () { emit(); }
    };
  }

  return { create: create };
})();
