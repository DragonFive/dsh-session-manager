/**
 * Trellis board tests (P3):
 * - task.json tree assembly (normal tree, archived-placeholder children,
 *   orphans, cycles, corrupt JSON, oversized files, archive skip, empty dirs);
 * - workspace aggregation (registry ∪ session-cwd roots);
 * - markdown rendering snapshot;
 * - anchored export (replace keeping outside bytes, append, new file with
 *   frontmatter, path-escape rejection, backup creation);
 * - export-root configuration sidecar.
 */
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  DEFAULT_EXPORT_ROOT,
  EXPORT_END_ANCHOR,
  EXPORT_START_ANCHOR,
  TrellisError,
  applyAnchoredExport,
  buildExportBlock,
  buildNewNote,
  collectTrellisWorkspaces,
  exportTrellisNote,
  openTrellisExport,
  renderTrellisMarkdown,
  scanTrellisTasks,
} from "../src/host/trellis.js";
import {
  HttpError,
  ROUTE_PATHS,
  handleGetTrellisConfig,
  handleSetTrellisConfig,
  handleTrellis,
  handleTrellisExport,
} from "../src/host/routes.js";

const SILENT_LOGGER = { warn: () => {} };

/** Create a temp workspace with `.trellis/tasks/<dir>/task.json` files. */
async function makeWorkspace(files) {
  const root = await mkdtemp(join(tmpdir(), "dsm-trellis-ws-"));
  for (const [rel, content] of Object.entries(files)) {
    const target = join(root, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, typeof content === "string" ? content : JSON.stringify(content), "utf8");
  }
  return root;
}

function task(overrides = {}) {
  return {
    title: overrides.title ?? "task",
    status: overrides.status ?? "planning",
    priority: overrides.priority ?? null,
    branch: overrides.branch ?? null,
    pr_url: overrides.pr_url ?? null,
    completedAt: overrides.completedAt ?? null,
    parent: overrides.parent ?? null,
    children: overrides.children ?? [],
    ...overrides.extra,
  };
}

// ---------------------------------------------------------------------------
// Tree assembly
// ---------------------------------------------------------------------------

test("scanTrellisTasks assembles a normal parent/child tree with n/m", async () => {
  const root = await makeWorkspace({
    ".trellis/tasks/parent-a/task.json": task({
      title: "Roadmap A",
      status: "in_progress",
      priority: "P1",
      children: ["child-a1", "child-a2", "child-a3"],
    }),
    ".trellis/tasks/child-a1/task.json": task({ title: "A1", status: "completed", completedAt: "2026-10-01", parent: "parent-a" }),
    ".trellis/tasks/child-a2/task.json": task({ title: "A2", status: "in_progress", parent: "parent-a", branch: "feat/a2", pr_url: "https://example.com/pr/1" }),
    ".trellis/tasks/child-a3/task.json": task({ title: "A3", status: "planning", parent: "parent-a" }),
  });
  const result = await scanTrellisTasks(root, { logger: SILENT_LOGGER });

  assert.equal(result.hasTrellis, true);
  assert.equal(result.roots.length, 1);
  assert.equal(result.standalone.length, 0);
  assert.equal(result.orphans.length, 0);
  const parent = result.roots[0];
  assert.equal(parent.title, "Roadmap A");
  assert.equal(parent.completedCount, 1);
  assert.equal(parent.totalCount, 3);
  assert.deepEqual(
    parent.children.map((child) => child.title),
    ["A1", "A2", "A3"],
  );
  assert.equal(parent.children[1].branch, "feat/a2");
  assert.equal(parent.children[1].prUrl, "https://example.com/pr/1");
  assert.equal(parent.children[0].completedAt, "2026-10-01");
  assert.equal(parent.latestCompletedAt, "2026-10-01");
});

test("children entries without a live dir become archived placeholders counted as completed", async () => {
  const root = await makeWorkspace({
    ".trellis/tasks/parent/task.json": task({
      title: "P",
      status: "in_progress",
      children: ["gone-child", "live-child"],
    }),
    ".trellis/tasks/live-child/task.json": task({ title: "Live", status: "planning", parent: "parent" }),
    // The archive tree is never read, even though the ids are referenced.
    ".trellis/tasks/archive/2026-10/gone-child/task.json": task({ title: "Gone", status: "completed" }),
  });
  const result = await scanTrellisTasks(root, { logger: SILENT_LOGGER });

  const parent = result.roots[0];
  assert.equal(parent.totalCount, 2);
  assert.equal(parent.completedCount, 1); // the archived placeholder
  const placeholder = parent.children[0];
  assert.equal(placeholder.missing, true);
  assert.equal(placeholder.status, "archived");
  assert.equal(placeholder.title, "gone-child");
});

test("archive subdirectory and hidden dirs are skipped entirely", async () => {
  const root = await makeWorkspace({
    ".trellis/tasks/parent/task.json": task({ title: "P", children: ["kid"] }),
    ".trellis/tasks/kid/task.json": task({ title: "Kid", parent: "parent" }),
    ".trellis/tasks/archive/old/task.json": task({ title: "Old", status: "completed" }),
    ".trellis/tasks/archive/task.json": task({ title: "ArchiveRoot" }),
    ".trellis/tasks/.hidden/task.json": task({ title: "Hidden" }),
  });
  const result = await scanTrellisTasks(root, { logger: SILENT_LOGGER });

  const titles = JSON.stringify(result);
  assert.equal(titles.includes("Old"), false);
  assert.equal(titles.includes("ArchiveRoot"), false);
  assert.equal(titles.includes("Hidden"), false);
  assert.equal(result.roots[0].children.length, 1);
});

test("corrupt and non-object task.json are skipped with warnings, not crashes", async () => {
  const root = await makeWorkspace({
    ".trellis/tasks/broken/task.json": "{ not valid json",
    ".trellis/tasks/array/task.json": "[1, 2, 3]",
    ".trellis/tasks/nodajson/dir.txt": "irrelevant",
    ".trellis/tasks/fine/task.json": task({ title: "Fine" }),
  });
  const result = await scanTrellisTasks(root, { logger: SILENT_LOGGER });

  assert.equal(result.standalone.length, 1);
  assert.equal(result.standalone[0].title, "Fine");
  assert.equal(result.warnings.length, 3);
  const joined = result.warnings.join("\n");
  assert.match(joined, /broken/);
  assert.match(joined, /array/);
  assert.match(joined, /nodajson/);
});

test("oversized task.json is skipped with a warning", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsm-trellis-ws-"));
  const dir = join(root, ".trellis", "tasks", "huge");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "task.json"), `${JSON.stringify(task({ title: "Huge" }))} // ${"x".repeat(1 << 20)}`, "utf8");
  await mkdir(join(root, ".trellis", "tasks", "ok"), { recursive: true });
  await writeFile(join(root, ".trellis", "tasks", "ok", "task.json"), JSON.stringify(task({ title: "Ok" })), "utf8");

  const result = await scanTrellisTasks(root, { logger: SILENT_LOGGER });
  assert.equal(result.standalone.length, 1);
  assert.equal(result.standalone[0].title, "Ok");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /超大/);
});

test("dangling parent → orphan; parent/child cycle → orphan with warning", async () => {
  const root = await makeWorkspace({
    ".trellis/tasks/orphan/task.json": task({ title: "Orphan", parent: "no-such-parent" }),
    ".trellis/tasks/cyc-a/task.json": task({ title: "CycA", parent: "cyc-b" }),
    ".trellis/tasks/cyc-b/task.json": task({ title: "CycB", parent: "cyc-a" }),
  });
  const result = await scanTrellisTasks(root, { logger: SILENT_LOGGER });

  assert.equal(result.roots.length, 0);
  assert.equal(result.orphans.length, 3);
  assert.equal(result.warnings.length, 2); // both cycle members reported
  const titles = result.orphans.map((node) => node.title).sort();
  assert.deepEqual(titles, ["CycA", "CycB", "Orphan"]);
});

test("adoption: no parent field but exactly one parent lists it in children", async () => {
  const root = await makeWorkspace({
    ".trellis/tasks/parent/task.json": task({ title: "P", children: ["adopted"] }),
    ".trellis/tasks/adopted/task.json": task({ title: "Adopted", parent: null }),
  });
  const result = await scanTrellisTasks(root, { logger: SILENT_LOGGER });
  assert.equal(result.roots.length, 1);
  assert.equal(result.roots[0].children.length, 1);
  assert.equal(result.roots[0].children[0].title, "Adopted");
});

test("mutual adoption cycle (parentless tasks listing each other) is defused, not a crash", async () => {
  const root = await makeWorkspace({
    ".trellis/tasks/a/task.json": task({ title: "A", parent: null, children: ["b"] }),
    ".trellis/tasks/b/task.json": task({ title: "B", parent: null, children: ["a"] }),
  });
  // Before the cycle defuse this recursion blew the stack (RangeError).
  const result = await scanTrellisTasks(root, { logger: SILENT_LOGGER });
  assert.equal(result.roots.length, 0);
  assert.equal(result.standalone.length, 0);
  assert.equal(result.orphans.length, 2);
  assert.deepEqual(
    result.orphans.map((node) => node.title).sort(),
    ["A", "B"],
  );
  for (const orphan of result.orphans) {
    assert.equal(orphan.children.length, 0); // detached from each other
    assert.equal(orphan.completedCount, 0);
  }
  assert.equal(result.warnings.length, 2); // one per cycle member
});

test("a live task referenced by several parents is never faked as an archived placeholder", async () => {
  const root = await makeWorkspace({
    ".trellis/tasks/pa/task.json": task({ title: "PA", status: "in_progress", children: ["shared"] }),
    ".trellis/tasks/pb/task.json": task({ title: "PB", status: "in_progress", children: ["shared"] }),
    ".trellis/tasks/shared/task.json": task({ title: "Shared", status: "planning", parent: null }),
  });
  const result = await scanTrellisTasks(root, { logger: SILENT_LOGGER });
  // `shared` exists on disk → multi-referenced standalone, no parent card
  // gets an "archived" placeholder for it and no completion inflation.
  assert.equal(result.roots.length, 0);
  assert.deepEqual(
    result.standalone.map((node) => node.title).sort(),
    ["PA", "PB", "Shared"],
  );
  assert.match(result.warnings.join("\n"), /多个父任务引用/);
  const json = JSON.stringify(result);
  assert.equal(json.includes('"missing":true'), false);
});

test("workspace without .trellis and empty tasks dir are reported, not errors", async () => {
  const noTrellis = await mkdtemp(join(tmpdir(), "dsm-trellis-empty-"));
  const missing = await scanTrellisTasks(noTrellis, { logger: SILENT_LOGGER });
  assert.equal(missing.hasTrellis, false);
  assert.deepEqual(missing.warnings, []);

  const emptyTasks = await makeWorkspace({ ".trellis/tasks/.keep": "" });
  const empty = await scanTrellisTasks(emptyTasks, { logger: SILENT_LOGGER });
  assert.equal(empty.hasTrellis, true);
  assert.equal(empty.roots.length, 0);
  assert.equal(empty.standalone.length, 0);
});

test("multi-level trees nest recursively and roll up completion", async () => {
  const root = await makeWorkspace({
    ".trellis/tasks/top/task.json": task({ title: "Top", children: ["mid"] }),
    ".trellis/tasks/mid/task.json": task({ title: "Mid", parent: "top", status: "in_progress", children: ["leaf1", "leaf2"] }),
    ".trellis/tasks/leaf1/task.json": task({ title: "L1", parent: "mid", status: "completed" }),
    ".trellis/tasks/leaf2/task.json": task({ title: "L2", parent: "mid", status: "planning" }),
  });
  const result = await scanTrellisTasks(root, { logger: SILENT_LOGGER });
  const top = result.roots[0];
  assert.equal(top.totalCount, 1);
  assert.equal(top.completedCount, 0);
  const mid = top.children[0];
  assert.equal(mid.totalCount, 2);
  assert.equal(mid.completedCount, 1);
});

// ---------------------------------------------------------------------------
// Workspace aggregation
// ---------------------------------------------------------------------------

test("collectTrellisWorkspaces unions registry workspaces and session-cwd roots", async () => {
  const withTrellis = await makeWorkspace({
    ".trellis/tasks/parent/task.json": task({ title: "P", children: [] }),
  });
  const withoutTrellis = await mkdtemp(join(tmpdir(), "dsm-trellis-none-"));
  const cwdWithTrellis = await makeWorkspace({
    ".trellis/tasks/cwd-task/task.json": task({ title: "Cwd" }),
  });
  const cwdWithout = await mkdtemp(join(tmpdir(), "dsm-trellis-cwd-plain-"));

  const workspaces = await collectTrellisWorkspaces({
    workspaceRegistry: {
      list: () => [
        { id: "ws-a", path: withTrellis, title: "Alpha" },
        { id: "ws-b", path: withoutTrellis, title: "Beta" },
      ],
    },
    sessionQuery: {
      async listSessions() {
        return [
          { header: { id: "s1", cwd: cwdWithTrellis } },
          { header: { id: "s2", cwd: cwdWithout } },
        ];
      },
    },
    logger: SILENT_LOGGER,
  });

  const paths = workspaces.map((workspace) => workspace.path);
  assert.ok(paths.includes(withTrellis));
  assert.ok(paths.includes(withoutTrellis)); // registered → always listed
  assert.ok(paths.includes(cwdWithTrellis)); // cwd-derived with .trellis → listed
  assert.equal(paths.includes(cwdWithout), false); // cwd-derived without .trellis → omitted
  const alpha = workspaces.find((workspace) => workspace.path === withTrellis);
  assert.equal(alpha.title, "Alpha");
  assert.equal(alpha.hasTrellis, true);
  const beta = workspaces.find((workspace) => workspace.path === withoutTrellis);
  assert.equal(beta.hasTrellis, false);
});

test("an unreadable workspace root is reported as a warning, not a crash", async () => {
  // A workspace path that is a regular file: readdir fails with ENOTDIR.
  const notADir = join(await mkdtemp(join(tmpdir(), "dsm-trellis-file-")), "not-a-dir");
  await writeFile(notADir, "x", "utf8");
  const workspaces = await collectTrellisWorkspaces({
    workspaceRegistry: { list: () => [{ id: "ws", path: notADir, title: "FileWS" }] },
    logger: SILENT_LOGGER,
  });
  assert.equal(workspaces.length, 1);
  assert.equal(workspaces[0].hasTrellis, false);
  assert.equal(workspaces[0].warnings.length, 1);
  assert.match(workspaces[0].warnings[0], /无法读取/);
});

// ---------------------------------------------------------------------------
// Markdown rendering + anchored export
// ---------------------------------------------------------------------------

function fixtureWorkspaces() {
  return [
    {
      id: "ws-xllm",
      title: "xllm",
      path: "/w/xllm",
      hasTrellis: true,
      roots: [
        {
          dir: "roadmap",
          title: "Roadmap A",
          status: "in_progress",
          priority: "P1",
          branch: "feat/roadmap",
          prUrl: "https://example.com/pr/9",
          completedAt: null,
          missing: false,
          completedCount: 2,
          totalCount: 3,
          updatedAt: 0,
          latestCompletedAt: "2026-10-01",
          children: [
            {
              dir: "c1",
              title: "C1",
              status: "completed",
              priority: null,
              branch: null,
              prUrl: null,
              completedAt: "2026-10-01",
              missing: false,
              completedCount: 0,
              totalCount: 0,
              updatedAt: 0,
              latestCompletedAt: "2026-10-01",
              children: [],
            },
            {
              dir: "c2",
              title: "C2",
              status: "in_progress",
              priority: null,
              branch: "feat/c2",
              prUrl: "https://example.com/pr/2",
              completedAt: null,
              missing: false,
              completedCount: 0,
              totalCount: 0,
              updatedAt: 0,
              latestCompletedAt: null,
              children: [],
            },
            {
              dir: "c3",
              title: "C3",
              status: "archived",
              priority: null,
              branch: null,
              prUrl: null,
              completedAt: null,
              missing: true,
              completedCount: 0,
              totalCount: 0,
              updatedAt: 0,
              latestCompletedAt: null,
              children: [],
            },
          ],
        },
      ],
      standalone: [],
      orphans: [
        {
          dir: "orphan",
          title: "Orphan Task",
          status: "planning",
          priority: null,
          branch: null,
          prUrl: null,
          completedAt: null,
          missing: false,
          completedCount: 0,
          totalCount: 0,
          updatedAt: 0,
          latestCompletedAt: null,
          children: [],
        },
      ],
      warnings: ["task.json 不是合法 JSON，已跳过：bad"],
    },
    {
      id: "ws-plain",
      title: "plain",
      path: "/w/plain",
      hasTrellis: false,
      roots: [],
      standalone: [],
      orphans: [],
      warnings: [],
    },
  ];
}

test("renderTrellisMarkdown snapshot (ob_note roadmap style)", () => {
  const markdown = renderTrellisMarkdown(fixtureWorkspaces(), {
    generatedAt: "2026-10-01T00:00:00.000Z",
  });
  assert.equal(
    markdown,
    [
      "> 由 dsh-session-manager Trellis 看板导出于 2026-10-01T00:00:00.000Z（`.trellis` 只读快照）。",
      "> 锚点区块外的内容不会被本插件修改；每次写前生成 `.bak.<时间戳>` 备份。",
      "",
      "## 📊 总览仪表盘 — xllm",
      "",
      "| # | 里程碑 | 状态 | 进度 | 完成时间 |",
      "|---|--------|------|------|----------|",
      "| 1 | Roadmap A | 🟡 进行中 | 2/3 | 2026-10-01 |",
      "",
      "### 1. Roadmap A",
      "",
      "状态：🟡 进行中 · 进度：2/3 · 优先级：P1 · 分支：`feat/roadmap` · PR：[PR](https://example.com/pr/9) · 目录：`.trellis/tasks/roadmap`",
      "",
      "| 子任务 | 状态 | 分支 | PR | 完成时间 |",
      "|--------|------|------|----|----------|",
      "| C1 | ✅ 已完成 | — | — | 2026-10-01 |",
      "| C2 | 🟡 进行中 | `feat/c2` | [PR](https://example.com/pr/2) | — |",
      "| C3 | 📦 已归档 | — | — | — |",
      "",
      "### ⚠️ 孤儿任务 — xllm",
      "",
      "| 任务 | 状态 | 说明 |",
      "|------|------|------|",
      "| Orphan Task | ⬜ 未开始 | parent 指向不存在的任务 |",
      "",
      "<details><summary>读取警告（1 条）</summary>",
      "",
      "```",
      "task.json 不是合法 JSON，已跳过：bad",
      "```",
      "",
      "</details>",
      "",
    ].join("\n"),
  );
});

test("applyAnchoredExport replaces only the anchored block, byte-for-byte outside", () => {
  const before = "PRE 部分逐字节不动\n" + `${EXPORT_START_ANCHOR}\nOLD\n${EXPORT_END_ANCHOR}` + "\nPOST 部分也不动";
  const block = buildExportBlock("NEW CONTENT");
  const after = applyAnchoredExport(before, block);
  assert.ok(after.startsWith("PRE 部分逐字节不动\n"));
  assert.ok(after.endsWith("\nPOST 部分也不动"));
  assert.equal(after.includes("OLD"), false);
  assert.equal(after, `PRE 部分逐字节不动\n${block}\nPOST 部分也不动`);
});

test("applyAnchoredExport appends when the note has no anchors yet", () => {
  const before = "---\ntype: project-tracker\n---\n\n# 我的笔记\n\n人工内容。";
  const block = buildExportBlock("CONTENT");
  const after = applyAnchoredExport(before, block);
  assert.ok(after.startsWith(before));
  assert.ok(after.endsWith(`${block}\n`));
  // Trailing-newline handling: no double blank line injected.
  assert.equal(after, `${before}\n${block}\n`);
});

test("applyAnchoredExport returns null for an empty note (caller builds a new one)", () => {
  assert.equal(applyAnchoredExport("", buildExportBlock("X")), null);
  assert.equal(applyAnchoredExport(undefined, buildExportBlock("X")), null);
});

test("buildNewNote emits frontmatter + heading + anchored block", () => {
  const block = buildExportBlock("CONTENT");
  const note = buildNewNote("/tmp/root/my-roadmap.md", block, { now: "2026-10-01T08:00:00.000Z" });
  assert.match(note, /^---\ntype: project-tracker\nproject: my-roadmap\ncreated: 2026-10-01\nupdated: 2026-10-01\n/);
  assert.match(note, /# my-roadmap — Trellis 里程碑看板/);
  assert.ok(note.includes(block));
});

test("exportTrellisNote: new file, replace, backup, and path-escape rejection", async () => {
  const exportRoot = await mkdtemp(join(tmpdir(), "dsm-trellis-export-"));
  const workspaces = fixtureWorkspaces();
  const fixedNow = () => "2026-10-01T08:00:00.000Z";

  // 1. New file: full note with frontmatter + anchors.
  const first = await exportTrellisNote({
    workspaces,
    targetFile: "roadmap.md",
    exportRoot,
    now: fixedNow,
    logger: SILENT_LOGGER,
  });
  assert.equal(first.created, true);
  assert.equal(first.backup, null);
  const notePath = join(exportRoot, "roadmap.md");
  assert.equal(first.file, notePath);
  const firstText = await readFile(notePath, "utf8");
  assert.match(firstText, /^---\ntype: project-tracker\n/);
  assert.ok(firstText.includes(EXPORT_START_ANCHOR));
  assert.ok(firstText.includes("Roadmap A"));

  // 2. Human edits outside the anchors, then export again: replaced inside,
  //    byte-identical outside, plus a .bak backup.
  const humanPrefix = "人工写的开头，不许动。\n\n";
  const humanSuffix = "\n\n人工写的结尾，也不许动。";
  await writeFile(
    notePath,
    humanPrefix + firstText + humanSuffix,
    "utf8",
  );
  const second = await exportTrellisNote({
    workspaces,
    targetFile: notePath,
    exportRoot,
    now: fixedNow,
    logger: SILENT_LOGGER,
  });
  assert.equal(second.created, false);
  assert.notEqual(second.backup, null);
  const secondText = await readFile(notePath, "utf8");
  assert.ok(secondText.startsWith(humanPrefix));
  assert.ok(secondText.endsWith(humanSuffix));
  const inner = secondText.slice(humanPrefix.length, secondText.length - humanSuffix.length);
  assert.equal(inner, firstText);
  const backupText = await readFile(second.backup, "utf8");
  assert.equal(backupText, humanPrefix + firstText + humanSuffix);

  // 3. Path escapes are rejected: outside the root, and the root's parent.
  await assert.rejects(
    () =>
      exportTrellisNote({
        workspaces,
        targetFile: "../escape.md",
        exportRoot,
        now: fixedNow,
        logger: SILENT_LOGGER,
      }),
    (error) => error instanceof TrellisError && /导出根目录/.test(error.message),
  );
  await assert.rejects(
    () =>
      exportTrellisNote({
        workspaces,
        targetFile: "/etc/passwd.md",
        exportRoot,
        now: fixedNow,
        logger: SILENT_LOGGER,
      }),
    (error) => error instanceof TrellisError,
  );

  // 4. A directory as target is rejected.
  await mkdir(join(exportRoot, "adir"), { recursive: true });
  await assert.rejects(
    () =>
      exportTrellisNote({
        workspaces,
        targetFile: "adir",
        exportRoot,
        now: fixedNow,
        logger: SILENT_LOGGER,
      }),
    (error) => error instanceof TrellisError && /目录/.test(error.message),
  );

  // 5. No stray temp files left behind.
  const files = await readdir(exportRoot);
  assert.equal(files.some((name) => name.endsWith(".tmp")), false);
});

test("exportTrellisNote: symlink escapes are rejected, real nested paths still work", async () => {
  const exportRoot = await mkdtemp(join(tmpdir(), "dsm-trellis-sym-"));
  const outside = await mkdtemp(join(tmpdir(), "dsm-trellis-outside-"));
  await symlink(outside, join(exportRoot, "escape"));

  // A symlinked directory inside the root pointing outside → rejected.
  await assert.rejects(
    () =>
      exportTrellisNote({
        workspaces: [],
        targetFile: "escape/pwned.md",
        exportRoot,
        logger: SILENT_LOGGER,
      }),
    (error) => error instanceof TrellisError && /实际位于导出根目录/.test(error.message),
  );
  // A symlinked target file pointing outside → rejected too.
  await writeFile(join(outside, "real.md"), "secret", "utf8");
  await symlink(join(outside, "real.md"), join(exportRoot, "link.md"));
  await assert.rejects(
    () =>
      exportTrellisNote({
        workspaces: [],
        targetFile: "link.md",
        exportRoot,
        logger: SILENT_LOGGER,
      }),
    (error) => error instanceof TrellisError && /实际位于导出根目录/.test(error.message),
  );
  // Nothing was written outside the root.
  assert.equal((await readdir(outside)).includes("pwned.md"), false);

  // A legitimate target in a not-yet-existing subdirectory still works.
  const ok = await exportTrellisNote({
    workspaces: [],
    targetFile: "sub/dir/note.md",
    exportRoot,
    logger: SILENT_LOGGER,
  });
  assert.equal(ok.created, true);
  assert.ok(ok.file.includes(join("sub", "dir", "note.md")));
});

test("exportTrellisNote refuses roots and targets inside .trellis (read-only discipline)", async () => {
  const ws = await makeWorkspace({
    ".trellis/tasks/parent/task.json": task({ title: "P", children: ["c"] }),
    ".trellis/tasks/c/task.json": task({ title: "C", parent: "parent" }),
  });
  const trellisRoot = join(ws, ".trellis");
  await assert.rejects(
    () =>
      exportTrellisNote({
        workspaces: [],
        targetFile: "tasks/parent/task.json",
        exportRoot: trellisRoot,
        logger: SILENT_LOGGER,
      }),
    (error) => error instanceof TrellisError && /\.trellis 为只读/.test(error.message),
  );
  const handle = openTrellisExport({
    configFile: join(await mkdtemp(join(tmpdir(), "dsm-trellis-ro-")), "settings.json"),
    logger: SILENT_LOGGER,
  });
  await assert.rejects(
    () => handle.setRoot({ exportRoot: trellisRoot }),
    (error) => error instanceof TrellisError && /\.trellis 为只读/.test(error.message),
  );
  // The task tree is untouched.
  const text = await readFile(join(trellisRoot, "tasks", "parent", "task.json"), "utf8");
  assert.equal(JSON.parse(text).title, "P");
});

test("applyAnchoredExport refuses dangling start anchors and duplicate blocks", async () => {
  const block = buildExportBlock("NEW");
  // Start anchor without an end anchor: a silent append would let the NEXT
  // export absorb everything between the stale anchor and the new block.
  assert.throws(
    () => applyAnchoredExport(`head\n${EXPORT_START_ANCHOR}\nstale content`, block),
    (error) => error instanceof TrellisError && /残缺的导出锚点/.test(error.message),
  );
  // Two complete anchored blocks: refuse rather than leave a stale duplicate.
  const duplicated = `${EXPORT_START_ANCHOR}\nfirst\n${EXPORT_END_ANCHOR}\nmiddle\n${EXPORT_START_ANCHOR}\nsecond\n${EXPORT_END_ANCHOR}`;
  assert.throws(
    () => applyAnchoredExport(duplicated, block),
    (error) => error instanceof TrellisError && /多个导出锚点区块/.test(error.message),
  );
  // A note ending without a newline still gets a clean append (no gluing).
  const appended = applyAnchoredExport("no trailing newline", block);
  assert.equal(appended, `no trailing newline\n${block}\n`);
});



test("openTrellisExport: default root, set/get, reset, invalid rejection", async () => {
  assert.equal(DEFAULT_EXPORT_ROOT, join(homedir(), "ob_note", "projects"));
  const dir = await mkdtemp(join(tmpdir(), "dsm-trellis-cfg-"));
  const configFile = join(dir, "settings.json");
  const handle = openTrellisExport({
    configFile,
    defaultExportRoot: "/default/root",
    logger: SILENT_LOGGER,
  });

  const initial = await handle.getRoot();
  assert.equal(initial.exportRoot, "/default/root");
  assert.equal(initial.customized, false);

  const custom = await handle.setRoot({ exportRoot: "~/notes/projects" });
  assert.equal(custom.customized, true);
  assert.equal(custom.exportRoot, join(homedir(), "notes", "projects"));

  // Round-trips through the sidecar and preserves foreign keys.
  const persisted = JSON.parse(await readFile(configFile, "utf8"));
  assert.equal(persisted.trellisExportRoot, custom.exportRoot);
  await writeFile(configFile, JSON.stringify({ ...persisted, promptsFile: "/x.yaml" }), "utf8");
  const again = await handle.getRoot();
  assert.equal(again.exportRoot, custom.exportRoot);
  const reset = await handle.setRoot({ exportRoot: null });
  assert.equal(reset.customized, false);
  assert.equal(reset.exportRoot, "/default/root");
  const afterReset = JSON.parse(await readFile(configFile, "utf8"));
  assert.equal(afterReset.promptsFile, "/x.yaml");

  await assert.rejects(
    () => handle.setRoot({ exportRoot: "relative/path" }),
    (error) => error instanceof TrellisError && /绝对路径/.test(error.message),
  );
});

test("route handlers: trellis board, export validation, and config", async () => {
  const workspaceRoot = await makeWorkspace({
    ".trellis/tasks/parent/task.json": task({ title: "P", status: "in_progress", children: ["c"] }),
    ".trellis/tasks/c/task.json": task({ title: "C", status: "completed", parent: "parent", completedAt: "2026-10-01" }),
  });
  const deps = {
    workspaceRegistry: { list: () => [{ id: "ws", path: workspaceRoot, title: "WS" }] },
    sessionQuery: undefined,
    logger: SILENT_LOGGER,
    trellis: openTrellisExport({
      configFile: join(await mkdtemp(join(tmpdir(), "dsm-trellis-routes-")), "settings.json"),
      defaultExportRoot: "/default/root",
      logger: SILENT_LOGGER,
    }),
  };

  assert.equal(ROUTE_PATHS.trellis, "/api/dsh-session-manager/trellis");
  assert.equal(ROUTE_PATHS.trellisExport, "/api/dsh-session-manager/trellis/export");
  assert.equal(ROUTE_PATHS.trellisConfig, "/api/dsh-session-manager/trellis/config");

  const board = await handleTrellis(deps);
  assert.equal(board.workspaces.length, 1);
  assert.equal(board.workspaces[0].hasTrellis, true);
  assert.equal(board.workspaces[0].roots[0].completedCount, 1);
  assert.ok(typeof board.generatedAt === "string");

  // Export with a body missing `file` is a 400.
  await assert.rejects(
    () => handleTrellisExport(deps, {}),
    (error) => error instanceof HttpError && error.status === 400 && /file/.test(error.message),
  );
  await assert.rejects(
    () => handleTrellisExport(deps, "not-an-object"),
    (error) => error instanceof HttpError && error.status === 400,
  );

  // A path outside the configured root is a 400 with the TrellisError message.
  await assert.rejects(
    () => handleTrellisExport(deps, { file: "/outside/root.md" }),
    (error) => error instanceof HttpError && error.status === 400 && /导出根目录/.test(error.message),
  );

  const config = await handleGetTrellisConfig(deps.trellis);
  assert.equal(config.exportRoot, "/default/root");
  const updated = await handleSetTrellisConfig(deps.trellis, { exportRoot: "/somewhere/else" });
  assert.equal(updated.exportRoot, "/somewhere/else");
  await assert.rejects(
    () => handleSetTrellisConfig(deps.trellis, { exportRoot: "nope" }),
    (error) => error instanceof HttpError && error.status === 400 && /绝对路径/.test(error.message),
  );
});
