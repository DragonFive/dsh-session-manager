/**
 * The prompt-library editor tab (P2): list every group / prompt, edit
 * titles, bodies and group labels inline, add and delete entries, then
 * save the whole library through POST /prompts (validated + serialized +
 * round-trip-guarded on the host, atomically written to the YAML file).
 *
 * Editing happens on a local draft; the save button is the only write
 * path, and the dirty state is visible. Deleting the last prompt of a
 * group removes the group (after a confirm); the last group is protected.
 *
 * @module dsh-session-manager/prompts-panel
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchPrompts, postPrompts } from "./api.js";

function freshId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function PromptsPanel({ t }) {
  const [loaded, setLoaded] = useState(null);
  const [draft, setDraft] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setPhase("loading");
    setErrorMsg("");
    try {
      const library = await fetchPrompts();
      setLoaded(library);
      setDraft(structuredClone(library.groups));
      setPhase("ready");
    } catch (reason) {
      setErrorMsg(reason instanceof Error ? reason.message : String(reason));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => draft !== null && loaded !== null && JSON.stringify(draft) !== JSON.stringify(loaded.groups),
    [draft, loaded],
  );

  const totalPrompts = useMemo(
    () => (draft ?? []).reduce((sum, group) => sum + group.prompts.length, 0),
    [draft],
  );

  const mutate = (updater) => {
    setNotice("");
    setDraft((prev) => structuredClone(updater(prev)));
  };

  const addGroup = () => {
    mutate((prev) => [
      ...prev,
      { id: freshId("group"), label: t("newGroupLabel"), prompts: [{ id: freshId("prompt"), title: t("newPromptTitle"), body: t("newPromptBody") }] },
    ]);
  };

  const addPrompt = (groupId) => {
    mutate((prev) =>
      prev.map((group) =>
        group.id === groupId
          ? { ...group, prompts: [...group.prompts, { id: freshId("prompt"), title: t("newPromptTitle"), body: t("newPromptBody") }] }
          : group,
      ),
    );
  };

  const deletePrompt = (groupId, promptId) => {
    mutate((prev) =>
      prev
        .map((group) =>
          group.id === groupId
            ? { ...group, prompts: group.prompts.filter((prompt) => prompt.id !== promptId) }
            : group,
        )
        // An emptied group cannot be saved (the schema requires ≥1 prompt
        // per group), so drop it — unless it is the last one overall.
        .filter((group, index, all) => group.prompts.length > 0 || all.length === 1),
    );
  };

  const deleteGroup = (groupId) => {
    mutate((prev) => (prev.length <= 1 ? prev : prev.filter((group) => group.id !== groupId)));
  };

  const save = async () => {
    setBusy(true);
    setErrorMsg("");
    setNotice("");
    try {
      const saved = await postPrompts({ groups: draft });
      setLoaded(saved);
      setDraft(structuredClone(saved.groups));
      setNotice(t("promptsSaved"));
    } catch (reason) {
      setErrorMsg(`${t("saveFailed")}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  if (phase === "loading" && loaded === null) {
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
        <span className="dsm-board-title">{t("tabPrompts")}</span>
        <span className="dsm-board-count">{t("promptsCount", { count: String(totalPrompts) })}</span>
        {dirty && <span className="dsm-badge" data-kind="doing">{t("promptsDirty")}</span>}
        <span className="dsm-board-spacer" />
        <button type="button" className="dsm-chip" onClick={addGroup}>
          {t("newGroup")}
        </button>
        <button
          type="button"
          className="dsm-btn"
          data-primary={true}
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          {t("save")}
        </button>
        <button type="button" className="dsm-chip" onClick={() => void load()} disabled={busy}>
          {t("refresh")}
        </button>
      </div>
      {notice !== "" && <div className="dsm-tmsg-ok dsm-pnotice">{notice}</div>}
      {errorMsg !== "" && <div className="dsm-dialog-error dsm-pnotice">{errorMsg}</div>}
      <div className="dsm-board-body">
        {(draft ?? []).map((group) => (
          <section className="dsm-group" key={group.id}>
            <div className="dsm-group-head">
              <input
                className="dsm-input dsm-pgroup-label"
                value={group.label}
                aria-label={t("groupLabel")}
                onChange={(event) =>
                  mutate((prev) =>
                    prev.map((entry) => (entry.id === group.id ? { ...entry, label: event.target.value } : entry)),
                  )
                }
              />
              <span className="dsm-group-count">{group.prompts.length}</span>
              <button
                type="button"
                className="dsm-chip"
                title={t("deleteGroup")}
                disabled={draft.length <= 1}
                onClick={() => {
                  if (window.confirm(t("deleteGroupConfirm"))) deleteGroup(group.id);
                }}
              >
                {t("deleteGroup")}
              </button>
              <button type="button" className="dsm-chip" onClick={() => addPrompt(group.id)}>
                {t("newPrompt")}
              </button>
            </div>
            {group.prompts.map((prompt) => (
              <div className="dsm-pcard" key={prompt.id}>
                <div className="dsm-pcard-head">
                  <input
                    className="dsm-input dsm-pcard-title"
                    value={prompt.title}
                    aria-label={t("promptTitle")}
                    onChange={(event) =>
                      mutate((prev) =>
                        prev.map((entry) =>
                          entry.id === group.id
                            ? {
                                ...entry,
                                prompts: entry.prompts.map((p) =>
                                  p.id === prompt.id ? { ...p, title: event.target.value } : p,
                                ),
                              }
                            : entry,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="dsm-chip"
                    onClick={() => {
                      if (group.prompts.length <= 1 && draft.length > 1) {
                        if (window.confirm(t("deleteLastPromptConfirm"))) deletePrompt(group.id, prompt.id);
                      } else if (group.prompts.length <= 1) {
                        // Last prompt of the last group: protected (the
                        // library must keep at least one group + prompt).
                        setNotice(t("lastGroupProtected"));
                      } else if (window.confirm(t("deletePromptConfirm"))) {
                        deletePrompt(group.id, prompt.id);
                      }
                    }}
                  >
                    {t("delete")}
                  </button>
                </div>
                <textarea
                  className="dsm-textarea dsm-pcard-body"
                  value={prompt.body}
                  aria-label={t("promptBody")}
                  onChange={(event) =>
                    mutate((prev) =>
                      prev.map((entry) =>
                        entry.id === group.id
                          ? {
                              ...entry,
                              prompts: entry.prompts.map((p) =>
                                p.id === prompt.id ? { ...p, body: event.target.value } : p,
                              ),
                            }
                          : entry,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
