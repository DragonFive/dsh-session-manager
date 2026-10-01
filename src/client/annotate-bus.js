/**
 * Module-level request bus for opening the annotate dialog.
 *
 * Menu-item and row-action slot entries are rendered inside the sidebar row
 * (menu rows only exist while their menu is open), so a dialog rendered there
 * would unmount with its trigger. The official pattern (ui-workspace's rename
 * dialog) is to raise a request and render the dialog from a `shell.overlay`
 * entry, which lives for the frame's lifetime. This bus connects the two.
 */

const listeners = new Set();

/**
 * Raise an annotate request for one session.
 * @param {{ sessionId: string, displayTitle: string }} session
 */
export function requestAnnotate(session) {
  for (const listener of listeners) listener(session);
}

/**
 * Subscribe to annotate requests.
 * @param {(session: { sessionId: string, displayTitle: string }) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeAnnotate(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Second channel: annotation-store change notifications, so an open board
 * panel refreshes after a dialog save (the P1 stand-in for the design's
 * `annotations/changed` push event — see the research notes for why a real
 * host→client push channel is not available to third-party plugins).
 */
const changeListeners = new Set();

export function notifyAnnotationsChanged() {
  for (const listener of changeListeners) listener();
}

export function subscribeAnnotationsChanged(listener) {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}
