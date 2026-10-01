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
import {
  ROUTE_PATHS,
  HttpError,
  handleBoard,
  handleGetAnnotations,
  handleSetTaxonomy,
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

  const deps = () => ({
    store,
    sessionQuery: ctx.get("sessionQuery"),
    workspaceRegistry: ctx.get("workspaceRegistry"),
    agents: ctx.get("agents"),
    sessionProjectionCache: ctx.get("sessionProjectionCache"),
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
  ];

  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.connection.fetch.register(route));
    return () => {
      for (const dispose of disposers) void dispose();
    };
  }, "dsh-session-manager: connection fetch routes");
}
