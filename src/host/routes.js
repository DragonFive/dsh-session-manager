/**
 * Connection Fetch route handlers for `/api/dsh-session-manager/*`.
 *
 * Handlers are plain functions over an injectable deps object so the logic
 * is unit-testable without a live dsh host; `src/host/index.js` only wires
 * them into `ctx.connection.fetch.register()`. Routes are exact-match; every
 * path below is registered separately.
 */
import { basename } from "node:path";
import { ValidationError } from "./schema.js";

const BOARD_PATH = "/api/dsh-session-manager/board";
const ANNOTATIONS_PATH = "/api/dsh-session-manager/annotations";
const TAXONOMY_PATH = "/api/dsh-session-manager/taxonomy";

const MAX_BODY_BYTES = 1 << 20; // 1 MiB, far above any single annotation

/** Expected HTTP failure surfaced as a plain Response by the route wrapper. */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export const ROUTE_PATHS = Object.freeze({
  board: BOARD_PATH,
  annotations: ANNOTATIONS_PATH,
  taxonomy: TAXONOMY_PATH,
});

/** JSON response helper (standard Fetch API, as the official routes use). */
export function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Read and parse a buffered JSON request body with a size guard. */
export async function readJsonBody(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new HttpError(413, "request body too large");
  }
  try {
    return raw === "" ? {} : JSON.parse(raw);
  } catch {
    throw new HttpError(400, "request body must be valid JSON");
  }
}

/**
 * Assemble the board payload: session corpus ⊕ annotations ⊕ running state.
 *
 * Follows the official host session-list assembly (`dsh-api-session-controller`
 * `ApiSessionList.list`): subagent-origin sessions and cold sessions without
 * a cwd are hidden; `running` is `ctx.agents.get(id)?.status === "running"`;
 * `updatedAt` is `max(createdAt, lastPromptAt)` with the projection cache as
 * a fail-soft source; the display title falls back title → cwd basename → id.
 *
 * @param {object} deps
 * @param {{ listSessions(signal?: AbortSignal): Promise<{header: object, live: boolean, persisted: boolean}[]>,
 *           readTitleSnapshots?(ids: string[], signal?: AbortSignal): Promise<{sessionId: string, status: string, value?: {title?: {title: string}}}[]> }} deps.sessionQuery
 * @param {{ list(): {id: string, path: string, title: string, sessionIds: string[]}[], archivedSessionIds: string[] } | undefined} deps.workspaceRegistry
 * @param {{ get(id: string): { status: string } | undefined } | undefined} deps.agents
 * @param {{ cachedSnapshot(header: object): { values?: { sessionListMetadata?: { lastPromptAt?: number } } } | undefined } | undefined} deps.sessionProjectionCache
 * @param {{ read(): Promise<object> }} deps.store
 */
export async function handleBoard(deps) {
  const { sessionQuery } = deps;
  if (!sessionQuery) {
    throw new HttpError(
      503,
      "session list is unavailable: this deployment does not mount @deepseek-ai/dsh-session-query",
    );
  }
  const records = await sessionQuery.listSessions();
  const visible = records.filter((record) => {
    if (record.header.origin === "subagent") return false;
    if (!record.live && record.header.cwd === undefined) return false;
    return true;
  });

  const workspaces = safeListWorkspaces(deps.workspaceRegistry);
  const byPath = new Map(workspaces.map((workspace) => [workspace.path, workspace]));
  const archived = new Set(deps.workspaceRegistry?.archivedSessionIds ?? []);

  const titles = await safeReadTitles(sessionQuery, visible.map((record) => record.header.id));
  const store = await deps.store.read();

  const sessions = visible.map((record) => {
    const header = record.header;
    const workspace = header.cwd !== undefined ? byPath.get(header.cwd) : undefined;
    const title = titles.get(header.id);
    return {
      sessionId: header.id,
      title: title ?? null,
      displayTitle: title ?? (header.cwd !== undefined ? basename(header.cwd) : header.id),
      cwd: header.cwd ?? null,
      workspaceId: workspace?.id ?? null,
      workspaceTitle: workspace?.title ?? null,
      updatedAt: updatedAtOf(header, deps.sessionProjectionCache),
      running: deps.agents?.get(header.id)?.status === "running",
      live: record.live,
      persisted: record.persisted,
      archived: archived.has(header.id),
      annotation: store.sessions[header.id] ?? null,
    };
  });
  sessions.sort((left, right) => right.updatedAt - left.updatedAt);
  return { sessions, taxonomy: store.taxonomy, generatedAt: new Date().toISOString() };
}

/** GET /annotations — the full store snapshot. */
export async function handleGetAnnotations(store) {
  return store.read();
}

/**
 * POST /annotations — upsert (or remove, with `annotation: null`) one session.
 * @param {{ upsert(input: object): Promise<object> }} store
 * @param {unknown} body
 */
export async function handleUpsertAnnotation(store, body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "request body must be {sessionId, workspaceId?, annotation}");
  }
  const { sessionId, workspaceId, annotation } = body;
  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    throw new HttpError(400, "sessionId must be a non-empty string");
  }
  if (workspaceId !== undefined && workspaceId !== null && typeof workspaceId !== "string") {
    throw new HttpError(400, "workspaceId must be a string when present");
  }
  if (annotation !== null && (typeof annotation !== "object" || Array.isArray(annotation))) {
    throw new HttpError(400, "annotation must be an object or null");
  }
  try {
    return await store.upsert({ sessionId, workspaceId, annotation });
  } catch (error) {
    if (error instanceof ValidationError) throw new HttpError(400, error.message);
    throw error;
  }
}

/**
 * POST /taxonomy — replace the taxonomy.
 * @param {{ setTaxonomy(value: unknown): Promise<object> }} store
 * @param {unknown} body
 */
export async function handleSetTaxonomy(store, body) {
  try {
    return await store.setTaxonomy(body);
  } catch (error) {
    if (error instanceof ValidationError) throw new HttpError(400, error.message);
    throw error;
  }
}

/** Workspace registry read is fail-soft: a deployment without it just loses workspace labels. */
function safeListWorkspaces(workspaceRegistry) {
  try {
    return workspaceRegistry?.list() ?? [];
  } catch {
    return [];
  }
}

/** Batch title read is fail-soft; the board falls back to cwd basename / id. */
async function safeReadTitles(sessionQuery, ids) {
  const titles = new Map();
  if (ids.length === 0 || typeof sessionQuery.readTitleSnapshots !== "function") return titles;
  try {
    const results = await sessionQuery.readTitleSnapshots(ids);
    for (const result of results) {
      if (result?.status === "fulfilled" && typeof result.value?.title?.title === "string") {
        titles.set(result.sessionId, result.value.title.title);
      }
    }
  } catch {
    // Titles are an enhancement, never a hard dependency.
  }
  return titles;
}

/** max(createdAt, lastPromptAt) with the projection cache as a fail-soft source. */
function updatedAtOf(header, sessionProjectionCache) {
  let lastPromptAt = 0;
  try {
    const metadata = sessionProjectionCache?.cachedSnapshot(header)?.values?.sessionListMetadata;
    if (typeof metadata?.lastPromptAt === "number") lastPromptAt = metadata.lastPromptAt;
  } catch {
    // Cache misses and unsupported formats fall back to createdAt.
  }
  return Math.max(typeof header.createdAt === "number" ? header.createdAt : 0, lastPromptAt);
}
