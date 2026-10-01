/**
 * The single sidebar entry's main panel: four tabs — 会话看板 (P1),
 * Trellis 看板 (P3), 提示词库 editor (P2), 配置同步 (P5). One panellist
 * icon instead of four keeps the official sidebar compact; the tab bar is
 * a slim chip row at the top of the panel.
 *
 * @module dsh-session-manager/manager-panel
 */
import { useState } from "react";
import { BoardPanel } from "./board-panel.jsx";
import { CollectedPanel } from "./collected-panel.jsx";
import { PromptsPanel } from "./prompts-panel.jsx";
import { StatsPanel } from "./stats-panel.jsx";
import { SyncPanel } from "./sync-panel.jsx";
import { TrellisPanel } from "./trellis-panel.jsx";

const TABS = ["sessions", "trellis", "prompts", "sync", "collected", "stats"];
const TAB_LABELS = {
  sessions: "tabSessions",
  trellis: "tabTrellis",
  prompts: "tabPrompts",
  sync: "tabSync",
  collected: "tabCollected",
  stats: "tabStats",
};

export function ManagerPanel({ t, openSession }) {
  const [tab, setTab] = useState("sessions");
  return (
    <div className="dsm-manager">
      <div className="dsm-tabs" role="tablist">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className="dsm-chip"
            data-on={tab === id}
            onClick={() => setTab(id)}
          >
            {t(TAB_LABELS[id])}
          </button>
        ))}
      </div>
      <div className="dsm-manager-body">
        {tab === "sessions" && <BoardPanel t={t} openSession={openSession} />}
        {tab === "trellis" && <TrellisPanel t={t} openSession={openSession} />}
        {tab === "prompts" && <PromptsPanel t={t} />}
        {tab === "sync" && <SyncPanel t={t} />}
        {tab === "collected" && <CollectedPanel t={t} openSession={openSession} />}
        {tab === "stats" && <StatsPanel t={t} />}
      </div>
    </div>
  );
}
