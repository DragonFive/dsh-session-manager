/**
 * Config sync (P5): keep prompts / provider config / machine memory in a
 * git repo (the dsh-sync convention) straight from the plugin.
 *
 * - The sync repo layout follows dsh-sync: `config/cordis.patch.<machine>.yml`
 *   (per-machine provider config), `prompts.yaml` (shared prompt library),
 *   `memory/<machine>.md`. This module drives git natively (execFile) —
 *   pull --rebase --autostash, deploy the machine config to the dsh profile,
 *   point promptsFile at the repo library when present, commit and push.
 * - Configuration lives in the plugin's settings sidecar (same file as the
 *   prompts/trellis config), re-read per request: `syncRepoPath` (local
 *   checkout), `syncRepoUrl` (cloned to the path when missing),
 *   `syncSshKey` (GIT_SSH_COMMAND -i), `syncMachine` (override of the
 *   hostname-based detection).
 * - Nothing secret is stored: the repo is expected to reference API keys
 *   via apiKeyEnv only.
 *
 * @module dsh-session-manager/sync
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { ValidationError } from "./schema.js";

/** A user-facing sync failure (maps to HTTP 400 on the routes). */
export class SyncError extends Error {
  constructor(message) {
    super(message);
    this.name = "SyncError";
  }
}

const GIT_TIMEOUT_MS = 120_000;
const CLONE_TIMEOUT_MS = 300_000;
const MAX_SESSION_BYTES = 32 * 1024 * 1024;

/** Hostname-based machine id (overridable via the `syncMachine` setting). */
export function detectMachine() {
  const host = hostname();
  if (/910|c103/i.test(host)) return "910c103";
  return "mac";
}

const ZSTD_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Decompress a zstd file to text (the session transcript is utf8 JSONL;
 * stdout utf8 decoding is safe here — the payload is text).
 */
function decompressZstd(file) {
  return new Promise((resolve, reject) => {
    execFile("zstd", ["-dc", file], { timeout: GIT_TIMEOUT_MS, maxBuffer: ZSTD_MAX_BUFFER }, (error, stdout, stderr) => {
      if (error) {
        reject(
          new SyncError(
            `解压会话记录失败（本机需要 zstd：macOS brew install zstd / Linux apt install zstd）：${(stderr || error.message).toString().trim().slice(0, 300)}`,
          ),
        );
      } else {
        resolve(stdout.toString("utf8"));
      }
    });
  });
}

/**
 * Compress text into a zstd file, file-to-file. Never shuttles compressed
 * bytes through execFile's stdout — it is utf8-decoded to a string by
 * default, which corrupts binary data (a hard-won lesson).
 */
function compressZstdToFile(targetFile, text) {
  return (async () => {
    const rawFile = `${targetFile}.${process.pid}.${randomUUID()}.raw`;
    await writeFile(rawFile, text, "utf8");
    try {
      await new Promise((resolve, reject) => {
        execFile("zstd", ["-f", "-o", targetFile, rawFile], { timeout: GIT_TIMEOUT_MS }, (error, _stdout, stderr) => {
          if (error) {
            reject(
              new SyncError(
                `压缩会话记录失败（本机需要 zstd：macOS brew install zstd / Linux apt install zstd）：${(stderr || error.message).toString().trim().slice(0, 300)}`,
              ),
            );
          } else {
            resolve();
          }
        });
      });
    } finally {
      await rm(rawFile, { force: true }).catch(() => {});
    }
  })();
}

/**
 * Expand a configured path: `~` / `~/…` resolve against home; the result
 * must be absolute. Empty / null means "unset".
 * @param {string | null | undefined} input
 * @returns {string | null}
 */
export function expandSyncPath(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== "string") throw new ValidationError("同步路径必须是字符串");
  const trimmed = input.trim();
  if (trimmed === "") return null;
  let expanded = trimmed;
  if (expanded === "~") expanded = homedir();
  else if (expanded.startsWith("~/")) expanded = join(homedir(), expanded.slice(2));
  if (!isAbsolute(expanded)) {
    throw new ValidationError(`同步路径必须是绝对路径（支持 ~ 前缀）："${trimmed}"`);
  }
  return expanded;
}

/**
 * Open the sync manager.
 * @param {{ configFile: string, deployTarget: string, sessionsSource?: string,
 *           annotationsFile?: string, logger?: { warn(message: string): void } }} options
 * `deployTarget` is the live dsh profile patch file the machine config is
 * deployed to (e.g. ~/.dsh/profiles/web/cordis.patch.yml). `sessionsSource`
 * (default ~/.dsh/sessions) and `annotationsFile` power the opt-in session
 * export: annotations flagged `sync: true` get their transcript copied into
 * the repo's sessions/ directory.
 */
export function openSyncManager({
  configFile,
  deployTarget,
  sessionsSource = join(homedir(), ".dsh", "sessions"),
  annotationsFile,
  listSessionHeaders,
  logger = console,
}) {
  async function readConfigFile() {
    let text;
    try {
      text = await readFile(configFile, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return {};
      throw error;
    }
    try {
      const parsed = JSON.parse(text);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
    } catch {
      logger.warn?.(`[dsh-session-manager] settings.json 无法解析，已忽略（${configFile}）`);
      return {};
    }
  }

  async function persistConfigFile(value) {
    const tmp = `${configFile}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(dirname(configFile), { recursive: true });
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmp, configFile);
  }

  /** Resolve the effective sync settings (validated, expanded). */
  async function resolveEffective() {
    const stored = await readConfigFile();
    let repoPath = null;
    let sshKey = null;
    try {
      repoPath = expandSyncPath(stored.syncRepoPath ?? null);
      sshKey = expandSyncPath(stored.syncSshKey ?? null);
    } catch (error) {
      throw new SyncError(`同步配置无效：${error.message}`);
    }
    // The repo URL is a git remote (git@host:owner/repo.git, https://…),
    // NOT a filesystem path — never run it through the path expander
    // (a regression here broke both sync tabs the moment a real URL was
    // configured; the tests only ever used local absolute paths).
    const repoUrl =
      typeof stored.syncRepoUrl === "string" && stored.syncRepoUrl.trim() !== ""
        ? stored.syncRepoUrl.trim()
        : null;
    const machine =
      typeof stored.syncMachine === "string" && stored.syncMachine.trim() !== ""
        ? stored.syncMachine.trim()
        : detectMachine();
    return { repoPath, repoUrl, sshKey, machine };
  }

  /** Run one git command in the repo (or cwd-less for clone). */
  function git(args, { cwd, sshKey: key, timeout = GIT_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      const env = { ...process.env };
      if (key !== null) env.GIT_SSH_COMMAND = `ssh -i ${key} -o IdentitiesOnly=yes`;
      execFile("git", args, { cwd, env, timeout }, (error, stdout, stderr) => {
        if (error) {
          reject(
            new SyncError(
              `git ${args[0]} 失败：${(stderr || stdout || error.message).trim().slice(0, 500)}`,
            ),
          );
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /** The repo must exist and be a work tree; clone it from the URL when set. */
  async function ensureRepo(settings, step) {
    if (settings.repoPath === null) {
      throw new SyncError("未配置同步仓库路径（同步标签页里填仓库路径 / 仓库地址）");
    }
    try {
      await stat(join(settings.repoPath, ".git"));
      return;
    } catch {
      // Not a checkout (or missing) — clone when a URL is configured.
    }
    if (settings.repoUrl === null) {
      throw new SyncError(`"${settings.repoPath}" 不是 git 仓库，且未配置仓库地址用于 clone`);
    }
    step(`clone ${settings.repoUrl} → ${settings.repoPath}`);
    await mkdir(dirname(settings.repoPath), { recursive: true });
    await git(["clone", settings.repoUrl, settings.repoPath], {
      cwd: homedir(),
      sshKey: settings.sshKey,
      timeout: CLONE_TIMEOUT_MS,
    });
  }

  async function repoStatus(settings) {
    const porcelain = await git(["status", "--porcelain"], { cwd: settings.repoPath, sshKey: settings.sshKey });
    const dirty = porcelain.split("\n").filter((line) => line.trim() !== "");
    const lastCommit = (
      await git(["log", "-1", "--format=%h %s (%an, %ar)"], { cwd: settings.repoPath, sshKey: settings.sshKey })
    ).trim();
    return { dirty, lastCommit };
  }

  /** Every sessionId that already exists under <sessionsSource>/<workspace>/. */
  async function localSessionIds() {
    const workspaces = await readdir(sessionsSource, { withFileTypes: true }).catch(() => []);
    const ids = new Set();
    for (const entry of workspaces) {
      if (!entry.isDirectory()) continue;
      const sessions = await readdir(join(sessionsSource, entry.name), { withFileTypes: true }).catch(() => []);
      for (const session of sessions) {
        if (session.isDirectory()) ids.add(session.name);
      }
    }
    return ids;
  }

  /**
   * Copy every `sync: true` session's transcript into the repo's sessions/
   * directory (sessionId/session.v3.jsonl.zstd + meta.json) and regenerate
   * the browsable INDEX.md. Unflagged sessions never leave the machine.
   */
  async function exportFlaggedSessions(settings, step) {
    if (annotationsFile === undefined) {
      step("（未配置标注文件，跳过会话导出）");
      return;
    }
    const store = await readFile(annotationsFile, "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => null);
    if (store === null || typeof store.sessions !== "object" || store.sessions === null) {
      step("（无标注数据，跳过会话导出）");
      return;
    }
    const flagged = Object.entries(store.sessions).filter(([, annotation]) => annotation?.sync === true);
    if (flagged.length === 0) {
      step("没有标记「同步到仓库」的会话");
      return;
    }
    // Session transcripts live at <sessionsSource>/<workspace-dir>/<sessionId>/.
    // Resolve the original cwd of each flagged session for the restore path.
    const headers = await Promise.resolve(listSessionHeaders?.() ?? []).catch(() => []);
    const cwdOf = new Map(headers.map((header) => [header.id, header.cwd]));
    const workspaces = await readdir(sessionsSource, { withFileTypes: true }).catch(() => []);
    let exported = 0;
    let missing = 0;
    let tooLarge = 0;
    for (const [sessionId, annotation] of flagged) {
      let source = null;
      for (const entry of workspaces) {
        if (!entry.isDirectory()) continue;
        const candidate = join(sessionsSource, entry.name, sessionId, "session.v3.jsonl.zstd");
        const info = await stat(candidate).catch(() => null);
        if (info?.isFile()) {
          source = { file: candidate, size: info.size, workspace: entry.name };
          break;
        }
      }
      if (source === null) {
        missing += 1;
        continue;
      }
      if (source.size > MAX_SESSION_BYTES) {
        tooLarge += 1;
        continue;
      }
      const targetDir = join(settings.repoPath, "sessions", sessionId);
      await mkdir(targetDir, { recursive: true });
      await copyFile(source.file, join(targetDir, "session.v3.jsonl.zstd"));
      await writeFile(
        join(targetDir, "meta.json"),
        `${JSON.stringify(
          {
            sessionId,
            exportedAt: new Date().toISOString(),
            sourceWorkspace: source.workspace,
            sourceCwd: cwdOf.get(sessionId) ?? null,
            sizeBytes: source.size,
            annotation: {
              status: annotation.status ?? null,
              priority: annotation.priority ?? null,
              category: annotation.category ?? null,
              taskId: annotation.taskId ?? null,
              tags: annotation.tags ?? [],
              notes: annotation.notes ?? null,
            },
          },
          null,
          2,
        )}\n`,
      );
      exported += 1;
    }
    await regenerateSessionIndex(settings.repoPath);
    step(
      `导出会话 ${exported} 个` +
        (missing > 0 ? `，${missing} 个找不到记录文件` : "") +
        (tooLarge > 0 ? `，${tooLarge} 个超过 ${Math.round(MAX_SESSION_BYTES / 1024 / 1024)}MB 上限跳过` : ""),
    );
  }

  /** Rebuild sessions/INDEX.md from every meta.json in the repo. */
  async function regenerateSessionIndex(repoPath) {
    const indexDir = join(repoPath, "sessions");
    const entries = await readdir(indexDir, { withFileTypes: true }).catch(() => []);
    const metas = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = await readFile(join(indexDir, entry.name, "meta.json"), "utf8")
        .then((text) => JSON.parse(text))
        .catch(() => null);
      if (meta !== null) metas.push(meta);
    }
    metas.sort((left, right) => (left.exportedAt < right.exportedAt ? 1 : -1));
    const lines = [
      "# 已同步会话索引",
      "",
      "> 由 dsh-session-manager「同步」标签页自动生成。正本是 zstd 压缩的原始会话记录",
      "> （`zstd -dc session.v3.jsonl.zstd` 查看）；只有标注里打开「同步到仓库」的会话会出现在这里。",
      "",
      "| 会话 | 任务 | 状态 | 优先级 | 备注 | 导出时间 |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    for (const meta of metas) {
      const annotation = meta.annotation ?? {};
      const notes = String(annotation.notes ?? "")
        .replace(/\|/g, "\\|")
        .slice(0, 80);
      lines.push(
        `| ${meta.sessionId} | ${annotation.taskId ?? "—"} | ${annotation.status ?? "—"} | ${annotation.priority ?? "—"} | ${notes} | ${meta.exportedAt} |`,
      );
    }
    await mkdir(indexDir, { recursive: true });
    await writeFile(join(indexDir, "INDEX.md"), `${lines.join("\n")}\n`);
  }

  return {
    /** Effective settings + repo status (null status when no usable repo). */
    async getConfig() {
      const settings = await resolveEffective();
      let repoReady = false;
      let status = null;
      if (settings.repoPath !== null) {
        try {
          await stat(join(settings.repoPath, ".git"));
          repoReady = true;
          status = await repoStatus(settings);
        } catch {
          repoReady = false;
        }
      }
      return { ...settings, repoReady, status };
    },

    /**
     * Set (`{syncRepoPath | syncRepoUrl | syncSshKey | syncMachine: string}`),
     * reset each with null. Empty strings reset too.
     * @param {unknown} input
     */
    async setConfig(input) {
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        throw new SyncError("请求体必须是 {syncRepoPath?, syncRepoUrl?, syncSshKey?, syncMachine?}");
      }
      const stored = await readConfigFile();
      const fields = ["syncRepoPath", "syncRepoUrl", "syncSshKey", "syncMachine"];
      for (const field of fields) {
        if (input[field] === undefined) continue;
        const value = input[field];
        if (value === null) {
          delete stored[field];
          continue;
        }
        if (typeof value !== "string") throw new SyncError(`${field} 必须是字符串或 null`);
        const trimmed = value.trim();
        if (trimmed === "") {
          delete stored[field];
          continue;
        }
        if (field === "syncMachine") {
          stored[field] = trimmed;
          continue;
        }
        if (field === "syncRepoUrl") {
          // A git remote (git@…:… / https://…), stored verbatim — the path
          // expander would reject it for not being absolute.
          stored[field] = trimmed;
          continue;
        }
        try {
          stored[field] = expandSyncPath(trimmed);
        } catch (error) {
          throw new SyncError(`${field} 无效：${error.message}`);
        }
      }
      await persistConfigFile(stored);
      return this.getConfig();
    },

    /**
     * Full sync: ensure repo → pull → deploy the machine config → point
     * promptsFile at the repo library when present → commit + push local
     * edits. Returns the step-by-step log.
     * @returns {Promise<{ lines: string[], pushed: boolean, deployedConfig: boolean }>}
     */
    async run() {
      const settings = await resolveEffective();
      const lines = [];
      const step = (message) => lines.push(message);
      await ensureRepo(settings, step);
      step(`machine=${settings.machine}`);

      const hasHead = await git(["rev-parse", "--verify", "HEAD"], {
        cwd: settings.repoPath,
        sshKey: settings.sshKey,
      })
        .then(() => true)
        .catch(() => false);
      if (hasHead) {
        const pull = await git(["pull", "--rebase", "--autostash"], {
          cwd: settings.repoPath,
          sshKey: settings.sshKey,
        });
        step(`pull: ${pull.trim() || "已是最新"}`);
      } else {
        step("空仓库（无提交），跳过 pull");
      }

      // Deploy this machine's provider config (backup the live file when it
      // differs — the repo is the source of truth, but nothing is lost).
      let deployedConfig = false;
      const machineConfig = join(settings.repoPath, "config", `cordis.patch.${settings.machine}.yml`);
      const machineConfigText = await readFile(machineConfig, "utf8").catch(() => null);
      if (machineConfigText !== null) {
        const live = await readFile(deployTarget, "utf8").catch(() => null);
        if (live !== machineConfigText) {
          if (live !== null) {
            const backup = `${deployTarget}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`;
            await copyFile(deployTarget, backup).catch(() => {});
            step(`本地配置与仓库不同，已备份 ${backup}`);
          }
          await mkdir(dirname(deployTarget), { recursive: true });
          await copyFile(machineConfig, deployTarget);
          step(`已部署 config/cordis.patch.${settings.machine}.yml → ${deployTarget}`);
        } else {
          step("provider 配置与仓库一致");
        }
        deployedConfig = true;
      } else {
        step(`（仓库无 config/cordis.patch.${settings.machine}.yml，跳过配置部署）`);
      }

      // Point the prompt library at the repo copy when present, so the
      // board editor writes straight into the synced working tree.
      const repoPrompts = join(settings.repoPath, "prompts.yaml");
      try {
        await stat(repoPrompts);
        const stored = await readConfigFile();
        if (stored.promptsFile !== repoPrompts) {
          stored.promptsFile = repoPrompts;
          await persistConfigFile(stored);
          step(`提示词库已指向仓库文件 ${repoPrompts}`);
        }
      } catch {
        step("（仓库无 prompts.yaml，提示词库配置不变）");
      }

      // Opt-in session export: annotations flagged `sync: true` get their
      // transcript copied into the repo (everything else stays local).
      await exportFlaggedSessions(settings, step);

      const { dirty } = await repoStatus(settings);
      let pushed = false;
      if (dirty.length > 0) {
        await git(["add", "-A"], { cwd: settings.repoPath, sshKey: settings.sshKey });
        await git(
          ["commit", "-m", `chore(${settings.machine}): sync ${new Date().toISOString().slice(0, 19)}`],
          { cwd: settings.repoPath, sshKey: settings.sshKey },
        );
        // -u origin HEAD also wires the upstream on a freshly cloned repo.
        await git(["push", "-u", "origin", "HEAD"], { cwd: settings.repoPath, sshKey: settings.sshKey });
        pushed = true;
        step(`已提交并推送 ${dirty.length} 个本地改动`);
      } else {
        step("没有需要推送的本地改动");
      }
      step("完成。提示词即时生效；cordis.patch.yml 改动需重启 dsh web。");
      return { lines, pushed, deployedConfig };
    },

    /**
     * Collected sessions in the repo (the 收藏 tab): every sessions/<id>/
     * meta.json plus a `local` flag for "already restored on this machine".
     */
    async listCollected() {
      const settings = await resolveEffective();
      if (settings.repoPath === null) {
        throw new SyncError("未配置同步仓库路径（同步标签页里填仓库路径 / 仓库地址）");
      }
      const indexDir = join(settings.repoPath, "sessions");
      const entries = await readdir(indexDir, { withFileTypes: true }).catch(() => []);
      const local = await localSessionIds();
      const collected = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const meta = await readFile(join(indexDir, entry.name, "meta.json"), "utf8")
          .then((text) => JSON.parse(text))
          .catch(() => null);
        if (meta === null) continue;
        collected.push({ ...meta, local: local.has(entry.name) });
      }
      collected.sort((left, right) => (left.exportedAt < right.exportedAt ? 1 : -1));
      return { sessions: collected };
    },

    /**
     * Restore a collected session onto this machine so it can be continued.
     * With `targetCwd` the session header's cwd is rewritten to that path
     * (cross-machine layouts differ); without it the transcript is restored
     * byte-identical into its original workspace directory.
     * @param {{ sessionId: string, targetCwd?: string | null }} input
     */
    async restore({ sessionId, targetCwd }) {
      if (typeof sessionId !== "string" || sessionId.trim() === "") {
        throw new SyncError("sessionId 必须是非空字符串");
      }
      const settings = await resolveEffective();
      if (settings.repoPath === null) {
        throw new SyncError("未配置同步仓库路径（同步标签页里填仓库路径 / 仓库地址）");
      }
      const sourceDir = join(settings.repoPath, "sessions", sessionId);
      const sourceZst = join(sourceDir, "session.v3.jsonl.zstd");
      const meta =
        (await readFile(join(sourceDir, "meta.json"), "utf8")
          .then((text) => JSON.parse(text))
          .catch(() => null)) ?? {};
      if ((await stat(sourceZst).catch(() => null)) === null) {
        throw new SyncError(`仓库里没有会话 ${sessionId} 的记录文件`);
      }
      const local = await localSessionIds();
      if (local.has(sessionId)) {
        throw new SyncError(`会话 ${sessionId} 已存在于本机，无需恢复`);
      }

      const target = typeof targetCwd === "string" ? targetCwd.trim() : "";
      let directory;
      if (target === "") {
        // Byte-identical restore into the original workspace directory.
        const workspaceDir = meta.sourceWorkspace ?? null;
        if (typeof workspaceDir !== "string" || workspaceDir === "") {
          throw new SyncError("缺少原工作区信息，请填写目标工作区路径后重试");
        }
        directory = join(sessionsSource, workspaceDir, sessionId);
        await mkdir(directory, { recursive: true });
        await copyFile(sourceZst, join(directory, "session.v3.jsonl.zstd"));
        return { sessionId, directory, rewroteCwd: false };
      }

      if (!isAbsolute(target)) {
        throw new SyncError(`目标工作区路径必须是绝对路径："${target}"`);
      }
      // Rewrite the header cwd (the workspace dir name derives from it:
      // cwd with every "/" replaced by "-", wrapped in leading/trailing "-").
      const raw = await decompressZstd(sourceZst);
      const newline = raw.indexOf("\n");
      if (newline === -1) throw new SyncError("会话记录格式异常（无头部行）");
      let header;
      try {
        header = JSON.parse(raw.slice(0, newline));
      } catch {
        throw new SyncError("会话记录头部不是合法 JSON");
      }
      header.cwd = target;
      const rewritten = `${JSON.stringify(header)}${raw.slice(newline)}`;
      // Workspace dir naming (verified against real ~/.dsh/sessions entries,
      // e.g. /tmp → --tmp--): strip the leading slash, turn every internal
      // slash into a dash, wrap in "--" on both ends.
      const dirName = `--${target.replace(/^\//, "").replace(/\//g, "-")}--`;
      directory = join(sessionsSource, dirName, sessionId);
      await mkdir(directory, { recursive: true });
      await compressZstdToFile(join(directory, "session.v3.jsonl.zstd"), rewritten);
      return { sessionId, directory, rewroteCwd: true };
    },
  };
}
