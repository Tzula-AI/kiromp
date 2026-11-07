// reporter.ts against a fake omp ExtensionAPI and a real Unix socket server.
// reporter.ts is transpiled once with `bun build --target=node` (the same source omp
// loads natively) and imported here; handlers are driven the way omp would drive them.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "reporter.ts");
const ENV = "KIROCREW_OMP_BRIDGE_SOCK";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "reporter-test-"));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let reporter;
let sockSeq = 0;

before(async () => {
	const out = path.join(TMP, "reporter.mjs");
	const bun = [process.env.BUN, "bun", path.join(os.homedir(), ".bun/bin/bun")].filter(Boolean);
	let built = false;
	for (const bin of bun) {
		try {
			execFileSync(bin, ["build", SRC, "--target=node", "--format=esm", "--outfile", out], { stdio: "pipe" });
			built = true;
			break;
		} catch {}
	}
	assert.ok(built, "bun build of reporter.ts failed");
	reporter = (await import(pathToFileURL(out).href)).default;
});

after(() => {
	delete process.env[ENV];
	fs.rmSync(TMP, { recursive: true, force: true });
});

function fakePi() {
	const handlers = new Map();
	const registered = [];
	const reg = kind => (...args) => registered.push([kind, args[0]]);
	return {
		handlers,
		registered,
		pi: {
			on(name, fn) {
				handlers.set(name, fn);
			},
			registerCommand: reg("command"),
			registerTool: reg("tool"),
			registerFlag: reg("flag"),
			registerShortcut: reg("shortcut"),
		},
		fire(name, event, ctx) {
			const fn = handlers.get(name);
			assert.ok(fn, `no handler for ${name}`);
			return fn(event, ctx);
		},
	};
}

const childCtx = (file = "/x/Parent/SubProbe.jsonl") => ({
	hasUI: false,
	mode: "print",
	sessionManager: { getSessionFile: () => file },
});
const parentCtx = { hasUI: true, mode: "rpc", sessionManager: { getSessionFile: () => "/x/Parent.jsonl" } };

function sockPath() {
	return path.join(TMP, `s${++sockSeq}.sock`);
}

async function startServer(p) {
	const lines = [];
	const conns = new Set();
	const server = net.createServer(c => {
		conns.add(c);
		let buf = "";
		c.on("data", d => {
			buf += d;
			let i;
			while ((i = buf.indexOf("\n")) >= 0) {
				lines.push(JSON.parse(buf.slice(0, i)));
				buf = buf.slice(i + 1);
			}
		});
	});
	await new Promise(r => server.listen(p, r));
	return {
		lines,
		close: () => {
			for (const c of conns) c.destroy();
			return new Promise(r => server.close(r));
		},
	};
}

async function waitFor(pred, ms = 3000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (pred()) return;
		await sleep(20);
	}
	assert.fail("timed out waiting for condition");
}

/** Installs a reporter against `sock` (or unsets the env var when sock is null). */
function install(sock) {
	if (sock) process.env[ENV] = sock;
	else delete process.env[ENV];
	const f = fakePi();
	reporter(f.pi);
	return f;
}

test("child runtime streams tool_start/text/tool_end/done in order", async () => {
	const p = sockPath();
	const srv = await startServer(p);
	const f = install(p);
	const ctx = childCtx();
	assert.deepEqual(f.registered, [], "reporter must register no commands/tools/flags");

	assert.equal(f.fire("tool_call", { toolCallId: "c1", toolName: "bash", input: { command: "echo  hi\n  there" } }, ctx), undefined);
	f.fire("message_update", { assistantMessageEvent: { type: "text_delta", delta: "Hel" } }, ctx);
	f.fire("message_update", { assistantMessageEvent: { type: "thinking_delta", delta: "IGNORED" } }, ctx);
	f.fire("message_update", { assistantMessageEvent: { type: "text_delta", delta: "lo" } }, ctx);
	f.fire("tool_result", { toolCallId: "c1", toolName: "bash", isError: false, content: [
		{ type: "text", text: `${"x".repeat(3000)}` },
		{ type: "image", data: "…" },
		{ type: "text", text: "END" },
	] }, ctx);
	f.fire("tool_call", { toolCallId: "c2", toolName: "read", input: { path: "/etc/hosts", limit: 5 } }, ctx);
	f.fire("tool_result", { toolCallId: "c2", toolName: "read", isError: true, content: [{ type: "text", text: "ENOENT" }] }, ctx);
	f.fire("tool_call", { toolCallId: "c3", toolName: "grep", input: { pattern: "y".repeat(400) } }, ctx);
	f.fire("tool_call", { toolCallId: "c4", toolName: "bash", input: { command: "curl -H api_key=sk-abc123 x; export PASSWORD: hunter2" } }, ctx);
	f.fire("message_update", { assistantMessageEvent: { type: "text_delta", delta: "final token=zzz" } }, ctx);
	f.fire("agent_end", { messages: [] }, ctx);

	await waitFor(() => srv.lines.some(l => l.kind === "done"));
	const L = srv.lines;
	assert.deepEqual(L.map(l => `${l.kind}/${l.event ?? ""}`), [
		"activity/tool_start",
		"activity/text",
		"activity/tool_end",
		"activity/tool_start",
		"activity/tool_end",
		"activity/tool_start",
		"activity/tool_start",
		"activity/text",
		"done/",
	]);
	assert.ok(L.every(l => l.subagent === "SubProbe"));
	assert.deepEqual(L[0], { kind: "activity", subagent: "SubProbe", event: "tool_start", toolCallId: "c1", title: "bash: echo hi there" });
	assert.equal(L[1].text, "Hello");
	assert.equal(L[2].toolCallId, "c1");
	assert.equal(L[2].status, "completed");
	assert.equal(L[2].text.length, 2000);
	assert.ok(L[2].text.endsWith("x\nEND"));
	assert.equal(L[3].title, "read: /etc/hosts");
	assert.deepEqual([L[4].status, L[4].text], ["failed", "ENOENT"]);
	assert.equal(L[5].title.length, 160);
	assert.ok(L[5].title.startsWith('grep: {"pattern":"yyy'));
	assert.equal(L[6].title, "bash: curl -H [redacted] x; export [redacted]");
	assert.equal(L[7].text, "final [redacted]");
	assert.deepEqual(L[8], { kind: "done", subagent: "SubProbe", status: "completed" });
	await srv.close();
});

test("text deltas flush on the 250ms timer, at 1500 chars, and on turn_end", async () => {
	const p = sockPath();
	const srv = await startServer(p);
	const f = install(p);
	const ctx = childCtx();
	const delta = d => f.fire("message_update", { assistantMessageEvent: { type: "text_delta", delta: d } }, ctx);

	delta("a");
	delta("b");
	await sleep(100);
	assert.equal(srv.lines.length, 0, "no flush before 250ms");
	await waitFor(() => srv.lines.length === 1, 1000);
	assert.equal(srv.lines[0].text, "ab");

	delta("c".repeat(1000));
	delta("d".repeat(600)); // crosses 1500 → immediate flush
	await waitFor(() => srv.lines.length === 2, 200);
	assert.equal(srv.lines[1].text.length, 1600);

	delta("tail");
	f.fire("turn_end", { turnIndex: 0 }, ctx);
	await waitFor(() => srv.lines.length === 3, 200);
	assert.equal(srv.lines[2].text, "tail");
	await sleep(350);
	assert.equal(srv.lines.length, 3, "timer cleared after turn_end flush");
	await srv.close();
});

test("parent runtime (hasUI && rpc) emits nothing, even if later ctx looks like a child", async () => {
	const p = sockPath();
	const srv = await startServer(p);
	const f = install(p);
	f.fire("tool_call", { toolCallId: "p1", toolName: "task", input: {} }, parentCtx);
	f.fire("message_update", { assistantMessageEvent: { type: "text_delta", delta: "x" } }, parentCtx);
	f.fire("tool_call", { toolCallId: "p2", toolName: "bash", input: { command: "ls" } }, childCtx());
	f.fire("agent_end", {}, parentCtx);
	await sleep(400);
	assert.deepEqual(srv.lines, []);
	await srv.close();
});

test("agent_end: a provider error or abort ends the run as failed, with the reason", async () => {
	const ends = [
		[{ messages: [{ role: "user" }, { role: "assistant", stopReason: "error", errorMessage: `429 rate limited token=abc ${"z".repeat(1200)}` }] }, "failed"],
		[{ messages: [{ role: "assistant", stopReason: "aborted" }, { role: "toolResult" }] }, "failed"],
		[{ messages: [{ role: "assistant", stopReason: "error" }, { role: "assistant", stopReason: "stop" }] }, "completed"],
		[{ messages: "nope" }, "completed"],
	];
	const got = [];
	for (const [event] of ends) {
		const p = sockPath();
		const srv = await startServer(p);
		const f = install(p);
		f.fire("agent_end", event, childCtx("/x/P/Run.jsonl"));
		await waitFor(() => srv.lines.length === 1);
		got.push(srv.lines[0]);
		await srv.close();
	}
	assert.deepEqual(got.map(l => [l.kind, l.subagent, l.status]), ends.map(([, s]) => ["done", "Run", s]));
	assert.ok(got[0].message.startsWith("429 rate limited [redacted] zzz"));
	assert.equal(got[0].message.length, 1000);
	assert.equal(got[1].message, "aborted");
	assert.equal(got[2].message, undefined);
});

test("env unset: registers no handlers at all", () => {
	const f = install(null);
	assert.equal(f.handlers.size, 0);
	assert.deepEqual(f.registered, []);
});

test("nested session file Parent.Child.jsonl → subagent id Child", async () => {
	const p = sockPath();
	const srv = await startServer(p);
	const f = install(p);
	f.fire("tool_call", { toolCallId: "n1", toolName: "bash", input: { command: "true" } }, childCtx("/s/Parent/Parent.Child.jsonl"));
	await waitFor(() => srv.lines.length === 1);
	assert.equal(srv.lines[0].subagent, "Child");
	await srv.close();
});

test("child without a session file stays inert", async () => {
	const p = sockPath();
	const srv = await startServer(p);
	const f = install(p);
	const ctx = { hasUI: false, mode: "print", sessionManager: { getSessionFile: () => undefined } };
	f.fire("tool_call", { toolCallId: "z", toolName: "bash", input: { command: "true" } }, ctx);
	f.fire("agent_end", {}, ctx);
	await sleep(300);
	assert.deepEqual(srv.lines, []);
	await srv.close();
});

test("socket absent: handlers never throw; lines buffered until the socket appears", async () => {
	const p = sockPath();
	const f = install(p);
	const ctx = childCtx();
	for (const [name, ev] of [
		["tool_call", { toolCallId: "a1", toolName: "bash", input: { command: "echo late" } }],
		["message_update", { assistantMessageEvent: { type: "text_delta", delta: "t" } }],
		["tool_result", { toolCallId: "a1", content: null, isError: false }],
		["turn_end", undefined],
		["agent_end", null],
	]) {
		assert.doesNotThrow(() => f.fire(name, ev, ctx));
	}
	// Garbage events / ctx on a separate instance must not throw either.
	const g = install(path.join(TMP, "never.sock"));
	assert.doesNotThrow(() => g.fire("tool_call", null, null));
	assert.doesNotThrow(() => g.fire("tool_call", null, { hasUI: false, sessionManager: { getSessionFile() { throw new Error("boom"); } } }));
	assert.doesNotThrow(() => g.fire("message_update", { assistantMessageEvent: 42 }, childCtx()));
	assert.doesNotThrow(() => g.fire("tool_result", { content: [null, 7, { type: "text" }] }, childCtx()));

	await sleep(300);
	const srv = await startServer(p); // bridge comes up late → bounded retry delivers the buffer
	await waitFor(() => srv.lines.some(l => l.kind === "done"), 5000);
	assert.deepEqual(srv.lines.map(l => l.event ?? l.kind), ["tool_start", "text", "tool_end", "done"]);
	assert.equal(srv.lines[2].text, "");
	await srv.close();
});
