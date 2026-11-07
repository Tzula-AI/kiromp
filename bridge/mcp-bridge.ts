/**
 * omp ↔ Kiro Crew bridge: mounts the MCP servers Crew put in the ACP session's
 * `mcpServers` array.
 *
 * pi-acp accepts `session/new` / `session/load` `mcpServers` and drops them. The
 * wrapper (pi-acp-wrapper.mjs) captures the array into a 0600 handoff file,
 * pi-shim.mjs takes it over and loads this extension with
 * $KIROCREW_OMP_MCP_SERVERS_FILE naming it. The extension reads and unlinks it (the
 * elements carry credentials; omp's own tools must not find them), then:
 * - connects to each element (ACP shapes: stdio `{name, command, args, env: [{name,
 *   value}]}`, `{type: "http" | "sse", name, url, headers: [{name, value}]}`),
 *   runs `initialize` / `notifications/initialized` / `tools/list`;
 * - registers each tool as `mcp__<server>__<tool>` (the grammar Crew parses back,
 *   splitting on the last `__`), loadMode "essential" so the model sees it directly;
 * - forwards calls as `tools/call`. Registered tools run through omp's extension
 *   tool wrapper, so Crew's gate extension sees and judges every call (`tool_call`).
 *
 * An element that cannot connect within CONNECT_MS is dropped (stderr notes why);
 * the session and every other server still come up. omp awaits an extension's
 * factory before the session starts, so the factory waits at most STARTUP_MS for the
 * mounts: a server ready by then is in the session's first tool list, and a slower one
 * (a cold `uvx …@latest`, a remote that never authenticates) registers its tools
 * when it does connect -- omp adds a tool registered after load to the live session
 * -- instead of holding every session start for up to CONNECT_MS. omp re-runs CLI
 * extensions for each in-process `task` subagent, so connections live in a globalThis
 * registry and are shared: a subagent registers the same tools over the parent's
 * connections instead of spawning its servers again. Standalone: node builtins +
 * fetch only.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";

/** Same name as protocol.mjs ENV_MCP_SERVERS_FILE (this file stays standalone). */
export const ENV_SERVERS_FILE = "KIROCREW_OMP_MCP_SERVERS_FILE";
const PROTOCOL_VERSION = "2025-06-18";
const CONNECT_MS = Number(process.env.KIROCREW_OMP_MCP_CONNECT_MS) || 30_000;
const STARTUP_MS = Number(process.env.KIROCREW_OMP_MCP_STARTUP_MS) || 5_000;
const INTENT_FIELD = "i"; // omp injects it into every tool's wire schema
const MAX_NAME = 64;
const STDERR_TAIL = 2048;

type Pair = { name?: unknown; value?: unknown };
export interface AcpMcpServer {
	name: string;
	type?: string;
	command?: string;
	args?: string[];
	env?: Pair[];
	url?: string;
	headers?: Pair[];
}
/** The fields of an MCP `tools/call` result this bridge reads (each one checked before use). */
interface CallToolResult {
	content?: unknown;
	structuredContent?: unknown;
	isError?: unknown;
}
interface McpTool {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
}
interface JsonRpcMsg {
	jsonrpc?: string;
	id?: string | number | null;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code?: number; message?: string; data?: unknown };
}

/** The slice of omp's ExtensionAPI this file uses. */
interface BridgePi {
	registerTool(tool: Record<string, unknown>): void;
}

// ---------------------------------------------------------------- pure helpers (exported for tests)

const pairs = (v: unknown): Record<string, string> => {
	const out: Record<string, string> = {};
	if (Array.isArray(v)) {
		for (const p of v as Pair[]) if (typeof p?.name === "string" && p.name) out[p.name] = String(p.value ?? "");
	} else if (v && typeof v === "object") {
		for (const [k, val] of Object.entries(v)) out[k] = String(val ?? "");
	}
	return out;
};

/** The valid elements of a raw `mcpServers` value, first occurrence of a name winning. */
export function parseServers(raw: unknown): AcpMcpServer[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const out: AcpMcpServer[] = [];
	for (const e of raw) {
		if (!e || typeof e !== "object" || typeof e.name !== "string" || !e.name || seen.has(e.name)) continue;
		const remote = typeof e.url === "string" && e.url;
		const local = typeof e.command === "string" && e.command;
		if (!remote && !local) continue;
		seen.add(e.name);
		out.push(e as AcpMcpServer);
	}
	return out;
}

const sanitize = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, "_");
const shortHash = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 8);

/** `mcp__<server>__<tool>`, provider-safe and at most 64 chars (a hash keeps a long one unique). */
export function toolName(server: string, tool: string): string {
	const full = `mcp__${sanitize(server)}__${sanitize(tool)}`;
	if (full.length <= MAX_NAME) return full;
	return `${full.slice(0, MAX_NAME - 9)}_${shortHash(`${server}\0${tool}`)}`;
}

/** A JSON schema omp can hand a provider: always an object schema. */
export function toolSchema(input: unknown): Record<string, unknown> {
	const s = input && typeof input === "object" && !Array.isArray(input) ? { ...(input as Record<string, unknown>) } : {};
	if (s.type !== "object") s.type = "object";
	if (!s.properties || typeof s.properties !== "object") s.properties = {};
	return s;
}

/** Arguments as the server should see them: omp's intent field and empty optional placeholders dropped. */
export function outboundArgs(params: unknown, schema: Record<string, unknown>): Record<string, unknown> {
	if (!params || typeof params !== "object" || Array.isArray(params)) return {};
	const props = (schema.properties ?? {}) as Record<string, unknown>;
	const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(params)) {
		if (k === INTENT_FIELD && !Object.hasOwn(props, INTENT_FIELD)) continue;
		const placeholder =
			v === undefined || v === "" || (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
		if (placeholder && Object.hasOwn(props, k) && !required.has(k)) continue;
		out[k] = v;
	}
	return out;
}

/** omp tool content for an MCP `tools/call` result; throws for `isError`. */
export function toolResult(result: unknown): { content: Array<Record<string, unknown>> } {
	const r = (result && typeof result === "object" ? result : {}) as CallToolResult;
	const content: Array<Record<string, unknown>> = [];
	const items: unknown[] = Array.isArray(r.content) ? r.content : [];
	for (const item of items) {
		if (!item || typeof item !== "object") continue;
		const c = item as Record<string, unknown>;
		if (c.type === "text") content.push({ type: "text", text: String(c.text ?? "") });
		else if (c.type === "image" && typeof c.data === "string")
			content.push({ type: "image", data: c.data, mimeType: typeof c.mimeType === "string" ? c.mimeType : "image/png" });
		else if (c.type === "resource") {
			const res = (c.resource && typeof c.resource === "object" ? c.resource : {}) as Record<string, unknown>;
			content.push({ type: "text", text: typeof res.text === "string" ? res.text : JSON.stringify(res) });
		} else if (c.type === "resource_link") content.push({ type: "text", text: `${c.name ?? "resource"}: ${c.uri ?? ""}` });
		else content.push({ type: "text", text: JSON.stringify(c) });
	}
	if (!content.length && r.structuredContent !== undefined)
		content.push({ type: "text", text: JSON.stringify(r.structuredContent) });
	if (r.isError) {
		const text = content.map((c) => (c.type === "text" ? c.text : "")).filter(Boolean).join("\n");
		throw new Error(text || "MCP tool reported an error");
	}
	if (!content.length) content.push({ type: "text", text: "(no output)" });
	return { content };
}

/** Feed SSE text; returns complete events and the unconsumed remainder. */
export function parseSse(buf: string): { events: Array<{ event: string; data: string }>; rest: string } {
	const events: Array<{ event: string; data: string }> = [];
	const norm = buf.replace(/\r\n?/g, "\n");
	let start = 0;
	let end: number;
	while ((end = norm.indexOf("\n\n", start)) !== -1) {
		const block = norm.slice(start, end);
		start = end + 2;
		let event = "message";
		const data: string[] = [];
		for (const line of block.split("\n")) {
			if (line.startsWith(":")) continue;
			const i = line.indexOf(":");
			const field = i === -1 ? line : line.slice(0, i);
			const value = i === -1 ? "" : line.slice(i + 1).replace(/^ /, "");
			if (field === "event") event = value;
			else if (field === "data") data.push(value);
		}
		if (data.length) events.push({ event, data: data.join("\n") });
	}
	return { events, rest: norm.slice(start) };
}

// ---------------------------------------------------------------- connections

abstract class Connection {
	protected nextId = 1;
	protected pending = new Map<string | number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	closed = false;
	constructor(readonly server: AcpMcpServer) {}

	protected abstract send(msg: JsonRpcMsg): Promise<void>;
	abstract close(): void;
	protected describeFailure(): string {
		return "";
	}

	/** A request's result: an object whose fields the caller narrows (`{}` for a non-object). */
	async request(method: string, params: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
		if (this.closed) throw new Error(`MCP server "${this.server.name}" is closed${this.describeFailure()}`);
		const id = this.nextId++;
		const { promise, resolve, reject } = Promise.withResolvers<unknown>();
		const onAbort = () => {
			this.pending.delete(id);
			this.notify("notifications/cancelled", { requestId: id, reason: "aborted" }).catch(() => {});
			reject(new Error("aborted"));
		};
		if (signal?.aborted) onAbort();
		else {
			signal?.addEventListener("abort", onAbort, { once: true });
			this.pending.set(id, {
				resolve: (v) => (signal?.removeEventListener("abort", onAbort), resolve(v)),
				reject: (e) => (signal?.removeEventListener("abort", onAbort), reject(e)),
			});
			this.send({ jsonrpc: "2.0", id, method, params }).catch((e) => {
				const p = this.pending.get(id);
				this.pending.delete(id);
				p?.reject(e instanceof Error ? e : new Error(String(e)));
			});
		}
		const result = await promise;
		return result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : {};
	}

	notify(method: string, params?: unknown): Promise<void> {
		return this.send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
	}

	/** One message from the server: a response, a server→client request, or a notification. */
	protected dispatch(msg: JsonRpcMsg): void {
		if (!msg || typeof msg !== "object") return;
		if (msg.method === undefined && msg.id !== undefined && msg.id !== null) {
			const p = this.pending.get(msg.id);
			if (!p) return;
			this.pending.delete(msg.id);
			if (msg.error) p.reject(new Error(msg.error.message || `MCP error ${msg.error.code}`));
			else p.resolve(msg.result);
			return;
		}
		if (msg.method !== undefined && msg.id !== undefined && msg.id !== null) {
			const reply: JsonRpcMsg =
				msg.method === "ping"
					? { jsonrpc: "2.0", id: msg.id, result: {} }
					: { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not supported: ${msg.method}` } };
			this.send(reply).catch(() => {});
		}
	}

	protected failAll(err: Error): void {
		this.closed = true;
		for (const p of this.pending.values()) p.reject(err);
		this.pending.clear();
	}
}

class StdioConnection extends Connection {
	private child: ChildProcess;
	private buf = "";
	private stderrTail = "";
	private exitNote = "";

	constructor(server: AcpMcpServer, cwd: string) {
		super(server);
		const env: Record<string, string | undefined> = { ...process.env, ...pairs(server.env) };
		delete env[ENV_SERVERS_FILE];
		this.child = spawn(server.command as string, Array.isArray(server.args) ? server.args.map(String) : [], {
			cwd,
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.child.stdin?.on("error", () => {});
		this.child.stdout?.setEncoding("utf8");
		this.child.stdout?.on("data", (d: string) => {
			this.buf += d;
			let i: number;
			while ((i = this.buf.indexOf("\n")) !== -1) {
				const line = this.buf.slice(0, i).trim();
				this.buf = this.buf.slice(i + 1);
				if (!line) continue;
				try {
					this.dispatch(JSON.parse(line));
				} catch {}
			}
		});
		this.child.stderr?.setEncoding("utf8");
		this.child.stderr?.on("data", (d: string) => {
			this.stderrTail = (this.stderrTail + d).slice(-STDERR_TAIL);
		});
		this.child.on("error", (e) => {
			this.exitNote = e.message;
			this.failAll(new Error(`MCP server "${server.name}" failed to start: ${e.message}`));
		});
		this.child.on("exit", (code, sig) => {
			this.exitNote = `exited (${sig ?? code})`;
			this.failAll(new Error(`MCP server "${server.name}" ${this.exitNote}${this.describeFailure()}`));
		});
	}

	protected describeFailure(): string {
		const tail = this.stderrTail.trim();
		return tail ? `: ${tail.slice(-500)}` : "";
	}

	protected send(msg: JsonRpcMsg): Promise<void> {
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		const stdin = this.child.stdin;
		if (this.closed || !stdin?.writable) reject(new Error(`MCP server "${this.server.name}" is not running`));
		else stdin.write(JSON.stringify(msg) + "\n", (e) => (e ? reject(e) : resolve()));
		return promise;
	}

	close(): void {
		if (this.closed && this.child.exitCode !== null) return;
		this.closed = true;
		try {
			this.child.stdin?.end();
		} catch {}
		const t = setTimeout(() => {
			try {
				this.child.kill("SIGKILL");
			} catch {}
		}, 2000);
		t.unref?.();
		try {
			this.child.kill("SIGTERM");
		} catch {}
	}

	/** Synchronous best effort for process exit. */
	killNow(): void {
		try {
			this.child.kill("SIGKILL");
		} catch {}
	}
}

/** Streamable HTTP (MCP 2025-03-26+): one POST per message, JSON or SSE answer. */
class HttpConnection extends Connection {
	private sessionId: string | undefined;
	private protocol: string | undefined;
	private ctl = new AbortController();

	private headers(): Record<string, string> {
		return {
			...pairs(this.server.headers),
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
			...(this.protocol ? { "mcp-protocol-version": this.protocol } : {}),
		};
	}

	setProtocol(v: string): void {
		this.protocol = v;
	}

	protected async send(msg: JsonRpcMsg): Promise<void> {
		const res = await fetch(this.server.url as string, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify(msg),
			signal: this.ctl.signal,
		});
		const sid = res.headers.get("mcp-session-id");
		if (sid) this.sessionId = sid;
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 500)}` : ""}`);
		}
		const ct = res.headers.get("content-type") ?? "";
		if (ct.includes("text/event-stream") && res.body) {
			// Read in the background: a response may follow server requests on the same stream.
			this.pump(res.body).catch(() => {});
			return;
		}
		const text = await res.text();
		if (!text.trim()) return;
		const body = JSON.parse(text);
		for (const m of Array.isArray(body) ? body : [body]) this.dispatch(m);
	}

	private async pump(body: ReadableStream<Uint8Array>): Promise<void> {
		const dec = new TextDecoder();
		let buf = "";
		for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
			const parsed = parseSse(buf + dec.decode(chunk, { stream: true }));
			buf = parsed.rest;
			for (const e of parsed.events) {
				if (e.event !== "message") continue;
				try {
					this.dispatch(JSON.parse(e.data));
				} catch {}
			}
		}
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.ctl.abort();
		if (this.sessionId)
			fetch(this.server.url as string, { method: "DELETE", headers: this.headers() }).catch(() => {});
	}
}

/** Legacy HTTP+SSE (MCP 2024-11-05): a GET event stream announces the POST endpoint. */
class SseConnection extends Connection {
	private endpoint: Promise<string>;
	private ctl = new AbortController();

	constructor(server: AcpMcpServer) {
		super(server);
		this.endpoint = new Promise((resolve, reject) => {
			const base = server.url as string;
			fetch(base, { headers: { ...pairs(server.headers), accept: "text/event-stream" }, signal: this.ctl.signal })
				.then(async (res) => {
					if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
					const dec = new TextDecoder();
					let buf = "";
					for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
						const parsed = parseSse(buf + dec.decode(chunk, { stream: true }));
						buf = parsed.rest;
						for (const e of parsed.events) {
							if (e.event === "endpoint") resolve(new URL(e.data.trim(), base).href);
							else if (e.event === "message") {
								try {
									this.dispatch(JSON.parse(e.data));
								} catch {}
							}
						}
					}
					throw new Error("event stream ended");
				})
				.catch((e) => {
					const err = e instanceof Error ? e : new Error(String(e));
					reject(err);
					this.failAll(new Error(`MCP server "${server.name}": ${err.message}`));
				});
		});
		this.endpoint.catch(() => {});
	}

	protected async send(msg: JsonRpcMsg): Promise<void> {
		const url = await this.endpoint;
		const res = await fetch(url, {
			method: "POST",
			headers: { ...pairs(this.server.headers), "content-type": "application/json" },
			body: JSON.stringify(msg),
			signal: this.ctl.signal,
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
	}

	close(): void {
		this.closed = true;
		this.ctl.abort();
	}
}

// ---------------------------------------------------------------- mounting

interface Mounted {
	conn: Connection;
	tools: McpTool[];
}

const REGISTRY = Symbol.for("omp-kiro-bridge.mcp-bridge.mounts");
const SERVERS = Symbol.for("omp-kiro-bridge.mcp-bridge.servers");
interface BridgeStore {
	[REGISTRY]?: Map<string, Promise<Mounted | null>>;
	[SERVERS]?: AcpMcpServer[];
}
const store = globalThis as unknown as BridgeStore;

/**
 * This process's servers: read once from the shim's file, which is then unlinked, and
 * kept for the subagent loads that follow (they find the file gone).
 */
export function loadServers(env: Record<string, string | undefined> = process.env): AcpMcpServer[] {
	const cached = store[SERVERS];
	if (cached) return cached;
	const file = env[ENV_SERVERS_FILE];
	let servers: AcpMcpServer[] = [];
	if (file) {
		try {
			servers = parseServers(JSON.parse(readFileSync(file, "utf8")));
		} catch (e) {
			process.stderr.write(`omp-kiro-bridge mcp: cannot read ${file}: ${e instanceof Error ? e.message : e}\n`);
		}
		try {
			unlinkSync(file);
		} catch {}
	}
	store[SERVERS] = servers;
	return servers;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
	const { promise, reject } = Promise.withResolvers<T>();
	const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
	return Promise.race([p, promise]).finally(() => clearTimeout(timer));
}

async function connect(server: AcpMcpServer, cwd: string): Promise<Mounted> {
	const conn =
		typeof server.url === "string" && server.url
			? server.type === "sse"
				? new SseConnection(server)
				: new HttpConnection(server)
			: new StdioConnection(server, cwd);
	try {
		const init = await withTimeout(
			conn.request("initialize", {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "omp-kiro-bridge", version: "1" },
			}),
			CONNECT_MS,
			"initialize",
		);
		if (conn instanceof HttpConnection && typeof init?.protocolVersion === "string") conn.setProtocol(init.protocolVersion);
		await conn.notify("notifications/initialized");
		const tools: McpTool[] = [];
		let cursor: string | undefined;
		const deadline = Date.now() + CONNECT_MS;
		do {
			const page = await withTimeout(
				conn.request("tools/list", cursor ? { cursor } : {}),
				Math.max(1, deadline - Date.now()),
				"tools/list",
			);
			for (const t of Array.isArray(page?.tools) ? page.tools : [])
				if (t && typeof t.name === "string" && t.name) tools.push(t);
			cursor = typeof page?.nextCursor === "string" && page.nextCursor ? page.nextCursor : undefined;
		} while (cursor);
		return { conn, tools };
	} catch (e) {
		conn.close();
		throw e;
	}
}

let exitHooked = false;
function hookExit(mounts: Map<string, Promise<Mounted | null>>): void {
	if (exitHooked) return;
	exitHooked = true;
	const live: Connection[] = [];
	for (const p of mounts.values()) p.then((m) => m && live.push(m.conn)).catch(() => {});
	process.on("exit", () => {
		for (const c of live) c instanceof StdioConnection ? c.killNow() : c.close();
	});
}

/** Mount once per process; a subagent's load reuses the parent's connections. */
function mountAll(servers: AcpMcpServer[], cwd: string): Map<string, Promise<Mounted | null>> {
	let mounts = store[REGISTRY];
	if (!mounts) {
		mounts = new Map();
		store[REGISTRY] = mounts;
	}
	for (const s of servers) {
		if (mounts.has(s.name)) continue;
		mounts.set(
			s.name,
			connect(s, cwd).catch((e) => {
				process.stderr.write(`omp-kiro-bridge mcp: dropped "${s.name}": ${e instanceof Error ? e.message : e}\n`);
				return null;
			}),
		);
	}
	hookExit(mounts);
	return mounts;
}

/** Register *m*'s tools on *pi* under `mcp__<server>__<tool>`; *used* dedupes names across servers. */
function registerMounted(pi: BridgePi, s: AcpMcpServer, m: Mounted, used: Set<string>): void {
	for (const t of m.tools) {
		let name = toolName(s.name, t.name);
		if (used.has(name)) name = `${name.slice(0, MAX_NAME - 9)}_${shortHash(`${s.name}\0${t.name}\0dup`)}`;
		used.add(name);
		const schema = toolSchema(t.inputSchema);
		const conn = m.conn;
		pi.registerTool({
			name,
			label: `${s.name}: ${t.name}`,
			description: t.description || `${t.name} (MCP server ${s.name})`,
			parameters: schema,
			loadMode: "essential",
			approval: "write",
			mcpServerName: s.name,
			mcpToolName: t.name,
			async execute(_id: string, params: unknown, signal?: AbortSignal) {
				const r = await conn.request("tools/call", { name: t.name, arguments: outboundArgs(params, schema) }, signal);
				return { ...toolResult(r), details: { server: s.name, tool: t.name } };
			},
		});
	}
}

export default async function (pi: BridgePi): Promise<void> {
	const servers = loadServers();
	if (!servers.length) return;
	const mounts = mountAll(servers, process.cwd());
	const used = new Set<string>();
	// Each server registers the moment it is mounted; none waits on a slower sibling.
	const all = Promise.all(
		servers.map(async (s) => {
			const m = await mounts.get(s.name);
			if (m) registerMounted(pi, s, m, used);
		}),
	);
	const startup = Promise.withResolvers<void>();
	const timer = setTimeout(startup.resolve, STARTUP_MS);
	await Promise.race([all, startup.promise]);
	clearTimeout(timer);
}
