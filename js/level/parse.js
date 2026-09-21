/* 关卡解析与校验 —— 移植自 Z-Editor 的 data/LevelParser.kt
 *
 * 这一层只读不写：给对象树、失效引用提示、孤儿检测提供依据。
 * 所有函数都**不改动传入的 JSON 树**（sanitize 系列返回新建的树），
 * 因为原始树是"严格保留未建模的键"这条约定的载体，不能顺手洗掉东西。
 *
 * ── JS 侧的两个新增防御（Kotlin 的 data class 天然不会遇到）──
 * 1. 参考文件（GridItemTypes.json 等）里有只有注释键的伪对象，
 *    `{"####### ...": "..."}`，没有 objclass。Kotlin 侧 objClass 是非空字段，
 *    前端必须自己判空，否则拿到 undefined 会一路串到排序里。
 * 2. Kotlin 用 `List<PvzObject>` 且 Gson 会把多余逗号解析成 null 元素；
 *    JS 的 JSON.parse 直接抛错，所以 sanitize 系列在 Web 端更像一道
 *    "外部文件可能不干净" 的保险，而不是日常路径。
 */
window.ZLevel = window.ZLevel || {};
window.ZLevel.Parse = (function () {
  'use strict';

  var Rtid = window.ZLevel.Rtid;

  /** 取 objclass；不是字符串时返回空串。 */
  function objClassOf(obj) {
    return (obj && typeof obj.objclass === 'string') ? obj.objclass : '';
  }

  /** 取对象列表；容忍整体为 null/非数组。不剔除 null 元素（见 sanitizeObjectList）。 */
  function asList(objects) {
    return Array.isArray(objects) ? objects : [];
  }

  /** 剔除数组里的 null 元素。移植自 sanitizeObjectList。 */
  function sanitizeObjectList(objects) {
    return asList(objects).filter(function (o) { return o != null; });
  }

  /**
   * 递归剔除 JSON 树里**数组**中的 null 元素。
   *
   * 只清数组，不动对象值：`"k": null` 是有意写出来的（多余逗号只在数组里产生
   * null），删掉会改变语义。返回重建的新树。
   */
  function sanitizeJsonElement(json) {
    if (json === null || json === undefined) return null;
    if (Array.isArray(json)) {
      var arr = [];
      for (var i = 0; i < json.length; i++) {
        if (json[i] === null) continue;   // 多余逗号留下的空洞
        arr.push(sanitizeJsonElement(json[i]));
      }
      return arr;
    }
    if (typeof json === 'object') {
      var out = {};
      for (var k in json) {
        if (Object.prototype.hasOwnProperty.call(json, k)) out[k] = sanitizeJsonElement(json[k]);
      }
      return out;
    }
    return json;
  }

  /**
   * 深清关卡对象：剔除列表里的 null，并把每个对象的 objdata 递归清一遍。
   * **就地替换 objData**（保持对象引用不变，这样可达性分析用的引用同一性还有效），
   * 返回新的对象列表。
   */
  function sanitizeLevelObjects(objects) {
    var clean = sanitizeObjectList(objects);
    for (var i = 0; i < clean.length; i++) {
      if (clean[i] && typeof clean[i] === 'object') {
        clean[i].objdata = sanitizeJsonElement(clean[i].objdata);
      }
    }
    return clean;
  }

  /** 第一个 objclass 命中的对象；没有返回 null。 */
  function findByClass(objects, cls) {
    var list = asList(objects);
    for (var i = 0; i < list.length; i++) {
      if (objClassOf(list[i]) === cls) return list[i];
    }
    return null;
  }

  /** 找根对象（LevelDefinition）。 */
  function findLevelDefinition(objects) {
    return findByClass(objects, 'LevelDefinition');
  }

  /**
   * 对象索引表：别名 -> 对象（后出现的同名别名覆盖先出现的）。
   * 移植自 parseLevel 里的 `associateBy { aliases.firstOrNull() ?: "unknown" }` ——
   * 注意它只认**首别名**，且没有别名的对象会全部挤在 "unknown" 这个键上互相覆盖。
   */
  function buildObjectMap(objects) {
    var map = {};
    var list = asList(objects);
    for (var i = 0; i < list.length; i++) {
      var a = list[i] && list[i].aliases;
      var key = (Array.isArray(a) && a.length) ? a[0] : 'unknown';
      map[key] = list[i];
    }
    return map;
  }

  /**
   * 从 LevelDefinition（根）出发，沿 objdata 里所有 RTID 引用做 BFS，返回可达对象集合。
   *
   * 用的是**引用同一性**（JS Set 对对象就是引用比较，等价于 Kotlin 的
   * IdentityHashMap 语义）：结构相等但实例不同的两个对象不算同一个，
   * 避免误判。级联删除依赖这个性质 —— 删模块前后各算一次，差集才是真正失去引用的子对象。
   *
   * 没有 LevelDefinition（无根）时返回空集。
   */
  function computeReachableObjects(objects) {
    var list = sanitizeObjectList(objects);
    var rootIndex = -1;
    for (var i = 0; i < list.length; i++) {
      if (objClassOf(list[i]) === 'LevelDefinition') { rootIndex = i; break; }
    }
    if (rootIndex < 0) return new Set();

    // 别名 -> 下标。同一别名多个对象时后者覆盖（与 buildObjectMap 语义一致）
    var aliasToIndex = {};
    list.forEach(function (o, idx) {
      var a = o && o.aliases;
      if (Array.isArray(a)) {
        for (var k = 0; k < a.length; k++) aliasToIndex[a[k]] = idx;
      }
    });

    var reachable = new Set();
    var queue = [rootIndex];
    reachable.add(list[rootIndex]);
    while (queue.length) {
      var cur = list[queue.shift()];
      var aliases = Rtid.collectAliases(cur && cur.objdata, []);
      for (var n = 0; n < aliases.length; n++) {
        var ti = aliasToIndex[aliases[n]];
        if (ti === undefined) continue;
        var target = list[ti];
        if (!reachable.has(target)) {
          reachable.add(target);
          queue.push(ti);
        }
      }
    }
    return reachable;
  }

  /**
   * 找出所有"孤立/未引用"的对象（失效模块）：可达集合的补集。
   * 文件里没有 LevelDefinition 时返回空（宁可不清，也不误删）。
   */
  function findOrphanedObjects(objects) {
    var list = sanitizeObjectList(objects);
    var hasRoot = list.some(function (o) { return objClassOf(o) === 'LevelDefinition'; });
    if (!hasRoot) return [];
    var reachable = computeReachableObjects(list);
    return list.filter(function (o) { return !reachable.has(o); });
  }

  /** 读 LevelDefinition.objdata.Modules 字符串数组；缺失/损坏返回空数组。 */
  function levelModules(objects) {
    var def = findLevelDefinition(objects);
    if (!def || !def.objdata || typeof def.objdata !== 'object') return [];
    var mods = def.objdata.Modules;
    if (!Array.isArray(mods)) return [];
    return mods.filter(function (m) { return typeof m === 'string'; });
  }

  /**
   * 找出 LevelDefinition.Modules 里的**悬空引用**（失效模块）：
   *   @CurrentLevel -> 本文件里找不到该别名的对象
   *   @LevelModules -> 参考文件 LevelModules.json 里没有该别名
   * 保持 Modules 中的顺序，已去重。
   *
   * levelModuleAliases 传 null 时 `@LevelModules` 不参与判断（参考文件没加载，
   * 参与就会满屏误报）。
   */
  function findInvalidLevelModuleReferences(objects, levelModuleAliases) {
    var list = sanitizeObjectList(objects);
    var modules = levelModules(list);
    if (!modules.length) return [];

    // 文件内所有别名（不限首别名）—— 与 Kotlin 侧 flatMap{aliases} 一致
    var fileAliases = new Set();
    list.forEach(function (o) {
      var a = o && o.aliases;
      if (Array.isArray(a)) a.forEach(function (x) { fileAliases.add(x); });
    });

    var out = [];
    var seen = new Set();
    modules.forEach(function (rtid) {
      var info = Rtid.parse(rtid);
      if (!info) return;
      var bad = false;
      if (info.source === 'CurrentLevel') bad = !fileAliases.has(info.alias);
      else if (info.source === 'LevelModules') {
        bad = levelModuleAliases != null && !levelModuleAliases.has(info.alias);
      }
      if (bad && !seen.has(rtid)) { seen.add(rtid); out.push(rtid); }
    });
    return out;
  }

  /** 所有 objclass 为 ZombieJitterOffsets 的预设，保持原顺序。 */
  function listJitterOffsetsPresets(objects) {
    return sanitizeObjectList(objects).filter(function (o) {
      return objClassOf(o) === 'ZombieJitterOffsets';
    });
  }

  /**
   * 读对象 `JitterOffsets` 键的值；没有该键、或值不是字符串时返回 null。
   * **只认这一个键** —— 别的字段里出现同名 RTID 不算引用。
   */
  function jitterOffsetsValue(obj) {
    if (!obj || !obj.objdata || typeof obj.objdata !== 'object') return null;
    var v = obj.objdata.JitterOffsets;
    return typeof v === 'string' ? v : null;
  }

  /** 收集所有把 `JitterOffsets` 指向该预设别名的对象（按别名匹配，不认整串 RTID）。 */
  function findJitterOffsetsReferrers(objects, presetAlias) {
    return sanitizeObjectList(objects).filter(function (o) {
      var rtid = jitterOffsetsValue(o);
      if (rtid == null) return false;
      var info = Rtid.parse(rtid);
      return !!info && info.alias === presetAlias;
    });
  }

  /**
   * 预设改名后同步引用：把指向 oldAlias 的 `JitterOffsets` 改成 newAlias，保留原 source。
   * **只改这一个键、不整包重写 objdata** —— 整包重写会吞掉未建模的键，这是踩过的坑。
   * 返回改动的对象数。
   */
  function renameJitterOffsetsReferences(objects, oldAlias, newAlias) {
    var changed = 0;
    findJitterOffsetsReferrers(objects, oldAlias).forEach(function (o) {
      var info = Rtid.parse(jitterOffsetsValue(o));
      if (!info) return;
      if (!o.objdata || typeof o.objdata !== 'object') return;
      o.objdata.JitterOffsets = Rtid.build(newAlias, info.source);
      changed++;
    });
    return changed;
  }

  /**
   * 收集所有别名（跨全部对象的全部 aliases，不限首别名）。
   * 用于"别名是否重复"这类校验。
   */
  function collectAllAliases(objects) {
    var map = {};
    sanitizeObjectList(objects).forEach(function (o) {
      var a = o && o.aliases;
      if (!Array.isArray(a)) return;
      a.forEach(function (x) {
        (map[x] = map[x] || []).push(o);
      });
    });
    return map;
  }

  return {
    objClassOf: objClassOf,
    asList: asList,
    sanitizeObjectList: sanitizeObjectList,
    sanitizeJsonElement: sanitizeJsonElement,
    sanitizeLevelObjects: sanitizeLevelObjects,
    findByClass: findByClass,
    findLevelDefinition: findLevelDefinition,
    buildObjectMap: buildObjectMap,
    computeReachableObjects: computeReachableObjects,
    findOrphanedObjects: findOrphanedObjects,
    levelModules: levelModules,
    findInvalidLevelModuleReferences: findInvalidLevelModuleReferences,
    listJitterOffsetsPresets: listJitterOffsetsPresets,
    jitterOffsetsValue: jitterOffsetsValue,
    findJitterOffsetsReferrers: findJitterOffsetsReferrers,
    renameJitterOffsetsReferences: renameJitterOffsetsReferences,
    collectAllAliases: collectAllAliases
  };
})();
