/* 关卡大纲 —— 把平铺的对象列表组织成「用户在关卡里看到的层次」
 *
 * 关卡 JSON 是一维数组，但人的心智模型是：
 *   关卡定义 → 一堆模块 → 波次管理器 → 每一波里有若干事件 → 剩下的就是没用上的
 * 对象树照这个层次画，用户才找得着北。这一层只读，不改任何东西。
 *
 * 另外它也承担「引用是否解析得开」的检查：把悬空引用的 RTID 单独列出来，
 * 因为那是最常见的手改错误。
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
   * 一个对象的显示信息。
   * refs 是它引用到的、且**在本文件里能解析开**的别名（用于树上展开子节点）。
   */
  function nodeOf(obj, aliasIndex) {
    if (!obj) return null;
    var refs = [];
    var dangling = [];
    Rtid.collectAliases(obj.objdata, []).forEach(function (a) {
      var target = aliasIndex[a];
      if (target && target !== obj) {
        if (refs.indexOf(a) < 0) refs.push(a);
      } else if (!target) {
        dangling.push(a);
      }
    });
    return {
      obj: obj,
      objclass: Parse.objClassOf(obj),
      alias: (Array.isArray(obj.aliases) && obj.aliases.length) ? obj.aliases[0] : '',
      refs: refs,
      dangling: dangling
    };
  }

  /**
   * 切分「首别名 -> RTID」的字符串数组，返回能解析开的对象列表 + 解析不开的 RTID。
   */
  function resolveList(rtids, aliasIndex) {
    var objs = [], bad = [];
    (Array.isArray(rtids) ? rtids : []).forEach(function (r) {
      if (typeof r !== 'string') return;
      var info = Rtid.parse(r);
      if (!info) { bad.push({ rtid: r, reason: 'not-rtid' }); return; }
      var target = aliasIndex[info.alias];
      if (target) objs.push(target);
      // @LevelModules 的引用本来就不在本文件里，不算悬空
      else if (info.source !== 'LevelModules') bad.push({ rtid: r, reason: 'missing', alias: info.alias });
    });
    return { objs: objs, bad: bad };
  }

  /**
   * 生成大纲。
   * 返回 { root, modules, waveManager, waves, orphans, dangling, total, used }
   */
  function build(objects) {
    var list = Parse.asList(objects);
    var aliasIndex = indexByAlias(list);
    var root = Parse.findLevelDefinition(list);
    var dangling = [];
    var used = new Set();

    if (root) used.add(root);

    // ── 模块 ──
    var modRes = resolveList(Parse.levelModules(list), aliasIndex);
    modRes.bad.forEach(function (b) { dangling.push(b); });
    var modules = [];
    modRes.objs.forEach(function (o) {
      used.add(o);
      modules.push(nodeOf(o, aliasIndex));
    });

    // ── 波次 ──
    var wmObj = Parse.findByClass(list, 'WaveManagerProperties');
    var waveManager = null;
    var waves = [];
    if (wmObj) {
      used.add(wmObj);
      waveManager = nodeOf(wmObj, aliasIndex);
      var rawWaves = (wmObj.objdata && Array.isArray(wmObj.objdata.Waves)) ? wmObj.objdata.Waves : [];
      rawWaves.forEach(function (wave, i) {
        var res = resolveList(wave, aliasIndex);
        res.bad.forEach(function (b) { dangling.push(b); });
        var items = res.objs.map(function (o) { used.add(o); return nodeOf(o, aliasIndex); });
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
    var reachable = Parse.computeReachableObjects(list);
    var supporting = [], orphans = [];
    list.forEach(function (o) {
      if (!o || used.has(o)) return;
      var node = nodeOf(o, aliasIndex);
      if (reachable.has(o)) supporting.push(node);
      else orphans.push(node);
    });

    return {
      root: root ? nodeOf(root, aliasIndex) : null,
      modules: modules,
      waveManager: waveManager,
      waves: waves,
      supporting: supporting,
      orphans: orphans,
      dangling: dangling,
      total: list.length,
      used: used.size
    };
  }

  return { build: build, indexByAlias: indexByAlias, nodeOf: nodeOf };
})();
