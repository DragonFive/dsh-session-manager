/**
 * The Trellis milestone board main panel (P3): workspace-grouped task trees
 * assembled host-side from a read-only `.trellis/tasks` scan.
 *
 * - Parent-task cards: status badge, priority, progress bar + n/m, expandable
 *   subtask table (status / branch / PR link / completedAt).
 * - Status filter chips, manual refresh (re-fetch), empty states for
 *   workspaces without `.trellis` (never an error).
 * - "导出到笔记": filename input resolved against the configured export
 *   root (shown and editable inline), POST, inline success/failure notice.
 *
 * This side never writes `.trellis` — the export only touches the note file.
 *
 * @module dsh-session-manager/trellis-panel
 */
import { useCallback, useEffect, useMemo, useState } from "react";
// NOTE: ui-primitives icon exports carry the stroke-width suffix (`*Regular`);
// there are no bare `IconWarningOutline` exports (P1 lesson).
import { IconWarningOutlineRegular, Toast } from "@deepseek-ai/dsh-client-ui-primitives";
import { fetchBoard, fetchTrellis, fetchTrellisConfig, postTrellisConfig, postTrellisExport } from "./api.js";

/** task.json status → Chinese label (host markdown export uses the same set). */
const STATUS_LABELS = {
  planning: "未开始",
  in_progress: "进行中",
  completed: "已完成",
  archived: "已归档",
};

/** task.json status → existing board badge kind (color reuse). */
const STATUS_BADGE_KINDS = {
  planning: "todo",
  in_progress: "doing",
  completed: "done",
  archived: "archived",
};

const STATUS_ORDER = ["planning", "in_progress", "completed", "archived"];

function statusLabel(status) {
  return STATUS_LABELS[status] ?? status;
}

function statusBadgeKind(status) {
  return STATUS_BADGE_KINDS[status] ?? "unknown";
}

export function TrellisPanel({ t, openSession }) {
  const [data, setData] = useState(null);
  const [board, setBoard] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState(() => new Set());
  const [showStandalone, setShowStandalone] = useState(false);
  const [config, setConfig] = useState(null);
  const [showExport, setShowExport] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    setErrorMsg("");
    try {
      // The session board rides along (fail-soft) so task cards can show
      // which sessions are linked to each task through annotations.
      const [trellis, sessions] = await Promise.all([fetchTrellis(), fetchBoard().catch(() => null)]);
      setData(trellis);
      setBoard(sessions);
      setPhase("ready");
    } catch (reason) {
      setErrorMsg(reason instanceof Error ? reason.message : String(reason));
      setPhase("error");
    }
  }, []);

  // taskId (the .trellis/tasks dir slug) → linked sessions, joined from the
  // board payload's annotations.
  const sessionsByTask = useMemo(() => {
    const map = new Map();
    for (const session of board?.sessions ?? []) {
      const taskId = session.annotation?.taskId;
      if (taskId === undefined) continue;
      if (!map.has(taskId)) map.set(taskId, []);
      map.get(taskId).push(session);
    }
    return map;
  }, [board]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadConfig = useCallback(async () => {
    try {
      setConfig(await fetchTrellisConfig());
    } catch {
      // The export root display is an enhancement; export still reports errors.
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // Workspaces with a readable .trellis, plus ones whose scan failed (they
  // carry warnings and an explanatory empty state instead of vanishing).
  const activeWorkspaces = useMemo(
    () => (data?.workspaces ?? []).filter((workspace) => workspace.hasTrellis || workspace.warnings.length > 0),
    [data],
  );

  // Available parent-card statuses across all workspaces (filter chips).
  const availableStatuses = useMemo(() => {
    const seen = new Set();
    for (const workspace of activeWorkspaces) {
      for (const root of workspace.roots) seen.add(root.status);
    }
    return STATUS_ORDER.filter((status) => seen.has(status));
  }, [activeWorkspaces]);

  const toggleExpanded = (dir) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  // Default: the most recently active parent card starts expanded.
  useEffect(() => {
    if (phase !== "ready" || expanded.size > 0) return;
    const first = activeWorkspaces.find((workspace) => workspace.roots.length > 0)?.roots[0];
    if (first !== undefined) setExpanded(new Set([first.dir]));
  }, [phase, activeWorkspaces, expanded.size]);

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

  const totalParents = activeWorkspaces.reduce((sum, workspace) => sum + workspace.roots.length, 0);

  return (
    <div className="dsm-board">
      <div className="dsm-board-head">
        <span className="dsm-board-title">{t("trellisPanelTitle")}</span>
        <span className="dsm-board-count">{t("trellisParentsCount", { count: String(totalParents) })}</span>
        <span className="dsm-board-spacer" />
        {availableStatuses.map((status) => (
          <button
            key={status}
            type="button"
            className="dsm-chip"
            data-on={statusFilter === status}
            onClick={() => setStatusFilter(status)}
          >
            {statusLabel(status)}
          </button>
        ))}
        {availableStatuses.length > 0 && (
          <button
            type="button"
            className="dsm-chip"
            data-on={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          >
            {t("trellisFilterAll")}
          </button>
        )}
        <button
          type="button"
          className="dsm-chip"
          data-on={showExport}
          onClick={() => {
            setShowExport((prev) => !prev);
            if (!showExport) void loadConfig();
          }}
        >
          {t("trellisExport")}
        </button>
        <button type="button" className="dsm-chip" onClick={() => void load()}>
          {t("refresh")}
        </button>
      </div>

      {showExport && <ExportPanel config={config} onConfigSaved={setConfig} t={t} />}

      <div className="dsm-board-body">
        {activeWorkspaces.length === 0 ? (
          <div className="dsm-board-msg">{t("trellisEmpty")}</div>
        ) : (
          activeWorkspaces.map((workspace) => (
            <WorkspaceSection
              key={workspace.path}
              workspace={workspace}
              statusFilter={statusFilter}
              expanded={expanded}
              onToggle={toggleExpanded}
              showStandalone={showStandalone}
              onToggleStandalone={() => setShowStandalone((prev) => !prev)}
              sessionsByTask={sessionsByTask}
              onOpenSession={openSession}
              t={t}
            />
          ))
        )}
      </div>
    </div>
  );
}

function WorkspaceSection({
  workspace,
  statusFilter,
  expanded,
  onToggle,
  showStandalone,
  onToggleStandalone,
  sessionsByTask,
  onOpenSession,
  t,
}) {
  const roots =
    statusFilter === "all" ? workspace.roots : workspace.roots.filter((root) => root.status === statusFilter);
  const totalSubtasks = workspace.standalone.length;
  return (
    <section className="dsm-group">
      <div className="dsm-group-head">
        <span className="dsm-group-title">{workspace.title}</span>
        <span className="dsm-group-count">{workspace.path}</span>
      </div>
      {workspace.warnings.length > 0 && (
        <div className="dsm-twarn" title={workspace.warnings.join("\n")}>
          ⚠ {t("trellisWarnings", { count: String(workspace.warnings.length) })}
        </div>
      )}
      {roots.length === 0 && workspace.roots.length === 0 ? (
        <div className="dsm-board-msg">{t("trellisNoParents")}</div>
      ) : (
        roots.map((root) => (
          <ParentCard
            key={root.dir}
            root={root}
            expanded={expanded.has(root.dir)}
            onToggle={onToggle}
            sessionsByTask={sessionsByTask}
            onOpenSession={onOpenSession}
            t={t}
          />
        ))
      )}
      {roots.length === 0 && workspace.roots.length > 0 && (
        <div className="dsm-board-msg">{t("trellisNoMatch")}</div>
      )}
      {workspace.orphans.length > 0 && (
        <div className="dsm-twarn">
          ⚠ {t("trellisOrphans", { count: String(workspace.orphans.length) })}：
          {workspace.orphans.map((orphan) => orphan.title).join("、")}
        </div>
      )}
      {totalSubtasks > 0 && (
        <div className="dsm-tstandalone">
          <button type="button" className="dsm-chip" data-on={showStandalone} onClick={onToggleStandalone}>
            {t("trellisStandalone", { count: String(totalSubtasks) })}
          </button>
          {showStandalone && (
            <div className="dsm-tstandalone-list">
              {workspace.standalone.map((task) => (
                <div className="dsm-row" key={task.dir}>
                  <div className="dsm-row-main">
                    <span className="dsm-row-title">{task.title}</span>
                  </div>
                  <div className="dsm-row-badges">
                    <span className="dsm-badge" data-kind={statusBadgeKind(task.status)}>
                      {statusLabel(task.status)}
                    </span>
                    {(sessionsByTask?.get(task.dir) ?? []).map((session) => (
                      <SessionChip key={session.sessionId} session={session} onOpen={onOpenSession} t={t} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ParentCard({ root, expanded, onToggle, sessionsByTask, onOpenSession, t }) {
  const percent = root.totalCount === 0 ? 0 : Math.round((root.completedCount / root.totalCount) * 100);
  const linked = sessionsByTask?.get(root.dir) ?? [];
  return (
    <div className="dsm-tcard" data-open={expanded}>
      <button
        type="button"
        className="dsm-tcard-head"
        onClick={() => onToggle(root.dir)}
        aria-expanded={expanded}
      >
        <span className="dsm-chev">▶</span>
        <span className="dsm-tcard-title" title={root.title}>
          {root.title}
        </span>
        <span className="dsm-row-badges">
          <span className="dsm-badge" data-kind={statusBadgeKind(root.status)}>
            {statusLabel(root.status)}
          </span>
          {root.priority !== null && <span className="dsm-badge">{root.priority}</span>}
          {root.branch !== null && (
            <span className="dsm-badge">
              {root.branch}
            </span>
          )}
        </span>
        <span className="dsm-tcard-progress">
          <span className="dsm-tcard-bar">
            <span style={{ width: `${percent}%` }} />
          </span>
          <span className="dsm-tcard-count">
            {root.completedCount}/{root.totalCount}
          </span>
        </span>
      </button>
      {linked.length > 0 && (
        <div className="dsm-tsessions">
          {linked.map((session) => (
            <SessionChip key={session.sessionId} session={session} onOpen={onOpenSession} t={t} />
          ))}
        </div>
      )}
      {expanded && (
        <div className="dsm-tcard-body">
          <table className="dsm-ttable">
            <thead>
              <tr>
                <th>{t("trellisColSubtask")}</th>
                <th>{t("status")}</th>
                <th>{t("trellisColBranch")}</th>
                <th>PR</th>
                <th>{t("trellisColCompletedAt")}</th>
                <th>{t("sessionsCol")}</th>
              </tr>
            </thead>
            <tbody>
              {root.children.map((child) => (
                <ChildRow key={child.dir} child={child} depth={1} sessionsByTask={sessionsByTask} onOpenSession={onOpenSession} t={t} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ChildRow({ child, depth, sessionsByTask, onOpenSession, t }) {
  const linked = sessionsByTask?.get(child.dir) ?? [];
  return (
    <>
      <tr>
        <td style={{ paddingLeft: `${8 + (depth - 1) * 16}px` }}>{child.title}</td>
        <td>
          <span className="dsm-badge" data-kind={statusBadgeKind(child.status)}>
            {statusLabel(child.status)}
          </span>
        </td>
        <td>{child.branch !== null ? <code>{child.branch}</code> : "—"}</td>
        <td>
          {child.prUrl !== null ? (
            <a href={child.prUrl} target="_blank" rel="noreferrer">
              PR
            </a>
          ) : (
            "—"
          )}
        </td>
        <td>{child.completedAt ?? "—"}</td>
        <td>
          {linked.length === 0
            ? "—"
            : linked.map((session) => (
                <SessionChip key={session.sessionId} session={session} onOpen={onOpenSession} t={t} />
              ))}
        </td>
      </tr>
      {child.children.map((grandchild) => (
        <ChildRow
          key={grandchild.dir}
          child={grandchild}
          depth={depth + 1}
          sessionsByTask={sessionsByTask}
          onOpenSession={onOpenSession}
          t={t}
        />
      ))}
    </>
  );
}

/**
 * A linked-session chip on a task card / subtask row. Click opens the
 * session (archived sessions cannot be reopened, matching the board).
 */
function SessionChip({ session, onOpen, t }) {
  const label = session.archived ? `${t("archived")} · ${session.displayTitle}` : session.displayTitle;
  return (
    <button
      type="button"
      className="dsm-badge dsm-tsession"
      data-kind={session.running ? "running" : undefined}
      title={session.displayTitle}
      disabled={!onOpen || session.archived}
      onClick={() => onOpen?.(session.sessionId)}
    >
      {label}
    </button>
  );
}

function ExportPanel({ config, onConfigSaved, t }) {
  const [fileName, setFileName] = useState("trellis-roadmap.md");
  const [rootDraft, setRootDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { kind: "ok" | "err", text }
  const [toast, setToast] = useState(null); // { text, tone, icon? }

  useEffect(() => {
    if (config !== null && rootDraft === "") setRootDraft(config.customized ? config.exportRoot : "");
  }, [config, rootDraft]);

  const runExport = async () => {
    setBusy(true);
    setNotice(null);
    setToast(null);
    try {
      const result = await postTrellisExport(fileName.trim());
      setNotice({
        kind: "ok",
        text: `${t("trellisExportOk")}：${result.file}${result.backup !== null ? `（${t("trellisExportBackup")}：${result.backup}）` : ""}`,
      });
      setToast({ text: t("trellisExportOk"), tone: "success" });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setNotice({ kind: "err", text: `${t("trellisExportFailed")}：${message}` });
      setToast({ text: t("trellisExportFailed"), icon: <IconWarningOutlineRegular size={14} /> });
    } finally {
      setBusy(false);
    }
  };

  const saveRoot = async () => {
    setBusy(true);
    setNotice(null);
    setToast(null);
    try {
      const value = await postTrellisConfig(rootDraft.trim() === "" ? null : rootDraft.trim());
      onConfigSaved(value);
      setRootDraft(value.customized ? value.exportRoot : "");
      setNotice({ kind: "ok", text: t("promptsSaved") });
      setToast({ text: t("promptsSaved"), tone: "success" });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setNotice({ kind: "err", text: message });
      setToast({ text: t("saveFailed"), icon: <IconWarningOutlineRegular size={14} /> });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dsm-texport">
      <div className="dsm-texport-row">
        <span className="dsm-texport-label">{t("trellisExportRoot")}</span>
        <span className="dsm-tmeta" title={config?.exportRoot ?? ""}>
          {config?.exportRoot ?? "…"}
          {config !== null && !config.customized ? `（${t("promptsDefaultPrefix")}）` : ""}
        </span>
      </div>
      <div className="dsm-texport-row">
        <input
          className="dsm-input dsm-texport-input"
          value={rootDraft}
          placeholder={config?.defaultExportRoot ?? ""}
          spellCheck={false}
          aria-label={t("trellisExportRoot")}
          onChange={(event) => setRootDraft(event.target.value)}
        />
        <button type="button" className="dsm-btn" disabled={busy} onClick={() => void saveRoot()}>
          {t("trellisExportSaveRoot")}
        </button>
      </div>
      <div className="dsm-texport-row">
        <span className="dsm-texport-label">{t("trellisExportFile")}</span>
        <input
          className="dsm-input dsm-texport-input"
          value={fileName}
          placeholder="trellis-roadmap.md"
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key === "Enter" && fileName.trim() !== "") {
              event.preventDefault();
              void runExport();
            }
          }}
          onChange={(event) => {
            setFileName(event.target.value);
            setNotice(null);
          }}
        />
        <button
          type="button"
          className="dsm-btn"
          data-primary={true}
          disabled={busy || fileName.trim() === ""}
          onClick={() => void runExport()}
        >
          {t("trellisExportRun")}
        </button>
      </div>
      <div className="dsm-texport-row">
        <span className="dsm-settings-hint">{t("trellisExportFileHint")}</span>
      </div>
      {notice !== null && (
        <div className={notice.kind === "ok" ? "dsm-tmsg-ok" : "dsm-dialog-error"}>{notice.text}</div>
      )}
      {toast !== null && <Toast text={toast.text} tone={toast.tone} icon={toast.icon} onDone={() => setToast(null)} />}
    </div>
  );
}
