/* CodeMirror 6 打包入口
 *
 * 只做一件事：把用得到的 CM6 能力挂到 window.CM 上，供传统 <script> 使用。
 * 之所以要打包，是因为 CM6 只发 ESM —— 而 ES module 在 file:// 下会被 CORS 拦掉，
 * 那正是本站一直用传统 script 的原因（见 docs/design-notes.md「为什么图鉴数据是
 * `.js` 而不是 `.json`」）。
 * 打成一个 IIFE 之后，「双击 index.html 就能跑」这条性质得以保留。
 *
 * 注意 basicSetup 已经包含大部分常用扩展（行号、撤销栈、括号匹配、自动补全、
 * 折叠、搜索键位……），这里只额外补 basicSetup 里没有的：JSON 语言、搜索面板的
 * 程序化开关、lint  gutter、深色主题。
 *
 * ── 撤销/重做那五个为什么要**单独**导出 ──
 * 撤销栈本身是 basicSetup 带的（`history()`），但它的**操作入口**没有暴露出来，
 * 只以键位的形式活在编辑器内部。界面上的「撤销 / 重做」按钮要能驱动它，
 * 还得知道当前能不能撤销（决定按钮显隐）、以及让结构操作自成一步
 * （`isolateHistory`），所以这五个得挂到 window.CM 上。
 *
 * ⚠ 加了导出**必须重跑 `npm run build`**。忘了的话 `CM.isolateHistory` 是
 * undefined，`isolateHistory.of(...)` 会在点「插入」时当场抛异常 ——
 * 而 tools/check-editor.js 会拿 js/ 里的用法跟产物对账，能提前抓到。
 *
 * 构建：node tools/build-vendor.mjs   ->  vendor/cm6.js
 */
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { json } from '@codemirror/lang-json';
import { openSearchPanel, closeSearchPanel, SearchQuery } from '@codemirror/search';
import { lintGutter, linter, setDiagnostics } from '@codemirror/lint';
import { oneDark } from '@codemirror/theme-one-dark';
import { undo, redo, undoDepth, redoDepth, isolateHistory } from '@codemirror/commands';

window.CM = {
  EditorView, EditorState, Compartment, keymap,
  basicSetup, json, oneDark,
  openSearchPanel, closeSearchPanel, SearchQuery,
  lintGutter, linter, setDiagnostics,
  undo, redo, undoDepth, redoDepth, isolateHistory
};
