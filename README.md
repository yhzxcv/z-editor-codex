# 关卡编辑器（网页版）

把桌面端 **Z-Editor**（`E:\code\PVZ2LevelEditor`，Kotlin + Compose Desktop）的核心编辑能力
搬到浏览器里的 PvZ2 关卡编辑器。功能和判定逻辑是从那套 Kotlin 源码**逐条搬过来的**，
不是照着界面仿写的。

纯静态：**没有构建步骤，没有框架，没有运行时依赖**。原生 JS + CSS，双击 `index.html`
就能在 `file://` 下跑起来。部署在 Cloudflare Pages。

> 这个仓库原先是「代码图鉴」静态站。图鉴的**数据层**（`data/ch-*.js`、`js/codex.js`、
> `js/search.js`、`js/pinyin-table.js`）留下来了，作为编辑器「图鉴」页签的数据源；
> 图鉴那套界面（`js/app.js` + `css/style.css`）已随编辑器上线删除。
> 删除前的完整站点备份在 `E:\code\z-editor-codex-backup-20260921`，打有标签 `codex-site-final`。

## 三层结构

```
js/level/    关卡逻辑层 —— 从 Kotlin 移植，纯函数，不碰 DOM
js/editor/   编辑器界面层
data/        数据：模块注册表、对象骨架、模板、图鉴条目
vendor/      预打包的 CodeMirror 6
```

逻辑层和界面层是分开的：逻辑层全部是不碰 DOM 的纯函数，所以能在 Node 里直接跑断言，
不用开浏览器。

侧栏三个平行页签：**对象 / 模块 / 图鉴**。对象树管关卡里已有的东西，模块页签管
「往关卡里加」，图鉴页签是那 2333 条代码条目的检索入口。

## 文档

| 文件 | 内容 |
|---|---|
| [docs/design-notes.md](docs/design-notes.md) | **开发笔记**：设计理由、bug 复盘、保真对照、自检套件与工具表、手工验收清单、图鉴数据层、待办 |
| [docs/webapp-plan.md](docs/webapp-plan.md) | 网页版方案 |

重建 `vendor/cm6.js`、跑自检套件、本地预览与部署，都记在 `docs/design-notes.md` 的
「构建」「自检」「本地预览 / 部署」三节。
