/* 文本里每个对象占哪一段 —— 点对象树上的一行时，光标该落到哪儿
 *
 * ── 为什么不能按名字搜 ──
 * 原先的跳转是 `text.indexOf('"' + 别名 + '"')`（找不到再来一遍不带引号的），
 * 找的是**第一次出现**。可这个名字在文件里往往不是先以"那个对象的身份"出现的：
 *
 *   "Name": "WidgetProps"                      别的对象里一个**值**恰好叫这个
 *   "PlantType": "..."                         一个**键名**恰好叫这个
 *   "Modules": ["WidgetProps@CurrentLevel"]   一条引用（不带引号那一搜必定中招）
 *
 * 于是点「WidgetProps」跳过去，落在的是别处的一个字符串上，不是那个对象自己。
 * 落在哪儿取决于这个名字有多常见 —— 那是碰运气，不是逻辑。
 *
 * ── 所以按结构定位 ──
 * 调用方拿得到对象**实例**（大纲节点上的 obj），而解析出来的 objects 数组的顺序
 * 就是文本里的顺序（解析不重排）。那么只要知道第 i 个元素从哪个字符开始、到哪儿
 * 结束，就能精确选中它 —— 名字在文件里重复多少次都不影响。
 *
 * 这是个只认形状的扫描器，不是完整的 JSON 解析器：它只在根对象里找 `"objects"`
 * 那个数组，把那一段里每个元素的区间记下来。字符串里的 { } [ ] 不参与计数，
 * 转义更不能看漏 —— 后者是这类扫描器最经典的一个错（`"a\""` 里那个转了义的
 * 引号不是收尾的引号）。
 *
 * 扫不出形状就返回 null，调用方退回按名字搜：宁可跳得糙，也不能不跳。
 *
 * 它跟 JSON.parse 的关系由 tools/check-level.js 的「对象区间」一节钉着：9 份模板
 * 逐个元素比 `JSON.parse(文本.slice(区间))` 是不是正好等于解析出来的那个对象 ——
 * 一边是我的扫描器、一边是引擎，不是自己跟自己比。

 * 曾经还有一个导出的 keyRange（"插入之后把光标送到某个键的值上"）。它随那个功能
 * 一起删了：2026-09-22 用户点名去掉「插完光标落到这个键」，落点只剩整个新对象。
 * 它当时**一条断言都没有**，留着就是一段看着能用、没人验过的代码。
 */
window.ZLevel = window.ZLevel || {};
window.ZLevel.Spans = (function () {
  'use strict';

  /** JSON 允许的空白（跟 jsonpos.js 同一个口径）。 */
  var WS = ' \t\n\r';

  /**
   * 一个只认形状的扫描器。`text[start]` 是它起步的位置，`s.i` 是它现在的下标。
   *
   * 抽成一个工厂是为了让「找 objects 数组」和「找某个键」共用同一份 —— 转义、
   * 括号配对、标量吃到哪儿为止，这些坑只该踩一次。原先这些函数是 objectRanges
   * 内部的闭包，加第二条用途时复刻一份就等于把 bug 也复刻一份。
   *
   * `s.ok` 扫到说不通的地方就置 false（没闭合的括号、空的标量……），由各层往上带。
   */
  function scan(text, start) {
    var n = text.length;
    var s = { i: start, ok: true };

    s.ws = function () { while (s.i < n && WS.indexOf(text.charAt(s.i)) >= 0) s.i++; };

    /** 从开头的 " 扫到收尾的 "，返回收尾引号**之后**的下标。 */
    s.str = function () {
      s.i++;                                       // 开头的 "
      while (s.i < n) {
        var c = text.charAt(s.i);
        if (c === '\\') { s.i += 2; continue; }    // 转义后的那个字符一律不当结构看
        s.i++;
        if (c === '"') return s.i;
      }
      s.ok = false;
      return -1;
    };

    /** 跳过一整个值（标量 / 字符串 / 数组 / 对象）。 */
    s.skip = function () {
      s.ws();
      if (s.i >= n) { s.ok = false; return; }
      var c = text.charAt(s.i);
      if (c === '"') { s.str(); return; }
      if (c === '[' || c === '{') {
        var depth = 0;
        while (s.i < n) {
          var d = text.charAt(s.i);
          if (d === '"') { if (s.str() < 0) return; continue; }
          if (d === '[' || d === '{') { depth++; s.i++; continue; }
          if (d === ']' || d === '}') {
            depth--;
            s.i++;
            if (depth === 0) return;
            continue;
          }
          s.i++;
        }
        s.ok = false;                              // 括号没闭合
        return;
      }
      // 数字 / true / false / null：一路吃到分隔符
      var from = s.i;
      while (s.i < n && ',:]}[{ \t\n\r'.indexOf(text.charAt(s.i)) < 0) s.i++;
      if (s.i === from) s.ok = false;
    };

    /** 数组里每个元素的区间。进来时 text[i] === '['。 */
    s.elements = function () {
      var out = [];
      s.i++;                                       // [
      s.ws();
      if (text.charAt(s.i) === ']') { s.i++; return out; }
      for (;;) {
        s.ws();
        var from = s.i;
        s.skip();
        if (!s.ok) return null;
        out.push({ from: from, to: s.i });
        s.ws();
        var c = text.charAt(s.i);
        if (c === ',') { s.i++; continue; }
        if (c === ']') { s.i++; return out; }
        s.ok = false;
        return null;
      }
    };

    /**
     * 从 `"` 扫到收尾，返回**键名**（去掉两端引号）。
     *
     * 没有转义时直接切字符串；有转义（`A` 这种）才交给 JSON.parse —— 那才是
     * 唯一能把 `"A"` 和 `"A"` 判成同一个键的办法。不这么做的话这两种写法在
     * 文本里对不上，表现是"明明有这个键却找不到"。认不出返回 null。
     */
    s.key = function () {
      var from = s.i;
      s.str();
      if (!s.ok) return null;
      var inner = text.slice(from + 1, s.i - 1);
      if (inner.indexOf('\\') < 0) return inner;
      try { return JSON.parse(text.slice(from, s.i)); } catch (e) { return null; }
    };

    return s;
  }

  /**
   * 每个顶层对象的区间。返回 [{from, to}]（to 不含），对象的**顺序与 objects 数组一致**。
   * 根既可以是 `{"objects": [...]}`，也可以是裸数组；认不出来返回 null。
   */
  function objectRanges(text) {
    if (typeof text !== 'string' || !text) return null;
    var s = scan(text, 0);

    s.ws();
    if (text.charAt(s.i) === '[') return s.elements();      // 根就是个数组
    if (text.charAt(s.i) !== '{') return null;

    // 根对象：逐个成员找键名恰为 objects 的那个（objdata 那类是**值**，
    // skip 整段跳过去，里面的键名不参与比较 —— 这也是不能拿正则去猜的原因）
    s.i++;
    for (;;) {
      s.ws();
      if (text.charAt(s.i) !== '"') return null;
      var key = s.key();
      if (!s.ok) return null;
      s.ws();
      if (text.charAt(s.i) !== ':') return null;
      s.i++;
      s.ws();
      if (key === 'objects') {
        if (text.charAt(s.i) !== '[') return null;          // 形状不对：交给上层退回按名字搜
        return s.elements();
      }
      s.skip();
      if (!s.ok) return null;
      s.ws();
      if (text.charAt(s.i) === ',') { s.i++; continue; }
      return null;                                          // } 或者别的什么：到此为止
    }
  }

  return { objectRanges: objectRanges };
})();
