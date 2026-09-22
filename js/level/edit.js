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
   *   { ok:false, error, message, reason } error 是机器可读的原因
   *
   * 语义照搬 EditorScreen.kt 的 onAddModule，**三处刻意不同**：
   *   - !allowMultiple 且默认别名已存在时 Z-Editor **直接失败**。这里改成照插
   *     （别名走去重：base1 / base2…），把"两个会相互覆盖"交给界面提示 ——
   *     2026-09-22 用户要的："已有不可重复模块的话允许插入但是要提示会相互覆盖"。
   *     一份关卡里挂两条同类模块、运行时只有一条生效，是游戏认的一种写法，
   *     编辑器不该替用户拦掉它。
   *   - meta.isContainer 的条目**不进 Modules**（「波次容器」不是模块，理由见
   *     data/modules.js 那条），而且一份关卡只许有一个。
   *   - defaultSource != "CurrentLevel" 的模块**不许改代号**（见下面 wantedAlias 那段）。
   *
   * 其余照旧：defaultSource == "CurrentLevel" **且** 有骨架才创建对象，
   * 否则只往 Modules 数组里加一个 RTID 引用（引用的可能是 @LevelModules 里的东西）。
   *
   * @param {string|null} [wantedAlias] 用户在插入表单里填的代号。**没填传 null**，
   *   走元数据算出来的默认别名那条路（默认别名 + 去重）。填了就按他填的来：
   *
   *   ── 填了的时候**撞名一律拒绝，不静默加序号** ──
   *
   *   uniqueAlias 那套（`base` → `base1` → `base2`…）是给"没填"那条路用的。用户
   *   亲手打的字被悄悄换成别的，比拒绝更糟：他按了插入，屏幕上什么都没说，文件里
   *   却多出一个**不叫那个名字**的对象 —— 而引用的可达性、对象树、孤立模块判定
   *   全是按别名认人的，认错名字的一连串后果都在屏幕之外。想插第二个就自己换个名。
   *
   *   形状闸门跟改代号是同一道（aliasProblem）—— 同一个东西有两个入口，两边说的
   *   必须是一句话。
   */
  function insertModule(objects, meta, skeleton, wantedAlias) {
    if (!meta || !meta.objClass) return { ok: false, error: 'bad-meta' };

    /* 容器（眼下只有「波次容器」）一份关卡只能有一个：它不在 Modules 里，是靠波次管理器
     * 的 WaveManagerProps 键被找到的，而那个键只指得着一个 —— 第二个容器没有任何东西
     * 指得到它，对象树里就是一条孤立模块。所以这一条**不**跟着上面"允许重复"那条走：
     * 重复的模块有两个都在 Modules 里、游戏挑一个用；重复的容器只有一个能被指到。 */
    if (meta.isContainer && findObject(objects, meta.objClass)) {
      return { ok: false, error: 'exists', message: meta.title || meta.objClass };
    }

    var defaultAlias = meta.defaultAlias || meta.objClass;
    var defaultSource = meta.defaultSource || 'CurrentLevel';
    var finalAlias;

    if (wantedAlias != null) {
      /* 指向**别的文件**的模块不许改代号：`RTID(代号@LevelModules)` 里那个代号说的是
       * 参考文件里那个对象，本文件改不动它 —— 改了写下去就是一条谁也接不上的引用，
       * 而屏幕上（对象树、失效引用）要等下一次重解析才看得出来。
       * 浮层那一格已经是灰的（module-panel 的 renderDetail / renderObject 两档），
       * 这里是第二道闸：接缝不只浮层一个调用方。 */
      if (defaultSource !== 'CurrentLevel') {
        return {
          ok: false, error: 'foreign-alias',
          reason: '这个模块的对象定义在 ' + defaultSource + ' 里（别的文件），代号改不了 —— ' +
            '改了本文件就对不上它了'
        };
      }
      /* target 传 null：新对象还没进 objects，没有任何对象该被排除在"已占用"之外。 */
      var bad = aliasProblem(objects, null, wantedAlias);
      if (bad) return { ok: false, error: 'bad-name', reason: bad };
      finalAlias = String(wantedAlias).trim();
    } else {
      /* 没填代号：默认别名 + 去重。非 allowMultiple 的模块重复插入也走这儿 ——
       * 用户要的是"允许插，但告诉他两个会相互覆盖"（提示在浮层那一侧）。 */
      finalAlias = uniqueAlias(objects, defaultAlias);
    }
    var newRtid = Rtid.build(finalAlias, defaultSource);
    var created = null;

    if (defaultSource === 'CurrentLevel' && skeleton != null) {
      var data = skeleton;

      // WaveManagerModuleProperties 的骨架里有个指向波次容器的 RTID，
      // 必须改写成**本文件里实际那个**别名，不能写死 WaveManagerProps
      //
      // 键名是 "WaveManagerProps"（大写 W）—— 来自 PvzDataModels.kt:43 的
      // @SerializedName。别按 Kotlin 属性名 waveManagerProps 写，那个不是落盘的键。
      //
      // 这份关卡一个容器都没有时，wm 是 null —— 上面那边会先替用户把容器建出来
      // （见 main.js 的 doInsertModule），所以这里只管认名字。
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

    /* 容器不进 Modules：它不是模块，是被波次管理器指着的一个对象，真实关卡里没有
     * 一条把它列在 Modules 下。挂上去的话它还会被当成模块算进"这份关卡有哪些模块"，
     * 而那个列表是给"还缺哪个模块"看的。 */
    var refResult = meta.isContainer ? null : appendModuleReference(objects, newRtid);

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
      // （isContainer 那一档 refResult 是 null —— 不进 Modules 是**正常**，不是没挂上）
      refWarning: (refResult && refResult !== 'added') ? refResult : null
    };
  }

  /**
   * 这份关卡里是不是已经有一个「同类的模块」了 —— 默认别名已经被占着。
   *
   * 判据跟插入时那条去重**同一个**（`aliasTaken(默认别名)`）：两边要是各判各的，
   * 浮层上那句"会相互覆盖"迟早跟实际行为分叉。allowMultiple 由调用方自己判断 ——
   * "可多个"的模块本来就能共存，不是一个需要提醒的状态。
   */
  function moduleExists(objects, meta) {
    if (!meta) return false;
    return aliasTaken(objects, meta.defaultAlias || meta.objClass);
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
   * 改一个已有对象的参数 —— 对象编辑界面（js/editor/module-panel.js 的 'edit' 那一档）
   * 按「保存」时走这里。
   *
   * values 是**只含改动过的键**的一张表（键名 -> 新值），不是整棵 objdata：
   *
   *   - 整棵写回去会把浮层打开那一刻的快照盖到当前对象上。浮层开着的时候用户完全
   *     可能在右边的编辑器里手打几笔，那些改动不该被一次「保存」抹掉。
   *   - 而且"这个键我没动"和"这个键我要写成默认值"是两件事，前者根本不该写。
   *
   * 结构值（数组/对象）**不在这里判断**：界面那一档现在只让改标量，改不动的东西
   * 也不会进 values。要加一个这个对象没有的键，也是走这儿（键不存在就建）。
   *
   * 值一律**深拷贝**一份再放进去：传进来的可能是界面行上那个对象的引用，两个对象
   * 共用一个数组，改一个动两个 —— 这个错在插入路径上（insertModule 的 clone）已经
   * 踩过一次了。
   *
   * 返回 { ok:true, keys:[改过的键名] } / { ok:false, error }
   */
  function updateObject(objects, target, values) {
    if (!target || typeof target !== 'object') return { ok: false, error: 'no-object' };
    var i = objects.indexOf(target);
    if (i < 0) return { ok: false, error: 'not-found' };
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return { ok: false, error: 'bad-values' };
    }
    var keys = Object.keys(values);
    if (!keys.length) return { ok: false, error: 'no-change' };

    if (!target.objdata || typeof target.objdata !== 'object' || Array.isArray(target.objdata)) {
      target.objdata = {};
    }
    keys.forEach(function (k) { target.objdata[k] = clone(values[k]); });
    return { ok: true, keys: keys };
  }

  /**
   * 把一个对象挪到另一个对象**下面**（紧挨着它那一格）。
   *
   * 对象在文件里的身份有一半是**位置**（objdata 的顺序、插入时的先后），而对象的
   * 顺序对读者是有意义的：9 份真实模板里，波次容器（WaveManagerProperties）全都
   * 紧跟在波次管理器**后面那一格**，读起来才是一件事。插入是往末尾追的，所以"先建
   * 容器、再插管理器"这条路得回头把容器挪下去（见 main.js 的 doInsertModule）。
   *
   * 只动顺序、不动内容 —— 别名和引用一个字节都不碰，挪完谁指谁还是谁。
   *
   * @returns {boolean} 真挪了没有。已经在它下面、或者哪一个不在这个列表里，都是 false
   *                    （调用方不用管 —— 顺序不是正确性的一部分，挪不动就不挪）
   */
  function moveAfter(objects, moving, anchor) {
    var list = Parse.asList(objects);
    if (!moving || !anchor || moving === anchor) return false;
    var from = list.indexOf(moving);
    var to = list.indexOf(anchor);
    if (from < 0 || to < 0) return false;
    if (from === to + 1) return false;                 // 已经紧跟在它下面
    list.splice(from, 1);
    /* **挪走之后重新找 anchor**：moving 原来在 anchor 前面时，删掉它会把 anchor
     * 的下标顶掉一格，拿旧下标插就错位了。 */
    list.splice(list.indexOf(anchor) + 1, 0, moving);
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
   * 清理孤立模块。返回被清掉的对象数组（已从 objects 里移除）。
   */
  function cleanupOrphaned(objects) {
    var orphans = Parse.findOrphanedObjects(objects);
    for (var i = orphans.length - 1; i >= 0; i--) {
      var idx = objects.indexOf(orphans[i]);
      if (idx >= 0) objects.splice(idx, 1);
    }
    return orphans;
  }

  /* 「本文件里」这个来源串。别的来源指的是**别的文件**（见 js/level/refs.js 的
   * 三分口径：能解析到的、有数据但别名不在的、我们没数据的）。 */
  var CURRENT_LEVEL = 'CurrentLevel';

  /**
   * 改别名，并同步**本文件里**所有指向它的引用。
   *
   * 注意这是**文本模式的补偿**：Z-Editor 的图形界面改别名会自动同步引用，
   * 网页版直接改文本没有这层保护，所以这里提供一个显式的一次性操作。
   *
   * 同步的内容：
   *   1. 对象自己的 aliases 数组里，oldAlias -> newAlias
   *   2. 别的对象 objdata 里所有形如 RTID(oldAlias@**CurrentLevel**) 的字符串
   *   3. LevelDefinition.Modules 里的 RTID（同一批字符串，走的是同一条路）
   *
   * ── 为什么只认 @CurrentLevel，不认 @LevelModules ──
   *
   * `RTID(Foo@LevelModules)` 指的是**另一个文件**里的 Foo（refs.js 头上写着这事）。
   * 本文件里恰好也有个对象叫 Foo 时，把这条引用一起改成 `RTID(Bar@LevelModules)`
   * 就是**把一条本来指得对的引用改成一个别的文件里不存在的东西** —— 改完凭空多出
   * 一条悬空引用，而且屏幕上一点异样都没有（`@LevelModules` 那类是"外部引用"，
   * 分类上根本不会报）。所以来源必须**一个字一个字地比**，不是"看起来像就改"。
   *
   * 只改命中的字符串值，不重建 objdata，未建模的键原样保留。
   * 返回 { renamed, refs } —— renamed 是改到的别名处数，refs 是被改写的引用处数。
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
        if (source !== CURRENT_LEVEL) return whole;
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
   * 代号（别名）能长什么样。
   *
   * 白名单里的字符来自**仓库里真实存在的别名**：reference/*.js 4706 个 + 内置模板
   * 83 个，共 4789 个，用到的非字母数字字符只有 `-` 一个（ZombieActions 里 7 个，
   * 形如 `ZombosPVZ1RobotPromaxSpawnHardZombiePhase1-2`）。所以就放行这四类。
   *
   * 为什么非要有这道闸：代号会以 `RTID(代号@来源)` 的形状落进文本。
   *   - 混进 `@` 就出现三段式 `RTID(a@b@CurrentLevel)`，而 rtid.js 头上记着，
   *     parse 与 collectRefs 对这种形状的切法**故意不一致**（一个切成 a@b /
   *     CurrentLevel，一个切成 a / b@CurrentLevel）。改一次名就能造出一批
   *     两边读数不同的引用，是最难查的那种坏数据。
   *   - 混进 `(` `)` 会让 rtid.js 的扫描正则（要求括号内不含括号）整个漏掉它 ——
   *     引用当场从可达性分析里消失，那个对象就成了"孤立模块"等着被清理。
   *   - 空白、引号、反斜杠要么切坏 RTID 的边界，要么在 JSON 串里立不住。
   * 所以不是"提醒一下也能写"，是根本不写进去。
   */
  var ALIAS_RE = /^[A-Za-z0-9_-]+$/;

  /**
   * 一个新代号能不能用。能用返回 ''，否则返回给用户看的原因。
   *
   * target 是"要改名的那个对象"，用来把它自己排除在"已占用"之外 ——
   * 它自己正用着这个名字（或者本来就叫这个名）都不算撞名。
   */
  function aliasProblem(objects, target, newAlias) {
    var name = String(newAlias == null ? '' : newAlias).trim();
    if (!name) return '代号不能为空';
    if (!ALIAS_RE.test(name)) {
      return '「' + name + '」不能当代号：只能用字母、数字、下划线和连字符';
    }
    var taken = Parse.asList(objects).some(function (o) {
      return o !== target && Array.isArray(o.aliases) && o.aliases.indexOf(name) >= 0;
    });
    if (taken) return '这份文件里已经有对象叫「' + name + '」了，换一个';
    return '';
  }

  /**
   * 给一个**已有对象**改代号，并同步本文件里所有指向它的引用 ——
   * 对象编辑浮层（module-panel.js 的「代号」那一格）按保存时走这里。
   *
   * 两道闸都在**改之前**：新代号形状要合法（aliasProblem），被别人占着就拒绝。
   * 「差不多就改吧」在这件事上尤其不能有 —— Parse 的可达性分析、Outline 的对象树、
   * Parse.findOrphanedObjects 全是**按别名认人**的，两个对象共用一个名字之后，
   * 这一堆分析都在猜，而屏幕上看不出任何毛病。
   *
   * 还有一道：oldAlias 被**不止一个**对象用着时也拒绝。那也是坏数据（同一份文件里
   * 别名重复），renameAlias 会把两个对象的别名一起改掉 —— 那是在替用户猜"你到底
   * 想改哪一个"。说清楚让他先去文本里把重名修掉。
   *
   * 返回 { ok:true, alias, renamed, refs } / { ok:false, error, reason }
   */
  function renameObjectAlias(objects, target, newAlias) {
    if (!target || typeof target !== 'object') {
      return { ok: false, error: 'no-object', reason: '找不到这个对象' };
    }
    var list = Parse.asList(objects);
    if (list.indexOf(target) < 0) {
      return { ok: false, error: 'not-found', reason: '这个对象在文件里找不到了' };
    }

    var oldAlias = firstAliasOf(target);
    if (!oldAlias) {
      return { ok: false, error: 'no-alias', reason: '这个对象没有别名，改不了代号' };
    }

    var name = String(newAlias == null ? '' : newAlias).trim();
    var bad = aliasProblem(list, target, name);
    if (bad) return { ok: false, error: 'bad-name', reason: bad };
    if (name === oldAlias) {
      return { ok: true, alias: name, renamed: 0, refs: 0, unchanged: true };
    }

    var owners = list.filter(function (o) {
      return Array.isArray(o.aliases) && o.aliases.indexOf(oldAlias) >= 0;
    });
    if (owners.length > 1) {
      return {
        ok: false, error: 'ambiguous',
        reason: '这份文件里有 ' + owners.length + ' 个对象都叫「' + oldAlias +
          '」—— 先到文本里把重名改掉，这里才知道该改哪一个'
      };
    }

    var r = renameAlias(list, oldAlias, name);
    return { ok: true, alias: name, renamed: r.renamed, refs: r.refs };
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
    moduleExists: moduleExists,
    insertModule: insertModule,
    insertEvent: insertEvent,
    updateObject: updateObject,
    setManualStartup: setManualStartup,
    moveAfter: moveAfter,
    removeObject: removeObject,
    cleanupOrphaned: cleanupOrphaned,
    renameAlias: renameAlias,
    aliasProblem: aliasProblem,
    renameObjectAlias: renameObjectAlias,
    replaceAliasInText: replaceAliasInText
  };
})();
