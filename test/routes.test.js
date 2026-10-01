/**
 * Fetch route handler tests: board assembly (merge, running flag, workspace
 * labels, ordering, visibility filtering), annotation upsert contract, and
 * taxonomy replacement — against fake host services plus a real sidecar
 * store in a temp directory.
 */
import { strict as assert } from "node:assert";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openStore } from "../src/host/store.js";
import {
  HttpError,
  ROUTE_PATHS,
  handleBoard,
  handleGetAnnotations,
  handleSetTaxonomy,
  handleUpsertAnnotation,
  readJsonBody,
} from "../src/host/routes.js";

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), "dsm-routes-"));
  return openStore({ file: join(dir, "annotations.json"), logger: { warn: () => {} } });
}

function fixtureDeps(store) {
  return {
    store,
    sessionQuery: {
      async listSessions() {
        return [
          {
            header: {
              id: "session-live",
              createdAt: 1000,
              cwd: "/export/home/maxiaolong/github_xllm/xllm",
            },
            live: true,
            persisted: true,
          },
          {
            header: {
              id: "session-cold",
              createdAt: 3000,
              cwd: "/export/home/maxiaolong/github_xllm/xllm",
            },
            live: false,
            persisted: true,
          },
          {
            // Subagent-origin sessions stay hidden (official sidebar rule).
            header: { id: "session-sub", createdAt: 9000, cwd: "/w", origin: "subagent" },
            live: true,
            persisted: false,
          },
          {
            // Cold session without a cwd is not listable.
            header: { id: "session-nocwd", createdAt: 8000 },
            live: false,
            persisted: true,
          },
        ];
      },
      async readTitleSnapshots(ids) {
        return ids.map((id) =>
          id === "session-live"
            ? { sessionId: id, status: "fulfilled", value: { title: { title: "在线会话" } } }
            : { sessionId: id, status: "fulfilled", value: {} },
        );
      },
    },
    workspaceRegistry: {
      list() {
        return [
          {
            id: "ws-xllm",
            path: "/export/home/maxiaolong/github_xllm/xllm",
            title: "xllm",
            sessionIds: ["session-live", "session-cold"],
          },
        ];
      },
      archivedSessionIds: ["session-cold"],
    },
    agents: {
      get(id) {
        return id === "session-live" ? { status: "running" } : { status: "idle" };
      },
    },
    sessionProjectionCache: {
      cachedSnapshot(header) {
        return header.id === "session-live"
          ? { values: { sessionListMetadata: { lastPromptAt: 5000 } } }
          : undefined;
      },
    },
  };
}

test("ROUTE_PATHS are exact /api/dsh-session-manager/* paths", () => {
  assert.equal(ROUTE_PATHS.board, "/api/dsh-session-manager/board");
  assert.equal(ROUTE_PATHS.annotations, "/api/dsh-session-manager/annotations");
  assert.equal(ROUTE_PATHS.taxonomy, "/api/dsh-session-manager/taxonomy");
});

test("handleBoard merges corpus, annotations, running, workspace, and order", async () => {
  const store = await tempStore();
  await store.upsert({
    sessionId: "session-cold",
    annotation: { category: "dev/rec", status: "doing", priority: "important", tags: ["mtp"] },
  });
  const deps = fixtureDeps(store);
  const board = await handleBoard(deps);

  assert.deepEqual(
    board.sessions.map((session) => session.sessionId),
    ["session-live", "session-cold"],
  );
  const live = board.sessions.find((session) => session.sessionId === "session-live");
  assert.equal(live.displayTitle, "在线会话");
  assert.equal(live.running, true);
  assert.equal(live.workspaceId, "ws-xllm");
  assert.equal(live.workspaceTitle, "xllm");
  assert.equal(live.updatedAt, 5000);
  assert.equal(live.annotation, null);

  const cold = board.sessions.find((session) => session.sessionId === "session-cold");
  // No title snapshot: falls back to the cwd basename.
  assert.equal(cold.displayTitle, "xllm");
  assert.equal(cold.running, false);
  assert.equal(cold.archived, true);
  assert.equal(cold.updatedAt, 3000);
  assert.equal(cold.annotation.category, "dev/rec");
  assert.deepEqual(cold.annotation.tags, ["mtp"]);
  assert.equal(board.taxonomy.statuses.length, 3);
});

test("handleBoard fails with an explicit error without sessionQuery", async () => {
  const store = await tempStore();
  await assert.rejects(
    () => handleBoard({ store }),
    (error) => error instanceof HttpError && error.status === 503 && /session-query/.test(error.message),
  );
});

test("handleBoard degrades gracefully without optional services", async () => {
  const store = await tempStore();
  const deps = fixtureDeps(store);
  const minimal = { store, sessionQuery: deps.sessionQuery };
  const board = await handleBoard(minimal);
  const live = board.sessions.find((session) => session.sessionId === "session-live");
  assert.equal(live.running, false);
  assert.equal(live.workspaceTitle, null);
  assert.equal(live.updatedAt, 1000);
  // readTitleSnapshots missing entirely: titles fall back, no throw.
  const noTitles = { store, sessionQuery: { listSessions: deps.sessionQuery.listSessions } };
  const board2 = await handleBoard(noTitles);
  assert.equal(board2.sessions.find((s) => s.sessionId === "session-live").displayTitle, "xllm");
});

test("handleGetAnnotations returns the store snapshot", async () => {
  const store = await tempStore();
  await store.upsert({ sessionId: "s1", annotation: { status: "todo", priority: "normal" } });
  const snapshot = await handleGetAnnotations(store);
  assert.equal(snapshot.sessions.s1.status, "todo");
});

test("handleUpsertAnnotation validates the body and stores the annotation", async () => {
  const store = await tempStore();
  const saved = await handleUpsertAnnotation(store, {
    sessionId: "session-1",
    workspaceId: "ws-xllm",
    annotation: { category: "dev/llm", tags: ["mtp"], status: "doing", priority: "important" },
  });
  assert.equal(saved.sessions["session-1"].category, "dev/llm");

  await assert.rejects(
    () => handleUpsertAnnotation(store, { annotation: { status: "todo", priority: "normal" } }),
    (error) => error instanceof HttpError && error.status === 400 && /sessionId/.test(error.message),
  );
  await assert.rejects(
    () =>
      handleUpsertAnnotation(store, {
        sessionId: "session-1",
        annotation: { status: "bogus", priority: "normal" },
      }),
    (error) => error instanceof HttpError && error.status === 400 && /status/.test(error.message),
  );
  await assert.rejects(
    () => handleUpsertAnnotation(store, "not an object"),
    (error) => error instanceof HttpError && error.status === 400,
  );

  // annotation: null removes the entry.
  const after = await handleUpsertAnnotation(store, { sessionId: "session-1", annotation: null });
  assert.equal(Object.hasOwn(after.sessions, "session-1"), false);
});

test("handleSetTaxonomy validates and replaces", async () => {
  const store = await tempStore();
  const next = {
    categories: [{ id: "x", label: "X" }],
    tags: [],
    statuses: [{ id: "todo", label: "待办" }, { id: "done", label: "完成" }],
    priorities: [{ id: "normal", label: "一般" }],
  };
  const snapshot = await handleSetTaxonomy(store, next);
  assert.deepEqual(snapshot.taxonomy.categories, [{ id: "x", label: "X" }]);
  await assert.rejects(
    () => handleSetTaxonomy(store, { categories: [] }),
    (error) => error instanceof HttpError && error.status === 400,
  );
});

test("readJsonBody parses JSON and rejects garbage", async () => {
  const body = await readJsonBody(new Request("https://x/api", { method: "POST", body: '{"a":1}' }));
  assert.deepEqual(body, { a: 1 });
  const empty = await readJsonBody(new Request("https://x/api", { method: "POST", body: "" }));
  assert.deepEqual(empty, {});
  await assert.rejects(
    () => readJsonBody(new Request("https://x/api", { method: "POST", body: "{oops" })),
    (error) => error instanceof HttpError && error.status === 400,
  );
});
