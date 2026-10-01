/**
 * The `/prompt` (alias `/p`) slash command (P2): a commandUi popupSelect over
 * the host's prompt library, whose pick appends the prompt body to the
 * current composer draft — it never submits.
 *
 * API facts this builds on (all verified against 0.1.7-alpha.2 types):
 * - `ctx.commandUi.register(contribution)` (@deepseek-ai/dsh-client-ui-commands):
 *   popupSelect options load per open (aborted on supersede), the shell owns
 *   search/filter/keyboard, and a name colliding with a host command fails
 *   loud. `options()` throwing surfaces as the popup's error row with retry.
 * - Draft write: `sessions.binding(sessionId).ctx` (ClientSessions, frozen
 *   contract) → `conversation.input.for(actx)` (SessionInputResolver, frozen
 *   contract) → `SessionInput.setDraft / state / focus`. There is no draft
 *   accessor on the commandUi callbacks themselves (ClientSessionContext
 *   carries only sessionId), so the two services are resolved at pick time.
 * - Timing: after `onSelect` resolves, the ui-commands settle continuation
 *   synchronously consumes the `/prompt` token (span splice for menu picks,
 *   whole-line clear for a bare Enter) and refocuses the composer — all
 *   microtasks. The append therefore rides a macrotask timer and always
 *   observes the post-consume draft, whatever launched the popup.
 *
 * @module dsh-session-manager/prompt-command
 */
import { IconSparkleRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import { fetchPrompts } from "./api.js";
import { NS } from "./locales.js";

export const PROMPT_COMMAND_NAMES = ["prompt", "p"];

const DETAIL_MAX = 64;

/** option.id → prompt body, replaced wholesale on every options load. */
const promptBodies = new Map();

function summarize(body) {
  const firstLine = body.split("\n").find((line) => line.trim() !== "") ?? "";
  const text = firstLine.trim();
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text;
}

/**
 * Build the popupSelect rows from the library. The official popupSelect shell
 * has no section headers (a flat filtered list), so each row's label carries
 * its group as a prefix — typing the group name (e.g. "评审") filters the
 * group's rows (AC1), and `detail` previews the body's first line.
 */
async function loadOptions(t) {
  const library = await fetchPrompts();
  const options = [];
  const bodies = new Map();
  for (const group of library.groups ?? []) {
    for (const prompt of group.prompts ?? []) {
      const id = `${group.id}/${prompt.id}`;
      bodies.set(id, prompt.body);
      options.push({
        id,
        label: `${group.label} · ${prompt.title}`,
        detail: summarize(prompt.body),
      });
    }
  }
  if (options.length === 0) throw new Error(t("promptLibraryEmpty"));
  promptBodies.clear();
  for (const [id, body] of bodies) promptBodies.set(id, body);
  return options;
}

/**
 * Resolve the per-session composer input face through public contracts:
 * `sessions.binding(id).ctx` → `conversation.input.for(actx)`.
 * Returns undefined whenever any hop is unavailable (fail-soft: the caller
 * falls back to a clipboard copy).
 */
function resolveSessionInput(ctx, sessionId) {
  const sessions = ctx.get("sessions");
  const conversation = ctx.get("conversation");
  const binding = typeof sessions?.binding === "function" ? sessions.binding(sessionId) : undefined;
  if (binding === undefined || conversation?.input === undefined) return undefined;
  try {
    return conversation.input.for(binding.ctx);
  } catch {
    return undefined;
  }
}

/** Last-resort degrade: keep the text reachable without a draft API. */
function fallbackCopy(body) {
  navigator.clipboard?.writeText(body).catch(() => {});
  console.warn("[dsh-session-manager] composer draft API unavailable; prompt body copied to clipboard");
}

/**
 * Append `body` to the session's draft: an existing draft keeps its content
 * with a blank line before the prompt; an empty draft is filled directly
 * (PRD R2.3 / AC2). Runs after the shell consumed the command token.
 */
function appendPromptToDraft(ctx, sessionId, body) {
  setTimeout(() => {
    const input = resolveSessionInput(ctx, sessionId);
    if (input === undefined) {
      fallbackCopy(body);
      return;
    }
    try {
      const current = input.state.getSnapshot().draft ?? "";
      const next = current.trim() === "" ? body : `${current.trimEnd()}\n\n${body}`;
      input.setDraft(next);
      input.focus();
    } catch (error) {
      console.warn("[dsh-session-manager] prompt draft append failed:", error);
      fallbackCopy(body);
    }
  }, 0);
}

/**
 * Register `/prompt` and `/p` on the commandUi service (fail-soft: without
 * the service the command simply does not appear).
 * @param {import("@deepseek-ai/cordis").Context} ctx client root context
 */
export function registerPromptCommand(ctx) {
  const t = ctx.locale.bind(NS);
  ctx.inject(["commandUi"], (scope) => {
    for (const name of PROMPT_COMMAND_NAMES) {
      scope.effect(
        () =>
          scope.commandUi.register({
            name,
            label: () => t("promptCommandLabel"),
            description: () => t("promptCommandDescription"),
            icon: IconSparkleRegular,
            available: () => true,
            ui: {
              kind: "popupSelect",
              options: async (_session, signal) => loadOptions(t),
              onSelect: (option, session) => {
                const body = promptBodies.get(option.id);
                if (body === undefined) throw new Error(t("promptMissing"));
                appendPromptToDraft(ctx, session.sessionId, body);
              },
            },
          }),
        `dsh-session-manager: /${name} command`,
      );
    }
  });
}
