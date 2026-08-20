window.__ModuleLoader__.load({
  id: "dsh-task-orchestrator",
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/client-api.js
const TASK_API_PREFIX = "/api/task-orchestrator";
const BOARD_STATUSES = Object.freeze([
	"backlog",
	"planning",
	"ready",
	"claimed",
	"running",
	"in_review",
	"changes_requested",
	"blocked",
	"failed",
	"done",
	"cancelled"
]);
async function responseJson(response) {
	let body;
	try {
		body = await response.json();
	} catch {
		body = { error: "task orchestrator returned invalid JSON" };
	}
	if (!response.ok) {
		const error = new Error(body?.error ?? "task orchestrator request failed: " + response.status);
		error.status = response.status;
		error.code = body?.code;
		throw error;
	}
	return body;
}
function queryString(options = {}) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(options)) {
		if (value === void 0 || value === null || value === "") continue;
		if (Array.isArray(value)) params.set(key, value.join(","));
		else params.set(key, String(value));
	}
	const encoded = params.toString();
	return encoded === "" ? "" : "?" + encoded;
}
var TaskOrchestratorClient = class {
	constructor(fetcher = globalThis.fetch?.bind(globalThis), prefix = TASK_API_PREFIX) {
		if (typeof fetcher !== "function") throw new Error("fetch is unavailable");
		this.fetcher = fetcher;
		this.prefix = prefix.replace(/\/+$/, "");
	}
	async request(path, init = {}) {
		return await responseJson(await this.fetcher(this.prefix + path, {
			cache: "no-store",
			...init,
			headers: {
				accept: "application/json",
				...init.headers ?? {}
			}
		}));
	}
	async list(options = {}) {
		const query = { ...options };
		if (query.statuses !== void 0 && query.status === void 0) {
			query.status = query.statuses;
			delete query.statuses;
		}
		return (await this.request("/tasks" + queryString(query))).tasks ?? [];
	}
	async get(id) {
		return (await this.request("/tasks/" + encodeURIComponent(id))).task;
	}
	async create(task) {
		return (await this.request("/tasks", {
			method: "POST",
			body: JSON.stringify(task),
			headers: { "content-type": "application/json" }
		})).task;
	}
	async update(id, patch) {
		return (await this.request("/tasks/" + encodeURIComponent(id), {
			method: "PATCH",
			body: JSON.stringify(patch),
			headers: { "content-type": "application/json" }
		})).task;
	}
	async action(id, action, payload = {}) {
		const result = await this.request("/tasks/" + encodeURIComponent(id) + "/" + action, {
			method: "POST",
			body: JSON.stringify(payload),
			headers: { "content-type": "application/json" }
		});
		return result.task ?? result;
	}
	async claim(id, worker, leaseSeconds) {
		return await this.action(id, "claim", {
			worker,
			...leaseSeconds === void 0 ? {} : { lease_seconds: leaseSeconds }
		});
	}
	async release(id, worker) {
		return await this.action(id, "release", { worker });
	}
	async renewLease(id, worker, leaseSeconds) {
		return await this.action(id, "renew-lease", {
			worker,
			...leaseSeconds === void 0 ? {} : { lease_seconds: leaseSeconds }
		});
	}
	async start(id, worker) {
		return await this.action(id, "start", { worker });
	}
	async complete(id, worker, result = {}) {
		return await this.action(id, "complete", {
			worker,
			...result
		});
	}
	async fail(id, worker, result = {}) {
		return await this.action(id, "fail", {
			worker,
			...result
		});
	}
	async block(id, reason, worker) {
		return await this.action(id, "block", {
			reason,
			...worker === void 0 ? {} : { worker }
		});
	}
	async unblock(id) {
		return await this.action(id, "unblock");
	}
	async requestChanges(id, reason) {
		return await this.action(id, "request-changes", { reason });
	}
	async children(id, descendants = false) {
		return (await this.request("/tasks/" + encodeURIComponent(id) + "/children" + queryString({ descendants: descendants ? "true" : void 0 }))).tasks ?? [];
	}
	async events(id, limit = 100) {
		return (await this.request("/tasks/" + encodeURIComponent(id) + "/events" + queryString({ limit }))).events ?? [];
	}
	async addDependency(id, dependsOn) {
		return await this.request("/tasks/" + encodeURIComponent(id) + "/dependencies", {
			method: "POST",
			body: JSON.stringify({ depends_on_task_id: dependsOn }),
			headers: { "content-type": "application/json" }
		});
	}
	async removeDependency(id, dependsOn) {
		return await this.request("/tasks/" + encodeURIComponent(id) + "/dependencies" + queryString({ depends_on_task_id: dependsOn }), { method: "DELETE" });
	}
};
//#endregion
//#region src/client.js
const name = "task-orchestrator-board";
const inject = [];
const STATUS_LABELS = {
	backlog: "Backlog",
	planning: "Planning",
	ready: "Ready",
	claimed: "Claimed",
	running: "Running",
	in_review: "In review",
	changes_requested: "Changes requested",
	blocked: "Blocked",
	failed: "Failed",
	done: "Done",
	cancelled: "Cancelled"
};
const CSS = [
	".dsh-to-launcher,.dsh-to-panel{font-family:var(--ds-font-family-sans,Inter,system-ui,sans-serif)}",
	".dsh-to-launcher{position:fixed;z-index:10050;left:18px;bottom:18px;border:1px solid var(--dsw-alias-border-l2,#3b3e46);border-radius:18px;background:var(--dsw-alias-bg-layer-2,#25272d);color:var(--dsw-alias-label-primary,#f5f6f7);box-shadow:0 4px 18px #0005;cursor:pointer;padding:7px 13px;font:inherit;font-size:12px}",
	".dsh-to-launcher:hover{background:var(--dsw-alias-interactive-bg-hover,#343740)}",
	".dsh-to-panel{position:fixed;z-index:10040;left:16px;bottom:60px;width:min(1180px,calc(100vw - 32px));height:min(760px,calc(100vh - 92px));display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,#3b3e46);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#1c1e23);color:var(--dsw-alias-label-primary,#f5f6f7);box-shadow:0 12px 44px #0008}",
	".dsh-to-hidden{display:none!important}",
	".dsh-to-header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,#3b3e46);background:var(--dsw-alias-bg-layer-2,#24262c)}",
	".dsh-to-title{font-size:15px;font-weight:650;margin-right:auto}",
	".dsh-to-button{border:1px solid var(--dsw-alias-border-l2,#3b3e46);border-radius:7px;background:transparent;color:inherit;cursor:pointer;padding:5px 9px;font:inherit;font-size:12px}",
	".dsh-to-button:hover{background:var(--dsw-alias-interactive-bg-hover,#343740)}",
	".dsh-to-button-primary{background:var(--dsw-alias-button-primary-fill,#3975e8);border-color:transparent;color:#fff}",
	".dsh-to-button-danger{color:var(--dsw-alias-state-error-primary,#f27777)}",
	".dsh-to-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:7px;padding:9px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#3b3e46)}",
	".dsh-to-input,.dsh-to-select,.dsh-to-textarea{box-sizing:border-box;min-height:30px;border:1px solid var(--dsw-alias-border-l2,#3b3e46);border-radius:6px;background:var(--dsw-alias-bg-layer-2,#25272d);color:inherit;padding:5px 8px;font:inherit;font-size:12px}",
	".dsh-to-input:focus,.dsh-to-select:focus,.dsh-to-textarea:focus{border-color:var(--dsw-alias-brand-primary,#668cf3);outline:none}",
	".dsh-to-input-small{width:120px}.dsh-to-select{min-width:125px}",
	".dsh-to-notice{min-height:18px;color:var(--dsw-alias-label-tertiary,#a5a8b0);font-size:11px;padding:4px 13px}",
	".dsh-to-notice-error{color:var(--dsw-alias-state-error-primary,#f27777)}",
	".dsh-to-content{display:flex;min-height:0;flex:1}",
	".dsh-to-board{display:flex;gap:9px;min-width:0;flex:1;overflow:auto;padding:10px}",
	".dsh-to-column{display:flex;flex:0 0 166px;flex-direction:column;min-height:100%;border:1px solid var(--dsw-alias-border-l2,#363941);border-radius:9px;background:var(--dsw-alias-bg-layer-2,#23252b)}",
	".dsh-to-column-header{display:flex;align-items:center;gap:6px;padding:8px 9px;border-bottom:1px solid var(--dsw-alias-border-l2,#363941);font-size:11px;font-weight:650}",
	".dsh-to-count{margin-left:auto;color:var(--dsw-alias-label-tertiary,#9ea1ab);font-weight:500}",
	".dsh-to-column-cards{display:flex;flex-direction:column;gap:7px;min-height:45px;padding:7px}",
	".dsh-to-card{border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:7px;background:var(--dsw-alias-bg-layer-1,#1e2025);cursor:pointer;padding:8px}",
	".dsh-to-card:hover,.dsh-to-card-selected{border-color:var(--dsw-alias-brand-primary,#668cf3)}",
	".dsh-to-card-title{font-size:12px;font-weight:600;line-height:17px;overflow-wrap:anywhere}",
	".dsh-to-card-meta{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;color:var(--dsw-alias-label-tertiary,#a5a8b0);font-size:10px}",
	".dsh-to-badge{border-radius:4px;background:var(--dsw-alias-bg-module-platform,#30323a);padding:2px 4px}",
	".dsh-to-badge-warn{color:var(--dsw-alias-state-warn-label,#e9bd66)}",
	".dsh-to-card-actions{display:flex;gap:4px;margin-top:7px}",
	".dsh-to-card-actions .dsh-to-button{padding:3px 5px;font-size:10px}",
	".dsh-to-detail{display:flex;flex:0 0 315px;flex-direction:column;gap:9px;overflow:auto;border-left:1px solid var(--dsw-alias-border-l2,#3b3e46);padding:12px}",
	".dsh-to-detail h3{font-size:14px;margin:0;overflow-wrap:anywhere}.dsh-to-detail h4{font-size:11px;color:var(--dsw-alias-label-secondary,#c2c4ca);margin:6px 0 2px}",
	".dsh-to-muted{color:var(--dsw-alias-label-tertiary,#a5a8b0);font-size:11px;line-height:16px}",
	".dsh-to-list{margin:0;padding-left:17px;color:var(--dsw-alias-label-secondary,#c2c4ca);font-size:11px;line-height:17px}",
	".dsh-to-form{display:flex;flex-direction:column;gap:7px}.dsh-to-form-row{display:flex;gap:6px}.dsh-to-form-row>*{flex:1;min-width:0}",
	".dsh-to-section{border-top:1px solid var(--dsw-alias-border-l2,#3b3e46);padding-top:7px}",
	".dsh-to-event{padding:4px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#30323a);font-size:10px}.dsh-to-event strong{color:var(--dsw-alias-label-primary,#f5f6f7)}",
	"@media(max-width:800px){.dsh-to-detail{flex-basis:270px}.dsh-to-column{flex-basis:150px}}"
].join("\n");
function node(tag, props = {}, children = []) {
	const value = document.createElement(tag);
	for (const [key, prop] of Object.entries(props)) if (key === "className") value.className = prop;
	else if (key === "text") value.textContent = prop;
	else if (key.startsWith("on")) value.addEventListener(key.slice(2).toLowerCase(), prop);
	else if (key === "value") value.value = prop;
	else value.setAttribute(key, prop);
	for (const child of children) value.append(child instanceof Node ? child : document.createTextNode(String(child)));
	return value;
}
function clear(value) {
	while (value.firstChild) value.removeChild(value.firstChild);
}
function button(label, handler, className = "dsh-to-button") {
	return node("button", {
		type: "button",
		className,
		text: label,
		onClick: handler
	});
}
function field(label, input) {
	return node("label", { className: "dsh-to-form" }, [node("span", {
		className: "dsh-to-muted",
		text: label
	}), input]);
}
function statusSelect(value, onChange) {
	const select = node("select", {
		className: "dsh-to-select",
		onChange: (event) => onChange(event.target.value)
	});
	for (const status of BOARD_STATUSES) select.append(node("option", {
		value: status,
		text: STATUS_LABELS[status]
	}));
	select.value = value;
	return select;
}
var TaskBoardView = class {
	constructor(client = new TaskOrchestratorClient()) {
		this.client = client;
		this.tasks = [];
		this.selectedId = void 0;
		this.open = false;
		this.disposers = [];
		this.filterStatus = "";
		this.filterProfile = "";
		this.worker = "board-worker";
		this.notice = "";
		this.noticeError = false;
	}
	mount() {
		if (typeof document === "undefined" || document.querySelector("[data-dsh-task-orchestrator-board]") !== null) return () => {};
		const style = node("style", { "data-dsh-task-orchestrator-style": "" }, [CSS]);
		document.head.append(style);
		this.launcher = node("button", {
			type: "button",
			className: "dsh-to-launcher",
			text: "Tasks",
			"aria-label": "Open task orchestrator board",
			onClick: () => this.toggle()
		});
		this.panel = node("section", {
			className: "dsh-to-panel dsh-to-hidden",
			"data-dsh-task-orchestrator-board": "",
			"aria-label": "Task orchestrator board"
		});
		this.buildShell();
		document.body.append(this.launcher, this.panel);
		this.disposers.push(() => style.remove(), () => this.launcher.remove(), () => this.panel.remove());
		this.refresh();
		return () => {
			for (const dispose of this.disposers.splice(0)) dispose();
		};
	}
	buildShell() {
		this.header = node("header", { className: "dsh-to-header" }, [
			node("div", {
				className: "dsh-to-title",
				text: "Task Orchestrator"
			}),
			button("Refresh", () => this.refresh()),
			button("New task", () => this.showCreate()),
			button("×", () => this.toggle(), "dsh-to-button dsh-to-button-danger")
		]);
		this.statusFilter = node("select", {
			className: "dsh-to-select",
			onChange: (event) => {
				this.filterStatus = event.target.value;
				this.renderBoard();
			}
		});
		this.statusFilter.append(node("option", {
			value: "",
			text: "All statuses"
		}));
		for (const status of BOARD_STATUSES) this.statusFilter.append(node("option", {
			value: status,
			text: STATUS_LABELS[status]
		}));
		this.profileFilter = node("input", {
			className: "dsh-to-input dsh-to-input-small",
			placeholder: "worker profile",
			onInput: (event) => {
				this.filterProfile = event.target.value;
				this.renderBoard();
			}
		});
		this.workerInput = node("input", {
			className: "dsh-to-input dsh-to-input-small",
			value: this.worker,
			placeholder: "worker id",
			onInput: (event) => {
				this.worker = event.target.value || "board-worker";
			}
		});
		this.toolbar = node("div", { className: "dsh-to-toolbar" }, [
			node("span", {
				className: "dsh-to-muted",
				text: "Filter"
			}),
			this.statusFilter,
			this.profileFilter,
			node("span", {
				className: "dsh-to-muted",
				text: "Worker"
			}),
			this.workerInput
		]);
		this.noticeNode = node("div", { className: "dsh-to-notice" });
		this.board = node("div", { className: "dsh-to-board" });
		this.detail = node("aside", { className: "dsh-to-detail" });
		this.content = node("div", { className: "dsh-to-content" }, [this.board, this.detail]);
		this.panel.append(this.header, this.toolbar, this.noticeNode, this.content);
		this.renderDetail();
	}
	toggle() {
		this.open = !this.open;
		this.panel?.classList.toggle("dsh-to-hidden", !this.open);
		if (this.open) this.refresh();
	}
	async refresh() {
		try {
			this.setNotice("Loading…");
			this.tasks = await this.client.list({ limit: 500 });
			if (this.selectedId !== void 0 && !this.tasks.some((task) => task.id === this.selectedId)) this.selectedId = void 0;
			this.renderBoard();
			this.renderDetail();
			this.setNotice(this.tasks.length + " tasks");
		} catch (error) {
			this.setNotice(error instanceof Error ? error.message : String(error), true);
		}
	}
	setNotice(message, error = false) {
		if (this.noticeNode) {
			this.noticeNode.textContent = message;
			this.noticeNode.classList.toggle("dsh-to-notice-error", error);
		}
	}
	task(id) {
		return this.tasks.find((task) => task.id === id);
	}
	visibleTasks() {
		return this.tasks.filter((task) => (this.filterStatus === "" || task.status === this.filterStatus) && (this.filterProfile === "" || task.worker_profile === this.filterProfile));
	}
	renderBoard() {
		if (!this.board) return;
		clear(this.board);
		for (const status of BOARD_STATUSES) {
			const tasks = this.visibleTasks().filter((task) => task.status === status);
			const cards = node("div", { className: "dsh-to-column-cards" });
			for (const task of tasks) cards.append(this.renderCard(task));
			this.board.append(node("section", { className: "dsh-to-column" }, [node("div", { className: "dsh-to-column-header" }, [STATUS_LABELS[status], node("span", {
				className: "dsh-to-count",
				text: String(tasks.length)
			})]), cards]));
		}
	}
	renderCard(task) {
		const card = node("article", {
			className: "dsh-to-card" + (task.id === this.selectedId ? " dsh-to-card-selected" : ""),
			onClick: () => {
				this.selectedId = task.id;
				this.renderBoard();
				this.renderDetail();
			}
		});
		const meta = [];
		if (task.priority && task.priority !== "normal") meta.push(task.priority);
		if (task.worker_profile) meta.push(task.worker_profile);
		if (task.blocked_by?.length) meta.push("blocked: " + task.blocked_by.length);
		card.append(node("div", {
			className: "dsh-to-card-title",
			text: task.title
		}), node("div", {
			className: "dsh-to-muted",
			text: task.id
		}), node("div", { className: "dsh-to-card-meta" }, meta.map((value) => node("span", {
			className: "dsh-to-badge" + (value.startsWith("blocked") ? " dsh-to-badge-warn" : ""),
			text: value
		}))));
		const actions = node("div", { className: "dsh-to-card-actions" });
		if (task.status === "ready" && !task.blocked_by?.length) actions.append(button("Claim", () => this.run(() => this.client.claim(task.id, this.worker))));
		if (task.status === "claimed" && task.claimed_by === this.worker) actions.append(button("Start", () => this.run(() => this.client.start(task.id, this.worker))));
		if (task.status === "running" && task.claimed_by === this.worker) actions.append(button("Complete", () => {
			this.selectedId = task.id;
			this.renderDetail();
		}));
		if (task.status === "blocked") actions.append(button("Unblock", () => this.run(() => this.client.unblock(task.id))));
		if (task.status === "in_review") actions.append(button("Done", () => this.run(() => this.client.update(task.id, { status: "done" }), task.id)));
		if (actions.childElementCount) card.append(actions);
		return card;
	}
	renderDetail() {
		if (!this.detail) return;
		clear(this.detail);
		const task = this.selectedId === void 0 ? void 0 : this.task(this.selectedId);
		if (task === void 0) {
			this.detail.append(node("div", {
				className: "dsh-to-muted",
				text: "Select a task to inspect it, or create a new task."
			}));
			return;
		}
		this.detail.append(node("h3", { text: task.title }), node("div", {
			className: "dsh-to-muted",
			text: task.id + " · " + STATUS_LABELS[task.status]
		}), node("p", {
			className: "dsh-to-muted",
			text: task.description || "No description."
		}));
		this.detail.append(node("div", { className: "dsh-to-form-row" }, [statusSelect(task.status, (value) => this.run(() => this.client.update(task.id, { status: value }), task.id)), button("Reload", () => this.refresh())]));
		this.detail.append(node("section", { className: "dsh-to-section" }, [node("h4", { text: "Acceptance criteria" }), task.acceptance_criteria?.length ? node("ul", { className: "dsh-to-list" }, task.acceptance_criteria.map((value) => node("li", { text: value }))) : node("div", {
			className: "dsh-to-muted",
			text: "None recorded."
		})]));
		const controls = node("div", { className: "dsh-to-form-row" });
		if (task.status === "ready" && task.ready_to_run) controls.append(button("Claim", () => this.run(() => this.client.claim(task.id, this.worker), task.id)));
		if (task.status === "claimed" && task.claimed_by === this.worker) controls.append(button("Start", () => this.run(() => this.client.start(task.id, this.worker), task.id)), button("Release", () => this.run(() => this.client.release(task.id, this.worker), task.id)));
		if (task.status === "running" && task.claimed_by === this.worker) controls.append(button("Renew lease", () => this.run(() => this.client.renewLease(task.id, this.worker), task.id)));
		if (task.status === "in_review") controls.append(button("Mark done", () => this.run(() => this.client.update(task.id, { status: "done" }), task.id)), button("Request changes", () => this.requestChanges(task)));
		if (task.status === "blocked") controls.append(button("Unblock", () => this.run(() => this.client.unblock(task.id), task.id)));
		if (controls.childElementCount) this.detail.append(controls);
		if (task.status === "running" && task.claimed_by === this.worker) this.appendCompletionForm(task);
		this.appendDependencies(task);
		this.appendEvents(task);
	}
	appendCompletionForm(task) {
		const summary = node("textarea", {
			className: "dsh-to-textarea",
			rows: "3",
			placeholder: "Result summary"
		});
		const commit = node("input", {
			className: "dsh-to-input",
			placeholder: "Commit SHA (optional)"
		});
		const tests = node("textarea", {
			className: "dsh-to-textarea",
			rows: "2",
			placeholder: "Tests run, one per line"
		});
		const form = node("form", {
			className: "dsh-to-form dsh-to-section",
			onSubmit: (event) => {
				event.preventDefault();
				this.run(() => this.client.complete(task.id, this.worker, {
					result_summary: summary.value,
					commit_sha: commit.value || void 0,
					tests_run: tests.value.split("\\n").map((value) => value.trim()).filter(Boolean)
				}), task.id);
			}
		}, [
			node("h4", { text: "Structured completion" }),
			summary,
			commit,
			tests,
			node("button", {
				type: "submit",
				className: "dsh-to-button dsh-to-button-primary",
				text: "Complete → review"
			})
		]);
		this.detail.append(form);
	}
	appendDependencies(task) {
		const dependencyInput = node("input", {
			className: "dsh-to-input",
			placeholder: "Task ID to add as dependency"
		});
		const form = node("form", {
			className: "dsh-to-form dsh-to-section",
			onSubmit: (event) => {
				event.preventDefault();
				if (dependencyInput.value) this.run(() => this.client.addDependency(task.id, dependencyInput.value), task.id);
			}
		}, [
			node("h4", { text: "Dependencies" }),
			node("div", {
				className: "dsh-to-muted",
				text: task.blocked_by?.length ? "Blocked by: " + task.blocked_by.join(", ") : "No unfinished blockers."
			}),
			node("div", { className: "dsh-to-form-row" }, [dependencyInput, node("button", {
				type: "submit",
				className: "dsh-to-button",
				text: "Add"
			})])
		]);
		this.detail.append(form);
	}
	async appendEvents(task) {
		try {
			const events = await this.client.events(task.id, 12);
			const list = node("div", { className: "dsh-to-section" }, [node("h4", { text: "Recent events" })]);
			for (const event of events) list.append(node("div", { className: "dsh-to-event" }, [node("strong", { text: event.event_type }), " · " + (event.actor || "system")]));
			this.detail.append(list);
		} catch {}
	}
	showCreate() {
		this.selectedId = void 0;
		clear(this.detail);
		const title = node("input", {
			className: "dsh-to-input",
			placeholder: "Task title",
			required: "true"
		});
		const description = node("textarea", {
			className: "dsh-to-textarea",
			rows: "4",
			placeholder: "Description"
		});
		const profile = node("input", {
			className: "dsh-to-input",
			placeholder: "Worker profile (optional)"
		});
		const criteria = node("textarea", {
			className: "dsh-to-textarea",
			rows: "4",
			placeholder: "Acceptance criteria, one per line"
		});
		const status = statusSelect("backlog", () => {});
		const form = node("form", {
			className: "dsh-to-form",
			onSubmit: (event) => {
				event.preventDefault();
				this.run(async () => {
					const task = await this.client.create({
						title: title.value,
						description: description.value,
						status: status.value,
						worker_profile: profile.value || void 0,
						acceptance_criteria: criteria.value.split("\\n").map((value) => value.trim()).filter(Boolean)
					});
					this.selectedId = task.id;
					return task;
				}, void 0, true);
			}
		}, [
			node("h3", { text: "New task" }),
			field("Title", title),
			field("Description", description),
			field("Initial status", status),
			field("Worker profile", profile),
			field("Acceptance criteria", criteria),
			node("button", {
				type: "submit",
				className: "dsh-to-button dsh-to-button-primary",
				text: "Create task"
			})
		]);
		this.detail.append(form);
	}
	requestChanges(task) {
		const reason = globalThis.prompt?.("What needs changing?", "Please address the review notes.");
		if (reason) this.run(() => this.client.requestChanges(task.id, reason), task.id);
	}
	async run(operation, selectedId = this.selectedId, keepDetail = false) {
		try {
			this.setNotice("Saving…");
			await operation();
			if (selectedId !== void 0) this.selectedId = selectedId;
			await this.refresh();
			if (keepDetail) this.renderDetail();
		} catch (error) {
			this.setNotice(error instanceof Error ? error.message : String(error), true);
		}
	}
};
function apply(ctx) {
	const view = new TaskBoardView();
	ctx.effect(() => view.mount(), "task-orchestrator-board: browser UI");
}
//#endregion
exports.TaskBoardView = TaskBoardView;
exports.apply = apply;
exports.inject = inject;
exports.name = name;

    return module.exports
  },
})