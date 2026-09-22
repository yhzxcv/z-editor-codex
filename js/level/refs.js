/* 外部参考文件的运行时入口 —— `RTID(别名@来源)` 里「别的文件」那一半
 *
 * 关卡的引用分两类：`@CurrentLevel` 的对象就在本文件里，找不到才是真出错；
 * 其余来源（`@LevelModules`、`@ZombieTypes`、`@PropertySheets`…）**按定义就在
 * 别的文件里**，本文件找不到是正常的。本站原先只认本文件，于是把这两类混为
 * 一谈，满屏「找不到引用」。
 *
 * ── 三分，不是两分 ──
 * 仓库里带了 6 个参考文件（reference/*.js，tools/gen-refs.mjs 生成），
 * 但上游资产里出现过的来源有二十来个（`@SkillTypes` 2938 条、`@ProjectileTypes`
 * 1694 条、`@ArmorTypes`、`@ResilienceConfig`…），那些**我们没有数据**。
 * 所以必须区分三种，而不是「有/没有这个别名」两种：
 *
 *   有数据 + 别名在    引用成立
 *   有数据 + 别名不在  可能是拼错了 -> 失效引用（alias-typo 档，见 report.js）
 *   没数据             不判
 *
 * 最后那条是关键。上游 ReferenceRepository.getLevelModuleAliases() 在参考文件
 * 没加载时返回 null，调用方 LevelParser 直接跳过校验 —— fail-open 是上游明确的
 * 设计，为的就是别满屏误报。硬判我们没数据的来源，就是把上游躲开的坑再踩一遍。
 *
 * ── 为什么必须惰性 ──
 * 别名集合**首次访问时**才建、建完缓存。两个原因，都不是优化问题：
 * 1. 参考数据一共 7.4 MB，PropertySheets 一个就 1976 个对象；而 Outline.build
 *    挂在每一次 state 变化上（js/editor/main.js），按键走一遍是要命的。
 * 2. 本模块排在 js/level/parse.js **之前**，而数据脚本排在它之后。
 *    加载时就建集合会读到空数据。所以 window.ZLevel.RefData 只能**在调用时**读。
 *    这条很脆：写成 `var RefData = window.ZLevel.RefData;` 会让整个功能静默失效
 *    而没有任何症状（失败方向是"不判"，也就是回到误报更少但也不报错的状态）。
 *    tools/check-editor.js 的早读探测器专门盯这个。
 */
window.ZLevel = window.ZLevel || {};
window.ZLevel.Refs = (function () {
  'use strict';

  /** 来源 -> 首别名 Set。**只放有数据的来源** —— 缺键 = 没数据，与"空集"区分开。 */
  var cache = Object.create(null);

  function refData() { return window.ZLevel.RefData || null; }

  /** 该来源的对象列表；没有数据返回 null（不是空数组）。 */
  function objectsOf(source) {
    var doc = refData() && refData()[source];
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.objects)) return null;
    return doc.objects;
  }

  /** 这个来源我们有数据吗。 */
  function has(source) {
    return objectsOf(source) !== null;
  }

  /**
   * 该来源里的**首别名**集合；没数据的来源返回 null。
   *
   * 只认首别名，与 Kotlin 侧一致（ReferenceRepository 用的是
   * `associateBy { it.aliases.firstOrNull() }`）。参考文件里同一别名可能重复
   * （LevelModules 361 条 -> 356 个唯一首别名），Set 去重正好。
   *
   * 调用方拿到 null 必须当**「不判」**，不能当「空集」—— 当成空集就变成
   * 「这个来源里什么都没有」，于是全判失效。
   *
   * 注意缓存与「没数据」的分工：本函数**可能**返回一个缓存下来的集合，
   * 哪怕此刻数据已经不在了；而 has() 每次都重新读数据。两者不一致是**有意的**，
   * 因为判分类的入口是 has()（见 js/level/parse.js 的 classifyRef）——
   * 也就是「用不用这份数据」始终按**当下**的加载状态决定，
   * 缓存里的旧集合不会让 fail-open 失效。别把 has() 也改成读缓存。
   */
  function aliases(source) {
    var hit = cache[source];
    if (hit) return hit;
    var objs = objectsOf(source);
    if (objs === null) return null;          // 不进缓存：没数据不是可缓存的结果
    var set = new Set();
    objs.forEach(function (o) {
      var a = o && o.aliases;
      /* 不是每条都取得到别名。参考文件里混着「用 JSON 键当注释行」的伪对象
       * （GridItemTypes.json 的 objects[0] 就是 `{"####### ... ########":0}`），
       * 也有整个缺 aliases 的真条目（GridItemTypes 48 条、PropertySheets 46 条）。
       * 直接取 [0] 会把 undefined 塞进集合。 */
      if (Array.isArray(a) && a.length && typeof a[0] === 'string') set.add(a[0]);
    });
    cache[source] = set;
    return set;
  }

  /** 我们有数据的来源，排序后返回。给自检和界面提示用。 */
  function knownSources() {
    var d = refData();
    return d ? Object.keys(d).sort() : [];
  }

  /**
   * 这个别名在这个来源里是**哪个类**的对象。查不到（没数据 / 没这个别名）返回 null。
   *
   * 匹配的是 aliases 里**任意一个**，比 aliases() / classifyRef 的"只认首别名"宽 ——
   * 两边口径不一致是**有意的**：这里的回答是"这一行指的是个什么东西"（显示用），
   * 查不到最坏也就是退成显示别名，不会污染任何判定。判"这条引用成不成立"仍然只走
   * classifyRef，别拿本函数去当那个判据。
   *
   * 眼下这一宽一窄其实落在同一批名字上：参考数据里 4706 个对象**没有一个**带两个以上
   * 别名（2026-09-22 六个文件全查过），所以"任意一个"就是"唯一那个"。放宽是为了以后
   * 真出现多别名时那一行仍然显示得出来，不是眼下有什么名字在靠它。
   *
   * 传对象列表的那一份（classOfAliasIn）是给 outline.js 用的 —— 它那份 refs 参数有
   * "明确传 null = 一律不查"的语义（见 js/level/outline.js 的 build），所以它得自己
   * 决定要不要查、查哪张表。判据只该有一处实现，所以查本身还是这一份。
   */
  function classOfAliasIn(objs, alias) {
    if (!Array.isArray(objs)) return null;
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      if (o && Array.isArray(o.aliases) && o.aliases.indexOf(alias) >= 0) {
        return (typeof o.objclass === 'string' && o.objclass) ? o.objclass : null;
      }
    }
    return null;
  }

  /** classOfAliasIn 的取数版：自己去这个来源的对象列表。 */
  function classOfAlias(source, alias) {
    return classOfAliasIn(objectsOf(source), alias);
  }

  /**
   * 这个来源里、这个类的对象**能用的代号**有哪些（去重、排序）。没数据的来源返回 null。
   *
   * 给"引用型模块换一个指向"那一格用：`RTID(代号@LevelModules)` 里那个代号必须是参考
   * 文件里**已经存在**的一个名字，编辑器能做的只是让他从这些里挑一个，不能让他现编。
   *
   * **只收首别名**，跟 aliases() 同一把尺子 —— 不是随手挑的：判引用成不成立的
   * Parse.classifyRef 只认首别名，列一条非首别名出来，用户选完那条引用当场被判成
   * 「参考文件里没有」，对象树上多一条失效引用。**能给用户挑的集合，必须正好是判据认的
   * 集合。**（眼下每个对象只有一个别名，所以"首别名"就是"那个别名"；跟着 aliases() 走
   * 是为了这条口径只有一处。）
   *
   * 去重是必须的：**同一个别名会被好几个对象用**（LevelModules 361 条 -> 356 个唯一
   * 首别名，5 个重名），不去重的话下拉里会出现两条一模一样的选项，而"选了哪条"变成随机。
   *
   * 类的判据是 objclass 全等：参考文件里每个对象的形状跟关卡对象一样
   * （objclass / aliases / objdata），同一类的变体是**各自独立的对象**
   * （LevelModules 里 24 种小推车就是 24 条，每条 aliases 只有一个名字）。
   */
  function aliasesOfClass(source, objClass) {
    var objs = objectsOf(source);
    if (objs === null) return null;      // 没数据 ≠ 空集，跟 aliases() 同一条
    var seen = Object.create(null), out = [];
    objs.forEach(function (o) {
      if (!o || o.objclass !== objClass) return;
      var a = o.aliases;
      if (!Array.isArray(a) || !a.length || typeof a[0] !== 'string') return;
      if (seen[a[0]]) return;
      seen[a[0]] = true;
      out.push(a[0]);
    });
    return out.sort();
  }

  return {
    has: has, aliases: aliases, objectsOf: objectsOf, knownSources: knownSources,
    classOfAlias: classOfAlias, classOfAliasIn: classOfAliasIn,
    aliasesOfClass: aliasesOfClass
  };
})();
