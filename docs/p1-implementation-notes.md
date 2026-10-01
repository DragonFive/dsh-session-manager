# P1 实施期验证补充（implementation-verified facts）

实施 `dsh-session-manager` P1 时逐条验证过的 API 事实，供 P2/P3 直接复用。
所有条目都有本机代码佐证（npx 缓存官方包 / 已构建插件仓库）。

## manifest / 构建

- `dsh.client.inject` 语义确认（`@deepseek-ai/dsh-package-manifest/lib/types/types.d.ts`）：
  **"Informational package-name dependencies, not Cordis service injection"** —— 只影响
  boot graph 的加载顺序（provider 先于 consumer 加载），不是 cordis 服务声明。client 插件
  真正的服务依赖是 bundle 里 `export const inject = [...]`。
- `@deepseek-ai/dsh-client-ui-primitives` **是平台基线模块**：官方 plugin-manager 的
  client bundle 直接 `require("@deepseek-ai/dsh-client-ui-primitives")`（external），
  web-frontend dist 的模块表里有该 key。可用的官方组件：`Modal`（body portal、
  Escape/遮罩关闭）、`MenuItemButton`（role=menuitem 行）、`Menu`、`Tag`、`Pill`、
  `Button`、`Input`、`SegmentedControl`。
  **图标导出名带笔画后缀（check-agent 勘误）**：runtime 只导出
  `Icon<Name>Regular`（1px）与 `Icon<Name>Medium`（1.3px）两种变体，
  例如 `IconChecklistOutlineRegular` / `IconListPenOutlineRegular`；
  **不存在**裸名 `IconChecklistOutline` / `IconListPenOutline`（类型 d.ts 与
  lib/index.js 的 export 语句均已核对）。引用裸名在构建期不报错（external 不解析
  磁盘），只在浏览器渲染时得到 `undefined` 组件并抛 "Element type is invalid"。
- `react-dom` 也是基线（官方 client bundle `require("react-dom")`），`createPortal` 可用
  （本插件用官方 `Modal`，无需自己 portal）。
- tsdown + `.jsx` + 自动 JSX runtime 在**不安装 react** 的仓库里构建成功：`react`、
  `react/jsx-runtime` 设为 neverBundle external，rolldown 不解析磁盘。
- pnpm 12 默认 auto-install-peers：即使 devDependencies 只写 tsdown，optional peers
  （dsh-session-query 等）也会被装进 node_modules（无害，仅开发便利）。
- `node --test test/`（目录形式）在 Node 24 报 MODULE_NOT_FOUND；用
  `node --test "test/*.test.js"`（dsh-trellis 同款）。

## Host 侧

- `ctx.connection.fetch.register(route)`：**一条 route 可拥有多个 method**
  （`methods: ["GET","POST"]`，在 fetch 里按 `request.method` 分发）——
  官方 `/api/session.export` 是 GET+HEAD 同 route 的先例。精确匹配、重复注册抛错。
- 可选 host 服务的运行时取法：`ctx.get("sessionQuery")`（返回 undefined 表示未挂载），
  官方 session-log-export / api-session-controller 同款；不要写进插件顶层 `inject`
  （那是硬依赖，缺服务时插件整体 PENDING）。
- running 判定（与官方一致）：`ctx.agents.get(sessionId)?.status === "running"`
  （api-session-controller lib/index.js:1782；`agents` 服务来自 `@deepseek-ai/dsh-agent`）。
- updatedAt 判定（与官方一致）：`max(header.createdAt, projectionCache.cachedSnapshot(header)
  ?.values?.sessionListMetadata?.lastPromptAt ?? 0)`，projectionCache 来自
  `@deepseek-ai/dsh-session-projection-cache`，读取要 try/catch（官方也是 fail-soft）。
- workspace 归属：`ctx.workspaceRegistry.list()` → `{id, path, title, sessionIds}`，
  session 的 `header.cwd` === workspace 的 canonical `path` 即归属；归档集 =
  `workspaceRegistry.archivedSessionIds`。
- 会话可见性（官方 sidebar 同规则）：`origin === 'subagent'` 隐藏；冷会话（非 live）无
  `cwd` 隐藏。标题批量读：`sessionQuery.readTitleSnapshots(ids)` →
  `{sessionId, status: 'fulfilled', value: {title: {title}}}`，fail-soft。
- displayTitle 回退链（官方）：持久标题 → cwd basename → session id。

## Client 侧

- `main` keyed slot 注册（plugin-manager 实例）：
  `ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: PANEL_ID,
  locale: NS, inject: () => ({...}) }, Component))`；panellist 注册
  `{ name: "sidebar.panellist", id: PANEL_ID（=main key）, order: N,
  label: () => t("..."), locale: NS }`。`conversation` 是保留 main key。
- `ctx.locale.register(ns, { zh, en })` 两参形式运行时可用（类型签名是三参
  `(ns, locale, dict)`，实现两参都兼容；dsh-trellis 用两参）。`ctx.locale.bind(ns)` →
  `t(key, params)`，`{param}` 插值，missing key 回退 key 本身。
- 菜单项组件 props 解构 `({ sessionId, displayTitle, useMenuOpenState, t })`；
  `useMenuOpenState()[1](false)` 收起菜单。row.action props 只有
  `({ sessionId, displayTitle, t })`，点击事件被官方 strip 吞掉、不会打开会话行。
- 官方 order 基准：menu pin=100 rename=200 fork=300 archive=400；row archive=100 pin=200。
  第三方用 300/500 均验证可行。
- **弹窗生命周期陷阱**：`session.menu.item` 的行只在菜单打开期间渲染，row.action 随行
  卸载——在触发器组件里直接渲染弹窗会在触发瞬间被卸载。官方做法（ui-workspace 的
  rename dialog）：动作只发请求，弹窗注册在 `shell.overlay`（ui-layout 的 list slot，
  root scope，无 owner props，frame 级浮层）里常驻。本插件用模块级 request bus 连接
  两侧（src/client/annotate-bus.js），P2 的 Settings 弹窗/命令面板同理。
- `ctx.uiWorkspace.openSession(id)`（`@deepseek-ai/dsh-client-ui-workspace` 的 client
  服务）同步切换 mainView；已归档会话官方不允许打开（board 侧应禁点）。

## 本仓库实施结论

- 工程位置 `/export/home/maxiaolong/github_xllm/dsh-session-manager`，构建/测试/冒烟全绿
  （`pnpm run build` → lib/index.js + lib/client.js 带 `__ModuleLoader__` banner；
  `node --test` 21/21；host 路由 round-trip 与 client slot 注册均在沙箱里验证通过）。
  - check-agent 复核修正：原实现的 client bundle 从 ui-primitives 引用了不存在的裸名
    `IconChecklistOutline` / `IconListPenOutline`（见上文勘误），已在 src/client/index.jsx
    改为 `IconChecklistOutlineRegular` / `IconListPenOutlineRegular` 并重建；
    现已用脚本把 bundle 引用的全部符号与官方 runtime export 表（265 个）交叉核对通过。
    此前"slot 注册验证通过"只覆盖注册，未覆盖渲染路径。
- 设计偏差两条（详见任务汇报）：zod → 手写校验器（零运行时依赖）；
  `annotations/changed` 推送事件 → P1 用"打开/操作后拉取"替代（client↔host 推送通道
  对第三方不可用，remote 事件命名空间是官方 codegen 闭门）。
