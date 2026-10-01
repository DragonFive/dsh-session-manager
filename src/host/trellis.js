/**
 * Trellis milestone board (P3, parent design.md §3.4).
 *
 * Three responsibilities, all host-side:
 *
 * 1. **Read-only scan** of `<workspace>/.trellis/tasks/<dir>/task.json`
 *    (`scanTrellisTasks`). The `.trellis` tree is NEVER written — status
 *    changes stay in the trellis CLI workflow (PRD R4.4). Defensive parsing:
 *    corrupt JSON, oversized files, and missing task.json files are skipped
 *    with a warning instead of crashing the route. The `archive/`
 *    subdirectory is skipped entirely.
 * 2. **Tree assembly**: `parent` / `children` are cross-checked both ways.
 *    A `children` entry without a live task.json (archived or deleted
 *    elsewhere) becomes a placeholder counted as completed — in this Trellis
 *    workflow `cmd_archive` flips a task to `completed` and moves it in the
 *    same call, so an absent child of a live parent means "done and
 *    archived". Tasks whose `parent` points at a missing directory are
 *    listed as orphans; parent/child cycles are defused into orphans too.
 * 3. **Markdown export** (`renderTrellisMarkdown` / `exportTrellisNote`) in
 *    the user's ob_note roadmap style: one dashboard table per workspace
 *    plus a card per parent task. The exported content is wrapped in HTML
 *    comment anchors; only the anchored block is ever replaced — everything
 *    outside it is preserved byte-for-byte. A `.bak.<timestamp>` copy is
 *    written before every modification of an existing note, and the target
 *    path must live inside the configured export root (default
 *    `~/ob_note/projects`), which itself lives in the plugin settings
 *    sidecar next to annotations.json (the P2 promptsFile pattern).
 *
 * @module dsh-session-manager/trellis
 */
import { copyFile, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

/** Anchors wrapping the plugin-managed block inside an exported note. */
export const EXPORT_START_ANCHOR = "<!-- dsh-session-manager:trellis-export:start -->";
export const EXPORT_END_ANCHOR = "<!-- dsh-session-manager:trellis-export:end -->";

/** Default note export root (ob_note projects directory). */
export const DEFAULT_EXPORT_ROOT = join(homedir(), "ob_note", "projects");

/** task.json larger than this is skipped with a warning (parse defense). */
const MAX_TASK_JSON_BYTES = 1 << 20; // 1 MiB

/** Subdirectory names never scanned (archived task trees). */
const SKIPPED_DIR_NAMES = new Set(["archive"]);

/** A user-facing trellis failure (maps to HTTP 400 on the routes). */
export class TrellisError extends Error {
  constructor(message) {
    super(message);
    this.name = "TrellisError";
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// 1. Scan + tree assembly
// ---------------------------------------------------------------------------

/**
 * Scan one workspace root read-only.
 * @param {string} workspaceRoot absolute path of the workspace
 * @param {{ logger?: { warn(message: string): void } }} [options]
 * @returns {Promise<{ hasTrellis: boolean, roots: object[], standalone: object[],
 *                     orphans: object[], warnings: string[] }>}
 *   `roots` are top-level tasks with children (parent cards), `standalone`
 *   are childless top-level tasks, `orphans` have a dangling `parent`.
 */
export async function scanTrellisTasks(workspaceRoot, { logger = console } = {}) {
  const tasksDir = join(workspaceRoot, ".trellis", "tasks");
  let entries;
  try {
    entries = await readdir(tasksDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { hasTrellis: false, roots: [], standalone: [], orphans: [], warnings: [] };
    }
    if (error?.code === "ENOTDIR" || error?.code === "EACCES" || error?.code === "EPERM") {
      return {
        hasTrellis: false,
        roots: [],
        standalone: [],
        orphans: [],
        warnings: [`.trellis/tasks 无法读取（${error.code}）`],
      };
    }
    throw error;
  }

  const warnings = [];
  const nodes = new Map(); // dir name → internal node
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (SKIPPED_DIR_NAMES.has(entry.name)) continue; // 归档目录不读
    const file = join(tasksDir, entry.name, "task.json");
    let raw;
    let mtimeMs = 0;
    try {
      const info = await stat(file);
      if (!info.isFile()) {
        warnings.push(`跳过非普通文件：.trellis/tasks/${entry.name}/task.json`);
        continue;
      }
      if (info.size > MAX_TASK_JSON_BYTES) {
        warnings.push(`跳过超大 task.json（${info.size} 字节）：${entry.name}`);
        continue;
      }
      mtimeMs = info.mtimeMs;
      raw = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") {
        warnings.push(`任务目录缺少 task.json：${entry.name}`);
        continue;
      }
      if (error instanceof SyntaxError) {
        warnings.push(`task.json 不是合法 JSON，已跳过：${entry.name}`);
        continue;
      }
      throw error;
    }
    if (!isPlainObject(raw)) {
      warnings.push(`task.json 根节点不是对象，已跳过：${entry.name}`);
      continue;
    }
    nodes.set(entry.name, makeNode(entry.name, raw, mtimeMs));
  }

  return assembleTree(nodes, warnings, logger);
}

/** Normalize one parsed task.json into an internal node. */
function makeNode(dirName, raw, mtimeMs) {
  const children = Array.isArray(raw.children)
    ? raw.children.filter((ref) => typeof ref === "string" && ref.trim() !== "")
    : [];
  return {
    dir: dirName,
    title: textOf(raw.title) ?? dirName,
    status: textOf(raw.status) ?? "unknown",
    priority: textOf(raw.priority),
    branch: textOf(raw.branch),
    prUrl: textOf(raw.pr_url),
    completedAt: textOf(raw.completedAt),
    parent: textOf(raw.parent),
    rawChildren: children,
    mtimeMs,
    children: [],
    missing: false,
  };
}

function textOf(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Cross-check parent/children both ways and split into roots / standalone /
 * orphans, then compute per-node rollups (completedCount, activity time).
 */
function assembleTree(nodes, warnings, logger = console) {
  // Who references each dir as a child?
  const referrers = new Map();
  for (const node of nodes.values()) {
    for (const ref of node.rawChildren) {
      if (ref === node.dir) {
        warnings.push(`任务 ${node.dir} 的 children 引用了自己，已忽略该引用`);
        continue;
      }
      const list = referrers.get(ref) ?? [];
      list.push(node.dir);
      referrers.set(ref, list);
    }
  }

  const inCycle = (node) => {
    const seen = new Set([node.dir]);
    let current = node.parent !== null ? nodes.get(node.parent) : undefined;
    while (current !== undefined) {
      if (seen.has(current.dir)) return true;
      seen.add(current.dir);
      current = current.parent !== null ? nodes.get(current.parent) : undefined;
    }
    return false;
  };

  const roots = [];
  const orphans = [];
  for (const node of nodes.values()) {
    if (node.parent !== null) {
      if (!nodes.has(node.parent)) {
        // Dangling parent reference → orphan (kept with its own subtree).
        orphans.push(node);
        continue;
      }
      if (inCycle(node)) {
        warnings.push(`任务 ${node.dir} 处于父子循环引用中，按孤儿任务处理`);
        orphans.push(node);
        continue;
      }
      nodes.get(node.parent).children.push(node);
      continue;
    }
    const refs = referrers.get(node.dir);
    if (refs !== undefined && refs.length === 1) {
      // No parent field, but exactly one live parent lists it → adopt.
      nodes.get(refs[0]).children.push(node);
    } else {
      if (refs !== undefined && refs.length > 1) {
        warnings.push(`任务 ${node.dir} 被多个父任务引用（${refs.join("、")}），按独立任务处理`);
      }
      roots.push(node);
    }
  }

  // Adoption can still produce cycles in the attached children graph (e.g.
  // two parentless tasks listing each other in children[]): defuse them
  // before any recursion so rollups and rendering always terminate.
  defuseChildGraphCycles(nodes, orphans, warnings);

  // Order each parent's children by its raw children[] order; entries with
  // no live task.json become archived placeholders (counted as completed).
  const orphanDirs = new Set(orphans.map((node) => node.dir));
  for (const node of nodes.values()) {
    if (node.rawChildren.length === 0) continue;
    const live = new Map(node.children.map((child) => [child.dir, child]));
    const ordered = [];
    const seen = new Set();
    for (const ref of node.rawChildren) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      const child = live.get(ref);
      if (child !== undefined) {
        ordered.push(child);
      } else if (!nodes.has(ref)) {
        // Referenced nowhere in the live tree (archived or deleted on disk)
        // → archived placeholder counted as completed.
        ordered.push({
          dir: ref,
          title: ref,
          status: "archived",
          priority: null,
          branch: null,
          prUrl: null,
          completedAt: null,
          parent: node.dir,
          rawChildren: [],
          mtimeMs: 0,
          children: [],
          missing: true,
        });
      }
      // else: the referenced task exists but is detached (orphan, cycle
      // member, or multi-referenced standalone) — it is listed in its own
      // section, so no fake "archived" placeholder is created here.
    }
    for (const child of node.children) {
      if (!seen.has(child.dir) && !orphanDirs.has(child.dir)) ordered.push(child);
    }
    node.children = ordered;
  }

  for (const node of nodes.values()) finalizeNode(node);
  for (const node of orphans) finalizeNode(node);

  const byActivity = (left, right) => right.subtreeMtime - left.subtreeMtime;
  const parents = roots.filter((node) => node.children.length > 0).sort(byActivity);
  const standalone = roots.filter((node) => node.children.length === 0).sort(byActivity);
  orphans.sort(byActivity);
  if (warnings.length > 0) {
    logger.warn?.(`[dsh-session-manager] trellis 扫描警告：${warnings.join("；")}`);
  }
  return {
    hasTrellis: true,
    roots: parents.map(toPublicNode),
    standalone: standalone.map(toPublicNode),
    orphans: orphans.map(toPublicNode),
    warnings,
  };
}

/**
 * Defuse cycles in the attached children graph. Parent-pointer cycles are
 * already caught by the `parent` walk above, but *adoption* can still create
 * them: two parentless tasks that list each other in `children[]` get adopted
 * into each other, and the recursive rollup/render passes would then recurse
 * forever. Every cycle member (found with an iterative colored DFS — itself
 * recursion-free) is detached from its parent and reported as an orphan.
 */
function defuseChildGraphCycles(nodes, orphans, warnings) {
  const color = new Map(); // dir → 1 = on stack, 2 = done
  const members = new Set();
  for (const start of nodes.values()) {
    if (color.get(start.dir) === 2) continue;
    color.set(start.dir, 1);
    const stack = [{ node: start, next: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.next < frame.node.children.length) {
        const child = frame.node.children[frame.next++];
        const state = color.get(child.dir);
        if (state === 1) {
          // Back edge: everything from `child` up the stack is the cycle.
          for (let i = stack.length - 1; i >= 0; i -= 1) {
            members.add(stack[i].node.dir);
            if (stack[i].node.dir === child.dir) break;
          }
        } else if (state === undefined) {
          color.set(child.dir, 1);
          stack.push({ node: child, next: 0 });
        }
      } else {
        color.set(frame.node.dir, 2);
        stack.pop();
      }
    }
  }
  if (members.size === 0) return;
  // Each node lives in at most one children list, so one filter pass detaches
  // every cycle member from its (cycle) parent.
  for (const node of nodes.values()) {
    if (node.children.length > 0) {
      node.children = node.children.filter((child) => !members.has(child.dir));
    }
  }
  for (const dir of members) {
    const node = nodes.get(dir);
    warnings.push(`任务 ${node.dir} 处于父子循环引用中，按孤儿任务处理`);
    orphans.push(node);
  }
}

/** Completed = explicit completed/archived status, or an archived placeholder. */
function isCompleted(node) {
  return node.status === "completed" || node.status === "archived" || node.missing;
}

/** Roll up completion counts, subtree activity, and latest completedAt. */
function finalizeNode(node) {
  let completed = 0;
  let latest = node.mtimeMs;
  let latestCompletedAt = node.completedAt;
  for (const child of node.children) {
    finalizeNode(child);
    if (isCompleted(child)) completed += 1;
    if (child.subtreeMtime > latest) latest = child.subtreeMtime;
    latestCompletedAt = laterDate(latestCompletedAt, child.subtreeCompletedAt);
  }
  node.completedCount = completed;
  node.totalCount = node.children.length;
  node.subtreeMtime = latest;
  node.subtreeCompletedAt = latestCompletedAt;
}

/** Compare two completedAt date strings, keeping the later one (null-safe). */
function laterDate(left, right) {
  if (left === null) return right;
  if (right === null) return left;
  const a = Date.parse(left);
  const b = Date.parse(right);
  if (Number.isNaN(a)) return right;
  if (Number.isNaN(b)) return left;
  return b > a ? right : left;
}

/** Strip internals for the JSON contract. */
function toPublicNode(node) {
  return {
    dir: node.dir,
    title: node.title,
    status: node.status,
    priority: node.priority,
    branch: node.branch,
    prUrl: node.prUrl,
    completedAt: node.completedAt,
    missing: node.missing === true,
    completedCount: node.completedCount,
    totalCount: node.totalCount,
    updatedAt: node.subtreeMtime,
    latestCompletedAt: node.subtreeCompletedAt,
    children: node.children.map(toPublicNode),
  };
}

/**
 * Aggregate the task trees of every registered workspace (plus session-cwd
 * roots that actually contain a .trellis, reusing the P1 board derivation).
 * Workspaces without .trellis stay in the list with hasTrellis=false so the
 * panel can render an explicit empty state instead of an error.
 *
 * @param {{ workspaceRegistry?: { list(): {id: string, path: string, title: string}[] },
 *           sessionQuery?: { listSessions(): Promise<{header: object}[]> },
 *           logger?: object }} deps
 */
export async function collectTrellisWorkspaces(deps) {
  const logger = deps.logger ?? console;
  const found = new Map(); // resolved path → { id, title, alwaysListed }
  const register = (path, meta, alwaysListed) => {
    if (typeof path !== "string" || path === "") return;
    const key = resolve(path);
    const existing = found.get(key);
    if (existing === undefined) {
      found.set(key, { id: meta.id ?? null, title: meta.title ?? null, alwaysListed });
    } else {
      if (existing.id === null) existing.id = meta.id ?? null;
      if (existing.title === null) existing.title = meta.title ?? null;
      existing.alwaysListed = existing.alwaysListed || alwaysListed;
    }
  };

  try {
    for (const workspace of deps.workspaceRegistry?.list() ?? []) {
      register(workspace.path, workspace, true);
    }
  } catch {
    // Registry read is fail-soft (P1 board rule).
  }
  try {
    if (deps.sessionQuery !== undefined && deps.sessionQuery !== null) {
      for (const record of await deps.sessionQuery.listSessions()) {
        const cwd = record?.header?.cwd;
        if (typeof cwd === "string" && cwd !== "") register(cwd, { title: basename(cwd) }, false);
      }
    }
  } catch {
    // Session-derived roots are an enhancement, never a hard dependency.
  }

  const workspaces = [];
  for (const [path, meta] of found) {
    let scanned;
    try {
      scanned = await scanTrellisTasks(path, { logger });
    } catch (error) {
      // One pathological workspace (e.g. an absurdly deep task tree that
      // overflows the serializer) must not break the whole board.
      const message = `扫描失败，已跳过（${error?.name ?? "Error"}）：${path}`;
      logger.warn?.(`[dsh-session-manager] trellis ${message}`);
      workspaces.push({
        id: meta.id,
        title: meta.title ?? basename(path),
        path,
        hasTrellis: false,
        roots: [],
        standalone: [],
        orphans: [],
        warnings: [message],
      });
      continue;
    }
    if (!meta.alwaysListed && !scanned.hasTrellis) continue; // cwd roots: only when useful
    workspaces.push({
      id: meta.id,
      title: meta.title ?? basename(path),
      path,
      hasTrellis: scanned.hasTrellis,
      roots: scanned.roots,
      standalone: scanned.standalone,
      orphans: scanned.orphans,
      warnings: scanned.warnings,
    });
  }
  return workspaces;
}

// ---------------------------------------------------------------------------
// 2. Markdown rendering (ob_note roadmap style)
// ---------------------------------------------------------------------------

/** Chinese status labels (PRD R1.2). */
export const TASK_STATUS_LABELS = Object.freeze({
  planning: "未开始",
  in_progress: "进行中",
  completed: "已完成",
  archived: "已归档",
});

function statusBadge(status) {
  if (status === "completed") return "✅ 已完成";
  if (status === "in_progress") return "🟡 进行中";
  if (status === "archived") return "📦 已归档";
  if (status === "planning") return "⬜ 未开始";
  return status;
}

function escapeCell(value) {
  return String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function escapeHeading(value) {
  return String(value ?? "").replaceAll("\n", " ").trim();
}

function markdownLink(url) {
  const safe = String(url).replaceAll("(", "%28").replaceAll(")", "%29");
  return `[PR](${safe})`;
}

/**
 * Render the anchored-block content (WITHOUT the anchors themselves) for the
 * aggregated workspace trees: one dashboard table per workspace plus a card
 * per parent task with its subtask table.
 *
 * @param {object[]} workspaces output of collectTrellisWorkspaces
 * @param {{ generatedAt?: string }} [options]
 */
export function renderTrellisMarkdown(workspaces, { generatedAt = new Date().toISOString() } = {}) {
  const lines = [];
  lines.push(`> 由 dsh-session-manager Trellis 看板导出于 ${generatedAt}（\`.trellis\` 只读快照）。`);
  lines.push("> 锚点区块外的内容不会被本插件修改；每次写前生成 \`.bak.<时间戳>\` 备份。", "");
  for (const workspace of workspaces) {
    if (!workspace.hasTrellis) continue;
    lines.push(`## 📊 总览仪表盘 — ${escapeHeading(workspace.title)}`, "");
    if (workspace.roots.length === 0) {
      lines.push(
        `（${escapeHeading(workspace.title)} 的 \`.trellis/tasks\` 下没有带子任务的父任务；` +
          `独立任务 ${workspace.standalone.length} 个）`,
        "",
      );
    } else {
      lines.push("| # | 里程碑 | 状态 | 进度 | 完成时间 |");
      lines.push("|---|--------|------|------|----------|");
      workspace.roots.forEach((root, index) => {
        lines.push(
          `| ${index + 1} | ${escapeCell(root.title)} | ${statusBadge(root.status)} | ` +
            `${root.completedCount}/${root.totalCount} | ${escapeCell(root.latestCompletedAt)} |`,
        );
      });
      lines.push("");
      workspace.roots.forEach((root, index) => pushParentCard(lines, root, index + 1));
    }
    if (workspace.orphans.length > 0) {
      lines.push(`### ⚠️ 孤儿任务 — ${escapeHeading(workspace.title)}`, "");
      lines.push("| 任务 | 状态 | 说明 |");
      lines.push("|------|------|------|");
      for (const orphan of workspace.orphans) {
        lines.push(`| ${escapeCell(orphan.title)} | ${statusBadge(orphan.status)} | parent 指向不存在的任务 |`);
      }
      lines.push("");
    }
    if (workspace.warnings.length > 0) {
      lines.push(`<details><summary>读取警告（${workspace.warnings.length} 条）</summary>`, "");
      lines.push("```", workspace.warnings.join("\n"), "```", "", "</details>", "");
    }
  }
  return lines.join("\n");
}

function pushParentCard(lines, root, ordinal) {
  lines.push(`### ${ordinal}. ${escapeHeading(root.title)}`, "");
  const meta = [
    `状态：${statusBadge(root.status)}`,
    `进度：${root.completedCount}/${root.totalCount}`,
  ];
  if (root.priority !== null) meta.push(`优先级：${root.priority}`);
  if (root.branch !== null) meta.push(`分支：\`${root.branch}\``);
  if (root.prUrl !== null) meta.push(`PR：${markdownLink(root.prUrl)}`);
  meta.push(`目录：\`.trellis/tasks/${root.dir}\``);
  lines.push(meta.join(" · "), "");
  lines.push("| 子任务 | 状态 | 分支 | PR | 完成时间 |");
  lines.push("|--------|------|------|----|----------|");
  if (root.children.length === 0) {
    lines.push("| — | — | — | — | — |");
  } else {
    pushChildRows(lines, root.children, 1);
  }
  lines.push("");
}

function pushChildRows(lines, children, depth) {
  const indent = "　".repeat(depth - 1);
  for (const child of children) {
    lines.push(
      `| ${indent}${escapeCell(child.title)} | ${statusBadge(child.status)} | ` +
        `${child.branch !== null ? `\`${child.branch}\`` : "—"} | ` +
        `${child.prUrl !== null ? markdownLink(child.prUrl) : "—"} | ${escapeCell(child.completedAt)} |`,
    );
    if (child.children.length > 0) pushChildRows(lines, child.children, depth + 1);
  }
}

// ---------------------------------------------------------------------------
// 3. Anchored note export
// ---------------------------------------------------------------------------

/**
 * Resolve `path` against the real filesystem: symlinks on every existing
 * ancestor are expanded, a non-existent tail is kept verbatim. This is what
 * makes the export-root prefix check symlink-proof (design §3.4: writes only
 * ever land in the user-configured export root).
 */
async function realpathWithin(path) {
  let prefix = path;
  const tail = [];
  for (;;) {
    try {
      return join(await realpath(prefix), ...tail);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      tail.unshift(basename(prefix));
      const parent = dirname(prefix);
      if (parent === prefix) return path; // reached the filesystem root
      prefix = parent;
    }
  }
}

/**
 * The `.trellis` tree is strictly read-only (PRD R4.4 / parent design §3.4):
 * exports must never target it, not even via a user-misconfigured root or a
 * symlink pointing into it.
 */
function assertNotInsideTrellis(path, what) {
  if (path.split(sep).includes(".trellis")) {
    throw new TrellisError(`${what}不能位于 .trellis 目录内（.trellis 为只读）：${path}`);
  }
}

/** Wrap rendered content in the plugin's HTML comment anchors. */
export function buildExportBlock(content) {
  return `${EXPORT_START_ANCHOR}\n${String(content).trim()}\n${EXPORT_END_ANCHOR}`;
}

/**
 * Splice a new anchored block into an existing note:
 * - both anchors present → only the anchored block (first start anchor to
 *   the first end anchor after it) is replaced, everything outside it is
 *   preserved byte-for-byte;
 * - no anchors → the block is appended at the end;
 * - empty note → null (the caller builds a fresh document);
 * - a start anchor without a matching end anchor, or more than one anchored
 *   block, means the note was hand-mangled: refusing (TrellisError) is
 *   safer than guessing — a silent append would let the NEXT export absorb
 *   whatever sits between the stale anchor and the new block.
 *
 * @param {string} existingText
 * @param {string} block output of buildExportBlock
 * @returns {string | null}
 * @throws {TrellisError} on a dangling start anchor or duplicate blocks
 */
export function applyAnchoredExport(existingText, block) {
  if (typeof existingText !== "string" || existingText === "") return null;
  const start = existingText.indexOf(EXPORT_START_ANCHOR);
  if (start !== -1) {
    const end = existingText.indexOf(EXPORT_END_ANCHOR, start + EXPORT_START_ANCHOR.length);
    if (end === -1) {
      throw new TrellisError("笔记中存在残缺的导出锚点（有 start 无 end），请先修复笔记后再导出");
    }
    const after = end + EXPORT_END_ANCHOR.length;
    if (existingText.indexOf(EXPORT_START_ANCHOR, after) !== -1) {
      throw new TrellisError("笔记中存在多个导出锚点区块，请删除多余的旧区块后再导出");
    }
    return existingText.slice(0, start) + block + existingText.slice(after);
  }
  const separator = existingText.endsWith("\n") ? "" : "\n";
  return `${existingText}${separator}${block}\n`;
}

/** Frontmatter + heading for a note that does not exist yet. */
export function buildNewNote(fileName, block, { now = new Date().toISOString() } = {}) {
  const stem = basename(fileName).replace(/\.md$/i, "");
  const date = now.slice(0, 10);
  return [
    "---",
    "type: project-tracker",
    `project: ${stem}`,
    `created: ${date}`,
    `updated: ${date}`,
    "aliases:",
    `  - ${stem}`,
    "tags:",
    "  - project/trellis",
    "  - status/active",
    "---",
    "",
    `# ${stem} — Trellis 里程碑看板`,
    "",
    "> 本笔记由 dsh-session-manager 插件的 Trellis 看板导出维护。",
    "> HTML 注释锚点包围的区块每次导出整体替换；区块外的人工内容逐字节保留；",
    "> 每次写入前生成 `.bak.<时间戳>` 备份。",
    "",
    block,
    "",
  ].join("\n");
}

/**
 * Render, anchor, and write the export note (with backup + atomic write).
 * The resolved target must be the export root itself or live under it.
 *
 * @param {{ workspaces: object[], targetFile: string, exportRoot: string,
 *           now?: () => string, logger?: object }} options
 * @returns {Promise<{ file: string, backup: string | null, created: boolean, bytes: number }>}
 */
export async function exportTrellisNote(options) {
  const { workspaces, targetFile, exportRoot, logger = console } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const root = resolve(exportRoot);
  if (typeof targetFile !== "string" || targetFile.trim() === "") {
    throw new TrellisError("导出目标文件不能为空");
  }
  let target = targetFile.trim();
  if (!isAbsolute(target)) target = join(root, target);
  target = resolve(target);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new TrellisError(`导出路径必须在导出根目录（${root}）之下：${targetFile}`);
  }

  // Symlink hardening: `resolve` alone does not expand symlinks, so a link
  // inside the root could redirect the write outside it. Re-check the prefix
  // on the REAL paths (non-existent tails are kept verbatim).
  let rootReal;
  let targetReal;
  try {
    rootReal = await realpathWithin(root);
    targetReal = await realpathWithin(target);
  } catch (error) {
    throw new TrellisError(`导出路径无法解析（符号链接或权限问题）：${error?.message ?? targetFile}`);
  }
  assertNotInsideTrellis(rootReal, "导出根目录");
  assertNotInsideTrellis(targetReal, "导出目标");
  if (targetReal !== rootReal && !targetReal.startsWith(rootReal + sep)) {
    throw new TrellisError(`导出路径必须实际位于导出根目录（${root}）之下：${targetFile}`);
  }

  try {
    const info = await stat(target);
    if (info.isDirectory()) throw new TrellisError(`导出目标是一个目录：${target}`);
  } catch (error) {
    if (error instanceof TrellisError) throw error;
    if (error?.code !== "ENOENT") {
      if (error?.code === "EACCES" || error?.code === "EPERM") {
        throw new TrellisError(`导出目标无法访问：${target}`);
      }
      throw error;
    }
  }

  let existing = null;
  try {
    existing = await readFile(target, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      if (error?.code === "EISDIR" || error?.code === "EACCES") {
        throw new TrellisError(`导出目标无法读取：${target}`);
      }
      throw error;
    }
  }

  const block = buildExportBlock(renderTrellisMarkdown(workspaces, { generatedAt: now() }));
  let document;
  let created = false;
  if (existing === null) {
    document = buildNewNote(target, block, { now: now() });
    created = true;
  } else {
    document = applyAnchoredExport(existing, block);
  }

  let backup = null;
  if (existing !== null) {
    backup = `${target}.bak.${now().replaceAll(":", "-").replaceAll(".", "-")}`;
    await copyFile(target, backup);
    logger.warn?.(`[dsh-session-manager] trellis 导出备份：${backup}`);
  }

  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, document, "utf8");
  await rename(tmp, target);
  return { file: target, backup, created, bytes: Buffer.byteLength(document, "utf8") };
}

// ---------------------------------------------------------------------------
// 4. Export-root configuration (settings sidecar, P2 pattern)
// ---------------------------------------------------------------------------

/**
 * Open the export-root configuration handle. The override lives in the
 * plugin's shared settings sidecar (`settings.json`, key
 * `trellisExportRoot`) and is re-read per request, so config edits are live.
 *
 * @param {{ configFile: string, defaultExportRoot?: string, logger?: object }} options
 */
export function openTrellisExport({ configFile, defaultExportRoot = DEFAULT_EXPORT_ROOT, logger = console }) {
  async function readSettings() {
    let text;
    try {
      text = await readFile(configFile, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return {};
      throw error;
    }
    try {
      const parsed = JSON.parse(text);
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      logger.warn?.(`[dsh-session-manager] settings.json 无法解析，已忽略（${configFile}）`);
      return {};
    }
  }

  async function persistSettings(value) {
    const tmp = `${configFile}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(dirname(configFile), { recursive: true });
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmp, configFile);
  }

  function expandRoot(input) {
    let expanded = input.trim();
    if (expanded === "~") expanded = homedir();
    else if (expanded.startsWith("~/")) expanded = join(homedir(), expanded.slice(2));
    if (!isAbsolute(expanded)) {
      throw new TrellisError(`导出根目录必须是绝对路径（支持 ~ 前缀）："${input}"`);
    }
    const resolved = resolve(expanded);
    assertNotInsideTrellis(resolved, "导出根目录");
    return resolved;
  }

  return {
    /** Current effective root (null override = default in use). */
    async getRoot() {
      const settings = await readSettings();
      const raw = settings.trellisExportRoot;
      if (typeof raw === "string" && raw.trim() !== "") {
        return { exportRoot: expandRoot(raw), defaultExportRoot, customized: true };
      }
      return { exportRoot: resolve(defaultExportRoot), defaultExportRoot, customized: false };
    },
    /**
     * Set (`{exportRoot: "/abs"}`) or reset (`{exportRoot: null}`).
     * @param {unknown} input
     */
    async setRoot(input) {
      let value = input;
      if (isPlainObject(input)) value = input.exportRoot;
      else if (typeof input === "string") value = input;
      const settings = await readSettings();
      if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
        delete settings.trellisExportRoot;
      } else {
        if (typeof value !== "string") throw new TrellisError("exportRoot 必须是字符串或 null");
        settings.trellisExportRoot = expandRoot(value);
      }
      await persistSettings(settings);
      return this.getRoot();
    },
  };
}
