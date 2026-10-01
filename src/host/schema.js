/**
 * Hand-rolled JSON schema validation for the annotation sidecar.
 *
 * Design.md §3.1 calls for zod validation; we keep the same fail-loud
 * contract (invalid input is rejected with a descriptive error, never
 * silently coerced past the boundary) without a runtime dependency, so the
 * plugin package stays dependency-free for `file:` installs.
 */
import { defaultTaxonomy, leafCategoryIds } from "./taxonomy.js";

export const SCHEMA_VERSION = 1;

/** Validation failure with a stable, human-readable message. */
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function normalizeTagList(value, field) {
  if (!Array.isArray(value)) {
    throw new ValidationError(`taxonomy/annotation field "${field}" must be an array of strings`);
  }
  const seen = new Set();
  const tags = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new ValidationError(`taxonomy/annotation field "${field}" must contain only strings`);
    }
    const tag = entry.trim();
    if (tag === "") continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

function normalizeIdLabelList(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError(`taxonomy field "${field}" must be a non-empty array of {id, label}`);
  }
  const seen = new Set();
  const items = [];
  for (const entry of value) {
    if (!isPlainObject(entry) || !isNonEmptyString(entry.id) || !isNonEmptyString(entry.label)) {
      throw new ValidationError(`taxonomy field "${field}" entries must be {id: string, label: string}`);
    }
    const id = entry.id.trim();
    const label = entry.label.trim();
    if (seen.has(id)) {
      throw new ValidationError(`taxonomy field "${field}" has duplicate id "${id}"`);
    }
    seen.add(id);
    items.push({ id, label });
  }
  return items;
}

/**
 * Validate and normalize a taxonomy value.
 * @param {unknown} value
 * @returns {{ categories: object[], tags: string[], statuses: object[], priorities: object[] }}
 */
export function validateTaxonomy(value) {
  if (!isPlainObject(value)) {
    throw new ValidationError("taxonomy must be an object");
  }
  if (!Array.isArray(value.categories) || value.categories.length === 0) {
    throw new ValidationError('taxonomy field "categories" must be a non-empty array');
  }
  const categories = [];
  const seenIds = new Set();
  for (const node of value.categories) {
    if (!isPlainObject(node) || !isNonEmptyString(node.id) || !isNonEmptyString(node.label)) {
      throw new ValidationError("taxonomy categories entries must be {id: string, label: string}");
    }
    const id = node.id.trim();
    if (seenIds.has(id)) {
      throw new ValidationError(`taxonomy categories has duplicate id "${id}"`);
    }
    seenIds.add(id);
    const category = { id, label: node.label.trim() };
    if (node.children !== undefined) {
      if (!Array.isArray(node.children) || node.children.length === 0) {
        throw new ValidationError(`taxonomy category "${id}" children must be a non-empty array when present`);
      }
      category.children = [];
      for (const child of node.children) {
        if (!isPlainObject(child) || !isNonEmptyString(child.id) || !isNonEmptyString(child.label)) {
          throw new ValidationError(`taxonomy category "${id}" children entries must be {id, label}`);
        }
        const childId = child.id.trim();
        if (seenIds.has(childId)) {
          throw new ValidationError(`taxonomy categories has duplicate id "${childId}"`);
        }
        seenIds.add(childId);
        category.children.push({ id: childId, label: child.label.trim() });
      }
    }
    categories.push(category);
  }
  return {
    categories,
    tags: normalizeTagList(value.tags ?? [], "tags"),
    statuses: normalizeIdLabelList(value.statuses, "statuses"),
    priorities: normalizeIdLabelList(value.priorities, "priorities"),
  };
}

/**
 * Validate and normalize one annotation value against a taxonomy.
 * Absent optional fields stay absent; unknown enum ids are rejected.
 * `updatedAt` is owned by the store and ignored here.
 * @param {unknown} value
 * @param {{ statuses: {id:string}[], priorities: {id:string}[] }} taxonomy
 */
export function validateAnnotation(value, taxonomy) {
  if (!isPlainObject(value)) {
    throw new ValidationError("annotation must be an object");
  }
  const statusIds = new Set(taxonomy.statuses.map((entry) => entry.id));
  const priorityIds = new Set(taxonomy.priorities.map((entry) => entry.id));
  const categoryIds = leafCategoryIds(taxonomy);

  const annotation = {};
  if (value.category !== undefined && value.category !== null) {
    if (!isNonEmptyString(value.category)) {
      throw new ValidationError('annotation field "category" must be a non-empty string');
    }
    const category = value.category.trim();
    if (!categoryIds.has(category)) {
      throw new ValidationError(`annotation category "${category}" is not a leaf id of the taxonomy`);
    }
    annotation.category = category;
  }
  annotation.tags = normalizeTagList(value.tags ?? [], "tags");
  if (value.status === undefined) {
    throw new ValidationError('annotation field "status" is required');
  }
  if (!statusIds.has(value.status)) {
    throw new ValidationError(`annotation status "${value.status}" is not in the taxonomy`);
  }
  annotation.status = value.status;
  if (value.priority === undefined) {
    throw new ValidationError('annotation field "priority" is required');
  }
  if (!priorityIds.has(value.priority)) {
    throw new ValidationError(`annotation priority "${value.priority}" is not in the taxonomy`);
  }
  annotation.priority = value.priority;
  if (value.notes !== undefined && value.notes !== null) {
    if (typeof value.notes !== "string") {
      throw new ValidationError('annotation field "notes" must be a string');
    }
    const notes = value.notes.trim();
    if (notes !== "") annotation.notes = notes;
  }
  return annotation;
}

/**
 * Validate and normalize the complete store document.
 * @param {unknown} value
 */
export function validateStore(value) {
  if (!isPlainObject(value)) {
    throw new ValidationError("store must be an object");
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new ValidationError(`store schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (!isPlainObject(value.sessions)) {
    throw new ValidationError('store field "sessions" must be an object keyed by sessionId');
  }
  const taxonomy = validateTaxonomy(value.taxonomy);
  const sessions = {};
  for (const [sessionId, annotation] of Object.entries(value.sessions)) {
    if (!isNonEmptyString(sessionId)) {
      throw new ValidationError("store sessions keys must be non-empty session ids");
    }
    sessions[sessionId] = validateAnnotation(annotation, taxonomy);
    if (typeof annotation.workspaceId === "string" && annotation.workspaceId !== "") {
      sessions[sessionId].workspaceId = annotation.workspaceId;
    }
    if (typeof annotation.updatedAt === "string" && annotation.updatedAt !== "") {
      sessions[sessionId].updatedAt = annotation.updatedAt;
    }
  }
  return { schemaVersion: SCHEMA_VERSION, sessions, taxonomy };
}

/** A fresh empty store with the default taxonomy. */
export function defaultStoreValue() {
  return { schemaVersion: SCHEMA_VERSION, sessions: {}, taxonomy: defaultTaxonomy() };
}
