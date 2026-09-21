/* 在 JSON 文本里找出第一个语法错误的位置
 *
 * ── 为什么不用引擎给的报错位置 ──
 * 因为最常犯的那两种手滑，引擎根本不给位置：
 *
 *   {"objects": [}      ->  Unexpected token '}', "{"objects": [}" is not valid JSON
 *   {"objects": [       ->  Unexpected end of JSON input
 *
 * 这两条都没有 position / line / column。而它们恰恰是打字打到一半的样子。
 * 直接取引擎位置的话，波浪线永远画在第一行 —— 比不画还误导。
 *
 * 而且三个引擎给位置的形式还不一样（V8 用 "at position N"，Firefox 用
 * "at line L column C"，V8 新版两种都给），要正确解析得写三套。不如自己扫。
 *
 * ── 代价 ──
 * 只在 JSON.parse **失败之后**才跑，正常打字路径上一次都不执行。
 * 扫描器也不追求完全等价于 JSON.parse 的严格度，它只要求：能报出
 * 「第一个说不通的地方在哪、为什么」。
 *
 * 扫描器说文本没问题时返回 null —— 正常不会发生（只有 parse 失败才会调这里），
 * 调用方那时退回引擎的说法。
 */
window.ZEditor = window.ZEditor || {};
window.ZEditor.JsonPos = (function () {
  'use strict';

  /** JSON 允许的空白只有这四个（不许有全角空格、BOM）。 */
  var WS = /[ \t\n\r]/;
  /** 数字、字母、下划线：判断"这个词是不是拼错的 true/false/null"。 */
  var WORD = /[0-9A-Za-z_$]/;

  function scan(text) {
    var i = 0;
    var n = text.length;

    function fail(pos, msg) { return { pos: pos, message: msg }; }

    function skipWs() { while (i < n && WS.test(text.charAt(i))) i++; }

    /** 当前位置的字符，用来拼"却遇到了 X"。 */
    function at() {
      return i >= n ? '结尾' : '「' + text.charAt(i) + '」';
    }

    /** 尝试匹配关键字（true/false/null）。匹配上才前进。 */
    function lit(word) {
      if (text.slice(i, i + word.length) === word) { i += word.length; return true; }
      return false;
    }

    function isDigit(c) { return c >= '0' && c <= '9'; }

    // ── 字符串 ──
    function str() {
      i++;                                    // 开头的 "
      for (;;) {
        if (i >= n) return fail(n, '这个字符串少了收尾的双引号');
        var c = text.charAt(i);
        if (c === '"') { i++; return null; }
        if (c === '\\') {
          i++;
          if (i >= n) return fail(n, '转义符 \\ 后面什么都没有');
          var e = text.charAt(i);
          if ('"\\/bfnrt'.indexOf(e) < 0 && e !== 'u') {
            return fail(i, '「\\' + e + '」不是有效的转义');
          }
          if (e === 'u') {
            if (!/^[0-9a-fA-F]{4}$/.test(text.substr(i + 1, 4))) {
              return fail(i, '\\u 后面要跟 4 位十六进制数');
            }
            i += 4;
          }
          i++;
          continue;
        }
        if (text.charCodeAt(i) < 0x20) {
          return fail(i, '字符串里不能直接换行或打制表符，要写成 \\n、\\t');
        }
        i++;
      }
    }

    // ── 数字 ──
    function num() {
      var start = i;
      if (text.charAt(i) === '-') i++;
      if (text.charAt(i) === '0') {
        i++;
      } else if (isDigit(text.charAt(i))) {
        while (isDigit(text.charAt(i))) i++;
      } else {
        return fail(start, '「-」后面要跟数字');
      }
      if (text.charAt(i) === '.') {
        i++;
        if (!isDigit(text.charAt(i))) return fail(i, '小数点后面要有数字');
        while (isDigit(text.charAt(i))) i++;
      }
      if (text.charAt(i) === 'e' || text.charAt(i) === 'E') {
        i++;
        if (text.charAt(i) === '+' || text.charAt(i) === '-') i++;
        if (!isDigit(text.charAt(i))) return fail(i, '指数 e 后面要有数字');
        while (isDigit(text.charAt(i))) i++;
      }
      return null;
    }

    // ── 值 ──
    function value() {
      skipWs();
      if (i >= n) return fail(n, '内容在这里就断了：少了一个值');
      var c = text.charAt(i);
      if (c === '{') return obj();
      if (c === '[') return arr();
      if (c === '"') return str();
      if (c === '-' || isDigit(c)) return num();
      if (lit('true') || lit('false') || lit('null')) return null;
      // 拼错的关键字单独说一句，比"应该是一个值"有用得多
      if (WORD.test(c)) {
        var j = i;
        while (j < n && WORD.test(text.charAt(j))) j++;
        return fail(i, '「' + text.slice(i, j) + '」要加双引号才是一个字符串；' +
          '如果你想要的是 true / false / null，拼写要完全一致');
      }
      return fail(i, '这里应该是一个值，却遇到了 ' + at());
    }

    // ── 对象 ──
    function obj() {
      i++;                                    // {
      skipWs();
      if (text.charAt(i) === '}') { i++; return null; }
      for (;;) {
        skipWs();
        if (i >= n) return fail(n, '这个对象没有收尾的 }');
        if (text.charAt(i) !== '"') {
          return fail(i, text.charAt(i) === '}'
            ? '这里多了一个逗号（对象最后一项后面不能有逗号）'
            : '对象的属性名必须用双引号包起来，却遇到了 ' + at());
        }
        var e = str();
        if (e) return e;
        skipWs();
        if (text.charAt(i) !== ':') {
          return fail(i, '属性名后面要跟一个冒号，却遇到了 ' + at());
        }
        i++;
        e = value();
        if (e) return e;
        skipWs();
        var c = text.charAt(i);
        if (c === ',') { i++; continue; }
        if (c === '}') { i++; return null; }
        if (i >= n) return fail(n, '这个对象没有收尾的 }');
        return fail(i, '这一项写完了，后面应该跟 , 或者 }，却遇到了 ' + at());
      }
    }

    // ── 数组 ──
    function arr() {
      i++;                                    // [
      skipWs();
      if (text.charAt(i) === ']') { i++; return null; }
      for (;;) {
        // 先看是不是压根没写内容：只写了个 "[" 时，说"数组没有收尾的 ]"
        // 比说"少了一个值"有用（后者听着像用户漏了某个值，其实整个数组就空的）
        skipWs();
        if (i >= n) return fail(n, '这个数组没有收尾的 ]');
        var e = value();
        if (e) return e;
        skipWs();
        var c = text.charAt(i);
        if (c === ',') {
          i++;
          skipWs();
          if (text.charAt(i) === ']') {
            return fail(i, '这里多了一个逗号（数组最后一项后面不能有逗号）');
          }
          continue;
        }
        if (c === ']') { i++; return null; }
        if (i >= n) return fail(n, '这个数组没有收尾的 ]');
        return fail(i, '这一项写完了，后面应该跟 , 或者 ]，却遇到了 ' + at());
      }
    }

    var err = value();
    if (err) return err;
    skipWs();
    if (i < n) return fail(i, 'JSON 到这里就该结束了，后面还有多余的内容');
    return null;
  }

  return { scan: scan };
})();
