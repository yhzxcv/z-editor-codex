/* 侧栏共用的 DOM 小工具
 *
 * 这个文件**曾经**是「模块」页签的全部实现：往关卡里插模块、插波次事件、挑插到
 * 第几波。那些现在搬去了 js/editor/module-panel.js —— 模块列表还是列表，但点一行
 * 变成**看详情**（说明 + 键表），插入要进浮层里按「插入」。搬家的理由写在那个文件
 * 头上。
 *
 * 留在这里的只有 el()，因为它是**共用**的：codex-panel.js 在加载期就
 * `var el = window.ZEditor.Panels.el;`，module-panel.js 也一样。于是这个文件必须
 * 排在两个面板前面 —— tools/check-editor.js 有一条断言专门钉这个顺序（错了不会报错
 * 也不会白屏，el 是 undefined，直到用户点开那个页签才炸）。
 *
 * 顺带一段旧账，别再从别处往这儿加东西：这里原先还有第三段「从图鉴插入」，
 * 后来搬去了侧栏的「图鉴」页签（js/editor/codex-panel.js）—— 那是一个 2333 条、
 * 五章的数据集，埋在模块按钮下面当第三段是找不到的。
 * 「校验」页签也已经取消：它跟对象树重复了三段，判定与合并见 js/level/report.js，
 * 展示见 js/editor/tree.js。
 */
window.ZEditor = window.ZEditor || {};
window.ZEditor.Panels = (function () {
  'use strict';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  return { el: el };
})();
