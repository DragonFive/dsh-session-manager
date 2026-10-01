/**
 * The Session Board main panel: sessions ⊕ annotations ⊕ running state in one
 * fetch, with grouping (category / status / priority / tag), multi-select
 * filters (plus unannotated-only), updated-time ordering, an Eisenhower
 * quadrant view (design §3.2), row click-through via `ctx.uiWorkspace`,
 * and inline status/priority quick edits through the same POST route.
 * Unannotated sessions read their status/priority at the effective
 * 待办/一般 defaults everywhere (annotation-defaults.js); the sidecar stays
 * sparse until a human annotation is saved.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchBoard, fetchTrellis, postAnnotation } from "./api.js";
import { subscribeAnnotationsChanged } from "./annotate-bus.js";
import {
  DEFAULT_PRIORITY_ID,
  DEFAULT_STATUS_ID,
  effectivePriorityId,
  effectiveStatusId,
} from "./annotation-defaults.js";

const GROUP_MODES = ["category", "status", "priority", "tag"];
const UNANNOTATED_KEY = "__unannotated__";

function emptyFilters() {
  return {
    categories: new Set(),
    statuses: new Set(),
    priorities: new Set(),
    tags: new Set(),
    unannotatedOnly: false,
  };
}

function labelMaps(taxonomy) {
  const categories = new Map();
  for (const node of taxonomy?.categories ?? []) {
    if (node.children?.length > 0) {
      for (const child of node.children) categories.set(child.id, `${node.label}/${child.label}`);
    } else {
      categories.set(node.id, node.label);
    }
  }
  const statuses = new Map((taxonomy?.statuses ?? []).map((entry) => [entry.id, entry.label]));
  const priorities = new Map((taxonomy?.priorities ?? []).map((entry) => [entry.id, entry.label]));
  return { categories, statuses, priorities };
}

function formatRelative(timestamp) {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "";
  const delta = Date.now() - timestamp;
  const minutes = Math.round(delta / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(timestamp).toLocaleDateString();
}

/** dir slug → task title, flattened from the read-only Trellis scan. */
function taskTitleMap(workspaces) {
  const titles = new Map();
  for (const workspace of workspaces) {
    if (!workspace.hasTrellis) continue;
    const walk = (node) => {
      titles.set(node.dir, node.title);
      for (const child of node.children ?? []) walk(child);
    };
    for (const root of workspace.roots ?? []) walk(root);
    for (const task of workspace.standalone ?? []) titles.set(task.dir, task.title);
  }
  return titles;
}

/** Free-text search across everything visible on (or under) a row. */
function matchesSearch(session, query, taskTitles) {
  const annotation = session.annotation;
  const parts = [
    session.displayTitle,
    session.cwd,
    session.workspaceTitle,
    annotation?.notes,
    annotation?.taskId,
    annotation?.taskId !== undefined ? taskTitles.get(annotation.taskId) : undefined,
    ...(annotation?.tags ?? []),
  ];
  return parts.some((part) => typeof part === "string" && part.toLowerCase().includes(query));
}

export function BoardPanel({ t, openSession }) {
  const [data, setData] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [viewMode, setViewMode] = useState("groups");
  const [groupBy, setGroupBy] = useState("category");
  const [sortDesc, setSortDesc] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(emptyFilters);
  const [search, setSearch] = useState("");
  const [taskTitles, setTaskTitles] = useState(() => new Map());

  const load = useCallback(async () => {
    setPhase("loading");
    setErrorMsg("");
    try {
      // The Trellis scan rides along (fail-soft) so linked-task badges and
      // search can resolve taskId slugs to task titles.
      const [board, trellis] = await Promise.all([fetchBoard(), fetchTrellis().catch(() => null)]);
      setData(board);
      setTaskTitles(taskTitleMap(trellis?.workspaces ?? []));
      setPhase("ready");
    } catch (reason) {
      setErrorMsg(reason instanceof Error ? reason.message : String(reason));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A dialog save anywhere in the shell refreshes an open board.
  useEffect(() => subscribeAnnotationsChanged(() => void load()), [load]);

  const maps = useMemo(() => labelMaps(data?.taxonomy), [data]);

  const toggleFilter = (dimension, value) => {
    setFilters((prev) => {
      const next = { ...prev, [dimension]: new Set(prev[dimension]) };
      if (next[dimension].has(value)) next[dimension].delete(value);
      else next[dimension].add(value);
      return next;
    });
  };

  const toggleUnannotatedOnly = () => {
    setFilters((prev) => ({ ...prev, unannotatedOnly: !prev.unannotatedOnly }));
  };

  const visible = useMemo(() => {
    const sessions = data?.sessions ?? [];
    const query = search.trim().toLowerCase();
    const searched =
      query === ""
        ? sessions
        : sessions.filter((session) => matchesSearch(session, query, taskTitles));
    const anyFilter =
      filters.categories.size > 0 ||
      filters.statuses.size > 0 ||
      filters.priorities.size > 0 ||
      filters.tags.size > 0 ||
      filters.unannotatedOnly;
    if (!anyFilter) return searched;
    return searched.filter((session) => {
      const annotation = session.annotation;
      if (filters.unannotatedOnly && annotation !== null) return false;
      if (filters.categories.size > 0 && !filters.categories.has(annotation?.category ?? UNANNOTATED_KEY)) return false;
      // Unannotated sessions filter by their effective 待办/一般 defaults.
      if (filters.statuses.size > 0 && !filters.statuses.has(effectiveStatusId(annotation, data?.taxonomy))) return false;
      if (filters.priorities.size > 0 && !filters.priorities.has(effectivePriorityId(annotation, data?.taxonomy))) return false;
      if (filters.tags.size > 0) {
        const tags = annotation?.tags ?? [];
        if (![...filters.tags].some((tag) => tags.includes(tag))) return false;
      }
      return true;
    });
  }, [data, filters, search, taskTitles]);

  const sorted = useMemo(() => {
    const order = sortDesc ? -1 : 1;
    return [...visible].sort((left, right) => order * (left.updatedAt - right.updatedAt));
  }, [visible, sortDesc]);

  const quickPatch = useCallback(
    async (session, patch) => {
      // Unannotated sessions carry their effective 待办/一般 defaults into
      // the first saved annotation; the patch overrides the patched field.
      const base = session.annotation ?? { tags: [], status: DEFAULT_STATUS_ID, priority: DEFAULT_PRIORITY_ID };
      try {
        await postAnnotation({
          sessionId: session.sessionId,
          annotation: { ...base, ...patch },
        });
        await load();
      } catch {
        // Quick edits are best-effort; the next reload resyncs.
      }
    },
    [load],
  );

  const openSessionById = useCallback(
    (session) => {
      if (session.archived || !openSession) return;
      openSession(session.sessionId);
    },
    [openSession],
  );

  const taxonomy = data?.taxonomy;

  if (phase === "loading" && data === null) {
    return (
      <div className="dsm-board">
        <div className="dsm-board-body">
          <div className="dsm-board-msg">{t("loading")}</div>
        </div>
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div className="dsm-board">
        <div className="dsm-board-body">
          <div className="dsm-board-msg">
            {t("loadFailed")}
            <button type="button" className="dsm-btn" onClick={() => void load()}>
              {t("retry")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const total = data?.sessions?.length ?? 0;

  return (
    <div className="dsm-board">
      <div className="dsm-board-head">
        <span className="dsm-board-title">{t("panelTitle")}</span>
        <span className="dsm-board-count">{t("sessionsCount", { count: String(total) })}</span>
        <span className="dsm-board-spacer" />
        <input
          className="dsm-input dsm-search"
          value={search}
          placeholder={t("searchPlaceholder")}
          spellCheck={false}
          aria-label={t("searchPlaceholder")}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button
          type="button"
          className="dsm-chip"
          data-on={viewMode === "groups"}
          onClick={() => setViewMode("groups")}
        >
          {t("groupView")}
        </button>
        <button
          type="button"
          className="dsm-chip"
          data-on={viewMode === "quadrant"}
          onClick={() => setViewMode("quadrant")}
        >
          {t("quadrantView")}
        </button>
        {viewMode === "groups" && (
          <select
            className="dsm-quickbtn"
            value={groupBy}
            aria-label={t("groupBy")}
            onChange={(event) => setGroupBy(event.target.value)}
          >
            {GROUP_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(
                  mode === "category"
                    ? "groupByCategory"
                    : mode === "status"
                      ? "groupByStatus"
                      : mode === "priority"
                        ? "groupByPriority"
                        : "groupByTag",
                )}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="dsm-chip"
          onClick={() => setSortDesc((prev) => !prev)}
          title={t("sortByUpdated")}
        >
          {sortDesc ? t("sortDesc") : t("sortAsc")}
        </button>
        <button
          type="button"
          className="dsm-chip"
          data-on={showFilters}
          onClick={() => setShowFilters((prev) => !prev)}
        >
          {showFilters ? t("hideFilters") : t("filters")}
        </button>
        <button type="button" className="dsm-chip" onClick={() => void load()}>
          {t("refresh")}
        </button>
      </div>

      {showFilters && (
        <div className="dsm-filters">
          <FilterRow
            name={t("groupByCategory")}
            options={[...(taxonomy?.categories ?? []).flatMap((node) =>
              node.children?.length > 0
                ? node.children.map((child) => ({ id: child.id, label: `${node.label}/${child.label}` }))
                : [{ id: node.id, label: node.label }],
            )]}
            selected={filters.categories}
            onToggle={(value) => toggleFilter("categories", value)}
          />
          <FilterRow
            name={t("groupByStatus")}
            options={(taxonomy?.statuses ?? []).map((entry) => ({ id: entry.id, label: entry.label }))}
            selected={filters.statuses}
            onToggle={(value) => toggleFilter("statuses", value)}
          />
          <FilterRow
            name={t("groupByPriority")}
            options={(taxonomy?.priorities ?? []).map((entry) => ({ id: entry.id, label: entry.label }))}
            selected={filters.priorities}
            onToggle={(value) => toggleFilter("priorities", value)}
          />
          <FilterRow
            name={t("tags")}
            options={(taxonomy?.tags ?? []).map((tag) => ({ id: tag, label: tag }))}
            selected={filters.tags}
            onToggle={(value) => toggleFilter("tags", value)}
          />
          <div className="dsm-filter-row">
            <span className="dsm-filter-name" />
            <button
              type="button"
              className="dsm-chip"
              data-on={filters.unannotatedOnly}
              onClick={toggleUnannotatedOnly}
            >
              {t("onlyUnannotated")}
            </button>
          </div>
        </div>
      )}

      <div className="dsm-board-body">
        {total === 0 ? (
          <div className="dsm-board-msg">{t("noSessions")}</div>
        ) : sorted.length === 0 ? (
          <div className="dsm-board-msg">{t("empty")}</div>
        ) : viewMode === "quadrant" ? (
          <QuadrantView
            sessions={sorted}
            taxonomy={taxonomy}
            maps={maps}
            taskTitles={taskTitles}
            t={t}
            onOpen={openSessionById}
            onQuickPatch={quickPatch}
          />
        ) : (
          <GroupView
            sessions={sorted}
            groupBy={groupBy}
            taxonomy={taxonomy}
            maps={maps}
            taskTitles={taskTitles}
            t={t}
            onOpen={openSessionById}
            onQuickPatch={quickPatch}
          />
        )}
      </div>
    </div>
  );
}

function FilterRow({ name, options, selected, onToggle }) {
  if (options.length === 0) return null;
  return (
    <div className="dsm-filter-row">
      <span className="dsm-filter-name">{name}</span>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className="dsm-chip"
          data-on={selected.has(option.id)}
          onClick={() => onToggle(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function GroupView({ sessions, groupBy, taxonomy, maps, taskTitles, t, onOpen, onQuickPatch }) {
  const groups = useMemo(() => {
    const buckets = new Map();
    const push = (key, session) => {
      const list = buckets.get(key);
      if (list) list.push(session);
      else buckets.set(key, [session]);
    };
    for (const session of sessions) {
      const annotation = session.annotation;
      if (groupBy === "tag") {
        const tags = annotation?.tags ?? [];
        if (tags.length === 0) push(UNANNOTATED_KEY, session);
        else for (const tag of tags) push(tag, session);
      } else if (groupBy === "category") {
        push(annotation?.category ?? UNANNOTATED_KEY, session);
      } else if (groupBy === "status") {
        push(effectiveStatusId(annotation, taxonomy), session);
      } else {
        push(effectivePriorityId(annotation, taxonomy), session);
      }
    }
    const order = [];
    const seen = new Set();
    const addOrdered = (id) => {
      if (id !== UNANNOTATED_KEY && !seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    };
    if (groupBy === "category") {
      for (const node of taxonomy?.categories ?? []) {
        if (node.children?.length > 0) for (const child of node.children) addOrdered(child.id);
        else addOrdered(node.id);
      }
    } else if (groupBy === "status") {
      for (const entry of taxonomy?.statuses ?? []) addOrdered(entry.id);
    } else if (groupBy === "priority") {
      for (const entry of taxonomy?.priorities ?? []) addOrdered(entry.id);
    } else {
      const known = taxonomy?.tags ?? [];
      for (const tag of known) addOrdered(tag);
      for (const key of [...buckets.keys()].sort()) addOrdered(key);
    }
    if (buckets.has(UNANNOTATED_KEY)) order.push(UNANNOTATED_KEY);
    return order
      .filter((key) => buckets.has(key))
      .map((key) => ({ key, sessions: buckets.get(key) }));
  }, [sessions, groupBy, taxonomy]);

  const labelOf = (key) => {
    if (key === UNANNOTATED_KEY) return groupBy === "category" ? t("unclassified") : t("unannotated");
    if (groupBy === "category") return maps.categories.get(key) ?? key;
    if (groupBy === "status") return maps.statuses.get(key) ?? key;
    if (groupBy === "priority") return maps.priorities.get(key) ?? key;
    return key;
  };

  return groups.map((group) => (
    <section className="dsm-group" key={group.key}>
      <div className="dsm-group-head">
        <span className="dsm-group-title">{labelOf(group.key)}</span>
        <span className="dsm-group-count">{group.sessions.length}</span>
      </div>
      {group.sessions.map((session) => (
        <BoardRow
          key={session.sessionId}
          session={session}
          taxonomy={taxonomy}
          maps={maps}
          taskTitles={taskTitles}
          t={t}
          onOpen={onOpen}
          onQuickPatch={onQuickPatch}
        />
      ))}
    </section>
  ));
}

function QuadrantView({ sessions, taxonomy, maps, taskTitles, t, onOpen, onQuickPatch }) {
  const quadrants = useMemo(() => {
    const quadrants = { urgentImportant: [], importantNotUrgent: [], urgentNotImportant: [], neither: [] };
    for (const session of sessions) {
      // Unannotated sessions count as 一般 by default and flow into the
      // quadrants like any annotated session (only priority + running
      // matter here); the onlyUnannotated filter still isolates them.
      const priority = effectivePriorityId(session.annotation, taxonomy);
      const urgent = priority === "urgent" || session.running;
      const important = priority === "urgent" || priority === "important";
      if (urgent && important) quadrants.urgentImportant.push(session);
      else if (important) quadrants.importantNotUrgent.push(session);
      else if (urgent) quadrants.urgentNotImportant.push(session);
      else quadrants.neither.push(session);
    }
    return quadrants;
  }, [sessions, taxonomy]);

  const cells = [
    { id: "urgentImportant", title: t("quadrantUrgentImportant"), sessions: quadrants.urgentImportant },
    { id: "importantNotUrgent", title: t("quadrantImportantNotUrgent"), sessions: quadrants.importantNotUrgent },
    { id: "urgentNotImportant", title: t("quadrantUrgentNotImportant"), sessions: quadrants.urgentNotImportant },
    { id: "neither", title: t("quadrantNeither"), sessions: quadrants.neither },
  ];

  return (
    <div>
      <div className="dsm-quadrants">
        {cells.map((cell) => (
          <div className="dsm-quadrant" key={cell.id}>
            <div className="dsm-quadrant-title">
              {cell.title} ({cell.sessions.length})
            </div>
            {cell.sessions.map((session) => (
              <BoardRow
                key={session.sessionId}
                session={session}
                taxonomy={taxonomy}
                maps={maps}
                taskTitles={taskTitles}
                t={t}
                onOpen={onOpen}
                onQuickPatch={onQuickPatch}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function BoardRow({ session, taxonomy, maps, taskTitles, t, onOpen, onQuickPatch }) {
  const annotation = session.annotation;
  // Status/priority are always shown at their effective values: every
  // session is 待办/一般 by default until a human annotation overrides it.
  const statusId = effectiveStatusId(annotation, taxonomy);
  const priorityId = effectivePriorityId(annotation, taxonomy);
  const linkedTaskTitle =
    annotation?.taskId !== undefined ? (taskTitles?.get(annotation.taskId) ?? annotation.taskId) : undefined;
  const sub = [
    session.workspaceTitle ?? session.cwd ?? "",
    formatRelative(session.updatedAt),
  ].filter(Boolean);
  return (
    <div
      className="dsm-row"
      data-archived={session.archived}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(session)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen(session);
      }}
    >
      <div className="dsm-row-main">
        <span className="dsm-row-title">{session.displayTitle}</span>
        <span className="dsm-row-sub">{sub.join(" · ")}</span>
      </div>
      <div className="dsm-row-badges">
        {session.running && (
          <span className="dsm-badge" data-kind="running">
            {t("running")}
          </span>
        )}
        {session.archived && (
          <span className="dsm-badge" data-kind="archived">
            {t("archived")}
          </span>
        )}
        {annotation !== null && annotation.category !== undefined && (
          <span className="dsm-badge">{maps.categories.get(annotation.category) ?? annotation.category}</span>
        )}
        <span className="dsm-badge" data-kind={statusId}>
          {maps.statuses.get(statusId) ?? statusId}
        </span>
        <span className="dsm-badge" data-kind={priorityId}>
          {maps.priorities.get(priorityId) ?? priorityId}
        </span>
        {linkedTaskTitle !== undefined && (
          <span className="dsm-badge" title={annotation.taskId}>
            {linkedTaskTitle}
          </span>
        )}
        {annotation?.sync === true && (
          <span className="dsm-badge" data-kind="sync" title={t("syncedBadgeTitle")}>
            {t("syncedBadge")}
          </span>
        )}
        {annotation !== null && (
          <>
            {(annotation.tags ?? []).slice(0, 3).map((tag) => (
              <span className="dsm-badge" key={tag}>
                {tag}
              </span>
            ))}
            {(annotation.tags ?? []).length > 3 && (
              <span className="dsm-badge">+{(annotation.tags ?? []).length - 3}</span>
            )}
          </>
        )}
      </div>
      {onQuickPatch && (
        <div className="dsm-quick" onClick={(event) => event.stopPropagation()}>
          <QuickDropdown
            kind="status"
            value={statusId}
            options={[...maps.statuses.entries()].map(([id, label]) => ({ id, label }))}
            onPick={(id) => onQuickPatch(session, { status: id })}
          />
          <QuickDropdown
            kind="priority"
            value={priorityId}
            options={[...maps.priorities.entries()].map(([id, label]) => ({ id, label }))}
            onPick={(id) => onQuickPatch(session, { priority: id })}
          />
        </div>
      )}
    </div>
  );
}

function QuickDropdown({ kind, value, options, onPick }) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.id === value);
  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="dsm-quickbtn"
        title={kind === "status" ? "status" : "priority"}
        onClick={() => setOpen((prev) => !prev)}
      >
        {current?.label ?? value} ▾
      </button>
      {open && (
        <div className="dsm-menu">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              data-selected={option.id === value}
              onClick={() => {
                setOpen(false);
                if (option.id !== value) onPick(option.id);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
