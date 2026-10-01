window.__ModuleLoader__.load({
	id: "dsh-session-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/api.js
		/**
		* Same-origin fetch helpers for the host's `/api/dsh-session-manager/*`
		* routes. The Connection carrier applies browser trust checks and cookie
		* authentication, so plain `fetch` is all the client needs.
		*/
		async function request(path, init) {
			const response = await fetch(path, {
				...init,
				headers: {
					"content-type": "application/json",
					...init?.headers ?? {}
				}
			});
			if (!response.ok) {
				let detail = "";
				try {
					detail = await response.text();
				} catch {}
				throw new Error(`${response.status} ${detail || response.statusText}`.trim());
			}
			return response.json();
		}
		/** GET /api/dsh-session-manager/board */
		function fetchBoard() {
			return request("/api/dsh-session-manager/board");
		}
		/** GET /api/dsh-session-manager/annotations */
		function fetchAnnotations() {
			return request("/api/dsh-session-manager/annotations");
		}
		/**
		* POST /api/dsh-session-manager/annotations
		* @param {{ sessionId: string, workspaceId?: string | null, annotation: object | null }} input
		*/
		function postAnnotation({ sessionId, workspaceId, annotation }) {
			return request("/api/dsh-session-manager/annotations", {
				method: "POST",
				body: JSON.stringify({
					sessionId,
					workspaceId,
					annotation
				})
			});
		}
		/**
		* GET /api/dsh-session-manager/prompts — the prompt library (re-read from
		* disk per request, so YAML edits are live on the next /prompt open).
		* @param {AbortSignal} [signal]
		*/
		function fetchPrompts(signal) {
			return request("/api/dsh-session-manager/prompts", { signal });
		}
		/**
		* POST /api/dsh-session-manager/prompts — validate, serialize, and
		* atomically save the whole library (the board editor's save path).
		* @param {{ groups: object[] }} library
		*/
		function postPrompts(library) {
			return request("/api/dsh-session-manager/prompts", {
				method: "POST",
				body: JSON.stringify(library)
			});
		}
		/** GET /api/dsh-session-manager/prompts/config — current library path config. */
		function fetchPromptsConfig() {
			return request("/api/dsh-session-manager/prompts/config");
		}
		/**
		* POST /api/dsh-session-manager/prompts/config — set (`"/abs/path"` or
		* `"~/…"`) or reset (null → default path) the library file location.
		* @param {string | null} promptsFile
		*/
		function postPromptsConfig(promptsFile) {
			return request("/api/dsh-session-manager/prompts/config", {
				method: "POST",
				body: JSON.stringify({ promptsFile })
			});
		}
		/** GET /api/dsh-session-manager/trellis — workspace task trees (read-only). */
		function fetchTrellis() {
			return request("/api/dsh-session-manager/trellis");
		}
		/**
		* POST /api/dsh-session-manager/trellis/export — write the anchored markdown
		* block into the target note (bare filename resolves against the export root).
		* @param {string} file
		*/
		function postTrellisExport(file) {
			return request("/api/dsh-session-manager/trellis/export", {
				method: "POST",
				body: JSON.stringify({ file })
			});
		}
		/** GET /api/dsh-session-manager/trellis/config — current export root. */
		function fetchTrellisConfig() {
			return request("/api/dsh-session-manager/trellis/config");
		}
		/** GET /api/dsh-session-manager/sync — sync settings + repo status. */
		function fetchSync() {
			return request("/api/dsh-session-manager/sync");
		}
		/**
		* POST /api/dsh-session-manager/sync/config — set or reset the sync
		* settings ({syncRepoPath, syncRepoUrl, syncSshKey, syncMachine}; null/"" resets).
		*/
		function postSyncConfig(config) {
			return request("/api/dsh-session-manager/sync/config", {
				method: "POST",
				body: JSON.stringify(config)
			});
		}
		/** POST /api/dsh-session-manager/sync/run — one full sync, returns the log. */
		function postSyncRun() {
			return request("/api/dsh-session-manager/sync/run", { method: "POST" });
		}
		/** GET /api/dsh-session-manager/sync/sessions — collected sessions in the sync repo. */
		function fetchCollectedSessions() {
			return request("/api/dsh-session-manager/sync/sessions");
		}
		/**
		* POST /api/dsh-session-manager/sync/restore — restore a collected session
		* onto this machine (targetCwd rewrites the session header's cwd).
		* @param {{ sessionId: string, targetCwd?: string | null }} input
		*/
		function postRestoreSession(input) {
			return request("/api/dsh-session-manager/sync/restore", {
				method: "POST",
				body: JSON.stringify(input)
			});
		}
		/**
		* POST /api/dsh-session-manager/trellis/config — set or reset
		* (null → default) the note export root.
		* @param {string | null} exportRoot
		*/
		function postTrellisConfig(exportRoot) {
			return request("/api/dsh-session-manager/trellis/config", {
				method: "POST",
				body: JSON.stringify({ exportRoot })
			});
		}
		/**
		* GET /api/dsh-session-manager/stats?days=N — aggregated token usage
		* (summary / byDate / byModel / topSessions). days ≤ 0 means all time.
		* @param {number} days
		*/
		function fetchStats(days) {
			return request(`/api/dsh-session-manager/stats?days=${encodeURIComponent(String(days))}`);
		}
		//#endregion
		//#region src/client/annotation-defaults.js
		/**
		* Effective annotation defaults (display layer only).
		*
		* Every session counts as 待办 (todo) / 一般 (normal) until a human
		* annotation overrides it: the board groups, filters, quadrants, badges,
		* and quick edits all read these effective values. The sidecar stays
		* sparse — defaults are never written to disk; an annotation row only
		* appears once a human actually saves one.
		*/
		/** Must reference a status id of the (default) taxonomy. */
		const DEFAULT_STATUS_ID = "todo";
		/** Must reference a priority id of the (default) taxonomy. */
		const DEFAULT_PRIORITY_ID = "normal";
		function resolveDefaultId(fallbackId, entries) {
			if (entries?.some((entry) => entry?.id === fallbackId)) return fallbackId;
			return entries?.[0]?.id ?? fallbackId;
		}
		/**
		* The status a session effectively has: its own annotation's status when
		* annotated, otherwise the taxonomy's default (falls back to the first
		* status when a custom taxonomy dropped the default id).
		* @param {{ status?: string } | null} annotation
		* @param {{ statuses?: { id: string }[] } | null | undefined} taxonomy
		* @returns {string}
		*/
		function effectiveStatusId(annotation, taxonomy) {
			if (annotation?.status !== void 0) return annotation.status;
			return resolveDefaultId(DEFAULT_STATUS_ID, taxonomy?.statuses);
		}
		/**
		* The priority a session effectively has (same rules as effectiveStatusId).
		* @param {{ priority?: string } | null} annotation
		* @param {{ priorities?: { id: string }[] } | null | undefined} taxonomy
		* @returns {string}
		*/
		function effectivePriorityId(annotation, taxonomy) {
			if (annotation?.priority !== void 0) return annotation.priority;
			return resolveDefaultId(DEFAULT_PRIORITY_ID, taxonomy?.priorities);
		}
		//#endregion
		//#region src/client/annotate-dialog.jsx
		/**
		* The annotation dialog: category (tree), tags (multi + create), status,
		* priority, linked Trellis task, notes. Opened from the session row menu
		* item and the hover icon.
		*
		* Uses the platform-baseline `Modal` primitive (body-portaled, Escape and
		* mask handling included) so the dialog matches official chrome without
		* touching any official stylesheet.
		*/
		const EMPTY = {
			category: void 0,
			tags: [],
			status: DEFAULT_STATUS_ID,
			priority: DEFAULT_PRIORITY_ID,
			sync: false,
			notes: ""
		};
		const CUSTOM_CATEGORY_PREFIX = "custom/";
		function AnnotateDialog({ open, onClose, sessionId, displayTitle, onSaved, t }) {
			const [draft, setDraft] = (0, react.useState)(EMPTY);
			const [newTag, setNewTag] = (0, react.useState)("");
			const [newCategory, setNewCategory] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const [taxonomy, setTaxonomy] = (0, react.useState)(null);
			const [taskGroups, setTaskGroups] = (0, react.useState)([]);
			(0, react.useEffect)(() => {
				if (!open || !sessionId) return;
				let cancelled = false;
				setError("");
				setDraft(EMPTY);
				setNewTag("");
				setNewCategory("");
				setTaxonomy(null);
				setTaskGroups([]);
				fetchAnnotations().then((store) => {
					if (cancelled) return;
					setTaxonomy(store?.taxonomy ?? null);
					const existing = store?.sessions?.[sessionId];
					setDraft(existing ? {
						category: existing.category,
						tags: [...existing.tags ?? []],
						status: existing.status ?? "todo",
						priority: existing.priority ?? "normal",
						taskId: existing.taskId,
						sync: existing.sync === true,
						notes: existing.notes ?? ""
					} : EMPTY);
				}).catch(() => {});
				fetchTrellis().then((value) => {
					if (cancelled) return;
					setTaskGroups(collectTaskGroups(value?.workspaces ?? []));
				}).catch(() => {});
				return () => {
					cancelled = true;
				};
			}, [open, sessionId]);
			const categories = taxonomy?.categories ?? [];
			const statuses = taxonomy?.statuses ?? [];
			const priorities = taxonomy?.priorities ?? [];
			const knownTags = (0, react.useMemo)(() => taxonomy?.tags ?? [], [taxonomy]);
			const toggleTag = (tag) => {
				setDraft((prev) => ({
					...prev,
					tags: prev.tags.includes(tag) ? prev.tags.filter((entry) => entry !== tag) : [...prev.tags, tag]
				}));
			};
			const commitNewTag = () => {
				const tag = newTag.trim();
				if (tag === "") return;
				setNewTag("");
				setDraft((prev) => prev.tags.includes(tag) ? prev : {
					...prev,
					tags: [...prev.tags, tag]
				});
			};
			const commitNewCategory = () => {
				const label = newCategory.trim();
				if (label === "") return;
				setNewCategory("");
				for (const node of categories) if (node.children?.length > 0) {
					for (const child of node.children) if (child.label === label) {
						setDraft((prev) => ({
							...prev,
							category: child.id
						}));
						return;
					}
				} else if (node.label === label) {
					setDraft((prev) => ({
						...prev,
						category: node.id
					}));
					return;
				}
				const id = `${CUSTOM_CATEGORY_PREFIX}${label}`;
				setDraft((prev) => prev.category === id ? prev : {
					...prev,
					category: id
				});
				setTaxonomy((prev) => prev ? {
					...prev,
					categories: [...prev.categories, {
						id,
						label
					}]
				} : prev);
			};
			const save = async () => {
				setBusy(true);
				setError("");
				try {
					const notes = draft.notes.trim();
					await postAnnotation({
						sessionId,
						annotation: {
							category: draft.category ?? null,
							tags: draft.tags,
							status: draft.status,
							priority: draft.priority,
							taskId: draft.taskId ?? null,
							sync: draft.sync === true,
							notes: notes === "" ? null : notes
						}
					});
					onSaved?.();
					onClose();
				} catch (reason) {
					setError(`${t("saveFailed")}: ${reason instanceof Error ? reason.message : String(reason)}`);
				} finally {
					setBusy(false);
				}
			};
			const clear = async () => {
				if (!window.confirm(t("clearConfirm"))) return;
				setBusy(true);
				setError("");
				try {
					await postAnnotation({
						sessionId,
						annotation: null
					});
					onSaved?.();
					onClose();
				} catch (reason) {
					setError(`${t("saveFailed")}: ${reason instanceof Error ? reason.message : String(reason)}`);
				} finally {
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open,
				onClose,
				title: t("annotateTitle"),
				closeLabel: t("cancel"),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-dialog-body",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-dialog-field",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-dialog-label",
								children: displayTitle
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-dialog-field",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-dialog-label",
									children: t("category")
								}),
								categories.map((node) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsm-pill-row",
									children: node.children?.length > 0 ? node.children.map((child) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-pill",
										"data-on": draft.category === child.id,
										"data-indent": true,
										onClick: () => setDraft((prev) => ({
											...prev,
											category: prev.category === child.id ? void 0 : child.id
										})),
										children: `${node.label} / ${child.label}`
									}, child.id)) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-pill",
										"data-on": draft.category === node.id,
										onClick: () => setDraft((prev) => ({
											...prev,
											category: prev.category === node.id ? void 0 : node.id
										})),
										children: node.label
									})
								}, node.id)),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "dsm-input",
									value: newCategory,
									placeholder: t("newCategoryPlaceholder"),
									onChange: (event) => setNewCategory(event.target.value),
									onKeyDown: (event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											commitNewCategory();
										}
									},
									onBlur: commitNewCategory
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-dialog-field",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-dialog-label",
									children: t("tags")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsm-pill-row",
									children: [.../* @__PURE__ */ new Set([...knownTags, ...draft.tags])].map((tag) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-pill",
										"data-on": draft.tags.includes(tag),
										onClick: () => toggleTag(tag),
										children: tag
									}, tag))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "dsm-input",
									value: newTag,
									placeholder: t("tagPlaceholder"),
									onChange: (event) => setNewTag(event.target.value),
									onKeyDown: (event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											commitNewTag();
										}
									},
									onBlur: commitNewTag
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-dialog-field",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-dialog-label",
								children: t("status")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-pill-row",
								children: statuses.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-pill",
									"data-on": draft.status === entry.id,
									onClick: () => setDraft((prev) => ({
										...prev,
										status: entry.id
									})),
									children: entry.label
								}, entry.id))
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-dialog-field",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-dialog-label",
								children: t("priority")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-pill-row",
								children: priorities.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-pill",
									"data-on": draft.priority === entry.id,
									onClick: () => setDraft((prev) => ({
										...prev,
										priority: entry.id
									})),
									children: entry.label
								}, entry.id))
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-dialog-field",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-dialog-label",
								children: t("linkedTask")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								className: "dsm-input",
								value: draft.taskId ?? "",
								"aria-label": t("linkedTask"),
								onChange: (event) => setDraft((prev) => ({
									...prev,
									taskId: event.target.value === "" ? void 0 : event.target.value
								})),
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: t("noLinkedTask")
									}),
									taskGroups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("optgroup", {
										label: group.workspaceTitle,
										children: group.tasks.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: task.dir,
											children: task.title
										}, task.dir))
									}, group.workspaceTitle)),
									draft.taskId !== void 0 && !taskGroups.some((group) => group.tasks.some((task) => task.dir === draft.taskId)) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: draft.taskId,
										children: `${draft.taskId}（${t("linkedTaskMissing")}）`
									})
								]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-dialog-field",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: "dsm-sync-toggle",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: draft.sync === true,
									onChange: (event) => setDraft((prev) => ({
										...prev,
										sync: event.target.checked
									}))
								}), t("syncFieldLabel")]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-settings-hint",
								children: t("syncFieldHint")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-dialog-field",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-dialog-label",
								children: t("notes")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								className: "dsm-textarea",
								value: draft.notes,
								placeholder: t("notesPlaceholder"),
								onChange: (event) => setDraft((prev) => ({
									...prev,
									notes: event.target.value
								}))
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-dialog-error",
							children: error
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsm-dialog-footer",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-btn dsm-btn-danger",
									disabled: busy,
									onClick: clear,
									children: t("clear")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-btn",
									disabled: busy,
									onClick: onClose,
									children: t("cancel")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-btn",
									"data-primary": true,
									disabled: busy,
									onClick: save,
									children: t("save")
								})
							]
						})
					]
				})
			});
		}
		/**
		* Flatten the read-only Trellis scan into select groups: one optgroup per
		* workspace, tasks = every node of every root tree plus the standalone
		* tasks. `dir` (the .trellis/tasks slug) is the value stored in
		* annotations as `taskId`.
		*/
		function collectTaskGroups(workspaces) {
			const groups = [];
			for (const workspace of workspaces) {
				if (!workspace.hasTrellis) continue;
				const tasks = [];
				const walk = (node) => {
					tasks.push({
						dir: node.dir,
						title: node.title
					});
					for (const child of node.children ?? []) walk(child);
				};
				for (const root of workspace.roots ?? []) walk(root);
				for (const task of workspace.standalone ?? []) tasks.push({
					dir: task.dir,
					title: task.title
				});
				if (tasks.length > 0) groups.push({
					workspaceTitle: workspace.title,
					tasks
				});
			}
			return groups;
		}
		//#endregion
		//#region src/client/annotate-bus.js
		/**
		* Module-level request bus for opening the annotate dialog.
		*
		* Menu-item and row-action slot entries are rendered inside the sidebar row
		* (menu rows only exist while their menu is open), so a dialog rendered there
		* would unmount with its trigger. The official pattern (ui-workspace's rename
		* dialog) is to raise a request and render the dialog from a `shell.overlay`
		* entry, which lives for the frame's lifetime. This bus connects the two.
		*/
		const listeners = /* @__PURE__ */ new Set();
		/**
		* Raise an annotate request for one session.
		* @param {{ sessionId: string, displayTitle: string }} session
		*/
		function requestAnnotate(session) {
			for (const listener of listeners) listener(session);
		}
		/**
		* Subscribe to annotate requests.
		* @param {(session: { sessionId: string, displayTitle: string }) => void} listener
		* @returns {() => void} unsubscribe
		*/
		function subscribeAnnotate(listener) {
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
		const changeListeners = /* @__PURE__ */ new Set();
		function notifyAnnotationsChanged() {
			for (const listener of changeListeners) listener();
		}
		function subscribeAnnotationsChanged(listener) {
			changeListeners.add(listener);
			return () => {
				changeListeners.delete(listener);
			};
		}
		//#endregion
		//#region src/client/board-panel.jsx
		/**
		* The Session Board main panel: sessions ⊕ annotations ⊕ running state in one
		* fetch, with grouping (category / status / priority / tag), multi-select
		* filters (plus unannotated-only), updated-time ordering, an Eisenhower
		* quadrant view (design §3.2), row click-through via `ctx.uiWorkspace`,
		* and inline status/priority quick edits through the same POST route.
		* Unannotated sessions read their status/priority at the effective
		* 待办/一般 defaults everywhere (annotation-defaults.js); the sidecar stays
		* sparse until a human annotation is saved.
		*/
		const GROUP_MODES = [
			"category",
			"status",
			"priority",
			"tag"
		];
		const UNANNOTATED_KEY = "__unannotated__";
		function emptyFilters() {
			return {
				categories: /* @__PURE__ */ new Set(),
				statuses: /* @__PURE__ */ new Set(),
				priorities: /* @__PURE__ */ new Set(),
				tags: /* @__PURE__ */ new Set(),
				unannotatedOnly: false
			};
		}
		function labelMaps(taxonomy) {
			const categories = /* @__PURE__ */ new Map();
			for (const node of taxonomy?.categories ?? []) if (node.children?.length > 0) for (const child of node.children) categories.set(child.id, `${node.label}/${child.label}`);
			else categories.set(node.id, node.label);
			return {
				categories,
				statuses: new Map((taxonomy?.statuses ?? []).map((entry) => [entry.id, entry.label])),
				priorities: new Map((taxonomy?.priorities ?? []).map((entry) => [entry.id, entry.label]))
			};
		}
		function formatRelative(timestamp) {
			if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "";
			const delta = Date.now() - timestamp;
			const minutes = Math.round(delta / 6e4);
			if (minutes < 1) return "now";
			if (minutes < 60) return `${minutes}m`;
			const hours = Math.round(minutes / 60);
			if (hours < 24) return `${hours}h`;
			const days = Math.round(hours / 24);
			if (days < 30) return `${days}d`;
			return new Date(timestamp).toLocaleDateString();
		}
		/** dir slug → task title, flattened from the read-only Trellis scan. */
		function taskTitleMap(workspaces) {
			const titles = /* @__PURE__ */ new Map();
			for (const workspace of workspaces) {
				if (!workspace.hasTrellis) continue;
				const walk = (node) => {
					titles.set(node.dir, node.title);
					for (const child of node.children ?? []) walk(child);
				};
				for (const root of workspace.roots ?? []) walk(root);
				for (const task of workspace.standalone ?? []) titles.set(task.dir, task.title);
			}
			return titles;
		}
		/** Free-text search across everything visible on (or under) a row. */
		function matchesSearch(session, query, taskTitles) {
			const annotation = session.annotation;
			return [
				session.displayTitle,
				session.cwd,
				session.workspaceTitle,
				annotation?.notes,
				annotation?.taskId,
				annotation?.taskId !== void 0 ? taskTitles.get(annotation.taskId) : void 0,
				...annotation?.tags ?? []
			].some((part) => typeof part === "string" && part.toLowerCase().includes(query));
		}
		function BoardPanel({ t, openSession }) {
			const [data, setData] = (0, react.useState)(null);
			const [phase, setPhase] = (0, react.useState)("loading");
			const [errorMsg, setErrorMsg] = (0, react.useState)("");
			const [viewMode, setViewMode] = (0, react.useState)("groups");
			const [groupBy, setGroupBy] = (0, react.useState)("category");
			const [sortDesc, setSortDesc] = (0, react.useState)(true);
			const [showFilters, setShowFilters] = (0, react.useState)(false);
			const [filters, setFilters] = (0, react.useState)(emptyFilters);
			const [search, setSearch] = (0, react.useState)("");
			const [taskTitles, setTaskTitles] = (0, react.useState)(() => /* @__PURE__ */ new Map());
			const load = (0, react.useCallback)(async () => {
				setPhase("loading");
				setErrorMsg("");
				try {
					const [board, trellis] = await Promise.all([fetchBoard(), fetchTrellis().catch(() => null)]);
					setData(board);
					setTaskTitles(taskTitleMap(trellis?.workspaces ?? []));
					setPhase("ready");
				} catch (reason) {
					setErrorMsg(reason instanceof Error ? reason.message : String(reason));
					setPhase("error");
				}
			}, []);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			(0, react.useEffect)(() => subscribeAnnotationsChanged(() => void load()), [load]);
			const maps = (0, react.useMemo)(() => labelMaps(data?.taxonomy), [data]);
			const toggleFilter = (dimension, value) => {
				setFilters((prev) => {
					const next = {
						...prev,
						[dimension]: new Set(prev[dimension])
					};
					if (next[dimension].has(value)) next[dimension].delete(value);
					else next[dimension].add(value);
					return next;
				});
			};
			const toggleUnannotatedOnly = () => {
				setFilters((prev) => ({
					...prev,
					unannotatedOnly: !prev.unannotatedOnly
				}));
			};
			const visible = (0, react.useMemo)(() => {
				const sessions = data?.sessions ?? [];
				const query = search.trim().toLowerCase();
				const searched = query === "" ? sessions : sessions.filter((session) => matchesSearch(session, query, taskTitles));
				if (!(filters.categories.size > 0 || filters.statuses.size > 0 || filters.priorities.size > 0 || filters.tags.size > 0 || filters.unannotatedOnly)) return searched;
				return searched.filter((session) => {
					const annotation = session.annotation;
					if (filters.unannotatedOnly && annotation !== null) return false;
					if (filters.categories.size > 0 && !filters.categories.has(annotation?.category ?? UNANNOTATED_KEY)) return false;
					if (filters.statuses.size > 0 && !filters.statuses.has(effectiveStatusId(annotation, data?.taxonomy))) return false;
					if (filters.priorities.size > 0 && !filters.priorities.has(effectivePriorityId(annotation, data?.taxonomy))) return false;
					if (filters.tags.size > 0) {
						const tags = annotation?.tags ?? [];
						if (![...filters.tags].some((tag) => tags.includes(tag))) return false;
					}
					return true;
				});
			}, [
				data,
				filters,
				search,
				taskTitles
			]);
			const sorted = (0, react.useMemo)(() => {
				const order = sortDesc ? -1 : 1;
				return [...visible].sort((left, right) => order * (left.updatedAt - right.updatedAt));
			}, [visible, sortDesc]);
			const quickPatch = (0, react.useCallback)(async (session, patch) => {
				const base = session.annotation ?? {
					tags: [],
					status: "todo",
					priority: "normal"
				};
				try {
					await postAnnotation({
						sessionId: session.sessionId,
						annotation: {
							...base,
							...patch
						}
					});
					await load();
				} catch {}
			}, [load]);
			const openSessionById = (0, react.useCallback)((session) => {
				if (session.archived || !openSession) return;
				openSession(session.sessionId);
			}, [openSession]);
			const taxonomy = data?.taxonomy;
			if (phase === "loading" && data === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-board",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-board-body",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-board-msg",
						children: t("loading")
					})
				})
			});
			if (phase === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-board",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-board-body",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-board-msg",
						children: [t("loadFailed"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn",
							onClick: () => void load(),
							children: t("retry")
						})]
					})
				})
			});
			const total = data?.sessions?.length ?? 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-board",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-board-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-board-title",
								children: t("panelTitle")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-board-count",
								children: t("sessionsCount", { count: String(total) })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsm-board-spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dsm-input dsm-search",
								value: search,
								placeholder: t("searchPlaceholder"),
								spellCheck: false,
								"aria-label": t("searchPlaceholder"),
								onChange: (event) => setSearch(event.target.value)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-chip",
								"data-on": viewMode === "groups",
								onClick: () => setViewMode("groups"),
								children: t("groupView")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-chip",
								"data-on": viewMode === "quadrant",
								onClick: () => setViewMode("quadrant"),
								children: t("quadrantView")
							}),
							viewMode === "groups" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
								className: "dsm-quickbtn",
								value: groupBy,
								"aria-label": t("groupBy"),
								onChange: (event) => setGroupBy(event.target.value),
								children: GROUP_MODES.map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: mode,
									children: t(mode === "category" ? "groupByCategory" : mode === "status" ? "groupByStatus" : mode === "priority" ? "groupByPriority" : "groupByTag")
								}, mode))
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-chip",
								onClick: () => setSortDesc((prev) => !prev),
								title: t("sortByUpdated"),
								children: sortDesc ? t("sortDesc") : t("sortAsc")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-chip",
								"data-on": showFilters,
								onClick: () => setShowFilters((prev) => !prev),
								children: showFilters ? t("hideFilters") : t("filters")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-chip",
								onClick: () => void load(),
								children: t("refresh")
							})
						]
					}),
					showFilters && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-filters",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilterRow, {
								name: t("groupByCategory"),
								options: [...(taxonomy?.categories ?? []).flatMap((node) => node.children?.length > 0 ? node.children.map((child) => ({
									id: child.id,
									label: `${node.label}/${child.label}`
								})) : [{
									id: node.id,
									label: node.label
								}])],
								selected: filters.categories,
								onToggle: (value) => toggleFilter("categories", value)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilterRow, {
								name: t("groupByStatus"),
								options: (taxonomy?.statuses ?? []).map((entry) => ({
									id: entry.id,
									label: entry.label
								})),
								selected: filters.statuses,
								onToggle: (value) => toggleFilter("statuses", value)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilterRow, {
								name: t("groupByPriority"),
								options: (taxonomy?.priorities ?? []).map((entry) => ({
									id: entry.id,
									label: entry.label
								})),
								selected: filters.priorities,
								onToggle: (value) => toggleFilter("priorities", value)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilterRow, {
								name: t("tags"),
								options: (taxonomy?.tags ?? []).map((tag) => ({
									id: tag,
									label: tag
								})),
								selected: filters.tags,
								onToggle: (value) => toggleFilter("tags", value)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-filter-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsm-filter-name" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-chip",
									"data-on": filters.unannotatedOnly,
									onClick: toggleUnannotatedOnly,
									children: t("onlyUnannotated")
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-board-body",
						children: total === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-board-msg",
							children: t("noSessions")
						}) : sorted.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-board-msg",
							children: t("empty")
						}) : viewMode === "quadrant" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuadrantView, {
							sessions: sorted,
							taxonomy,
							maps,
							taskTitles,
							t,
							onOpen: openSessionById,
							onQuickPatch: quickPatch
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupView, {
							sessions: sorted,
							groupBy,
							taxonomy,
							maps,
							taskTitles,
							t,
							onOpen: openSessionById,
							onQuickPatch: quickPatch
						})
					})
				]
			});
		}
		function FilterRow({ name, options, selected, onToggle }) {
			if (options.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-filter-row",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsm-filter-name",
					children: name
				}), options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "dsm-chip",
					"data-on": selected.has(option.id),
					onClick: () => onToggle(option.id),
					children: option.label
				}, option.id))]
			});
		}
		function GroupView({ sessions, groupBy, taxonomy, maps, taskTitles, t, onOpen, onQuickPatch }) {
			const groups = (0, react.useMemo)(() => {
				const buckets = /* @__PURE__ */ new Map();
				const push = (key, session) => {
					const list = buckets.get(key);
					if (list) list.push(session);
					else buckets.set(key, [session]);
				};
				for (const session of sessions) {
					const annotation = session.annotation;
					if (groupBy === "tag") {
						const tags = annotation?.tags ?? [];
						if (tags.length === 0) push(UNANNOTATED_KEY, session);
						else for (const tag of tags) push(tag, session);
					} else if (groupBy === "category") push(annotation?.category ?? UNANNOTATED_KEY, session);
					else if (groupBy === "status") push(effectiveStatusId(annotation, taxonomy), session);
					else push(effectivePriorityId(annotation, taxonomy), session);
				}
				const order = [];
				const seen = /* @__PURE__ */ new Set();
				const addOrdered = (id) => {
					if (id !== UNANNOTATED_KEY && !seen.has(id)) {
						seen.add(id);
						order.push(id);
					}
				};
				if (groupBy === "category") for (const node of taxonomy?.categories ?? []) if (node.children?.length > 0) for (const child of node.children) addOrdered(child.id);
				else addOrdered(node.id);
				else if (groupBy === "status") for (const entry of taxonomy?.statuses ?? []) addOrdered(entry.id);
				else if (groupBy === "priority") for (const entry of taxonomy?.priorities ?? []) addOrdered(entry.id);
				else {
					const known = taxonomy?.tags ?? [];
					for (const tag of known) addOrdered(tag);
					for (const key of [...buckets.keys()].sort()) addOrdered(key);
				}
				if (buckets.has(UNANNOTATED_KEY)) order.push(UNANNOTATED_KEY);
				return order.filter((key) => buckets.has(key)).map((key) => ({
					key,
					sessions: buckets.get(key)
				}));
			}, [
				sessions,
				groupBy,
				taxonomy
			]);
			const labelOf = (key) => {
				if (key === UNANNOTATED_KEY) return groupBy === "category" ? t("unclassified") : t("unannotated");
				if (groupBy === "category") return maps.categories.get(key) ?? key;
				if (groupBy === "status") return maps.statuses.get(key) ?? key;
				if (groupBy === "priority") return maps.priorities.get(key) ?? key;
				return key;
			};
			return groups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsm-group",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-group-head",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-group-title",
						children: labelOf(group.key)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-group-count",
						children: group.sessions.length
					})]
				}), group.sessions.map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BoardRow, {
					session,
					taxonomy,
					maps,
					taskTitles,
					t,
					onOpen,
					onQuickPatch
				}, session.sessionId))]
			}, group.key));
		}
		function QuadrantView({ sessions, taxonomy, maps, taskTitles, t, onOpen, onQuickPatch }) {
			const quadrants = (0, react.useMemo)(() => {
				const quadrants = {
					urgentImportant: [],
					importantNotUrgent: [],
					urgentNotImportant: [],
					neither: []
				};
				for (const session of sessions) {
					const priority = effectivePriorityId(session.annotation, taxonomy);
					const urgent = priority === "urgent" || session.running;
					const important = priority === "urgent" || priority === "important";
					if (urgent && important) quadrants.urgentImportant.push(session);
					else if (important) quadrants.importantNotUrgent.push(session);
					else if (urgent) quadrants.urgentNotImportant.push(session);
					else quadrants.neither.push(session);
				}
				return quadrants;
			}, [sessions, taxonomy]);
			const cells = [
				{
					id: "urgentImportant",
					title: t("quadrantUrgentImportant"),
					sessions: quadrants.urgentImportant
				},
				{
					id: "importantNotUrgent",
					title: t("quadrantImportantNotUrgent"),
					sessions: quadrants.importantNotUrgent
				},
				{
					id: "urgentNotImportant",
					title: t("quadrantUrgentNotImportant"),
					sessions: quadrants.urgentNotImportant
				},
				{
					id: "neither",
					title: t("quadrantNeither"),
					sessions: quadrants.neither
				}
			];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-quadrants",
				children: cells.map((cell) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-quadrant",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-quadrant-title",
						children: [
							cell.title,
							" (",
							cell.sessions.length,
							")"
						]
					}), cell.sessions.map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BoardRow, {
						session,
						taxonomy,
						maps,
						taskTitles,
						t,
						onOpen,
						onQuickPatch
					}, session.sessionId))]
				}, cell.id))
			}) });
		}
		function BoardRow({ session, taxonomy, maps, taskTitles, t, onOpen, onQuickPatch }) {
			const annotation = session.annotation;
			const statusId = effectiveStatusId(annotation, taxonomy);
			const priorityId = effectivePriorityId(annotation, taxonomy);
			const linkedTaskTitle = annotation?.taskId !== void 0 ? taskTitles?.get(annotation.taskId) ?? annotation.taskId : void 0;
			const sub = [session.workspaceTitle ?? session.cwd ?? "", formatRelative(session.updatedAt)].filter(Boolean);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-row",
				"data-archived": session.archived,
				role: "button",
				tabIndex: 0,
				onClick: () => onOpen(session),
				onKeyDown: (event) => {
					if (event.key === "Enter") onOpen(session);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-row-main",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-row-title",
							children: session.displayTitle
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-row-sub",
							children: sub.join(" · ")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-row-badges",
						children: [
							session.running && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-badge",
								"data-kind": "running",
								children: t("running")
							}),
							session.archived && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-badge",
								"data-kind": "archived",
								children: t("archived")
							}),
							annotation !== null && annotation.category !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-badge",
								children: maps.categories.get(annotation.category) ?? annotation.category
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-badge",
								"data-kind": statusId,
								children: maps.statuses.get(statusId) ?? statusId
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-badge",
								"data-kind": priorityId,
								children: maps.priorities.get(priorityId) ?? priorityId
							}),
							linkedTaskTitle !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-badge",
								title: annotation.taskId,
								children: linkedTaskTitle
							}),
							annotation?.sync === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-badge",
								"data-kind": "sync",
								title: t("syncedBadgeTitle"),
								children: t("syncedBadge")
							}),
							annotation !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(annotation.tags ?? []).slice(0, 3).map((tag) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-badge",
								children: tag
							}, tag)), (annotation.tags ?? []).length > 3 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsm-badge",
								children: ["+", (annotation.tags ?? []).length - 3]
							})] })
						]
					}),
					onQuickPatch && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-quick",
						onClick: (event) => event.stopPropagation(),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuickDropdown, {
							kind: "status",
							value: statusId,
							options: [...maps.statuses.entries()].map(([id, label]) => ({
								id,
								label
							})),
							onPick: (id) => onQuickPatch(session, { status: id })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuickDropdown, {
							kind: "priority",
							value: priorityId,
							options: [...maps.priorities.entries()].map(([id, label]) => ({
								id,
								label
							})),
							onPick: (id) => onQuickPatch(session, { priority: id })
						})]
					})
				]
			});
		}
		function QuickDropdown({ kind, value, options, onPick }) {
			const [open, setOpen] = (0, react.useState)(false);
			const current = options.find((option) => option.id === value);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { position: "relative" },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dsm-quickbtn",
					title: kind === "status" ? "status" : "priority",
					onClick: () => setOpen((prev) => !prev),
					children: [current?.label ?? value, " ▾"]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-menu",
					children: options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						"data-selected": option.id === value,
						onClick: () => {
							setOpen(false);
							if (option.id !== value) onPick(option.id);
						},
						children: option.label
					}, option.id))
				})]
			});
		}
		//#endregion
		//#region src/client/collected-panel.jsx
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
		function CollectedPanel({ t }) {
			const [data, setData] = (0, react.useState)(null);
			const [phase, setPhase] = (0, react.useState)("loading");
			const [errorMsg, setErrorMsg] = (0, react.useState)("");
			const [restoring, setRestoring] = (0, react.useState)(null);
			const [targetCwd, setTargetCwd] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [notice, setNotice] = (0, react.useState)("");
			const load = (0, react.useCallback)(async () => {
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
			(0, react.useEffect)(() => {
				load();
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
						targetCwd: targetCwd.trim() === "" ? null : targetCwd.trim()
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
			if (phase === "loading" && data === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-board",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-board-body",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-board-msg",
						children: t("loading")
					})
				})
			});
			if (phase === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-board",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-board-body",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-board-msg",
						children: [t("loadFailed"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn",
							onClick: () => void load(),
							children: t("retry")
						})]
					})
				})
			});
			const sessions = data?.sessions ?? [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-board",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-board-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-board-title",
								children: t("tabCollected")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-board-count",
								children: t("collectedCount", { count: String(sessions.length) })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsm-board-spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-chip",
								onClick: () => void load(),
								children: t("refresh")
							})
						]
					}),
					notice !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-tmsg-ok dsm-pnotice",
						children: notice
					}),
					errorMsg !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-dialog-error dsm-pnotice",
						children: errorMsg
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-board-body",
						children: [sessions.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-board-msg",
							children: t("collectedEmpty")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
							className: "dsm-ttable",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("collectedColSession") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("linkedTask") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("status") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("notes") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("collectedColSource") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("collectedColExported") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("collectedColAction") })
							] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: sessions.map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
									title: session.sessionId,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: session.sessionId })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: session.annotation?.taskId ?? "—" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-badge",
									"data-kind": session.annotation?.status,
									children: session.annotation?.status ?? "—"
								}) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: session.annotation?.notes ?? "—" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
									title: session.sourceCwd ?? session.sourceWorkspace ?? "",
									children: session.sourceWorkspace ?? "—"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: session.exportedAt ?? "—" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: session.local ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-badge",
									"data-kind": "sync",
									children: t("restoreLocal")
								}) : restoring === session.sessionId ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dsm-restore-form",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: "dsm-input dsm-restore-input",
											value: targetCwd,
											placeholder: t("restoreTargetPlaceholder"),
											spellCheck: false,
											onChange: (event) => setTargetCwd(event.target.value)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dsm-btn",
											"data-primary": true,
											disabled: busy,
											onClick: () => void restore(session.sessionId),
											children: t("restoreConfirm")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dsm-btn",
											disabled: busy,
											onClick: () => setRestoring(null),
											children: t("cancel")
										})
									]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dsm-btn",
									disabled: busy,
									onClick: () => startRestore(session),
									children: t("restoreBtn")
								}) })
							] }, session.sessionId)) })]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-settings-hint",
							style: { paddingTop: 12 },
							children: t("restoreHint")
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/prompts-panel.jsx
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
		function freshId(prefix) {
			return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
		}
		function PromptsPanel({ t }) {
			const [loaded, setLoaded] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)(null);
			const [phase, setPhase] = (0, react.useState)("loading");
			const [errorMsg, setErrorMsg] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [notice, setNotice] = (0, react.useState)("");
			const load = (0, react.useCallback)(async () => {
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
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const dirty = (0, react.useMemo)(() => draft !== null && loaded !== null && JSON.stringify(draft) !== JSON.stringify(loaded.groups), [draft, loaded]);
			const totalPrompts = (0, react.useMemo)(() => (draft ?? []).reduce((sum, group) => sum + group.prompts.length, 0), [draft]);
			const mutate = (updater) => {
				setNotice("");
				setDraft((prev) => structuredClone(updater(prev)));
			};
			const addGroup = () => {
				mutate((prev) => [...prev, {
					id: freshId("group"),
					label: t("newGroupLabel"),
					prompts: [{
						id: freshId("prompt"),
						title: t("newPromptTitle"),
						body: t("newPromptBody")
					}]
				}]);
			};
			const addPrompt = (groupId) => {
				mutate((prev) => prev.map((group) => group.id === groupId ? {
					...group,
					prompts: [...group.prompts, {
						id: freshId("prompt"),
						title: t("newPromptTitle"),
						body: t("newPromptBody")
					}]
				} : group));
			};
			const deletePrompt = (groupId, promptId) => {
				mutate((prev) => prev.map((group) => group.id === groupId ? {
					...group,
					prompts: group.prompts.filter((prompt) => prompt.id !== promptId)
				} : group).filter((group, index, all) => group.prompts.length > 0 || all.length === 1));
			};
			const deleteGroup = (groupId) => {
				mutate((prev) => prev.length <= 1 ? prev : prev.filter((group) => group.id !== groupId));
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
			if (phase === "loading" && loaded === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-board",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-board-body",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-board-msg",
						children: t("loading")
					})
				})
			});
			if (phase === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-board",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-board-body",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-board-msg",
						children: [t("loadFailed"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn",
							onClick: () => void load(),
							children: t("retry")
						})]
					})
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-board",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-board-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-board-title",
								children: t("tabPrompts")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-board-count",
								children: t("promptsCount", { count: String(totalPrompts) })
							}),
							dirty && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-badge",
								"data-kind": "doing",
								children: t("promptsDirty")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsm-board-spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-chip",
								onClick: addGroup,
								children: t("newGroup")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-btn",
								"data-primary": true,
								disabled: busy || !dirty,
								onClick: () => void save(),
								children: t("save")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-chip",
								onClick: () => void load(),
								disabled: busy,
								children: t("refresh")
							})
						]
					}),
					notice !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-tmsg-ok dsm-pnotice",
						children: notice
					}),
					errorMsg !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-dialog-error dsm-pnotice",
						children: errorMsg
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-board-body",
						children: (draft ?? []).map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "dsm-group",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-group-head",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "dsm-input dsm-pgroup-label",
										value: group.label,
										"aria-label": t("groupLabel"),
										onChange: (event) => mutate((prev) => prev.map((entry) => entry.id === group.id ? {
											...entry,
											label: event.target.value
										} : entry))
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-group-count",
										children: group.prompts.length
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-chip",
										title: t("deleteGroup"),
										disabled: draft.length <= 1,
										onClick: () => {
											if (window.confirm(t("deleteGroupConfirm"))) deleteGroup(group.id);
										},
										children: t("deleteGroup")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-chip",
										onClick: () => addPrompt(group.id),
										children: t("newPrompt")
									})
								]
							}), group.prompts.map((prompt) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-pcard",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsm-pcard-head",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "dsm-input dsm-pcard-title",
										value: prompt.title,
										"aria-label": t("promptTitle"),
										onChange: (event) => mutate((prev) => prev.map((entry) => entry.id === group.id ? {
											...entry,
											prompts: entry.prompts.map((p) => p.id === prompt.id ? {
												...p,
												title: event.target.value
											} : p)
										} : entry))
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-chip",
										onClick: () => {
											if (group.prompts.length <= 1 && draft.length > 1) {
												if (window.confirm(t("deleteLastPromptConfirm"))) deletePrompt(group.id, prompt.id);
											} else if (group.prompts.length <= 1) setNotice(t("lastGroupProtected"));
											else if (window.confirm(t("deletePromptConfirm"))) deletePrompt(group.id, prompt.id);
										},
										children: t("delete")
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									className: "dsm-textarea dsm-pcard-body",
									value: prompt.body,
									"aria-label": t("promptBody"),
									onChange: (event) => mutate((prev) => prev.map((entry) => entry.id === group.id ? {
										...entry,
										prompts: entry.prompts.map((p) => p.id === prompt.id ? {
											...p,
											body: event.target.value
										} : p)
									} : entry))
								})]
							}, prompt.id))]
						}, group.id))
					})
				]
			});
		}
		//#endregion
		//#region src/client/stats-panel.jsx
		/**
		* The token-usage statistics tab (P7): aggregates from the local session
		* transcripts — the same columns aio-coding-hub tracks (input / output /
		* cache-read / total tokens, request counts). Summary cards, a per-model
		* table, a per-day table (CSS bars, no chart dependency), and the top
		* sessions. Range chips: 7 / 30 / 90 days / all time.
		*
		* @module dsh-session-manager/stats-panel
		*/
		const RANGES = [
			{
				days: 7,
				label: "statsRange7"
			},
			{
				days: 30,
				label: "statsRange30"
			},
			{
				days: 90,
				label: "statsRange90"
			},
			{
				days: 0,
				label: "statsRangeAll"
			}
		];
		/** 1234567 → "1.23M" / "23.4K"; keep raw for < 1000. */
		function formatTokens(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return "0";
			if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
			if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
			if (value >= 1e4) return `${(value / 1e3).toFixed(1)}K`;
			return String(value);
		}
		function StatsPanel({ t }) {
			const [data, setData] = (0, react.useState)(null);
			const [days, setDays] = (0, react.useState)(30);
			const [phase, setPhase] = (0, react.useState)("loading");
			const [errorMsg, setErrorMsg] = (0, react.useState)("");
			const load = (0, react.useCallback)(async (range) => {
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
			(0, react.useEffect)(() => {
				load(days);
			}, [load, days]);
			if (phase === "loading" && data === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-board",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-board-body",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-board-msg",
						children: t("loading")
					})
				})
			});
			if (phase === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-board",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-board-body",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-board-msg",
						children: [t("loadFailed"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn",
							onClick: () => void load(days),
							children: t("retry")
						})]
					})
				})
			});
			const summary = data?.summary ?? {
				requests: 0,
				input: 0,
				output: 0,
				cacheRead: 0,
				total: 0,
				sessions: 0
			};
			const byModel = data?.byModel ?? [];
			const byDate = data?.byDate ?? [];
			const topSessions = data?.topSessions ?? [];
			const maxModelTotal = byModel[0]?.total ?? 1;
			const maxDateTotal = byDate.reduce((max, entry) => Math.max(max, entry.total), 1);
			const cards = [
				{
					label: "statsTotal",
					value: summary.total
				},
				{
					label: "statsInput",
					value: summary.input
				},
				{
					label: "statsOutput",
					value: summary.output
				},
				{
					label: "statsCacheRead",
					value: summary.cacheRead
				},
				{
					label: "statsRequests",
					value: summary.requests
				},
				{
					label: "statsSessions",
					value: summary.sessions
				}
			];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-board",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-board-head",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-board-title",
							children: t("tabStats")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-board-count",
							children: t("statsRequestsCount", { count: String(summary.requests) })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsm-board-spacer" }),
						RANGES.map((range) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-chip",
							"data-on": days === range.days,
							onClick: () => setDays(range.days),
							children: t(range.label)
						}, range.days)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-chip",
							onClick: () => void load(days),
							children: t("refresh")
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-board-body",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-statcards",
							children: cards.map((card) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-statcard",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsm-statcard-value",
									children: formatTokens(card.value)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsm-statcard-label",
									children: t(card.label)
								})]
							}, card.label))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "dsm-group",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-group-head",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-group-title",
									children: t("statsByModel")
								})
							}), byModel.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-board-msg",
								children: t("statsEmpty")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
								className: "dsm-ttable",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("statsModel") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("statsRequests") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("statsInput") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("statsOutput") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("statsCacheRead") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("statsTotal") })
								] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: byModel.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-statmodel",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-badge",
												children: entry.model
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-settings-hint",
												children: entry.provider
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsm-sbar",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { width: `${Math.max(2, Math.round(entry.total / maxModelTotal * 100))}%` } })
											})
										]
									}) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: entry.requests }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: formatTokens(entry.input) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: formatTokens(entry.output) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: formatTokens(entry.cacheRead) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: formatTokens(entry.total) }) })
								] }, `${entry.provider}/${entry.model}`)) })]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "dsm-group",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-group-head",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-group-title",
									children: t("statsByDate")
								})
							}), byDate.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-board-msg",
								children: t("statsEmpty")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
								className: "dsm-ttable",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("statsDate") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("statsRequests") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("statsInput") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("statsOutput") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("statsCacheRead") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("statsTotal") })
								] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: byDate.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsm-statmodel",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: entry.date }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsm-sbar",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { width: `${Math.max(2, Math.round(entry.total / maxDateTotal * 100))}%` } })
										})]
									}) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: entry.requests }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: formatTokens(entry.input) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: formatTokens(entry.output) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: formatTokens(entry.cacheRead) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: formatTokens(entry.total) }) })
								] }, entry.date)) })]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "dsm-group",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-group-head",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-group-title",
									children: t("statsTopSessions")
								})
							}), topSessions.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-board-msg",
								children: t("statsEmpty")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
								className: "dsm-ttable",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("statsSession") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("statsRequests") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("statsTotal") })
								] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: topSessions.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										title: entry.sessionId,
										children: entry.title
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: entry.requests }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: formatTokens(entry.total) }) })
								] }, entry.sessionId)) })]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-settings-hint",
							children: t("statsHint")
						})
					]
				})]
			});
		}
		//#endregion
		//#region src/client/sync-panel.jsx
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
		function SyncPanel({ t }) {
			const [data, setData] = (0, react.useState)(null);
			const [phase, setPhase] = (0, react.useState)("loading");
			const [errorMsg, setErrorMsg] = (0, react.useState)("");
			const [repoPath, setRepoPath] = (0, react.useState)("");
			const [repoUrl, setRepoUrl] = (0, react.useState)("");
			const [sshKey, setSshKey] = (0, react.useState)("");
			const [machine, setMachine] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [notice, setNotice] = (0, react.useState)("");
			const [log, setLog] = (0, react.useState)(null);
			const load = (0, react.useCallback)(async () => {
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
			(0, react.useEffect)(() => {
				load();
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
						syncMachine: machine.trim() === "" ? null : machine.trim()
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
			if (phase === "loading" && data === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-board",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-board-body",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-board-msg",
						children: t("loading")
					})
				})
			});
			if (phase === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-board",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-board-body",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-board-msg",
						children: [t("loadFailed"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn",
							onClick: () => void load(),
							children: t("retry")
						})]
					})
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-board",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-board-head",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-board-title",
							children: t("tabSync")
						}),
						data?.repoReady ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-badge",
							"data-kind": "done",
							children: t("syncRepoReady")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-badge",
							"data-kind": "urgent",
							children: t("syncRepoMissing")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-board-count",
							children: data?.machine ? `machine=${data.machine}` : ""
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsm-board-spacer" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn",
							"data-primary": true,
							disabled: busy || data?.repoPath === null,
							onClick: () => void runSync(),
							children: t("syncRun")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-chip",
							disabled: busy,
							onClick: () => void load(),
							children: t("refresh")
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-board-body",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-sync",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-sync-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-sync-label",
									children: t("syncRepoPathLabel")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "dsm-input dsm-sync-input",
									value: repoPath,
									placeholder: "~/dev/dsh-sync",
									spellCheck: false,
									onChange: (event) => setRepoPath(event.target.value)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-sync-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-sync-label",
									children: t("syncRepoUrlLabel")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "dsm-input dsm-sync-input",
									value: repoUrl,
									placeholder: "git@github.com:DragonFive/dsh-sync.git",
									spellCheck: false,
									onChange: (event) => setRepoUrl(event.target.value)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-settings-hint",
								children: t("syncRepoUrlHint")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-sync-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-sync-label",
									children: t("syncSshKeyLabel")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "dsm-input dsm-sync-input",
									value: sshKey,
									placeholder: "~/.ssh/id_ed25519",
									spellCheck: false,
									onChange: (event) => setSshKey(event.target.value)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-settings-hint",
								children: t("syncSshKeyHint")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-sync-row",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-sync-label",
										children: t("syncMachineLabel")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										className: "dsm-input dsm-sync-input",
										value: machine,
										placeholder: data?.machine ?? "",
										spellCheck: false,
										onChange: (event) => setMachine(event.target.value)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dsm-btn",
										disabled: busy,
										onClick: () => void saveConfig(),
										children: t("syncSaveConfig")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-settings-hint",
								children: t("syncMachineHint")
							}),
							notice !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-tmsg-ok",
								children: notice
							}),
							errorMsg !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-dialog-error",
								children: errorMsg
							}),
							data?.repoReady && data.status !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-sync-status",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
									t("syncDirtyFiles"),
									": ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: data.status.dirty.length }),
									data.status.dirty.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "dsm-settings-hint",
										children: [
											" (",
											data.status.dirty.slice(0, 5).join("、"),
											data.status.dirty.length > 5 ? "…" : "",
											")"
										]
									})
								] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
									t("syncLastCommit"),
									": ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-settings-hint",
										children: data.status.lastCommit
									})
								] })]
							}),
							log !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-sync-log-title",
								children: t("syncLogTitle")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
								className: "dsm-sync-log",
								children: log.join("\n")
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsm-settings-hint",
								children: t("syncEffectHint")
							})
						]
					})
				})]
			});
		}
		//#endregion
		//#region src/client/trellis-panel.jsx
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
		/** task.json status → Chinese label (host markdown export uses the same set). */
		const STATUS_LABELS = {
			planning: "未开始",
			in_progress: "进行中",
			completed: "已完成",
			archived: "已归档"
		};
		/** task.json status → existing board badge kind (color reuse). */
		const STATUS_BADGE_KINDS = {
			planning: "todo",
			in_progress: "doing",
			completed: "done",
			archived: "archived"
		};
		const STATUS_ORDER = [
			"planning",
			"in_progress",
			"completed",
			"archived"
		];
		function statusLabel(status) {
			return STATUS_LABELS[status] ?? status;
		}
		function statusBadgeKind(status) {
			return STATUS_BADGE_KINDS[status] ?? "unknown";
		}
		function TrellisPanel({ t, openSession }) {
			const [data, setData] = (0, react.useState)(null);
			const [board, setBoard] = (0, react.useState)(null);
			const [phase, setPhase] = (0, react.useState)("loading");
			const [errorMsg, setErrorMsg] = (0, react.useState)("");
			const [statusFilter, setStatusFilter] = (0, react.useState)("all");
			const [expanded, setExpanded] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const [showStandalone, setShowStandalone] = (0, react.useState)(false);
			const [config, setConfig] = (0, react.useState)(null);
			const [showExport, setShowExport] = (0, react.useState)(false);
			const load = (0, react.useCallback)(async () => {
				setPhase("loading");
				setErrorMsg("");
				try {
					const [trellis, sessions] = await Promise.all([fetchTrellis(), fetchBoard().catch(() => null)]);
					setData(trellis);
					setBoard(sessions);
					setPhase("ready");
				} catch (reason) {
					setErrorMsg(reason instanceof Error ? reason.message : String(reason));
					setPhase("error");
				}
			}, []);
			const sessionsByTask = (0, react.useMemo)(() => {
				const map = /* @__PURE__ */ new Map();
				for (const session of board?.sessions ?? []) {
					const taskId = session.annotation?.taskId;
					if (taskId === void 0) continue;
					if (!map.has(taskId)) map.set(taskId, []);
					map.get(taskId).push(session);
				}
				return map;
			}, [board]);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			const loadConfig = (0, react.useCallback)(async () => {
				try {
					setConfig(await fetchTrellisConfig());
				} catch {}
			}, []);
			(0, react.useEffect)(() => {
				loadConfig();
			}, [loadConfig]);
			const activeWorkspaces = (0, react.useMemo)(() => (data?.workspaces ?? []).filter((workspace) => workspace.hasTrellis || workspace.warnings.length > 0), [data]);
			const availableStatuses = (0, react.useMemo)(() => {
				const seen = /* @__PURE__ */ new Set();
				for (const workspace of activeWorkspaces) for (const root of workspace.roots) seen.add(root.status);
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
			(0, react.useEffect)(() => {
				if (phase !== "ready" || expanded.size > 0) return;
				const first = activeWorkspaces.find((workspace) => workspace.roots.length > 0)?.roots[0];
				if (first !== void 0) setExpanded(/* @__PURE__ */ new Set([first.dir]));
			}, [
				phase,
				activeWorkspaces,
				expanded.size
			]);
			if (phase === "loading" && data === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-board",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-board-body",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-board-msg",
						children: t("loading")
					})
				})
			});
			if (phase === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-board",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-board-body",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-board-msg",
						children: [t("loadFailed"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn",
							onClick: () => void load(),
							children: t("retry")
						})]
					})
				})
			});
			const totalParents = activeWorkspaces.reduce((sum, workspace) => sum + workspace.roots.length, 0);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-board",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-board-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-board-title",
								children: t("trellisPanelTitle")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-board-count",
								children: t("trellisParentsCount", { count: String(totalParents) })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsm-board-spacer" }),
							availableStatuses.map((status) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-chip",
								"data-on": statusFilter === status,
								onClick: () => setStatusFilter(status),
								children: statusLabel(status)
							}, status)),
							availableStatuses.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-chip",
								"data-on": statusFilter === "all",
								onClick: () => setStatusFilter("all"),
								children: t("trellisFilterAll")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-chip",
								"data-on": showExport,
								onClick: () => {
									setShowExport((prev) => !prev);
									if (!showExport) loadConfig();
								},
								children: t("trellisExport")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-chip",
								onClick: () => void load(),
								children: t("refresh")
							})
						]
					}),
					showExport && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExportPanel, {
						config,
						onConfigSaved: setConfig,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-board-body",
						children: activeWorkspaces.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-board-msg",
							children: t("trellisEmpty")
						}) : activeWorkspaces.map((workspace) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkspaceSection, {
							workspace,
							statusFilter,
							expanded,
							onToggle: toggleExpanded,
							showStandalone,
							onToggleStandalone: () => setShowStandalone((prev) => !prev),
							sessionsByTask,
							onOpenSession: openSession,
							t
						}, workspace.path))
					})
				]
			});
		}
		function WorkspaceSection({ workspace, statusFilter, expanded, onToggle, showStandalone, onToggleStandalone, sessionsByTask, onOpenSession, t }) {
			const roots = statusFilter === "all" ? workspace.roots : workspace.roots.filter((root) => root.status === statusFilter);
			const totalSubtasks = workspace.standalone.length;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsm-group",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-group-head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-group-title",
							children: workspace.title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-group-count",
							children: workspace.path
						})]
					}),
					workspace.warnings.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-twarn",
						title: workspace.warnings.join("\n"),
						children: ["⚠ ", t("trellisWarnings", { count: String(workspace.warnings.length) })]
					}),
					roots.length === 0 && workspace.roots.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-board-msg",
						children: t("trellisNoParents")
					}) : roots.map((root) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ParentCard, {
						root,
						expanded: expanded.has(root.dir),
						onToggle,
						sessionsByTask,
						onOpenSession,
						t
					}, root.dir)),
					roots.length === 0 && workspace.roots.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-board-msg",
						children: t("trellisNoMatch")
					}),
					workspace.orphans.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-twarn",
						children: [
							"⚠ ",
							t("trellisOrphans", { count: String(workspace.orphans.length) }),
							"：",
							workspace.orphans.map((orphan) => orphan.title).join("、")
						]
					}),
					totalSubtasks > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-tstandalone",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-chip",
							"data-on": showStandalone,
							onClick: onToggleStandalone,
							children: t("trellisStandalone", { count: String(totalSubtasks) })
						}), showStandalone && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsm-tstandalone-list",
							children: workspace.standalone.map((task) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsm-row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsm-row-main",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-row-title",
										children: task.title
									})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsm-row-badges",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-badge",
										"data-kind": statusBadgeKind(task.status),
										children: statusLabel(task.status)
									}), (sessionsByTask?.get(task.dir) ?? []).map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionChip, {
										session,
										onOpen: onOpenSession,
										t
									}, session.sessionId))]
								})]
							}, task.dir))
						})]
					})
				]
			});
		}
		function ParentCard({ root, expanded, onToggle, sessionsByTask, onOpenSession, t }) {
			const percent = root.totalCount === 0 ? 0 : Math.round(root.completedCount / root.totalCount * 100);
			const linked = sessionsByTask?.get(root.dir) ?? [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-tcard",
				"data-open": expanded,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "dsm-tcard-head",
						onClick: () => onToggle(root.dir),
						"aria-expanded": expanded,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-chev",
								children: "▶"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-tcard-title",
								title: root.title,
								children: root.title
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsm-row-badges",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-badge",
										"data-kind": statusBadgeKind(root.status),
										children: statusLabel(root.status)
									}),
									root.priority !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-badge",
										children: root.priority
									}),
									root.branch !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-badge",
										children: root.branch
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsm-tcard-progress",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-tcard-bar",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { width: `${percent}%` } })
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dsm-tcard-count",
									children: [
										root.completedCount,
										"/",
										root.totalCount
									]
								})]
							})
						]
					}),
					linked.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-tsessions",
						children: linked.map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionChip, {
							session,
							onOpen: onOpenSession,
							t
						}, session.sessionId))
					}),
					expanded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-tcard-body",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
							className: "dsm-ttable",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("trellisColSubtask") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("status") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("trellisColBranch") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "PR" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("trellisColCompletedAt") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("sessionsCol") })
							] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: root.children.map((child) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChildRow, {
								child,
								depth: 1,
								sessionsByTask,
								onOpenSession,
								t
							}, child.dir)) })]
						})
					})
				]
			});
		}
		function ChildRow({ child, depth, sessionsByTask, onOpenSession, t }) {
			const linked = sessionsByTask?.get(child.dir) ?? [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
					style: { paddingLeft: `${8 + (depth - 1) * 16}px` },
					children: child.title
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dsm-badge",
					"data-kind": statusBadgeKind(child.status),
					children: statusLabel(child.status)
				}) }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: child.branch !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: child.branch }) : "—" }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: child.prUrl !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
					href: child.prUrl,
					target: "_blank",
					rel: "noreferrer",
					children: "PR"
				}) : "—" }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: child.completedAt ?? "—" }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: linked.length === 0 ? "—" : linked.map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionChip, {
					session,
					onOpen: onOpenSession,
					t
				}, session.sessionId)) })
			] }), child.children.map((grandchild) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChildRow, {
				child: grandchild,
				depth: depth + 1,
				sessionsByTask,
				onOpenSession,
				t
			}, grandchild.dir))] });
		}
		/**
		* A linked-session chip on a task card / subtask row. Click opens the
		* session (archived sessions cannot be reopened, matching the board).
		*/
		function SessionChip({ session, onOpen, t }) {
			const label = session.archived ? `${t("archived")} · ${session.displayTitle}` : session.displayTitle;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "dsm-badge dsm-tsession",
				"data-kind": session.running ? "running" : void 0,
				title: session.displayTitle,
				disabled: !onOpen || session.archived,
				onClick: () => onOpen?.(session.sessionId),
				children: label
			});
		}
		function ExportPanel({ config, onConfigSaved, t }) {
			const [fileName, setFileName] = (0, react.useState)("trellis-roadmap.md");
			const [rootDraft, setRootDraft] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [notice, setNotice] = (0, react.useState)(null);
			const [toast, setToast] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
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
						text: `${t("trellisExportOk")}：${result.file}${result.backup !== null ? `（${t("trellisExportBackup")}：${result.backup}）` : ""}`
					});
					setToast({
						text: t("trellisExportOk"),
						tone: "success"
					});
				} catch (reason) {
					const message = reason instanceof Error ? reason.message : String(reason);
					setNotice({
						kind: "err",
						text: `${t("trellisExportFailed")}：${message}`
					});
					setToast({
						text: t("trellisExportFailed"),
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 14 })
					});
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
					setNotice({
						kind: "ok",
						text: t("promptsSaved")
					});
					setToast({
						text: t("promptsSaved"),
						tone: "success"
					});
				} catch (reason) {
					const message = reason instanceof Error ? reason.message : String(reason);
					setNotice({
						kind: "err",
						text: message
					});
					setToast({
						text: t("saveFailed"),
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 14 })
					});
				} finally {
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-texport",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-texport-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-texport-label",
							children: t("trellisExportRoot")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsm-tmeta",
							title: config?.exportRoot ?? "",
							children: [config?.exportRoot ?? "…", config !== null && !config.customized ? `（${t("promptsDefaultPrefix")}）` : ""]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-texport-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "dsm-input dsm-texport-input",
							value: rootDraft,
							placeholder: config?.defaultExportRoot ?? "",
							spellCheck: false,
							"aria-label": t("trellisExportRoot"),
							onChange: (event) => setRootDraft(event.target.value)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn",
							disabled: busy,
							onClick: () => void saveRoot(),
							children: t("trellisExportSaveRoot")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-texport-row",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-texport-label",
								children: t("trellisExportFile")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dsm-input dsm-texport-input",
								value: fileName,
								placeholder: "trellis-roadmap.md",
								spellCheck: false,
								onKeyDown: (event) => {
									if (event.key === "Enter" && fileName.trim() !== "") {
										event.preventDefault();
										runExport();
									}
								},
								onChange: (event) => {
									setFileName(event.target.value);
									setNotice(null);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsm-btn",
								"data-primary": true,
								disabled: busy || fileName.trim() === "",
								onClick: () => void runExport(),
								children: t("trellisExportRun")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-texport-row",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsm-settings-hint",
							children: t("trellisExportFileHint")
						})
					}),
					notice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: notice.kind === "ok" ? "dsm-tmsg-ok" : "dsm-dialog-error",
						children: notice.text
					}),
					toast !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
						text: toast.text,
						tone: toast.tone,
						icon: toast.icon,
						onDone: () => setToast(null)
					})
				]
			});
		}
		//#endregion
		//#region src/client/manager-panel.jsx
		/**
		* The single sidebar entry's main panel: four tabs — 会话看板 (P1),
		* Trellis 看板 (P3), 提示词库 editor (P2), 配置同步 (P5). One panellist
		* icon instead of four keeps the official sidebar compact; the tab bar is
		* a slim chip row at the top of the panel.
		*
		* @module dsh-session-manager/manager-panel
		*/
		const TABS = [
			"sessions",
			"trellis",
			"prompts",
			"sync",
			"collected",
			"stats"
		];
		const TAB_LABELS = {
			sessions: "tabSessions",
			trellis: "tabTrellis",
			prompts: "tabPrompts",
			sync: "tabSync",
			collected: "tabCollected",
			stats: "tabStats"
		};
		function ManagerPanel({ t, openSession }) {
			const [tab, setTab] = (0, react.useState)("sessions");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-manager",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-tabs",
					role: "tablist",
					children: TABS.map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						role: "tab",
						"aria-selected": tab === id,
						className: "dsm-chip",
						"data-on": tab === id,
						onClick: () => setTab(id),
						children: t(TAB_LABELS[id])
					}, id))
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-manager-body",
					children: [
						tab === "sessions" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BoardPanel, {
							t,
							openSession
						}),
						tab === "trellis" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TrellisPanel, {
							t,
							openSession
						}),
						tab === "prompts" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PromptsPanel, { t }),
						tab === "sync" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SyncPanel, { t }),
						tab === "collected" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CollectedPanel, { t }),
						tab === "stats" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatsPanel, { t })
					]
				})]
			});
		}
		//#endregion
		//#region src/client/locales.js
		/**
		* Client dictionaries. Chinese is the primary UX language (parent PRD R5.1);
		* English keeps the required fallback.
		*/
		const NS = "dsh-session-manager";
		const zh = {
			panelTitle: "会话看板",
			managerTitle: "看板",
			tabSessions: "会话",
			tabTrellis: "Trellis",
			tabPrompts: "提示词",
			tabSync: "同步",
			tabCollected: "收藏",
			tabStats: "统计",
			statsRange7: "7 天",
			statsRange30: "30 天",
			statsRange90: "90 天",
			statsRangeAll: "全部",
			statsTotal: "总 tokens",
			statsInput: "输入",
			statsOutput: "输出",
			statsCacheRead: "缓存读",
			statsRequests: "请求数",
			statsSessions: "会话数",
			statsRequestsCount: "{count} 次请求",
			statsByModel: "按模型",
			statsByDate: "按日期",
			statsTopSessions: "消耗 Top 会话",
			statsModel: "模型",
			statsDate: "日期",
			statsSession: "会话",
			statsEmpty: "该时间范围内没有用量记录",
			statsHint: "数据来自本机 ~/.dsh/sessions 的会话记录（assistant/message 的 usage 字段），按本机时区聚合日期；缓存文件 mtime 未变不会重扫。",
			collectedCount: "{count} 个会话",
			collectedEmpty: "同步仓库里还没有导出的会话——在「标注…」里打开「同步到仓库」开关，然后点一次同步",
			collectedColSession: "会话",
			collectedColSource: "来源工作区",
			collectedColExported: "导出时间",
			collectedColAction: "操作",
			restoreBtn: "恢复到本机",
			restoreConfirm: "恢复",
			restoreLocal: "已在本机",
			restoreOk: "已恢复到本机",
			restoreFailed: "恢复失败",
			restoreTargetPlaceholder: "目标工作区绝对路径（留空按原路径恢复）",
			restoreHint: "恢复 = 把会话记录放回本机 ~/.dsh/sessions/，刷新会话看板即可打开继续干活。跨机器路径不同时填目标工作区路径，会话的 cwd 会改写过去（本机需要 zstd）。",
			syncRun: "立即同步",
			syncFailed: "同步失败",
			syncRepoReady: "仓库就绪",
			syncRepoMissing: "仓库未就绪",
			syncRepoPathLabel: "仓库路径",
			syncRepoUrlLabel: "仓库地址",
			syncRepoUrlHint: "本地路径不是 git 仓库时，用它 clone；如 git@github.com:DragonFive/dsh-sync.git",
			syncSshKeyLabel: "SSH 密钥",
			syncSshKeyHint: "可选；留空使用系统默认 ssh 配置（GIT_SSH_COMMAND -i 指定）",
			syncMachineLabel: "机器名",
			syncMachineHint: "决定部署 config/cordis.patch.<机器名>.yml；留空按 hostname 自动识别",
			syncSaveConfig: "保存配置",
			syncDirtyFiles: "未提交改动",
			syncLastCommit: "最近提交",
			syncLogTitle: "同步日志",
			syncEffectHint: "同步 = pull → 部署本机 provider 配置 → 提示词库指向仓库 → 提交推送本地改动。提示词即时生效；cordis.patch.yml 需重启 dsh web。",
			annotate: "标注…",
			annotateIconLabel: "标注",
			annotateTitle: "会话标注",
			category: "分类",
			newCategoryPlaceholder: "输入自定义分类，回车添加",
			tags: "标签",
			tagPlaceholder: "输入新标签，回车添加",
			status: "状态",
			priority: "优先级",
			linkedTask: "关联任务",
			noLinkedTask: "不关联",
			linkedTaskMissing: "已不在任务列表",
			searchPlaceholder: "搜索会话 / 任务 / 备注…",
			sessionsCol: "会话",
			syncFieldLabel: "同步到仓库",
			syncFieldHint: "打开后，下次点「同步」时会把本会话的完整记录（zstd 压缩正本 + 元信息）导出到 dsh-sync 仓库",
			syncedBadge: "已同步",
			syncedBadgeTitle: "已标记同步到 git 仓库",
			notes: "备注",
			notesPlaceholder: "备注（可选）",
			save: "保存",
			cancel: "取消",
			clear: "清除标注",
			clearConfirm: "确定清除该会话的标注吗？",
			unannotated: "未标注",
			unclassified: "未分类",
			groupBy: "分组",
			groupByCategory: "按分类",
			groupByStatus: "按状态",
			groupByPriority: "按优先级",
			groupByTag: "按标签",
			view: "视图",
			groupView: "分组",
			quadrantView: "四象限",
			filters: "筛选",
			hideFilters: "收起筛选",
			refresh: "刷新",
			loading: "加载中…",
			loadFailed: "加载失败",
			retry: "重试",
			empty: "没有符合条件的会话",
			noSessions: "还没有会话",
			running: "运行中",
			archived: "已归档",
			sessionsCount: "{count} 个会话",
			quadrantUrgentImportant: "重要且紧急",
			quadrantImportantNotUrgent: "重要不紧急",
			quadrantUrgentNotImportant: "紧急不重要",
			quadrantNeither: "不紧急不重要",
			sortByUpdated: "按更新时间",
			sortDesc: "新→旧",
			sortAsc: "旧→新",
			saveFailed: "保存失败",
			onlyUnannotated: "只看未标注",
			promptCommandLabel: "插入提示词",
			promptCommandDescription: "从提示词库选择一条，追加到输入框草稿（不发送）",
			promptLibraryEmpty: "提示词库为空（groups 下没有任何条目）",
			promptMissing: "该提示词已不在库中，请重新打开 /p",
			promptsSettingsTab: "提示词库",
			promptsCount: "{count} 条提示词",
			promptsDirty: "有未保存修改",
			newGroup: "新增分组",
			newGroupLabel: "新分组",
			newPrompt: "新增提示词",
			newPromptTitle: "新提示词",
			newPromptBody: "提示词正文…",
			deleteGroup: "删除分组",
			deleteGroupConfirm: "确定删除整个分组及其所有提示词吗？",
			deletePromptConfirm: "确定删除这条提示词吗？",
			deleteLastPromptConfirm: "这是该分组最后一条提示词，删除后分组也会一起移除，确定吗？",
			lastGroupProtected: "至少保留一个分组和一条提示词",
			groupLabel: "分组名",
			promptTitle: "标题",
			promptBody: "正文",
			promptsSettingsIntro: "常用提示词库：在输入框输入 /prompt 或 /p 选择一条提示词插入草稿。库文件为 YAML，修改保存后下次打开即生效（无需重启）。",
			promptsFileLabel: "库文件路径",
			promptsFileHint: "绝对路径，支持 ~ 前缀；留空使用默认路径",
			promptsDefaultPrefix: "默认",
			promptsSaved: "已保存",
			promptsResetField: "恢复默认",
			trellisPanelTitle: "Trellis 看板",
			trellisParentsCount: "{count} 个里程碑",
			trellisFilterAll: "全部",
			trellisEmpty: "当前工作区未初始化 Trellis（未找到 .trellis/tasks）",
			trellisNoParents: "该工作区 .trellis/tasks 下没有带子任务的父任务",
			trellisNoMatch: "没有符合条件的里程碑",
			trellisStandalone: "独立任务（{count}）",
			trellisOrphans: "孤儿任务（{count} 个，parent 指向不存在的任务）",
			trellisWarnings: "{count} 条读取警告（悬停查看详情）",
			trellisColSubtask: "子任务",
			trellisColBranch: "分支",
			trellisColCompletedAt: "完成时间",
			trellisExport: "导出到笔记",
			trellisExportRoot: "导出根目录",
			trellisExportSaveRoot: "保存根目录",
			trellisExportFile: "目标文件",
			trellisExportFileHint: "相对导出根目录的文件名（或绝对路径）；目标必须在导出根目录之下",
			trellisExportRun: "导出",
			trellisExportOk: "已导出",
			trellisExportBackup: "备份",
			trellisExportFailed: "导出失败"
		};
		const en = {
			panelTitle: "Session Board",
			managerTitle: "Boards",
			tabSessions: "Sessions",
			tabTrellis: "Trellis",
			tabPrompts: "Prompts",
			tabSync: "Sync",
			tabCollected: "Collected",
			tabStats: "Stats",
			statsRange7: "7d",
			statsRange30: "30d",
			statsRange90: "90d",
			statsRangeAll: "All",
			statsTotal: "Total tokens",
			statsInput: "Input",
			statsOutput: "Output",
			statsCacheRead: "Cache read",
			statsRequests: "Requests",
			statsSessions: "Sessions",
			statsRequestsCount: "{count} requests",
			statsByModel: "By model",
			statsByDate: "By date",
			statsTopSessions: "Top sessions",
			statsModel: "Model",
			statsDate: "Date",
			statsSession: "Session",
			statsEmpty: "No usage in this range",
			statsHint: "Aggregated from the local ~/.dsh/sessions transcripts (assistant/message usage), dates in local time; files are rescanned only when their mtime changes.",
			collectedCount: "{count} sessions",
			collectedEmpty: "No exported sessions in the sync repo yet — turn on 同步到仓库 in the annotate dialog and run a sync",
			collectedColSession: "Session",
			collectedColSource: "Source workspace",
			collectedColExported: "Exported",
			collectedColAction: "Action",
			restoreBtn: "Restore here",
			restoreConfirm: "Restore",
			restoreLocal: "local",
			restoreOk: "Restored",
			restoreFailed: "Restore failed",
			restoreTargetPlaceholder: "Target workspace path (empty = original path)",
			restoreHint: "Restore puts the transcript back into ~/.dsh/sessions/ on this machine; refresh the session board to open and continue it. For cross-machine layouts, fill the target workspace path — the session cwd is rewritten (requires zstd on this machine).",
			syncRun: "Sync now",
			syncFailed: "Sync failed",
			syncRepoReady: "repo ready",
			syncRepoMissing: "repo not ready",
			syncRepoPathLabel: "Repo path",
			syncRepoUrlLabel: "Repo URL",
			syncRepoUrlHint: "Used to clone when the local path is not a checkout, e.g. git@github.com:DragonFive/dsh-sync.git",
			syncSshKeyLabel: "SSH key",
			syncSshKeyHint: "Optional; empty uses the default ssh config (GIT_SSH_COMMAND -i)",
			syncMachineLabel: "Machine",
			syncMachineHint: "Selects config/cordis.patch.<machine>.yml; empty auto-detects from hostname",
			syncSaveConfig: "Save config",
			syncDirtyFiles: "Uncommitted changes",
			syncLastCommit: "Last commit",
			syncLogTitle: "Sync log",
			syncEffectHint: "Sync = pull → deploy this machine's provider config → point the prompt library at the repo → commit and push. Prompts apply live; cordis.patch.yml needs a dsh web restart.",
			annotate: "Annotate…",
			annotateIconLabel: "Annotate",
			annotateTitle: "Annotate Session",
			category: "Category",
			newCategoryPlaceholder: "Type a custom category, press Enter",
			tags: "Tags",
			tagPlaceholder: "Type a new tag, press Enter",
			status: "Status",
			priority: "Priority",
			linkedTask: "Linked task",
			noLinkedTask: "None",
			linkedTaskMissing: "not in task list",
			searchPlaceholder: "Search sessions / tasks / notes…",
			sessionsCol: "Sessions",
			syncFieldLabel: "Sync to repo",
			syncFieldHint: "When on, the next sync copies this session's full transcript (zstd original + metadata) into the dsh-sync repo",
			syncedBadge: "synced",
			syncedBadgeTitle: "flagged for git-repo sync",
			notes: "Notes",
			notesPlaceholder: "Notes (optional)",
			save: "Save",
			cancel: "Cancel",
			clear: "Clear annotation",
			clearConfirm: "Clear this session's annotation?",
			unannotated: "Unannotated",
			unclassified: "Unclassified",
			groupBy: "Group by",
			groupByCategory: "Category",
			groupByStatus: "Status",
			groupByPriority: "Priority",
			groupByTag: "Tag",
			view: "View",
			groupView: "Groups",
			quadrantView: "Quadrants",
			filters: "Filters",
			hideFilters: "Hide filters",
			refresh: "Refresh",
			loading: "Loading…",
			loadFailed: "Failed to load",
			retry: "Retry",
			empty: "No sessions match the filters",
			noSessions: "No sessions yet",
			running: "Running",
			archived: "Archived",
			sessionsCount: "{count} sessions",
			quadrantUrgentImportant: "Urgent & Important",
			quadrantImportantNotUrgent: "Important, not urgent",
			quadrantUrgentNotImportant: "Urgent, not important",
			quadrantNeither: "Neither",
			sortByUpdated: "By updated time",
			sortDesc: "New→old",
			sortAsc: "Old→new",
			saveFailed: "Save failed",
			onlyUnannotated: "Unannotated only",
			promptCommandLabel: "Insert prompt",
			promptCommandDescription: "Pick a prompt from the library and append it to the draft (not sent)",
			promptLibraryEmpty: "The prompt library is empty (no entries under groups)",
			promptMissing: "This prompt is no longer in the library; reopen /p",
			promptsSettingsTab: "Prompt Library",
			promptsCount: "{count} prompts",
			promptsDirty: "Unsaved changes",
			newGroup: "New group",
			newGroupLabel: "New group",
			newPrompt: "New prompt",
			newPromptTitle: "New prompt",
			newPromptBody: "Prompt body…",
			deleteGroup: "Delete group",
			deleteGroupConfirm: "Delete this group and all its prompts?",
			deletePromptConfirm: "Delete this prompt?",
			deleteLastPromptConfirm: "This is the group's last prompt; the group will be removed too. Continue?",
			lastGroupProtected: "Keep at least one group and one prompt",
			groupLabel: "Group name",
			promptTitle: "Title",
			promptBody: "Body",
			promptsSettingsIntro: "Prompt library: type /prompt or /p in the composer to pick a prompt into the draft. The library is a YAML file; edits apply on the next open (no restart needed).",
			promptsFileLabel: "Library file path",
			promptsFileHint: "Absolute path (~ prefix supported); empty uses the default",
			promptsDefaultPrefix: "Default",
			promptsSaved: "Saved",
			promptsResetField: "Reset to default",
			trellisPanelTitle: "Trellis Board",
			trellisParentsCount: "{count} milestones",
			trellisFilterAll: "All",
			trellisEmpty: "This workspace has no Trellis setup (.trellis/tasks not found)",
			trellisNoParents: "No parent tasks with subtasks under .trellis/tasks",
			trellisNoMatch: "No milestones match the filter",
			trellisStandalone: "Standalone tasks ({count})",
			trellisOrphans: "Orphan tasks ({count}, parent points to a missing task)",
			trellisWarnings: "{count} read warnings (hover for details)",
			trellisColSubtask: "Subtask",
			trellisColBranch: "Branch",
			trellisColCompletedAt: "Completed",
			trellisExport: "Export to note",
			trellisExportRoot: "Export root",
			trellisExportSaveRoot: "Save root",
			trellisExportFile: "Target file",
			trellisExportFileHint: "File name relative to the export root (or an absolute path); the target must stay under the root",
			trellisExportRun: "Export",
			trellisExportOk: "Exported",
			trellisExportBackup: "backup",
			trellisExportFailed: "Export failed"
		};
		//#endregion
		//#region src/client/prompt-command.jsx
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
		const PROMPT_COMMAND_NAMES = ["prompt", "p"];
		const DETAIL_MAX = 64;
		/** option.id → prompt body, replaced wholesale on every options load. */
		const promptBodies = /* @__PURE__ */ new Map();
		function summarize(body) {
			const text = (body.split("\n").find((line) => line.trim() !== "") ?? "").trim();
			return text.length > DETAIL_MAX ? `${text.slice(0, 63)}…` : text;
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
			const bodies = /* @__PURE__ */ new Map();
			for (const group of library.groups ?? []) for (const prompt of group.prompts ?? []) {
				const id = `${group.id}/${prompt.id}`;
				bodies.set(id, prompt.body);
				options.push({
					id,
					label: `${group.label} · ${prompt.title}`,
					detail: summarize(prompt.body)
				});
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
			const binding = typeof sessions?.binding === "function" ? sessions.binding(sessionId) : void 0;
			if (binding === void 0 || conversation?.input === void 0) return void 0;
			try {
				return conversation.input.for(binding.ctx);
			} catch {
				return;
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
				if (input === void 0) {
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
		function registerPromptCommand(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.inject(["commandUi"], (scope) => {
				for (const name of PROMPT_COMMAND_NAMES) scope.effect(() => scope.commandUi.register({
					name,
					label: () => t("promptCommandLabel"),
					description: () => t("promptCommandDescription"),
					icon: _deepseek_ai_dsh_client_ui_primitives.IconSparkleRegular,
					available: () => true,
					ui: {
						kind: "popupSelect",
						options: async (_session, signal) => loadOptions(t),
						onSelect: (option, session) => {
							const body = promptBodies.get(option.id);
							if (body === void 0) throw new Error(t("promptMissing"));
							appendPromptToDraft(ctx, session.sessionId, body);
						}
					}
				}), `dsh-session-manager: /${name} command`);
			});
		}
		//#endregion
		//#region src/client/prompts-settings.jsx
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
		function PromptsSettingsTab({ t }) {
			const [config, setConfig] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const [saved, setSaved] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				let cancelled = false;
				fetchPromptsConfig().then((value) => {
					if (cancelled) return;
					setConfig(value);
					setDraft(value.promptsFile ?? "");
				}).catch((reason) => {
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
			if (config === null && error === "") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsm-settings-body",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-settings-note",
					children: t("loading")
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-settings-body",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsm-settings-intro",
						children: t("promptsSettingsIntro")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-dialog-field",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-dialog-label",
								children: t("promptsFileLabel")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dsm-input",
								value: draft,
								placeholder: config?.defaultFile ?? "",
								spellCheck: false,
								onChange: (event) => {
									setDraft(event.target.value);
									setSaved(false);
								},
								onKeyDown: (event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										save();
									}
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsm-settings-hint",
								children: [t("promptsFileHint"), config?.defaultFile ? `（${t("promptsDefaultPrefix")}：${config.defaultFile}）` : null]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-dialog-error",
						children: error
					}),
					saved && error === "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsm-settings-saved",
						children: t("promptsSaved")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-dialog-footer",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn",
							disabled: busy,
							onClick: () => {
								setDraft("");
								setSaved(false);
							},
							children: t("promptsResetField")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dsm-btn",
							"data-primary": true,
							disabled: busy,
							onClick: save,
							children: t("save")
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/styles.js
		/**
		* Plugin stylesheet, injected once as
		* `<style data-plugin-css="dsh-session-manager/client">`.
		*
		* Colors read the official `--dsw-alias-*` tokens when present (the same
		* variables dsh-trellis uses) with fixed dark-theme fallbacks, so the panel
		* follows the official look without touching any official stylesheet.
		*/
		const styles = String.raw`
.dsm-board{min-width:0;display:flex;flex-direction:column;height:100%}
.dsm-manager{min-width:0;display:flex;flex-direction:column;height:100%}
.dsm-tabs{display:flex;align-items:center;gap:6px;padding:10px 16px 0}
.dsm-manager-body{flex:1;min-height:0;display:flex;flex-direction:column}
.dsm-manager-body>.dsm-board{flex:1;min-height:0}
.dsm-pnotice{padding:6px 16px 0;font-size:12px}
.dsm-pgroup-label{width:200px;height:28px;font-size:13px;font-weight:600;flex:none}
.dsm-pcard{border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:10px;padding:8px 10px;margin-bottom:8px;display:flex;flex-direction:column;gap:6px}
.dsm-pcard-head{display:flex;align-items:center;gap:8px}
.dsm-pcard-title{flex:1;height:30px;font-size:13px;font-weight:500}
.dsm-pcard-body{min-height:96px;font-size:12px}
.dsm-sync{max-width:640px;display:flex;flex-direction:column;gap:10px;padding:4px 0}
.dsm-sync-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-sync-label{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary,#8f8f96);width:64px}
.dsm-sync-input{flex:1;min-width:240px;height:30px;font-size:12px}
.dsm-sync-status{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary,#c6c6cc);padding:6px 0}
.dsm-sync-log-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#e9e9ec);margin-bottom:4px}
.dsm-sync-log{margin:0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#1f1f23);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary,#c6c6cc);white-space:pre-wrap;word-break:break-all;max-height:240px;overflow-y:auto}
.dsm-board-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,#2a2a2e)}
.dsm-board-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#e9e9ec);margin-right:4px}
.dsm-board-count{font-size:12px;color:var(--dsw-alias-label-tertiary,#8f8f96)}
.dsm-board-spacer{flex:1}
.dsm-board-body{flex:1;min-height:0;overflow-y:auto;padding:12px 16px}
.dsm-board-msg{padding:24px 0;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary,#8f8f96)}
.dsm-board-msg button{margin-left:8px}
.dsm-filters{padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,#2a2a2e);display:flex;flex-direction:column;gap:8px}
.dsm-filter-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-filter-name{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary,#8f8f96);width:52px}
.dsm-chip{appearance:none;border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:999px;background:none;color:var(--dsw-alias-label-secondary,#c6c6cc);font:inherit;font-size:12px;line-height:1.5;padding:2px 10px;cursor:pointer}
.dsm-chip:hover{border-color:var(--dsw-alias-label-dimmed,#77777e)}
.dsm-chip[data-on=true]{border-color:transparent;background:var(--dsw-alias-brand-primary,#4c6ef5);color:#fff}
.dsm-group{margin-bottom:16px}
.dsm-group-head{display:flex;align-items:baseline;gap:8px;padding:4px 0 8px}
.dsm-group-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e9e9ec)}
.dsm-group-count{font-size:12px;color:var(--dsw-alias-label-tertiary,#8f8f96)}
.dsm-quadrants{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.dsm-quadrant{border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:12px;padding:10px;min-width:0}
.dsm-quadrant-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e9e9ec);padding:2px 4px 8px}
.dsm-row{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;cursor:pointer;position:relative}
.dsm-row:hover{background:var(--dsw-alias-bg-layer-2,#26262a)}
.dsm-row[data-archived=true]{opacity:.55}
.dsm-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dsm-row-title{font-size:13px;color:var(--dsw-alias-label-primary,#e9e9ec);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-row-sub{font-size:11px;color:var(--dsw-alias-label-tertiary,#8f8f96);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-row-badges{flex:none;display:flex;align-items:center;gap:4px;flex-wrap:wrap;justify-content:flex-end;max-width:45%}
.dsm-badge{border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2,#2a2a2e);color:var(--dsw-alias-label-secondary,#c6c6cc)}
.dsm-badge[data-kind=running]{border-color:transparent;background:var(--dsw-alias-brand-primary,#4c6ef5);color:#fff}
.dsm-badge[data-kind=todo]{color:var(--dsw-alias-label-tertiary,#8f8f96)}
.dsm-badge[data-kind=doing]{border-color:transparent;background:#2f6f4f;color:#fff}
.dsm-badge[data-kind=done]{border-color:transparent;background:#3d5a80;color:#fff}
.dsm-badge[data-kind=urgent]{border-color:transparent;background:#a23a3a;color:#fff}
.dsm-badge[data-kind=important]{border-color:transparent;background:#946b2d;color:#fff}
.dsm-badge[data-kind=archived]{border-color:transparent;background:var(--dsw-alias-bg-module-platform,#3a3a40);color:var(--dsw-alias-label-secondary,#c6c6cc)}
.dsm-badge[data-kind=sync]{border-color:transparent;background:var(--dsw-alias-state-success-primary,#46a758);color:#fff}
.dsm-sync-toggle{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary,#e9e9ec);cursor:pointer}
.dsm-restore-form{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsm-restore-input{height:26px;font-size:11px;min-width:200px}
.dsm-statcards{display:flex;flex-wrap:wrap;gap:10px;padding:2px 0 12px}
.dsm-statcard{flex:1;min-width:100px;border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2,transparent)}
.dsm-statcard-value{font-size:17px;font-weight:600;color:var(--dsw-alias-label-primary,#e9e9ec);font-variant-numeric:tabular-nums}
.dsm-statcard-label{font-size:11px;color:var(--dsw-alias-label-tertiary,#8f8f96);padding-top:2px}
.dsm-statmodel{display:flex;align-items:center;gap:8px;min-width:220px}
.dsm-sbar{flex:1;height:5px;border-radius:3px;background:var(--dsw-alias-bg-module-platform,#3a3a40);overflow:hidden;min-width:60px}
.dsm-sbar>span{display:block;height:100%;background:var(--dsw-alias-brand-primary,#4c6ef5)}
.dsm-quick{flex:none;display:flex;gap:4px}
.dsm-quickbtn{appearance:none;border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:6px;background:none;color:var(--dsw-alias-label-secondary,#c6c6cc);font:inherit;font-size:11px;padding:2px 6px;cursor:pointer}
.dsm-quickbtn:hover{border-color:var(--dsw-alias-label-dimmed,#77777e)}
.dsm-menu{position:absolute;top:calc(100% + 2px);right:0;z-index:30;min-width:120px;background:var(--dsw-alias-bg-layer-3,#1f1f23);border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:8px;padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.4)}
.dsm-menu button{display:block;width:100%;text-align:left;appearance:none;border:0;background:none;color:var(--dsw-alias-label-secondary,#c6c6cc);font:inherit;font-size:12px;padding:5px 8px;border-radius:6px;cursor:pointer}
.dsm-menu button:hover{background:var(--dsw-alias-bg-layer-2,#26262a)}
.dsm-menu button[data-selected=true]{color:var(--dsw-alias-label-primary,#e9e9ec);font-weight:600}
.dsm-dialog-field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.dsm-dialog-label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary,#e9e9ec)}
.dsm-pill-row{display:flex;flex-wrap:wrap;gap:6px}
.dsm-pill{appearance:none;border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:999px;background:none;color:var(--dsw-alias-label-secondary,#c6c6cc);font:inherit;font-size:12px;padding:3px 12px;cursor:pointer}
.dsm-pill:hover{border-color:var(--dsw-alias-label-dimmed,#77777e)}
.dsm-pill[data-on=true]{border-color:transparent;background:var(--dsw-alias-brand-primary,#4c6ef5);color:#fff}
.dsm-pill[data-indent=true]{margin-left:16px}
.dsm-input{box-sizing:border-box;width:100%;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#1f1f23);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#e9e9ec);height:34px}
.dsm-textarea{box-sizing:border-box;width:100%;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#1f1f23);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#e9e9ec);min-height:64px;resize:vertical}
.dsm-input:focus-visible,.dsm-textarea:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary,#4c6ef5)}
.dsm-dialog-error{font-size:12px;color:var(--dsw-alias-label-error,#e5484d);min-height:16px}
.dsm-dialog-footer{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.dsm-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;cursor:pointer;background:none;color:var(--dsw-alias-label-secondary,#c6c6cc)}
.dsm-btn:hover{border-color:var(--dsw-alias-label-dimmed,#77777e)}
.dsm-btn[data-primary=true]{border-color:transparent;background:var(--dsw-alias-label-primary,#e9e9ec);color:var(--dsw-alias-bg-layer-3,#1f1f23)}
.dsm-btn:disabled{opacity:.45;cursor:default}
.dsm-btn-danger{color:var(--dsw-alias-label-error,#e5484d)}
.dsm-rowaction{appearance:none;border:0;background:none;color:var(--dsw-alias-label-tertiary,#8f8f96);cursor:pointer;padding:2px;border-radius:6px;display:inline-flex;align-items:center}
.dsm-rowaction:hover{color:var(--dsw-alias-label-primary,#e9e9ec);background:var(--dsw-alias-bg-layer-2,#26262a)}
.dsm-settings-body{max-width:560px;display:flex;flex-direction:column;gap:12px;padding:14px 2px}
.dsm-settings-intro{margin:0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary,#c6c6cc)}
.dsm-settings-note{font-size:13px;color:var(--dsw-alias-label-tertiary,#8f8f96)}
.dsm-settings-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8f8f96);word-break:break-all}
.dsm-settings-saved{font-size:12px;color:var(--dsw-alias-state-success-primary,#46a758)}
.dsm-tcard{border:1px solid var(--dsw-alias-border-l2,#2a2a2e);border-radius:10px;margin-bottom:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,transparent)}
.dsm-tcard-head{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:9px 12px;background:none;border:0;cursor:pointer;text-align:left;font:inherit}
.dsm-tcard-head:hover{background:var(--dsw-alias-bg-layer-2,#26262a)}
.dsm-tcard-title{flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e9e9ec);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-tcard-progress{flex:none;display:flex;align-items:center;gap:6px}
.dsm-tcard-bar{display:inline-block;width:72px;height:6px;border-radius:3px;background:var(--dsw-alias-bg-module-platform,#3a3a40);overflow:hidden}
.dsm-tcard-bar>span{display:block;height:100%;background:var(--dsw-alias-brand-primary,#4c6ef5)}
.dsm-tcard-count{font-size:11px;color:var(--dsw-alias-label-tertiary,#8f8f96);font-variant-numeric:tabular-nums}
.dsm-chev{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary,#8f8f96);transition:transform .15s ease}
.dsm-tcard[data-open=true] .dsm-chev{transform:rotate(90deg)}
.dsm-tcard-body{padding:2px 12px 10px;overflow-x:auto}
.dsm-ttable{width:100%;border-collapse:collapse;font-size:12px}
.dsm-ttable th{text-align:left;font-weight:500;color:var(--dsw-alias-label-tertiary,#8f8f96);padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l2,#2a2a2e);white-space:nowrap}
.dsm-ttable td{padding:5px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,#222226);color:var(--dsw-alias-label-secondary,#c6c6cc);vertical-align:top}
.dsm-ttable tr:last-child td{border-bottom:0}
.dsm-ttable code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary,#8f8f96)}
.dsm-ttable a{color:var(--dsw-alias-brand-primary,#4c6ef5)}
.dsm-twarn{font-size:12px;color:var(--dsw-alias-label-warning,#f5A623);padding:2px 0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsm-tstandalone{padding:6px 0 2px}
.dsm-tstandalone-list{padding:4px 0 0}
.dsm-search{width:180px;flex:none;height:28px;font-size:12px;padding:0 10px}
.dsm-tsessions{display:flex;flex-wrap:wrap;gap:4px;padding:0 12px 8px}
.dsm-tsession{appearance:none;background:none;font:inherit;cursor:pointer;max-width:220px;overflow:hidden;text-overflow:ellipsis}
.dsm-tsession:hover{border-color:var(--dsw-alias-label-dimmed,#77777e)}
.dsm-tsession:disabled{opacity:.55;cursor:default}
.dsm-ttable .dsm-tsession{display:inline-block;max-width:180px;margin:1px 4px 1px 0;vertical-align:middle}
.dsm-texport{padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,#2a2a2e);display:flex;flex-direction:column;gap:8px}
.dsm-texport-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-texport-label{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary,#8f8f96);width:60px}
.dsm-texport-input{flex:1;min-width:220px;height:30px;font-size:12px}
.dsm-tmeta{font-size:12px;color:var(--dsw-alias-label-secondary,#c6c6cc);word-break:break-all}
.dsm-tmsg-ok{font-size:12px;color:var(--dsw-alias-state-success-primary,#46a758);word-break:break-all}
`;
		//#endregion
		//#region src/client/index.jsx
		/**
		* dsh-session-manager client half (browser bundle).
		*
		* Registers, through `ctx.slots`:
		* - `sidebar.panellist` id `dsm-board` — the ONE sidebar entry (the list
		*   id is also the `main` keyed-slot panel key); the panel itself hosts
		*   three tabs: Session Board (P1) / Trellis board (P3) / prompt-library
		*   editor (P2), so the official sidebar keeps a single icon;
		* - `sidebar.workspaces.session.menu.item` id `dsm.annotate` (order 500,
		*   after the official pin/rename/fork/archive rows) — "标注…";
		* - `sidebar.workspaces.session.row.action` id `dsm.annotate-icon`
		*   (order 300, after the official archive/pin hover buttons).
		*
		* Consumed services: `slots` + `locale` (ui-slots / client-locale) and
		* `uiWorkspace` (dsh-client-ui-workspace) for `openSession` click-through.
		*/
		const PANEL_ID = "dsm-board";
		const MENU_ITEM_ID = "dsm.annotate";
		const ROW_ACTION_ID = "dsm.annotate-icon";
		const OVERLAY_ID = "dsm.annotate-overlay";
		const SETTINGS_TAB_ID = "dsm.prompts";
		const inject = [
			"slots",
			"locale",
			"uiWorkspace"
		];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-session-manager: locale");
			ctx.effect(() => {
				if (document.querySelector("style[data-plugin-css=\"dsh-session-manager/client\"]") !== null) return () => {};
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-session-manager";
				tag.dataset.pluginCss = "dsh-session-manager/client";
				tag.textContent = styles;
				document.head.appendChild(tag);
				return () => tag.remove();
			}, "dsh-session-manager: styles");
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: PANEL_ID,
				locale: NS,
				inject: () => ({ openSession: (sessionId) => ctx.uiWorkspace.openSession(sessionId) })
			}, ManagerPanel));
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 500,
				label: () => ctx.locale.bind(NS)("managerTitle"),
				locale: NS
			}, BoardPanelIcon));
			ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
				name: "sidebar.workspaces.session.menu.item",
				id: MENU_ITEM_ID,
				order: 500,
				locale: NS
			}, AnnotateMenuItem));
			ctx.slots.inject("sidebar.workspaces.session.row.action", () => ctx.slots.register({
				name: "sidebar.workspaces.session.row.action",
				id: ROW_ACTION_ID,
				order: 300,
				locale: NS
			}, AnnotateRowAction));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: OVERLAY_ID,
				order: 500,
				locale: NS
			}, AnnotateOverlayHost));
			registerPromptCommand(ctx);
			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: SETTINGS_TAB_ID,
				order: 600,
				label: () => ctx.locale.bind(NS)("promptsSettingsTab"),
				locale: NS
			}, PromptsSettingsTab));
		}
		/** Sidebar panel glyph; the sidebar owns the button, label, and selected state. */
		function BoardPanelIcon({ size }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChecklistOutlineRegular, { size });
		}
		/** "标注…" menu row. Dismisses the menu and raises an annotate request. */
		function AnnotateMenuItem({ sessionId, displayTitle, useMenuOpenState, t }) {
			const [, setMenuOpen] = useMenuOpenState();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MenuItemButton, {
				separatorBefore: true,
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconListPenOutlineRegular, { size: 14 }),
				onSelect: () => {
					setMenuOpen(false);
					requestAnnotate({
						sessionId,
						displayTitle
					});
				},
				children: t("annotate")
			});
		}
		/** Hover tag icon at the session row's end (clicks stay inside the strip). */
		function AnnotateRowAction({ sessionId, displayTitle, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "dsm-rowaction",
				title: t("annotateIconLabel"),
				"aria-label": t("annotateIconLabel"),
				onClick: () => requestAnnotate({
					sessionId,
					displayTitle
				}),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconListPenOutlineRegular, { size: 14 })
			});
		}
		/** The one long-lived annotate dialog instance, fed by the request bus. */
		function AnnotateOverlayHost({ t }) {
			const [request, setRequest] = (0, react.useState)(null);
			(0, react.useEffect)(() => subscribeAnnotate(setRequest), []);
			if (request === null) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AnnotateDialog, {
				open: true,
				onClose: () => setRequest(null),
				sessionId: request.sessionId,
				displayTitle: request.displayTitle,
				onSaved: notifyAnnotationsChanged,
				t
			});
		}
		//#endregion
		exports.MENU_ITEM_ID = MENU_ITEM_ID;
		exports.OVERLAY_ID = OVERLAY_ID;
		exports.PANEL_ID = PANEL_ID;
		exports.ROW_ACTION_ID = ROW_ACTION_ID;
		exports.SETTINGS_TAB_ID = SETTINGS_TAB_ID;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map