// gate-relay.ts against a fake Crew gate module and fake omp ExtensionAPIs.
// gate-relay.ts is transpiled once with `bun build --target=node` (the same source omp
// loads natively) and imported here; handlers are driven the way omp would drive them.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "gate-relay.ts");
const ENV = "KIROCREW_OMP_GATE_TARGET";
const KEY = Symbol.for("omp-kiro-bridge.gate-relay.parentUI");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gate-relay-test-"));
const GATE = path.join(TMP, "fake_gate.mjs");

// Fake Crew gate: like the real one, refuses without a dialog channel and otherwise asks
// `ctx.ui.confirm`. Every observation goes to globalThis.__gateSeen for the test to read.
const FAKE_GATE = `
export default function (pi) {
  pi.registerCommand("kiro-crew-gate", { description: "Kiro Crew tool gate" });
  pi.on("agent_end", (e, ctx) => { globalThis.__gateSeen.push({ kind: "agent_end", e, ctx }); });
  pi.on("tool_call", async (e, ctx) => {
    const rec = { kind: "tool_call", e, ctx, hasUI: ctx.hasUI, ui: ctx.ui, model: ctx.model, cwd: ctx.cwd };
    globalThis.__gateSeen.push(rec);
    if (!ctx.hasUI) return { block: true, reason: "Kiro Crew tool gate: no permission channel" };
    const ok = await ctx.ui.confirm(e.toolName, "envelope");
    return ok ? undefined : { block: true, reason: "denied" };
  });
}
`;

// Fake omp ExtensionAPI: a class with a private field, so any method invoked with the
// Proxy (not the real instance) as \`this\` throws a TypeError.
class FakePi {
	#handlers = new Map();
	commands = [];
	on(event, handler) {
		if (!this.#handlers.has(event)) this.#handlers.set(event, []);
		this.#handlers.get(event).push(handler);
	}
	registerCommand(name, opts) {
		this.#handlers.size; // touch the private field
		this.commands.push({ name, opts });
	}
	count(event) {
		return this.#handlers.get(event)?.length ?? 0;
	}
	async emit(event, e, ctx) {
		const out = [];
		for (const h of this.#handlers.get(event) ?? []) out.push(await h(e, ctx));
		return out;
	}
}

function fakeUi(name) {
	const calls = [];
	return { name, calls, confirm: async (title, body) => (calls.push({ title, body }), true) };
}

// Mirrors omp's createContext(): fresh object with a getter.
function fakeCtx({ hasUI, ui, model = "m-1" }) {
	return {
		hasUI,
		ui,
		cwd: "/work",
		get model() {
			return model;
		},
	};
}

let relay;

before(async () => {
	fs.writeFileSync(GATE, FAKE_GATE);
	const out = path.join(TMP, "gate-relay.mjs");
	const bun = [process.env.BUN, "bun", path.join(os.homedir(), ".bun/bin/bun")].filter(Boolean);
	let built = false;
	for (const bin of bun) {
		try {
			execFileSync(bin, ["build", SRC, "--target=node", "--format=esm", "--outfile", out], { stdio: "pipe" });
			built = true;
			break;
		} catch {}
	}
	assert.ok(built, "bun build of gate-relay.ts failed");
	relay = (await import(pathToFileURL(out).href)).default;
});

beforeEach(() => {
	delete globalThis[KEY];
	globalThis.__gateSeen = [];
	process.env[ENV] = GATE;
});

after(() => {
	delete globalThis[KEY];
	delete globalThis.__gateSeen;
	delete process.env[ENV];
	fs.rmSync(TMP, { recursive: true, force: true });
});

async function load() {
	const pi = new FakePi();
	await relay(pi);
	return pi;
}

test("parent session: ctx passes through and confirm reaches the parent ui", async () => {
	const pi = await load();
	const ui = fakeUi("parent");
	const ctx = fakeCtx({ hasUI: true, ui });
	await pi.emit("session_start", {}, ctx);
	assert.equal(globalThis[KEY], ui);

	const [res] = await pi.emit("tool_call", { toolName: "bash" }, ctx);
	assert.equal(res, undefined);
	const seen = globalThis.__gateSeen.at(-1);
	assert.equal(seen.ctx, ctx, "parent ctx must be passed unchanged");
	assert.deepEqual(ui.calls, [{ title: "bash", body: "envelope" }]);
});

test("parent tool_call alone records the parent ui (refresh)", async () => {
	const pi = await load();
	const ui = fakeUi("parent2");
	await pi.emit("tool_call", { toolName: "read" }, fakeCtx({ hasUI: true, ui }));
	assert.equal(globalThis[KEY], ui);
});

test("child session after parent session_start gets the parent ui", async () => {
	const parent = await load();
	const parentUi = fakeUi("parent");
	await parent.emit("session_start", {}, fakeCtx({ hasUI: true, ui: parentUi }));

	const child = await load();
	const childUi = fakeUi("child-noop");
	const childCtx = fakeCtx({ hasUI: false, ui: childUi, model: "child-model" });
	await child.emit("session_start", {}, childCtx);
	assert.equal(globalThis[KEY], parentUi, "UI-less session must not overwrite the parent ui");

	const [res] = await child.emit("tool_call", { toolName: "yield" }, childCtx);
	assert.equal(res, undefined, "child tool call must not be blocked");
	const seen = globalThis.__gateSeen.at(-1);
	assert.equal(seen.hasUI, true);
	assert.equal(seen.ui, parentUi);
	assert.equal(seen.model, "child-model", "getter readable via prototype");
	assert.equal(seen.cwd, "/work");
	assert.deepEqual(parentUi.calls, [{ title: "yield", body: "envelope" }]);
	assert.deepEqual(childUi.calls, []);
	assert.equal(childCtx.hasUI, false, "original child ctx not mutated");
	assert.equal(childCtx.ui, childUi);
});

test("no parent ui recorded: child ctx untouched and the gate blocks", async () => {
	const child = await load();
	const childCtx = fakeCtx({ hasUI: false, ui: undefined });
	const [res] = await child.emit("tool_call", { toolName: "bash" }, childCtx);
	assert.equal(globalThis.__gateSeen.at(-1).ctx, childCtx);
	assert.deepEqual(res, { block: true, reason: "Kiro Crew tool gate: no permission channel" });
});

test("missing target env var: factory rejects", async () => {
	delete process.env[ENV];
	await assert.rejects(relay(new FakePi()), /KIROCREW_OMP_GATE_TARGET/);
	process.env[ENV] = "";
	await assert.rejects(relay(new FakePi()), /KIROCREW_OMP_GATE_TARGET/);
});

test("target without a default factory: factory rejects", async () => {
	const bad = path.join(TMP, "bad_gate.mjs");
	fs.writeFileSync(bad, "export const x = 1;\n");
	process.env[ENV] = bad;
	await assert.rejects(relay(new FakePi()), /no default extension factory/);
});

test("other events and api methods pass through bound to the real pi", async () => {
	const pi = await load();
	assert.deepEqual(pi.commands, [{ name: "kiro-crew-gate", opts: { description: "Kiro Crew tool gate" } }]);
	assert.equal(pi.count("agent_end"), 1);
	assert.equal(pi.count("tool_call"), 1);
	assert.equal(pi.count("session_start"), 1);

	const ctx = fakeCtx({ hasUI: false });
	const e = { messages: [] };
	await pi.emit("agent_end", e, ctx);
	const seen = globalThis.__gateSeen.at(-1);
	assert.equal(seen.kind, "agent_end");
	assert.equal(seen.e, e);
	assert.equal(seen.ctx, ctx, "non-tool_call handlers get the raw ctx");
});

test("edit: ~ hashline header, MV and path are anchored to $HOME for the gate only", async () => {
	const pi = await load();
	const ui = fakeUi("parent");
	const ctx = fakeCtx({ hasUI: true, ui });
	const home = os.homedir();
	const input = {
		input: "[~/notes/a.md#3BDF]\r\nPUT 1.=1:\n+[~/body#ABCD]\nMV ~/notes/b.md\n[~#0000]\nREM",
		path: "~/notes/a.md",
		paths: ["~/notes/a.md", "~"],
	};
	const e = { toolName: "edit", toolCallId: "t1", input };
	const [res] = await pi.emit("tool_call", e, ctx);
	assert.equal(res, undefined);
	const seen = globalThis.__gateSeen.at(-1).e;
	assert.equal(
		seen.input.input,
		`[${home}/notes/a.md#3BDF]\r\nPUT 1.=1:\n+[~/body#ABCD]\nMV ${home}/notes/b.md\n[${home}#0000]\nREM`,
	);
	assert.equal(seen.input.path, `${home}/notes/a.md`);
	assert.deepEqual(seen.input.paths, [`${home}/notes/a.md`, home]);
	assert.equal(seen.toolCallId, "t1");
	assert.equal(input.input.startsWith("[~/notes/a.md#3BDF]"), true, "execution input untouched");
	assert.equal(input.path, "~/notes/a.md");
});

test("edit: other non-absolute spellings and other tools reach the gate unchanged", async () => {
	const pi = await load();
	const ctx = fakeCtx({ hasUI: true, ui: fakeUi("parent") });
	const text = '[~other/x#3BDF]\n[rel/x#3BDF]\n["~/q x"#3BDF]\nMV "~/y"\n[/abs/x#3BDF]';
	await pi.emit("tool_call", { toolName: "edit", input: { input: text, path: "rel/x" } }, ctx);
	const seen = globalThis.__gateSeen.at(-1).e;
	assert.equal(seen.input.input, text);
	assert.equal(seen.input.path, "rel/x");

	const bash = { toolName: "bash", input: { command: "cat ~/x", path: "~/x" } };
	await pi.emit("tool_call", bash, ctx);
	assert.equal(globalThis.__gateSeen.at(-1).e, bash);
});

// Fake gate doing what Crew's gate does with its MCP handoff: register each server,
// count a throw as shadowed, then read the registrations back.
const MCP_GATE = `
export default function (pi) {
  const out = { shadowed: [], servers: null };
  globalThis.__mcpGate = out;
  for (const [name, config] of [["kirocrew-core", { command: "k", args: ["mcp-core"] }], ["kirocrew-core", { command: "x" }], ["kirocrew-cron", { command: "k" }]]) {
    try { pi.registerMcpServer(name, config); } catch { out.shadowed.push(name); }
  }
  out.servers = pi.getMcpServers();
}
`;

test("mcp: omp has no registerMcpServer, so the relay records registrations and reads them back", async () => {
	const gate = path.join(TMP, "mcp_gate.mjs");
	fs.writeFileSync(gate, MCP_GATE);
	process.env[ENV] = gate;
	const pi = new FakePi();
	await relay(pi);
	const out = globalThis.__mcpGate;
	assert.deepEqual(out.shadowed, ["kirocrew-core"], "a repeated name is refused like pi refuses a held one");
	assert.deepEqual(out.servers, [
		{ name: "kirocrew-core", config: { command: "k", args: ["mcp-core"] } },
		{ name: "kirocrew-cron", config: { command: "k" } },
	]);
	assert.equal("registerMcpServer" in pi, false, "nothing is added to the real pi");
	delete globalThis.__mcpGate;
});

test("mcp: a pi that has the methods keeps its own", async () => {
	const gate = path.join(TMP, "mcp_gate.mjs");
	fs.writeFileSync(gate, MCP_GATE);
	process.env[ENV] = gate;
	class McpPi extends FakePi {
		#seen = [];
		registerMcpServer(name, config) {
			this.#seen.push({ name, config, real: true });
		}
		getMcpServers() {
			return this.#seen;
		}
	}
	await relay(new McpPi());
	const out = globalThis.__mcpGate;
	assert.deepEqual(out.shadowed, []);
	assert.equal(out.servers.length, 3);
	assert.ok(out.servers.every((s) => s.real), "the real pi's registration was used");
	delete globalThis.__mcpGate;
});
