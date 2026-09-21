/* 从 docs/registry-raw.json 生成 data/modules.js（编辑器「模块插入」面板的注册表）。
 *
 * 用法：node tools/gen-modules.mjs
 *
 * 只在 registry-raw.json 变化时才需要重跑。**重跑会覆盖人工改过的分组说明和顺序**，
 * 所以正常维护请直接编辑 data/modules.js。脚本保留在这里是为了留个出处，
 * 以及将来要重新分类时有个起点。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(readFileSync(join(ROOT, 'docs', 'registry-raw.json'), 'utf8'));

// 分类沿用 Z-Editor 的 ModuleCategory / EventCategory，只换中文名并补组说明。
const MOD_GROUPS = [
  ['Base', '基础模块', '每个关卡几乎都要有的：波次、种子库、阳光、小推车、胜负判定'],
  ['Additional', '增强模块', '在基础之上叠加规则：阳光上限、初始能量豆、通货膨胀、加速进场……'],
  ['Mode', '玩法模式', '整关换一种玩法：砸罐子、我是僵尸、坚不可摧、种子雨、保龄球……'],
  ['Scene', '场景设施', '往地图上放东西：预置植物/僵尸/障碍物、矿车轨道、能量瓷砖、屋顶、潮水……'],
  ['Special', '特殊模块', '单个关卡的专属机制：金手指、复兴雕像、月球基地……'],
];
const EV_GROUPS = [
  ['Spawn', '出怪事件', '往某一波里塞僵尸：普通出怪、地底出怪、蹦极投放、空降……'],
  ['Event', '玩法事件', '改变关卡状态：潮水变更、传送带变更、恐龙召唤、雷暴、黑洞……'],
  ['Environment', '环境事件', '火箭降落、投放药水、生成墓碑、魔镜传送'],
];

/** 单引号字符串转义。 */
const q = s => "'" + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

function modItem(m) {
  const flags = [];
  if (m.isCore) flags.push('isCore: true');
  if (m.allowMultiple) flags.push('allowMultiple: true');
  if (m.showInSelector === false) flags.push('showInSelector: false');
  return [
    `      { objClass: ${q(m.objClass)}, title: ${q(m.title)}`,
    `        , defaultAlias: ${q(m.defaultAlias)}, defaultSource: ${q(m.defaultSource)}`,
    `        , desc: ${q(m.desc)}`,
    flags.length ? `        , ${flags.join(', ')}` : null,
    `      }`
  ].filter(Boolean).join('\n');
}

function evItem(e) {
  const extra = (e.defaultObjClass && e.defaultObjClass !== e.objClass)
    ? `, defaultObjClass: ${q(e.defaultObjClass)}` : '';
  return `      { objClass: ${q(e.objClass)}, title: ${q(e.title)}, defaultAlias: ${q(e.defaultAlias)}${extra}, desc: ${q(e.desc)} }`;
}

const HEADER = `/* 模块 / 事件注册表 —— 供编辑器的「模块插入」面板使用。
 *
 * 来源：docs/registry-raw.json（从 Z-Editor 的 data/ModuleDefinitions.kt 抽出）。
 * 分类沿用 Z-Editor 的 ModuleCategory / EventCategory，只把名字换成中文、补了组说明。
 * 因此这是**半自动产物**：结构可以重新生成，但组说明和分组顺序是人工定的，
 * 重跑 tools/gen-modules.mjs 会覆盖掉。要改分组请直接编辑本文件。
 *
 * 字段含义：
 *   objClass       对象自己的 objclass 字段值（不是别名！模块章复制的是别名）
 *   defaultAlias   插入时的默认别名，也是 RTID(...@...) 里那个
 *   defaultSource  CurrentLevel = 对象写进本文件；LevelModules = 只挂一个引用，不建对象
 *   isCore         核心模块，Z-Editor 的选择器里会标出来
 *   allowMultiple  允许同一关卡里存在多个（否则重复插入会被拒绝）
 *   showInSelector false 表示 Z-Editor 默认不展示（追击主题配置），这里照样保留
 *
 * objdata 的初始值不在这里，在 data/module-skeletons.js（按 objClass 查）。
 */
window.ZLevel = window.ZLevel || {};
window.ZLevel.Modules = {
  moduleGroups: [
`;

let out = HEADER;
MOD_GROUPS.forEach(([cat, title, note], gi) => {
  const items = raw.modules.filter(m => m.category === cat);
  out += `    { title: ${q(title)}, note: ${q(note)}, items: [\n`;
  out += items.map(modItem).join(',\n');
  out += `\n    ] }${gi < MOD_GROUPS.length - 1 ? ',' : ''}\n`;
});
out += `  ],\n\n  eventGroups: [\n`;
EV_GROUPS.forEach(([cat, title, note], gi) => {
  const items = raw.events.filter(e => e.category === cat);
  out += `    { title: ${q(title)}, note: ${q(note)}, items: [\n`;
  out += items.map(evItem).join(',\n');
  out += `\n    ] }${gi < EV_GROUPS.length - 1 ? ',' : ''}\n`;
});
out += `  ]\n};\n`;

writeFileSync(join(ROOT, 'data', 'modules.js'), out);
console.log(`data/modules.js  ${(Buffer.byteLength(out) / 1024).toFixed(1)} KB  ` +
  `模块 ${raw.modules.length} / 事件 ${raw.events.length}`);
