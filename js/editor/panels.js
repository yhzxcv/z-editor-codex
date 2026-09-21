/* 侧栏面板 —— 插入 / 校验
 *
 * 「插入」把三类东西塞进关卡：
 *   模块    —— 从 data/modules.js，插完自动挂进 LevelDefinition.Modules
 *   事件    —— 往指定波次里加一个出怪/玩法事件
 *   图鉴    —— 复用代码图鉴的数据层（Codex + data/ch-*.js），插的是 RTID 或裸代码
 *
 * 「校验」把三种问题摆出来，能一键修的给按钮：
 *   孤儿对象 / 失效引用 / 模块冲突
 */
window.ZEditor = window.ZEditor || {};
window.ZEditor.Panels = (function () {
  'use strict';

  var Parse = window.ZLevel.Parse;
  var Rtid = window.ZLevel.Rtid;
  var Conflicts = window.ZLevel.Conflicts;
  var Edit = window.ZLevel.Edit;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ── 插入：模块 ───────────────────────────────────────────────────────

  function moduleRow(meta, onInsert) {
    var row = el('div', 'ins-row');
    var main = el('button', 'ins-main');
    main.type = 'button';
    main.appendChild(el('span', 'ins-title', meta.title));
    main.appendChild(el('span', 'ins-cls', meta.objClass));
    if (meta.isCore) main.appendChild(el('span', 'tag tag-core', '核心'));
    if (meta.allowMultiple) main.appendChild(el('span', 'tag', '可多个'));
    if (meta.defaultSource === 'LevelModules') {
      var t = el('span', 'tag tag-ref', '引用');
      t.title = '这个模块的对象定义在 LevelModules 里，插入只会给本关卡挂一个引用，不会新建对象';
      main.appendChild(t);
    }
    main.title = meta.desc || '';
    main.addEventListener('click', function () { onInsert(meta); });
    row.appendChild(main);
    if (meta.desc) row.appendChild(el('div', 'ins-desc', meta.desc));
    return row;
  }

  function renderInsert(host, ctx) {
    host.textContent = '';

    // ── 模块 ──
    host.appendChild(el('div', 'panel-h', '插入模块'));
    host.appendChild(el('p', 'panel-note',
      '插完会自动把 RTID 挂进 LevelDefinition 的 Modules。标「引用」的模块对象本身在 LevelModules 里，只挂引用不新建对象。'));

    window.ZLevel.Modules.moduleGroups.forEach(function (g) {
      var box = el('div', 'ins-group');
      var head = el('button', 'ins-group-h');
      head.type = 'button';
      head.appendChild(el('span', 'sec-caret', '▸'));
      head.appendChild(el('span', null, g.title));
      head.appendChild(el('span', 'sec-count', String(g.items.length)));
      var body = el('div', 'ins-group-b');
      body.hidden = true;
      g.items.forEach(function (m) { body.appendChild(moduleRow(m, ctx.onInsertModule)); });
      head.addEventListener('click', function () {
        body.hidden = !body.hidden;
        head.querySelector('.sec-caret').textContent = body.hidden ? '▸' : '▾';
      });
      if (g.note) body.insertBefore(el('div', 'ins-desc', g.note), body.firstChild);
      box.appendChild(head); box.appendChild(body);
      host.appendChild(box);
    });

    // ── 事件 ──
    host.appendChild(el('div', 'panel-h', '插入波次事件'));
    host.appendChild(el('p', 'panel-note', '事件挂在具体某一波里。没有波次就先加波次管理器。'));
    host.appendChild(ctx.eventPicker());

    window.ZLevel.Modules.eventGroups.forEach(function (g) {
      var box = el('div', 'ins-group');
      var head = el('button', 'ins-group-h');
      head.type = 'button';
      head.appendChild(el('span', 'sec-caret', '▸'));
      head.appendChild(el('span', null, g.title));
      head.appendChild(el('span', 'sec-count', String(g.items.length)));
      var body = el('div', 'ins-group-b');
      body.hidden = true;
      g.items.forEach(function (m) { body.appendChild(moduleRow(m, ctx.onInsertEvent)); });
      head.addEventListener('click', function () {
        body.hidden = !body.hidden;
        head.querySelector('.sec-caret').textContent = body.hidden ? '▸' : '▾';
      });
      box.appendChild(head); box.appendChild(body);
      host.appendChild(box);
    });

    // ── 图鉴 ──
    host.appendChild(el('div', 'panel-h', '从图鉴插入'));
    host.appendChild(el('p', 'panel-note',
      '植物、僵尸、障碍物的代码。点一下复制成能直接粘进 JSON 的形式。'));
    host.appendChild(ctx.codexBox());
  }

  // ── 校验 ─────────────────────────────────────────────────────────────

  function renderCheck(host, ctx) {
    host.textContent = '';
    var s = ctx.state();
    var objs = s.objects;

    if (s.parseError) {
      var bad = el('div', 'chk chk-bad');
      bad.appendChild(el('div', 'chk-h', 'JSON 语法有误'));
      bad.appendChild(el('div', 'chk-b', s.parseError.message));
      bad.appendChild(el('div', 'chk-note', '修好语法才能做结构操作和校验。'));
      host.appendChild(bad);
      return;
    }

    var orphaned = Parse.findOrphanedObjects(objs);
    var invalid = Parse.findInvalidLevelModuleReferences(objs, ctx.levelModuleAliases());
    var conflicts = Conflicts.check(objs);
    var outline = window.ZLevel.Outline.build(objs);

    if (!orphaned.length && !invalid.length && !conflicts.length && !outline.dangling.length) {
      var good = el('div', 'chk chk-ok');
      good.appendChild(el('div', 'chk-h', '没发现问题'));
      good.appendChild(el('div', 'chk-b',
        objs.length + ' 个对象，模块引用齐全，没有孤儿，没有模块冲突。'));
      host.appendChild(good);
      return;
    }

    if (invalid.length) {
      var c1 = el('div', 'chk chk-bad');
      c1.appendChild(el('div', 'chk-h', '失效的模块引用 (' + invalid.length + ')'));
      c1.appendChild(el('div', 'chk-b',
        'Modules 里指向的对象在本文件里找不到 —— 通常是手改别名或删对象留下的。游戏读到这里可能出问题。'));
      var list = el('ul', 'chk-list');
      invalid.forEach(function (rtid) {
        var li = el('li');
        var b = el('button', 'link', rtid);
        b.type = 'button';
        b.addEventListener('click', function () { ctx.reveal(rtid); });
        li.appendChild(b);
        list.appendChild(li);
      });
      c1.appendChild(list);
      host.appendChild(c1);
    }

    if (outline.dangling.length) {
      var c2 = el('div', 'chk chk-warn');
      c2.appendChild(el('div', 'chk-h', '悬空的 RTID 引用 (' + outline.dangling.length + ')'));
      c2.appendChild(el('div', 'chk-b',
        '某个对象内部引用了文件里不存在的别名。@LevelModules 的引用不算（它们本来就在别的文件里）。'));
      var l2 = el('ul', 'chk-list');
      outline.dangling.forEach(function (d) {
        l2.appendChild(el('li', 'mono', d.rtid));
      });
      c2.appendChild(l2);
      host.appendChild(c2);
    }

    if (conflicts.length) {
      var c3 = el('div', 'chk chk-bad');
      c3.appendChild(el('div', 'chk-h', '模块冲突 (' + conflicts.length + ')'));
      conflicts.forEach(function (hit) {
        var b = el('div', 'chk-conflict');
        b.appendChild(el('div', 'chk-cb', hit.description));
        b.appendChild(el('div', 'chk-note mono', hit.classes.join(' + ')));
        c3.appendChild(b);
      });
      host.appendChild(c3);
    }

    if (orphaned.length) {
      var c4 = el('div', 'chk chk-warn');
      c4.appendChild(el('div', 'chk-h', '未被引用的对象 (' + orphaned.length + ')'));
      c4.appendChild(el('div', 'chk-b',
        '从 LevelDefinition 出发走不到它们。删掉模块后留下的空壳通常长这样，删了不影响关卡。'));
      var l4 = el('ul', 'chk-list');
      orphaned.forEach(function (o) {
        var li = el('li');
        var b = el('button', 'link mono', Parse.objClassOf(o) + '  ' + (Edit.firstAliasOf(o) || ''));
        b.type = 'button';
        b.addEventListener('click', function () { ctx.reveal(Edit.firstAliasOf(o) || Parse.objClassOf(o)); });
        li.appendChild(b);
        l4.appendChild(li);
      });
      c4.appendChild(l4);
      var fix = el('button', 'btn btn-fix', '清理这 ' + orphaned.length + ' 个对象');
      fix.type = 'button';
      fix.addEventListener('click', ctx.onCleanup);
      c4.appendChild(fix);
      host.appendChild(c4);
    }
  }

  return { renderInsert: renderInsert, renderCheck: renderCheck, el: el };
})();
