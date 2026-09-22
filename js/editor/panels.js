/* 侧栏共用的 DOM 小工具
 *
 * 这个文件**曾经**是「模块」页签的全部实现：往关卡里插模块、插波次事件、挑插到
 * 第几波。那些现在搬去了 js/editor/module-panel.js —— 模块列表还是列表，但点一行
 * 变成**看详情**（说明 + 键表），插入要进浮层里按「插入」。搬家的理由写在那个文件
 * 头上。
 *
 * 留在这里的只有 el() 和图标那两件，因为它们是**共用**的：codex-panel.js 在加载期就
 * `var el = window.ZEditor.Panels.el;`，module-panel.js 也一样，tree.js 取 icon/iconBtn。
 * 于是这个文件必须排在**三个使用者**前面 —— tools/check-editor.js 有断言钉这个顺序
 * （错了不会报错也不会白屏，名字是 undefined，直到用户点开那个页签才炸）。
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

  /* ── 图标 ────────────────────────────────────────────────────────────
   *
   * **为什么是 SVG，不是字符。**
   * 2026-09-22 用户报：「不同设备侧栏里的删除和修改 icon 不同，有的甚至不会显示」。
   * 原因就是原先那批图标全是文字字符（✎ U+270E、✕ U+2715、☰ U+2630、⚙ U+2699…），
   * 画成什么样**完全交给设备上装的字体**去定：
   *   - Android / 部分 Chrome 会把 ✎ ⚙ 当 emoji 画成**彩色的**，跟旁边的灰字两回事；
   *   - 字体里没有这个字形时直接显示豆腐块（尤其 ⚙ —— 裸 U+2699 不带变体选择符，
   *     多数移动端按 emoji 呈现）；
   *   - 同一份代码在两台设备上必然长得不一样，而且这在 jsdom 里**测不出来**。
   * 内联 SVG 把字形变成几何图形，跟字体、跟平台彻底脱钩。颜色走 currentColor，
   * 所以主题切换和 .node-del:hover 那些变色规则一条都不用改。
   *
   * ⚠ **必须 createElementNS。** el('svg') 走的是 document.createElement，在 HTML
   * 文档里会造出一个 HTMLUnknownElement —— 不报错、不抛异常，**什么都不画**。
   * 这是本文件里最容易踩的一个坑，因为失败是完全静默的。
   *
   * 网格统一 24×24、描边 2（Lucide 那一套的规格，见 css 里的 .ico）。粗细不统一
   * 的话，缩到 12px 时会看着脏。
   */
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* 每条是 [标签, 属性]。绝大多数只有一个 <path>，齿轮和警告三角形要两个形状。 */
  var ICONS = {
    menu: [['path', { d: 'M4 6h16M4 12h16M4 18h16' }]],
    gear: [[
      'path',
      { d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0' +
           'l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72' +
           'v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73' +
           'l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2' +
           'v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39' +
           'a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09' +
           'a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25' +
           'a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z' }
    ], ['circle', { cx: 12, cy: 12, r: 3 }]],
    pencil: [['path', { d: 'M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z' }]],
    x: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
    /* 折叠三角只做一个**朝右**的，展开时靠 CSS 转 90° —— 见 css 里那条
       `[aria-expanded="true"] .sec-caret .ico`。所以这里没有「下三角」这个条目。 */
    right: [['path', { d: 'm9 18 6-6-6-6' }]],
    warn: [
      ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }],
      ['path', { d: 'M12 9v4' }],
      ['path', { d: 'M12 17h.01' }]
    ],
    plus: [['path', { d: 'M5 12h14M12 5v14' }]],
    minus: [['path', { d: 'M5 12h14' }]]
  };

  /**
   * 造一个图标。尺寸和颜色都由 CSS 定（.ico 那条），这里只管形状。
   * @param {string} name ICONS 里的键
   */
  function icon(name) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('viewBox', '0 0 24 24');
    /* 图标是纯装饰 —— 名字一律由所在按钮的 aria-label / 文字承担，念两遍反而吵。 */
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');   // 老 IE/Edge 会把 svg 放进 tab 序列
    ICONS[name].forEach(function (part) {
      var n = document.createElementNS(SVG_NS, part[0]);
      var attrs = part[1];
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, String(attrs[k])); });
      svg.appendChild(n);
    });
    return svg;
  }

  /**
   * 图标按钮。侧栏和顶栏里那一堆「只有一个图标」的按钮都是这个形状：
   * 图标 + 无障碍名（图标没有文字，不给名字读屏就是个空按钮）+ 悬停提示。
   *
   * ⚠ cls 必须原样落到**按钮**上 —— 对象树的扫雷和一堆断言是按 .node-edit /
   * .node-del / .sec-head 这些类名找按钮的，套一层壳就全找不着了。
   *
   * title 不给就用 label 顶上：图标按钮没有文字，鼠标停上去什么都不显示的话，
   * 用户只能靠猜。要写更长的说明再单独传 title。
   */
  function iconBtn(cls, name, label, title) {
    var b = el('button', cls);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = title || label;
    b.appendChild(icon(name));
    return b;
  }

  return { el: el, icon: icon, iconBtn: iconBtn };
})();
