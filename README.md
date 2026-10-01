# dsh-session-manager

DeepSeek Harness (DSH) Web 插件：给会话打上 分类 / 标签 / 状态 / 优先级 标注（sidecar 存储），
提供一个会话看板面板（分组 / 筛选 / 艾森豪威尔四象限 / 行内快捷改状态），
以及一个 `/prompt`（别名 `/p`）斜杠命令调用的 **提示词库**（YAML 文件维护）。

不修改任何官方源码，不写官方 session 持久化格式；官方 dsh 升级零冲突。

## 功能

### P1：会话标注与看板

- **会话标注**：会话行 "..." 菜单的「标注…」（order 500）与悬停标签图标（order 300）打开标注弹窗，
  可设置分类（树形）/ 标签（多选 + 新建）/ 状态 / 优先级 / 备注，保存即落 sidecar。
- **会话看板**：侧栏新面板「会话看板」（`dsm-board`）：
  - 数据 = `sessionQuery.listSessions()` ⊕ 标注 ⊕ 运行状态，host 一次 JSON 返回；
  - 分组视图：按分类 / 状态 / 优先级 / 标签；未标注会话进「未分类」/「未标注」桶；
  - 筛选：多选分类 / 标签 / 状态 / 优先级 + 只看未标注；按更新时间排序（默认新→旧）；
  - 四象限视图：X=紧急（priority=urgent 或运行中），Y=重要（priority∈{urgent, important}）；
  - 行点击 → `ctx.uiWorkspace.openSession(id)` 打开会话（已归档行禁点）；
  - 行内快捷改状态 / 优先级（POST 后刷新）；运行中会话显示「运行中」徽标，与手动状态徽标并存可区分。

### P2：提示词库（/prompt 斜杠命令）

- **`/prompt` / `/p`**：输入框键入 `/prompt`（或简写 `/p`）回车，或从 `/` 菜单、composer `+` 菜单选择
  「插入提示词」——弹出提示词选择面板（官方 popupSelect：自带搜索过滤、↑↓ 走查、回车确认）。
  - 面板选项按库内分组排列，行标签为 `分组名 · 条目名`（输入分组名如「评审」即可过滤出该组）；
  - 选中后提示词正文**追加**到当前输入框草稿（已有草稿时前空行分隔；草稿为空则直接填入），
    **不会自动发送**，焦点回到输入框（`SessionInput.setDraft` + `focus`）；
  - 库文件损坏（YAML 语法 / 结构校验失败）时面板显式报错（含行号）并保留重试按钮，进程不崩溃。
- **库文件**：默认 `~/.dsh/storages/dsh-session-manager/prompts.yaml`，首次打开时自动落盘内置示例库
  （三组：PR 评审 / 写笔记 / 代码学习，与仓库 `examples/prompts.yaml` 完全一致）。
  每次打开命令都重读文件——修改保存后无需重启，下次 `/p` 即生效。
- **Settings 卡片**：设置 → Plugins 分区新增「提示词库」标签页（`settings.plugins.tab`），
  可配置库文件绝对路径（支持 `~` 前缀），留空恢复默认；保存即 live 生效。

#### 提示词库 YAML 格式

```yaml
groups:
  - id: pr-review          # 组 id（组内唯一）
    label: PR 评审          # 组显示名
    prompts:
      - id: strict-review   # 条目 id（组内唯一）
        title: 严格审查      # 条目显示名
        body: |             # 提示词正文（块标量，可多行；|- 结尾不带空行）
          请严格审查……
```

手写最小 YAML 子集解析器（零运行时依赖，见「开发备注」）支持：嵌套 map、列表（含与父键同缩进的
`- item` 写法）、`|` / `|-` / `|+` 块标量、`#` 注释、单/双引号字符串（双引号支持 `\n` `\t` `\"`
`\\` `\uXXXX` 转义）。**不支持**：flow 集合（`[...]` / `{...}`）、锚点/别名、标签、`>` 折叠标量、
多文档标记（`---`）、缩进中的 tab——遇到即报错（带行号），不静默误解析。含 `#` / `: ` 的标量值请加引号。

## 架构

```
浏览器 client 半边（lib/client.js，tsdown 打包，__ModuleLoader__ 加载）
  slots: sidebar.panellist(dsm-board) / main(dsm-board)
         sidebar.workspaces.session.menu.item(dsm.annotate)
         sidebar.workspaces.session.row.action(dsm.annotate-icon)
         shell.overlay(dsm.annotate-overlay)  ← 标注弹窗本体（菜单行随菜单卸载，
                                                 弹窗必须活在 frame 级浮层里）
         settings.plugins.tab(dsm.prompts)    ← P2 提示词库 Settings 卡片
  commandUi: /prompt、/p（popupSelect；经 ctx.inject(["commandUi"]) 可选注入，
             选中后经 sessions.binding + conversation.input.for 写 composer 草稿）
  services: slots / locale / uiWorkspace（+ 可选 commandUi / sessions / conversation）
        │  同源 fetch（cookie 认证由 Connection carrier 处理）
        ▼
host 半边（lib/index.js，plain ESM，cordis 插件）
  ctx.connection.fetch.register 精确路由（/api 前缀）：
    GET  /api/dsh-session-manager/board        会话 ⊕ 标注 ⊕ 运行状态
    GET  /api/dsh-session-manager/annotations  全量标注
    POST /api/dsh-session-manager/annotations  upsert / 删除（annotation: null）单会话标注
    POST /api/dsh-session-manager/taxonomy     替换分类树
    GET  /api/dsh-session-manager/prompts       提示词库（每次重读 YAML；坏文件 → 400 + 行号）
    GET  /api/dsh-session-manager/prompts/config  当前库路径配置
    POST /api/dsh-session-manager/prompts/config  设置 / 重置库路径（~ 展开，须绝对路径）
  读时消费官方服务（缺哪个降级哪个）：
    sessionQuery（必需，缺失时 /board 返回 503）、workspaceRegistry、agents、
    sessionProjectionCache
        │
        ▼
sidecar：~/.dsh/storages/dsh-session-manager/
  annotations.json  schemaVersion=1；临时文件 + rename 原子写；损坏时备份并重建
  prompts.yaml      提示词库（首次自动落盘内置示例库；每次请求重读）
  settings.json     插件自有设置（当前：库文件路径覆盖；原子写）
```

## 构建与测试

```bash
pnpm install        # devDependencies 只有 tsdown（peer 会被 pnpm 自动装上，仅用于开发）
pnpm run build      # tsdown 构建 lib/client.js + 复制 src/host/*.js → lib/
pnpm run build:client
pnpm test           # node --test：store/路由、YAML 解析器（含行号报错）、提示词库（默认落盘/
                    # 重读/路径配置/坏文件 400）、examples 与内置默认库一致性
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

安装后：设置 → 插件 应显示 dsh-session-manager 已启用；侧栏出现看板图标；
输入框 `/p` 弹出提示词面板；设置 → Plugins 分区出现「提示词库」标签页。

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

卸载后官方 UI 复原；`~/.dsh/storages/dsh-session-manager/` 下的 sidecar
（`annotations.json` / `prompts.yaml` / `settings.json`）保留不删。

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
- **P2 YAML 解析**：`js-yaml` / `yaml` 在 pnpm 严格隔离下不可作为传递依赖 import（host 半边按
  `file:` 快照安装，只有已声明依赖可解析），加真实依赖又违背零运行时依赖原则，故手写子集解析器
  （`src/host/yaml.js`，带行号报错），schema 校验复用 P1 的手写校验器模式（`src/host/prompts.js`）。
- **P2 草稿写入**：`commandUi` 的 `onSelect` 回调只拿到 `{sessionId}`，不含草稿口。公开通道是
  `sessions.binding(sessionId).ctx`（`@deepseek-ai/dsh-api-session-controller` 冻结契约）→
  `conversation.input.for(actx)`（`@deepseek-ai/dsh-client-ui-conversation` 冻结契约
  `SessionInputResolver`）→ `SessionInput.setDraft / state / focus`。追加时机在 `onSelect` 返回后
  的宏任务里执行：ui-commands 的 settle 续体（微任务）会先消费 `/prompt` 命令 token 并把焦点
 还给 composer，宏任务读到的即「token 已清理」的草稿。若会话无 composer（服务缺失）则降级为
  复制到剪贴板。
- **P2 Settings 卡片**：官方 per-plugin 配置页通道（schemastery Config + dsh-settings
  SettingsForms）要求 host 侧引入 `@deepseek-ai/schemastery` / `@deepseek-ai/dsh-settings` peer
  依赖；本机 profile 的模块解析图存在多版本混布，故改走 `settings.plugins.tab` slot 自绘表单 +
  自有 `/prompts/config` 路由 + sidecar（`settings.json`）存储，行为等价（live 生效）。
