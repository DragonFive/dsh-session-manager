# dsh-session-manager

DeepSeek Harness (DSH) Web 插件：给会话打上 分类 / 标签 / 状态 / 优先级 标注（sidecar 存储），
并提供一个会话看板面板（分组 / 筛选 / 艾森豪威尔四象限 / 行内快捷改状态）。

不修改任何官方源码，不写官方 session 持久化格式；官方 dsh 升级零冲突。

## 功能（P1 范围）

- **会话标注**：会话行 "..." 菜单的「标注…」（order 500）与悬停标签图标（order 300）打开标注弹窗，
  可设置分类（树形）/ 标签（多选 + 新建）/ 状态 / 优先级 / 备注，保存即落 sidecar。
- **会话看板**：侧栏新面板「会话看板」（`dsm-board`）：
  - 数据 = `sessionQuery.listSessions()` ⊕ 标注 ⊕ 运行状态，host 一次 JSON 返回；
  - 分组视图：按分类 / 状态 / 优先级 / 标签；未标注会话进「未分类」/「未标注」桶；
  - 筛选：多选分类 / 标签 / 状态 / 优先级 + 只看未标注；按更新时间排序（默认新→旧）；
  - 四象限视图：X=紧急（priority=urgent 或运行中），Y=重要（priority∈{urgent, important}）；
  - 行点击 → `ctx.uiWorkspace.openSession(id)` 打开会话（已归档行禁点）；
  - 行内快捷改状态 / 优先级（POST 后刷新）；运行中会话显示「运行中」徽标，与手动状态徽标并存可区分。

## 架构

```
浏览器 client 半边（lib/client.js，tsdown 打包，__ModuleLoader__ 加载）
  slots: sidebar.panellist(dsm-board) / main(dsm-board)
         sidebar.workspaces.session.menu.item(dsm.annotate)
         sidebar.workspaces.session.row.action(dsm.annotate-icon)
         shell.overlay(dsm.annotate-overlay)  ← 标注弹窗本体（菜单行随菜单卸载，
                                                 弹窗必须活在 frame 级浮层里）
  services: slots / locale / uiWorkspace
        │  同源 fetch（cookie 认证由 Connection carrier 处理）
        ▼
host 半边（lib/index.js，plain ESM，cordis 插件）
  ctx.connection.fetch.register 精确路由（/api 前缀）：
    GET  /api/dsh-session-manager/board        会话 ⊕ 标注 ⊕ 运行状态
    GET  /api/dsh-session-manager/annotations  全量标注
    POST /api/dsh-session-manager/annotations  upsert / 删除（annotation: null）单会话标注
    POST /api/dsh-session-manager/taxonomy     替换分类树
  读时消费官方服务（缺哪个降级哪个）：
    sessionQuery（必需，缺失时 /board 返回 503）、workspaceRegistry、agents、
    sessionProjectionCache
        │
        ▼
sidecar：~/.dsh/storages/dsh-session-manager/annotations.json
  schemaVersion=1；临时文件 + rename 原子写；损坏时备份原文件并重建空库
```

## 构建与测试

```bash
pnpm install        # devDependencies 只有 tsdown（peer 会被 pnpm 自动装上，仅用于开发）
pnpm run build      # tsdown 构建 lib/client.js + 复制 src/host/*.js → lib/
pnpm run build:client
pnpm test           # node --test：store 读写/原子写/并发/schema 校验、路由处理逻辑
```

要求 Node ≥ 24。React / Cordis / ui-primitives 是平台共享模块（PLATFORM_MODULES 基线），
构建时 external，不在本包安装。

## 安装（本地 file: 安装）

```bash
# dsh bin：
node /export/home/maxiaolong/.npm/_npx/ebf017b61addb8bd/node_modules/@deepseek-ai/dsh/lib/bin.js \
  plugin --profile web add file:/export/home/maxiaolong/github_xllm/dsh-session-manager
# 重启 dsh web 后生效；file: 安装是快照式，改代码后需 remove + add 刷新
```

安装后：设置 → 插件 应显示 dsh-session-manager 已启用；侧栏出现看板图标。

## 配置（可选）

cordis 插件配置（profile 的配置层）支持两个字段：

- `storageDir`：sidecar 目录（默认 `~/.dsh/storages/dsh-session-manager`）；
- `taxonomy`：首次创建 store 时的分类树种子（结构同 POST /taxonomy；非法值启动即报错）。

默认分类树：功能开发（LLM方向 / 生成式推荐）、PR评审、代码学习、测试/杂项；
状态 待办/进行中/完成；优先级 紧急/重要/一般。

## 卸载与数据

```bash
dsh plugin --profile web remove dsh-session-manager
```

卸载后官方 UI 复原；`~/.dsh/storages/dsh-session-manager/annotations.json` 保留不删。

## 升级 SOP（摘要）

1. `npx @deepseek-ai/dsh -V` 记录当前版本；
2. `npx @deepseek-ai/dsh@<new> web --no-open` 试跑新版本（npx 双版本并存）；
3. 打开 Web UI → 设置 → 插件，确认本插件 enabled 且看板/标注可用（冒烟：标注一个会话 →
   看板分组与四象限可见 → 重启后标注仍在）；
4. 失败 → 回退 `npx @deepseek-ai/dsh@<old> web`；插件侧更新 `engines.dsh` 与
   `peerDependencies` 范围并适配 API 变更后，`dsh plugin --profile web remove` + `add` 重装。

版本基线：dsh `0.1.7-alpha.2`（engines/peer 均为 `^0.1.7-alpha.2`），cordis `^4.0.4`。

## 开发备注

- 路由是精确匹配：`/annotations` 的 GET 与 POST 注册在同一条 route（`methods: ["GET","POST"]`）。
- Fetch 路由只支持 GET/HEAD/POST，写入一律 POST。
- 标注弹窗用平台基线模块 `@deepseek-ai/dsh-client-ui-primitives` 的 `Modal` / `MenuItemButton`
  （body portal、Escape/遮罩、菜单键盘走查都是官方行为）。
- 样式经 `<style data-plugin-css="dsh-session-manager/client">` 注入，颜色读 `--dsw-alias-*`
  官方 token（带固定深色回退），不改官方样式表。
