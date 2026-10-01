# P3 Check Agent 复核记录（2026-10-01）

结论：**修复后通过**。修复 4 个真实 bug + 1 项加固，测试 66→72 全绿，build 通过。

## 发现并修复的问题（均在 src/host/trellis.js，测试钉死于 test/trellis.test.js）

1. **互引收养环 → RangeError 栈溢出（critical）**：两个无 parent 的任务互相把对方写进
   自己的 `children[]`（task.json 手改可造出）→ 双方各自被对方收养 → children 图成环 →
   `finalizeNode` 无限递归 → 整个 GET /trellis 500。修复：attachment 后新增
   `defuseChildGraphCycles`（迭代式着色 DFS，自身无递归），环成员解除挂接、按孤儿列出并警告。
   复现脚本修复前 `RangeError: Maximum call stack size exceeded`，修复后 2 孤儿 + 2 警告。
2. **活任务被伪装成已归档占位（数据错误）**：`children[]` 引用了一个存在于 nodes 但未挂接到
   本父任务的任务（多父引用的独立任务 / 环成员）时，旧代码照样生成 `missing:true,
   status:"archived"` 占位 → 活的 planning 任务被显示为已归档、完成度虚高（复现：1/1）。
   修复：仅当 `!nodes.has(ref)`（磁盘上真的没有该任务目录）才生成占位。
3. **符号链接绕过导出根目录（安全，dispatch 明确要求 realpath）**：旧代码只做 `resolve()`
   词法前缀检查，导出根内一个指向外部的 symlink 即可把笔记写到任意目录（复现成功逃逸）。
   修复：`realpathWithin`（最深存在祖先 realpath + 不存在尾巴原样拼接）解析 root 与 target
   真实路径后复查前缀；目标文件本身是外指 symlink 同样拒绝；合法的未创建子目录路径不受影响。
4. **残缺锚点静默追加 → 下次导出吞内容（延迟数据丢失）**：笔记只有 start 无 end 锚点时旧代码
   直接追加新块；下一次导出会把"旧 start ～ 新 end"之间的人工内容整段替换掉。修复：
   start 无 end、或存在多个锚点区块 → 抛 TrellisError（400），提示先修笔记。
5. **加固（非 bug）**：(a) 导出根/目标不得位于任何 `.trellis` 路径段下（配置 setRoot 与
   exportTrellisNote 双重校验）——把"只读纪律"从约定升级为代码强制；(b)
   `collectTrellisWorkspaces` 对单 workspace 扫描异常 fail-soft（警告条目而非整面板 500）；
   (c) 面板 `activeWorkspaces` 过滤改为 `hasTrellis || warnings.length>0`，扫描失败的工作区
   显示警告行而不是凭空消失。

## 真实数据复验（只读，修复后代码）

- xllm workspace：**7 父任务 / 16 独立 / 0 孤儿 / 1 警告**（`09-24-review-simplify-pr-batching`
  缺 task.json，真实数据瑕疵），与实施笔记一致。
- roadmap 父任务 **6/9**：m0/m1/m2/m3/m5/m6 归档占位（archive/2026-10/ 下实测 m0/m6/m2 的
  task.json status 均为 completed、completedAt 2026-10-01 → "归档占位计入完成度"决策与真实
  数据吻合）；m4/m7/m8 planning。与 ob_note 笔记（6✅ 1取消 2未开始）一致。
- client bundle 符号与官方 ui-primitives 导出表交叉核对 10/10 通过（含新引用
  IconBranchOutlineRegular / IconWarningOutlineRegular / Toast）；panellist order：
  官方 plugin-manager 0 / dsm-board 500 / dsm-trellis 600，无冲突；main keyed slot 注册
  与 P1 同构。
- P1/P2 回归：routes.js diff 零删除行（纯增量）；P1/P2 全部源文件与测试文件零改动；
  node --test 72/72；pnpm run build 全绿。

## AC 状态（check 视角）

- AC1/AC2/AC3/AC6：数据面 + 测试面通过（AC1/AC2/AC3 的浏览器渲染面待 dsh web 重启冒烟，
  本次按行动规则未动 3080 进程）。
- AC4：通过（逐字节保留/备份/原子写/锚点边界均有测试钉死，本次补齐残缺锚点与 symlink 边界）。
- AC5：逻辑通过（刷新 = 重新 fetch，真实数据复验证明组装反映 task.json 现状）；UI 面待冒烟。
- AC7：**未满足**——ob_note dsh-session-manager 笔记 P3 行当前为"🟡 代码完成，待重启冒烟"，
  需主会话完成收尾（重启冒烟 + trellis finish 流程）后经导出功能更新。
