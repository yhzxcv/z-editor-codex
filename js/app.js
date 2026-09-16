/* 代码图鉴 · 界面
 *
 * 三层结构：
 *   章节 chips（罕见操作，一行放得下）
 *   分组 chips（高频跳转，横向滚动 + 滚动高亮）
 *   条目列表（两行：名上码下，整行点击即复制）
 * 宽屏下侧栏接管章节与目录，分组 chips 隐藏。
 *
 * 所有滚动都发生在 .content 内部（它是唯一的滚动容器），
 * 因此吸顶标题的 top 恒为 0，不需要按断点算偏移。
 */
(function () {
  'use strict';

  var content = document.getElementById('content');
  var chapterbar = document.getElementById('chapterbar');
  var groupbar = document.getElementById('groupbar');
  var sidebar = document.getElementById('sidebar');
  var scrim = document.getElementById('scrim');
  var input = document.getElementById('q');
  var clearBtn = document.getElementById('q-clear');
  var toastEl = document.getElementById('toast');
  var settingsEl = document.getElementById('settings');
  var filterEl = document.getElementById('filter');
  var filterList = document.getElementById('filter-list');

  var LS_KEY = 'codex.settings.v1';
  // chapters: null = 全部章节；否则是选中的章节 id 数组。
  // 空数组是**合法状态**（= 什么都不搜），只有勾满全部才归一成 null
  // density: 条目密度档位，见 css 里「条目密度档位」那段；standard 是改动前的样子
  // foldChapters: 侧栏章节列表是否折叠。默认展开——折叠是「章节太多挤到目录」时
  //   才需要的动作，不该让第一次来的人先面对一个收起来的东西
  var settings = { format: 'plain', theme: 'auto', chapters: null, density: 'standard', foldChapters: false };

  var DENSITIES = ['standard', 'compact', 'tight', 'single'];
  // 复制格式的可选值，跟设置浮层 index.html 里的 data-val 一一对应
  var FORMATS = ['plain', 'quoted', 'rtid'];

  var state = {
    chapter: null,
    query: '',
    searching: false,
    rows: [],          // 当前列表项：浏览态是本章全部，搜索态是命中的 [{ch, it}]
    activeGroup: 0
  };

  var ICON_COPY = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">' +
    '<rect x="5.6" y="5.6" width="8.4" height="8.4" rx="1.7" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
    '<path d="M10.4 3.6v-.8c0-.7-.6-1.3-1.3-1.3H3.7c-.7 0-1.3.6-1.3 1.3v5.4c0 .7.6 1.3 1.3 1.3h.8" ' +
    'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

  var ICON_CHECK = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">' +
    '<path d="M3 8.4l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="1.9" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ── 工具 ──────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    // file:// 或旧浏览器兜底
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('execCommand copy 失败'));
    });
  }

  var toastTimer = null;
  // ms 是可选停留时长：默认成功 1500 / 失败 2600。带说明的复制结果（比如 RTID 回退）
  // 比普通「已复制」多一句要读的话，用它把时长拉长，否则还没看完就没了。
  function toast(msg, isErr, ms) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('err', !!isErr);
    toastEl.hidden = false;
    requestAnimationFrame(function () { toastEl.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
      setTimeout(function () { toastEl.hidden = true; }, 200);
    }, ms || (isErr ? 2600 : 1500));
  }

  // ── 设置 ──────────────────────────────────────────────────────────────
  function loadSettings() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (FORMATS.indexOf(o.format) >= 0) settings.format = o.format;
        if (o.theme === 'auto' || o.theme === 'light' || o.theme === 'dark') settings.theme = o.theme;
        if (DENSITIES.indexOf(o.density) >= 0) settings.density = o.density;
        if (typeof o.foldChapters === 'boolean') settings.foldChapters = o.foldChapters;
        // 只做类型校验，不校验 id 是否存在于当前章节表里——这里同步执行，
        // 而章节是异步加载的，此刻 window.Codex.chapters 还是空的。
        // 真正的合法性校验推迟到 validateFilter()（章节加载完之后）。
        if (Array.isArray(o.chapters)) {
          settings.chapters = o.chapters.filter(function (id) { return typeof id === 'string'; });
        }
      }
    } catch (e) { /* 隐私模式 / 禁用存储：用默认值即可 */ }
  }

  function saveSettings() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (e) { /* 同上 */ }
  }

  function applyTheme() {
    var el = document.documentElement;
    if (settings.theme === 'auto') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', settings.theme);
  }

  // 跟主题一个套路：standard 是 :root 的默认值，所以去掉属性而不是写上去。
  // 也跟主题一样必须在首次渲染前调，否则会先按标准档画一遍再跳成紧凑。
  function applyDensity() {
    var el = document.documentElement;
    if (settings.density === 'standard') el.removeAttribute('data-density');
    else el.setAttribute('data-density', settings.density);
  }

  // ── 搜索范围筛选 ──────────────────────────────────────────────────────
  // 只约束搜索，不约束浏览：浏览态永远是当前章的完整目录。
  function activeChapters() {
    if (!settings.chapters) return window.Codex.chapters;
    var picked = settings.chapters;
    return window.Codex.chapters.filter(function (ch) { return picked.indexOf(ch.id) >= 0; });
  }

  function filterIsAll() {
    return !settings.chapters || settings.chapters.length >= window.Codex.chapters.length;
  }

  function scopeLabel() {
    return activeChapters().map(function (ch) { return ch.title; }).join('、');
  }

  function allIds() {
    return window.Codex.chapters.map(function (ch) { return ch.id; });
  }

  // 章节加载完之后调一次：存下来的 id 跟已知章节求交集，去掉已经不存在的。
  // 空数组是合法状态（= 什么都不搜），不在这里落回「全部」。
  function validateFilter() {
    if (!settings.chapters) return;
    var known = settings.chapters.filter(function (id) { return !!window.Codex.get(id); });
    if (known.length !== settings.chapters.length) settings.chapters = known;
  }

  function renderFilter() {
    var picked = settings.chapters;
    var html = '';
    window.Codex.chapters.forEach(function (ch) {
      var on = !picked || picked.indexOf(ch.id) >= 0;
      html += '<button class="fchk' + (on ? ' on' : '') + '" type="button" role="checkbox" ' +
        'aria-checked="' + (on ? 'true' : 'false') + '" data-fch="' + esc(ch.id) + '">' +
        '<span class="fchk-box" aria-hidden="true">✓</span>' +
        '<span class="fchk-t">' + esc(ch.title) + '</span>' +
        '<span class="fchk-n">' + ch.count + '</span></button>';
    });
    // picked 为 [] 是真值，所以这两条不会互相吞掉
    if (!picked) html += '<div class="fchk-note">现在搜索全部章节。取消勾选即可只搜其中几类。</div>';
    else if (!picked.length) html += '<div class="fchk-note">一个都没勾，搜索不会有结果。</div>';
    filterList.innerHTML = html;
    syncPopoverBtns();
  }

  // 空数组就是「什么都不搜」——「清空」之后应当保持空着，让用户接着勾他要的那一类。
  // 只有真的勾满全部才归一成 null（等价但存储更干净）。
  function setFilter(ids) {
    settings.chapters = (ids || []).filter(function (id) { return !!window.Codex.get(id); });
    if (filterIsAll()) settings.chapters = null;
    saveSettings();
    renderFilter();
    if (state.searching) renderContent();
  }

  function toggleFilterChapter(id) {
    var picked = settings.chapters ? settings.chapters.slice() : allIds();
    var i = picked.indexOf(id);
    if (i >= 0) picked.splice(i, 1); else picked.push(id);
    setFilter(picked);
  }

  // ── 渲染：条目 ────────────────────────────────────────────────────────
  function groupBadgeOf(rec) {
    return rec.it.unit ? rec.it.unit.title : '';
  }

  function itemHTML(it, rowIdx, badge) {
    return '<button class="item" type="button" data-r="' + rowIdx + '">' +
      '<span class="it-head">' +
        '<span class="it-name">' + esc(it.name) + '</span>' +
        (it.src ? '<span class="it-src">' + esc(it.src) + '</span>' : '') +
        (it.note ? '<span class="it-note">' + esc(it.note) + '</span>' : '') +
        (badge ? '<span class="it-group">' + esc(badge) + '</span>' : '') +
      '</span>' +
      '<span class="it-code">' + esc(it.code) + '</span>' +
      '<span class="it-copy">' + ICON_COPY + '</span>' +
      '</button>';
  }

  function groupHeadHTML(u) {
    return '<h2 class="group-head">' +
      '<span class="gh-title">' + esc(u.title) + '</span>' +
      (u.note ? '<span class="gh-note">' + esc(u.note) + '</span>' : '') +
      '<span class="gh-count">' + u.items.length + '</span>' +
      '</h2>';
  }

  function renderBrowse() {
    var ch = state.chapter;
    state.rows = [];
    var html = '';
    var gi = -1;

    ch.units.forEach(function (u) {
      if (u.kind === 'section') {
        html += '<div class="sect-head">' +
          '<span class="sect-title">' + esc(u.title) + '</span>' +
          (u.note ? '<span class="sect-note">' + esc(u.note) + '</span>' : '') +
          '</div>';
        return;
      }
      gi++;
      var start = state.rows.length;
      u.items.forEach(function (it) { state.rows.push({ ch: ch, it: it }); });

      html += '<section class="group" data-g="' + gi + '">' + groupHeadHTML(u) + '<div class="items">';
      for (var i = start; i < state.rows.length; i++) html += itemHTML(state.rows[i].it, i, '');
      html += '</div></section>';
    });

    content.innerHTML = html;
    cacheGroupEls();
    renderGroupbar();
  }

  // 空结果时给一句「是不是被搜索范围挡住了」——范围为空时说法要更直接
  var RESET_BTN = '<button class="link-btn" type="button" data-fa="reset">改为搜索全部</button>';
  function scopeHintHTML() {
    if (filterIsAll()) return '';
    if (!activeChapters().length) {
      return '<p>搜索范围里一个类别都没勾，所以不会有结果：' + RESET_BTN + '</p>';
    }
    return '<p>当前搜索范围是 ' + esc(scopeLabel()) + '，也可能是被范围挡住了：' + RESET_BTN + '</p>';
  }

  function renderSearch() {
    var res = window.CodexSearch.search(activeChapters(), state.query);
    state.rows = res.hits;

    if (!res.hits.length) {
      content.innerHTML = '<div class="empty">' +
        '<b>没有匹配「' + esc(state.query) + '」的条目</b>' +
        '<p>可以试试中文名、代码片段，或拼音首字母（<code>jrsz</code> → 巨人僵尸）。</p>' +
        scopeHintHTML() +
        '</div>';
      return;
    }

    var html = '<div class="result-bar">' +
      '<b>' + res.total + '</b> 条结果' +
      (res.truncated ? '<span class="rb-warn">只显示前 ' + res.hits.length + ' 条，请补充关键词</span>' : '') +
      '</div><section class="group"><div class="items">';
    for (var i = 0; i < res.hits.length; i++) {
      html += itemHTML(res.hits[i].it, i, groupBadgeOf(res.hits[i]));
    }
    html += '</div></section>';
    content.innerHTML = html;
  }

  function renderContent() {
    if (state.searching) renderSearch(); else renderBrowse();
    content.scrollTop = 0;
  }

  function cacheGroupEls() {
    state.chapter.groupUnits.forEach(function (u) { u.el = null; });
    var els = content.querySelectorAll('.group');
    for (var i = 0; i < els.length; i++) {
      var g = +els[i].getAttribute('data-g');
      if (state.chapter.groupUnits[g]) state.chapter.groupUnits[g].el = els[i];
    }
  }

  // ── 渲染：导航 ────────────────────────────────────────────────────────
  function renderChapterbar() {
    var html = '';
    window.Codex.chapters.forEach(function (ch) {
      html += '<button class="chip ch' + (ch === state.chapter ? ' on' : '') +
        '" data-ch="' + esc(ch.id) + '">' + esc(ch.title) +
        '<span class="chip-n">' + ch.count + '</span></button>';
    });
    chapterbar.innerHTML = html;
    // innerHTML 重建会先把内容清空，scrollLeft 被夹回 0 —— 于是「选中的是第 5 章、
    // 条子却停在最左边」，窄屏上既看不出自己在哪，右边那几章也够不到。
    // 重建后立刻把选中项滚进视野。
    scrollChipIntoView(chapterbar);
    syncBarEdges(chapterbar);
  }

  function renderGroupbar() {
    var html = '';
    var lastSec = null;
    state.chapter.groupUnits.forEach(function (u, i) {
      if (u.section && u.section !== lastSec) {
        lastSec = u.section;
        html += '<span class="chip-sep">' + esc(u.section) + '</span>';
      }
      html += '<button class="chip" data-g="' + i + '">' + esc(u.title) + '</button>';
    });
    groupbar.innerHTML = html;
    markActive();
    groupbar.scrollLeft = 0;
    syncBarEdges(groupbar);
  }

  function renderSidebar() {
    var html = '<div class="side-head"><span class="side-title">代码图鉴</span>' +
      '<button class="side-close" type="button" data-close="1" aria-label="收起章节与目录">✕</button></div>' +
      '<div class="side-body">';
    // 章节这一行的标题本身就是折叠开关。章节还会继续加（子弹、主题、模块都在排队），
    // 这一段的固定高度只会一路涨，把下面的目录挤到够不着 —— 能收起来就好办。
    // 折叠状态记在 settings 里；renderSidebar 每次切章都会重跑，存 DOM 上会被冲掉。
    html += '<button class="side-label side-fold" type="button" data-fold="1"' +
      ' title="展开/折叠章节列表"' +
      ' aria-expanded="' + (settings.foldChapters ? 'false' : 'true') + '">' +
      '<span>章节</span>' +
      '<span class="fold-ico" aria-hidden="true">' + (settings.foldChapters ? '▸' : '▾') + '</span>' +
      '</button>';
    html += '<div class="side-chlist"' + (settings.foldChapters ? ' hidden' : '') + '>';
    window.Codex.chapters.forEach(function (ch) {
      html += '<button class="side-ch' + (ch === state.chapter ? ' on' : '') + '" data-ch="' + esc(ch.id) + '">' +
        '<span class="side-t">' + esc(ch.title) + '</span>' +
        '<span class="side-n">' + ch.count + '</span></button>';
    });
    html += '</div>';
    html += '<div class="side-label">' + esc(state.chapter.title) + ' · 目录</div>';
    var lastSec = null;
    state.chapter.groupUnits.forEach(function (u, i) {
      if (u.section && u.section !== lastSec) {
        lastSec = u.section;
        html += '<div class="side-sec">' + esc(u.section) + '</div>';
      }
      html += '<button class="side-g" data-g="' + i + '">' +
        '<span class="side-t">' + esc(u.title) + '</span>' +
        '<span class="side-n">' + u.items.length + '</span></button>';
    });
    html += '</div>';
    sidebar.innerHTML = html;
  }

  function markActive() {
    var chips = groupbar.querySelectorAll('.chip[data-g]');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('on', +chips[i].getAttribute('data-g') === state.activeGroup);
    }
    var on = groupbar.querySelector('.chip.on');
    if (on && (on.offsetLeft < groupbar.scrollLeft ||
               on.offsetLeft + on.offsetWidth > groupbar.scrollLeft + groupbar.clientWidth)) {
      groupbar.scrollTo({ left: on.offsetLeft - groupbar.clientWidth / 2 + on.offsetWidth / 2, behavior: 'smooth' });
    }
    var sides = sidebar.querySelectorAll('.side-g');
    for (var j = 0; j < sides.length; j++) {
      sides[j].classList.toggle('on', +sides[j].getAttribute('data-g') === state.activeGroup);
    }
  }

  // 把选中项滚到条子中间。用 offsetLeft 而不是 getBoundingClientRect：两个 chip 条
  // 都是整宽、左对齐的兄弟，相对同一 offsetParent 的偏移量就等于相对滚动容器的偏移量，
  // 而且 offsetLeft 不受当前滚动位置影响 —— 这里要的正是「绝对位置」。
  // 章节条**不做平滑滚动**：切章是整块内容重绘，条子自己在那儿慢慢滑显得很脱节。
  function scrollChipIntoView(bar) {
    var on = bar.querySelector('.chip.on');
    if (!on) return;
    var left = on.offsetLeft - bar.clientWidth / 2 + on.offsetWidth / 2;
    bar.scrollLeft = Math.max(0, Math.min(left, bar.scrollWidth - bar.clientWidth));
  }

  // 条子自己藏了滚动条（scrollbar-width: none），窄屏上「右边还有内容」就一点提示都没有：
  // 看得见的几章之外，既想不到去滑、鼠标也没有滚动条可拖。靠这两个 class 在两侧做渐隐。
  // 1px 的余量是留给亚像素取整的，不然滚动到底时右边那道渐隐会一直挂着不消。
  function syncBarEdges(bar) {
    var max = bar.scrollWidth - bar.clientWidth;
    bar.classList.toggle('can-left', bar.scrollLeft > 1);
    bar.classList.toggle('can-right', max > 1 && bar.scrollLeft < max - 1);
  }

  // ── 滚动高亮 ──────────────────────────────────────────────────────────
  var ticking = false;
  function onScroll() {
    if (ticking || state.searching) return;
    ticking = true;
    requestAnimationFrame(function () { ticking = false; spy(); });
  }

  function spy() {
    var gus = state.chapter.groupUnits;
    var top = content.scrollTop + 4;
    var cur = 0;
    for (var i = 0; i < gus.length; i++) {
      var el = gus[i].el;
      if (el && el.offsetTop <= top) cur = i; else break;
    }
    if (cur !== state.activeGroup) { state.activeGroup = cur; markActive(); }
  }

  // 只管跳转，不碰抽屉——两个调用点（分组 chips、侧栏目录）都不该收起它。
  function gotoGroup(i) {
    var u = state.chapter.groupUnits[i];
    if (!u || !u.el) return;
    content.scrollTo({ top: u.el.offsetTop, behavior: 'auto' });
    state.activeGroup = i;
    markActive();
  }

  // ── 章节切换 / 搜索 ───────────────────────────────────────────────────
  function pickChapter(id) {
    state.chapter = window.Codex.get(id) || window.Codex.first();
    state.activeGroup = 0;
    renderChapterbar();
    renderSidebar();
    renderContent();
    if (!state.searching) renderGroupbar();
  }

  function setQuery(q) {
    state.query = q;
    var was = state.searching;
    state.searching = !!q.trim();
    document.body.classList.toggle('is-searching', state.searching);
    if (state.searching || was) renderContent();
    if (!state.searching) { renderGroupbar(); spy(); }
  }

  // ── 复制 ──────────────────────────────────────────────────────────────
  // 复制格式：plain 裸代码 / quoted 带引号 / rtid 完整 RTID 语句。
  // RTID 的表名后缀取自数据：章节的 rtid 打底，条目级 rtid 可以盖掉它。
  // **RTID 档连外层引号一起复制**（`"RTID(xxx@Table)"`）：关卡 JSON 里的值本来
  // 就是这个形状（PvzDataModels.kt 的 Type 字段默认值、代码图鉴.txt 里的样例都是
  // 带引号的），粘进 JSON 时缺了引号还得自己补。
  // 拼不出 RTID 时回退成带引号，不是回退成裸代码——两个理由：勾了 RTID 的人要的是
  // 能直接粘进 JSON 的字符串字面量；而且 RTID 档本身就是带引号的，回退后形状一致。
  // 回退时 toast 里会多一句说明，见 formatCopy 的返回值。
  // 注意别把这个函数叫成 copyText：上面 61 行的剪贴板助手就叫这个名字，
  // 同名函数声明后者胜，会把它整个顶掉（复制全废）。
  function rtidTable(it, ch) {
    // it.rtid 只在数据里真写了这个键时才存在，见 js/codex.js 的 normItem：
    // 没写＝跟随章节，写空串＝这条不支持。两种情况不能压成一种。
    if (it && it.rtid !== undefined) return it.rtid;
    return (ch && ch.rtid) || '';
  }

  function quote(code) { return '"' + code + '"'; }

  function formatCopy(it, ch) {
    var code = (it && it.code) || '';
    if (settings.format === 'rtid') {
      var table = rtidTable(it, ch);
      if (table) return { text: quote('RTID(' + code + '@' + table + ')'), note: '' };
      // 回退**必须出声**：静默换一种结果会被当成 bug。这不是假想——数据文件被旧缓存
      // 挡住时（手机上还是没加 rtid 的 data/ch-*.js，但 js/app.js 已经是新的）就真
      // 发生过一次，表现是「选了 RTID 却复制出带引号的裸代码」，看着像 RTID 坏了。
      return { text: quote(code), note: '（本章无 RTID 表，回退带引号）' };
    }
    if (settings.format === 'quoted') return { text: quote(code), note: '' };
    return { text: code, note: '' };
  }

  function doCopy(rec, rowEl) {
    var r = formatCopy(rec.it, rec.ch);
    copyText(r.text).then(function () {
      toast('已复制 ' + r.text + r.note, false, r.note ? 2600 : 0);
      var icon = rowEl.querySelector('.it-copy');
      rowEl.classList.add('copied');
      if (icon) icon.innerHTML = ICON_CHECK;
      setTimeout(function () {
        rowEl.classList.remove('copied');
        if (icon) icon.innerHTML = ICON_COPY;
      }, 700);
    }).catch(function () {
      toast('复制失败，请长按代码手动选择', true);
    });
  }

  // ── 侧栏 / 设置面板开合 ───────────────────────────────────────────────
  function openSide() { sidebar.classList.add('open'); scrim.classList.add('open'); }
  function closeSide() { sidebar.classList.remove('open'); scrim.classList.remove('open'); }

  // 折叠章节列表。只动这一个容器，**不重绘整个侧栏** —— 重绘会把目录的滚动位置
  // 丢回顶部，而点折叠的人十有八九正是为了去看目录。
  function toggleFold() {
    settings.foldChapters = !settings.foldChapters;
    saveSettings();
    var list = sidebar.querySelector('.side-chlist');
    if (list) list.hidden = settings.foldChapters;
    var btn = sidebar.querySelector('.side-fold');
    if (btn) {
      btn.setAttribute('aria-expanded', settings.foldChapters ? 'false' : 'true');
      var ico = btn.querySelector('.fold-ico');
      if (ico) ico.textContent = settings.foldChapters ? '▸' : '▾';
    }
  }

  // 两个浮层都是 position: fixed; right: 10px，同时开必叠在一起 —— 所以按单例开关处理。
  // sticky 是「浮层关着也要保持高亮」的额外条件：筛选按钮得在筛选生效期间一直亮着，
  // 否则用户看不出自己还开着筛选。
  var POPOVERS = [
    { el: settingsEl, btn: 'btn-settings', sticky: function () { return false; } },
    { el: filterEl, btn: 'btn-filter', sticky: function () { return !filterIsAll(); } }
  ];

  function syncPopoverBtns() {
    POPOVERS.forEach(function (p) {
      document.getElementById(p.btn).classList.toggle('on', !p.el.hidden || p.sticky());
    });
  }

  function togglePopover(which, force) {
    var show = force === undefined ? which.el.hidden : force;
    POPOVERS.forEach(function (p) { p.el.hidden = p !== which || !show; });
    syncPopoverBtns();
  }

  function closePopovers() {
    POPOVERS.forEach(function (p) { p.el.hidden = true; });
    syncPopoverBtns();
  }

  function syncSettingsUI() {
    var segs = settingsEl.querySelectorAll('.seg');
    for (var i = 0; i < segs.length; i++) {
      var key = segs[i].getAttribute('data-key');
      var btns = segs[i].querySelectorAll('button');
      for (var j = 0; j < btns.length; j++) {
        btns[j].classList.toggle('on', btns[j].getAttribute('data-val') === settings[key]);
      }
    }
  }

  // ── 事件绑定 ──────────────────────────────────────────────────────────
  function bind() {
    content.addEventListener('scroll', onScroll, { passive: true });

    content.addEventListener('click', function (ev) {
      var hit = ev.target.closest ? ev.target.closest('.item,[data-fa="reset"]') : null;
      if (!hit) return;
      if (hit.hasAttribute('data-fa')) { setFilter(allIds()); return; }
      var rec = state.rows[+hit.getAttribute('data-r')];
      if (rec) doCopy(rec, hit);
    });

    chapterbar.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-ch]') : null;
      if (b) pickChapter(b.getAttribute('data-ch'));
    });

    groupbar.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-g]') : null;
      if (b) gotoGroup(+b.getAttribute('data-g'));
    });

    // 两条 chip 条两侧的渐隐跟着横向滚动位置走。markActive 的平滑滚动也会路过这里，
    // 正好让渐隐一路跟到底。
    chapterbar.addEventListener('scroll', function () { syncBarEdges(chapterbar); }, { passive: true });
    groupbar.addEventListener('scroll', function () { syncBarEdges(groupbar); }, { passive: true });
    // 转屏 / 拉窗口会改变条子的可视宽度，边界状态得重算（内容没变，不会自己触发 scroll）。
    window.addEventListener('resize', function () {
      syncBarEdges(chapterbar);
      syncBarEdges(groupbar);
    });

    // 滚轮横向滚 chip 条。窄屏下条子藏了滚动条，鼠标又无从横向滚（触控板双指和
    // shift+滚轮是例外），不接管的话这 44px 就是个死区：滚轮放上去什么都不发生。
    // 只在**真的滚动了**的时候 preventDefault，没溢出就把事件原样放走。
    [chapterbar, groupbar].forEach(function (bar) {
      bar.addEventListener('wheel', function (ev) {
        if (bar.scrollWidth - bar.clientWidth <= 1) return;
        // deltaMode: 0=像素 1=行 2=页。Firefox 常见的是「行」，不换算的话
        // 一格滚轮只挪 3px，比不动还难受。
        var unit = ev.deltaMode === 1 ? 16 : (ev.deltaMode === 2 ? bar.clientWidth : 1);
        // 横向分量优先，不然触控板的斜向滑动会被 deltaY 抢走
        var d = (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY) * unit;
        if (!d) return;
        var before = bar.scrollLeft;
        bar.scrollLeft = before + d;
        if (bar.scrollLeft !== before) ev.preventDefault();
      }, { passive: false });
    });

    // 抽屉里的点击**一律不收起**：点章节，下面那截目录整段会换，多半还要接着点；
    // 点目录是跳到正文，但用户多半还要接着翻别的分组，来回拉抽屉更烦。
    // 唯一主动收起的入口是头部的 ✕，另两条（点遮罩、按 Esc）是「误触也能退」的兜底。
    sidebar.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-close],[data-fold],[data-ch],[data-g]') : null;
      if (!t) return;
      if (t.hasAttribute('data-close')) { closeSide(); return; }
      if (t.hasAttribute('data-fold')) { toggleFold(); return; }
      if (t.hasAttribute('data-ch')) { pickChapter(t.getAttribute('data-ch')); return; }
      gotoGroup(+t.getAttribute('data-g'));
    });

    input.addEventListener('input', function () {
      clearBtn.hidden = !input.value;
      setQuery(input.value);
    });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { input.value = ''; clearBtn.hidden = true; setQuery(''); input.blur(); }
    });
    clearBtn.addEventListener('click', function () {
      input.value = ''; clearBtn.hidden = true; setQuery(''); input.focus();
    });

    document.getElementById('btn-menu').addEventListener('click', openSide);
    scrim.addEventListener('click', closeSide);

    document.getElementById('btn-settings').addEventListener('click', function (ev) {
      ev.stopPropagation();
      togglePopover(POPOVERS[0]);
    });
    settingsEl.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var b = ev.target.closest ? ev.target.closest('button[data-val]') : null;
      if (!b) return;
      var key = b.parentNode.getAttribute('data-key');
      settings[key] = b.getAttribute('data-val');
      saveSettings();
      if (key === 'theme') applyTheme();
      if (key === 'density') applyDensity();
      syncSettingsUI();
    });

    document.getElementById('btn-filter').addEventListener('click', function (ev) {
      ev.stopPropagation();
      togglePopover(POPOVERS[1]);
    });
    filterEl.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var row = ev.target.closest ? ev.target.closest('button[data-fch]') : null;
      if (row) { toggleFilterChapter(row.getAttribute('data-fch')); return; }
      var act = ev.target.closest ? ev.target.closest('button[data-fa]') : null;
      if (!act) return;
      // 清空 → 传 []，就是「一个都不搜」，保持空着让用户接着勾；只有全选才归一成 null
      setFilter(act.getAttribute('data-fa') === 'all' ? allIds() : []);
    });

    document.addEventListener('click', closePopovers);

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { closeSide(); closePopovers(); }
      // 「/」或 Ctrl+K 直接聚焦搜索
      var typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (!typing && (ev.key === '/' || (ev.key === 'k' && (ev.ctrlKey || ev.metaKey)))) {
        ev.preventDefault();
        input.focus();
        input.select();
      }
    });
  }

  // ── 启动 ──────────────────────────────────────────────────────────────
  function loadChapters(list) {
    return Promise.all(list.map(function (src) {
      return new Promise(function (resolve) {
        var s = document.createElement('script');
        s.src = src;
        s.async = false;                 // 动态插入时保持执行顺序
        s.onload = function () { resolve({ src: src, ok: true }); };
        s.onerror = function () { resolve({ src: src, ok: false }); };
        document.head.appendChild(s);
      });
    }));
  }

  function boot() {
    loadSettings();
    applyTheme();
    applyDensity();
    syncSettingsUI();
    bind();

    var manifest = window.CODEX_MANIFEST || [];
    loadChapters(manifest).then(function (results) {
      var failed = results.filter(function (r) { return !r.ok; });
      if (failed.length) console.warn('数据文件加载失败：', failed.map(function (f) { return f.src; }));

      if (!window.Codex.chapters.length) {
        content.innerHTML = '<div class="empty"><b>没有加载到任何章节数据</b>' +
          '<p>请检查 <code>js/chapters.js</code> 里的路径，以及 <code>data/</code> 下是否存在对应文件。</p>' +
          (failed.length ? '<p class="empty-list">' + failed.map(function (f) { return esc(f.src); }).join('<br>') + '</p>' : '') +
          '</div>';
        return;
      }
      // 章节齐了才能校验筛选里存的 id、才拿得到各章条目数
      validateFilter();
      renderFilter();
      pickChapter(window.Codex.chapters[0].id);
    });
  }

  boot();
})();
