/* CodeMirror 6 打包入口
 *
 * 只做一件事：把用得到的 CM6 能力挂到 window.CM 上，供传统 <script> 使用。
 * 之所以要打包，是因为 CM6 只发 ESM —— 而 ES module 在 file:// 下会被 CORS 拦掉，
 * 那正是本站一直用传统 script 的原因（见 README「为什么数据是 .js 而不是 .json」）。
 * 打成一个 IIFE 之后，「双击 index.html 就能跑」这条性质得以保留。
 *
 * 注意 basicSetup 已经包含大部分常用扩展（行号、撤销栈、括号匹配、自动补全、
 * 折叠、搜索键位……），这里只额外补 basicSetup 里没有的：JSON 语言、搜索面板的
 * 程序化开关、lint  gutter、深色主题。
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

window.CM = {
  EditorView, EditorState, Compartment, keymap,
  basicSetup, json, oneDark,
  openSearchPanel, closeSearchPanel, SearchQuery,
  lintGutter, linter, setDiagnostics
};
