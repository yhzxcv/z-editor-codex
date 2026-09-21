/* 把 CodeMirror 6 打成一份 IIFE：vendor/cm6.js
 *
 * 用法：node tools/build-vendor.mjs
 *
 * 产物是**生成物，勿手改**（跟 js/pinyin-table.js 一个性质），但它**要提交进仓库**：
 * 站点没有常规构建步骤，克隆下来双击 index.html 就该能跑。只有升级 CM6 版本时
 * 才需要重跑本脚本。
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vendor', 'cm6.js');

const result = await build({
  entryPoints: [join(ROOT, 'tools', 'cm6-entry.mjs')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  outfile: OUT,
  metafile: true
});

// 产物头部加一行说明，免得后来人以为这是手写文件
const banner = '/* 生成物，勿手改 —— 由 `npm run build`（tools/build-vendor.mjs）从 CodeMirror 6 打包而来。*/\n';
writeFileSync(OUT, banner + readFileSync(OUT, 'utf8'));

const kb = (statSync(OUT).size / 1024).toFixed(1);
console.log(`vendor/cm6.js  ${kb} KB`);
