/**
 * Sidecar annotation store: `~/.dsh/storages/dsh-session-manager/annotations.json`.
 *
 * - Single writer (this host plugin), in-memory cache + atomic persistence
 *   (temp file + rename) so a crash never leaves a half-written file.
 * - Reads validate `schemaVersion`; a corrupt or invalid file is backed up
 *   next to the original and rebuilt as an empty store — a broken sidecar
 *   must never crash the plugin (design.md §3.1 "读取" rule).
 * - All public operations are serialized through one promise chain, so
 *   concurrent upserts cannot interleave writes.
 */
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  SCHEMA_VERSION,
  ValidationError,
  defaultStoreValue,
  validateAnnotation,
  validateStore,
  validateTaxonomy,
} from "./schema.js";
import { withCustomCategory } from "./taxonomy.js";

/**
 * Open (or create) the sidecar store.
 * @param {{ file: string, logger?: { warn(message: string): void }, now?: () => string,
 *           seedTaxonomy?: unknown }} options
 * `seedTaxonomy` (validated here) replaces the default taxonomy when a fresh
 * store must be created — the plugin-config override path (PRD R2.2).
 * @returns {Promise<StoreHandle>}
 */
export function openStore({ file, logger = console, now = () => new Date().toISOString(), seedTaxonomy }) {
  const seed = seedTaxonomy === undefined ? undefined : validateTaxonomy(seedTaxonomy);
  let value = null;
  let chain = (async () => {
    value = await loadFromDisk(file, logger, seed);
  })();

  const run = (task) => {
    const next = chain.then(task, task);
    // A failed task must not poison later operations.
    chain = next.catch(() => {});
    return next;
  };

  const snapshot = () => structuredClone(value);

  return {
    file,
    schemaVersion: SCHEMA_VERSION,
    /** Current store snapshot (deep clone). */
    async read() {
      await chain;
      return snapshot();
    },
    /**
     * Upsert one session's annotation, or remove it when `annotation` is null.
     * Fields absent from the incoming annotation keep their previous values
     * (partial-patch semantics). Three fields support an explicit clear:
     * passing `category: null` / `notes: null` / `taskId: null` removes the
     * previous value instead of keeping it — the dialog (a full editor) uses
     * this so a deselected category, emptied notes, or an unlinked task
     * actually clears them.
     * New tags are merged into the taxonomy tag list.
     * @param {{ sessionId: string, workspaceId?: string, annotation: object | null }} input
     * @returns {Promise<object>} the store snapshot after the write
     */
    upsert({ sessionId, workspaceId, annotation }) {
      return run(async () => {
        if (typeof sessionId !== "string" || sessionId.trim() === "") {
          throw new ValidationError("upsert requires a non-empty sessionId");
        }
        if (annotation === null) {
          if (Object.hasOwn(value.sessions, sessionId)) {
            delete value.sessions[sessionId];
            await persist(file, value);
          }
          return snapshot();
        }
        const clearCategory = annotation.category === null;
        const clearNotes = annotation.notes === null;
        const clearTaskId = annotation.taskId === null;
        // A `custom/<label>` category id the taxonomy does not know yet is
        // registered on the fly (mirroring how new tags merge in). The
        // candidate is a copy, so a failed validation below cannot leak a
        // half-registered category into the in-memory store.
        const candidateTaxonomy = withCustomCategory(value.taxonomy, annotation.category);
        const incoming = validateAnnotation(annotation, candidateTaxonomy);
        const previous = value.sessions[sessionId] ?? {};
        const merged = { ...previous, ...incoming };
        if (clearCategory) delete merged.category;
        if (clearNotes) delete merged.notes;
        if (clearTaskId) delete merged.taskId;
        if (workspaceId !== undefined) {
          if (workspaceId !== null && typeof workspaceId !== "string") {
            throw new ValidationError("workspaceId must be a string when present");
          }
          if (workspaceId === null || workspaceId === "") delete merged.workspaceId;
          else merged.workspaceId = workspaceId;
        }
        merged.updatedAt = now();
        value.sessions[sessionId] = merged;
        // Commit the custom-category registration only on the success path
        // (all throwing checks are past); the tags array is shared by
        // reference, so the merge below works on either taxonomy object.
        if (candidateTaxonomy !== value.taxonomy) value.taxonomy = candidateTaxonomy;
        for (const tag of merged.tags) {
          if (!value.taxonomy.tags.includes(tag)) value.taxonomy.tags.push(tag);
        }
        await persist(file, value);
        return snapshot();
      });
    },
    /**
     * Replace the taxonomy wholesale.
     * @param {unknown} taxonomy
     */
    setTaxonomy(taxonomy) {
      return run(async () => {
        value.taxonomy = validateTaxonomy(taxonomy);
        await persist(file, value);
        return snapshot();
      });
    },
  };
}

/** Load and validate the file, recovering from corruption. */
async function loadFromDisk(file, logger, seed) {
  await mkdir(dirname(file), { recursive: true });
  const fresh = () => {
    const value = defaultStoreValue();
    if (seed !== undefined) value.taxonomy = structuredClone(seed);
    return value;
  };
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      const value = fresh();
      await persist(file, value);
      return value;
    }
    throw error;
  }
  try {
    return validateStore(JSON.parse(text));
  } catch (error) {
    const backup = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
    try {
      await copyFile(file, backup);
    } catch {
      // Best effort: even without a backup we rebuild rather than crash.
    }
    logger.warn(
      `[dsh-session-manager] annotations.json failed validation (${error instanceof Error ? error.message : String(error)}); backed up to ${backup} and rebuilt an empty store`,
    );
    const value = fresh();
    await persist(file, value);
    return value;
  }
}

/** Atomic write: temp file in the same directory, then rename over. */
async function persist(file, value) {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}
