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
 * ── 撤销/重做不在这里 ──
 * 这套代码原来自己攒一个文本快照栈（undoStack），因为结构操作绕过 CodeMirror
 * 直接换文本、CM 的撤销栈管不到它们。现在改成**结构操作也走 CM 的历史**
 * （见 js/editor/text.js 的 setText），全站只剩一套历史，快照栈就删掉了。
 *
 * 这里留下的唯一痕迹是 emit 的 reason：界面要知道这次变化是**谁**造成的，
 * 才能决定怎么把它写回编辑器 —— 载入要清空历史、结构操作要自成一步、
 * 打字则什么都不用做（编辑器本来就是改动源头）。
 * 用参数传而不是记在 s 上：s 是共享的，markSaved() 这类"发个通知但没改文本"
 * 的路径会让记上去的 reason 变馊。
 */
window.ZEditor = window.ZEditor || {};
window.ZEditor.State = (function () {
  'use strict';

  /** 结构操作的内部代号 -> 给用户看的名字。 */
  var OP_LABEL = { insert: '插入', delete: '删除', cleanup: '清理', update: '改参数' };

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
      source: ''
    };

    /**
     * 通知订阅者。
     *
     * 传出去的是**纯数据记录**（`s` 本身），它上面只有 fileName / text /
     * objects / parseError / normalized / source —— **没有任何方法**。
     * 订阅者要用别的东西，得去调 create() 返回的那个对象。
     *
     * 这条分界踩过一次：renderStatus 里写了 `s.canUndo()`，抛异常，
     * 连带它后面的三个面板全画不出来，表现是"页面在、点谁都没反应"。
     *
     * reason 是这次变化的原因，label 只在 reason 为 'structural' 时有值：
     *   'load'        载入新文档      -> 编辑器整篇重置，清空撤销历史
     *   'structural'  结构操作        -> 整篇替换但保住历史，自成一步
     *   'edit'        用户打字        -> 编辑器是源头，一般什么都不用做
     *   'save'        只是刷新界面    -> 文本没变
     */
    function emit(reason, label) {
      listeners.forEach(function (fn) { fn(s, reason, label); });
    }

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

      /** 用户在编辑器里打字。打字的历史由 CodeMirror 自己记，这里只更新派生数据。 */
      setText: function (text) {
        s.text = text;
        parseInto(text);
        emit('edit');
      },

      /**
       * 载入一份新文档（打开文件 / 选模板）。
       * reason 是 'load'：界面据此**清空编辑器的撤销历史** ——
       * 上一个文件的快照对新文件没有意义，不该还能撤销回去。
       */
      load: function (text, fileName, source) {
        s.text = text;
        s.fileName = fileName || '';
        s.source = source || '';
        s.normalized = false;
        parseInto(text);
        emit('load');
      },

      /**
       * 结构操作：拿一份新的对象列表，序列化回文本。
       *
       * 调用方（main.js / 各结构操作）只管改对象，序列化和通知都在这里。
       * 不再拍快照 —— 上一个状态已经在 CodeMirror 的历史里了；这里只把
       * 操作名交出去，界面拿它当这次撤销的提示语。
       * 返回是否成功 —— 解析都不通过时拒绝执行，免得把半截文本序列化成
       * 一个"合法但不是用户想要"的文件。
       */
      applyStructural: function (mutate, label) {
        if (s.parseError) return { ok: false, error: 'parse-error' };

        var doc = JSON.parse(s.text);
        var result = mutate(doc.objects, doc);
        if (result && result.ok === false) return result;   // 操作自己拒绝了，别动文本

        var next = window.ZEditor.Text.stringify(doc);
        s.text = next;
        s.normalized = true;
        parseInto(next);
        emit('structural', OP_LABEL[label] || label || '修改');
        return result || { ok: true };
      },

      /** 保存成功后复位"已规范化"提示。文本没变，只是让状态栏重画一遍。 */
      markSaved: function () { emit('save'); }
    };
  }

  return { create: create };
})();
