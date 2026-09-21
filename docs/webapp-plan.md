# 关卡编辑器网页版 · 方案与交接

> 本文是一次探索会话的结论汇总，供后续在这个仓库里开工时参考。
> 结论来自对 Z-Editor（`E:\code\PVZ2LevelEditor`）的实际代码勘察，不是推测。
> 文中的行数、条目数、文件名均已核对过。

---

## 1. 我们要做什么

把 Z-Editor（Android 关卡编辑器）的**核心能力**做成静态网站，托管在本仓库同一套基础设施上。

**与表单方案的差别**：不走"把 43 个模块属性页逐个重写成表单"的路，而是
**降低界面直观性，让用户直接操作 JSON 代码**，靠三件事提高效率：

1. **模块插入** —— 选模块 → 自动生成 `objdata` 骨架 + 自动挂进 `LevelDefinition.Modules`
2. **模板库** —— 现成的模块实例直接插入，不用手打
3. **键说明** —— 侧边栏/悬停提示当前键的中文含义和取值范围

配套复用本仓库（代码图鉴）的数据层。

---

## 2. 已定决策

| 决策 | 内容 |
|---|---|
| **架构** | **对象树 + 文本编辑器**（左树右文本），不是"一个大文本框" |
| **图鉴集成** | **只复用数据层**（`Codex.add` 契约 + `data/ch-*.js`），UI 另写 |
| **第一步** | 把 Z-Editor 现有模块代码集成补全到图鉴 |
| **`LevelModules.json`** | 大部分用不到，**先不管** |
| **手打 JSON** | 就是要靠"模块插入 + 模板库"做到极致，让用户尽量不用手打 |

**为什么是"树 + 文本"而不是纯文本框**：一个中等关卡有几十到几百个对象，
纯文本滚动找不着北。树本身很便宜（一个列表 + 折叠），却能解决"我在哪、改哪个"
这个最大的可用性问题。点击树节点 → 编辑区滚动并高亮该对象。本质仍是直接操作代码。

---

## 3. 关键发现：你要的"键说明"已经存在，只是锁在 Kotlin 里

这是整件事最重要的发现 —— **不需要重新写文档**，Z-Editor 里已经有：

| 数据源 | 内容 | 量 | 位置 |
|---|---|---|---|
| `PvzDataModels.kt` | **455 个 `@SerializedName` 键名** + 类型 + 默认值 | 141 个 data class | `data/PvzDataModels.kt`（1042 行） |
| EP 字段标签 | 中文名 + 键名 + 值域，如 `"植物等级 (0-5)"`、`"预选植物 (PresetPlantList)"` | 数百处 | `views/editor/pages/module/*.kt` |
| EP 的 `HelpSection` | **结构化中文说明**（title + body） | **179 条**（模块 106 + 事件 73） | 同上 + `pages/event/*.kt` |
| EP 内联提示 | 坑位警告，如"庭院模式下卡槽数量更改无效" | 大量 | 同上 |
| `LevelModules.json` | 361 个真实模块实例 / 138 个 objclass | 622 KB | `assets/reference/LevelModules.json` |
| `PropertySheets.json` | 游戏原始属性表（英文键名，兜底用） | 5.2 MB | `assets/reference/PropertySheets.json` |

**抽取管线**：

```
PvzDataModels.kt   →  键名 / 类型 / 默认值     （脚本 100% 精确）
EP 的 label=       →  中文名 + 值域            （正则抽，人工挂到键上）
EP 的 HelpSection  →  模块级说明               （正则抽，自动）
LevelModules.json  →  真实样例值               （自动）
                     ↓
               key-schema.json
                     ↓
        侧边栏提示 / 自动补全 / 未来的表单生成
```

**注意**：键名与中文标签的对应关系**不是显式的**（标签写 `"植物等级 (0-5)"`，
代码里是 `globalLevel`；标签里括号有时写键名、有时写值域、有时都不写）。
所以**纯自动抽取做不到，必须人工过一遍**。这是本方案唯一的重活，也是最有价值的一次性投入。

**战略要点**：这份 schema 不只喂侧边栏，**它同时是表单生成器的输入**。
一旦 schema 在手，"某个模块的表单"就是白送的 —— UI 从"手写 43 份"变成"生成 43 份"。
所以后续若要补图形界面，是**用自动化拿到表单方案的收益**，边际成本接近零。

---

## 4. 第一步任务：模块代码集成补全到图鉴

### 现状

本仓库现有 5 章：`ch-plant` / `ch-zombie` / `ch-griditem` / `ch-map` / `ch-status`。
其中 **`ch-map.js` 已经覆盖了地图（StageModuleProperties）和小推车**（`rtid: 'LevelModules'`）。

**缺的是"模块代码"和"事件代码"两章** —— 模块属性（`SeedBankProperties` 之类）
和波次事件（`SpawnZombiesJitteredWaveActionProps` 之类）。

### 原料已备好

`docs/registry-raw.json` 是从 Z-Editor 抽出的**原始注册表**，已解析好中文名：

- **59 个模块**，按 Z-Editor 的 `ModuleCategory` 分五类：
  `Base` 9 / `Additional` 12 / `Mode` 14 / `Scene` 19 / `Special` 5
- **26 个事件**，按 `EventCategory` 分三类：
  `Spawn` 12 / `Event` 10 / `Environment` 4

每条字段：`objClass`（游戏代码）、`title`（中文名）、`desc`（中文说明）、
`category`、`defaultAlias`（默认别名）、`defaultSource`（默认来源表）、
`isCore` / `allowMultiple` / `showInSelector`（模块专有）。

**所有字符串已解析，无遗漏。**

### 要做的事

1. **人工整理分组**。原始数据里的 `category` 是 Z-Editor 的内部分类，不一定适合
   图鉴的阅读习惯。参考 `ch-map.js` 的两级结构（大类 `children` → 分组 `items`）。
   建议方向：按"这是什么类型的模块"分（基础 / 场景 / 玩法 / 特殊），组内按用途排。
2. **决定 RTID 表名**。这是关键设计问题，见下。
3. **写 `data/ch-module.js`**（和事件章，或合成一章两分组）。
4. **在 `js/chapters.js` 的 `CODEX_MANIFEST` 里登记**。
5. **跑 `node tools/check.js`**。

### ⚠️ RTID 表名的坑

`data/README.md` 里写得很清楚：`rtid` 字段只影响「复制格式 → RTID语句」这一档，
复制出来是 `"RTID(<code>@<rtid>)"`。**但模块代码的 RTID 语义和植物/僵尸不一样**：

- 植物：`"RTID(peashooter@PlantTypes)"` —— code 是**别名**
- 模块：关卡里形如 `"RTID(SeedBank@CurrentLevel)"` —— code 是**别名**，
  而 `objClass`（`SeedBankProperties`）是对象自己的 `objclass` 字段值

也就是说，**模块章要复制的是别名，不是 objClass**；表名通常是 `CurrentLevel`
（表示"本文件内定义的模块"）。`docs/registry-raw.json` 里的 `defaultAlias` 就是别名来源。

**这个语义差别必须在章节的 `intro` 里跟用户讲清楚**，否则他们会复制错东西。
建议在定下方案后再往 `tools/check.js` 的 `RTID_TABLES` 白名单里加表名。

---

## 5. 后续阶段路线图

| 档 | 内容 | 工期 |
|---|---|---|
| **T1** | 对象树 + 文本编辑（CodeMirror 6）+ 图鉴插入 + 保存下载 | ~11 人日 |
| **T2** | T1 + **键说明侧栏** + 自动补全（键名/枚举值/代码） | ~25 人日 |
| **T3** | T2 + 校验层（孤儿对象 / 悬空引用 / 模块冲突 + 一键修复） | ~32 人日 |
| **T4** | T3 + 由 schema **自动生成表单**，给高频模块配半图形界面 | ~42 人日 |

**T2 里的 schema 抽取是核心任务，应最先做**（预留 5~8 人日），
它一边喂侧边栏，一边决定 T4 表单自动化的上限。

### 校验层可以直接照抄

Z-Editor 里这些是**纯逻辑、零 Android 依赖**，可以近乎逐行翻译成 TS：

| 功能 | 位置 | 行数 |
|---|---|---|
| `RtidParser` | `data/RtidParser.kt` | 32 |
| `ObjectOrderRegistry`（保存时的对象排序） | `data/ObjectOrderRegistry.kt` | 221（**零 import**） |
| `LevelParser` 的 sanitize / 孤儿检测 / 可达性分析 / 引用改名 | `data/LevelParser.kt` | 266 |
| `ModuleConflictRepository`（模块冲突规则） | `data/repository/ModuleConflictRepository.kt` | 67 |

**其中 `ObjectOrderRegistry` 是保存兼容性的红线** —— 不按它排序会写出游戏读起来有问题的文件。
Z-Editor 里已多处踩过"整包重写 objData 吞键"的坑，网页版同样必须**严格保留未建模的键**。

---

## 6. 风险与注意事项

### ⚠️ 1. 目标用户错配（最大的问题）

代码图鉴的目标用户是**国服玩家、手机为主**。而让手机玩家手打 JSON 是酷刑：
软键盘遮挡、无 Tab 键、引号难打、缩进全乱。

叠加"文件读写退化成上传-下载"这个前提，**这个网页版真正的适用场景是 PC**。

**这两个判断是矛盾的，需要定清楚**：
- 若是 PC —— 本方案非常合适
- 若是手机 —— 必须把"模块插入 + 模板库"做到极致（让用户几乎不用手打），
  否则不如不做

### ⚠️ 2. 文本模式会失去自动引用维护

Z-Editor 里改模块别名会自动同步所有引用（如 `renameJitterOffsetsReferences`），
删模块会级联清理（`computeReachableObjects` 前后取差集）。**文本模式下这些全没了**，
用户手改一个别名就会制造一批悬空引用。

缓解：另存时提供"全局替换别名 + 引用同步"的一次性操作，**不要做实时**。

### ⚠️ 3. 校验不能省

纯文本编辑会引入语法正确但语义错误的关卡（模块没被 `Modules` 引用、
RTID 指向不存在的对象、别名重复）。没有校验层，这工具不敢让用户碰真实存档。

### ⚠️ 4. 浏览器存储的边界

即使做"草稿自动保存"，也要知道：站点沙箱里的东西（IndexedDB / localStorage）
**浏览器有权在任何清理时机删掉**，其中 **Safari 的 7 天无互动清空规则**最阴。
**唯一真正的"保存"是让用户下载文件**。工作副本可以放 IndexedDB，
但 UI 上必须明说"请务必下载"。详见 Z-Editor 会话里的分析。

### ⚠️ 5. `代码图鉴.txt` 无备份

402 KB，现在在**本仓库根目录**（已从 Z-Editor 移过来），
但 `git status` 里是未跟踪状态 —— **仍然没有备份**。
它是剩余章节迁移的输入，**丢了就得重新整理**。动手前建议先处理（`git add` 提交，或另存一份）。

---

## 7. 相关路径速查

**本仓库（图鉴站）**
```
data/ch-*.js          数据文件，唯一真源，手工维护
data/README.md        数据格式完整说明（必读）
js/chapters.js        章节清单，加章节要登记
js/codex.js           数据结构规范化 + units 压平
tools/check.js        自检（含 RTID 表名白名单 RTID_TABLES）
docs/registry-raw.json  本次抽取的模块/事件原始注册表
代码图鉴.txt           剩余章节迁移的输入（402 KB，git 未跟踪 = 无备份）
```

**Z-Editor（数据来源，`E:\code\PVZ2LevelEditor`）**
```
app/src/main/java/com/example/z_editor/
  data/PvzDataModels.kt          455 个 @SerializedName 键定义
  data/ModuleDefinitions.kt      59 模块 + 26 事件注册表（本次抽取的来源）
  data/LevelParser.kt            解析 + 校验逻辑
  data/ObjectOrderRegistry.kt    保存排序（零依赖，可直接翻）
  data/repository/               各种参考数据加载
  views/editor/pages/module/*.kt 43 个模块属性页（含 106 条 HelpSection）
  views/editor/pages/event/*.kt  27 个事件属性页（含 73 条 HelpSection）
app/src/main/res/values/strings_modules.xml   125 条模块文案
app/src/main/res/values/strings_events.xml     69 条事件文案
app/src/main/assets/reference/                参考数据 JSON
```

**部署**：Cloudflare Pages，仓库根目录即站点根目录。
**三个坑位配置**：根目录留空 / 框架预设 `None` / **构建命令必须填 `exit 0`** /
**输出目录必须填 `.`**（一个点）。
