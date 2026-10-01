/**
 * dsh-session-manager host half: a cordis plugin that owns the annotation
 * sidecar store and serves it over the shared Connection Fetch channel.
 *
 * Client↔host data goes through exact `/api/dsh-session-manager/*` routes
 * (the official Session-log download channel): the browser fetches same-origin
 * with cookies, and this side never touches official session persistence.
 *
 * Injected services:
 * - `connection` (required, @deepseek-ai/dsh-client-connection): the shared
 *   Fetch route registry.
 * - `sessionQuery` (read-time, @deepseek-ai/dsh-session-query): session corpus
 *   and titles. A deployment without it gets an explicit 503 from /board.
 * - `workspaceRegistry` (read-time, @deepseek-ai/dsh-workspace): workspace
 *   titles and the archived set. Optional; labels degrade gracefully.
 * - `agents` (read-time, @deepseek-ai/dsh-agent): running state, computed the
 *   same way the official session list computes it.
 * - `sessionProjectionCache` (read-time, @deepseek-ai/dsh-session-projection-cache):
 *   lastPromptAt for "updated time". Optional; falls back to createdAt.
 *
 * @module dsh-session-manager
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { openStore } from "./store.js";
import { validateTaxonomy } from "./schema.js";
import { openPromptsLibrary } from "./prompts.js";
import { openSyncManager } from "./sync.js";
import { openTrellisExport } from "./trellis.js";
import {
  ROUTE_PATHS,
  HttpError,
  handleBoard,
  handleGetAnnotations,
  handleGetPrompts,
  handleGetPromptsConfig,
  handleGetSync,
  handleGetTrellisConfig,
  handleListCollected,
  handleRestoreSession,
  handleRunSync,
  handleSavePrompts,
  handleSetPromptsConfig,
  handleSetSyncConfig,
  handleSetTaxonomy,
  handleSetTrellisConfig,
  handleTrellis,
  handleTrellisExport,
  handleUpsertAnnotation,
  jsonResponse,
  readJsonBody,
} from "./routes.js";

export const name = "dsh-session-manager";

export const inject = ["connection"];

/**
 * @param {import("@deepseek-ai/cordis").Context} ctx
 * @param {{ storageDir?: string, taxonomy?: object }} [config]
 */
export function apply(ctx, config = {}) {
  const logger = ctx.logger ?? console;
  const storageDir =
    typeof config.storageDir === "string" && config.storageDir !== ""
      ? config.storageDir
      : join(homedir(), ".dsh", "storages", "dsh-session-manager");
  // Optional config override (PRD R2.2): a taxonomy in the plugin config seeds
  // the sidecar when the store file does not exist yet (first run). An invalid
  // config taxonomy fails loudly at startup, before any route is served.
  if (config.taxonomy !== undefined) validateTaxonomy(config.taxonomy);
  const store = openStore({
    file: join(storageDir, "annotations.json"),
    logger,
    seedTaxonomy: config.taxonomy,
  });

  // Prompt library (P2): the YAML file is re-read on every request, and the
  // path override lives in the plugin's own settings sidecar so the Settings
  // card edits are live without a restart.
  const promptsLibrary = openPromptsLibrary({
    defaultFile: join(storageDir, "prompts.yaml"),
    configFile: join(storageDir, "settings.json"),
    logger,
  });

  // Trellis export-root configuration (P3): same settings sidecar, key
  // `trellisExportRoot`; re-read per request so config edits are live.
  const trellisExport = openTrellisExport({
    configFile: join(storageDir, "settings.json"),
    logger,
  });

  // Config sync (P5): keep prompts / provider config / machine memory in a
  // git repo. Same settings sidecar (keys syncRepoPath / syncRepoUrl /
  // syncSshKey / syncMachine); the machine config deploys to the web
  // profile's user patch layer. Annotations flagged `sync: true` export
  // their session transcript into the repo's sessions/ directory.
  const syncManager = openSyncManager({
    configFile: join(storageDir, "settings.json"),
    deployTarget: join(homedir(), ".dsh", "profiles", "web", "cordis.patch.yml"),
    annotationsFile: join(storageDir, "annotations.json"),
    // Session cwd lookup for the export metadata (fail-soft, per call).
    listSessionHeaders: async () => {
      const sessionQuery = ctx.get("sessionQuery");
      if (sessionQuery === undefined) return [];
      const records = await sessionQuery.listSessions();
      return records.map((record) => ({ id: record.header.id, cwd: record.header.cwd }));
    },
    logger,
  });

  const deps = () => ({
    store,
    sessionQuery: ctx.get("sessionQuery"),
    workspaceRegistry: ctx.get("workspaceRegistry"),
    agents: ctx.get("agents"),
    sessionProjectionCache: ctx.get("sessionProjectionCache"),
    trellis: trellisExport,
    logger,
  });

  /** Convert thrown errors into plain HTTP responses; never leak stack traces. */
  const guarded = (handler) => async (request) => {
    try {
      return jsonResponse(await handler(request));
    } catch (error) {
      if (error instanceof HttpError) {
        return new Response(error.message, { status: error.status });
      }
      logger.warn?.(
        `[dsh-session-manager] route failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
      return new Response("internal error", { status: 500 });
    }
  };

  const routes = [
    {
      path: ROUTE_PATHS.board,
      methods: ["GET"],
      requestBody: "buffered",
      fetch: guarded(() => handleBoard(deps())),
    },
    {
      path: ROUTE_PATHS.annotations,
      methods: ["GET", "POST"],
      requestBody: "buffered",
      fetch: guarded(async (request) => {
        if (request.method === "GET") return handleGetAnnotations(store);
        return handleUpsertAnnotation(store, await readJsonBody(request));
      }),
    },
    {
      path: ROUTE_PATHS.taxonomy,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: guarded(async (request) => handleSetTaxonomy(store, await readJsonBody(request))),
    },
    {
      path: ROUTE_PATHS.prompts,
      methods: ["GET", "POST"],
      requestBody: "buffered",
      fetch: guarded(async (request) => {
        if (request.method === "GET") return handleGetPrompts(promptsLibrary);
        return handleSavePrompts(promptsLibrary, await readJsonBody(request));
      }),
    },
    {
      path: ROUTE_PATHS.promptsConfig,
      methods: ["GET", "POST"],
      requestBody: "buffered",
      fetch: guarded(async (request) => {
        if (request.method === "GET") return handleGetPromptsConfig(promptsLibrary);
        return handleSetPromptsConfig(promptsLibrary, await readJsonBody(request));
      }),
    },
    {
      path: ROUTE_PATHS.trellis,
      methods: ["GET"],
      requestBody: "buffered",
      fetch: guarded(() => handleTrellis(deps())),
    },
    {
      path: ROUTE_PATHS.trellisExport,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: guarded(async (request) => handleTrellisExport(deps(), await readJsonBody(request))),
    },
    {
      path: ROUTE_PATHS.trellisConfig,
      methods: ["GET", "POST"],
      requestBody: "buffered",
      fetch: guarded(async (request) => {
        if (request.method === "GET") return handleGetTrellisConfig(trellisExport);
        return handleSetTrellisConfig(trellisExport, await readJsonBody(request));
      }),
    },
    {
      path: ROUTE_PATHS.sync,
      methods: ["GET"],
      requestBody: "buffered",
      fetch: guarded(() => handleGetSync(syncManager)),
    },
    {
      path: ROUTE_PATHS.syncConfig,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: guarded(async (request) => handleSetSyncConfig(syncManager, await readJsonBody(request))),
    },
    {
      path: ROUTE_PATHS.syncRun,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: guarded(() => handleRunSync(syncManager)),
    },
    {
      path: ROUTE_PATHS.syncSessions,
      methods: ["GET"],
      requestBody: "buffered",
      fetch: guarded(() => handleListCollected(syncManager)),
    },
    {
      path: ROUTE_PATHS.syncRestore,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: guarded(async (request) => handleRestoreSession(syncManager, await readJsonBody(request))),
    },
  ];

  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.connection.fetch.register(route));
    return () => {
      for (const dispose of disposers) void dispose();
    };
  }, "dsh-session-manager: connection fetch routes");
}
