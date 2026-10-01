/**
 * Token usage statistics (P7) tests: extraction from real zstd transcripts,
 * aggregation by date (local time) / model / session, range filtering, the
 * per-file mtime cache, and the route handler contract.
 */
import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { openStatsCollector } from "../src/host/stats.js";
import { HttpError, handleGetStats } from "../src/host/routes.js";

const run = promisify(execFile);
const silentLogger = { warn: () => {} };

const zstdAvailable = await new Promise((resolve) => {
  execFile("zstd", ["--version"], (error) => resolve(error === null));
});

/** A session dir with a real zstd transcript built from JSONL lines. */
async function seedSession(root, workspace, sessionId, lines) {
  const dir = join(root, workspace, sessionId);
  await mkdir(dir, { recursive: true });
  const rawFile = join(root, `${sessionId}.raw`);
  await writeFile(rawFile, lines.join("\n") + "\n");
  await run("zstd", ["-f", "-o", join(dir, "session.v3.jsonl.zstd"), rawFile]);
}

function usageLine({ time, provider, model, input, output, total, cacheRead }) {
  return JSON.stringify({
    type: "assistant/message",
    time,
    data: {
      message: { role: "assistant", source: { kind: "model", provider, model } },
      usage: { inputTokens: input, outputTokens: output, totalTokens: total, cacheReadTokens: cacheRead },
    },
  });
}

test(
  "stats: extraction, per-day/per-model aggregation, range filter",
  { skip: zstdAvailable ? false : "zstd not installed" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "dsm-stats-"));
    const noon = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000);
    noon(0).setHours(12, 0, 0, 0);
    const today = noon(0).getTime();
    const earlier = (() => {
      const d = noon(40);
      d.setHours(12, 0, 0, 0);
      return d.getTime();
    })();
    await seedSession(root, "--ws-a--", "session-a", [
      usageLine({ time: today, provider: "glm53-h200", model: "glm-5.3", input: 1000, output: 100, total: 1100, cacheRead: 500 }),
      usageLine({ time: today, provider: "glm53-h200", model: "glm-5.3", input: 2000, output: 200, total: 2200, cacheRead: 0 }),
    ]);
    await seedSession(root, "--ws-b--", "session-b", [
      usageLine({ time: earlier, provider: "ai98-grok", model: "grok-4.7", input: 50, output: 5, total: 55, cacheRead: 10 }),
    ]);
    const collector = openStatsCollector({ sessionsSource: root, logger: silentLogger });

    // 30-day range: only today's two requests.
    const last30 = await collector.stats({ days: 30, titleOf: (id) => `title-${id}` });
    assert.equal(last30.summary.requests, 2);
    assert.equal(last30.summary.total, 3300);
    assert.equal(last30.summary.sessions, 1);
    assert.equal(last30.byModel.length, 1);
    assert.equal(last30.byModel[0].model, "glm-5.3");
    assert.equal(last30.byModel[0].requests, 2);
    assert.equal(last30.byDate.length, 1);
    // All time: the 40-day-old grok request joins in.
    const all = await collector.stats({ days: 0, titleOf: (id) => `title-${id}` });
    assert.equal(all.summary.requests, 3);
    assert.equal(all.summary.total, 3355);
    assert.equal(all.byModel.length, 2);
    assert.deepEqual(all.byModel.map((m) => m.model).sort(), ["glm-5.3", "grok-4.7"]);
    // Top sessions carry titles and are ordered by total.
    assert.equal(all.topSessions[0].sessionId, "session-a");
    assert.equal(all.topSessions[0].title, "title-session-a");
  },
);

test(
  "stats: a broken transcript is skipped, not fatal",
  { skip: zstdAvailable ? false : "zstd not installed" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "dsm-stats-"));
    await seedSession(root, "--ws--", "session-a", [
      usageLine({ time: Date.now(), provider: "p", model: "m", input: 1, output: 1, total: 2, cacheRead: 0 }),
    ]);
    const collector = openStatsCollector({ sessionsSource: root, logger: silentLogger });
    const first = await collector.stats({ days: 0 });
    assert.equal(first.summary.requests, 1);
    // Corrupt the transcript and bump mtime: the rescan must skip the file
    // with a warning instead of failing the whole stats request.
    const file = join(root, "--ws--", "session-a", "session.v3.jsonl.zstd");
    await writeFile(file, Buffer.from("garbage"));
    const bump = new Date(Date.now() + 5000);
    await utimes(file, bump, bump);
    const second = await collector.stats({ days: 0 });
    assert.equal(second.summary.requests, 0);
  },
);

test("route handler: stats contract and missing-sessionQuery fallback", async () => {
  const deps = {
    stats: {
      stats: async ({ titleOf }) => ({
        rangeDays: 0,
        summary: { requests: 1, input: 1, output: 1, cacheRead: 0, total: 2, sessions: 1 },
        byDate: [],
        byModel: [],
        topSessions: [{ sessionId: "s", requests: 1, total: 2, title: titleOf("s") }],
      }),
    },
  };
  const result = await handleGetStats(deps, 0);
  assert.equal(result.rangeDays, 0);
  assert.equal(result.topSessions[0].title, "s"); // no sessionQuery → id fallback
  const failing = { stats: { stats: async () => { throw new Error("boom"); } } };
  await assert.rejects(() => handleGetStats(failing, 30), (error) => error instanceof HttpError ? false : true);
});

test(
  "stats: days=1 means calendar today (since local midnight)",
  { skip: zstdAvailable ? false : "zstd not installed" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "dsm-stats-"));
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const yesterdayLate = midnight.getTime() - 3_600_000; // 23:00 yesterday
    const todayEarly = midnight.getTime() + 3_600_000; // 01:00 today
    await seedSession(root, "--ws--", "session-y", [
      usageLine({ time: yesterdayLate, provider: "p", model: "m", input: 10, output: 1, total: 11, cacheRead: 0 }),
    ]);
    await seedSession(root, "--ws--", "session-t", [
      usageLine({ time: todayEarly, provider: "p", model: "m", input: 20, output: 2, total: 22, cacheRead: 0 }),
    ]);
    const collector = openStatsCollector({ sessionsSource: root, logger: silentLogger });
    const today = await collector.stats({ days: 1 });
    assert.equal(today.summary.requests, 1);
    assert.equal(today.summary.total, 22);
    assert.deepEqual(today.byDate.map((d) => d.date), [
      `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`,
    ]);
    // 7-day rolling window still includes yesterday's event.
    const week = await collector.stats({ days: 7 });
    assert.equal(week.summary.requests, 2);
  },
);
