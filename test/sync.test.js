/**
 * Config sync (P5) tests: settings sidecar round-trip, repo status, and a
 * full run() against real git repositories (a local bare remote + a clone),
 * including config deployment and the promptsFile auto-wiring.
 */
import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { SyncError, detectMachine, expandSyncPath, openSyncManager } from "../src/host/sync.js";
import { HttpError, handleGetSync, handleRunSync, handleSetSyncConfig } from "../src/host/routes.js";

const run = promisify(execFile);
const silentLogger = { warn: () => {} };

async function tempDir() {
  return mkdtemp(join(tmpdir(), "dsm-sync-"));
}

/** git helper outside the module (test setup only). */
function git(cwd, ...args) {
  return run("git", args, { cwd });
}

/** A bare remote + a clone with one commit, ready to sync. */
async function seededRepos(dir) {
  const remote = join(dir, "remote.git");
  const work = join(dir, "work");
  await run("git", ["init", "--bare", "--initial-branch=main", remote]);
  await run("git", ["clone", remote, work]);
  await git(work, "config", "user.name", "Test");
  await git(work, "config", "user.email", "test@test.test");
  await mkdir(join(work, "config"), { recursive: true });
  await writeFile(join(work, "config", "cordis.patch.mac.yml"), "# machine config v1\n");
  await writeFile(join(work, "prompts.yaml"), "groups:\n  - id: g\n    label: 组\n    prompts:\n      - id: p\n        title: 条\n        body: |\n          正文\n");
  await git(work, "add", "-A");
  await git(work, "commit", "-m", "init");
  await git(work, "push", "-u", "origin", "HEAD");
  return { remote, work };
}

function managerFor(dir, extras = {}) {
  return openSyncManager({
    configFile: join(dir, "settings.json"),
    deployTarget: join(dir, "deployed", "cordis.patch.yml"),
    logger: silentLogger,
    ...extras,
  });
}

test("expandSyncPath: ~ expansion, absolute requirement, empty → null", () => {
  assert.equal(expandSyncPath(null), null);
  assert.equal(expandSyncPath(""), null);
  assert.equal(expandSyncPath("  "), null);
  assert.match(expandSyncPath("~/x"), /^\/.+\/x$/);
  assert.throws(() => expandSyncPath("relative"), /绝对路径/);
  assert.throws(() => expandSyncPath(42), /字符串/);
});

test("detectMachine returns a non-empty machine id", () => {
  assert.equal(typeof detectMachine(), "string");
  assert.notEqual(detectMachine(), "");
});

test("getConfig without configuration reports no repo", async () => {
  const dir = await tempDir();
  const manager = managerFor(dir);
  const config = await manager.getConfig();
  assert.equal(config.repoPath, null);
  assert.equal(config.repoReady, false);
  assert.equal(config.status, null);
  assert.equal(typeof config.machine, "string");
});

test("setConfig validates and persists; invalid input is rejected", async () => {
  const dir = await tempDir();
  const manager = managerFor(dir);
  const updated = await manager.setConfig({ syncRepoPath: "~/dev/dsh-sync", syncMachine: "mac" });
  assert.match(updated.repoPath, /\/dev\/dsh-sync$/);
  assert.equal(updated.machine, "mac");
  // Persisted: a fresh manager reads the same sidecar.
  assert.equal((await managerFor(dir).getConfig()).machine, "mac");
  // Reset with null.
  assert.equal((await manager.setConfig({ syncMachine: null })).machine, detectMachine());
  await assert.rejects(() => manager.setConfig({ syncRepoPath: "relative" }), SyncError);
  await assert.rejects(() => manager.setConfig("garbage"), SyncError);
});

test("run() without a configured repo path fails loudly", async () => {
  const dir = await tempDir();
  await assert.rejects(() => managerFor(dir).run(), /未配置同步仓库路径/);
});

test("run(): pull, deploy, wire promptsFile, commit and push", async () => {
  const dir = await tempDir();
  const { remote, work } = await seededRepos(dir);
  const manager = managerFor(dir);
  await manager.setConfig({ syncRepoPath: work, syncRepoUrl: remote, syncMachine: "mac" });

  const status = await manager.getConfig();
  assert.equal(status.repoReady, true);
  assert.equal(status.status.dirty.length, 0);
  assert.match(status.status.lastCommit, /init/);

  // Local edits in the repo working tree (e.g. prompt-editor saves).
  await writeFile(join(work, "prompts.yaml"), "groups:\n  - id: g\n    label: 组\n    prompts:\n      - id: p\n        title: 条2\n        body: |\n          正文2\n");

  const result = await manager.run();
  assert.equal(result.deployedConfig, true);
  assert.equal(result.pushed, true);
  // The step log tells the story.
  assert.match(result.lines.join("\n"), /machine=mac/);
  assert.match(result.lines.join("\n"), /已部署/);
  // The machine config landed on the deploy target.
  assert.equal(await readFile(join(dir, "deployed", "cordis.patch.yml"), "utf8"), "# machine config v1\n");
  // promptsFile in the sidecar now points at the repo library.
  const sidecar = JSON.parse(await readFile(join(dir, "settings.json"), "utf8"));
  assert.equal(sidecar.promptsFile, join(work, "prompts.yaml"));
  // The commit reached the bare remote.
  const remoteLog = (await git(remote, "log", "--format=%s")).stdout;
  assert.match(remoteLog, /chore\(mac\): sync/);
  // Repo is clean afterwards.
  assert.equal((await manager.getConfig()).status.dirty.length, 0);
});

test("run() clones from the URL when the path is not a checkout", async () => {
  const dir = await tempDir();
  const { remote } = await seededRepos(dir);
  const manager = managerFor(dir);
  const freshPath = join(dir, "fresh-clone");
  await manager.setConfig({ syncRepoPath: freshPath, syncRepoUrl: remote, syncMachine: "mac" });
  const result = await manager.run();
  assert.match(result.lines.join("\n"), /clone/);
  assert.equal(result.deployedConfig, true);
});

test("route handlers: sync GET/POST contract and 400 mapping", async () => {
  const dir = await tempDir();
  const { remote, work } = await seededRepos(dir);
  const manager = managerFor(dir);
  const config = await handleSetSyncConfig(manager, { syncRepoPath: work, syncMachine: "mac" });
  assert.equal(config.repoReady, true);
  assert.deepEqual(Object.keys(await handleGetSync(manager)).sort(), [
    "machine",
    "repoPath",
    "repoReady",
    "repoUrl",
    "sshKey",
    "status",
  ]);
  const result = await handleRunSync(manager);
  assert.equal(Array.isArray(result.lines), true);
  await assert.rejects(
    () => handleSetSyncConfig(manager, { syncRepoPath: "relative" }),
    (error) => error instanceof HttpError && error.status === 400,
  );
  const emptyManager = managerFor(await tempDir());
  await assert.rejects(
    () => handleRunSync(emptyManager),
    (error) => error instanceof HttpError && error.status === 400,
  );
});

test("run() exports only sessions flagged sync:true, with meta and INDEX", async () => {
  const dir = await tempDir();
  const { remote, work } = await seededRepos(dir);
  // Two sessions on disk: one flagged, one not; plus one flagged but missing.
  const sessionsRoot = join(dir, "sessions-src");
  const wsDir = join(sessionsRoot, "--ws--");
  for (const id of ["session-flagged", "session-plain"]) {
    await mkdir(join(wsDir, id), { recursive: true });
    await writeFile(join(wsDir, id, "session.v3.jsonl.zstd"), `transcript-bytes-of-${id}`);
  }
  const annotationsFile = join(dir, "annotations.json");
  await writeFile(
    annotationsFile,
    JSON.stringify({
      schemaVersion: 1,
      taxonomy: { categories: [{ id: "misc", label: "杂项" }], tags: [], statuses: [{ id: "todo", label: "待办" }], priorities: [{ id: "normal", label: "一般" }] },
      sessions: {
        "session-flagged": { status: "doing", priority: "important", tags: [], sync: true, taskId: "08-23-llm-pd-architecture-comparison", notes: "架构对比讨论" },
        "session-plain": { status: "todo", priority: "normal", tags: [], sync: false },
        "session-missing": { status: "todo", priority: "normal", tags: [], sync: true },
      },
    }),
  );
  const manager = managerFor(dir, { sessionsSource: sessionsRoot, annotationsFile });
  await manager.setConfig({ syncRepoPath: work, syncMachine: "mac" });

  const result = await manager.run();
  const log = result.lines.join("\n");
  assert.match(log, /导出会话 1 个/);
  assert.match(log, /1 个找不到记录文件/);
  // The flagged transcript landed in the repo with meta.json.
  assert.equal(await readFile(join(work, "sessions", "session-flagged", "session.v3.jsonl.zstd"), "utf8"), "transcript-bytes-of-session-flagged");
  const meta = JSON.parse(await readFile(join(work, "sessions", "session-flagged", "meta.json"), "utf8"));
  assert.equal(meta.annotation.taskId, "08-23-llm-pd-architecture-comparison");
  assert.equal(meta.sourceWorkspace, "--ws--");
  // The unflagged session never left the machine.
  await assert.rejects(() => readFile(join(work, "sessions", "session-plain", "meta.json"), "utf8"));
  // INDEX.md lists the exported session with its task and notes.
  const index = await readFile(join(work, "sessions", "INDEX.md"), "utf8");
  assert.match(index, /session-flagged/);
  assert.match(index, /08-23-llm-pd-architecture-comparison/);
  assert.match(index, /架构对比讨论/);
  assert.doesNotMatch(index, /session-plain/);
  // Everything was committed and pushed in the same run.
  const remoteLog = (await git(remote, "log", "--format=%s")).stdout;
  assert.match(remoteLog, /chore\(mac\): sync/);
  assert.equal((await manager.getConfig()).status.dirty.length, 0);
});

test("run() skips session export when nothing is flagged", async () => {
  const dir = await tempDir();
  const { work } = await seededRepos(dir);
  const annotationsFile = join(dir, "annotations.json");
  await writeFile(
    annotationsFile,
    JSON.stringify({ schemaVersion: 1, taxonomy: { categories: [{ id: "misc", label: "杂项" }], tags: [], statuses: [{ id: "todo", label: "待办" }], priorities: [{ id: "normal", label: "一般" }] }, sessions: {} }),
  );
  const manager = managerFor(dir, { sessionsSource: join(dir, "none"), annotationsFile });
  await manager.setConfig({ syncRepoPath: work, syncMachine: "mac" });
  const result = await manager.run();
  assert.match(result.lines.join("\n"), /没有标记「同步到仓库」的会话/);
});

const zstdAvailable = await new Promise((resolve) => {
  execFile("zstd", ["--version"], (error) => resolve(error === null));
});

test(
  "listCollected + restore: byte-identical path, cwd rewrite, collision guard",
  { skip: zstdAvailable ? false : "zstd not installed" },
  async () => {
    const dir = await tempDir();
    const { work } = await seededRepos(dir);
    // A real zstd session transcript with a header line carrying the cwd
    // (file-to-file compression — execFile's utf8 stdout would corrupt it).
    const raw =
      `${JSON.stringify({ type: "session", version: 3, id: "session-flagged", createdAt: 1, cwd: "/Users/x/code/repo-a" })}\n` +
      '{"type":"message"}\n';
    const sessionsRoot = join(dir, "sessions-src");
    await mkdir(join(sessionsRoot, "--Users-x-code-repo-a--", "session-flagged"), { recursive: true });
    const sourceZst = join(sessionsRoot, "--Users-x-code-repo-a--", "session-flagged", "session.v3.jsonl.zstd");
    const rawFile = join(dir, "raw.tmp");
    await writeFile(rawFile, raw);
    await new Promise((resolve, reject) => {
      execFile("zstd", ["-f", "-o", sourceZst, rawFile], (error) => (error ? reject(error) : resolve()));
    });
    const annotationsFile = join(dir, "annotations.json");
    await writeFile(
      annotationsFile,
      JSON.stringify({
        schemaVersion: 1,
        taxonomy: { categories: [{ id: "misc", label: "杂项" }], tags: [], statuses: [{ id: "todo", label: "待办" }], priorities: [{ id: "normal", label: "一般" }] },
        sessions: { "session-flagged": { status: "doing", priority: "normal", tags: [], sync: true } },
      }),
    );
    const manager = managerFor(dir, {
      sessionsSource: sessionsRoot,
      annotationsFile,
      listSessionHeaders: async () => [{ id: "session-flagged", cwd: "/Users/x/code/repo-a" }],
    });
    await manager.setConfig({ syncRepoPath: work, syncMachine: "mac" });
    await manager.run();

    // The export metadata carries the original cwd for the restore prefill.
    const meta = JSON.parse(await readFile(join(work, "sessions", "session-flagged", "meta.json"), "utf8"));
    assert.equal(meta.sourceCwd, "/Users/x/code/repo-a");

    // Another machine: a fresh sessions root, same repo.
    const otherManager = openSyncManager({
      configFile: join(dir, "settings-other.json"),
      deployTarget: join(dir, "deployed-other", "cordis.patch.yml"),
      sessionsSource: join(dir, "sessions-other"),
      annotationsFile: join(dir, "annotations-other.json"),
      logger: silentLogger,
    });
    await otherManager.setConfig({ syncRepoPath: work, syncMachine: "910c103" });

    let collected = await otherManager.listCollected();
    assert.equal(collected.sessions.length, 1);
    assert.equal(collected.sessions[0].local, false);

    // Byte-identical restore lands in the original workspace directory.
    const asIs = await otherManager.restore({ sessionId: "session-flagged" });
    assert.equal(asIs.rewroteCwd, false);
    assert.ok(asIs.directory.includes(join("--Users-x-code-repo-a--", "session-flagged")));
    collected = await otherManager.listCollected();
    assert.equal(collected.sessions[0].local, true);
    // Restoring again is rejected.
    await assert.rejects(() => otherManager.restore({ sessionId: "session-flagged" }), /已存在/);

    // A third machine with a different layout: rewrite the header cwd.
    const thirdManager = openSyncManager({
      configFile: join(dir, "settings-third.json"),
      deployTarget: join(dir, "deployed-third", "cordis.patch.yml"),
      sessionsSource: join(dir, "sessions-third"),
      annotationsFile: join(dir, "annotations-third.json"),
      logger: silentLogger,
    });
    await thirdManager.setConfig({ syncRepoPath: work, syncMachine: "910c103" });
    const rewritten = await thirdManager.restore({ sessionId: "session-flagged", targetCwd: "/home/maxl/code/repo-b" });
    assert.equal(rewritten.rewroteCwd, true);
    assert.ok(rewritten.directory.includes(join("--home-maxl-code-repo-b--", "session-flagged")));
    const restoredText = await new Promise((resolve, reject) => {
      execFile(
        "zstd",
        ["-dc", join(dir, "sessions-third", "--home-maxl-code-repo-b--", "session-flagged", "session.v3.jsonl.zstd")],
        { maxBuffer: 1 << 26 },
        (error, stdout) => (error ? reject(error) : resolve(stdout.toString("utf8"))),
      );
    });
    const [headerLine, messageLine] = restoredText.split("\n");
    assert.equal(JSON.parse(headerLine).cwd, "/home/maxl/code/repo-b");
    assert.equal(messageLine, '{"type":"message"}');
    // An invalid target path is rejected before anything is written.
    const fourthManager = openSyncManager({
      configFile: join(dir, "settings-fourth.json"),
      deployTarget: join(dir, "deployed-fourth", "cordis.patch.yml"),
      sessionsSource: join(dir, "sessions-fourth"),
      logger: silentLogger,
    });
    await fourthManager.setConfig({ syncRepoPath: work });
    await assert.rejects(
      () => fourthManager.restore({ sessionId: "session-flagged", targetCwd: "relative/path" }),
      /绝对路径/,
    );
  },
);

test("a git remote URL in syncRepoUrl is stored verbatim and never path-expanded", async () => {
  const dir = await tempDir();
  const { work } = await seededRepos(dir);
  const manager = managerFor(dir);
  // Regression: the URL used to run through the absolute-path expander and
  // broke every sync operation the moment a real remote was configured.
  const updated = await manager.setConfig({
    syncRepoPath: work,
    syncRepoUrl: "git@github.com:DragonFive/dsh-sync.git",
    syncMachine: "mac",
  });
  assert.equal(updated.repoUrl, "git@github.com:DragonFive/dsh-sync.git");
  assert.equal(updated.repoReady, true);
  assert.equal(updated.status.dirty.length, 0);
  const collected = await manager.listCollected();
  assert.equal(Array.isArray(collected.sessions), true);
});
