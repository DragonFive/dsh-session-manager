# P3 实施笔记（implementation-verified facts）

实施 `dsh-session-manager` P3（Trellis 里程碑看板 + 笔记导出）过程中验证的事实与设计决策，
供 check agent 与后续维护参考。所有条目有本机代码 / 真实数据佐证。

## 真实数据验证（2026-10-01，workspace = xllm）

- `collectTrellisWorkspaces`（workspaceRegistry ∪ sessionQuery cwd）扫 xllm：**7 个父任务卡片、
  16 个独立任务、0 孤儿、1 条读取警告**（`09-24-review-simplify-pr-batching` 目录缺 task.json，
  真实存在的数据瑕疵，按警告处理不崩溃）。
- `10-01-glm53-cp-pd-dflash2-incremental-roadmap`：9 个子任务，完成度 **6/9**——m0/m1/m2/m3/m5/m6
  已被 trellis 归档（目录在 `.trellis/tasks/archive/2026-10/` 下，不读），m4/m7/m8 为 planning。
  与 ob_note 笔记 M0–M8 状态（6✅ 1取消 2未开始）一致 → **AC1 数据面已验证**。
- host 路由全链路冒烟通过（fake cordis ctx + Request/Response）：GET /trellis 200、
  GET/POST /trellis/config（默认根 `~/ob_note/projects` 正确解析为
  `/export/home/maxiaolong/ob_note/projects`）、POST /trellis/export（新建/替换/备份/越界 400）。
  锚点区块外人工内容逐字节保留已验证（前缀+后缀包裹后二次导出）。

## 关键设计决策（与 PRD/dispatch 的偏差与理由）

1. **归档子任务 = 占位 + 计入完成度**：dispatch 要求 archive 目录跳过，但父任务 `children[]`
   仍引用已归档任务。处置：占位子任务（`missing: true, status: "archived"`），**计入 n/m 分子**
   （trellis `cmd_archive` 先翻 completed 再移目录，本仓库 archive/ 下 m0/m6 的 task.json
   status 均为 completed 可佐证）。代价：占位行无 title/completedAt 明细，显示目录名。
   这是 AC1「9 个子任务 + 完成度与实际一致」在不读 archive 前提下的唯一解。
2. **默认导出根目录**写作 `join(homedir(), "ob_note", "projects")` 而非硬编码
   `/export/home/maxiaolong/ob_note/projects`——同一台机器结果相同，换机可移植。
3. **markdown 仪表盘列为 `# | 里程碑 | 状态 | 进度 | 完成时间`**：ob_note 样板的「验收标准」列
   task.json 中无对应字段（description 过长且非验收标准），改列「进度」；完成时间在归档占位行
   为 —（archive 不读，取不到 completedAt），属已知限制。
4. **导出范围**：只导出父任务卡片（里程碑）+ 孤儿 + 警告；独立任务（无子任务的根任务）只在
   面板显示、不进导出（dispatch 的导出规格只要求仪表盘 + 父任务卡片）。
5. **workspace 聚合**：workspaceRegistry 的 workspace 恒出现在响应中（无 .trellis 标
   `hasTrellis:false`，面板显示空态）；sessionQuery cwd 推导的根目录**只有含 .trellis 才出现**
   （避免无关临时目录刷屏）。dispatch 两种写法（"不出现或标记空态"）都允许。
6. **Toast**：官方 ui-primitives 有 `Toast` 组件（`{text, tone, icon, onDone}`，tone="success"
   带绿勾），导出成功/失败用它 + 内联详情行，满足"成功/失败 toast"要求。

## API 事实（P3 新用到，P1/P2 笔记未覆盖）

- `Toast` 是受控组件不是全局服务：自持 `useState` + `onDone` 回调清理，body portal，
  默认 hold 后自动淡出。`tone: "success"` 渲染内建绿勾；其他 tone 传 `icon` 节点。
- ui-primitives 是 ESM（`export { ... }` 单语句，~380 个导出）；校验 bundle 引用符号是否存在
  要解析 export 语句，不能 grep `exports.X =`（那是 CJS）。P3 新增引用
  `IconBranchOutlineRegular` / `IconWarningOutlineRegular` / `Toast` 均在官方导出表中
  （构建产物已程序化核对，8/8 符号通过）。
- **JSDoc 块注释里不能出现 `tasks/*/task.json` 这类 glob**——`*/` 会提前终结 `/** */` 注释，
  Node 报 SyntaxError（实施时真实踩到）。

## 工程结论

- 仓库 `/export/home/maxiaolong/github_xllm/dsh-session-manager`：`pnpm run build` 通过
  （client 89.8KB + host 8 文件）；`node --test "test/*.test.js"` **66/66 全绿**
  （P1/P2 原 48 + P3 新增 18）。
- 新增文件：`src/host/trellis.js`（扫描/树组装/markdown/锚点导出/配置）、
  `src/client/trellis-panel.jsx`、`test/trellis.test.js`；改动：host routes/index、client
  index/api/locales/styles、README、package.json（description/keywords）。
- 未动：`~/.dsh/profiles/web`、运行中 dsh 进程、xllm 产品代码、`.trellis` 任何文件（只读）。
