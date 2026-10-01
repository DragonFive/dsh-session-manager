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
		//#endregion
		//#region src/client/annotate-dialog.jsx
		/**
		* The annotation dialog: category (tree), tags (multi + create), status,
		* priority, notes. Opened from the session row menu item and the hover icon.
		*
		* Uses the platform-baseline `Modal` primitive (body-portaled, Escape and
		* mask handling included) so the dialog matches official chrome without
		* touching any official stylesheet.
		*/
		const EMPTY = {
			category: void 0,
			tags: [],
			status: "todo",
			priority: "normal",
			notes: ""
		};
		function AnnotateDialog({ open, onClose, sessionId, displayTitle, onSaved, t }) {
			const [draft, setDraft] = (0, react.useState)(EMPTY);
			const [newTag, setNewTag] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const [taxonomy, setTaxonomy] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (!open || !sessionId) return;
				let cancelled = false;
				setError("");
				setDraft(EMPTY);
				setNewTag("");
				setTaxonomy(null);
				fetchAnnotations().then((store) => {
					if (cancelled) return;
					setTaxonomy(store?.taxonomy ?? null);
					const existing = store?.sessions?.[sessionId];
					setDraft(existing ? {
						category: existing.category,
						tags: [...existing.tags ?? []],
						status: existing.status ?? "todo",
						priority: existing.priority ?? "normal",
						notes: existing.notes ?? ""
					} : EMPTY);
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
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsm-dialog-label",
								children: t("category")
							}), categories.map((node) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
							}, node.id))]
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
		function BoardPanel({ t, openSession }) {
			const [data, setData] = (0, react.useState)(null);
			const [phase, setPhase] = (0, react.useState)("loading");
			const [errorMsg, setErrorMsg] = (0, react.useState)("");
			const [viewMode, setViewMode] = (0, react.useState)("groups");
			const [groupBy, setGroupBy] = (0, react.useState)("category");
			const [sortDesc, setSortDesc] = (0, react.useState)(true);
			const [showFilters, setShowFilters] = (0, react.useState)(false);
			const [filters, setFilters] = (0, react.useState)(emptyFilters);
			const load = (0, react.useCallback)(async () => {
				setPhase("loading");
				setErrorMsg("");
				try {
					const board = await fetchBoard();
					setData(board);
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
				if (!(filters.categories.size > 0 || filters.statuses.size > 0 || filters.priorities.size > 0 || filters.tags.size > 0 || filters.unannotatedOnly)) return sessions;
				return sessions.filter((session) => {
					const annotation = session.annotation;
					if (filters.unannotatedOnly && annotation !== null) return false;
					if (filters.categories.size > 0 && !filters.categories.has(annotation?.category ?? UNANNOTATED_KEY)) return false;
					if (filters.statuses.size > 0 && !filters.statuses.has(annotation?.status ?? UNANNOTATED_KEY)) return false;
					if (filters.priorities.size > 0 && !filters.priorities.has(annotation?.priority ?? UNANNOTATED_KEY)) return false;
					if (filters.tags.size > 0) {
						const tags = annotation?.tags ?? [];
						if (![...filters.tags].some((tag) => tags.includes(tag))) return false;
					}
					return true;
				});
			}, [data, filters]);
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
							maps,
							t,
							onOpen: openSessionById,
							onQuickPatch: quickPatch
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GroupView, {
							sessions: sorted,
							groupBy,
							taxonomy,
							maps,
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
		function GroupView({ sessions, groupBy, taxonomy, maps, t, onOpen, onQuickPatch }) {
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
					else if (groupBy === "status") push(annotation?.status ?? UNANNOTATED_KEY, session);
					else push(annotation?.priority ?? UNANNOTATED_KEY, session);
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
					maps,
					t,
					onOpen,
					onQuickPatch
				}, session.sessionId))]
			}, group.key));
		}
		function QuadrantView({ sessions, maps, t, onOpen, onQuickPatch }) {
			const { quadrants, unannotated } = (0, react.useMemo)(() => {
				const quadrants = {
					urgentImportant: [],
					importantNotUrgent: [],
					urgentNotImportant: [],
					neither: []
				};
				const unannotated = [];
				for (const session of sessions) {
					const annotation = session.annotation;
					if (annotation === null) {
						unannotated.push(session);
						continue;
					}
					const urgent = annotation.priority === "urgent" || session.running;
					const important = annotation.priority === "urgent" || annotation.priority === "important";
					if (urgent && important) quadrants.urgentImportant.push(session);
					else if (important) quadrants.importantNotUrgent.push(session);
					else if (urgent) quadrants.urgentNotImportant.push(session);
					else quadrants.neither.push(session);
				}
				return {
					quadrants,
					unannotated
				};
			}, [sessions]);
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [unannotated.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsm-group",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsm-group-head",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-group-title",
						children: t("unclassified")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsm-group-count",
						children: unannotated.length
					})]
				}), unannotated.map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BoardRow, {
					session,
					maps,
					t,
					onOpen
				}, session.sessionId))]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
						maps,
						t,
						onOpen,
						onQuickPatch
					}, session.sessionId))]
				}, cell.id))
			})] });
		}
		function BoardRow({ session, maps, t, onOpen, onQuickPatch }) {
			const annotation = session.annotation;
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
							annotation !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								annotation.category !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-badge",
									children: maps.categories.get(annotation.category) ?? annotation.category
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-badge",
									"data-kind": annotation.status,
									children: maps.statuses.get(annotation.status) ?? annotation.status
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-badge",
									"data-kind": annotation.priority,
									children: maps.priorities.get(annotation.priority) ?? annotation.priority
								}),
								(annotation.tags ?? []).slice(0, 3).map((tag) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dsm-badge",
									children: tag
								}, tag)),
								(annotation.tags ?? []).length > 3 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dsm-badge",
									children: ["+", (annotation.tags ?? []).length - 3]
								})
							] })
						]
					}),
					annotation !== null && onQuickPatch && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsm-quick",
						onClick: (event) => event.stopPropagation(),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuickDropdown, {
							kind: "status",
							value: annotation.status,
							options: [...maps.statuses.entries()].map(([id, label]) => ({
								id,
								label
							})),
							onPick: (id) => onQuickPatch(session, { status: id })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuickDropdown, {
							kind: "priority",
							value: annotation.priority,
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
		//#region src/client/locales.js
		/**
		* Client dictionaries. Chinese is the primary UX language (parent PRD R5.1);
		* English keeps the required fallback.
		*/
		const NS = "dsh-session-manager";
		const zh = {
			panelTitle: "会话看板",
			annotate: "标注…",
			annotateIconLabel: "标注",
			annotateTitle: "会话标注",
			category: "分类",
			tags: "标签",
			tagPlaceholder: "输入新标签，回车添加",
			status: "状态",
			priority: "优先级",
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
			annotate: "Annotate…",
			annotateIconLabel: "Annotate",
			annotateTitle: "Annotate Session",
			category: "Category",
			tags: "Tags",
			tagPlaceholder: "Type a new tag, press Enter",
			status: "Status",
			priority: "Priority",
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
.dsm-texport{padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,#2a2a2e);display:flex;flex-direction:column;gap:8px}
.dsm-texport-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsm-texport-label{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary,#8f8f96);width:60px}
.dsm-texport-input{flex:1;min-width:220px;height:30px;font-size:12px}
.dsm-tmeta{font-size:12px;color:var(--dsw-alias-label-secondary,#c6c6cc);word-break:break-all}
.dsm-tmsg-ok{font-size:12px;color:var(--dsw-alias-state-success-primary,#46a758);word-break:break-all}
`;
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
		function TrellisPanel({ t }) {
			const [data, setData] = (0, react.useState)(null);
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
					const value = await fetchTrellis();
					setData(value);
					setPhase("ready");
				} catch (reason) {
					setErrorMsg(reason instanceof Error ? reason.message : String(reason));
					setPhase("error");
				}
			}, []);
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
							t
						}, workspace.path))
					})
				]
			});
		}
		function WorkspaceSection({ workspace, statusFilter, expanded, onToggle, showStandalone, onToggleStandalone, t }) {
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
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsm-row-badges",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dsm-badge",
										"data-kind": statusBadgeKind(task.status),
										children: statusLabel(task.status)
									})
								})]
							}, task.dir))
						})]
					})
				]
			});
		}
		function ParentCard({ root, expanded, onToggle, t }) {
			const percent = root.totalCount === 0 ? 0 : Math.round(root.completedCount / root.totalCount * 100);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsm-tcard",
				"data-open": expanded,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
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
				}), expanded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsm-tcard-body",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
						className: "dsm-ttable",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("trellisColSubtask") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("status") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("trellisColBranch") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: "PR" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("trellisColCompletedAt") })
						] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: root.children.map((child) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChildRow, {
							child,
							depth: 1
						}, child.dir)) })]
					})
				})]
			});
		}
		function ChildRow({ child, depth }) {
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
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: child.completedAt ?? "—" })
			] }), child.children.map((grandchild) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChildRow, {
				child: grandchild,
				depth: depth + 1
			}, grandchild.dir))] });
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
		//#region src/client/index.jsx
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
		const PANEL_ID = "dsm-board";
		const TRELLIS_PANEL_ID = "dsm-trellis";
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
			}, BoardPanel));
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 500,
				label: () => ctx.locale.bind(NS)("panelTitle"),
				locale: NS
			}, BoardPanelIcon));
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: TRELLIS_PANEL_ID,
				locale: NS
			}, TrellisPanel));
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: TRELLIS_PANEL_ID,
				order: 600,
				label: () => ctx.locale.bind(NS)("trellisPanelTitle"),
				locale: NS
			}, TrellisPanelIcon));
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
		/** Trellis board glyph (branch icon — the task tree metaphor). */
		function TrellisPanelIcon({ size }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, { size });
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
		exports.TRELLIS_PANEL_ID = TRELLIS_PANEL_ID;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map