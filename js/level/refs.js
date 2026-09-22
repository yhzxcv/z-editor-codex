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

  return { has: has, aliases: aliases, objectsOf: objectsOf, knownSources: knownSources };
})();
