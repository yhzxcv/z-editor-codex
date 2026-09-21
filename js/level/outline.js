/* 关卡大纲 —— 把平铺的对象列表组织成「用户在关卡里看到的层次」
 *
 * 关卡 JSON 是一维数组，但人的心智模型是：
 *   关卡定义 → 一堆模块 → 波次管理器 → 每一波里有若干事件 → 剩下的就是没用上的
 * 对象树照这个层次画，用户才找得着北。这一层只读，不改任何东西。
 *
 * 另外它也承担「引用是否解析得开」的检查。这里有个**关键区分**，搞混过一次：
 *
 *   悬空（dangling）  `@CurrentLevel` 的别名在本文件里找不到 —— 真失效，标 ⚠
 *   灰字（notes）     外部来源里没有这个别名 —— 可能拼错了，但**不算错误**
 *
 * 原先 nodeOf 把所有解不开的别名一律当悬空、resolveList 又写死豁免了字面量
 * 'LevelModules'，于是 9 份内置模板里 153 条去重引用中有 71 条被误报成失效
 * （@ZombieTypes 13 条、@LevelModules 56 条、@PlantTypes 2 条全部中招）。
 * 现在两类都走 Parse.classifyRef 一个判据。
 *
 * 判据还跟 Parse.computeReachableObjects 对齐 —— 一个引用算不算「本文件的边」，
 * 两处必须给同一个答案。否则会出现「树上挂着子节点、清理却把它当孤儿删掉」。
 */
window.ZLevel = window.ZLevel || {};
window.ZLevel.Outline = (function () {
  'use strict';

  var Rtid = window.ZLevel.Rtid;
  var Parse = window.ZLevel.Parse;

  /** 别名 -> 对象。跟 Parse.buildObjectMap 不同，这里收**全部**别名，不只首别名。 */
  function indexByAlias(objects) {
    var map = {};
    Parse.asList(objects).forEach(function (o) {
      var a = o && o.aliases;
      if (Array.isArray(a)) a.forEach(function (x) { if (!(x in map)) map[x] = o; });
    });
    return map;
  }

  /**
   * 判断上下文：本文件的别名索引 + 别名集合 + 参考数据表。
   * 建一次传给下面所有函数 —— 别名集合是 Set，别在每个节点上重算。
   */
  function contextOf(objects, refs) {
    var list = Parse.asList(objects);
    return { index: indexByAlias(list), local: Parse.allAliases(list), refs: refs };
  }

  /**
   * 一个对象的显示信息。
   *   refs      它能指向的**本文件**对象别名（用于树上展开子节点）
   *   dangling  本文件里找不到的别名 —— 真失效，标 ⚠
   *   notes     外部来源里没有的别名 —— 灰字提示，不算错误（元素是 collectRefs 的引用对象）
   */
  function nodeOf(obj, ctx) {
    if (!obj) return null;
    var refs = [];
    var dangling = [];
    var notes = [];

    Rtid.collectRefs(obj.objdata, []).forEach(function (r) {
      /* 指向**已知**外部文件的引用不是本文件的事：不去找同名对象、也不报失效。
       * 这一步跟 computeReachableObjects 的 isKnownExternal 是同一个判断 ——
       * 少了它，`RTID(tutorial@ZombieTypes)` 在本文件恰好也有 tutorial 时
       * 会挂出一个子节点，而清理那边认为它是孤儿，两边打架。 */
      if (Parse.isKnownExternal(r, ctx.refs)) {
        if (Parse.classifyRef(r.alias, r.source, ctx.local, ctx.refs) === 'external-typo'
            && !notes.some(function (x) { return x.alias === r.alias; })) notes.push(r);
        return;
      }

      var target = ctx.index[r.alias];
      if (target) {
        // 引用自己不算数（原来就这样）
        if (target !== obj && refs.indexOf(r.alias) < 0) refs.push(r.alias);
      } else if (dangling.indexOf(r.alias) < 0) {
        /* 去重。原来只给 refs 去重、dangling 没去重，于是一个对象里
         * 同一别名出现两次，⚠ 的悬停提示里就写两遍。 */
        dangling.push(r.alias);
      }
    });

    return {
      obj: obj,
      objclass: Parse.objClassOf(obj),
      alias: (Array.isArray(obj.aliases) && obj.aliases.length) ? obj.aliases[0] : '',
      refs: refs,
      dangling: dangling,
      notes: notes
    };
  }

  /**
   * 切分「首别名 -> RTID」的字符串数组，返回三类：
   *   objs   能解析开的对象
   *   bad    真失效（本文件里找不到）
   *   notes  外部来源里没有这个别名（灰字，不算错误）
   *
   * 这里用 Rtid.parse（贪婪版），跟 findInvalidLevelModuleReferences 同口径。
   */
  function resolveList(rtids, ctx) {
    var objs = [], bad = [], notes = [];
    (Array.isArray(rtids) ? rtids : []).forEach(function (r) {
      if (typeof r !== 'string') return;
      var info = Rtid.parse(r);
      if (!info) { bad.push({ rtid: r, reason: 'not-rtid' }); return; }

      // 已知外部来源不找本文件的同名对象，跟 nodeOf / 可达性保持一致
      var target = Parse.isKnownExternal(info, ctx.refs) ? undefined : ctx.index[info.alias];
      if (target) { objs.push(target); return; }

      var kind = Parse.classifyRef(info.alias, info.source, ctx.local, ctx.refs);
      if (kind === 'external' || kind === 'external-unknown') return;   // 在别的文件里 / 那个来源我们没数据
      if (kind === 'external-typo') { notes.push(info); return; }
      bad.push({ rtid: r, reason: 'missing', alias: info.alias });
    });
    return { objs: objs, bad: bad, notes: notes };
  }

  /**
   * 生成大纲。
   * 返回 { root, modules, waveManager, waves, supporting, orphans, dangling, notes, total, used }
   *
   * refs 是参考数据表，三种传法**语义不同**，别记混：
   *
   *   传一张表（界面传的 window.ZLevel.Refs）  按它判
   *   省略                                    取全局 window.ZLevel.Refs，等同上一行
   *   明确传 null                             一律不判
   *
   * 「省略」会去取全局（见 parse.js 的 refsTable），所以它**不是**降级传法 ——
   * 只要参考数据加载了，省略也能判出外部别名。真正的降级是明确传 null：
   * 那时所有外部来源都算「我们有数据吗 -> 没有」，外部引用一律不判，误报为 0。
   * 这跟上游 getLevelModuleAliases() 返回 null 时跳过校验是一个口径 ——
   * 参考数据加载失败不该让页面变成满屏红字。自检要模拟"没数据"就明确传 null。
   * （早先这里写作"省略（或传 null）"，跟实现对不上；check-level.js 里
   *   三种传法各有一条断言，免得再写歪。）
   */
  function build(objects, refs) {
    var list = Parse.asList(objects);
    var ctx = contextOf(list, refs);
    var root = Parse.findLevelDefinition(list);
    var dangling = [];
    var notes = [];                       // [{rtid, alias, source, where}]
    var used = new Set();
    var nodes = [];                       // 所有出过场的节点，最后统一收 notes

    /** 建节点并登记，省得每个调用点都写一遍 notes 汇总。 */
    function make(obj) {
      var n = nodeOf(obj, ctx);
      if (n) nodes.push(n);
      return n;
    }
    function addNotes(from, where) {
      from.forEach(function (info) {
        // 同一个 RTID 会被两条路径看到（Modules 列表项 / 根对象的 objdata），去重
        if (notes.some(function (x) { return x.rtid === info.full; })) return;
        notes.push({ rtid: info.full, alias: info.alias, source: info.source, where: where });
      });
    }

    if (root) used.add(root);

    // ── 模块 ──
    var modRes = resolveList(Parse.levelModules(list), ctx);
    modRes.bad.forEach(function (b) { dangling.push(b); });
    addNotes(modRes.notes, 'LevelDefinition.Modules');
    var modules = [];
    modRes.objs.forEach(function (o) {
      used.add(o);
      modules.push(make(o));
    });

    // ── 波次 ──
    var wmObj = Parse.findByClass(list, 'WaveManagerProperties');
    var waveManager = null;
    var waves = [];
    if (wmObj) {
      used.add(wmObj);
      waveManager = make(wmObj);
      var rawWaves = (wmObj.objdata && Array.isArray(wmObj.objdata.Waves)) ? wmObj.objdata.Waves : [];
      rawWaves.forEach(function (wave, i) {
        var res = resolveList(wave, ctx);
        res.bad.forEach(function (b) { dangling.push(b); });
        addNotes(res.notes, '第 ' + (i + 1) + ' 波');
        var items = res.objs.map(function (o) { used.add(o); return make(o); });
        waves.push({ index: i + 1, items: items, rawCount: Array.isArray(wave) ? wave.length : 0 });
      });
    }

    // ── 剩下的分两桶 ──
    //
    // 「挂在关卡结构上」（模块 / 波次）只是**直接**归属，不代表全部有用对象。
    // 僵尸类型、属性表、障碍物定义这些东西不在 Modules 也不在 Waves 里，
    // 它们是**被别的对象引用**才有意义的。如果把它们和真孤儿混作一谈，
    // 真实关卡里这一栏会塞满合法对象，用户就再也找不到真正没用的那几个了。
    //
    // 所以这里用可达性（跟校验层的孤儿检测同一个口径）再切一刀：
    //   supporting —— 从 LevelDefinition 可达，但不直接挂在模块/波次上
    //   orphans    —— 从 LevelDefinition 根本走不到，真正的废数据
    var reachable = Parse.computeReachableObjects(list, refs);
    var supporting = [], orphans = [];
    list.forEach(function (o) {
      if (!o || used.has(o)) return;
      var node = make(o);
      if (reachable.has(o)) supporting.push(node);
      else orphans.push(node);
    });

    // 对象 objdata 里的灰字提示也汇总进来（Modules/Waves 那两处上面已经收过）
    var rootNode = root ? make(root) : null;
    nodes.forEach(function (n) {
      n.notes.forEach(function (info) {
        if (notes.some(function (x) { return x.rtid === info.full; })) return;
        notes.push({
          rtid: info.full, alias: info.alias, source: info.source,
          where: n.alias || n.objclass
        });
      });
    });

    return {
      root: rootNode,
      modules: modules,
      waveManager: waveManager,
      waves: waves,
      supporting: supporting,
      orphans: orphans,
      dangling: dangling,
      notes: notes,
      total: list.length,
      used: used.size
    };
  }

  return { build: build, contextOf: contextOf, indexByAlias: indexByAlias, nodeOf: nodeOf };
})();

