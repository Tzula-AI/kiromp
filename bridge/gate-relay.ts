/**
 * omp ↔ Kiro Crew bridge tool-gate relay.
 *
 * Kiro Crew launches `pi --extension <crew>/kiro_crew_tool_gate.ts`. The gate's
 * `tool_call` handler asks Crew for permission through `ctx.ui.confirm`, which
 * omp's RPC mode forwards to pi-acp → Crew. When there is no dialog channel
 * (`!ctx.hasUI`) the gate refuses the call.
 *
 * omp re-runs the parent's CLI extensions for every in-process `task` subagent,
 * but with `hasUI: false`, so the stock gate refused every subagent tool call.
 * pi-shim therefore loads this file in the gate's place (the real gate path is
 * in $KIROCREW_OMP_GATE_TARGET); it runs the real gate factory against a wrapped
 * `pi` whose `tool_call` handlers receive the PARENT RPC session's UI when the
 * session itself has none. Crew still prompts for each subagent tool call
 * exactly like a parent one, and the real gate still builds and checks the
 * envelope.
 *
 * Fail-closed: a missing/invalid target throws (the extension fails to load and
 * Crew's gate read-back fails closed); with no parent UI recorded the ctx is
 * passed through untouched so the gate still blocks. This file never weakens
 * the gate — it only supplies a dialog channel.
 *
 * It also hands the gate an `edit`'s hashline paths the way omp resolves them.
 * omp's `read` prints files under $HOME outside the cwd as `[~/path#TAG]`, so a
 * model copies `~/…` into its edit headers; omp expands a leading `~`/`~/` with
 * os.homedir() (path-utils `expandTilde`), but Crew's gate refuses any header
 * that is not absolute as written, so every such edit was denied. The gate is
 * shown a copy whose `~`/`~/` header, `MV` and `path`/`paths` values carry this
 * process's home — the exact file omp writes — and judges it with its full
 * policy. Execution input is left untouched (omp expands it identically). Any
 * other non-absolute spelling (`~user`, quoted, relative) is passed as is, so
 * the gate still refuses it.
 *
 * An `edit` whose hashline header carries a placeholder tag (`[path#?]`,
 * `#AUTO`, `#TAG`, `#????`, `#`) is refused here with omp's own guidance and
 * never reaches the gate. omp never executes such an edit: a header's tag must
 * equal the file's 4-hex content hash, so it rejects it ("Input header must be
 * [PATH] or [PATH#TAG] with a 4-hex content-hash tag" / "the header needs this
 * file's current tag"). Crew's gate only recognizes `[PATH#XXXX]` headers, so it
 * judged the same call as an edit naming no target and denied it as a security
 * block, which fails a cron run over a model typo and hides omp's fix-it hint.
 * This only refuses: the gate still judges every edit omp could execute.
 *
 * And it answers the gate's MCP registration, which omp's ExtensionAPI lacks. Crew
 * seals the servers it put in the session's `mcpServers` array into a handoff the
 * gate registers with `pi.registerMcpServer`, then re-reads with `pi.getMcpServers()`;
 * any name that fails either step is "shadowed" and the gate refuses its
 * `mcp__<server>__` tools. On omp the call threw, so every Crew server was shadowed.
 * Here the mount is mcp-bridge.ts's: it mounts that same array (captured from
 * session/new by the wrapper) under exactly those `mcp__<server>__<tool>` names, and
 * omp's own MCP config names its tools `mcp__<server>_<tool>`, so it cannot take
 * them. When the real `pi` has no such methods, this file records each registration
 * (a repeated name throws, as pi does for a held name) and reports the records back
 * — the gate's shadow checks still run, and nothing is mounted here.
 *
 * Each omp session imports extension modules fresh, so the parent UI is shared
 * via a globalThis symbol, not module state. Standalone on purpose (node
 * builtins only); the omp types it touches are declared structurally below.
 *
 * Steers are delivered as soon as Crew writes them, not at the next `turn_end`.
 * Crew's gate reads its sealed steer files only from its `turn_end` handler, so a
 * steer sent while omp sat in a long tool call (above all `wait`, blocked on
 * subagents) waited for that call to finish, often many minutes. In the parent
 * session this file watches Crew's steer directory and, when a new steer file
 * lands, calls the gate's own `turn_end` handler at once. The gate still opens,
 * orders and echoes every steer itself (this file never sees the key or the
 * text); the steer just reaches omp's steering queue early, where omp's agent
 * loop cuts an interruptible `wait` short and soft-interrupts other tools, as it
 * does for a steer typed into omp. If omp is idle between runs while it waits on
 * background jobs (its last `agent_end` said `willContinue`), the gate's idle
 * check is answered "not idle" and its steer is sent with `triggerTurn`, so omp
 * starts a run for it instead of leaving it until a job completes.
 */

import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import { pathToFileURL } from "node:url";

type Handler = (event: unknown, ctx: RelayCtx) => unknown;

/** The slice of omp's ExtensionAPI this file uses (the rest passes through). */
interface RelayPi {
	on(event: string, handler: Handler): void;
}

interface RelayCtx {
	hasUI?: boolean;
	ui?: unknown;
	isIdle?: () => boolean;
}

const STEER_STEM_ENV = "KIROCREW_PI_STEER";
const STEER_MESSAGE_TYPE = "kiro-crew-steer";
const STEER_POLL_MS = 300;

interface SendOptions {
	triggerTurn?: boolean;
	deliverAs?: string;
}

function steerFileNames(stemPath: string): string[] {
	const stem = basename(stemPath);
	try {
		return readdirSync(dirname(stemPath)).filter((name) => name.startsWith(stem)).sort();
	} catch {
		return [];
	}
}

function hasField(value: unknown, field: string, expected: unknown): boolean {
	return typeof value === "object" && value !== null && field in value && Reflect.get(value, field) === expected;
}

interface PollTimer {
	unref?(): void;
}

class EarlySteers {
	readonly #stemPath = process.env[STEER_STEM_ENV];
	readonly #gateTurnEnd: Handler[] = [];
	readonly #seen = new Set<string>();
	#parentCtx: RelayCtx | undefined;
	#ompWillContinue = false;
	#triggerTurnForSteer = false;
	#timer: PollTimer | undefined;

	attach(pi: RelayPi): void {
		if (!this.#stemPath) return;
		pi.on("agent_start", (_e, ctx) => {
			this.#ompWillContinue = false;
			this.#trackParent(ctx);
		});
		pi.on("turn_start", (_e, ctx) => this.#trackParent(ctx));
		pi.on("agent_end", (e, ctx) => {
			this.#ompWillContinue = hasField(e, "willContinue", true);
			this.#trackParent(ctx);
		});
	}

	addGateTurnEnd(handler: Handler): void {
		this.#gateTurnEnd.push(handler);
	}

	sendOptions(message: unknown, options: SendOptions | undefined): SendOptions | undefined {
		if (!this.#triggerTurnForSteer || !hasField(message, "customType", STEER_MESSAGE_TYPE)) return options;
		return { ...options, triggerTurn: true };
	}

	poll(): void {
		if (!this.#stemPath) return;
		const names = steerFileNames(this.#stemPath);
		for (const name of this.#seen) if (!names.includes(name)) this.#seen.delete(name);
		for (const name of names) {
			if (this.#seen.has(name)) continue;
			this.#seen.add(name);
			this.#deliverNext();
		}
	}

	#trackParent(ctx: RelayCtx | undefined): void {
		if (!ctx?.hasUI) return;
		this.#parentCtx = ctx;
		if (this.#timer) return;
		const timer: PollTimer = setInterval(() => this.poll(), STEER_POLL_MS);
		timer.unref?.();
		this.#timer = timer;
	}

	#deliverNext(): void {
		const ctx = this.#parentCtx;
		if (!ctx || this.#gateTurnEnd.length === 0) return;
		const idle = ctx.isIdle?.() === true;
		const runIsOver = idle && !this.#ompWillContinue;
		if (runIsOver) return;
		const gateCtx = idle ? Object.create(ctx, { isIdle: { value: () => false } }) : ctx;
		const turnEnd = { type: "turn_end", message: { stopReason: "toolUse" } };
		this.#triggerTurnForSteer = idle;
		try {
			for (const handler of this.#gateTurnEnd) {
				Promise.resolve(handler(turnEnd, gateCtx)).catch(() => {});
			}
		} finally {
			this.#triggerTurnForSteer = false;
		}
	}
}

/** pi's MCP registration surface as Crew's gate uses it; omp has none of it. */
interface McpRegistry {
	registerMcpServer(name: string, config: unknown): void;
	getMcpServers(): { name: string; config: unknown }[];
}

function mcpRegistry(): McpRegistry {
	const servers = new Map<string, unknown>();
	return {
		registerMcpServer(name, config) {
			if (servers.has(name)) throw new Error(`gate-relay: MCP server "${name}" is already registered`);
			servers.set(name, config);
		},
		getMcpServers: () => [...servers].map(([name, config]) => ({ name, config })),
	};
}

const TARGET_ENV = "KIROCREW_OMP_GATE_TARGET";
const PARENT_UI = Symbol.for("omp-kiro-bridge.gate-relay.parentUI");
const store = globalThis as unknown as Record<symbol, unknown>;

function remember(ctx: RelayCtx | undefined): void {
	if (ctx?.hasUI && ctx.ui) store[PARENT_UI] = ctx.ui;
}

/** Give a UI-less (subagent) ctx the parent's UI; otherwise leave it as is. */
function relay(ctx: RelayCtx): RelayCtx {
	if (ctx?.hasUI) {
		remember(ctx);
		return ctx;
	}
	const parentUi = store[PARENT_UI];
	if (!ctx || !parentUi) return ctx;
	// Prototype keeps the original ctx's getters (e.g. `model`) and fields readable.
	return Object.create(ctx, { hasUI: { value: true }, ui: { value: parentUi } });
}

/** A header line of omp's hashline grammar, as Crew's gate parses it. */
const HASHLINE_HEADER = /^\[(.+)#[0-9A-Fa-f]{4}\]$/;

/** `~` / `~/…` → home, exactly as omp's `expandTilde`; anything else is left alone. */
function expandHome(p: string, home: string): string {
	if (p === "~") return home;
	return p.startsWith("~/") ? home + p.slice(1) : p;
}

function anchorHashline(text: string, home: string): string {
	return text
		.split("\n")
		.map((line) => {
			const cr = line.endsWith("\r") ? "\r" : "";
			const body = cr ? line.slice(0, -1) : line;
			const header = HASHLINE_HEADER.exec(body);
			if (header) return `[${expandHome(header[1], home)}${body.slice(1 + header[1].length)}${cr}`;
			if (body.startsWith("MV ")) {
				const dest = body.slice(3).trim();
				const expanded = expandHome(dest, home);
				return expanded === dest ? line : `MV ${expanded}${cr}`;
			}
			return line;
		})
		.join("\n");
}

/** The `edit` event the gate judges: `~` hashline paths anchored to $HOME. */
function anchorEdit(e: unknown): unknown {
	const ev = e as { toolName?: unknown; input?: Record<string, unknown> } | null;
	const input = ev?.input;
	if (ev?.toolName !== "edit" || !input || typeof input.input !== "string") return e;
	const home = homedir();
	const anchored: Record<string, unknown> = { ...input, input: anchorHashline(input.input, home) };
	if (typeof input.path === "string") anchored.path = expandHome(input.path, home);
	if (Array.isArray(input.paths)) {
		anchored.paths = input.paths.map((p) => (typeof p === "string" ? expandHome(p, home) : p));
	}
	return { ...ev, input: anchored };
}

const HASHLINE_TAG = /^[0-9A-Fa-f]{4}$/;

function placeholderTagRefusal(e: unknown): { block: true; reason: string } | null {
	const ev = e as { toolName?: unknown; input?: Record<string, unknown> } | null;
	const text = ev?.input?.input;
	if (ev?.toolName !== "edit" || typeof text !== "string") return null;
	for (const raw of text.split("\n")) {
		const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
		if (!line.startsWith("[") || !line.endsWith("]")) continue;
		const inner = line.slice(1, -1);
		const hash = inner.lastIndexOf("#");
		if (hash < 0 || HASHLINE_TAG.test(inner.slice(hash + 1))) continue;
		return {
			block: true,
			reason:
				`Input header must be [PATH#TAG] with the file's 4-hex content-hash tag; got "${line}". ` +
				"Re-read the file with `read` to copy a current [path#tag] header — never invent the tag.",
		};
	}
	return null;
}

export default async function (pi: RelayPi): Promise<void> {
	const target = process.env[TARGET_ENV];
	if (!target) throw new Error(`gate-relay: ${TARGET_ENV} is not set; refusing to load without the Kiro Crew gate`);

	// Runtime-selected: the gate's path is only known from the shim's env.
	const mod = await import(target.startsWith("/") ? pathToFileURL(target).href : target);
	const gateFactory = mod?.default;
	if (typeof gateFactory !== "function") throw new Error(`gate-relay: ${target} has no default extension factory`);

	pi.on("session_start", (_e, ctx) => remember(ctx));
	const steers = new EarlySteers();
	steers.attach(pi);

	const on = (event: string, handler: Handler): void => {
		if (event === "tool_call") {
			pi.on(event, (e, ctx) => placeholderTagRefusal(e) ?? handler(anchorEdit(e), relay(ctx)));
			return;
		}
		if (event === "turn_end") steers.addGateTurnEnd(handler);
		pi.on(event, handler);
	};

	const mcp = mcpRegistry();
	// `pi` is a class instance (private fields): resolve and bind against the real target.
	const wrapped = new Proxy(pi as object, {
		get(t, key) {
			if (key === "on") return on;
			const v = Reflect.get(t, key, t);
			if (key === "sendMessage" && typeof v === "function") {
				return (message: unknown, options?: SendOptions) => v.call(t, message, steers.sendOptions(message, options));
			}
			if (typeof v === "function") return v.bind(t);
			if (v === undefined && (key === "registerMcpServer" || key === "getMcpServers")) return mcp[key];
			return v;
		},
	});

	await gateFactory(wrapped);
}
