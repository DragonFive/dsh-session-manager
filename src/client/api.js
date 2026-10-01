/**
 * Same-origin fetch helpers for the host's `/api/dsh-session-manager/*`
 * routes. The Connection carrier applies browser trust checks and cookie
 * authentication, so plain `fetch` is all the client needs.
 */

async function request(path, init) {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      // status text is enough
    }
    throw new Error(`${response.status} ${detail || response.statusText}`.trim());
  }
  return response.json();
}

/** GET /api/dsh-session-manager/board */
export function fetchBoard() {
  return request("/api/dsh-session-manager/board");
}

/** GET /api/dsh-session-manager/annotations */
export function fetchAnnotations() {
  return request("/api/dsh-session-manager/annotations");
}

/**
 * POST /api/dsh-session-manager/annotations
 * @param {{ sessionId: string, workspaceId?: string | null, annotation: object | null }} input
 */
export function postAnnotation({ sessionId, workspaceId, annotation }) {
  return request("/api/dsh-session-manager/annotations", {
    method: "POST",
    body: JSON.stringify({ sessionId, workspaceId, annotation }),
  });
}

/** POST /api/dsh-session-manager/taxonomy */
export function postTaxonomy(taxonomy) {
  return request("/api/dsh-session-manager/taxonomy", {
    method: "POST",
    body: JSON.stringify(taxonomy),
  });
}

/**
 * GET /api/dsh-session-manager/prompts — the prompt library (re-read from
 * disk per request, so YAML edits are live on the next /prompt open).
 * @param {AbortSignal} [signal]
 */
export function fetchPrompts(signal) {
  return request("/api/dsh-session-manager/prompts", { signal });
}

/**
 * POST /api/dsh-session-manager/prompts — validate, serialize, and
 * atomically save the whole library (the board editor's save path).
 * @param {{ groups: object[] }} library
 */
export function postPrompts(library) {
  return request("/api/dsh-session-manager/prompts", {
    method: "POST",
    body: JSON.stringify(library),
  });
}

/** GET /api/dsh-session-manager/prompts/config — current library path config. */
export function fetchPromptsConfig() {
  return request("/api/dsh-session-manager/prompts/config");
}

/**
 * POST /api/dsh-session-manager/prompts/config — set (`"/abs/path"` or
 * `"~/…"`) or reset (null → default path) the library file location.
 * @param {string | null} promptsFile
 */
export function postPromptsConfig(promptsFile) {
  return request("/api/dsh-session-manager/prompts/config", {
    method: "POST",
    body: JSON.stringify({ promptsFile }),
  });
}

/** GET /api/dsh-session-manager/trellis — workspace task trees (read-only). */
export function fetchTrellis() {
  return request("/api/dsh-session-manager/trellis");
}

/**
 * POST /api/dsh-session-manager/trellis/export — write the anchored markdown
 * block into the target note (bare filename resolves against the export root).
 * @param {string} file
 */
export function postTrellisExport(file) {
  return request("/api/dsh-session-manager/trellis/export", {
    method: "POST",
    body: JSON.stringify({ file }),
  });
}

/** GET /api/dsh-session-manager/trellis/config — current export root. */
export function fetchTrellisConfig() {
  return request("/api/dsh-session-manager/trellis/config");
}

/** GET /api/dsh-session-manager/sync — sync settings + repo status. */
export function fetchSync() {
  return request("/api/dsh-session-manager/sync");
}

/**
 * POST /api/dsh-session-manager/sync/config — set or reset the sync
 * settings ({syncRepoPath, syncRepoUrl, syncSshKey, syncMachine}; null/"" resets).
 */
export function postSyncConfig(config) {
  return request("/api/dsh-session-manager/sync/config", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

/** POST /api/dsh-session-manager/sync/run — one full sync, returns the log. */
export function postSyncRun() {
  return request("/api/dsh-session-manager/sync/run", { method: "POST" });
}

/**
 * POST /api/dsh-session-manager/trellis/config — set or reset
 * (null → default) the note export root.
 * @param {string | null} exportRoot
 */
export function postTrellisConfig(exportRoot) {
  return request("/api/dsh-session-manager/trellis/config", {
    method: "POST",
    body: JSON.stringify({ exportRoot }),
  });
}
