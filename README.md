# dsh-session-manager

DeepSeek Harness (DSH) Web 插件：给会话打上 分类 / 标签 / 状态 / 优先级 标注（sidecar 存储），
提供一个会话看板面板（分组 / 筛选 / 艾森豪威尔四象限 / 行内快捷改状态），
一个 `/prompt`（别名 `/p`）斜杠命令调用的 **提示词库**（YAML 文件维护），
以及一个 **Trellis 里程碑看板**（只读 `.trellis/tasks` 任务树 + 一键导出 ob_note roadmap 笔记）。

不修改任何官方源码，不写官方 session 持久化格式，**绝不写 `.trellis` 下任何文件**；官方 dsh 升级零冲突。

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

### P3：Trellis 里程碑看板 + 笔记导出

- **Trellis 看板**：侧栏第二个面板「Trellis 看板」（`dsm-trellis`，order 600，分支图标）：
  - 数据 = host 只读扫描各注册 workspace 的 `.trellis/tasks/*/task.json`（**对 `.trellis` 绝对只读**，
    状态变更仍走 trellis CLI / 会话内工作流）；workspace 注册表 ∪ 会话 cwd 推导（复用 P1 board 的
    workspace 归属逻辑），含 `.trellis` 的 workspace 才显示；
  - **父任务卡片**：中文状态徽标（未开始 / 进行中 / 已完成 / 已归档）、priority、进度条 + `n/m`
    完成度；展开显示子任务表（状态 / 分支 / PR 外链 / 完成时间），支持多级嵌套；
  - `children` 引用了已不在 `tasks/` 下的任务（被 trellis 归档）显示为「已归档」占位并计入完成度——
    trellis 的 `cmd_archive` 会先把状态翻成 completed 再移目录，所以"父任务还引用但目录不在"＝已完成；
  - **孤儿任务**（`parent` 指向不存在的目录）与**读取警告**（损坏 JSON / 超大文件 / 缺 task.json /
    循环引用）单独列出，不崩溃、不影响其余任务；
  - 按状态筛选（chips）、手动刷新按钮（重新 fetch，归档/修改 task.json 后即可反映）；
    父任务按子树最新活动时间（task.json mtime / completedAt）排序；
  - 无 `.trellis` 的 workspace 显示空态提示（"当前工作区未初始化 Trellis"），不报错。
- **导出到笔记**：面板头部「导出到笔记」展开导出区：
  - 展示当前**导出根目录**（默认 `~/ob_note/projects/`，可在导出区直接修改，保存到插件 sidecar
    `settings.json` 的 `trellisExportRoot` 键，live 生效）；
  - 输入目标文件名（相对根目录，也可给绝对路径）→ POST 导出 → 官方 `Toast` 成功/失败提示 +
    内联详情（文件路径 / 备份路径）；
  - 导出内容 = ob_note roadmap 风格 markdown：每 workspace 一张「📊 总览仪表盘」表格
    （# | 里程碑 | 状态 | 进度 | 完成时间）+ 每父任务卡片（元信息行 + 子任务表），外加孤儿任务与
    读取警告小节；
  - **锚点区块**：导出内容被 `<!-- dsh-session-manager:trellis-export:start -->` …
    `<!-- …:end -->` 包围——文件已存在且有锚点时**只替换锚点区块，区块外内容逐字节不动**；
    存在但无锚点则追加到文件末尾；文件不存在则新建含 frontmatter（type: project-tracker）的完整笔记；
  - **写前备份**：修改已有笔记前先 `copyFile` 生成 `<文件>.bak.<时间戳>`；
  - **锚点残缺防误伤**：笔记里只有 start 无 end 锚点、或存在多个锚点区块（人工改坏）时拒绝导出（400），
    而不是猜测替换位置——静默追加会让下一次导出吞掉夹在旧锚点与新区块之间的人工内容；
  - **路径安全**：目标必须在导出根目录之下——先做词法检查（`../` 逃逸、绝对路径越界拒绝），
    再对真实路径（`realpath` 展开符号链接后的路径）复查前缀，符号链接绕过同样 400 拒绝；
    导出根目录与目标都不得位于任何 `.trellis` 目录内（只读纪律），配置时即校验；
  - **原子写**：临时文件 + `rename` 落盘，中途失败不会留下半个笔记。


## 架构

```
浏览器 client 半边（lib/client.js，tsdown 打包，__ModuleLoader__ 加载）
  slots: sidebar.panellist(dsm-board) / main(dsm-board)
         sidebar.panellist(dsm-trellis, order 600) / main(dsm-trellis)  ← P3 Trellis 看板
         sidebar.workspaces.session.menu.item(dsm.annotate)
         sidebar.workspaces.session.row.action(dsm.annotate-icon)
         shell.overlay(dsm.annotate-overlay)  ← 标注弹窗本体（菜单行随菜单卸载，
                                                 弹窗必须活在 frame 级浮层里）
         settings.plugins.tab(dsm.prompts)    ← P2 提示词库 Settings 卡片
  commandUi: /prompt、/p（popupSelect；经 ctx.inject(["commandUi"]) 可选注入，
             选中后经 sessions.binding + conversation.input.for 写 composer 草稿）
  services: slots / locale / uiWorkspace（+ 可选 commandUi / sessions / conversation）
  ui-primitives: Modal / MenuItemButton / Toast（P3 导出成功/失败提示）
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
    GET  /api/dsh-session-manager/trellis         各 workspace 任务树（只读扫描 .trellis/tasks；
                                                   损坏 JSON/超大文件/孤儿/循环 → 警告不崩溃）
    POST /api/dsh-session-manager/trellis/export  渲染 markdown 写入目标笔记（锚点区块替换 +
                                                   .bak 备份 + 路径必须在导出根目录下）
    GET  /api/dsh-session-manager/trellis/config  当前导出根目录
    POST /api/dsh-session-manager/trellis/config  设置 / 重置导出根目录（~ 展开，须绝对路径）
  读时消费官方服务（缺哪个降级哪个）：
    sessionQuery（必需，缺失时 /board 返回 503）、workspaceRegistry、agents、
    sessionProjectionCache（/trellis 系列只需 workspaceRegistry ∪ sessionQuery cwd）
        │
        ▼
sidecar：~/.dsh/storages/dsh-session-manager/
  annotations.json  schemaVersion=1；临时文件 + rename 原子写；损坏时备份并重建
  prompts.yaml      提示词库（首次自动落盘内置示例库；每次请求重读）
  settings.json     插件自有设置（库文件路径覆盖、Trellis 导出根目录覆盖；原子写）
```

## 构建与测试

```bash
pnpm install        # devDependencies 只有 tsdown（peer 会被 pnpm 自动装上，仅用于开发）
pnpm run build      # tsdown 构建 lib/client.js + 复制 src/host/*.js → lib/
pnpm run build:client
pnpm test           # node --test：store/路由、YAML 解析器（含行号报错）、提示词库（默认落盘/
                    # 重读/路径配置/坏文件 400）、examples 与内置默认库一致性、
                    # Trellis 树组装（归档占位/孤儿/循环/互引收养环/多父引用/
                    # 损坏 JSON/超大文件）、markdown 渲染快照、锚点替换（区块外
                    # 逐字节不变/无锚点追加/残缺锚点与重复区块拒绝/新建 frontmatter/
                    # 路径越界与符号链接逃逸 400/.trellis 只读拒绝/备份生成）、
                    # 导出根目录配置
```

要求 Node ≥ 24。React / Cordis / ui-primitives 是平台共享模块（PLATFORM_MODULES 基线），
构建时 external，不在本包安装。

## 安装

### 从 GitHub 安装（推荐，任意机器）

仓库已提交构建产物 `lib/`，clone 下来即可安装，**无需在目标机器构建**（要求 Node ≥ 20 运行 dsh 即可）。

```bash
# SSH（需配置 GitHub ssh key；私有/公开仓库均可）
dsh plugin --profile web add git+ssh://git@github.com:DragonFive/dsh-session-manager.git

# 或 HTTPS（公开仓库）
dsh plugin --profile web add https://github.com/DragonFive/dsh-session-manager.git

# 或指定分支/标签
dsh plugin --profile web add git+ssh://git@github.com:DragonFive/dsh-session-manager.git#main
```

### 本地开发安装（file: 快照）

```bash
git clone git@github.com:DragonFive/dsh-session-manager.git
cd dsh-session-manager
pnpm install && pnpm run build     # 改代码后需要；直接安装用已提交的 lib/ 即可
dsh plugin --profile web add file:$(pwd)
# file: 安装是快照式，改代码后需 remove + add 刷新
```

### ⚠️ 安装后必须重启 dsh web

```bash
dsh plugin --profile web add ...   # 安装/升级后
# 然后重启 dsh web 进程（Ctrl+C 后重新 dsh web）
```

**重启前打开页面会出现「面板一直在加载」**：浏览器侧会经 HMR 提前看到新面板，
但 host 半边的 `/api/dsh-session-manager/*` 路由只在进程启动时注册——这是 DSH 插件机制的
固有行为（同 dsh-trellis 的说明：替换已加载的包版本后需重启对应 DSH 进程）。
升级插件版本同理：`dsh plugin update`（或 remove + add）后必须重启。

安装并重启后：设置 → 插件 应显示 dsh-session-manager 已启用；侧栏出现「会话看板」与
「Trellis 看板」图标；会话行 "..." 菜单出现「标注…」；输入框 `/p` 弹出提示词面板；
设置 → Plugins 分区出现「提示词库」标签页。

## 配置（可选）

cordis 插件配置（profile 的配置层）支持两个字段：

- `storageDir`：sidecar 目录（默认 `~/.dsh/storages/dsh-session-manager`）；
- `taxonomy`：首次创建 store 时的分类树种子（结构同 POST /taxonomy；非法值启动即报错）。

运行时配置（走插件自己的路由 + `settings.json` sidecar，改动即时生效，无需重启）：

- 提示词库文件路径：Settings → Plugins →「提示词库」标签页，或 `POST /api/dsh-session-manager/prompts/config`；
- **Trellis 导出根目录**：Trellis 看板 →「导出到笔记」导出区内直接修改，或
  `POST /api/dsh-session-manager/trellis/config`（body `{"exportRoot": "/abs/path"}`，`null` 恢复默认
  `~/ob_note/projects/`；支持 `~` 前缀）。导出目标文件必须位于该根目录之下，越界一律 400。

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
- **P3 归档占位**：`.trellis/tasks/archive/` 一律不读（含其下 task.json）。父任务 `children[]`
  引用了目录已不在 `tasks/` 下的任务时，渲染为「已归档」占位并计入完成度 n/m——trellis
  `cmd_archive` 先把状态翻成 completed 再移目录，"引用还在但目录不在"即"已完成已归档"；
  代价是占位行没有 title/completedAt 等明细（显示目录名）。
- **P3 锚点替换**：用 `indexOf` + `slice` 的纯字符串拼接（不用正则、不改行尾），保证锚点区块外
  的内容逐字节保留；笔记按 utf8 读写。写前 `copyFile` 生成 `<file>.bak.<时间戳>`，正文经
  临时文件 + rename 原子落盘（store 同款）。
- **P3 导出 Toast**：成功/失败提示用 ui-primitives 官方 `Toast` 组件（body portal、自动消隐），
  同时保留内联详情行（含文件与备份路径）便于复制。

## 开发知识库（docs/）

- [docs/dsh-plugin-api.md](docs/dsh-plugin-api.md) — DSH 第三方插件 API 调研：manifest、host/client 结构、
  Connection Fetch 路由、slot 契约、tsdown 构建配方、升级兼容策略。**新会话开发前必读**。
- [docs/p1-implementation-notes.md](docs/p1-implementation-notes.md) — P1 落地实测的 API 事实
  （shell.overlay 弹窗模式、ui-primitives 基线、ctx.get 可选服务等）与勘误。
- [docs/p3-implementation-notes.md](docs/p3-implementation-notes.md) / [docs/p3-check-notes.md](docs/p3-check-notes.md) —
  P3 设计决策与检查轮修复记录（导出安全、树组装防御）。

## 多机协作约定

- **开发机**（如 Mac）：clone → 改代码 → `pnpm run build` + `node --test` 全绿 →
  `dsh plugin --profile web remove dsh-session-manager && dsh plugin --profile web add file:$(pwd)` →
  重启本机 dsh web 冒烟 → commit + push。
- **生产机**（910C103）：从 GitHub 拉取合格版本安装：
  `dsh plugin --profile web add git+ssh://git@github.com:DragonFive/dsh-session-manager.git#<commit或tag>`（需重启）。
  升级 = remove + add 新 ref + 重启。
- 版本基线：开发于 dsh `0.1.7-alpha.2`；换机后先 `dsh -V` 对齐，版本不同需同步调整
  package.json 的 `engines.dsh` 与 peerDependencies 范围。
