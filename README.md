# 关卡编辑器（网页版）

把桌面端 **Z-Editor**（`E:\code\PVZ2LevelEditor`，Kotlin + Compose Desktop）的核心编辑能力
搬到浏览器里的 PvZ2 关卡编辑器。功能和判定逻辑是从那套 Kotlin 源码**逐条搬过来的**，
不是照着界面仿写的 —— 见下面「保真」一节。

纯静态：**没有构建步骤，没有框架，没有运行时依赖**。原生 JS + CSS，双击 `index.html`
就能在 `file://` 下跑起来。部署在 Cloudflare Pages。

> 这个仓库原先是「代码图鉴」静态站。图鉴的**数据层**（`data/ch-*.js`、`js/codex.js`、
> `js/search.js`、拼音表）留下来了，作为编辑器里「图鉴插入」面板的数据源；
> 图鉴那套界面（`js/app.js` + `css/style.css`）已随编辑器上线删除。
> 删除前的完整站点备份在 `E:\code\z-editor-codex-backup-20260921`，打有标签 `codex-site-final`。

## 三层结构

```
js/level/    关卡逻辑层 —— 从 Kotlin 移植，纯函数，不碰 DOM
js/editor/   编辑器界面层
data/        数据：模块注册表、对象骨架、模板、图鉴条目
vendor/      预打包的 CodeMirror 6（见「构建」一节）
```

**逻辑层和界面层是分开的**，这不是洁癖：逻辑层全部是不碰 DOM 的纯函数，
所以 `tools/check-level.js` 里那 174 条断言能在 Node 里直接跑，不用开浏览器。
写界面时踩的坑基本都靠这个分工在提交前拦住了。

### `js/level/` —— 从 Kotlin 移植的逻辑

| 文件 | 对应 Z-Editor 源码 | 干什么 |
|---|---|---|
| `rtid.js` | `Rtid.kt` | `RTID(别名@来源)` 的解析与拼装 |
| `order.js` | `ObjectOrderRegistry.kt` | 130 项加载顺序表 + 自然序比较，决定保存时对象怎么排 |
| `parse.js` | `LevelDataManager.kt` 等 | 可达性分析、孤儿对象、失效引用、别名重命名 |
| `conflicts.js` | `ModuleConflictRegistry.kt` | 11 条模块互斥规则，中文说明照抄 |
| `edit.js` | `LevelEditOperations.kt` 等 | 插入模块/事件、删对象、清孤儿、重命名 |
| `outline.js` | — | 把扁平对象表整理成界面用的对象树（网页版新增，Kotlin 没有对应物） |
| `refs.js` | `ReferenceRepository.kt` | 上游参考文件的运行时入口：来源有没有数据、别名在不在 |

### `js/editor/` —— 界面

| 文件 | 干什么 |
|---|---|
| `state.js` | 文档状态。文本是唯一真源，`objects` 是从文本解析出来的派生表示 |
| `jsonpos.js` | JSON 第一个语法错误在哪 —— **为什么不用引擎报错的见下** |
| `text.js` | CodeMirror 6 的封装：换文档、跳转、主题、语法错误波浪线 |
| `tree.js` | 对象树渲染 |
| `panels.js` | 「插入」「校验」两个侧栏面板 |
| `main.js` | 把上面这些接起来 |

## 保真：网页版跟 Z-Editor 是什么关系

这是整个项目最要紧的一节。桌面版编辑器和网页版**同时存在**，用户会在两边改同一份
关卡文件，所以行为必须对得上，否则文件会在两边来回改动中悄悄变形。

### 文本编辑写的是字节，结构操作才重新序列化

- **手打的字，保存时原样落盘**。编辑器不做「读进来 -> 解析 -> 重新序列化」那一套。
  所以你在文本里留的 `1.0`、属性的原始顺序、缩进，保存后一个字节都不变。
- **结构操作**（插入模块/事件、删对象、清孤儿）必须重新序列化整份 JSON，因为对象顺序
  要按游戏的加载顺序重排。这一步会把数字写法规范化（`1.0` 写成 `1` —— 两者是同一个数，
  不是数据丢失）。

这个区别在界面上是**看得见的**：做过结构操作之后状态栏会出现「已做过结构操作」，
悬停有解释。宁可多一句话，也不要让用户以为保存把文件弄坏了。

### 判定逻辑照抄，一处不落地对着 Kotlin 核

移植时不是「看着像就写」，而是把 Kotlin 源码读出来逐条对照。这样做抓出了 **Z-Editor
自己的两个 bug** —— 网页版没有照着复现，而是**按意图修掉了**，都在代码里留了注释：

1. **坚不可摧不自动打开 ManualStartup**。它判的是
   `meta.defaultAlias == "LastStandMinigame"`，但注册表里
   `LastStandMinigameProperties` 的 `defaultAlias` 是 **`"LastStand"`**，
   全仓库没有任何模块叫 `LastStandMinigame` —— 那个分支从来没执行过。
   网页版改成按 `objClass` 判定。
2. **地底出怪的骨架少了两个字段**。`SpawnZombiesFromGroundSpawnerProps` 的工厂写的是
   `WaveActionData()`（没有列范围），但同一个注册项的 `summaryProvider` 解析的是
   `SpawnZombiesFromGroundData`，后者 `ColumnStart=6` / `ColumnEnd=9` 且非空。
   网页版的骨架按 `summaryProvider` 的形状给。

这两处都不影响网页版读旧文件，只是新插入的对象更符合游戏预期。

### 契约闸：写进去的键名必须真的是游戏认的

移植时我自己犯过一次错：把 `WaveManagerProps` 写成 `waveManagerProps`、
`ManualStartup` 写成 `manualStartup`。**测试全绿** —— 因为实现和断言用的是同一个
错名字，自己跟自己自洽。

所以 `tools/check-level.js` 里加了一道「不信任自己」的闸：结构操作写出来的键名，要拿去
跟**外部真源**对账 —— 骨架文件里的字段、和真实模板文件里的字段。写错名字会被这条拦下。
同类闸门还有 `RTID_TABLES` 白名单（表名写错不会抛错，只会静默复制出错的 RTID）。

### 模板逐字节比对

`data/templates.js` 里 9 份模板是从 Z-Editor 的资源里抽出来的原文。

- **存的文本**与源文件逐字节相同（`data/templates.js` 是生成物，由
  `tools/gen-templates.mjs` 产出；生成时不碰换行符，见脚本里的注释）。
- **解析后再序列化**回来的结果：7 份与原文逐字节相同，1 份只有数字写法差异
  （`1.0` vs `1`，同一个数），1 份因为 Z-Editor 保存时本来就会重排顺序。
  三类差异都有断言钉住，不是「看着差不多」。

### 外部参考文件：`reference/`

关卡的引用是 `RTID(别名@来源)`，来源分两类，**性质完全不同**：

- `@CurrentLevel` —— 对象就在本文件里，找不到才是真出错；
- `@LevelModules`、`@ZombieTypes`、`@PlantTypes`、`@PropertySheets`、
  `@GridItemTypes`、`@ZombieActions` —— **按定义就在别的文件里**。

网页版原先只认本文件，于是把外部引用全判成「找不到引用」：9 份内置模板去重后
153 条引用里有 **71 条是误报**。误报把这一栏彻底变成噪音，真出错时用户已经不看它了。

修法是搬上游那 6 个参考文件（`tools/gen-refs.mjs` 生成 `reference/*.js`，共 7.4 MB），
然后**三分**而不是两分：

| 情况 | 判定 | 界面 |
|---|---|---|
| 有数据 + 别名在 | 引用成立 | 正常 |
| 有数据 + 别名不在 | 可能拼错了 | **灰字提示，不算错误** |
| 没数据 | 不判 | 什么都不显示 |

最后一行是关键：上游资产里出现过的来源有二十来个（`@SkillTypes` 2938 条、
`@ProjectileTypes` 1694 条……），我们没有它们的参考文件。硬判这些来源
就是满屏误报。上游 `ReferenceRepository.getLevelModuleAliases()` 在参考文件
没加载时返回 `null`、调用方直接跳过校验 —— fail-open 是上游明确的设计，这里沿用。

**数据是原样嵌进 JS 的**，不是 `JSON.stringify` 后的字符串：`reference/<Source>.js`
里那段就是上游 JSON 的原文（逐字节未改），直接当对象字面量求值。
这么存是因为它同时是「注入式自定义」的数据源，要能原样取到完整对象图；
仓库里那份字节就是上游那份字节，逐字节对账不用先解码。

代价是**裸字面量有几个经典炸点**：`</script`（HTML 解析器会提前掐断脚本）、`<!--`、
U+2028/U+2029、CRLF、BOM，还有一个最阴的 —— 键名 `__proto__`：对象字面量里它是
**设置原型**，`JSON.parse` 里它是普通自有属性，两者字节相同、求值结果不同，
**逐字节对账发现不了**。上游这 6 个文件今天一个都没踩上，但那是快照的性质、
不是我们能保证的，所以 `gen-refs.mjs` 把这几项**逐条断言**，不合格就报错退出 ——
生成一个会白屏的页面才是最坏的结果。

`js/level/refs.js` 是运行时入口。有一条**很脆的约束**：它排在数据脚本**前面**，
所以必须在**调用时**才读 `window.ZLevel.RefData`，别名集合也必须惰性构建。
写成 `var RefData = window.ZLevel.RefData;` 会让整个功能静默失效 ——
失败方向恰好是「不判」，也就是回到误报更少、但什么都不校验的状态，
页面一切正常、没有任何症状。

## 构建

**唯一的构建步骤是 CodeMirror 6**：

```bash
npm install          # 只在需要重新打包 vendor 时跑
npm run build        # -> vendor/cm6.js（411 KB）
```

CM6 只发 ESM，而 `file://` 下 `<script type="module">` 会被 CORS 拦掉。所以
`tools/cm6-entry.mjs` 作为入口，用 esbuild 打成一个 IIFE 挂到 `window.CM` 上，
「双击 `index.html` 就能跑」这条性质得以保留。

`vendor/cm6.js` **是签入仓库的生成物**：日常改代码不需要 `npm install`，
只有要动 CM6 用到的能力时才重新打包。改了 `tools/cm6-entry.mjs` 一定要重新打包 ——
`tools/check-editor.js` 会拿产物里实际导出的成员名单跟代码里的用法对账，
就是被这个坑坑过一次才加的（见下）。

## 自检

```bash
npm run check        # 三个套件，全绿才算过
```

| 套件 | 断言数 | 查什么 |
|---|---|---|
| `tools/check.js` | 47 | 图鉴数据层：条目结构、RTID 表名白名单、检索 |
| `tools/check-level.js` | 174 | 关卡逻辑层，含上面那道契约闸、模板逐字节比对、外部参考文件的分类与降级 |
| `tools/check-editor.js` | 42 | 界面接线：语法、资源存在、DOM id、样式类、CM 导出对账、错误定位、**按 HTML 顺序真加载一遍** |
| `tools/check-boot.js` | 86 | 整页在无头 DOM 里跑起来并**真的去点**（要 jsdom，`npm run check-boot` 单独跑） |

**套件在任何机器上都能跑完整**，不依赖 Z-Editor 检出：金标准是上游那 9 个内置关卡模板，
但那个路径写死在作者机器上，所以仓库里放了同样 9 份在 `tools/fixtures/templates/`。
有检出时优先用检出（并顺手对一次账，发现上游模板改了而 fixtures 没跟着更新）；
没有就用 fixtures，并在输出里明说用的是哪一份 —— 不静默降级。
`data/templates.js`（生成物）的内容永远拿来跟这一份对账，所以编辑器「新建文档」写出去的
文本始终是被钉住的。

检出不在默认位置的话，用 `Z_EDITOR_REF` 指过去：

```bash
Z_EDITOR_REF=D:/PVZ2LevelEditor npm run check
```

`check-editor.js` 是**没有浏览器时的替代品**。它查的都是「跑起来才发现」的低级错误：
`getElementById` 要的 id 在 HTML 里不存在、`<script>` 指的文件已删、类名写错、
`window.CM` 上根本没有那个方法……最后一类是被坑出来的：曾经把 `CM.setDiagnostics`
写进 `text.js` 而没重新打包 vendor，语法自检全绿、跑起来波浪线就是不出现。
现在它会直接读 `vendor/cm6.js` 末尾那个 `window.CM={...}` 字面量来对账。

它还会把 `jsonpos.js` / `text.js` / `state.js` 塞进 `vm` **真跑一遍**（这三个模块不碰
DOM），逐个字符钉死「手滑时波浪线画在哪、说什么」；最后按 `index.html` 里的**实际顺序**
把所有脚本加载一遍（配一个最小 DOM 桩），抓「依赖还没加载就去读它」。

最后这条值得说一句，因为它第一版是**假的**：原先写的是「加载完之后看
`window.ZLevel.Edit` 在不在」—— 顺序错了也照样绿，因为那时 edit.js 早加载完了，
而 `main.js` 抓到的是它自己那个 `undefined` 快照。改成给命名空间套 `Proxy`、
在**读的那一刻**记账之后才真正管用。验证方式是故意把 `edit.js` 挪到 `main.js`
后面，确认那条断言会红、而另外两条确实瞎。

## 无头整页：`npm run check-boot`

上面那套不管怎么做，都只能证明「文件之间的关系是对的」，证明不了「页面跑起来是对的」。
`tools/check-boot.js` 补这一块：按 `index.html` 的顺序把 32 个脚本注进 jsdom、触发
`DOMContentLoaded`、等 `boot()` 跑完，然后**真的去点** —— 插模块、从对象树删、连撤两次、
打进一个语法错误、切主题。

它一上手就抓到两个「静态检查全绿」的 bug，而且都是**整个页面点谁都没反应**级别：

| 症状 | 真因 |
|---|---|
| 编辑器渲染正常，按钮 hover 有手型，点下去什么都不发生 | `text.js` 里 `themeComp.of(currentTheme())` 在 `var mq = matchMedia(...)` **之前**执行。`var` 提升给的是 `undefined`，`create()` 第一句就抛，`boot()` 当场死掉 —— 于是 `wireTabs` / `wireTopbar` 一次都没跑 |
| 三个面板全是空的（对象树、校验、插入） | `state.js` 的 `emit()` 传出去的是**纯数据记录**，`main.js` 的 `renderStatus` 却调 `s.canUndo()`。它在 `onStateChange` 里排第一，一抛异常后面三个面板全画不出来 |

两个都记在代码注释里了。第一条的教训是**顺序**：`var` 声明在下面不等于用得到；
第二条的教训是**契约**：订阅回调收到的东西上没有方法，要方法得去问 `create()` 返回的对象。

写这套东西本身也踩了两个坑，都值得记：

* **事件监听器里抛的异常不会传回 `dispatchEvent`**（规范规定报到全局错误处理上）。
  所以「用 try/catch 包住 dispatchEvent」根本看不见「点了没反应」的真正原因，
  必须挂 `virtualConsole` 的 `jsdomError` 并把**栈**打出来。
* **第一版是个假绿生成器**：断言失败只往控制台打个 `!!`，退出码只看「有没有抛异常」，
  于是断言全红也照样打印「整页跑通」并 exit 0。现在断言失败计入退出码 —— 这是靠
  变异测试发现的：把 `state.js` 的语法错误守卫拿掉之后，断言确实红了，`$?` 却还是 0。

同一轮变异测试还逼出一条弱断言：「语法错误时插入被拒绝」原来只查**文本没动**，
而**抛异常也是文本没动**。现在改成查用户有没有收到那句提示（`#toast` 里有「语法错误」）
且过程中没有异常。

最后一节是「按钮扫雷」：把三个面板里的按钮逐个点一遍，只问有没有抛异常。
这一节写的过程中连着栽了三跤，每一跤都是同一类错误 —— **测的东西悄悄不存在了**：

* 第一版先收集 `NodeList` 再遍历。面板是整块重建的，点到一半节点全成游离节点，
  点的是旧闭包，等于没点。改成每次现查 DOM。
* 第二版号称「扫了 600 个按钮」，其实空关卡是干净的，校验面板**一个按钮都不渲染**，
  那 600 下是 96 个插入按钮来回点了几轮。要先造出「脏」文档。
* 第三版造了孤儿，但扫雷顺序是「树 → 插入 → 校验」：树那边点 `node-del` 会级联、
  插入那 55 下会把文档改得认不出来，哪个先来孤儿都没了，「清理」按钮跟着消失。

所以现在**覆盖率本身也是断言**：点名要求 `node-go` / `node-del` / `sec-head` /
`ins-group-h` / `ins-main` / `btn-fix` 必须真的被点到。这一步才是关键 ——
前三跤里扫雷都是全绿的。

它**不能**替代人眼：布局、hover、滚动、真实渲染效果都测不出来。jsdom 也没实现
`getClientRects`，所以 CM 的滚动定位那条路走不到底（会以未实现的错误暴露出来）。

## 为什么错误位置是自己扫的

`jsonpos.js` 自己实现了一个 JSON 扫描器，用来定位第一个语法错误。原因是**引擎给的
位置在最常见的两种手滑上根本没有**：

```
{"objects": [}    ->  Unexpected token '}', "{"objects": [}" is not valid JSON
{"objects": [     ->  Unexpected end of JSON input
```

两条都没有 position / line / column —— 而它们恰恰是打字打到一半的样子。直接取引擎
位置的话波浪线永远画在第一行，比不画还误导。而且三个引擎给位置的形式各不相同
（V8 用 `at position N`，Firefox 用 `at line L column C`），要正确解析得写三套。

扫描器只在 `JSON.parse` **失败之后**才跑，正常打字路径上一次都不执行；它给的错误
消息直接就是中文，引擎原文留在横幅的悬停提示里（它是权威，扫描器只是更会指路）。

## 本地预览 / 部署

双击 `index.html` 即可。要起服务器（比如之后加 Service Worker）：

```bash
npm run dev          # python -m http.server 8000
```

Cloudflare Pages：

| 配置项 | 值 |
|---|---|
| 根目录 | 留空（默认就是仓库根） |
| 框架预设 | `None` |
| 构建命令 | `exit 0` |
| 输出目录 | `.` |

**输出目录填 `.`**（一个点）—— CF 默认去 `public` 找产物，而站点就在仓库根，不覆盖会部署出空站；
`./` 会被拒。**构建命令填 `exit 0` 而不是留空** —— 留空时 CF 可能退回默认行为去跑
`npm run build`，那会真去打包 vendor（慢，而且产物已经签入了）。

`_headers` 是唯一的 Cloudflare 专属文件，管缓存与几个安全头，必须在发布根目录。
**缓存必须设成 `max-age=0, must-revalidate`，不能图省事给 `js/` `css/` 配长时间缓存。**
站点没有内容哈希文件名，「部署清缓存」只清了 CF 边缘节点，管不到访客浏览器里已经存下的副本。
踩过的坑：`/js/*` `/css/*` 配了 `max-age=3600` 之后，`index.html` 是新的而 js/css 是旧的，
表现是**新按钮画得出来但点了没反应**——这种「半个新版本」最难排查。

**换平台几乎零成本**：全部是相对路径，整个仓库丢给任何静态托管都能跑，挂子路径下也不用改代码。

## 图鉴数据层（沿用）

`data/ch-*.js` 是图鉴条目的唯一真源，手工维护，格式见 `data/README.md`。
编辑器里的「图鉴插入」面板复用它：搜中文名 / 代码 / 拼音首字母，点一下把代码插到光标处。

复制格式三档（纯代码 / 带引号 / RTID）跟原图鉴站一致，**共用同一个 localStorage 键**
（`zeditor.copyFormat`），所以两边设置是通的。RTID 表名来自数据里的 `rtid` 字段，
不是 UI 里写死的映射表 —— 维持「新增章节不用改 UI」这条约定。拼不出 RTID 时回退成
「带引号」而不是裸代码。

**为什么图鉴数据是 `.js` 而不是 `.json`**：`file://` 下 `fetch` 会被 CORS 拦掉，而 `<script>`
不会。用 `.js` + `Codex.add({...})` 还顺带允许写注释和尾逗号，手工维护友好得多。
`data/modules.js` / `data/templates.js` 同理（两者是生成物，分别由
`tools/gen-modules.mjs` / `tools/gen-templates.mjs` 从 Z-Editor 源码抽）。

## 待办

- **界面从没在浏览器里跑过**。接线自检覆盖了大部分「点了没反应」，但布局、抽屉侧栏、
  树的行内删除按钮、主题切换这些还是纸上推演，需要人工过一遍
- 图鉴插入面板目前只有 5 章（植物 / 僵尸 / 障碍物 / 地图 / 状态）。Z-Editor 那边还有
  模块代码、事件代码两章数据（`docs/registry-raw.json`），没做成 `data/ch-module.js`
- `ChallengeRepository.kt` 是第三个注册表（另有 18 个 `initialDataFactory`），骨架没收录
- 结构操作后可考虑保留「原始字节」用于 diff 提示（现在只是标记「已做过结构操作」）
- Service Worker 离线缓存（需要 https 或 localhost）
- **参考文件是快照**：`reference/*.js` 里的字节等于上游 `assets/reference/*.json`
  在生成那一刻的字节。上游更新后要重跑 `node tools/gen-refs.mjs`，
  并同步 `tools/check-level.js` 里那几个别名数（生成器跑完会把数字打出来）。
  有 Z-Editor 检出时，自检里那条逐字节对账会先提醒你
