#!/usr/bin/env node
/**
 * Link (or unlink) a session to a Trellis task by editing the annotation
 * sidecar directly — the agent-side write path ("会话自己知道自己在做哪个
 * 任务，干活时顺手把关联写上").
 *
 *   node scripts/link-session.mjs <sessionId> <taskId> [status] [priority]
 *   node scripts/link-session.mjs <sessionId> --clear
 *   node scripts/link-session.mjs --list
 *
 * Safe against a running dsh web host: the store hot-reloads externally
 * modified sidecars (mtime check, see src/host/store.js). The new document
 * is validated with the same schema the host uses BEFORE the atomic write,
 * so a bad edit can never poison the store.
 *
 * The sidecar location defaults to ~/.dsh/storages/dsh-session-manager/
 * (override with DSM_ANNOTATIONS_FILE, mainly for tests).
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defaultStoreValue, validateStore } from "../src/host/schema.js";

const file =
  process.env.DSM_ANNOTATIONS_FILE ??
  join(homedir(), ".dsh", "storages", "dsh-session-manager", "annotations.json");

async function loadSidecar() {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return defaultStoreValue(); // first run: start from the default store
  }
  const value = JSON.parse(text);
  validateStore(value); // fail loudly on a sidecar we do not understand
  return value;
}

async function persist(value) {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

const [sessionId, taskId, status, priority] = process.argv.slice(2);

if (sessionId === "--list") {
  const value = await loadSidecar();
  const linked = Object.entries(value.sessions).filter(([, a]) => a.taskId !== undefined);
  if (linked.length === 0) {
    console.log(`[link-session] no linked sessions in ${file}`);
  } else {
    for (const [id, annotation] of linked) {
      console.log(`${id}  →  ${annotation.taskId}  (status=${annotation.status}, priority=${annotation.priority})`);
    }
  }
  process.exit(0);
}

if (typeof sessionId !== "string" || sessionId.trim() === "" || typeof taskId !== "string") {
  console.error("usage: link-session.mjs <sessionId> <taskId> [status] [priority] | <sessionId> --clear | --list");
  process.exit(2);
}

const value = await loadSidecar();
const previous = value.sessions[sessionId] ?? {};
const annotation = {
  ...previous,
  tags: previous.tags ?? [],
  status: status ?? previous.status ?? "todo",
  priority: priority ?? previous.priority ?? "normal",
  updatedAt: new Date().toISOString(),
};
if (taskId === "--clear") {
  delete annotation.taskId;
} else {
  annotation.taskId = taskId.trim();
}
value.sessions[sessionId] = annotation;
validateStore(value);
await persist(value);
console.log(
  `[link-session] ${sessionId} ${taskId === "--clear" ? "unlinked" : `→ ${annotation.taskId}`} (status=${annotation.status}, priority=${annotation.priority})`,
);
