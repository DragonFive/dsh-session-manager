/**
 * The annotation dialog: category (tree), tags (multi + create), status,
 * priority, linked Trellis task, notes. Opened from the session row menu
 * item and the hover icon.
 *
 * Uses the platform-baseline `Modal` primitive (body-portaled, Escape and
 * mask handling included) so the dialog matches official chrome without
 * touching any official stylesheet.
 */
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import { fetchAnnotations, fetchTrellis, postAnnotation } from "./api.js";
import { DEFAULT_PRIORITY_ID, DEFAULT_STATUS_ID } from "./annotation-defaults.js";

// A fresh annotation starts from the board-wide effective defaults
// (待办/一般); saving materializes them only because the dialog is a full
// editor that always submits status/priority.
const EMPTY = {
  category: undefined,
  tags: [],
  status: DEFAULT_STATUS_ID,
  priority: DEFAULT_PRIORITY_ID,
  notes: "",
};

// Must stay in sync with CUSTOM_CATEGORY_PREFIX in src/host/taxonomy.js:
// ids in this namespace are auto-registered into the taxonomy on save.
const CUSTOM_CATEGORY_PREFIX = "custom/";

export function AnnotateDialog({ open, onClose, sessionId, displayTitle, onSaved, t }) {
  const [draft, setDraft] = useState(EMPTY);
  const [newTag, setNewTag] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [taxonomy, setTaxonomy] = useState(null);
  const [taskGroups, setTaskGroups] = useState([]);

  // Prefill from the sidecar each time the dialog opens; the store snapshot
  // also carries the taxonomy the pickers render from. The Trellis task
  // list is fetched in parallel (fail-soft: without it the linked-task
  // select just shows the stored value).
  useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    setError("");
    setDraft(EMPTY);
    setNewTag("");
    setNewCategory("");
    setTaxonomy(null);
    setTaskGroups([]);
    fetchAnnotations()
      .then((store) => {
        if (cancelled) return;
        setTaxonomy(store?.taxonomy ?? null);
        const existing = store?.sessions?.[sessionId];
        setDraft(
          existing
            ? {
                category: existing.category,
                tags: [...(existing.tags ?? [])],
                status: existing.status ?? DEFAULT_STATUS_ID,
                priority: existing.priority ?? DEFAULT_PRIORITY_ID,
                taskId: existing.taskId,
                notes: existing.notes ?? "",
              }
            : EMPTY,
        );
      })
      .catch(() => {
        // Prefill failure is non-fatal: the dialog still starts from defaults.
      });
    fetchTrellis()
      .then((value) => {
        if (cancelled) return;
        setTaskGroups(collectTaskGroups(value?.workspaces ?? []));
      })
      .catch(() => {
        // No .trellis anywhere: the linked-task select stays empty.
      });
    return () => {
      cancelled = true;
    };
  }, [open, sessionId]);

  const categories = taxonomy?.categories ?? [];
  const statuses = taxonomy?.statuses ?? [];
  const priorities = taxonomy?.priorities ?? [];
  const knownTags = useMemo(() => taxonomy?.tags ?? [], [taxonomy]);

  const toggleTag = (tag) => {
    setDraft((prev) => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter((entry) => entry !== tag) : [...prev.tags, tag],
    }));
  };

  const commitNewTag = () => {
    const tag = newTag.trim();
    if (tag === "") return;
    setNewTag("");
    setDraft((prev) => (prev.tags.includes(tag) ? prev : { ...prev, tags: [...prev.tags, tag] }));
  };

  const commitNewCategory = () => {
    const label = newCategory.trim();
    if (label === "") return;
    setNewCategory("");
    // Reuse an existing category that already carries this label instead of
    // minting a duplicate custom id.
    for (const node of categories) {
      if (node.children?.length > 0) {
        for (const child of node.children) {
          if (child.label === label) {
            setDraft((prev) => ({ ...prev, category: child.id }));
            return;
          }
        }
      } else if (node.label === label) {
        setDraft((prev) => ({ ...prev, category: node.id }));
        return;
      }
    }
    // New custom category: the host registers `custom/<label>` into the
    // taxonomy on save; append it to the local copy so the chip renders
    // immediately.
    const id = `${CUSTOM_CATEGORY_PREFIX}${label}`;
    setDraft((prev) => (prev.category === id ? prev : { ...prev, category: id }));
    setTaxonomy((prev) =>
      prev ? { ...prev, categories: [...prev.categories, { id, label }] } : prev,
    );
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const notes = draft.notes.trim();
      const annotation = {
        // null = explicit clear: the dialog is a full editor, so a deselected
        // category / emptied notes / unlinked task must clear the stored
        // values (a partial patch that omits the field would keep them).
        category: draft.category ?? null,
        tags: draft.tags,
        status: draft.status,
        priority: draft.priority,
        taskId: draft.taskId ?? null,
        notes: notes === "" ? null : notes,
      };
      await postAnnotation({ sessionId, annotation });
      onSaved?.();
      onClose();
    } catch (reason) {
      setError(`${t("saveFailed")}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!window.confirm(t("clearConfirm"))) return;
    setBusy(true);
    setError("");
    try {
      await postAnnotation({ sessionId, annotation: null });
      onSaved?.();
      onClose();
    } catch (reason) {
      setError(`${t("saveFailed")}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("annotateTitle")} closeLabel={t("cancel")}>
      <div className="dsm-dialog-body">
        <div className="dsm-dialog-field">
          <span className="dsm-dialog-label">{displayTitle}</span>
        </div>
        <div className="dsm-dialog-field">
          <span className="dsm-dialog-label">{t("category")}</span>
          {categories.map((node) => (
            <div className="dsm-pill-row" key={node.id}>
              {node.children?.length > 0 ? (
                node.children.map((child) => (
                  <button
                    key={child.id}
                    type="button"
                    className="dsm-pill"
                    data-on={draft.category === child.id}
                    data-indent={true}
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        category: prev.category === child.id ? undefined : child.id,
                      }))
                    }
                  >
                    {`${node.label} / ${child.label}`}
                  </button>
                ))
              ) : (
                <button
                  type="button"
                  className="dsm-pill"
                  data-on={draft.category === node.id}
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      category: prev.category === node.id ? undefined : node.id,
                    }))
                  }
                >
                  {node.label}
                </button>
              )}
            </div>
          ))}
          <input
            className="dsm-input"
            value={newCategory}
            placeholder={t("newCategoryPlaceholder")}
            onChange={(event) => setNewCategory(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitNewCategory();
              }
            }}
            onBlur={commitNewCategory}
          />
        </div>
        <div className="dsm-dialog-field">
          <span className="dsm-dialog-label">{t("tags")}</span>
          <div className="dsm-pill-row">
            {[...new Set([...knownTags, ...draft.tags])].map((tag) => (
              <button
                key={tag}
                type="button"
                className="dsm-pill"
                data-on={draft.tags.includes(tag)}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
          <input
            className="dsm-input"
            value={newTag}
            placeholder={t("tagPlaceholder")}
            onChange={(event) => setNewTag(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitNewTag();
              }
            }}
            onBlur={commitNewTag}
          />
        </div>
        <div className="dsm-dialog-field">
          <span className="dsm-dialog-label">{t("status")}</span>
          <div className="dsm-pill-row">
            {statuses.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="dsm-pill"
                data-on={draft.status === entry.id}
                onClick={() => setDraft((prev) => ({ ...prev, status: entry.id }))}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
        <div className="dsm-dialog-field">
          <span className="dsm-dialog-label">{t("priority")}</span>
          <div className="dsm-pill-row">
            {priorities.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="dsm-pill"
                data-on={draft.priority === entry.id}
                onClick={() => setDraft((prev) => ({ ...prev, priority: entry.id }))}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
        <div className="dsm-dialog-field">
          <span className="dsm-dialog-label">{t("linkedTask")}</span>
          <select
            className="dsm-input"
            value={draft.taskId ?? ""}
            aria-label={t("linkedTask")}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, taskId: event.target.value === "" ? undefined : event.target.value }))
            }
          >
            <option value="">{t("noLinkedTask")}</option>
            {taskGroups.map((group) => (
              <optgroup key={group.workspaceTitle} label={group.workspaceTitle}>
                {group.tasks.map((task) => (
                  <option key={task.dir} value={task.dir}>
                    {task.title}
                  </option>
                ))}
              </optgroup>
            ))}
            {draft.taskId !== undefined && !taskGroups.some((group) => group.tasks.some((task) => task.dir === draft.taskId)) && (
              // The linked task is not in the scanned list (archived, or the
              // trellis fetch failed): keep the stored value selectable so
              // saving does not silently drop the link.
              <option value={draft.taskId}>{`${draft.taskId}（${t("linkedTaskMissing")}）`}</option>
            )}
          </select>
        </div>
        <div className="dsm-dialog-field">
          <span className="dsm-dialog-label">{t("notes")}</span>
          <textarea
            className="dsm-textarea"
            value={draft.notes}
            placeholder={t("notesPlaceholder")}
            onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))}
          />
        </div>
        <div className="dsm-dialog-error">{error}</div>
        <div className="dsm-dialog-footer">
          <button type="button" className="dsm-btn dsm-btn-danger" disabled={busy} onClick={clear}>
            {t("clear")}
          </button>
          <button type="button" className="dsm-btn" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="button" className="dsm-btn" data-primary={true} disabled={busy} onClick={save}>
            {t("save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Flatten the read-only Trellis scan into select groups: one optgroup per
 * workspace, tasks = every node of every root tree plus the standalone
 * tasks. `dir` (the .trellis/tasks slug) is the value stored in
 * annotations as `taskId`.
 */
function collectTaskGroups(workspaces) {
  const groups = [];
  for (const workspace of workspaces) {
    if (!workspace.hasTrellis) continue;
    const tasks = [];
    const walk = (node) => {
      tasks.push({ dir: node.dir, title: node.title });
      for (const child of node.children ?? []) walk(child);
    };
    for (const root of workspace.roots ?? []) walk(root);
    for (const task of workspace.standalone ?? []) tasks.push({ dir: task.dir, title: task.title });
    if (tasks.length > 0) groups.push({ workspaceTitle: workspace.title, tasks });
  }
  return groups;
}
