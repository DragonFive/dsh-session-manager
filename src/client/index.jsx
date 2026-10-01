/**
 * dsh-session-manager client half (browser bundle).
 *
 * Registers, through `ctx.slots`:
 * - `sidebar.panellist` id `dsm-board` — the Session Board sidebar entry
 *   (the list id is also the `main` keyed-slot panel key);
 * - layout `main` key `dsm-board` — the board panel itself;
 * - `sidebar.panellist` id `dsm-trellis` (order 600, below the board icon) —
 *   the Trellis milestone board entry (P3);
 * - layout `main` key `dsm-trellis` — the Trellis board panel;
 * - `sidebar.workspaces.session.menu.item` id `dsm.annotate` (order 500,
 *   after the official pin/rename/fork/archive rows) — "标注…";
 * - `sidebar.workspaces.session.row.action` id `dsm.annotate-icon`
 *   (order 300, after the official archive/pin hover buttons).
 *
 * Consumed services: `slots` + `locale` (ui-slots / client-locale) and
 * `uiWorkspace` (dsh-client-ui-workspace) for `openSession` click-through.
 */
import { useEffect, useState } from "react";
// NOTE: ui-primitives exports each icon as `<Name>Regular` / `<Name>Medium`
// (stroke-width variants) — there is no bare `IconChecklistOutline` export.
import { IconBranchOutlineRegular, IconChecklistOutlineRegular, IconListPenOutlineRegular, MenuItemButton } from "@deepseek-ai/dsh-client-ui-primitives";
import { AnnotateDialog } from "./annotate-dialog.jsx";
import { notifyAnnotationsChanged, requestAnnotate, subscribeAnnotate } from "./annotate-bus.js";
import { BoardPanel } from "./board-panel.jsx";
import { NS, en, zh } from "./locales.js";
import { registerPromptCommand } from "./prompt-command.jsx";
import { PromptsSettingsTab } from "./prompts-settings.jsx";
import { styles } from "./styles.js";
import { TrellisPanel } from "./trellis-panel.jsx";

export const PANEL_ID = "dsm-board";
export const TRELLIS_PANEL_ID = "dsm-trellis";
export const MENU_ITEM_ID = "dsm.annotate";
export const ROW_ACTION_ID = "dsm.annotate-icon";
export const OVERLAY_ID = "dsm.annotate-overlay";
export const SETTINGS_TAB_ID = "dsm.prompts";

export const inject = ["slots", "locale", "uiWorkspace"];

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-session-manager: locale");
  ctx.effect(() => {
    if (document.querySelector('style[data-plugin-css="dsh-session-manager/client"]') !== null) {
      return () => {};
    }
    const tag = document.createElement("style");
    tag.dataset.plugin = "dsh-session-manager";
    tag.dataset.pluginCss = "dsh-session-manager/client";
    tag.textContent = styles;
    document.head.appendChild(tag);
    return () => tag.remove();
  }, "dsh-session-manager: styles");

  ctx.slots.inject("main", () =>
    ctx.slots.register(
      {
        name: "main",
        key: PANEL_ID,
        locale: NS,
        inject: () => ({
          openSession: (sessionId) => ctx.uiWorkspace.openSession(sessionId),
        }),
      },
      BoardPanel,
    ),
  );

  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: PANEL_ID,
        order: 500,
        label: () => ctx.locale.bind(NS)("panelTitle"),
        locale: NS,
      },
      BoardPanelIcon,
    ),
  );

  // P3: the Trellis milestone board — second panellist icon + main panel.
  ctx.slots.inject("main", () =>
    ctx.slots.register({ name: "main", key: TRELLIS_PANEL_ID, locale: NS }, TrellisPanel),
  );

  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: TRELLIS_PANEL_ID,
        order: 600,
        label: () => ctx.locale.bind(NS)("trellisPanelTitle"),
        locale: NS,
      },
      TrellisPanelIcon,
    ),
  );

  ctx.slots.inject("sidebar.workspaces.session.menu.item", () =>
    ctx.slots.register(
      { name: "sidebar.workspaces.session.menu.item", id: MENU_ITEM_ID, order: 500, locale: NS },
      AnnotateMenuItem,
    ),
  );

  ctx.slots.inject("sidebar.workspaces.session.row.action", () =>
    ctx.slots.register(
      { name: "sidebar.workspaces.session.row.action", id: ROW_ACTION_ID, order: 300, locale: NS },
      AnnotateRowAction,
    ),
  );

  // The dialog itself lives in the frame-wide overlay layer: menu rows and
  // hover strips unmount with their triggers, an overlay entry does not.
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      { name: "shell.overlay", id: OVERLAY_ID, order: 500, locale: NS },
      AnnotateOverlayHost,
    ),
  );

  // P2: the /prompt (alias /p) prompt-library command. Registered through the
  // optional commandUi service so a deployment without it just lacks the
  // command instead of failing the whole plugin.
  registerPromptCommand(ctx);

  // P2: the prompt-library settings card — one tab of the Settings → Plugins
  // section. Fails soft: without the section owner the tab never mounts.
  ctx.slots.inject("settings.plugins.tab", () =>
    ctx.slots.register(
      {
        name: "settings.plugins.tab",
        id: SETTINGS_TAB_ID,
        order: 600,
        label: () => ctx.locale.bind(NS)("promptsSettingsTab"),
        locale: NS,
      },
      PromptsSettingsTab,
    ),
  );
}

/** Sidebar panel glyph; the sidebar owns the button, label, and selected state. */
function BoardPanelIcon({ size }) {
  return <IconChecklistOutlineRegular size={size} />;
}

/** Trellis board glyph (branch icon — the task tree metaphor). */
function TrellisPanelIcon({ size }) {
  return <IconBranchOutlineRegular size={size} />;
}

/** "标注…" menu row. Dismisses the menu and raises an annotate request. */
function AnnotateMenuItem({ sessionId, displayTitle, useMenuOpenState, t }) {
  const [, setMenuOpen] = useMenuOpenState();
  return (
    <MenuItemButton
      separatorBefore={true}
      icon={<IconListPenOutlineRegular size={14} />}
      onSelect={() => {
        setMenuOpen(false);
        requestAnnotate({ sessionId, displayTitle });
      }}
    >
      {t("annotate")}
    </MenuItemButton>
  );
}

/** Hover tag icon at the session row's end (clicks stay inside the strip). */
function AnnotateRowAction({ sessionId, displayTitle, t }) {
  return (
    <button
      type="button"
      className="dsm-rowaction"
      title={t("annotateIconLabel")}
      aria-label={t("annotateIconLabel")}
      onClick={() => requestAnnotate({ sessionId, displayTitle })}
    >
      <IconListPenOutlineRegular size={14} />
    </button>
  );
}

/** The one long-lived annotate dialog instance, fed by the request bus. */
function AnnotateOverlayHost({ t }) {
  const [request, setRequest] = useState(null);
  useEffect(() => subscribeAnnotate(setRequest), []);
  if (request === null) return null;
  return (
    <AnnotateDialog
      open={true}
      onClose={() => setRequest(null)}
      sessionId={request.sessionId}
      displayTitle={request.displayTitle}
      onSaved={notifyAnnotationsChanged}
      t={t}
    />
  );
}
