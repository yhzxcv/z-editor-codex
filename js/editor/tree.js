/* 对象树 —— 左侧栏的「对象」页
 *
 * 画的不是 JSON 的嵌套结构（那跟文本编辑器没区别），而是**关卡的层次**：
 * 关卡定义 / 模块 / 波次 / 支撑对象 / 未引用。用户在找"第 8 波那个裂缝事件"时
 * 是照这个层次找的，不是照 objdata 的嵌套找的。层次怎么切见 js/level/outline.js。
 *
 * 点击节点 -> 编辑器跳到那个对象的别名（找不到就退而求其次找 objclass）。
 */
window.ZEditor = window.ZEditor || {};
window.ZEditor.Tree = (function () {
  'use strict';

  /** 折叠状态跨重绘保留 —— 否则每打一个字树就全展开了。 */
  var collapsed = {};

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /**
   * 一个可点击的叶节点。
   *
   * 整行是"跳到文本"，删除是行内一个单独的 ✕（默认隐藏，悬停或聚焦才出现）。
   * 删除按钮不能嵌在跳转按钮里（button 套 button 是非法 HTML），所以行本身是
   * 一个 div，里面放两个并列的 button。
   */
  function leaf(node, onPick, onDelete) {
    var row = el('div', 'node');
    var go = el('button', 'node-go');
    go.type = 'button';
    go.title = node.objclass + (node.alias ? '  ·  ' + node.alias : '') + '\n点击跳到文本里的位置';
    go.appendChild(el('span', 'node-cls', node.objclass));
    if (node.alias) go.appendChild(el('span', 'node-alias', node.alias));
    // 引用了本文件里找不到的东西 -> 标黄，这是最常见的手改错误
    if (node.dangling && node.dangling.length) {
      var w = el('span', 'node-warn', '⚠');
      w.title = '引用了找不到的别名：' + node.dangling.join('、');
      go.appendChild(w);
    }
    go.addEventListener('click', function () { onPick(node); });
    row.appendChild(go);

    // 根对象（LevelDefinition）不给删 —— 删了整份文件就废了
    if (onDelete && node.obj && node.objclass !== 'LevelDefinition') {
      var del = el('button', 'node-del', '✕');
      del.type = 'button';
      del.title = '删除这个对象';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        onDelete(node);
      });
      row.appendChild(del);
    }
    return row;
  }

  /** 可折叠的一段。count 为 0 时默认收起，免得空段落占版面。 */
  function section(key, title, count, children, opts) {
    opts = opts || {};
    var box = el('div', 'sec' + (opts.tone ? ' sec-' + opts.tone : ''));
    var isOpen = collapsed[key] === undefined ? (count > 0) : !collapsed[key];

    var head = el('button', 'sec-head');
    head.type = 'button';
    var caret = el('span', 'sec-caret', isOpen ? '▾' : '▸');
    head.appendChild(caret);
    head.appendChild(el('span', 'sec-title', title));
    if (count != null) head.appendChild(el('span', 'sec-count', String(count)));
    box.appendChild(head);

    var body = el('div', 'sec-body');
    body.hidden = !isOpen;
    children.forEach(function (c) { body.appendChild(c); });
    box.appendChild(body);

    // 说明文字跟着段落一起收放，所以显隐在同一个点击处理里管
    var note = null;
    if (opts.note) {
      note = el('div', 'sec-note', opts.note);
      note.hidden = !isOpen;
      box.appendChild(note);
    }

    head.addEventListener('click', function () {
      collapsed[key] = isOpen;         // 记成"折叠了"，供下次重绘读取
      isOpen = !isOpen;
      caret.textContent = isOpen ? '▾' : '▸';
      body.hidden = !isOpen;
      if (note) note.hidden = !isOpen;
    });

    return box;
  }

  /**
   * 渲染整棵树。
   * @param {HTMLElement} host
   * @param {Object} outline  Outline.build 的结果
   * @param {Function} onPick 点击节点回调，收到 {obj, objclass, alias}
   */
  function render(host, outline, onPick, onDelete) {
    host.textContent = '';

    if (!outline.root) {
      var empty = el('div', 'tree-empty');
      empty.appendChild(el('p', null, '这份文件里没有 LevelDefinition。'));
      empty.appendChild(el('p', 'dim', '对象树要靠它才能认出来谁引用了谁。'));
      if (outline.total) {
        empty.appendChild(el('p', 'dim', '文件里共 ' + outline.total + ' 个对象，仍可在右侧直接编辑。'));
      }
      host.appendChild(empty);
      if (outline.total) {
        host.appendChild(section('raw', '全部对象', outline.total,
          outline.orphans.concat(outline.supporting).map(function (n) { return leaf(n, onPick, onDelete); })));
      }
      return;
    }

    // 关卡定义
    host.appendChild(section('root', '关卡定义', null,
      [leaf(outline.root, onPick, onDelete)]));

    // 模块
    host.appendChild(section('mods', '模块', outline.modules.length,
      outline.modules.map(function (n) { return leaf(n, onPick, onDelete); }),
      { note: outline.modules.length ? null : '还没插入任何模块' }));

    // 波次管理器本体
    if (outline.waveManager) {
      host.appendChild(section('wm', '波次管理器', null,
        [leaf(outline.waveManager, onPick, onDelete)]));
    }

    // 每一波
    outline.waves.forEach(function (w) {
      host.appendChild(section('wave' + w.index, '第 ' + w.index + ' 波', w.items.length,
        w.items.map(function (n) { return leaf(n, onPick, onDelete); })));
    });

    // 支撑对象：被引用但不是模块/波次（僵尸类型、属性表……）
    if (outline.supporting.length) {
      host.appendChild(section('support', '支撑对象', outline.supporting.length,
        outline.supporting.map(function (n) { return leaf(n, onPick, onDelete); }),
        { note: '被别的对象引用，所以不能删' }));
    }

    // 真孤儿
    host.appendChild(section('orphan', '未引用', outline.orphans.length,
      outline.orphans.map(function (n) { return leaf(n, onPick, onDelete); }),
      {
        tone: outline.orphans.length ? 'warn' : null,
        note: outline.orphans.length ? '没有任何对象引用它们，可以在「校验」页一键清理' : null
      }));

    // 悬空引用
    if (outline.dangling.length) {
      var items = outline.dangling.map(function (d) {
        var e = el('div', 'node node-bad');
        e.appendChild(el('span', 'node-cls', d.alias || d.rtid));
        e.appendChild(el('span', 'node-alias', '找不到'));
        e.addEventListener('click', function () { onPick({ alias: d.rtid, objclass: '', obj: null }); });
        return e;
      });
      host.appendChild(section('dangling', '失效引用', outline.dangling.length, items,
        { tone: 'warn', note: 'RTID 指向的对象在文件里不存在' }));
    }
  }

  return { render: render };
})();
