/* 关卡体检报告 —— 「这份文件有什么毛病」的**单一真源**
 *
 * 状态栏、对象栏顶上的汇总条、对象树、都被同一份结果喂着。做这一层是因为原先
 * 每个渲染面各自算各自的：状态栏在 main.js 里数一遍、校验页在 panels.js 里又数
 * 一遍，而 panels.js 那个 hard 直接把两个**部分重叠**的集合相加（孤立模块 + 失效
 * 的模块引用 + 模块冲突 + 悬空引用），于是「Modules 里指向的对象在本文件找不到」
 * 这一格被数了两遍。
 *
 * ── 失效引用：三个判定各留各的，展示层合成一处 ──
 *
 * 三个判定函数管的是不同的集合，谁都不包含谁：
 *
 *   findInvalidLevelModuleReferences  只查 LevelDefinition.Modules 一个数组，
 *                                     @CurrentLevel 找不到、@LevelModules 别名不在
 *                                     注册表，两种都算错（上游 Kotlin 的窄口径）
 *   Outline 的 dangling               查 Modules + 每一波 + 每个对象的 objdata，
 *                                     只收「本文件里找不到」
 *   Outline 的 notes                  查 Modules + 每一波 + 每个对象的 objdata，
 *                                     只收「参考文件里没有这个别名」
 *
 * 合起来看是这样一个 2×3：
 *
 *     出问题的引用在哪       本文件里找不到   参考文件里没有这个别名
 *     Modules 数组里         两边都报         只有 invalid 报
 *     某一波的数组里         只有 dangling    只有 notes 报
 *     对象深处               只有 dangling    只有 notes 报
 *
 * 用户要的是「悬空和失效往往指的是同一个」，所以这里取**并集**、按整串 RTID 去重，
 * 用户看到一处「失效引用」、一个数。
 *
 * 第三行第一格是**修过一个 bug 之后**才填上的：早先 outline.build 只把节点级的 notes
 * 汇总进顶层、dangling 一个都不收，于是对象深处一条落空的 @CurrentLevel 引用只表现为
 * 「那个对象连带不上、变成孤立模块」，失效引用那一栏一点动静都没有。用户报的就是这个 ——
 * 游戏读到落空的引用会闪退，所以它必须报出来。（原因见 outline.js 的 build。）
 *
 * ── 三格全进红档，包括「参考文件里没有」 ──
 *
 * 「原则上不能出现落空的模块」：Modules 数组是游戏真正读来加载模块的地方，
 * RTID(x@LevelModules) 而注册表里没有 x，按上游就是错误。
 *
 * 早先只有 Modules 那一格按这个原则办，波次里和对象深处的 external-typo 走灰字
 * 提示（可能拼错了，也可能我们的参考快照比游戏旧，从这份文件分不出是哪种）。
 * 用户后来明确要求「参考文件没有的也划为失效引用」—— 一份引用了参考数据里不存在
 * 的别名，游戏加载时同样会落空，不该缩在另一段里当提示。所以现在第三格也进红档。
 *
 * **已知代价**：参考快照比游戏旧时，那些新增的别名会全部报红。这是这个口径自带
 * 的误报，不是 bug；真出现时该更新的是 reference/ 下的数据，不是这里的判断。
 *
 * kind 仍分两档，因为它们给用户的信息不一样：
 *   missing      本文件里找不到 —— 结论最硬
 *   alias-typo   参考文件里没有 —— 还留着「说不定是参考数据旧了」的余地
 * 同一条两边都报时取 missing。
 *
 * ── 边界（重要，别顺手扩大） ──
 *
 *   external-unknown   我们**根本没有**那个来源的数据（@SkillTypes 2938 条、
 *                      @ProjectileTypes 1694 条），继续**不判**。那不是「外部源
 *                      没有这个别名」，是「我们没这个源」，硬判就是满屏误报 ——
 *                      js/level/refs.js 的文件头整段在讲这件事。
 *
 * 所以 classifyRef / nodeOf / resolveList 的语义一个字没改，分桶只发生在这里。
 */
window.ZLevel = window.ZLevel || {};
window.ZLevel.Report = (function () {
  'use strict';

  var Parse = window.ZLevel.Parse;
  var Outline = window.ZLevel.Outline;
  var Conflicts = window.ZLevel.Conflicts;
  var Rtid = window.ZLevel.Rtid;

  /**
   * 把三份清单并成一份。按整串 RTID 去重，**同一条的多个出处合并成 wheres**：
   * 「这个引用在 Modules 和第 2 波都烂了」是 1 条、两处出处，跟用户的直觉一致。
   *
   * @param {Array} invalid   字符串数组，parse.js 的窄口径（只在 Modules 上查）
   * @param {Array} dangling  {rtid, alias, reason, where} —— 本文件里找不到
   * @param {Array} notes     {rtid, alias, source, where} —— 参考文件里没有
   */
  function mergeInvalid(invalid, dangling, notes) {
    var out = [];
    var byRtid = Object.create(null);

    function add(rtid, kind, where) {
      if (!rtid) return;
      var hit = byRtid[rtid];
      if (!hit) {
        var info = Rtid.parse(rtid);
        hit = byRtid[rtid] = {
          rtid: rtid,
          alias: info ? info.alias : String(rtid),
          source: info ? info.source : null,
          kind: kind,
          wheres: []
        };
        out.push(hit);
      }
      /* 两边都报同一条时取 missing：它的结论更硬（本文件里就是没有），
       * 而 alias-typo 还留了「说不定是参考数据旧了」的余地。 */
      if (kind === 'missing') hit.kind = 'missing';
      if (where && hit.wheres.indexOf(where) < 0) hit.wheres.push(where);
    }

    (Array.isArray(invalid) ? invalid : []).forEach(function (rtid) {
      var info = Rtid.parse(rtid);
      // findInvalid 只可能报这两种来源，别的一律不进 bad
      add(rtid, (info && info.source === 'CurrentLevel') ? 'missing' : 'alias-typo',
        'LevelDefinition.Modules');
    });
    (Array.isArray(dangling) ? dangling : []).forEach(function (d) {
      if (d) add(d.rtid, 'missing', d.where);
    });
    /* 「参考文件里没有」也在这一遍里进清单 —— 它跟上面两支的区别只是 kind，
     * 在用户眼里都是"这条引用落空了"。 */
    (Array.isArray(notes) ? notes : []).forEach(function (n) {
      if (n) add(n.rtid, 'alias-typo', n.where);
    });
    return out;
  }

  /**
   * @param {Array} objects            解析出来（或没解析出来）的对象表
   * @param {Object} refs              参考数据表，语义见 outline.js 的 build
   * @param {Set} levelModuleAliases   @LevelModules 的别名集合，null = 不判
   */
  function build(objects, refs, levelModuleAliases) {
    var list = Parse.asList(objects);
    var outline = Outline.build(list, refs);

    /* 孤立模块**必须**走 findOrphanedObjects，不能用 outline.orphans.length。
     * computeReachableObjects 在没有 LevelDefinition 时返回的是空 Set，于是
     * Outline.build 会把整份文件的每个对象都判成孤立模块。对象树上没露馅，
     * 只因为 tree.js 在无根时提前 return 了；汇总条在树外面，用错口径就会在
     * 一份没有 LevelDefinition 的文件上打出「N 个孤立模块」的红字。
     * （有根时两者相等：used 的那些对象都在可达集合里。） */
    var orphans = Parse.findOrphanedObjects(list, refs);
    /* 三份清单在这里合成一份。outline.notes 一并进来之后，灰字那一档在报告里
     * 就不存在了 —— 「一件事只出现一次」的落点就在这一句。 */
    var invalidRefs = mergeInvalid(
      Parse.findInvalidLevelModuleReferences(list, levelModuleAliases),
      outline.dangling,
      outline.notes);

    var conflicts = Conflicts.check(list);

    return {
      outline: outline,
      orphans: orphans,          // 对象数组（不是节点数组），给计数用
      invalidRefs: invalidRefs,  // [{rtid, alias, source, kind, wheres}]
      conflicts: conflicts,
      counts: {
        objects: list.length,
        orphans: orphans.length,
        invalidRefs: invalidRefs.length,
        conflicts: conflicts.length
      }
    };
  }

  return { build: build, mergeInvalid: mergeInvalid };
})();
