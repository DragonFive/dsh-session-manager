/**
 * The config-sync tab (P5): configure the sync repo (local path / git URL /
 * SSH key), see its status (machine id, dirty files, last commit), and run
 * one full sync — pull, deploy this machine's provider config, point the
 * prompt library at the repo copy, commit and push local edits. The
 * step-by-step log is shown inline.
 *
 * The mechanical sync lives here (no session needed); judgment work
 * (conflict arbitration, memory curation) stays with the 会话-side
 * 「同步 dsh 配置」prompt — see dsh-sync's README.
 *
 * @module dsh-session-manager/sync-panel
 */
import { useCallback, useEffect, useState } from "react";
import { fetchSync, postSyncConfig, postSyncRun } from "./api.js";

export function SyncPanel({ t }) {
  const [data, setData] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [machine, setMachine] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [log, setLog] = useState(null);

  const load = useCallback(async () => {
    setPhase("loading");
    setErrorMsg("");
    try {
      const value = await fetchSync();
      setData(value);
      setRepoPath(value.repoPath ?? "");
      setRepoUrl(value.repoUrl ?? "");
      setSshKey(value.sshKey ?? "");
      setMachine(value.machine ?? "");
      setPhase("ready");
    } catch (reason) {
      setErrorMsg(reason instanceof Error ? reason.message : String(reason));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveConfig = async () => {
    setBusy(true);
    setErrorMsg("");
    setNotice("");
    setLog(null);
    try {
      const value = await postSyncConfig({
        syncRepoPath: repoPath.trim() === "" ? null : repoPath.trim(),
        syncRepoUrl: repoUrl.trim() === "" ? null : repoUrl.trim(),
        syncSshKey: sshKey.trim() === "" ? null : sshKey.trim(),
        syncMachine: machine.trim() === "" ? null : machine.trim(),
      });
      setData(value);
      setNotice(t("promptsSaved"));
    } catch (reason) {
      setErrorMsg(`${t("saveFailed")}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  const runSync = async () => {
    setBusy(true);
    setErrorMsg("");
    setNotice("");
    setLog(null);
    try {
      const result = await postSyncRun();
      setLog(result.lines);
      await load();
    } catch (reason) {
      setErrorMsg(`${t("syncFailed")}: ${reason instanceof Error ? reason.message : String(reason)}`);
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

  return (
    <div className="dsm-board">
      <div className="dsm-board-head">
        <span className="dsm-board-title">{t("tabSync")}</span>
        {data?.repoReady ? (
          <span className="dsm-badge" data-kind="done">{t("syncRepoReady")}</span>
        ) : (
          <span className="dsm-badge" data-kind="urgent">{t("syncRepoMissing")}</span>
        )}
        <span className="dsm-board-count">{data?.machine ? `machine=${data.machine}` : ""}</span>
        <span className="dsm-board-spacer" />
        <button
          type="button"
          className="dsm-btn"
          data-primary={true}
          disabled={busy || data?.repoPath === null}
          onClick={() => void runSync()}
        >
          {t("syncRun")}
        </button>
        <button type="button" className="dsm-chip" disabled={busy} onClick={() => void load()}>
          {t("refresh")}
        </button>
      </div>
      <div className="dsm-board-body">
        <div className="dsm-sync">
          <div className="dsm-sync-row">
            <span className="dsm-sync-label">{t("syncRepoPathLabel")}</span>
            <input
              className="dsm-input dsm-sync-input"
              value={repoPath}
              placeholder="~/dev/dsh-sync"
              spellCheck={false}
              onChange={(event) => setRepoPath(event.target.value)}
            />
          </div>
          <div className="dsm-sync-row">
            <span className="dsm-sync-label">{t("syncRepoUrlLabel")}</span>
            <input
              className="dsm-input dsm-sync-input"
              value={repoUrl}
              placeholder="git@github.com:DragonFive/dsh-sync.git"
              spellCheck={false}
              onChange={(event) => setRepoUrl(event.target.value)}
            />
          </div>
          <div className="dsm-settings-hint">{t("syncRepoUrlHint")}</div>
          <div className="dsm-sync-row">
            <span className="dsm-sync-label">{t("syncSshKeyLabel")}</span>
            <input
              className="dsm-input dsm-sync-input"
              value={sshKey}
              placeholder="~/.ssh/id_ed25519"
              spellCheck={false}
              onChange={(event) => setSshKey(event.target.value)}
            />
          </div>
          <div className="dsm-settings-hint">{t("syncSshKeyHint")}</div>
          <div className="dsm-sync-row">
            <span className="dsm-sync-label">{t("syncMachineLabel")}</span>
            <input
              className="dsm-input dsm-sync-input"
              value={machine}
              placeholder={data?.machine ?? ""}
              spellCheck={false}
              onChange={(event) => setMachine(event.target.value)}
            />
            <button type="button" className="dsm-btn" disabled={busy} onClick={() => void saveConfig()}>
              {t("syncSaveConfig")}
            </button>
          </div>
          <div className="dsm-settings-hint">{t("syncMachineHint")}</div>
          {notice !== "" && <div className="dsm-tmsg-ok">{notice}</div>}
          {errorMsg !== "" && <div className="dsm-dialog-error">{errorMsg}</div>}
          {data?.repoReady && data.status !== null && (
            <div className="dsm-sync-status">
              <div>
                {t("syncDirtyFiles")}: <b>{data.status.dirty.length}</b>
                {data.status.dirty.length > 0 && (
                  <span className="dsm-settings-hint"> ({data.status.dirty.slice(0, 5).join("、")}{data.status.dirty.length > 5 ? "…" : ""})</span>
                )}
              </div>
              <div>
                {t("syncLastCommit")}: <span className="dsm-settings-hint">{data.status.lastCommit}</span>
              </div>
            </div>
          )}
          {log !== null && (
            <div>
              <div className="dsm-sync-log-title">{t("syncLogTitle")}</div>
              <pre className="dsm-sync-log">{log.join("\n")}</pre>
            </div>
          )}
          <div className="dsm-settings-hint">{t("syncEffectHint")}</div>
        </div>
      </div>
    </div>
  );
}
