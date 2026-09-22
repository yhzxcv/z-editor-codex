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
 * 两处必须给同一个答案。否则会出现「树上挂着子节点、清理却把它当孤立模块删掉」。
 *
 * 「真失效」的判据是 Parse.classifyRef 的 **missing** 一档：来源是 CurrentLevel / 没有 @，
 * 而本文件里确实没这个别名。**external-unknown 一律不判**（@SkillTypes 这些来源我们根本
 * 没有数据，2938 条）—— 那不算"落空了"，算"我们不知道"，收进来就是满屏误报。
 *
 * ── 节点级与顶层 ──
 * nodeOf 是**逐对象**算的（节点级的 dangling / notes，树上的 ⚠ 就是它），build() 收尾时
 * 两样都汇总进顶层：notes 进 outline.notes、dangling 进 outline.dangling（带上出处）。
 * 原先只收 notes、不收 dangling，于是对象深处一条落空的 @CurrentLevel 引用进不了
 * 「失效引用」——用户看到的只是那个对象变成了孤立模块（可达性连带不上）。那是个 bug。
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
   *   dangling  本文件里找不到的引用 —— 真失效，标 ⚠。元素是 {rtid, alias}，
   *             由 build() 汇总进顶层的 dangling，并带上这个对象的出处
   *   notes     外部来源里没有的别名 —— 灰字提示（元素是 collectRefs 的引用对象）
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
       * 会挂出一个子节点，而清理那边认为它是孤立模块，两边打架。 */
      if (Parse.isKnownExternal(r, ctx.refs)) {
        if (Parse.classifyRef(r.alias, r.source, ctx.local, ctx.refs) === 'external-typo'
            && !notes.some(function (x) { return x.alias === r.alias; })) notes.push(r);
        return;
      }

      var target = ctx.index[r.alias];
      if (target) {
        // 引用自己不算数（原来就这样）
        if (target !== obj && refs.indexOf(r.alias) < 0) refs.push(r.alias);
      } else if (Parse.classifyRef(r.alias, r.source, ctx.local, ctx.refs) === 'missing'
                 && !dangling.some(function (x) { return x.alias === r.alias; })) {
        /* 只收 missing 这一档。走到这里还有另一种引用：来源我们**没有数据**的
         * （@SkillTypes、@ProjectileTypes……）—— 那种一律不判，见文件头。
         *
         * 元素带整串 RTID，是为了让 build() 能按它去重、report.js 能合并出处。
         * 去重按 alias：同一别名在一个对象里出现两次时，⚠ 的悬停提示会写两遍
         * （原来只给 refs 去重、dangling 没去重，就是这么写出来的）。 */
        dangling.push({ rtid: r.full, alias: r.alias });
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
   *
   * where 是**出处**（「LevelDefinition.Modules」/「第 3 波」），原样带在 bad 的每一条上。
   * 调用点早就知道自己解析的是哪个列表，而 report.js 要把 Modules 和每一波的失效引用
   * 合并成一份给用户看的清单 —— 合并之后「这条是在哪儿烂的」只能靠这里带上，
   * 事后再去猜是猜不出来的。notes 走的是同一套（addNotes 的 where 参数）。
   */
  function resolveList(rtids, ctx, where) {
    var objs = [], bad = [], notes = [];
    (Array.isArray(rtids) ? rtids : []).forEach(function (r) {
      if (typeof r !== 'string') return;
      var info = Rtid.parse(r);
      if (!info) { bad.push({ rtid: r, reason: 'not-rtid', where: where }); return; }

      // 已知外部来源不找本文件的同名对象，跟 nodeOf / 可达性保持一致
      var target = Parse.isKnownExternal(info, ctx.refs) ? undefined : ctx.index[info.alias];
      if (target) { objs.push(target); return; }

      var kind = Parse.classifyRef(info.alias, info.source, ctx.local, ctx.refs);
      if (kind === 'external' || kind === 'external-unknown') return;   // 在别的文件里 / 那个来源我们没数据
      if (kind === 'external-typo') { notes.push(info); return; }
      bad.push({ rtid: r, reason: 'missing', alias: info.alias, where: where });
    });
    return { objs: objs, bad: bad, notes: notes };
  }

  /**
   * 关卡定义 `Modules` 里指向 `@LevelModules` 的那几条，按别名去重、保持原顺序。
   * 返回 `[{alias, source, rtid}]`。
   *
   * 为什么单独挑出来：它们**不是本文件的对象** —— 对象定义在参考文件里。所以
   * `modules` 段收不了它们（那一段装的是解析得开、有本地对象可点的东西），
   * `supporting` 也收不了（那一段要求从 LevelDefinition 可达，而它们根本没有节点）。
   * 一段都进不去，屏幕上就彻底没影了 —— 而这恰恰是「插入模块」栏该摆出来的东西。
   *
   * **只认 `Modules`**：`Loot` / `StageModule` / `VictoryModule` 那几个键上也会挂
   * `@LevelModules` 的 RTID，但那是关卡定义自己的字段，不是"这份关卡挂了哪些模块"
   * （2026-09-22 用户：「只解析 modules 里的模块，另外的 VictoryModule、StageModule
   * 等不要管」）。拿它们当模块列出来，插进去的位置也就成了问题。
   *
   * 本模块**不认识注册表**（那是编辑器侧的数据），所以这里只负责"关卡的 Modules 里
   * 有哪些外部引用"，"注册表里已经有的不要重复列"那一步过滤放在 module-panel 里。
   *
   * 参照文件里有没有这个别名**也不在这儿判** —— 失效引用那一档由 report.js 报，
   * 两边各报各的。参考数据是快照，比游戏旧是常态，按"参考文件里没有"过滤会把
   * 新版本游戏的模块整个藏掉，而那正是最需要看见的一类。
   */
  function externalModules(root) {
    if (!root || !root.objdata || typeof root.objdata !== 'object') return [];
    var mods = root.objdata.Modules;
    if (!Array.isArray(mods)) return [];
    var seen = Object.create(null), out = [];
    mods.forEach(function (m) {
      if (typeof m !== 'string') return;
      var r = Rtid.parse(m);
      /* 用 parse 而不是 collectRefs：构造侧（Edit.insertModule -> Rtid.build）走的
       * 就是这一对，来回必须是同一把尺子，否则列出来一条、插进去又是一条。 */
      if (!r || r.source !== 'LevelModules') return;
      if (seen[r.alias]) return;
      seen[r.alias] = true;
      out.push({ alias: r.alias, source: r.source, rtid: r.full });
    });
    return out;
  }

  /**
   * 生成大纲。
   * 返回 { root, modules, waveManager, waves, supporting, orphans, dangling, notes,
   *        external, total, used }
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
    var modRes = resolveList(Parse.levelModules(list), ctx, 'LevelDefinition.Modules');
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
        var res = resolveList(wave, ctx, '第 ' + (i + 1) + ' 波');
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
    // 它们是**被别的对象引用**才有意义的。如果把它们和真孤立模块混作一谈，
    // 真实关卡里这一栏会塞满合法对象，用户就再也找不到真正没用的那几个了。
    //
    // 所以这里用可达性（跟校验层的孤立模块检测同一个口径）再切一刀：
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

    /* 对象 objdata 里的坏引用也汇总进来（Modules/Waves 那两处上面已经收过）：
     *   n.dangling  本文件里找不到 —— 真失效，进顶层的 dangling
     *   n.notes     参考文件里没有这个别名 —— 灰字那一档
     * 少了 n.dangling 这一支就是用户报的那个 bug：对象深处一条 @CurrentLevel 的引用
     * 落空，顶层一点动静都没有，只有那个对象连带不上、变成孤立模块。 */
    var rootNode = root ? make(root) : null;
    nodes.forEach(function (n) {
      var owner = n.alias || n.objclass;
      n.dangling.forEach(function (d) {
        /* 按整串 RTID 去重，跟下面 notes 那条同一个道理。resolveList 先跑，
         * 所以 Modules / 波次里已经报过的那条**出处更准**，以列表为准；
         * 对象深处那一处仍然会在它自己那个节点的 ⚠ 上标出来
         * （node.dangling 是逐对象的，没被这里吃掉）。 */
        if (dangling.some(function (x) { return x.rtid === d.rtid; })) return;
        dangling.push({ rtid: d.rtid, alias: d.alias, reason: 'missing', where: owner });
      });
      n.notes.forEach(function (info) {
        if (notes.some(function (x) { return x.rtid === info.full; })) return;
        notes.push({
          rtid: info.full, alias: info.alias, source: info.source,
          where: owner
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
      external: externalModules(root),
      total: list.length,
      used: used.size
    };
  }

  return {
    build: build,
    contextOf: contextOf,
    indexByAlias: indexByAlias,
    nodeOf: nodeOf,
    externalModules: externalModules
  };
})();

