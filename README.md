# 代码图鉴（静态站）

给 PvZ2 关卡编辑器用户查游戏代码用的网站。编辑器里会给一个链接跳到这里。

纯静态：**没有构建步骤，没有框架，没有依赖**。原生 JS + CSS，双击 `index.html` 就能在
`file://` 下跑起来。部署在 Cloudflare Pages。

## 文件结构

**仓库根目录就是站点根目录**，没有 `codex-site/` 那一层。

```
index.html            页面骨架
_headers              Cloudflare Pages 响应头（唯一的 CF 专属文件）
css/style.css         全部样式（含深浅色主题、响应式）
js/chapters.js        章节清单 —— 加章节改这里
js/pinyin-table.js    拼音首字母表（生成物，勿手改）
js/codex.js           数据注册表：规整结构 -> 渲染单元 -> 扁平条目表
js/search.js          检索与打分
js/app.js             界面：渲染、滚动高亮、复制、设置
data/ch-*.js          数据，唯一真源，手工维护。格式见 data/README.md
tools/check.js        数据层自检，改完数据跑一下
tools/gen_pinyin.py   重新生成拼音表
tools/move_parens.py  把条目名里的（括号）内容挪进 note，支持 --dry-run
```

TXT 迁移工具 `tools/migrate.py` 不在这里（本仓库只放网站），见 `data/README.md`。

## 本地预览

直接双击 `index.html` 即可。

要模拟线上环境（比如之后加 Service Worker），起个本地服务器：

```bash
python -m http.server 8000    # 在仓库根目录执行，然后访问 http://localhost:8000
```

## 部署（Cloudflare Pages）

| 配置项 | 值 |
|---|---|
| 根目录（Root directory） | 留空（默认就是仓库根） |
| 框架预设（Framework preset） | `None` |
| 构建命令（Build command） | `exit 0` |
| 输出目录（Build output directory） | `.` |

**输出目录填 `.`**（一个点）——CF 默认去 `public` 找产物，而站点就在仓库根，不覆盖会部署出空站；
`./` 会被拒。**构建命令填 `exit 0` 而不是留空**——留空时 CF 可能退回默认行为去跑 `npm run build`，
仓库里没有 `package.json`，会直接失败。

两种发布方式：

- **Git 集成**：控制台连上仓库，以后 push 到 `master` 自动部署。生产分支设 `master`。
- **直接上传**（适合只想要个临时预览）：`npx wrangler pages deploy . --project-name z-editor-codex`

`_headers` 是唯一的 Cloudflare 专属文件，管缓存与几个安全头，**必须在发布根目录**（也就是仓库根）。
CF 会自己吃掉这个文件、不对外提供。

**缓存必须设成 `max-age=0, must-revalidate`，不能图省事给 `js/` `css/` 配长时间缓存。**
站点没有构建步骤、文件名也不带内容哈希，所以「部署清缓存」只清了 Cloudflare 边缘节点，
**管不到访客浏览器里已经存下的副本**。踩过的坑：`/js/*` `/css/*` 配了 `max-age=3600` 之后，
`index.html`（走 CF 默认的每次回源校验）是新的、而 `js/app.js` / `css/style.css` 一小时不回源是旧的，
结果是**新按钮画得出来但点了没反应、新样式不出现**——这种「半个新版本」最难排查。
`max-age=0` 下没变的文件 CF 回 304，全站合计才 240KB，代价可以忽略。

**换平台几乎零成本**：全部是相对路径，整个仓库丢给任何静态托管都能跑，挂在子路径下也不用改代码。

## 设计要点

**为什么数据是 `.js` 而不是 `.json`**：`file://` 下 `fetch` 会被 CORS 拦掉，而 `<script>`
不会。用 `.js` + `Codex.add({...})` 还顺带允许写注释和尾逗号，手工维护友好得多。

**为什么滚动容器是 `.content` 而不是 window**：这样吸顶的分组标题 `top` 恒为 0，
不用按断点重算偏移量；顶栏和分组 chips 也永远不动。代价是不能靠地址栏自动收起，
对工具类页面来说划算。

**分组 chips 的滚动高亮**用 `.group` 的 `offsetTop` 判定（不是 `.group-head`——
sticky 元素的 offsetTop 会被吸顶位移污染），配合 `position: relative` 的 `.content` 作为
`offsetParent`。所以改布局时别给 `.group` 加 `position`。

**检索是全局跨章节的**：在「僵尸」页搜「豌豆射手」也要有结果，所以索引按章惰性构建、
缓存在 `chapter._index` 上，查询时把所有已加载章节一起打分。1500 条规模下线性扫描
比倒排索引更快也更好维护，暂时不需要防抖。

**拼音表**用 GB2312 一级汉字区（按拼音排序）的 23 个边界字离线切出来，只依赖标准库，
不用装 `pypinyin`。覆盖 3755 个常用字；二级汉字和生僻字没有拼音首字母，按原字匹配即可。

## 断点

只有一个：**940px**。

- 以下：单列，章节 chips + 分组 chips + 吸顶分组标题；侧栏变成 ☰ 抽屉（同一份 DOM）。
- 以上：侧栏常驻（章节 + 目录），两个 chips 行让位，条目区变 2–3 列网格，复制图标改成 hover 显示。

## 条目密度

设置里有四档：**标准 / 紧凑 / 极紧 / 单行**，跟其他设置一起存在 `codex.settings.v1` 里。

实现上只在 `<html>` 上写一个 `data-density` 属性，CSS 用 `:root[data-density="…"]` 换掉一组
`--fs-*` / `--pad-*` token，而所有相关规则一律读 token —— 所以加档位只改 token 块，不用碰布局规则。
`standard` 不写属性（等同 `:root` 的默认值），跟主题的 `auto` 是同一个套路。

行高实测（植物章 429 条，手机内容宽 376px）：标准 57px（整章 25896px）、紧凑 49px（22291px）、
极紧 43px（19578px）、单行 35px（16205px）。**前三档只压字号和内边距，收益有上限**——
一行 57px 里有 40px 是「名称一行 + 代码一行」这段内容本身，压到底也只到 43px；
想再紧只能改行内布局，也就是「单行」档（名称与代码并排）。单行档的代价也量过：
429 条里只有 1 条长代码会走省略号，名称一条都没被截。

一个坑：宽屏「比窄屏松一点」原本是三处写死的 `padding`（`.item` / `.group-head` / `.sect-head`），
如果照原样留着，940px 媒体查询里的写死值会把档位效果整个盖掉。现在拆成 `--lg-*` 补偿量加在
token 上，标准档下宽屏的最终值跟改动前逐像素一致。

## 复制格式

设置里三档，点条目右侧的复制图标（窄屏是整行）时决定复制出什么：

| 档位 | 复制结果（以 `peashooter` 为例） |
|---|---|
| 纯代码（默认） | `peashooter` |
| 带引号 | `"peashooter"` |
| RTID语句 | `RTID(peashooter@PlantTypes)` |

RTID 的表名后缀**来自数据**（`data/ch-*.js` 里的 `rtid` 字段），不是写死在 UI 里的映射表
——这样维持「新增章节不用改 UI」这条约定。

**拼不出 RTID 时回退成「带引号」，不是回退成裸代码。** 后面还有 7 章要迁，其中一部分内容
（音乐、主题、模块 JSON 之类）根本没有 RTID 表；而勾了 RTID 的人要的是一个能直接粘进
关卡 JSON 的字符串字面量，那个语境下裸代码一样是错的，所以回退到带引号才是安全解。

数据侧两级写法：

| 写法 | 效果 |
|---|---|
| 章节写 `rtid: 'ZombieTypes'` | 该章默认都按这个表名拼 |
| 章节不写 `rtid` | 该章一律回退带引号 |
| 条目写 `rtid: ''` | **只有这一条**回退带引号，章节有表名也盖掉 |
| 条目写 `rtid: 'xxx'` | 这一条改用别的表名 |

「没写」和「写成空串」是两件事——前者是跟随章节，后者是明确不支持。所以 `js/codex.js`
的 `normItem` 只在数据里真有这个键时才带上它，没有写成 `(it.rtid || '')` 一把梭（那会把
两种情况压成一种，条目级的「明确不支持」就永远表达不出来）。

表名写错不会抛错、只会静默复制出错的 RTID，所以 `tools/check.js` 里有一道白名单
（`RTID_TABLES`），章节级和条目级都拦；校验故意放在自检工具而不是界面里，UI 不耦合具体表名。

## 待办

- Service Worker 离线缓存（需要 https 或 localhost，托管方案定了再做）
- 其余 7 章迁移：动物事件、工具代码、场景/地图代码、音乐模块、状态代码、子弹代码、主题代码。
  迁移工具 `tools/migrate.py` 不在本仓库，要在 Z-Editor 那份检出里跑完再把数据拷过来，
  详见 `data/README.md`
- 模块代码章节（217 个 JSON 模板，复制时要剥掉 `#` 注释）—— 二期
- 编辑器侧加链接
