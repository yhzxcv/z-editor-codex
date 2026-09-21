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
    var outline = window.ZLevel.Outline.build(objs, ctx.refs());
    var notes = outline.notes;

    // 硬问题：孤儿 / 失效引用 / 模块冲突 / 悬空引用。灰字提示不算问题。
    var hard = orphaned.length + invalid.length + conflicts.length + outline.dangling.length;

    if (!hard && !notes.length) {
      var good = el('div', 'chk chk-ok');
      good.appendChild(el('div', 'chk-h', '没发现问题'));
      good.appendChild(el('div', 'chk-b',
        objs.length + ' 个对象，模块引用齐全，没有孤儿，没有模块冲突。'));
      host.appendChild(good);
      return;
    }

    if (!hard) {
      var fine = el('div', 'chk chk-ok');
      fine.appendChild(el('div', 'chk-h', '没发现问题'));
      fine.appendChild(el('div', 'chk-b',
        objs.length + ' 个对象。下面只是提示，不影响这份文件。'));
      host.appendChild(fine);
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
        '这些引用写的是 @CurrentLevel（或者干脆没写来源），也就是「对象就在这份文件里」，' +
        '但文件里没有这个别名。'));
      var l2 = el('ul', 'chk-list');
      outline.dangling.forEach(function (d) {
        l2.appendChild(el('li', 'mono', d.rtid));
      });
      c2.appendChild(l2);
      host.appendChild(c2);
    }

    /* 灰字那一段：外部来源我们**有**数据、但里面没有这个别名。
     *
     * 跟上面两段的区别是「谁说得清」：@CurrentLevel 找不到就是找不到，铁定出错；
     * 而 `@ZombieTypes` 这种，要么是别名拼错了，要么是我们手上这份参考数据比
     * 制作关卡时的那份旧、游戏里新加的条目还没收录进来 —— 从这份文件本身
     * 分不出是哪种。所以只提示，不计入「N 个失效引用」，也不影响状态栏。
     *
     * 上游 ReferenceRepository 在参考文件没加载时直接跳过校验，是同一个态度：
     * 拿不准的东西不报警。 */
    if (notes.length) {
      var c5 = el('div', 'chk chk-dim');
      c5.appendChild(el('div', 'chk-h', '参考文件里没有这些别名 (' + notes.length + ')'));
      c5.appendChild(el('div', 'chk-b',
        '它们指向的来源我们有数据，但里面找不到这个别名 —— 可能拼错了，' +
        '也可能是参考数据比游戏旧。不影响保存。'));
      var l5 = el('ul', 'chk-list');
      notes.forEach(function (n) {
        var li = el('li');
        var b = el('button', 'link mono', n.rtid);
        b.type = 'button';
        b.title = '来源 ' + n.source + '，' + (n.where ? '出现在 ' + n.where : '');
        b.addEventListener('click', function () { ctx.reveal(n.rtid); });
        li.appendChild(b);
        if (n.where) li.appendChild(el('span', 'chk-where', '  ' + n.where));
        l5.appendChild(li);
      });
      c5.appendChild(l5);
      host.appendChild(c5);
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
        '从 LevelDefinition 出发走不到它们 —— 没有任何指向本文件的 RTID 引用它们。' +
        '删掉模块后留下的空壳通常长这样。'));
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
