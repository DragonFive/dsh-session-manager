/**
 * scripts/link-session.mjs: the agent-side write path into the annotation
 * sidecar. Runs the script as a child process against a temp file
 * (DSM_ANNOTATIONS_FILE) and checks the result through the same store the
 * host uses — including the hot-reload pickup of external edits.
 */
import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { openStore } from "../src/host/store.js";

const runScript = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function tempFile() {
  const dir = await mkdtemp(join(tmpdir(), "dsm-link-"));
  return join(dir, "annotations.json");
}

function link(file, ...args) {
  return runScript(process.execPath, [join(root, "scripts", "link-session.mjs"), ...args], {
    env: { ...process.env, DSM_ANNOTATIONS_FILE: file },
  });
}

test("link-session.mjs links, lists, and clears through the sidecar", async () => {
  const file = await tempFile();
  const store = openStore({ file });
  await store.read(); // create the default file

  await link(file, "session-1", "08-23-llm-pd-architecture-comparison", "doing", "important");
  // The host-side store picks the external edit up via the mtime hot-reload.
  const snapshot = await store.read();
  assert.equal(snapshot.sessions["session-1"].taskId, "08-23-llm-pd-architecture-comparison");
  assert.equal(snapshot.sessions["session-1"].status, "doing");
  assert.equal(snapshot.sessions["session-1"].priority, "important");

  // A host-side annotation made before the script runs keeps its fields.
  await store.upsert({ sessionId: "session-2", annotation: { status: "done", priority: "normal", tags: ["keep"] } });
  await link(file, "session-2", "05-25-05-25-qwen-num-return-compat");
  const after = await store.read();
  assert.equal(after.sessions["session-2"].taskId, "05-25-05-25-qwen-num-return-compat");
  assert.equal(after.sessions["session-2"].status, "done");
  assert.deepEqual(after.sessions["session-2"].tags, ["keep"]);

  const listing = await link(file, "--list");
  assert.match(listing.stdout, /session-1\s+→\s+08-23-llm-pd-architecture-comparison/);

  await link(file, "session-1", "--clear");
  const cleared = await store.read();
  assert.equal(cleared.sessions["session-1"].taskId, undefined);
});
