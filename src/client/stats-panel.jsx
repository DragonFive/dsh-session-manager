/**
 * The token-usage statistics tab (P7): aggregates from the local session
 * transcripts — the same columns aio-coding-hub tracks (input / output /
 * cache-read / total tokens, request counts). Summary cards, a per-model
 * table, a per-day table (CSS bars, no chart dependency), and the top
 * sessions. Range chips: 7 / 30 / 90 days / all time.
 *
 * @module dsh-session-manager/stats-panel
 */
import { useCallback, useEffect, useState } from "react";
import { fetchStats } from "./api.js";

const RANGES = [
  { days: 7, label: "statsRange7" },
  { days: 30, label: "statsRange30" },
  { days: 90, label: "statsRange90" },
  { days: 0, label: "statsRangeAll" },
];

/** 1234567 → "1.23M" / "23.4K"; keep raw for < 1000. */
function formatTokens(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function StatsPanel({ t }) {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(30);
  const [phase, setPhase] = useState("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async (range) => {
    setPhase("loading");
    setErrorMsg("");
    try {
      setData(await fetchStats(range));
      setPhase("ready");
    } catch (reason) {
      setErrorMsg(reason instanceof Error ? reason.message : String(reason));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [load, days]);

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
            <button type="button" className="dsm-btn" onClick={() => void load(days)}>
              {t("retry")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const summary = data?.summary ?? { requests: 0, input: 0, output: 0, cacheRead: 0, total: 0, sessions: 0 };
  const byModel = data?.byModel ?? [];
  const byDate = data?.byDate ?? [];
  const topSessions = data?.topSessions ?? [];
  const maxModelTotal = byModel[0]?.total ?? 1;
  const maxDateTotal = byDate.reduce((max, entry) => Math.max(max, entry.total), 1);
  const cards = [
    { label: "statsTotal", value: summary.total },
    { label: "statsInput", value: summary.input },
    { label: "statsOutput", value: summary.output },
    { label: "statsCacheRead", value: summary.cacheRead },
    { label: "statsRequests", value: summary.requests },
    { label: "statsSessions", value: summary.sessions },
  ];

  return (
    <div className="dsm-board">
      <div className="dsm-board-head">
        <span className="dsm-board-title">{t("tabStats")}</span>
        <span className="dsm-board-count">{t("statsRequestsCount", { count: String(summary.requests) })}</span>
        <span className="dsm-board-spacer" />
        {RANGES.map((range) => (
          <button
            key={range.days}
            type="button"
            className="dsm-chip"
            data-on={days === range.days}
            onClick={() => setDays(range.days)}
          >
            {t(range.label)}
          </button>
        ))}
        <button type="button" className="dsm-chip" onClick={() => void load(days)}>
          {t("refresh")}
        </button>
      </div>
      <div className="dsm-board-body">
        <div className="dsm-statcards">
          {cards.map((card) => (
            <div className="dsm-statcard" key={card.label}>
              <div className="dsm-statcard-value">{formatTokens(card.value)}</div>
              <div className="dsm-statcard-label">{t(card.label)}</div>
            </div>
          ))}
        </div>

        <section className="dsm-group">
          <div className="dsm-group-head">
            <span className="dsm-group-title">{t("statsByModel")}</span>
          </div>
          {byModel.length === 0 ? (
            <div className="dsm-board-msg">{t("statsEmpty")}</div>
          ) : (
            <table className="dsm-ttable">
              <thead>
                <tr>
                  <th>{t("statsModel")}</th>
                  <th>{t("statsRequests")}</th>
                  <th>{t("statsInput")}</th>
                  <th>{t("statsOutput")}</th>
                  <th>{t("statsCacheRead")}</th>
                  <th>{t("statsTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {byModel.map((entry) => (
                  <tr key={`${entry.provider}/${entry.model}`}>
                    <td>
                      <div className="dsm-statmodel">
                        <span className="dsm-badge">{entry.model}</span>
                        <span className="dsm-settings-hint">{entry.provider}</span>
                        <span className="dsm-sbar">
                          <span style={{ width: `${Math.max(2, Math.round((entry.total / maxModelTotal) * 100))}%` }} />
                        </span>
                      </div>
                    </td>
                    <td>{entry.requests}</td>
                    <td>{formatTokens(entry.input)}</td>
                    <td>{formatTokens(entry.output)}</td>
                    <td>{formatTokens(entry.cacheRead)}</td>
                    <td><b>{formatTokens(entry.total)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="dsm-group">
          <div className="dsm-group-head">
            <span className="dsm-group-title">{t("statsByDate")}</span>
          </div>
          {byDate.length === 0 ? (
            <div className="dsm-board-msg">{t("statsEmpty")}</div>
          ) : (
            <table className="dsm-ttable">
              <thead>
                <tr>
                  <th>{t("statsDate")}</th>
                  <th>{t("statsRequests")}</th>
                  <th>{t("statsInput")}</th>
                  <th>{t("statsOutput")}</th>
                  <th>{t("statsCacheRead")}</th>
                  <th>{t("statsTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {byDate.map((entry) => (
                  <tr key={entry.date}>
                    <td>
                      <div className="dsm-statmodel">
                        <code>{entry.date}</code>
                        <span className="dsm-sbar">
                          <span style={{ width: `${Math.max(2, Math.round((entry.total / maxDateTotal) * 100))}%` }} />
                        </span>
                      </div>
                    </td>
                    <td>{entry.requests}</td>
                    <td>{formatTokens(entry.input)}</td>
                    <td>{formatTokens(entry.output)}</td>
                    <td>{formatTokens(entry.cacheRead)}</td>
                    <td><b>{formatTokens(entry.total)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="dsm-group">
          <div className="dsm-group-head">
            <span className="dsm-group-title">{t("statsTopSessions")}</span>
          </div>
          {topSessions.length === 0 ? (
            <div className="dsm-board-msg">{t("statsEmpty")}</div>
          ) : (
            <table className="dsm-ttable">
              <thead>
                <tr>
                  <th>{t("statsSession")}</th>
                  <th>{t("statsRequests")}</th>
                  <th>{t("statsTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {topSessions.map((entry) => (
                  <tr key={entry.sessionId}>
                    <td title={entry.sessionId}>{entry.title}</td>
                    <td>{entry.requests}</td>
                    <td><b>{formatTokens(entry.total)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <div className="dsm-settings-hint">{t("statsHint")}</div>
      </div>
    </div>
  );
}
