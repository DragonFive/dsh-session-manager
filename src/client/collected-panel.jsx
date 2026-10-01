/**
 * The collected-sessions tab (P6): sessions exported to the sync repo
 * (annotation 同步到仓库 flag) listed with their metadata, restorable onto
 * this machine to continue working. Restore without a target path is a
 * byte-identical copy into the original workspace directory; with a target
 * path the session header's cwd is rewritten first (cross-machine layouts
 * differ), which needs zstd on the host.
 *
 * @module dsh-session-manager/collected-panel
 */
import { useCallback, useEffect, useState } from "react";
import { fetchCollectedSessions, postRestoreSession } from "./api.js";

export function CollectedPanel({ t }) {
  const [data, setData] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [restoring, setRestoring] = useState(null); // sessionId being restored
  const [targetCwd, setTargetCwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setPhase("loading");
    setErrorMsg("");
    try {
      setData(await fetchCollectedSessions());
      setPhase("ready");
    } catch (reason) {
      setErrorMsg(reason instanceof Error ? reason.message : String(reason));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startRestore = (session) => {
    setNotice("");
    setErrorMsg("");
    setRestoring(session.sessionId);
    setTargetCwd(session.sourceCwd ?? "");
  };

  const restore = async (sessionId) => {
    setBusy(true);
    setErrorMsg("");
    setNotice("");
    try {
      const result = await postRestoreSession({
        sessionId,
        targetCwd: targetCwd.trim() === "" ? null : targetCwd.trim(),
      });
      setRestoring(null);
      setNotice(`${t("restoreOk")}：${result.directory}${result.rewroteCwd ? `（cwd → ${targetCwd.trim()}）` : ""}`);
      await load();
    } catch (reason) {
      setErrorMsg(`${t("restoreFailed")}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  };

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

  const sessions = data?.sessions ?? [];

  return (
    <div className="dsm-board">
      <div className="dsm-board-head">
        <span className="dsm-board-title">{t("tabCollected")}</span>
        <span className="dsm-board-count">{t("collectedCount", { count: String(sessions.length) })}</span>
        <span className="dsm-board-spacer" />
        <button type="button" className="dsm-chip" onClick={() => void load()}>
          {t("refresh")}
        </button>
      </div>
      {notice !== "" && <div className="dsm-tmsg-ok dsm-pnotice">{notice}</div>}
      {errorMsg !== "" && <div className="dsm-dialog-error dsm-pnotice">{errorMsg}</div>}
      <div className="dsm-board-body">
        {sessions.length === 0 ? (
          <div className="dsm-board-msg">{t("collectedEmpty")}</div>
        ) : (
          <table className="dsm-ttable">
            <thead>
              <tr>
                <th>{t("collectedColSession")}</th>
                <th>{t("linkedTask")}</th>
                <th>{t("status")}</th>
                <th>{t("notes")}</th>
                <th>{t("collectedColSource")}</th>
                <th>{t("collectedColExported")}</th>
                <th>{t("collectedColAction")}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.sessionId}>
                  <td title={session.sessionId}>
                    <code>{session.sessionId}</code>
                  </td>
                  <td>{session.annotation?.taskId ?? "—"}</td>
                  <td>
                    <span className="dsm-badge" data-kind={session.annotation?.status}>
                      {session.annotation?.status ?? "—"}
                    </span>
                  </td>
                  <td>{session.annotation?.notes ?? "—"}</td>
                  <td title={session.sourceCwd ?? session.sourceWorkspace ?? ""}>
                    {session.sourceWorkspace ?? "—"}
                  </td>
                  <td>{session.exportedAt ?? "—"}</td>
                  <td>
                    {session.local ? (
                      <span className="dsm-badge" data-kind="sync">
                        {t("restoreLocal")}
                      </span>
                    ) : restoring === session.sessionId ? (
                      <span className="dsm-restore-form">
                        <input
                          className="dsm-input dsm-restore-input"
                          value={targetCwd}
                          placeholder={t("restoreTargetPlaceholder")}
                          spellCheck={false}
                          onChange={(event) => setTargetCwd(event.target.value)}
                        />
                        <button type="button" className="dsm-btn" data-primary={true} disabled={busy} onClick={() => void restore(session.sessionId)}>
                          {t("restoreConfirm")}
                        </button>
                        <button type="button" className="dsm-btn" disabled={busy} onClick={() => setRestoring(null)}>
                          {t("cancel")}
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="dsm-btn" disabled={busy} onClick={() => startRestore(session)}>
                        {t("restoreBtn")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="dsm-settings-hint" style={{ paddingTop: 12 }}>
          {t("restoreHint")}
        </div>
      </div>
    </div>
  );
}
