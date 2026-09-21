/* RTID 语句的解析与构造 —— 移植自 Z-Editor 的 data/RtidParser.kt
 *
 * 关卡里所有引用都是 `RTID(别名@来源)` 这一个形状。别名不是 objclass ——
 * 模块章的 code 复制的就是别名，这点跟植物/僵尸章不同。
 *
 * ── 来源不止两种 ──
 * 原先这里写的是「来源只有 LevelModules 和 CurrentLevel」。不对：
 * 上游资产里出现过的来源有二十来个（@SkillTypes 2938 条、@PropertySheets 2509、
 * @ZombieActions 1876、@ProjectileTypes 1694 …），
 * 其中只有 6 个在 reference/ 下有对应文件（见 js/level/refs.js 的三分口径）。
 * 把来源当成只有两种，正是「外部引用一律报找不到」的根源。
 */
window.ZLevel = window.ZLevel || {};
window.ZLevel.Rtid = (function () {
  'use strict';

  // 与 Kotlin 侧同款：两个分组都贪婪。`RTID(a@b@c)` 会被切成
  // 别名 "a@b" + 来源 "c"（贪婪的第一个 .* 尽量多吃），保持一致。
  var RE = /RTID\((.*)@(.*)\)/;

  /** 解析 RTID(别名@来源)；空串或形状不对返回 null。 */
  function parse(rtid) {
    if (rtid == null || String(rtid).trim() === '') return null;
    var s = String(rtid);
    var m = RE.exec(s);
    if (!m) return null;
    return { alias: m[1], source: m[2], full: s };
  }

  /** 构造标准 RTID 语句。默认来源 LevelModules（与 Kotlin 侧默认值一致）。 */
  function build(alias, source) {
    return 'RTID(' + alias + '@' + (source === undefined ? 'LevelModules' : source) + ')';
  }

  /**
   * 取 `RTID(...)` 内、`@` 前的别名；形状不对时退化成朴素的字符串切分。
   * 移植自 LevelParser.extractAlias —— 那里用的是 substringAfter/substringBefore，
   * 对畸形输入不返回 null 而是切出别的东西，行为要一致。
   */
  function extractAlias(rtid) {
    var s = String(rtid == null ? '' : rtid);
    var afterParen = s.indexOf('(') >= 0 ? s.slice(s.indexOf('(') + 1) : s;
    var at = afterParen.indexOf('@');
    return at >= 0 ? afterParen.slice(0, at) : afterParen;
  }

  /* 遍历 objdata 时用的正则，**故意与上面那个不同**：
   * 要求括号内不含括号（`[^()]+`），比贪婪版更保守 —— 它是在整棵 JSON 树上扫
   * 字符串值用的，宽松匹配容易把普通文本误当引用。移植自
   * LevelParser.computeReachableObjects 里的 rtidRegex。
   */
  var SCAN_RE = /RTID\(([^()]+)\)/g;

  /**
   * 递归收集 JSON 树里所有字符串值中的 RTID 引用，**连来源一起**。
   * 返回 `[{alias, source, full}]`；没有 `@` 的 `RTID(别名)` 其 source 为 null。
   * 只认字符串节点；数字/布尔/null 一律跳过。
   *
   * 切分用的是**第一个** `@`，跟下面的 collectAliases / extractAlias 一致，
   * 而**不是** parse 那个贪婪版。两处口径确实不同：`RTID(a@b@c)` 这里给出
   * 别名 `a` + 来源 `b@c`，parse 给出别名 `a@b` + 来源 `c`。
   *
   * 故意保持这个分歧：nodeOf 要拿它跟 collectAliases 的结果对齐 ——
   * 树的「可展开子节点」和「悬空告警」必须对同一个别名下判断，
   * 否则会出现「能展开、却同时报找不到」这种自相矛盾的显示。
   * 仓库里没有三段式 RTID（全仓库扫过），parse 那边也只有 Modules 一条路径在用，
   * 所以这个分歧落不到实际数据上。真要统一，得两边一起改并重定断言。
   */
  function collectRefs(json, out) {
    out = out || [];
    if (json == null) return out;
    if (typeof json === 'string') {
      SCAN_RE.lastIndex = 0;              // 带 /g 的共享正则，不重置会从上次的位置接着扫
      var m;
      while ((m = SCAN_RE.exec(json)) !== null) {
        var at = m[1].indexOf('@');
        out.push(at >= 0
          ? { alias: m[1].slice(0, at), source: m[1].slice(at + 1), full: m[0] }
          : { alias: m[1], source: null, full: m[0] });
      }
    } else if (Array.isArray(json)) {
      for (var i = 0; i < json.length; i++) collectRefs(json[i], out);
    } else if (typeof json === 'object') {
      for (var k in json) {
        if (Object.prototype.hasOwnProperty.call(json, k)) collectRefs(json[k], out);
      }
    }
    return out;
  }

  /**
   * 只要别名，不要来源 —— 老契约，别名与顺序跟 collectRefs 完全一致。
   * 保留它是因为 parse.js 的可达性分析和自检里有一批断言直接依赖这个形状。
   */
  function collectAliases(json, out) {
    out = out || [];
    collectRefs(json, []).forEach(function (r) { out.push(r.alias); });
    return out;
  }

  return {
    parse: parse,
    build: build,
    extractAlias: extractAlias,
    collectAliases: collectAliases,
    collectRefs: collectRefs
  };
})();
