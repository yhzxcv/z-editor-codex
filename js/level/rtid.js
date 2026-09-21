/* RTID 语句的解析与构造 —— 移植自 Z-Editor 的 data/RtidParser.kt
 *
 * 关卡里所有引用都是 `RTID(别名@来源)` 这一个形状：来源只有两种，
 * LevelModules（系统内置，定义在 reference/LevelModules.json）和
 * CurrentLevel（本关卡文件内联的对象）。别名不是 objclass —— 模块章的
 * code 复制的就是别名，这点跟植物/僵尸章不同。
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
   * 递归收集 JSON 树里所有字符串值中的 RTID 别名（`@` 前部分）。
   * 只认字符串节点；数字/布尔/null 一律跳过。
   */
  function collectAliases(json, out) {
    out = out || [];
    if (json == null) return out;
    if (typeof json === 'string') {
      SCAN_RE.lastIndex = 0;
      var m;
      while ((m = SCAN_RE.exec(json)) !== null) {
        var at = m[1].indexOf('@');
        out.push(at >= 0 ? m[1].slice(0, at) : m[1]);
      }
    } else if (Array.isArray(json)) {
      for (var i = 0; i < json.length; i++) collectAliases(json[i], out);
    } else if (typeof json === 'object') {
      for (var k in json) {
        if (Object.prototype.hasOwnProperty.call(json, k)) collectAliases(json[k], out);
      }
    }
    return out;
  }

  return { parse: parse, build: build, extractAlias: extractAlias, collectAliases: collectAliases };
})();
