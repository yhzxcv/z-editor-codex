/* 结构编辑操作 —— 移植自 Z-Editor 的 EditorScreen.kt（onAddModule / onAddEvent /
 * cleanupOrphanedObjects / 别名改名同步）
 *
 * 这一层是**唯一**会改动关卡对象列表的地方，UI 只负责把结果画出来。
 * 所有函数直接改传入的 objects 数组（跟 Kotlin 侧一样是就地修改），
 * 因为对象引用是可达性分析的依据，换一批新对象会让引用失效。
 *
 * ── 与 Z-Editor 的一处刻意不同 ──
 * Z-Editor 插入事件后会把整个 WaveManagerProperties 的 objdata 用强类型模型
 * 重新序列化一遍（`it.objData = gson.toJsonTree(parsedData!!.waveManager)`）。
 * 那会**吞掉所有未建模的键** —— 正是文档里点名的坑。本层反过来：
 * 只往 Waves 的对应位置 push 一个 RTID，objdata 里别的键原样不动。
 * 同理，改 manualStartup 也只写这一个键。
 */
window.ZLevel = window.ZLevel || {};
window.ZLevel.Edit = (function () {
  'use strict';

  var Rtid = window.ZLevel.Rtid;
  var Parse = window.ZLevel.Parse;

  /** 别名是否已被任何对象占用（查全部 aliases，不只看首别名）。 */
  function aliasTaken(objects, alias) {
    return Parse.asList(objects).some(function (o) {
      return o && Array.isArray(o.aliases) && o.aliases.indexOf(alias) >= 0;
    });
  }

  /**
   * 取一个没被占用的别名：base 空闲就用 base，否则 base1 / base2 …
   * 与 Kotlin 侧的 count 循环等价。
   */
  function uniqueAlias(objects, base) {
    if (!aliasTaken(objects, base)) return base;
    var count = 0, candidate = base;
    while (aliasTaken(objects, candidate)) {
      count++;
      candidate = base + count;
    }
    return candidate;
  }

  /**
   * 事件用的别名分配：首候选是 base + "0"（base 已经含 WaveN 前缀），
   * 再依次 base1 / base2 …
   */
  function uniqueEventAlias(objects, base) {
    var count = 0, candidate = base + count;
    while (aliasTaken(objects, candidate)) {
      count++;
      candidate = base + count;
    }
    return candidate;
  }

  /** 找一个 objClass 的对象（第一个）。 */
  function findObject(objects, objClass) {
    return Parse.findByClass(objects, objClass);
  }

  /** 该对象的首别名；没有别名返回 null。 */
  function firstAliasOf(obj) {
    var a = obj && obj.aliases;
    return (Array.isArray(a) && a.length) ? a[0] : null;
  }

  /**
   * 往 LevelDefinition.objdata.Modules 追加一个 RTID。
   * 没有 Modules 键就建一个空数组 —— 这与 Kotlin 侧一致。
   * 返回 'added' | 'no-leveldef' | 'storage-not-object' | 'modules-not-array'
   * （后两种在 Kotlin 里是被 try/catch 吞掉的异常，这里显式报出来让上层提示用户）。
   */
  function appendModuleReference(objects, rtid) {
    var def = Parse.findLevelDefinition(objects);
    if (!def) return 'no-leveldef';
    if (!def.objdata || typeof def.objdata !== 'object' || Array.isArray(def.objdata)) {
      return 'storage-not-object';
    }
    var mods = def.objdata.Modules;
    if (mods === undefined) {
      def.objdata.Modules = [];
      mods = def.objdata.Modules;
    }
    if (!Array.isArray(mods)) return 'modules-not-array';
    mods.push(rtid);
    return 'added';
  }

  /** 从 LevelDefinition.Modules 里删掉一个 RTID（只删第一个匹配）。 */
  function removeModuleReference(objects, rtid) {
    var def = Parse.findLevelDefinition(objects);
    if (!def || !def.objdata || !Array.isArray(def.objdata.Modules)) return false;
    var idx = def.objdata.Modules.indexOf(rtid);
    if (idx < 0) return false;
    def.objdata.Modules.splice(idx, 1);
    return true;
  }

  /**
   * 插入一个模块。meta 来自 data/modules.js（或 registry-raw.json 的条目），
   * skeleton 来自 data/module-skeletons.js。
   *
   * 返回：
   *   { ok:true,  rtid, alias, created }   created 是新建的对象；没建则为 null
   *   { ok:false, error, message }          error 是机器可读的原因
   *
   * 语义严格照搬 EditorScreen.kt 的 onAddModule：
   *   - !allowMultiple 且默认别名已存在 -> 直接失败，不动任何东西
   *   - defaultSource == "CurrentLevel" **且** 有骨架才创建对象；
   *     否则只往 Modules 数组里加一个 RTID 引用（引用的可能是 @LevelModules 里的东西）
   *   - 无论是否创建对象，RTID 都会进 Modules
   */
  function insertModule(objects, meta, skeleton) {
    if (!meta || !meta.objClass) return { ok: false, error: 'bad-meta' };

    var defaultAlias = meta.defaultAlias || meta.objClass;
    var allowMultiple = !!meta.allowMultiple;
    var defaultSource = meta.defaultSource || 'CurrentLevel';

    if (!allowMultiple && aliasTaken(objects, defaultAlias)) {
      return { ok: false, error: 'exists', message: meta.title || defaultAlias };
    }

    var finalAlias = uniqueAlias(objects, defaultAlias);
    var newRtid = Rtid.build(finalAlias, defaultSource);
    var created = null;

    if (defaultSource === 'CurrentLevel' && skeleton != null) {
      var data = skeleton;

      // WaveManagerModuleProperties 的骨架里有个指向波次管理器的 RTID，
      // 必须改写成**本文件里实际那个**别名，不能写死 WaveManagerProps
      //
      // 键名是 "WaveManagerProps"（大写 W）—— 来自 PvzDataModels.kt:43 的
      // @SerializedName。别按 Kotlin 属性名 waveManagerProps 写，那个不是落盘的键。
      if (meta.objClass === 'WaveManagerModuleProperties' && data && typeof data === 'object') {
        var wm = findObject(objects, 'WaveManagerProperties');
        var wmAlias = firstAliasOf(wm) || 'WaveManagerProps';
        data = Object.assign({}, data, {
          WaveManagerProps: Rtid.build(wmAlias, 'CurrentLevel')
        });
      }

      created = { aliases: [finalAlias], objclass: meta.objClass, objdata: clone(data) };
      objects.push(created);
    }

    var refResult = appendModuleReference(objects, newRtid);

    // 坚不可摧：插入时把波次管理器切成手动开始（波次由玩家触发，不自动开始）
    //
    // ⚠ 这里修了 Z-Editor 的一个 bug。它判的是 `meta.defaultAlias == "LastStandMinigame"`，
    // 但注册表里 LastStandMinigameProperties 的 defaultAlias 是 **"LastStand"**，
    // 全仓库没有任何模块叫 LastStandMinigame —— 那个分支从来没执行过。
    // 作者多半是想写 EditorSubScreen.LastStandMinigame（一个导航类）或 objClass，
    // 手滑写成了别名字面量。按明显意图改成认 objClass，别名那半留着兼容将来改注册表。
    if (meta.objClass === 'LastStandMinigameProperties' || defaultAlias === 'LastStandMinigame') {
      setManualStartup(objects, true);
    }

    return {
      ok: true,
      rtid: newRtid,
      alias: finalAlias,
      created: created,
      // 引用没挂上不算失败（对象可能已经建好了），但要如实告诉调用方
      refWarning: refResult === 'added' ? null : refResult
    };
  }

  /**
   * 往第 waveIndex 波（1 起）插入一个事件。
   * 别名固定为 Wave<N><默认别名><序号>，来源固定 CurrentLevel。
   *
   * waveIndex 越界时返回错误，不偷偷建新波 —— 建新波是"波次管理"的事，
   * 不该由插入事件顺手做掉。
   */
  function insertEvent(objects, meta, waveIndex, skeleton) {
    if (!meta || !meta.objClass) return { ok: false, error: 'bad-meta' };
    if (!(waveIndex >= 1)) return { ok: false, error: 'bad-wave' };

    var wmObj = findObject(objects, 'WaveManagerProperties');
    if (!wmObj || !wmObj.objdata || typeof wmObj.objdata !== 'object') {
      return { ok: false, error: 'no-wavemanager' };
    }
    var waves = wmObj.objdata.Waves;
    if (!Array.isArray(waves) || waveIndex > waves.length) {
      return { ok: false, error: 'bad-wave', waveCount: Array.isArray(waves) ? waves.length : 0 };
    }
    var wave = waves[waveIndex - 1];
    if (!Array.isArray(wave)) return { ok: false, error: 'bad-wave' };

    var base = 'Wave' + waveIndex + (meta.defaultAlias || meta.objClass);
    var alias = uniqueEventAlias(objects, base);
    var rtid = Rtid.build(alias, 'CurrentLevel');

    var objClass = meta.defaultObjClass || meta.objClass;
    objects.push({
      aliases: [alias],
      objclass: objClass,
      objdata: clone(skeleton != null ? skeleton : {})
    });

    // 只往这一波里追加，**不重写整个 objdata**（见文件头说明）
    wave.push(rtid);

    return { ok: true, rtid: rtid, alias: alias, waveIndex: waveIndex, objclass: objClass };
  }

  /** 深拷贝一份 JSON 骨架，避免多个对象共享同一个骨架实例。 */
  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  /**
   * 设置 WaveManagerModuleProperties 的 ManualStartup。
   * 键名是 "ManualStartup"（大写 M，PvzDataModels.kt:44），不是属性名 manualStartup。
   *
   * enable=false 时写成 null（Kotlin 侧 Boolean? 的关闭态；Gson 会略掉 null 键，
   * 这里保留键但置 null，语义相同且用户看得见发生了什么）。
   */
  function setManualStartup(objects, enable) {
    var obj = findObject(objects, 'WaveManagerModuleProperties');
    if (!obj || !obj.objdata || typeof obj.objdata !== 'object') return false;
    obj.objdata.ManualStartup = enable ? true : null;
    return true;
  }

  /**
   * 删除对象。返回 { removed, cascaded } —— cascaded 是因为失去引用而被连带清掉的。
   *
   * 先删目标，再从 LevelDefinition 重算可达性，补集就是被牵连的。
   * 没有 LevelDefinition 时不做级联（宁可留着，也不误删）。
   */
  function removeObject(objects, target) {
    var idx = objects.indexOf(target);
    if (idx < 0) return { removed: null, cascaded: [] };
    objects.splice(idx, 1);

    var orphans = Parse.findOrphanedObjects(objects);
    orphans.forEach(function (o) {
      var i = objects.indexOf(o);
      if (i >= 0) objects.splice(i, 1);
    });
    return { removed: target, cascaded: orphans };
  }

  /**
   * 清理孤儿对象。返回被清掉的对象数组（已从 objects 里移除）。
   */
  function cleanupOrphaned(objects) {
    var orphans = Parse.findOrphanedObjects(objects);
    for (var i = orphans.length - 1; i >= 0; i--) {
      var idx = objects.indexOf(orphans[i]);
      if (idx >= 0) objects.splice(idx, 1);
    }
    return orphans;
  }

  /**
   * 改别名，并同步所有引用它的地方。
   *
   * 注意这是**文本模式的补偿**：Z-Editor 的图形界面改别名会自动同步引用，
   * 网页版直接改文本没有这层保护，所以这里提供一个显式的一次性操作。
   *
   * 同步的内容：
   *   1. 对象自己的 aliases 数组里，oldAlias -> newAlias
   *   2. 别的对象 objdata 里所有形如 RTID(oldAlias@任意) 的字符串
   *   3. LevelDefinition.Modules 里的 RTID
   *   4. JitterOffsets 键（走 Parse.renameJitterOffsetsReferences 的同一逻辑）
   *
   * 只改命中的字符串值，不重建 objdata，未建模的键原样保留。
   * 返回 { renamed, refs } —— refs 是被改写的引用处数。
   */
  function renameAlias(objects, oldAlias, newAlias) {
    if (!oldAlias || !newAlias || oldAlias === newAlias) {
      return { renamed: 0, refs: 0 };
    }
    var list = Parse.asList(objects);
    var renamed = 0, refs = 0;

    var oldRtidRe = new RegExp(
      'RTID\\(' + escapeRe(oldAlias) + '@([^()]*)\\)', 'g'
    );

    function rewriteString(s) {
      if (typeof s !== 'string' || s.indexOf('RTID(') < 0) return s;
      return s.replace(oldRtidRe, function (whole, source) {
        refs++;
        return Rtid.build(newAlias, source);
      });
    }

    function walk(node) {
      if (node === null || node === undefined) return node;
      if (typeof node === 'string') return rewriteString(node);
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) {
          var nv = walk(node[i]);
          if (nv !== node[i]) node[i] = nv;
        }
        return node;
      }
      if (typeof node === 'object') {
        for (var k in node) {
          if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
          var v = walk(node[k]);
          if (v !== node[k]) node[k] = v;
        }
        return node;
      }
      return node;
    }

    list.forEach(function (o) {
      if (o && Array.isArray(o.aliases)) {
        for (var i = 0; i < o.aliases.length; i++) {
          if (o.aliases[i] === oldAlias) { o.aliases[i] = newAlias; renamed++; }
        }
      }
      if (o && o.objdata) walk(o.objdata);
    });

    return { renamed: renamed, refs: refs };
  }

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 全局把文本里的老别名替换成新别名（纯字符串层面的兜底）。
   * 与 renameAlias 的区别：这个不解析结构，纯粹按字面替换，
   * 用在"用户手打的文本自己乱了、需要一个粗暴的修法"这个场景。
   * 默认只替换 RTID(...) 里出现的，避免误伤注释和普通字符串。
   */
  function replaceAliasInText(text, oldAlias, newAlias) {
    if (!oldAlias || !newAlias) return { text: text, count: 0 };
    var count = 0;
    var re = new RegExp('RTID\\(' + escapeRe(oldAlias) + '@([^()]*)\\)', 'g');
    var out = text.replace(re, function (whole, source) {
      count++;
      return Rtid.build(newAlias, source);
    });
    return { text: out, count: count };
  }

  return {
    aliasTaken: aliasTaken,
    uniqueAlias: uniqueAlias,
    uniqueEventAlias: uniqueEventAlias,
    findObject: findObject,
    firstAliasOf: firstAliasOf,
    appendModuleReference: appendModuleReference,
    removeModuleReference: removeModuleReference,
    insertModule: insertModule,
    insertEvent: insertEvent,
    setManualStartup: setManualStartup,
    removeObject: removeObject,
    cleanupOrphaned: cleanupOrphaned,
    renameAlias: renameAlias,
    replaceAliasInText: replaceAliasInText
  };
})();
