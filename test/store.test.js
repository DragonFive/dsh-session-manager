/**
 * Sidecar store smoke tests: default creation, atomic write, upsert/merge,
 * schema rejection, corruption recovery, and concurrent-write safety.
 */
import { strict as assert } from "node:assert";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openStore } from "../src/host/store.js";
import { DEFAULT_TAXONOMY, leafCategoryIds } from "../src/host/taxonomy.js";
import { validateAnnotation, validateStore, validateTaxonomy } from "../src/host/schema.js";

async function tempFile() {
  const dir = await mkdtemp(join(tmpdir(), "dsm-store-"));
  return join(dir, "annotations.json");
}

test("default taxonomy matches the PRD preset", () => {
  assert.deepEqual(
    DEFAULT_TAXONOMY.categories.map((node) => [node.id, node.label]),
    [
      ["dev", "功能开发"],
      ["pr-review", "PR评审"],
      ["study", "代码学习"],
      ["misc", "测试/杂项"],
    ],
  );
  assert.deepEqual(DEFAULT_TAXONOMY.categories[0].children.map((c) => [c.id, c.label]), [
    ["dev/llm", "LLM方向"],
    ["dev/rec", "生成式推荐"],
  ]);
  assert.deepEqual(
    DEFAULT_TAXONOMY.statuses.map((entry) => [entry.id, entry.label]),
    [
      ["todo", "待办"],
      ["doing", "进行中"],
      ["done", "完成"],
    ],
  );
  assert.deepEqual(
    DEFAULT_TAXONOMY.priorities.map((entry) => [entry.id, entry.label]),
    [
      ["urgent", "紧急"],
      ["important", "重要"],
      ["normal", "一般"],
    ],
  );
});

test("openStore creates the file and directory with defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsm-nested-"));
  const file = join(dir, "deep", "dsh-session-manager", "annotations.json");
  const store = openStore({ file });
  const snapshot = await store.read();
  assert.equal(snapshot.schemaVersion, 1);
  assert.deepEqual(snapshot.sessions, {});
  assert.deepEqual(snapshot.taxonomy.categories, DEFAULT_TAXONOMY.categories);
  const text = await readFile(file, "utf8");
  assert.equal(JSON.parse(text).schemaVersion, 1);
});

test("upsert persists, merges partial fields, and stamps updatedAt", async () => {
  const file = await tempFile();
  const store = openStore({ file, now: () => "2026-10-01T00:00:00.000Z" });
  await store.upsert({
    sessionId: "session-1",
    workspaceId: "ws-1",
    annotation: { category: "dev/llm", tags: ["mtp"], status: "doing", priority: "important" },
  });
  // Partial patch: only status changes; category/tags/priority are kept.
  const second = await store.upsert({
    sessionId: "session-1",
    annotation: { status: "done", priority: "important", tags: ["mtp"] },
  });
  assert.equal(second.sessions["session-1"].category, "dev/llm");
  assert.equal(second.sessions["session-1"].status, "done");
  assert.deepEqual(second.sessions["session-1"].tags, ["mtp"]);
  assert.equal(second.sessions["session-1"].updatedAt, "2026-10-01T00:00:00.000Z");

  // Reopened from disk: the write is durable.
  const reopened = openStore({ file });
  const snapshot = await reopened.read();
  assert.equal(snapshot.sessions["session-1"].status, "done");
  assert.equal(snapshot.sessions["session-1"].workspaceId, "ws-1");
  // New tags are merged into the taxonomy tag list.
  await store.upsert({ sessionId: "session-2", annotation: { status: "todo", priority: "normal", tags: ["new-tag", "mtp"] } });
  const third = await store.read();
  assert.deepEqual(third.taxonomy.tags, ["mtp", "new-tag"]);
});

test("upsert with annotation null removes the entry", async () => {
  const file = await tempFile();
  const store = openStore({ file });
  await store.upsert({ sessionId: "session-1", annotation: { status: "todo", priority: "normal" } });
  const after = await store.upsert({ sessionId: "session-1", annotation: null });
  assert.equal(Object.hasOwn(after.sessions, "session-1"), false);
});

test("explicit null clears category and notes; absent fields still merge", async () => {
  const file = await tempFile();
  const store = openStore({ file });
  await store.upsert({
    sessionId: "session-1",
    annotation: { category: "dev/llm", tags: ["mtp"], status: "doing", priority: "important", notes: "keep" },
  });
  // The dialog saves a full edit with the category deselected and notes
  // emptied: null must clear, not resurrect the previous values.
  const cleared = await store.upsert({
    sessionId: "session-1",
    annotation: { category: null, tags: ["mtp"], status: "doing", priority: "important", notes: null },
  });
  assert.equal(cleared.sessions["session-1"].category, undefined);
  assert.equal(cleared.sessions["session-1"].notes, undefined);
  // Partial patch (field absent) still keeps the previous values.
  await store.upsert({ sessionId: "session-1", annotation: { status: "done", priority: "normal", tags: [] } });
  const partial = await store.read();
  assert.equal(partial.sessions["session-1"].category, undefined);
  // A cleared-then-reopened store round-trips the cleared state.
  const reopened = openStore({ file });
  assert.equal((await reopened.read()).sessions["session-1"].notes, undefined);
});

test("atomic write leaves no temp files behind", async () => {
  const file = await tempFile();
  const store = openStore({ file });
  for (let index = 0; index < 5; index += 1) {
    await store.upsert({
      sessionId: `session-${index}`,
      annotation: { status: "todo", priority: "normal" },
    });
  }
  const entries = await readdir(join(file, ".."));
  assert.deepEqual(entries, ["annotations.json"]);
});

test("concurrent upserts serialize without corruption", async () => {
  const file = await tempFile();
  const store = openStore({ file });
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      store.upsert({
        sessionId: `session-${index}`,
        annotation: { status: "todo", priority: "normal", tags: [`t${index}`] },
      }),
    ),
  );
  const snapshot = await store.read();
  assert.equal(Object.keys(snapshot.sessions).length, 20);
  const reopened = openStore({ file });
  const reread = await reopened.read();
  assert.equal(Object.keys(reread.sessions).length, 20);
});

test("corrupt file is backed up and rebuilt, not thrown", async () => {
  const file = await tempFile();
  await writeFile(file, "{ not valid json", "utf8");
  const warnings = [];
  const store = openStore({
    file,
    logger: { warn: (message) => warnings.push(message) },
  });
  const snapshot = await store.read();
  assert.deepEqual(snapshot.sessions, {});
  assert.equal(warnings.length, 1);
  const entries = await readdir(join(file, ".."));
  assert.equal(entries.filter((name) => name.startsWith("annotations.json.corrupt-")).length, 1);
  assert.equal(entries.includes("annotations.json"), true);
});

test("wrong schemaVersion is treated as corruption", async () => {
  const file = await tempFile();
  await writeFile(
    file,
    JSON.stringify({ schemaVersion: 99, sessions: {}, taxonomy: { categories: [], tags: [], statuses: [], priorities: [] } }),
    "utf8",
  );
  const store = openStore({ file, logger: { warn: () => {} } });
  const snapshot = await store.read();
  assert.equal(snapshot.schemaVersion, 1);
});

test("validateAnnotation rejects unknown enum ids and bad shapes", () => {
  const taxonomy = DEFAULT_TAXONOMY;
  assert.throws(() => validateAnnotation({ status: "bogus", priority: "normal" }, taxonomy), /status/);
  assert.throws(() => validateAnnotation({ status: "todo", priority: "bogus" }, taxonomy), /priority/);
  assert.throws(() => validateAnnotation({ status: "todo", priority: "normal", category: "dev" }, taxonomy), /category/);
  assert.throws(() => validateAnnotation(null, taxonomy), /object/);
  assert.throws(() => validateAnnotation({ status: "todo" }, taxonomy), /priority/);
  // Leaf categories only: "dev" (a parent) is rejected, "dev/llm" is accepted.
  assert.throws(() => validateAnnotation({ category: "dev", status: "todo", priority: "normal" }, taxonomy), /category/);
  assert.deepEqual(
    validateAnnotation({ category: "dev/llm", status: "todo", priority: "normal", tags: ["a", "a", " b ", ""] }, taxonomy),
    { category: "dev/llm", status: "todo", priority: "normal", tags: ["a", "b"] },
  );
  assert.equal(leafCategoryIds(taxonomy).has("dev"), false);
});

test("validateTaxonomy rejects duplicates and empty arrays", () => {
  assert.throws(() => validateTaxonomy({ categories: [], tags: [], statuses: [], priorities: [] }), /categories/);
  assert.throws(
    () =>
      validateTaxonomy({
        categories: [{ id: "a", label: "A" }, { id: "a", label: "A2" }],
        tags: [],
        statuses: [{ id: "s", label: "S" }],
        priorities: [{ id: "p", label: "P" }],
      }),
    /duplicate/,
  );
  assert.throws(
    () =>
      validateTaxonomy({
        categories: [{ id: "a", label: "A" }],
        tags: [],
        statuses: [],
        priorities: [{ id: "p", label: "P" }],
      }),
    /statuses/,
  );
});

test("validateStore rejects session entries that violate the schema", () => {
  assert.throws(
    () =>
      validateStore({
        schemaVersion: 1,
        taxonomy: DEFAULT_TAXONOMY,
        sessions: { "session-1": { status: "nope", priority: "normal" } },
      }),
    /status/,
  );
  assert.throws(() => validateStore({ schemaVersion: 1, sessions: {} }), /taxonomy/);
});

test("setTaxonomy replaces the taxonomy and persists", async () => {
  const file = await tempFile();
  const store = openStore({ file });
  const next = {
    categories: [{ id: "custom", label: "自定义" }],
    tags: ["x"],
    statuses: [
      { id: "todo", label: "待办" },
      { id: "doing", label: "进行中" },
      { id: "done", label: "完成" },
    ],
    priorities: [
      { id: "urgent", label: "紧急" },
      { id: "important", label: "重要" },
      { id: "normal", label: "一般" },
    ],
  };
  const snapshot = await store.setTaxonomy(next);
  assert.deepEqual(snapshot.taxonomy.categories, next.categories);
  const reopened = openStore({ file });
  assert.deepEqual((await reopened.read()).taxonomy.categories, next.categories);
});

test("config seed taxonomy is used when the store is created fresh", async () => {
  const file = await tempFile();
  const seed = {
    categories: [{ id: "seeded", label: "种子" }],
    tags: [],
    statuses: [{ id: "todo", label: "待办" }, { id: "done", label: "完成" }],
    priorities: [{ id: "normal", label: "一般" }],
  };
  const store = openStore({ file, seedTaxonomy: seed });
  const snapshot = await store.read();
  assert.deepEqual(snapshot.taxonomy.categories, seed.categories);

  // An existing file is NOT overwritten by the seed: a default store on disk
  // keeps the default taxonomy even when a seed is configured.
  const otherFile = await tempFile();
  await openStore({ file: otherFile }).read();
  const reopened = openStore({ file: otherFile, seedTaxonomy: seed });
  assert.deepEqual((await reopened.read()).taxonomy.categories, DEFAULT_TAXONOMY.categories);
});
