/* 编辑器主控 —— 把状态、文本区、对象树、侧栏面板接起来
 *
 * 数据流是单向的：
 *   用户打字 / 结构操作  ->  State（唯一的文本真源）  ->  订阅者重绘
 * 所以这里几乎所有操作都是"改 state，然后等订阅回调把界面重画一遍"。
 */
(function () {
  'use strict';

  var State = window.ZEditor.State;
  var Text = window.ZEditor.Text;
  var Tree = window.ZEditor.Tree;
  var Panels = window.ZEditor.Panels;
  var Outline = window.ZLevel.Outline;
  var Edit = window.ZLevel.Edit;
  var Parse = window.ZLevel.Parse;

  var BY_ID = function (id) { return document.getElementById(id); };

  var state = State.create();
  var text = null;

  /** 程序性换文本时挂起 onChange，免得 setText -> onChange -> setText 来回打转。 */
  var muted = false;

  /** 校验层要用的「参考文件里的模块别名」。没加载参考文件时为 null（不参与判断）。 */
  function levelModuleAliases() { return null; }

  // ── 启动 ────────────────────────────────────────────────────────────

  function boot() {
    text = Text.create(BY_ID('editor'), {
      doc: '',
      onChange: function (t) { if (!muted) state.setText(t); },
      onSave: doSave,
      onOpen: function () { BY_ID('file-input').click(); }
    });

    state.subscribe(onStateChange);
    wireTabs();
    wireTopbar();
    wireSettings();

    // 没打开文件时给一个能立刻上手的起点：空白关卡模板
    var blank = window.ZLevel.Templates[0];
    loadDocument(blank.text, blank.title + '.json', 'template');
  }

  /** 换文档：状态和编辑器一起换，顺序不能反（状态先，编辑器跟着写）。 */
  function loadDocument(t, fileName, source) {
    state.load(t, fileName, source);
    setEditorText(t);
  }

  function setEditorText(t) {
    if (text.getText() === t) return;
    muted = true;
    text.setText(t);
    muted = false;
  }

  // ── 状态变化 -> 重绘 ────────────────────────────────────────────────

  function onStateChange(s) {
    // 结构操作换掉了文本，得写回编辑器；用户打字触发的变更这里会直接返回
    setEditorText(s.text);
    applyDiagnostics(s);

    renderStatus(s);
    renderCheckPanel(s);
    renderInsertPanel(s);

    Tree.render(BY_ID('panel-tree'), Outline.build(s.objects), onPickNode, doDeleteObject);
  }

  /**
   * 把 JSON 解析错误画成编辑器里的波浪线。
   *
   * 每次状态变化都重设一遍，不能只在"出错的那一刻"设一次 —— setText 走的是
   * 重建 state，重建会把诊断一起清掉，所以这里跟着状态走最省心。
   */
  function applyDiagnostics(s) {
    var d = Text.diagnosticOf(s.parseError, s.text.length);
    text.setDiagnostics(d ? [d] : []);
  }

  function renderStatus(s) {
    var host = BY_ID('statusbar');
    host.textContent = '';
    host.appendChild(span('st-file', s.fileName || '未命名'));

    if (s.parseError) {
      var errTag = span('st-bad', 'JSON 有误');
      if (s.parseError.engine) errTag.title = '引擎原文：' + s.parseError.engine;
      host.appendChild(errTag);
    } else {
      host.appendChild(span(null, s.objects.length + ' 个对象'));
      var orph = Parse.findOrphanedObjects(s.objects).length;
      if (orph) host.appendChild(span('st-warn', orph + ' 个未引用'));
      var bad = Parse.findInvalidLevelModuleReferences(s.objects, levelModuleAliases()).length;
      if (bad) host.appendChild(span('st-bad', bad + ' 个失效引用'));
      var conf = window.ZLevel.Conflicts.check(s.objects).length;
      if (conf) host.appendChild(span('st-bad', conf + ' 处模块冲突'));
    }

    if (s.normalized) {
      var n = span('st-dim', '已做过结构操作');
      n.title = '插入/删除会重新序列化整份 JSON：对象顺序按游戏加载顺序排好了，' +
        '数字写法可能被规范化（1.0 写成 1，两者是同一个数）。纯手打不触发这个。';
      host.appendChild(n);
    }

    BY_ID('doc-name').textContent = s.fileName || '未打开文件';

    // ⚠ 撤销栈不在订阅回调收到的那份记录上（那是纯数据），要问 state 对象。
    // 曾经写成 s.canUndo() —— s 上没有这个方法，renderStatus 当场抛异常，
    // 于是它后面的三个面板全都画不出来，表现是"页面在，点什么都没反应"。
    var undoBtn = BY_ID('btn-undo');
    undoBtn.hidden = !state.canUndo();
    if (state.canUndo()) {
      undoBtn.title = '撤销' + state.undoLabel() + '（结构操作走不到编辑器的撤销栈，用这个）';
    }
    renderErrorBar(s);
  }

  function span(cls, txt) {
    var e = document.createElement('span');
    if (cls) e.className = cls;
    e.textContent = txt;
    return e;
  }

  /** JSON 语法错误横幅 —— 出错时结构操作全被禁掉，得说清楚为什么。 */
  function renderErrorBar(s) {
    var bar = BY_ID('errbar');
    if (!s.parseError) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.textContent = '';
    var msg = span('err-msg', 'JSON 语法错误：' + Text.zhError(s.parseError.message));
    if (s.parseError.engine) msg.title = '引擎原文：' + s.parseError.engine;
    bar.appendChild(msg);
    bar.appendChild(span('err-hint', '修好之后才能插入模块、清理对象。'));
    var jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'btn btn-sm';
    jump.textContent = '跳到出错处';
    jump.addEventListener('click', function () {
      text.view.dispatch({ selection: { anchor: s.parseError.pos }, scrollIntoView: true });
      text.focus();
    });
    bar.appendChild(jump);
  }

  function renderCheckPanel(s) {
    Panels.renderCheck(BY_ID('panel-check'), {
      state: function () { return s; },
      levelModuleAliases: levelModuleAliases,
      reveal: revealOrWarn,
      onCleanup: doCleanup,
      onDelete: doDeleteObject
    });
  }

  // ── 插入面板 ────────────────────────────────────────────────────────
  //
  // 插入面板的重建代价是「丢掉展开状态和搜索词」，所以只在必要时重建：
  // 对象数变了（插入/删除过），或者波次数量变了（下拉要跟着更新）。

  var insertPanelState = { objectCount: -1, waveCount: -1, picker: null };

  function waveCountOf(s) {
    var wm = Parse.findByClass(s.objects, 'WaveManagerProperties');
    return (wm && wm.objdata && Array.isArray(wm.objdata.Waves)) ? wm.objdata.Waves.length : 0;
  }

  function renderInsertPanel(s) {
    var n = s.objects.length;
    var w = waveCountOf(s);
    if (n === insertPanelState.objectCount && w === insertPanelState.waveCount) return;
    insertPanelState.objectCount = n;
    insertPanelState.waveCount = w;

    insertPanelState.picker = null;
    Panels.renderInsert(BY_ID('panel-insert'), {
      onInsertModule: doInsertModule,
      onInsertEvent: function (meta) {
        var idx = insertPanelState.picker ? insertPanelState.picker.waveIndex() : 0;
        if (!idx) { toast('这份关卡还没有波次，先插入「波次管理器」', true); return; }
        doInsertEvent(meta, idx);
      },
      eventPicker: function () {
        insertPanelState.picker = wavePicker();
        return insertPanelState.picker.el;
      },
      codexBox: codexBox
    });
  }

  function wavePicker() {
    var wrap = Panels.el('div', 'wave-pick');
    wrap.appendChild(Panels.el('span', 'wave-pick-l', '插入到第'));
    var sel = document.createElement('select');
    var n = waveCountOf(state.get());
    if (!n) {
      sel.disabled = true;
      var o = document.createElement('option');
      o.textContent = '（没有波次）';
      sel.appendChild(o);
    } else {
      for (var i = 1; i <= n; i++) {
        var op = document.createElement('option');
        op.value = String(i);
        op.textContent = String(i);
        sel.appendChild(op);
      }
    }
    wrap.appendChild(sel);
    wrap.appendChild(Panels.el('span', 'wave-pick-l', '波'));
    return { el: wrap, waveIndex: function () { return parseInt(sel.value, 10) || 0; } };
  }

  // ── 对象树交互 ──────────────────────────────────────────────────────

  function revealOrWarn(needle) {
    if (!needle) return false;
    // 别名在文本里是带引号的字符串，优先按带引号的形式找，能避开注释里的同名文字
    if (text.reveal('"' + needle + '"')) return true;
    if (text.reveal(needle)) return true;
    toast('在文本里找不到：' + needle, true);
    return false;
  }

  function onPickNode(node) {
    revealOrWarn(node.alias || node.objclass);
    if (window.innerWidth < 940) closeSidebar();
  }

  // ── 结构操作 ────────────────────────────────────────────────────────

  function doInsertModule(meta) {
    var skeleton = window.ZLevel.Skeletons[meta.objClass];
    var r = state.applyStructural(function (objects) {
      return Edit.insertModule(objects, meta, skeleton);
    }, 'insert');

    if (!r.ok) {
      if (r.error === 'exists') toast('「' + r.message + '」已经在这个关卡里了（不允许重复）', true);
      else if (r.error === 'parse-error') toast('JSON 有语法错误，先修好再插入', true);
      else toast('插入失败：' + r.error, true);
      return;
    }
    if (r.refWarning) {
      toast('对象建好了，但没能挂进 Modules（' + r.refWarning + '）—— 去「校验」页看看', true);
      return;
    }
    toast('已插入「' + meta.title + '」' + (r.created ? '' : '（引用型，未新建对象）'));
    if (r.created) revealOrWarn(r.alias);
  }

  function doInsertEvent(meta, waveIndex) {
    var skeleton = window.ZLevel.Skeletons[meta.objClass];
    var r = state.applyStructural(function (objects) {
      return Edit.insertEvent(objects, meta, waveIndex, skeleton);
    }, 'insert');

    if (!r.ok) {
      if (r.error === 'bad-wave') toast('第 ' + waveIndex + ' 波不存在', true);
      else if (r.error === 'no-wavemanager') toast('这份关卡没有波次管理器，先插入「波次管理器」模块', true);
      else if (r.error === 'parse-error') toast('JSON 有语法错误，先修好再插入', true);
      else toast('插入失败：' + r.error, true);
      return;
    }
    toast('已插入「' + meta.title + '」到第 ' + r.waveIndex + ' 波');
    revealOrWarn(r.alias);
  }

  /**
   * 删除对象。
   *
   * 先在文本外面**预演**一遍级联效果，好把话说全（"连带会清掉 N 个"），
   * 用户确认后再真正执行。预演用重新解析出来的那份对象，不能直接拿界面上的
   * 引用去比对 —— 结构操作后它们已经不是同一批实例了。
   */
  function doDeleteObject(node) {
    if (!node) return;
    var s = state.get();
    if (s.parseError) { toast('JSON 有语法错误，先修好再删', true); return; }

    var preview;
    try {
      preview = JSON.parse(s.text);
    } catch (e) { toast('解析失败，先修好语法', true); return; }

    var target = findByNode(preview.objects, node);
    if (!target) { toast('在文件里找不到这个对象', true); return; }

    var probe = preview.objects.slice();
    probe.splice(probe.indexOf(target), 1);
    var wouldCascade = Parse.findOrphanedObjects(probe).length;

    var msg = '要删掉 ' + Parse.objClassOf(target) +
      (Edit.firstAliasOf(target) ? '（' + Edit.firstAliasOf(target) + '）' : '') + ' 吗？';
    if (wouldCascade) msg += '\n\n连带会清掉 ' + wouldCascade + ' 个因此失去引用的对象。';
    msg += '\n\n用「撤销结构操作」可以找回来。';
    if (!window.confirm(msg)) return;

    var r = state.applyStructural(function (objects) {
      var t = findByNode(objects, node);
      if (!t) return { ok: false, error: 'not-found' };
      var res = Edit.removeObject(objects, t);
      return { ok: true, cascaded: res.cascaded.length };
    }, 'delete');

    if (!r.ok) { toast('删除失败：' + r.error, true); return; }
    toast('已删除' + (r.cascaded ? '，并连带清理 ' + r.cascaded + ' 个对象' : ''));
  }

  /** 按别名+objclass 在对象列表里定位（别名优先，没有别名就按 objclass 取第一个）。 */
  function findByNode(objects, node) {
    var alias = node.alias;
    if (alias) {
      var byAlias = objects.filter(function (o) { return Edit.firstAliasOf(o) === alias; })[0];
      if (byAlias) return byAlias;
    }
    if (!node.objclass) return null;
    return objects.filter(function (o) { return Parse.objClassOf(o) === node.objclass; })[0] || null;
  }

  function doCleanup() {
    var s = state.get();
    if (s.parseError) { toast('JSON 有语法错误，先修好再清理', true); return; }
    var n = Parse.findOrphanedObjects(s.objects).length;
    if (!n) { toast('没有需要清理的对象'); return; }
    if (!window.confirm('要删掉这 ' + n + ' 个没有任何对象引用的对象吗？\n\n' +
      '它们从 LevelDefinition 出发走不到，删掉不影响关卡。\n用「撤销结构操作」可以找回来。')) return;

    var r = state.applyStructural(function (objects) {
      return { ok: true, removed: Edit.cleanupOrphaned(objects).length };
    }, 'cleanup');
    if (r.ok) toast('已清理 ' + r.removed + ' 个对象');
  }

  function doUndo() {
    if (!state.undo()) { toast('没有可撤销的结构操作'); return; }
    toast('已撤销上一步结构操作');
  }

  // ── 文件 ────────────────────────────────────────────────────────────

  /**
   * 保存 = 把当前文本写成一个文件下载下来。
   *
   * 浏览器里没有别的"真保存"：IndexedDB / localStorage 都可能被浏览器随时清掉
   * （Safari 的 7 天无互动清空规则最阴）。所以这个按钮的诚实名字是"下载"。
   */
  function doSave() {
    var s = state.get();
    if (s.parseError && !window.confirm(
      '当前 JSON 有语法错误：\n' + s.parseError.message +
      '\n\n仍然下载吗？（游戏大概率读不了这个文件）')) return;

    var name = s.fileName || 'level.json';
    if (!/\.json$/i.test(name)) name += '.json';

    var blob = new Blob([s.text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 立刻 revoke 在部分浏览器上会打断下载，挪到下一轮事件循环
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);

    state.markSaved();
    toast('已下载 ' + name);
  }

  function doOpenFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var t = String(reader.result).replace(/\r\n/g, '\n');
      loadDocument(t, file.name, 'file');
      toast('已打开 ' + file.name);
    };
    reader.onerror = function () { toast('读文件失败', true); };
    reader.readAsText(file, 'utf-8');
  }

  function doLoadTemplate(tpl) {
    if (!window.confirm('载入模板会丢弃当前内容（先下载保存？），确定吗？')) return;
    loadDocument(tpl.text, tpl.title + '.json', 'template');
    toast('已载入模板「' + tpl.title + '」');
  }

  // ── 顶栏 / 侧栏 / 设置 ──────────────────────────────────────────────

  function wireTabs() {
    var tabs = document.querySelectorAll('.tabs button');
    Array.prototype.forEach.call(tabs, function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(tabs, function (x) { x.classList.toggle('on', x === b); });
        ['tree', 'insert', 'check'].forEach(function (k) {
          BY_ID('panel-' + k).hidden = (k !== b.dataset.tab);
        });
      });
    });
  }

  function wireTopbar() {
    BY_ID('btn-menu').addEventListener('click', function () {
      var open = document.body.classList.toggle('sidebar-open');
      BY_ID('scrim').hidden = !open;
    });
    BY_ID('scrim').addEventListener('click', closeSidebar);

    BY_ID('btn-open').addEventListener('click', function () { BY_ID('file-input').click(); });
    BY_ID('file-input').addEventListener('change', function (e) {
      doOpenFile(e.target.files[0]);
      e.target.value = '';           // 同一个文件连选两次也要能触发
    });

    BY_ID('btn-save').addEventListener('click', doSave);
    BY_ID('btn-undo').addEventListener('click', doUndo);

    var tplBtn = BY_ID('btn-templates');
    var tplPop = BY_ID('tpl-pop');
    window.ZLevel.Templates.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = t.title;
      b.addEventListener('click', function () { tplPop.hidden = true; doLoadTemplate(t); });
      tplPop.appendChild(b);
    });
    tplBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var wasOpen = !tplPop.hidden;
      closePopovers();
      if (!wasOpen) {
        tplPop.hidden = false;
        var r = tplBtn.getBoundingClientRect();
        tplPop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 200)) + 'px';
      }
    });
  }

  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    BY_ID('scrim').hidden = true;
  }

  function closePopovers() {
    [BY_ID('tpl-pop'), BY_ID('settings')].forEach(function (p) { if (p) p.hidden = true; });
  }

  function wireSettings() {
    var pop = BY_ID('settings');
    BY_ID('btn-settings').addEventListener('click', function (e) {
      e.stopPropagation();
      var wasOpen = !pop.hidden;
      closePopovers();
      pop.hidden = wasOpen;
    });

    var seg = pop.querySelector('.seg[data-key="theme"]');
    var saved = null;
    try { saved = localStorage.getItem('zeditor.theme'); } catch (err) { /* 隐私模式下会抛 */ }
    applyTheme(saved || 'auto');
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', b.dataset.val === (saved || 'auto'));
      b.addEventListener('click', function () {
        applyTheme(b.dataset.val);
        Array.prototype.forEach.call(seg.querySelectorAll('button'), function (x) {
          x.classList.toggle('on', x === b);
        });
        try { localStorage.setItem('zeditor.theme', b.dataset.val); } catch (err) { /* 存不上就算了 */ }
      });
    });
  }

  function applyTheme(v) {
    if (v === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', v);
    if (text) text.reconfigureTheme();
  }

  // 点空白处收浮层
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.popover') && !e.target.closest('#btn-templates') &&
        !e.target.closest('#btn-settings')) {
      closePopovers();
    }
  });

  // ── 提示条 ──────────────────────────────────────────────────────────

  var toastTimer = null;
  function toast(msg, bad) {
    var t = BY_ID('toast');
    t.textContent = msg;
    t.className = 'toast' + (bad ? ' toast-bad' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, bad ? 5200 : 2600);
  }

  // ── 图鉴插入框 ──────────────────────────────────────────────────────

  /**
   * 图鉴数据层（Codex + data/ch-*.js）在这里复用：搜代码/中文名/拼音，
   * 点一下把代码插到光标处。复制格式跟图鉴站保持一致，用同一个 localStorage 键。
   */
  function codexBox() {
    var box = Panels.el('div', 'codex');
    var input = document.createElement('input');
    input.type = 'search';
    input.placeholder = '搜植物 / 僵尸 / 障碍物';
    input.className = 'codex-q';
    input.autocomplete = 'off';

    var fmtSeg = Panels.el('div', 'seg seg-sm');
    var out = Panels.el('div', 'codex-out');
    var FORMATS = [['plain', '纯代码'], ['quoted', '带引号'], ['rtid', 'RTID']];
    var fmt = 'quoted';
    try { fmt = localStorage.getItem('zeditor.copyFormat') || 'quoted'; } catch (e) { /* ignore */ }

    FORMATS.forEach(function (f) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = f[1];
      b.classList.toggle('on', f[0] === fmt);
      b.addEventListener('click', function () {
        fmt = f[0];
        try { localStorage.setItem('zeditor.copyFormat', fmt); } catch (e) { /* ignore */ }
        Array.prototype.forEach.call(fmtSeg.querySelectorAll('button'), function (x) {
          x.classList.toggle('on', x === b);
        });
        run();
      });
      fmtSeg.appendChild(b);
    });

    box.appendChild(input);
    box.appendChild(fmtSeg);
    box.appendChild(out);

    function textFor(it, ch) {
      // 条目级 rtid 覆盖章节的；「写成空串」= 这条明确没有 RTID 表，回退带引号
      var table = it.rtid !== undefined ? it.rtid : ch.rtid;
      if (fmt === 'plain') return it.code;
      if (fmt === 'rtid' && table) return '"RTID(' + it.code + '@' + table + ')"';
      return '"' + it.code + '"';
    }

    function run() {
      var q = input.value;
      out.textContent = '';
      if (!q.trim()) {
        out.appendChild(Panels.el('div', 'dim', '输入关键词开始搜索。支持中文名、代码、拼音首字母。'));
        return;
      }
      var res = window.CodexSearch.search(window.Codex.chapters, q);
      if (!res.hits.length) {
        out.appendChild(Panels.el('div', 'dim', '没有匹配的条目'));
        return;
      }
      if (res.truncated) {
        out.appendChild(Panels.el('div', 'dim', '结果过多，只显示前 60 条，再输精确点'));
      }
      res.hits.slice(0, 60).forEach(function (h) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'codex-item';
        b.appendChild(Panels.el('span', 'codex-name', h.it.name));
        b.appendChild(Panels.el('span', 'codex-code', h.it.code));
        b.appendChild(Panels.el('span', 'codex-ch', h.ch.title));
        b.title = '点击插入：' + textFor(h.it, h.ch);
        b.addEventListener('click', function () {
          var snippet = textFor(h.it, h.ch);
          var sel = text.view.state.selection.main;
          text.view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: snippet },
            selection: { anchor: sel.from + snippet.length }
          });
          text.focus();
          toast('已插入 ' + snippet);
        });
        out.appendChild(b);
      });
    }

    input.addEventListener('input', run);
    run();
    return box;
  }

  // ── 起 ──────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
