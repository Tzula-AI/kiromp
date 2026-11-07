/**
 * omp ↔ Kiro Crew bridge reporter.
 *
 * Loaded by pi-shim on omp's command line (`--extension <this file>`). omp
 * re-runs this factory for the parent runtime AND for every in-process subagent
 * runtime, each with its own `pi`. Only subagent (child) runtimes report: they
 * stream their tool calls, assistant text, and completion as newline-delimited
 * JSON to the bridge wrapper's Unix socket ($KIROCREW_OMP_BRIDGE_SOCK), keyed by
 * the omp subagent id (== the parent's `task` details.progress[].id).
 *
 * Inert when the socket env var is unset. Registers no commands, tools, or
 * flags. Never throws into omp: every handler is guarded, socket failures are
 * swallowed, and writes are best-effort.
 *
 * Standalone on purpose (node builtins only): omp loads it with zero deps, so
 * the omp types it touches are declared structurally below.
 */

import { connect, type Socket } from "node:net";

/** The slice of omp's ExtensionAPI this file uses. */
interface ReporterPi {
	on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
}

type Fields = Record<string, unknown>;

/** Best-effort newline-JSON writer to the bridge socket. */
interface LineSink {
	send(msg: unknown): void;
	/** Close once everything queued so far is written; the next send reconnects. */
	close(): void;
}

const SOCK_ENV = "KIROCREW_OMP_BRIDGE_SOCK";
const TITLE_MAX = 160;
const TOOL_TEXT_MAX = 2000;
const ERROR_MAX = 1000;
const TEXT_FLUSH_MS = 250;
const TEXT_FLUSH_CHARS = 1500;
const PENDING_MAX = 200;
const RECONNECT_MS = 2000;
const MAX_RETRIES = 5;
const SECRET_RE = /(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi;

const isFields = (v: unknown): v is Fields => typeof v === "object" && v !== null;

const redact = (s: string): string => s.replace(SECRET_RE, "[redacted]");

function inputSummary(toolName: string, input: unknown): string {
	if (isFields(input)) {
		const name = toolName.toLowerCase();
		if ((name === "bash" || name === "shell") && typeof input.command === "string") return input.command;
		if (name === "edit" || name === "write" || name === "read") {
			const p = input.path ?? input.file_path;
			if (typeof p === "string") return p;
		}
	}
	try {
		return JSON.stringify(input) ?? "";
	} catch {
		return String(input);
	}
}

/** `/dir/Parent/Parent.Child.jsonl` → `Child`; `/dir/SubProbe.jsonl` → `SubProbe`. */
function subagentIdFromFile(file: unknown): string | undefined {
	if (typeof file !== "string" || !file) return undefined;
	let base = file.slice(file.lastIndexOf("/") + 1);
	if (base.endsWith(".jsonl")) base = base.slice(0, -".jsonl".length);
	return base.slice(base.lastIndexOf(".") + 1) || undefined;
}

/** Lazy connect, bounded pre-connect buffer (oldest dropped), silent on failure. */
function createLineSink(sockPath: string): LineSink {
	let sock: Socket | undefined;
	let connected = false;
	let lastFailure = 0;
	let failures = 0;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let endWhenDrained = false;
	const pending: string[] = [];

	const drop = () => {
		const s = sock;
		sock = undefined;
		connected = false;
		lastFailure = Date.now();
		failures++;
		try {
			s?.destroy();
		} catch {}
		// Retry later (bounded) so buffered lines are not stranded when no further event arrives.
		if (failures > MAX_RETRIES) pending.length = 0;
		else if (pending.length && !retryTimer) {
			retryTimer = setTimeout(() => {
				retryTimer = undefined;
				open();
			}, RECONNECT_MS + 50);
			retryTimer.unref?.();
		}
	};

	const flushPending = () => {
		if (!connected || !sock) return;
		try {
			if (pending.length) sock.write(pending.splice(0).join(""));
			if (endWhenDrained) {
				endWhenDrained = false;
				const s = sock;
				sock = undefined;
				connected = false;
				s.end();
			}
		} catch {
			drop();
		}
	};

	function open() {
		if (sock || Date.now() - lastFailure < RECONNECT_MS) return;
		try {
			const s = connect(sockPath);
			sock = s;
			s.on("error", () => {
				if (sock === s) drop();
			});
			s.on("close", () => {
				if (sock === s) drop();
			});
			s.on("connect", () => {
				if (sock !== s) return;
				connected = true;
				failures = 0;
				flushPending();
			});
			s.unref(); // never keep omp alive for the bridge
		} catch {
			drop();
		}
	}

	return {
		send(msg) {
			let line: string;
			try {
				line = `${JSON.stringify(msg)}\n`;
			} catch {
				return;
			}
			endWhenDrained = false;
			pending.push(line);
			if (pending.length > PENDING_MAX) pending.splice(0, pending.length - PENDING_MAX);
			if (connected) flushPending();
			else open();
		},
		close() {
			if (!sock) return;
			endWhenDrained = true;
			flushPending();
		},
	};
}

export default function kiroCrewBridgeReporter(pi: ReporterPi): void {
	const sockPath = process.env[SOCK_ENV];
	if (!sockPath) return;

	// undefined = not decided yet; null = inert (parent, or no session file); string = child id.
	let subagent: string | null | undefined;
	let sink: LineSink | undefined;
	let text = "";
	let textTimer: ReturnType<typeof setTimeout> | undefined;

	const resolve = (ctx: unknown): string | null | undefined => {
		if (subagent !== undefined || !isFields(ctx)) return subagent;
		let id: string | undefined;
		if (!(ctx.hasUI === true && ctx.mode === "rpc")) {
			try {
				const sm = ctx.sessionManager;
				if (isFields(sm) && typeof sm.getSessionFile === "function") id = subagentIdFromFile(sm.getSessionFile());
			} catch {}
		}
		subagent = id ?? null;
		if (id) sink = createLineSink(sockPath);
		return subagent;
	};

	const flushText = () => {
		if (textTimer) clearTimeout(textTimer);
		textTimer = undefined;
		if (text && subagent && sink) sink.send({ kind: "activity", subagent, event: "text", text: redact(text) });
		text = "";
	};

	const on = (name: string, fn: (event: Fields, id: string, out: LineSink) => void) => {
		pi.on(name, (event, ctx) => {
			try {
				const id = resolve(ctx);
				if (id && sink) fn(isFields(event) ? event : {}, id, sink);
			} catch {}
			return undefined;
		});
	};

	on("tool_call", (e, id, out) => {
		flushText();
		const toolName = String(e.toolName ?? "tool");
		let title = redact(`${toolName}: ${inputSummary(toolName, e.input)}`).replace(/\s+/g, " ").trim();
		if (title.length > TITLE_MAX) title = `${title.slice(0, TITLE_MAX - 1)}…`;
		out.send({ kind: "activity", subagent: id, event: "tool_start", toolCallId: String(e.toolCallId ?? ""), title });
	});

	on("tool_result", (e, id, out) => {
		flushText();
		const parts = Array.isArray(e.content) ? e.content : [];
		const body = redact(
			parts
				.filter((c: unknown): c is Fields => isFields(c) && c.type === "text" && typeof c.text === "string")
				.map(c => c.text)
				.join("\n"),
		);
		out.send({
			kind: "activity",
			subagent: id,
			event: "tool_end",
			toolCallId: String(e.toolCallId ?? ""),
			status: e.isError ? "failed" : "completed",
			text: body.length > TOOL_TEXT_MAX ? body.slice(-TOOL_TEXT_MAX) : body,
		});
	});

	on("message_update", e => {
		const ev = e.assistantMessageEvent;
		if (!isFields(ev) || ev.type !== "text_delta" || typeof ev.delta !== "string" || !ev.delta) return;
		text += ev.delta;
		if (text.length >= TEXT_FLUSH_CHARS) {
			flushText();
		} else if (!textTimer) {
			textTimer = setTimeout(() => {
				textTimer = undefined;
				try {
					flushText();
				} catch {}
			}, TEXT_FLUSH_MS);
			textTimer.unref?.();
		}
	});

	on("turn_end", flushText);

	on("agent_end", (e, id, out) => {
		flushText();
		out.send({ kind: "done", subagent: id, ...endStatus(e.messages) });
		out.close();
	});
}

/** A run ended by a provider error or an abort is a failure; its reason travels with it. */
function endStatus(messages: unknown): { status: "completed" | "failed"; message?: string } {
	if (!Array.isArray(messages)) return { status: "completed" };
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (!isFields(m) || m.role !== "assistant") continue;
		if (m.stopReason === "error") {
			const why = typeof m.errorMessage === "string" && m.errorMessage ? redact(m.errorMessage) : "error";
			return { status: "failed", message: why.length > ERROR_MAX ? `${why.slice(0, ERROR_MAX - 1)}…` : why };
		}
		if (m.stopReason === "aborted") return { status: "failed", message: "aborted" };
		return { status: "completed" };
	}
	return { status: "completed" };
}
