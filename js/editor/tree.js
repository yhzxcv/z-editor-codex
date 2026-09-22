/* 对象树 —— 左侧栏的「对象」页
 *
 * 画的不是 JSON 的嵌套结构（那跟文本编辑器没区别），而是**关卡的层次**：
 * 关卡定义 / 模块 / 波次管理器（容器 + 它下面每一波）/ 支撑对象 / 孤立模块。
 * 用户在找"第 8 波那个裂缝事件"时是照这个层次找的，不是照 objdata 的嵌套找的。
 * 层次怎么切见 js/level/outline.js。
 *
 * 每一波**嵌在波次管理器那一段里**（2026-09-22 用户要的），不是跟它平级的顶层段落 ——
 * 它们本来就是同一个对象的 `Waves` 数组切出来的，分两处看要上下找。
 *
 * 点击节点 -> 编辑器跳到那个对象的别名（找不到就退而求其次找 objclass）。
 *
 * ── 校验也在这儿 ──
 *
 * 原先「校验」是侧栏的第三个页签，五张卡片里有三张（孤立模块 / 失效引用 /
 * 参考文件里没有）跟这棵树**原样重复**，而且卡片那版不能点、不能跳文本。
 * 那份重复连同两个集合的被重复计数一起删掉了：现在一件事只在这棵树上出现一次，
 * 校验页独有的一条（模块冲突）补成了下面的一段，「清理孤立模块」按钮挂到了
 * 孤立模块段的标题下面。判定与合并见 js/level/report.js。
 *
 * 后来「参考文件里没有」那一段也没了：用户要求这个判定也划进失效引用，于是它
 * 从独立一段并进了「失效引用」，两档的区分落在**行上那个代号的提示（title）**里
 * （2026-09-22 又改了一次：行内那个词和段落底下那段灰字说明一起去掉 —— 这一段现在
 * 只有"哪个代号坏了"和"它出现在哪儿"）。
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

  /* 图标住在 js/editor/panels.js（共用），这里只是取个短名字。panels.js 必须排在
     本文件前面 —— tools/check-editor.js 有断言钉这个顺序。 */
  var icon = window.ZEditor.Panels.icon;
  var iconBtn = window.ZEditor.Panels.iconBtn;

  /**
   * 一个可点击的叶节点。
   *
   * 整行是"跳到文本"，✎ 是"改这个对象的参数"，删除是行内一个单独的 ✕。
   * 两个按钮都不能嵌在跳转按钮里（button 套 button 是非法 HTML），所以行本身是
   * 一个 div，里面放三个并列的 button。
   *
   * ✎ 跟 ✕ 一样平时淡淡的（.node-edit），悬停才实起来 —— 一行上三个按钮，
   * 全都实心的话这棵树就没法读了。但**不藏**（✕ 是 opacity:0）：跳转和改参数
   * 是两件平级的事，用户得看得见改参数这个入口在哪儿。
   *
   * ⚠ 「藏/淡」这一档只在有悬停能力的设备上做（css/app.css 里那条
   *   @media (hover: hover)）；触摸屏上两个按钮都常驻实心 —— 手机上点一下会
   *   把 :hover 粘在那一行上，靠悬停显形的按钮就成了"点过才出现"。
   */
  function leaf(node, onPick, onDelete, onEdit) {
    var row = el('div', 'node');
    var go = el('button', 'node-go');
    go.type = 'button';
    go.title = node.objclass + (node.alias ? '  ·  ' + node.alias : '') + '\n点击跳到文本里的位置';
    go.appendChild(el('span', 'node-cls', node.objclass));
    if (node.alias) go.appendChild(el('span', 'node-alias', node.alias));
    /* 这个对象身上有解不开的引用 -> 标 ⚠。两档合成一个标记：
     *   dangling  本文件里找不到（最常见的手改错误）
     *   notes     参考文件里没有这个别名
     * 两档都进「失效引用」那一段（见 js/level/report.js），所以这里也共用一个
     * 标记 —— 分两个符号（⚠ 和灰点）是旧口径留下的，那会儿灰点"不算错误"。
     * 提示里仍然分开说，因为给用户的信息不一样：一个是"你写错了名字"，
     * 另一个还留着"参考数据比游戏旧"的余地。
     * 两档现在都汇总进顶层的 dangling/notes（见 js/level/outline.js 的 build），
     * 所以这个 ⚠ 和下面「失效引用」那一段是同一份数据、同一个数。 */
    var broken = (node.dangling || []).map(function (d) { return '本文件里找不到：' + d.alias; })
      .concat((node.notes || []).map(function (r) {
        return '参考文件里没有：' + r.alias + '@' + r.source;
      }));
    if (broken.length) {
      var w = el('span', 'node-warn');
      w.title = '这些引用落空了\n' + broken.join('\n');
      w.appendChild(icon('warn'));
      go.appendChild(w);
    }
    go.addEventListener('click', function () { onPick(node); });
    row.appendChild(go);

    /* 改参数。onEdit 缺省时（自检里只画树的那种调用）不画这个按钮 ——
     * 画一个点了没反应的按钮比不画糟。 */
    if (onEdit && node.obj) {
      var ed = iconBtn('node-edit', 'pencil', '改参数',
        '改这个对象的参数 —— 弹出它的键表（对着中文说明改，能撤销）');
      ed.addEventListener('click', function (e) {
        e.stopPropagation();
        /* 把按钮自己交出去 —— 浮层关掉时要把焦点还给它（跟模块详情那条一个约定：
         * 焦点不能丢回 <body>，键盘用户会一下子不知道自己在哪）。 */
        onEdit(node, ed);
      });
      row.appendChild(ed);
    }

    // 根对象（LevelDefinition）不给删 —— 删了整份文件就废了
    if (onDelete && node.obj && node.objclass !== 'LevelDefinition') {
      var del = iconBtn('node-del', 'x', '删除这个对象');
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        onDelete(node);
      });
      row.appendChild(del);
    }
    return row;
  }

  /**
   * 「模块」段里那些**对象不在本文件**的引用行（`Modules` 里的 `RTID(别名@LevelModules)`，
   * 数据见 js/level/outline.js 的 externalModules）。
   *
   * 为什么要摆出来：这些引用原先**一个界面入口都没有** —— 对象树收不进它们（对象不在
   * 本文件，`modules` 和 `supporting` 两段都够不着），插入模块栏里也没有（那是注册表，
   * 而注册表只认识它收了的那些别名）。一份关卡挂了哪些模块，用户除了翻文本没别的办法
   * 看见，而文本里那串 RTID 恰恰是最难读的东西。
   *
   * 跟本地模块行的**区别就一处**：没有 ✎。参数在别的文件里，本文件能改的只有那一行
   * RTID 文本 —— 画一个"点了没反应"或"改了不生效"的按钮比不画糟。这句解释挂在
   * 行和「引用」标记的 title 上，不占版面（段底灰字用户见一次删一次，见 section 那段）。
   *
   * 点行跳文本（跟「失效引用」那些行同一个约定）：`obj: null` 让 main.js 的
   * revealObject 落到 revealOrWarn 上，拿整串 RTID 去文本里找。
   */
  function extLeaf(item, onPick) {
    var row = el('div', 'node');
    var go = el('button', 'node-go');
    go.type = 'button';
    go.title = item.rtid + '\n对象定义在 ' + item.source + ' 里（别的文件），本文件里没有它的数据，没有可改的参数'
      + '\n点击跳到文本里的位置';
    /* 类名查得到就显示类名（跟上面那些本地模块的行对齐，扫一眼看得出是同类东西）；
     * 查不到（参考数据比游戏旧、或者这个别名干脆是拼错的）退成别名 —— 但**照样列**，
     * 那正是最该看见的一类，见 externalModules 那段。 */
    go.appendChild(el('span', 'node-cls', item.objClass || item.alias));
    go.appendChild(el('span', 'node-alias', item.alias));
    var tag = el('span', 'tag tag-ref', '引用');
    tag.title = '对象在别的文件（' + item.source + '）里，没有可改的参数';
    go.appendChild(tag);
    go.addEventListener('click', function () {
      onPick({ alias: item.rtid, objclass: item.objClass || '', obj: null });
    });
    row.appendChild(go);
    return row;
  }

  /**
   * 可折叠的一段。count 为 0 时默认收起，免得空段落占版面。
   *
   * opts.note 是段落底下的一句灰字。⚠ **默认不要写** —— 用户 2026-09-22 反复删的就是
   * 这种东西：段标题/按钮已经把那件事说过了，底下再用灰字说一遍，他看见一次删一次
   * （「孤立模块」「模块冲突」「支撑对象」三段的都删了）。到那天为止全树**只剩一个**
   * 合法的用法：Modules 空着时的「还没插入任何模块」—— 它回答的是"这儿为什么什么都
   * 没有"，是**空态说明**，跟标题不重复。有额外信息优先塞进行/控件的 `title`。
   *
   * opts.action 是段尾的一个按钮（现在只有孤立模块段的「清理」）。它跟 note
   * 一样跟着段落收放 —— 收着的时候露一个能改文档的按钮，比不显示更糟。
   *
   * opts.sub 是**嵌在别的段里**的那种（波次管理器里的每一波）。它自带缩进和竖线，
   * 不然只是右边缩几像素，看不出"它在那个段落里面"。
   * opts.open 是无视 `count > 0` 那条默认、一开始就展开（只有波次管理器用：它
   * 里面装着整个波次列表，默认收着等于把波次全藏起来 —— 以前那些波次是顶层段落、
   * 默认展开的）。
   */
  function section(key, title, count, children, opts) {
    opts = opts || {};
    var box = el('div', 'sec' + (opts.tone ? ' sec-' + opts.tone : '')
      + (opts.sub ? ' sec-sub' : ''));
    var isOpen = collapsed[key] === undefined
      ? (opts.open === true || count > 0)
      : !collapsed[key];

    var head = el('button', 'sec-head');
    head.type = 'button';
    /* 展开状态走 aria-expanded，**不再改字形**：原先这里在 ▾ / ▸ 之间换 textContent，
       换成 SVG 之后没有字形可换（而且「哪个字形算展开」本来也不该是测试的判据 ——
       tools/check-boot.js 的扫雷就是靠正则找 ▸ 才找到折叠段的，见那边的改法）。
       三角只做一个朝右的，展开时由 CSS 转 90°。 */
    head.setAttribute('aria-expanded', String(isOpen));
    var caret = el('span', 'sec-caret');
    caret.appendChild(icon('right'));
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

    // 段尾的动作按钮同理：收着的时候不该露出来
    var action = null;
    if (opts.action) {
      action = el('div', 'sec-action');
      action.appendChild(opts.action);
      action.hidden = !isOpen;
      box.appendChild(action);
    }

    head.addEventListener('click', function () {
      collapsed[key] = isOpen;         // 记成"折叠了"，供下次重绘读取
      isOpen = !isOpen;
      head.setAttribute('aria-expanded', String(isOpen));   // 三角的朝向看它
      body.hidden = !isOpen;
      if (note) note.hidden = !isOpen;
      if (action) action.hidden = !isOpen;
    });

    return box;
  }

  /** 「清理这 N 个孤立模块」。文案里带数字，是因为点了就真删对象，得说清删几个。 */
  function cleanupBtn(count, onCleanup) {
    var b = el('button', 'btn btn-fix', '清理这 ' + count + ' 个孤立模块');
    b.type = 'button';
    b.addEventListener('click', onCleanup);
    return b;
  }

  /**
   * 渲染整棵树。
   * @param {HTMLElement} host
   * @param {Object} outline  Outline.build 的结果
   * @param {Function} onPick 点击节点回调，收到 {obj, objclass, alias}
   * @param {Function} onDelete
   * @param {Object} [rep]   Report.build 的结果里这几项：
   *                         invalidRefs / conflicts / onCleanup / onEdit
   *                         （不传就退化成只画树，自检里用得上）
   *
   * onEdit 走 rep 而不是第四个位置参数：它跟 onCleanup 一样是"节点上的一个动作"，
   * 而 onPick / onDelete 那两个位置参数是这份文件的元老，动它们要改所有调用处。
   */
  function render(host, outline, onPick, onDelete, rep) {
    rep = rep || {};
    var onEdit = rep.onEdit;
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
          outline.orphans.concat(outline.supporting).map(function (n) { return leaf(n, onPick, onDelete, onEdit); })));
      }
      return;
    }

    // 关卡定义
    host.appendChild(section('root', '关卡定义', null,
      [leaf(outline.root, onPick, onDelete, onEdit)]));

    /* 模块 —— 本地对象之后接上那些"对象在别的文件"的引用（extLeaf，见上一段）。
     * 两者同一段：对用户来说"这份关卡挂了哪些模块"就是一件事，分开摆反而要上下找。
     * 数也合成一个数（段落标题上那个数得跟里面看得见的行数对得上）。
     * external 缺席时当空数组：自检里有手搓 outline 直接喂 render 的调用。 */
    var ext = outline.external || [];
    host.appendChild(section('mods', '模块', outline.modules.length + ext.length,
      outline.modules.map(function (n) { return leaf(n, onPick, onDelete, onEdit); })
        .concat(ext.map(function (it) { return extLeaf(it, onPick); })),
      { note: (outline.modules.length || ext.length) ? null : '还没插入任何模块' }));

    /* 波次管理器 —— 容器和它下面每一波**是一件事**，所以波次嵌在这一段里
     * （2026-09-22 用户：「对象菜单里各个波次做成可折叠状态放在波次管理器次级菜单里」）。
     * 以前每一波是顶层段落，跟管理器段平级：看第 8 波有什么事件要上下找两处，
     * 而它们本来就是同一个对象（容器）的 `Waves` 数组切出来的。
     *
     * 嵌进来之后**每一波仍然各自可折叠**（key 还是 'wave1'…，折叠状态照旧跨重绘保留），
     * 只是从"平级的一段"变成"管理器里的一个子项"。 */
    if (outline.waveManager) {
      var wmItems = [leaf(outline.waveManager, onPick, onDelete, onEdit)];
      outline.waves.forEach(function (w) {
        wmItems.push(section('wave' + w.index, '第 ' + w.index + ' 波', w.items.length,
          w.items.map(function (n) { return leaf(n, onPick, onDelete, onEdit); }),
          { sub: true }));
      });
      host.appendChild(section('wm', '波次管理器', null, wmItems, { open: true }));
    }

    // 支撑对象：被引用但不是模块/波次（僵尸类型、属性表……）
    if (outline.supporting.length) {
      /* 这一段原先底下一句灰字「被别的对象引用，所以不能删」。2026-09-22 用户点名去掉。
       *
       * 顺带记一笔：那句话**本来就不对**。`leaf()` 只在 `LevelDefinition` 上才收起 ✕，
       * 这一段的每一行都带删除按钮，按下走 main.js 的 `doDeleteObject` 照删不误（它只会
       * 先提示一句"连带会清掉 N 个因此失去引用的对象"）。想删是允许的，那句"不能删"
       * 是在替用户做主张。去掉之后这一段就不用 `opts` 了，第四个参数整个省掉。 */
      host.appendChild(section('support', '支撑对象', outline.supporting.length,
        outline.supporting.map(function (n) { return leaf(n, onPick, onDelete, onEdit); })));
    }

    /* 真孤立模块。清理按钮从「校验」页搬到了这里 —— 它清理的东西就是这一段，
     * 按钮跟它要动的那些行待在一起，比隔一个页签强。 */
    var orphanCount = outline.orphans.length;
    host.appendChild(section('orphan', '孤立模块', orphanCount,
      outline.orphans.map(function (n) { return leaf(n, onPick, onDelete, onEdit); }),
      {
        tone: orphanCount ? 'warn' : null,
        /* 这儿原先还有一句灰字「没有任何对象引用它们，可以一键清理」。
         * 2026-09-22 用户点名去掉（跟「模块冲突」那句一起）：段标题就叫「孤立模块」、
         * 底下那个按钮本身就写着「清理这 N 个孤立模块」，那句话是把同一件事说第三遍。 */
        action: (orphanCount && rep.onCleanup) ? cleanupBtn(orphanCount, rep.onCleanup) : null
      }));

    /* 失效引用 —— 合并之后的那一份（见 js/level/report.js）。
     *
     * 行上只留**失效的那个代号**（红字）和它出现在哪儿。这一条是"本文件里找不到"
     * 还是"参考文件里没有"退进 title 里：用户在这一段要找的是"哪个名字坏了"，
     * 中间再插一个词，扫一列名字的时候全是噪音。（原先那两档是行内的一个词 + 段落
     * 底下的一段灰字说明，2026-09-22 用户点名一起去掉。）
     *
     * 范围比原先树上那段大两轮：以前这里只有「Modules 和每一波里解不开的引用」，
     * Modules 里 @LevelModules 查不到的别名归「校验」页单独报（那边叫"悬空的
     * RTID 引用"），而「参考文件里没有」另是一段灰字。现在三处是一条清单。 */
    var bad = rep.invalidRefs || [];
    if (bad.length) {
      var items = bad.map(function (r) {
        var e = el('div', 'node node-bad');
        var main = el('span', 'node-cls', r.alias || r.rtid);
        main.title = r.rtid + '\n' + (r.kind === 'alias-typo'
          ? '参考文件里没有这个别名（可能拼错了，也可能参考数据比游戏旧）'
          : '本文件里找不到这个别名');
        e.appendChild(main);
        if (r.wheres && r.wheres.length) {
          e.appendChild(el('span', 'node-where', r.wheres.join('、')));
        }
        e.addEventListener('click', function () { onPick({ alias: r.rtid, objclass: '', obj: null }); });
        return e;
      });
      host.appendChild(section('dangling', '失效引用', bad.length, items, { tone: 'bad' }));
    }

    /* 模块冲突 —— 原先只有「校验」页有，是那边独有的内容，所以补成树上的一段。
     * tone 用 bad：冲突的模块同时生效时行为是未定义的，不是"可能拼错了"。
     * 没有活按钮可给：冲突得人来决定留哪个，自动挑一个删掉是替用户做主张。
     *
     * 段落底下原先还有一句灰字「这些模块同时挂上时行为是未定义的，得决定留哪个」，
     * 2026-09-22 用户点名去掉（跟「孤立模块」那句一起）：段标题就叫「模块冲突」、
     * 整段又是红的，那句话是把同一件事再说一遍。上面这条注释留着 —— 它是 tone
     * 选 bad 的**理由**，跟那句话在不在没关系。 */
    var conf = rep.conflicts || [];
    if (conf.length) {
      var hitItems = conf.map(function (h) {
        /* `node-conf` 是给 CSS 的钩子：这一档要**上下两行**摆（类名一行、人话一行），
         * 不能跟别的行一样横着排 —— 详见 app.css 里 `.node-conf` 那段。
         * 行上没有点击动作（冲突得人来决定留哪个），所以整行挂 title 补全。 */
        var e = el('div', 'node node-bad node-conf');
        e.title = h.classes.join(' + ') + '\n' + h.description;
        e.appendChild(el('span', 'node-cls', h.classes.join(' + ')));
        e.appendChild(el('span', 'node-alias', h.description));
        return e;
      });
      host.appendChild(section('conflicts', '模块冲突', conf.length, hitItems, { tone: 'bad' }));
    }
  }

  return { render: render };
})();
