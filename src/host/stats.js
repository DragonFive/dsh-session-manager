/**
 * Token usage statistics (P7): aggregates model usage from the local
 * session transcripts. Every assistant/message record in
 * ~/.dsh/sessions/<workspace>/<sessionId>/session.v3.jsonl.zstd carries a
 * timestamp (time), the model (data.message.source.provider/model), and a
 * usage block (inputTokens / outputTokens / totalTokens / cacheReadTokens)
 * — the same columns the aio-coding-hub request_logs table tracks.
 *
 * Scans are cached per file (mtime + size), so only changed transcripts
 * are re-decompressed; a full scan of a real workspace (~30 files, 10 MB
 * compressed, 1.6k usage lines) measures well under a second.
 *
 * @module dsh-session-manager/stats
 */
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** A user-facing stats failure (maps to HTTP 400 on the routes). */
export class StatsError extends Error {
  constructor(message) {
    super(message);
    this.name = "StatsError";
  }
}

const ZSTD_MAX_BUFFER = 256 * 1024 * 1024;
const ZSTD_TIMEOUT_MS = 120_000;
const TOP_SESSIONS_LIMIT = 10;

/** Decompress one transcript to text (the JSONL payload is utf8). */
function decompressZstd(file) {
  return new Promise((resolve, reject) => {
    execFile("zstd", ["-dc", file], { timeout: ZSTD_TIMEOUT_MS, maxBuffer: ZSTD_MAX_BUFFER }, (error, stdout, stderr) => {
      if (error) {
        reject(
          new StatsError(
            `解压会话记录失败（本机需要 zstd：macOS brew install zstd / Linux apt install zstd）：${(stderr || error.message).toString().trim().slice(0, 300)}`,
          ),
        );
      } else {
        resolve(stdout.toString("utf8"));
      }
    });
  });
}

/** Local-time yyyy-mm-dd key for date grouping (aio hub groups by local day). */
function localDateKey(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Open the stats collector.
 * @param {{ sessionsSource?: string, logger?: { warn(message: string): void } }} options
 */
export function openStatsCollector({ sessionsSource = join(homedir(), ".dsh", "sessions"), logger = console } = {}) {
  /** file → { mtimeMs, size, events: usage[] } */
  const cache = new Map();

  async function scanFile(file, info) {
    const cached = cache.get(file);
    if (cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      return cached.events;
    }
    // One broken transcript (truncated mid-write, corrupt, foreign format)
    // must never take the whole stats tab down: skip the file with a warn.
    let text;
    try {
      text = await decompressZstd(file);
    } catch (error) {
      logger.warn?.(`[dsh-session-manager] stats: skipping unreadable transcript ${file}: ${error.message}`);
      cache.set(file, { mtimeMs: info.mtimeMs, size: info.size, events: [] });
      return [];
    }
    const events = [];
    for (const line of text.split("\n")) {
      // Cheap pre-filter: usage lines are a small minority of the JSONL.
      if (!line.includes('"usage"')) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const data = record?.data;
      const usage = data?.usage;
      const source = data?.message?.source;
      if (record?.type !== "assistant/message" || usage === undefined || source?.kind !== "model") {
        continue;
      }
      events.push({
        time: typeof record.time === "number" ? record.time : 0,
        provider: typeof source.provider === "string" ? source.provider : "unknown",
        model: typeof source.model === "string" ? source.model : "unknown",
        input: typeof usage.inputTokens === "number" ? usage.inputTokens : 0,
        output: typeof usage.outputTokens === "number" ? usage.outputTokens : 0,
        total: typeof usage.totalTokens === "number" ? usage.totalTokens : 0,
        cacheRead: typeof usage.cacheReadTokens === "number" ? usage.cacheReadTokens : 0,
      });
    }
    cache.set(file, { mtimeMs: info.mtimeMs, size: info.size, events });
    return events;
  }

  /** Every usage event across every workspace, tagged with its sessionId. */
  async function collect() {
    const workspaces = await readdir(sessionsSource, { withFileTypes: true }).catch(() => []);
    const jobs = [];
    for (const workspace of workspaces) {
      if (!workspace.isDirectory()) continue;
      const sessionDirs = await readdir(join(sessionsSource, workspace.name), { withFileTypes: true }).catch(() => []);
      for (const sessionDir of sessionDirs) {
        if (!sessionDir.isDirectory()) continue;
        const file = join(sessionsSource, workspace.name, sessionDir.name, "session.v3.jsonl.zstd");
        const info = await stat(file).catch(() => null);
        if (info?.isFile() !== true) continue;
        jobs.push(
          scanFile(file, info).then((events) => events.map((event) => ({ ...event, sessionId: sessionDir.name }))),
        );
      }
    }
    const perFile = await Promise.all(jobs);
    return perFile.flat();
  }

  return {
    /**
     * Aggregated usage: summary, per-local-day, per provider/model, and the
     * top sessions. `days` ≤ 0 means "all time".
     * @param {{ days?: number, titleOf?: (sessionId: string) => string }} options
     */
    async stats({ days = 30, titleOf = (id) => id } = {}) {
      const events = await collect();
      const cutoff = days > 0 ? Date.now() - days * 86_400_000 : 0;
      const byDate = new Map();
      const byModel = new Map();
      const bySession = new Map();
      let requests = 0;
      let input = 0;
      let output = 0;
      let cacheRead = 0;
      let total = 0;
      for (const event of events) {
        if (event.time < cutoff) continue;
        requests += 1;
        input += event.input;
        output += event.output;
        cacheRead += event.cacheRead;
        total += event.total;

        const dateKey = localDateKey(event.time);
        const date = byDate.get(dateKey) ?? { date: dateKey, requests: 0, input: 0, output: 0, cacheRead: 0, total: 0 };
        date.requests += 1;
        date.input += event.input;
        date.output += event.output;
        date.cacheRead += event.cacheRead;
        date.total += event.total;
        byDate.set(dateKey, date);

        const modelKey = `${event.provider}/${event.model}`;
        const model = byModel.get(modelKey) ?? {
          provider: event.provider,
          model: event.model,
          requests: 0,
          input: 0,
          output: 0,
          cacheRead: 0,
          total: 0,
        };
        model.requests += 1;
        model.input += event.input;
        model.output += event.output;
        model.cacheRead += event.cacheRead;
        model.total += event.total;
        byModel.set(modelKey, model);

        const session = bySession.get(event.sessionId) ?? { sessionId: event.sessionId, requests: 0, total: 0 };
        session.requests += 1;
        session.total += event.total;
        bySession.set(event.sessionId, session);
      }
      const models = [...byModel.values()].sort((left, right) => right.total - left.total);
      const dates = [...byDate.values()].sort((left, right) => (left.date < right.date ? -1 : 1));
      const topSessions = [...bySession.values()]
        .sort((left, right) => right.total - left.total)
        .slice(0, TOP_SESSIONS_LIMIT)
        .map((session) => ({ ...session, title: titleOf(session.sessionId) }));
      return {
        rangeDays: days,
        summary: { requests, input, output, cacheRead, total, sessions: bySession.size },
        byDate: dates,
        byModel: models,
        topSessions,
      };
    },
  };
}
