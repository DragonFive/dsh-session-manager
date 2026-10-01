/**
 * Default taxonomy for session annotations (design.md §3.1 / P1 PRD R2.2).
 *
 * Category ids are stable machine keys; labels are Chinese-first UI text.
 * `category` on an annotation always references a LEAF id (a node without
 * children) so grouping is unambiguous.
 */
export const DEFAULT_TAXONOMY = Object.freeze({
  categories: Object.freeze([
    Object.freeze({
      id: "dev",
      label: "功能开发",
      children: Object.freeze([
        Object.freeze({ id: "dev/llm", label: "LLM方向" }),
        Object.freeze({ id: "dev/rec", label: "生成式推荐" }),
      ]),
    }),
    Object.freeze({ id: "pr-review", label: "PR评审" }),
    Object.freeze({ id: "study", label: "代码学习" }),
    Object.freeze({ id: "misc", label: "测试/杂项" }),
  ]),
  tags: Object.freeze([]),
  statuses: Object.freeze([
    Object.freeze({ id: "todo", label: "待办" }),
    Object.freeze({ id: "doing", label: "进行中" }),
    Object.freeze({ id: "done", label: "完成" }),
  ]),
  priorities: Object.freeze([
    Object.freeze({ id: "urgent", label: "紧急" }),
    Object.freeze({ id: "important", label: "重要" }),
    Object.freeze({ id: "normal", label: "一般" }),
  ]),
});

/** Deep-clone the default taxonomy so callers can mutate their copy safely. */
export function defaultTaxonomy() {
  return structuredClone(DEFAULT_TAXONOMY);
}

/** All leaf category ids of a taxonomy (nodes without children). */
export function leafCategoryIds(taxonomy) {
  const ids = new Set();
  for (const node of taxonomy.categories ?? []) {
    if (Array.isArray(node.children) && node.children.length > 0) {
      for (const child of node.children) ids.add(child.id);
    } else {
      ids.add(node.id);
    }
  }
  return ids;
}

/** All category ids (internal nodes included) of a taxonomy. */
export function allCategoryIds(taxonomy) {
  const ids = new Set();
  for (const node of taxonomy.categories ?? []) {
    ids.add(node.id);
    for (const child of node.children ?? []) ids.add(child.id);
  }
  return ids;
}

/**
 * Id namespace for user-created categories. Any leaf id under this prefix is
 * auto-registered into the taxonomy on save — the category counterpart of
 * how new tags merge into `taxonomy.tags`. The prefix keeps preset ids
 * strict: only explicitly custom ids can mint new categories.
 */
export const CUSTOM_CATEGORY_PREFIX = "custom/";

/**
 * Return a taxonomy that also knows the custom leaf category `rawId`
 * (`"custom/<label>"`), or the same taxonomy reference when nothing needs
 * adding: non-`custom/` ids, an empty label after the prefix, or an id that
 * already exists. Pure — the input taxonomy is never mutated, so a failed
 * validation on the candidate cannot leak a half-registered category into
 * the in-memory store.
 * @param {{ categories?: object[] }} taxonomy
 * @param {unknown} rawId
 * @returns {object} a taxonomy (the same reference when unchanged)
 */
export function withCustomCategory(taxonomy, rawId) {
  if (typeof rawId !== "string") return taxonomy;
  const id = rawId.trim();
  if (!id.startsWith(CUSTOM_CATEGORY_PREFIX)) return taxonomy;
  const label = id.slice(CUSTOM_CATEGORY_PREFIX.length).trim();
  if (label === "") return taxonomy;
  if (allCategoryIds(taxonomy).has(id)) return taxonomy;
  return { ...taxonomy, categories: [...(taxonomy.categories ?? []), { id, label }] };
}

/**
 * Resolve a leaf category node by id, walking the (two-level) tree.
 * @returns {{ id: string, label: string, parentId?: string, parentLabel?: string } | undefined}
 */
export function findCategory(taxonomy, id) {
  if (typeof id !== "string" || id === "") return undefined;
  for (const node of taxonomy.categories ?? []) {
    if (node.id === id && !(node.children?.length > 0)) {
      return { id: node.id, label: node.label };
    }
    for (const child of node.children ?? []) {
      if (child.id === id) {
        return { id: child.id, label: child.label, parentId: node.id, parentLabel: node.label };
      }
    }
  }
  return undefined;
}
