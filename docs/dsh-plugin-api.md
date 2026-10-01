# DSH 第三方插件开发 API 调研笔记（P1 实施依据）

调研日期：2026-10-01。来源：本机 npx 缓存内官方包（0.1.7-alpha.2）的类型定义与 README、
官方 GitHub 文档（extension-cookbook / api-gateway）、dsh-trellis 0.1.8 源码（第三方插件样板）。
所有结论都有本地文件或 URL 佐证，标注为【证据】。

## 1. 插件包 manifest 与装载

- 插件 = 一个 npm 包，`dsh plugin --profile web add file:<path>` 装进 profile（pnpm 快照式安装）。
- package.json 关键字段（dsh-trellis 实例）：
  ```json
  {
    "name": "dsh-session-manager",
    "type": "module",
    "main": "lib/index.js",
    "exports": {
      ".": "./lib/index.js",
      "./client": "./lib/client.js",
      "./package.json": "./package.json"
    },
    "files": ["lib", "cordis.patch.yml"],
    "engines": { "node": ">=24", "dsh": "^0.1.7-alpha.2" },
    "peerDependencies": { "@deepseek-ai/cordis": "..." , ... },
    "dsh": {
      "manifestVersion": 1,
      "bundle": { "patch": "cordis.patch.yml" },
      "client": {
        "inject": ["@deepseek-ai/dsh-client-locale", "..."],
        "platform": "web"
      }
    }
  }
  ```
- `cordis.patch.yml`（整个文件就这两行）：
  ```yaml
  - insert:
      - id: dsh-session-manager
        name: dsh-session-manager
  ```
- 【证据】`~/.dsh/profiles/web/node_modules/dsh-trellis/{package.json,cordis.patch.yml}`
- 【证据】`dsh-client-modules/README.md`：`dsh.client` 声明 + `./client` 导出 → host 在
  `/plugins` 下服务 bundle，浏览器懒加载；`dsh.client.external` 列非基线模块请求。
- `dsh.client.inject` 列出 client 半边依赖的服务提供方包（client 侧 cordis 服务，如
  `slots`、`locale`）。peer 版本不匹配时 loader fail-loudly，不会静默失效。

## 2. Host 半边（Node 进程内 cordis 插件）

标准 cordis 结构：

```js
export const name = 'dsh-session-manager'
export const inject = ['connection']   // 声明依赖的 host 服务
export function apply(ctx) {
  ctx.effect(() => disposer, 'label')  // 每个注册是 effect，随插件卸载清理
}
```

### 2.1 client↔host 数据通道：Connection Fetch 路由（本插件的核心通道）

- **第三方插件无法新增 `ctx.remote.<ns>`**：Typert Remote 的 codec/声明由官方 monorepo
  的 `pnpm run build:lib` 生成管线产出（`typert.remote-client.js`），Client assembly
  （`@deepseek-ai/dsh-api-remotes`）只挂载官方选择的贡献包；SRC 回退仅 host 源码模式，
  Client 拒绝无严格 codec 的描述符。【证据】docs/api-gateway.zh.md「严格生成流水线」「SRC 开发回退」
- **正道：`ctx.connection.fetch.register(route)`** —— host 侧在共享 `/api` 通道上注册
  精确 Fetch 路由，carrier 自动套用浏览器信任检查 + cookie 认证。官方 Session-log 下载、
  文件上传就是走这个。【证据】`dsh-client-connection/lib/types/rpc.d.ts`：
  ```ts
  interface ConnectionFetchRoute {
    readonly path: string            // /api 下的绝对路径
    readonly methods: readonly ('GET'|'HEAD'|'POST')[]
    readonly requestBody: 'buffered' | 'streaming'
    readonly fetch: (request: Request) => Promise<Response>   // 标准 Fetch API
  }
  interface HostConnectionFetch {
    register(route: ConnectionFetchRoute): () => Promise<void>  // 异步 disposer
  }
  ```
- host 服务名：`connection`（`dsh-client-connection` host 入口导出 `HostConnectionService`，
  web 组合已装载；插件 `inject: ['connection']` 即可）。
- Client 半边直接同源 `fetch('/api/dsh-session-manager/...')`，携带浏览器 cookie，无需处理认证。
- 响应用标准 `new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json' } })`。
- 限制：路由是**精确匹配**（path 完全一致），一个 path 一个注册，重复注册抛错；query 参数
  从 request.url 读。POST body 用 `request.json()`（buffered 模式有 JSON cap）。

## 3. Client 半边（浏览器 bundle）

### 3.1 构建配方（dsh-trellis tsdown.config.js 原样照抄改 id）

```js
import { defineConfig } from "tsdown";
const id = "dsh-session-manager";
const externals = new Set(["react", "react/jsx-runtime"]);
export default defineConfig({
  name: `${id}/client`,
  entry: { client: "src/client/index.jsx" },   // 我们的入口
  outDir: "lib",
  format: "cjs",
  platform: "browser",
  target: "es2022",
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: (s) => externals.has(s),
    alwaysBundle: (s) => !externals.has(s),
  },
  outputOptions: {
    entryFileNames: "client.js",
    sourcemapExcludeSources: true,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: "return module.exports; } });",
    intro: "var module = { exports: {} }; var exports = module.exports;",
  },
});
```

- React/Cordis 是平台共享模块（PLATFORM_MODULES 冻结表），bundle 里 external，
  运行时经 `require` 解析。**不要把 react 打进 bundle**。
- 【证据】dsh-trellis 仓库 `tsdown.config.js`（GitHub raw）。

### 3.2 client 插件结构（dsh-trellis src/client/index.jsx 实例）

```jsx
export const inject = ["slots", "locale"];
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register("dsm.client", { zh, en }), "locale");
  // CSS：<style data-plugin-css="dsh-session-manager/client"> 注入 document.head
  ctx.slots.inject("slot.name", () =>
    ctx.slots.register({ name: "slot.name", id: "...", order: N, locale: "..." }, Component));
}
```

- `ctx.slots.inject(slotName, factory)`：等待 slot owner 声明后注入，任一侧卸载自动清理。
- `ctx.slots.register(spec, Component)`：spec = `{ name: slot名, id: 包内唯一, order: 排序,
  locale?, inject?: () => ({...}) }`；Component 是 React 组件（可用 React.createElement，
  dsh-trellis 用 .jsx）。
- 组件 props 由框架五股组成（runtime/renderSlots/store/inject/business），注册时的
  `inject: () => ({...})` 提供业务股。

### 3.3 本插件用到的官方 slot（全部 root scope）

| Slot | kind | owner props | 用途 |
|---|---|---|---|
| `sidebar.panellist` | list | `{ size, active }` + 元数据 `{id, order, label}` | 侧栏图标入口；**list id 即 main panel key** |
| layout `main` | keyed | — | 面板内容（id 对应 panellist 的 id） |
| `sidebar.workspaces.session.menu.item` | list | `{ sessionId, displayTitle }` + `useMenuOpenState` hook | 会话 "..." 菜单项 |
| `sidebar.workspaces.session.row.action` | list | `{ sessionId, displayTitle }` | 会话行悬停按钮 |

官方菜单项 order：menu `pin=100 rename=200 fork=300 archive=400`；row `archive=100 pin=200`。
我们用 order 500+，id 用包名前缀（如 `dsm.annotate`）。菜单项渲染
`role="menuitem"` 的 `<button>`，动作后调 `useMenuOpenState()[1](false)` 收起菜单。
【证据】`dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts`（内含完整官方示例代码）。

### 3.4 打开会话（看板点击跳转）

`ctx.uiWorkspace.openSession(sessionId)` — 同步切换 mainView 到该会话。
【证据】`dsh-client-ui-workspace/README.md`（ctx.uiWorkspace 契约）。需要 inject 声明
`uiWorkspace` 服务（由 `@deepseek-ai/dsh-client-ui-workspace` 提供）。

### 3.5 会话列表数据（client 侧）

- `useSessions()` / `useWorkspaces()` 全局 hooks（sidebar 用）。【证据】ui-sidebar README
- host 侧查询走 `ctx.sessionQuery.listSessions()`（host 服务，sessionQuery）。
- **P1 简化决策**：看板数据 = client 用 fetch 调我们自己的 host 路由
  `/api/dsh-session-manager/board`，host 端组装 `sessionQuery.listSessions()` ⊕ sidecar
  标注 ⊕ 运行状态，一次返回。client 不直接依赖官方 session 数据服务，减少耦合面。

## 4. Settings / locale / 样式

- locale：`ctx.locale.register(namespace, { zh, en })`，组件文案走 locale namespace。
- 样式：`<style data-plugin-css="dsh-session-manager/client">` 注入（dsh-trellis styles.js 模式）。
- Settings 卡片（P2 用）：`ctx.inject(['configForms'], ...)` 注册 `settings.plugin.item`。
  【证据】dsh-trellis src/client/index.jsx

## 5. 升级/兼容

- peerDependencies + engines.dsh 声明版本范围；不匹配时 loader 显式拒绝。
- host 侧只依赖：`connection`、`sessionQuery`（可选）、Node fs。
- client 侧只依赖：`slots`、`locale`、`uiWorkspace`（可选）。
- 避免依赖：`ctx.remote` 新 namespace（不可能）、官方组件内部实现、settings 私有 API。

## 6. 环境事实

- Node v24.15.0、pnpm 12.4.2、npm 11.12.1 可用；registry = 腾讯镜像（可达，923ms）。
- 官方包本地路径（类型参考）：`/export/home/maxiaolong/.npm/_npx/ebf017b61addb8bd/node_modules/@deepseek-ai/`
- dsh-trellis 本地安装实例（样板参考）：`~/.dsh/profiles/web/node_modules/dsh-trellis/`
- profile 安装命令：`dsh plugin --profile web add file:/export/home/maxiaolong/github_xllm/dsh-session-manager`
  （dsh bin = `node /export/home/maxiaolong/.npm/_npx/ebf017b61addb8bd/node_modules/@deepseek-ai/dsh/lib/bin.js`）
- 安装后需重启 dsh web 才加载；file: 安装是快照式，改代码后需 remove + add 刷新。

## 7. 风险与已否决路径

- ❌ fork/patch 官方源码（升级地狱）；❌ ctx.remote 自定义 namespace（codegen 闭门）；
  ❌ localStorage 存标注（换浏览器丢数据，且 P3 需要读 host 文件）。
- ✅ Connection Fetch 路由（官方 feature 包同款通道）+ sidecar JSON。
- 注意：Fetch 路由只有 GET/HEAD/POST；写入用 POST。路由精确匹配，参数放 query 或 body。
