/**
 * The prompt-library settings card (P2, PRD R3.1): one tab inside the
 * Settings → Plugins section (`settings.plugins.tab`), owning the library
 * file path. The card is a staged form over the plugin's own
 * `/api/dsh-session-manager/prompts/config` routes (sidecar-backed, live on
 * the next `/prompt` open) — it deliberately does not ride the official
 * Host-settings Config/SettingsForms channel, which would require
 * schemastery + dsh-settings peer imports.
 *
 * @module dsh-session-manager/prompts-settings
 */
import { useEffect, useState } from "react";
import { fetchPromptsConfig, postPromptsConfig } from "./api.js";

export function PromptsSettingsTab({ t }) {
  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPromptsConfig()
      .then((value) => {
        if (cancelled) return;
        setConfig(value);
        setDraft(value.promptsFile ?? "");
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const value = await postPromptsConfig(draft.trim() === "" ? null : draft.trim());
      setConfig(value);
      setDraft(value.promptsFile ?? "");
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (config === null && error === "") {
    return (
      <div className="dsm-settings-body">
        <div className="dsm-settings-note">{t("loading")}</div>
      </div>
    );
  }

  return (
    <div className="dsm-settings-body">
      <p className="dsm-settings-intro">{t("promptsSettingsIntro")}</p>
      <div className="dsm-dialog-field">
        <span className="dsm-dialog-label">{t("promptsFileLabel")}</span>
        <input
          className="dsm-input"
          value={draft}
          placeholder={config?.defaultFile ?? ""}
          spellCheck={false}
          onChange={(event) => {
            setDraft(event.target.value);
            setSaved(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
          }}
        />
        <span className="dsm-settings-hint">
          {t("promptsFileHint")}
          {config?.defaultFile ? `（${t("promptsDefaultPrefix")}：${config.defaultFile}）` : null}
        </span>
      </div>
      <div className="dsm-dialog-error">{error}</div>
      {saved && error === "" ? <div className="dsm-settings-saved">{t("promptsSaved")}</div> : null}
      <div className="dsm-dialog-footer">
        <button
          type="button"
          className="dsm-btn"
          disabled={busy}
          onClick={() => {
            setDraft("");
            setSaved(false);
          }}
        >
          {t("promptsResetField")}
        </button>
        <button type="button" className="dsm-btn" data-primary={true} disabled={busy} onClick={save}>
          {t("save")}
        </button>
      </div>
    </div>
  );
}
