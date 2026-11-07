// pi-acp-wrapper.mjs against a fake pi-acp child.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WRAPPER = path.join(HERE, "..", "pi-acp-wrapper.mjs");

// Fake pi-acp: announces the bridge env, then echoes each stdin line as a JSON-RPC
// result written in two halves 300 ms apart (so the wrapper sees a mid-line window);
// an `initialize` request gets an initialize-shaped result instead (also split).
const FAKE_CHILD = `
import readline from "node:readline";
import fs from "node:fs";
const w = (s) => process.stdout.write(s);
w(JSON.stringify({ jsonrpc: "2.0", method: "fake/env", params: { sock: process.env.KIROCREW_OMP_BRIDGE_SOCK ?? null, argv: process.argv.slice(2) } }) + "\\n");
let n = 0, chain = Promise.resolve();
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const id = ++n;
  let msg = null;
  try { msg = JSON.parse(line); } catch {}
  // session/new|load: what the shim would find in the MCP handoff file at this moment.
  const handoff = () => {
    const p = process.env.KIROCREW_OMP_MCP_HANDOFF;
    if (!p) return { path: null };
    try { return { path: p, mode: fs.statSync(p).mode & 0o777, servers: JSON.parse(fs.readFileSync(p, "utf8")) }; }
    catch { return { path: p, servers: null }; }
  };
  const full = msg?.method === "initialize"
    ? JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true }, _meta: { other: { keep: 1 } } } }) + "\\n"
    : msg?.method === "session/new" || msg?.method === "session/load"
    ? JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { handoff: handoff() } }) + "\\n"
    : JSON.stringify({ jsonrpc: "2.0", id, result: { echo: line, pad: "x".repeat(64) } }) + "\\n";
  chain = chain.then(() => new Promise((res) => {
    const half = full.length >> 1;
    w(full.slice(0, half));
    setTimeout(() => { w(full.slice(half)); res(); }, 300);
  }));
}).on("close", () => chain.then(() => setTimeout(() => process.exit(3), 50)));
`;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "okb-w-"));
  const fake = path.join(dir, "fake-pi-acp.mjs");
  fs.writeFileSync(fake, FAKE_CHILD);
  return { dir, fake };
}

const live = new Set(); // killed after the suite so a failed test cannot hang it
after(() => { for (const p of live) p.kill("SIGKILL"); });

function runWrapper(env, args = []) {
  const p = spawn(process.execPath, [WRAPPER, ...args], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, ...env } });
  live.add(p);
  p.on("close", () => live.delete(p));
  const st = { raw: "", listeners: [] };
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (d) => { st.raw += d; for (const l of st.listeners.slice()) l(); });
  const until = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout; stdout so far:\n" + st.raw)), ms);
    const check = () => { const v = pred(st.raw); if (v) { clearTimeout(t); st.listeners.splice(st.listeners.indexOf(check), 1); resolve(v); } };
    st.listeners.push(check);
    check();
  });
  const exited = new Promise((resolve) => p.on("close", (code, sig) => resolve({ code, sig })));
  return { p, st, until, exited };
}

const connect = (sock) => new Promise((resolve, reject) => {
  const c = net.createConnection(sock, () => resolve(c));
  c.on("error", reject);
});
const send = (c, obj) => new Promise((r) => c.write(JSON.stringify(obj) + "\n", r));
const lines = (raw) => raw.split("\n").filter(Boolean);

test("injects roster + activity between whole child lines", async () => {
  const { dir, fake } = setup();
  const w = runWrapper({ PI_ACP_REAL: fake, KIROCREW_SCRATCH: dir }, ["--some-arg"]);
  const envLine = await w.until((raw) => lines(raw).map((l) => JSON.parse(l)).find((f) => f.method === "fake/env"));
  const sock = envLine.params.sock;
  assert.equal(sock, path.join(dir, `omp-bridge-${w.p.pid}.sock`));
  assert.deepEqual(envLine.params.argv, ["--some-arg"]);
  assert.equal(fs.statSync(sock).mode & 0o777, 0o600);

  const c = await connect(sock);
  await send(c, { kind: "bogus" });
  c.write("not json\n");
  await send(c, { kind: "progress", taskCallId: "tc1", entries: [
    { id: "SubProbe", agent: "sonic", status: "pending", assignment: "# Target\nRun echo", task: "full task", lastIntent: "" },
  ] });
  const roster1 = await w.until((raw) => lines(raw).map((l) => JSON.parse(l)).find((f) => f.method === "_kiro.dev/subagent/list_update"));
  assert.deepEqual(roster1.params.subagents, [{
    sessionId: "omp:SubProbe", sessionName: "SubProbe", role: "sonic", agentName: "sonic",
    initialQuery: "# Target\nRun echo", status: { type: "working", message: "" },
  }]);

  // Child starts a split line; inject while it is mid-frame.
  w.p.stdin.write("hello\n");
  await w.until((raw) => raw.includes('"id":1') && !raw.endsWith("\n"));
  await send(c, { kind: "activity", subagent: "SubProbe", event: "tool_start", toolCallId: "t1", title: "bash: echo hi" });
  await send(c, { kind: "activity", subagent: "Ghost", event: "text", text: "boo" });
  await send(c, { kind: "activity", subagent: "SubProbe", event: "tool_end", toolCallId: "t1", status: "completed", text: "y".repeat(5000) });
  await send(c, { kind: "activity", subagent: "SubProbe", event: "text", text: "all done" });
  await send(c, { kind: "progress", taskCallId: "tc1", entries: [
    { id: "SubProbe", agent: "sonic", status: "running", assignment: "# Target\nRun echo", lastIntent: "Run probe" },
  ] });
  await send(c, { kind: "done", subagent: "SubProbe", status: "completed", message: "ok" });
  // A stale "running" after done must not resurrect the card.
  await send(c, { kind: "progress", taskCallId: "tc1", entries: [{ id: "SubProbe", agent: "sonic", status: "running" }] });
  await send(c, { kind: "done", subagent: "Ghost", status: "failed", message: "boom" });
  await new Promise((r) => setTimeout(r, 200));
  c.end();
  w.p.stdin.end();
  const { code } = await w.exited;
  assert.equal(code, 3, "child exit code propagates");
  assert.equal(fs.existsSync(sock), false, "socket unlinked on exit");

  const frames = lines(w.st.raw).map((l) => JSON.parse(l)); // every line is whole JSON
  const echo = frames.find((f) => f.id === 1);
  assert.deepEqual(echo, { jsonrpc: "2.0", id: 1, result: { echo: "hello", pad: "x".repeat(64) } });
  const idx = (pred) => frames.findIndex(pred);
  const echoAt = frames.indexOf(echo);
  const firstAct = idx((f) => f.method === "_kiro.dev/session/update");
  assert.ok(firstAct > echoAt, "activity injected only after the split child line completed");
  assert.equal(firstAct, echoAt + 1, "activity sent mid-line was queued and flushed at the line boundary");

  const acts = frames.filter((f) => f.method === "_kiro.dev/session/update");
  assert.deepEqual(acts[0].params, { sessionId: "omp:SubProbe", update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "bash: echo hi" } });
  const ghostAct = idx((f) => f.method === "_kiro.dev/session/update" && f.params.sessionId === "omp:Ghost");
  const ghostRoster = idx((f) => f.method === "_kiro.dev/subagent/list_update" && f.params.subagents.some((s) => s.sessionId === "omp:Ghost"));
  assert.ok(ghostRoster !== -1 && ghostRoster < ghostAct, "synthesized roster entry precedes first activity");
  assert.deepEqual(frames[ghostAct].params.update, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "boo" } });
  const end = acts.find((f) => f.params.update.sessionUpdate === "tool_call_update");
  assert.deepEqual(end.params.update, { sessionUpdate: "tool_call_update", toolCallId: "t1", title: "bash: echo hi", status: "completed" });
  const tailChunk = acts[acts.indexOf(end) + 1].params.update;
  assert.equal(tailChunk.sessionUpdate, "agent_message_chunk");
  assert.ok(tailChunk.content.text.length <= 2001, "tool_end text bounded");

  const rosters = frames.filter((f) => f.method === "_kiro.dev/subagent/list_update");
  const mid = rosters.find((r) => r.params.subagents[0].status.message === "bash: echo hi");
  assert.ok(mid, "running card message = last activity tool title");
  const last = rosters.at(-1).params.subagents;
  assert.deepEqual(last.map((s) => [s.sessionId, s.status]), [
    ["omp:SubProbe", { type: "completed", message: "ok" }],
    ["omp:Ghost", { type: "failed", message: "boom" }],
  ]);
  assert.equal(last[1].initialQuery, "Ghost");
});

// Whole lines only: the fake child writes each echo in two halves.
const frames = (raw) => lines(raw.slice(0, raw.lastIndexOf("\n") + 1)).map((l) => JSON.parse(l));
const rosterFrames = (raw) => frames(raw).filter((f) => f.method === "_kiro.dev/subagent/list_update");
const promptLine = (id) => JSON.stringify({ jsonrpc: "2.0", id, method: "session/prompt", params: { sessionId: "s", prompt: [{ type: "text", text: "go" }] } }) + "\n";

test("runs: a reused id is a card of its own; ended runs leave at the next prompt, live ones are re-announced", async () => {
  const { dir, fake } = setup();
  const w = runWrapper({ PI_ACP_REAL: fake, KIROCREW_SCRATCH: dir });
  const sock = (await w.until((raw) => lines(raw).map((l) => JSON.parse(l)).find((f) => f.method === "fake/env"))).params.sock;
  const c = await connect(sock);
  const lastRoster = () => rosterFrames(w.st.raw).at(-1)?.params.subagents.map((s) => [s.sessionId, s.sessionName, s.status.type]);
  const rosterIs = (want) => w.until(() => JSON.stringify(lastRoster()) === JSON.stringify(want) && lastRoster());

  // Turn 1: Scout runs and ends; Long keeps going.
  w.p.stdin.write(promptLine(10));
  await send(c, { kind: "progress", taskCallId: "tc1", entries: [
    { id: "Scout", agent: "scout", status: "running", assignment: "map it" },
    { id: "Long", agent: "task", status: "running", assignment: "keep going" },
  ] });
  await send(c, { kind: "done", subagent: "Scout", status: "completed" });
  await rosterIs([["omp:Scout", "Scout", "completed"], ["omp:Long", "Long", "working"]]);
  const before = rosterFrames(w.st.raw).length;

  // Turn 2: Scout's end was shown, so it leaves; Long is announced again for the new turn's tracker.
  w.p.stdin.write(promptLine(11));
  await rosterIs([["omp:Long", "Long", "working"]]);
  assert.equal(rosterFrames(w.st.raw).length, before + 1, "one re-announcement, not a list per entry");

  // The parent reuses the name Scout: a new run, a new sessionId, its activity tagged with it.
  await send(c, { kind: "activity", subagent: "Scout", event: "tool_start", toolCallId: "x1", title: "read: a" });
  await rosterIs([["omp:Long", "Long", "working"], ["omp:Scout.2", "Scout", "working"]]);
  const act = await w.until((raw) => frames(raw).find((f) => f.method === "_kiro.dev/session/update"));
  assert.deepEqual(act.params, { sessionId: "omp:Scout.2", update: { sessionUpdate: "tool_call", toolCallId: "x1", title: "read: a" } });
  // The task call that started run 2 reports it (its first activity came before any progress).
  await send(c, { kind: "progress", taskCallId: "tc2", entries: [{ id: "Scout", agent: "scout", status: "running", assignment: "again" }] });
  await send(c, { kind: "done", subagent: "Scout", status: "failed", message: "boom" });
  await rosterIs([["omp:Long", "Long", "working"], ["omp:Scout.2", "Scout", "failed"]]);
  // A later task call reusing the name is a new run.
  await send(c, { kind: "progress", taskCallId: "tc3", entries: [{ id: "Scout", agent: "scout", status: "running", assignment: "third" }] });
  await rosterIs([["omp:Long", "Long", "working"], ["omp:Scout.2", "Scout", "failed"], ["omp:Scout.3", "Scout", "working"]]);
  await send(c, { kind: "done", subagent: "Scout", status: "completed" });
  // A stale tool_end of a finished run does not start another one.
  await send(c, { kind: "activity", subagent: "Scout", event: "tool_end", toolCallId: "x1", status: "completed", text: "" });
  await send(c, { kind: "done", subagent: "Long", status: "completed" });
  await rosterIs([["omp:Long", "Long", "completed"], ["omp:Scout.2", "Scout", "failed"], ["omp:Scout.3", "Scout", "completed"]]);

  // Turn 3: everything ended and was shown — nothing is re-announced.
  const n = rosterFrames(w.st.raw).length;
  w.p.stdin.write(promptLine(12));
  await w.until((raw) => frames(raw).some((f) => f.id === 3));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(rosterFrames(w.st.raw).length, n);
  c.end();
  w.p.stdin.end();
  await w.exited;
});

test("roster is capped; the oldest ended run goes first", async () => {
  const { dir, fake } = setup();
  const w = runWrapper({ PI_ACP_REAL: fake, KIROCREW_SCRATCH: dir });
  const sock = (await w.until((raw) => lines(raw).map((l) => JSON.parse(l)).find((f) => f.method === "fake/env"))).params.sock;
  const c = await connect(sock);
  await send(c, { kind: "progress", taskCallId: "tc", entries: [{ id: "Live0", agent: "task", status: "running" }] });
  const ended = Array.from({ length: 300 }, (_, i) => ({ id: `E${i}`, agent: "task", status: "completed" }));
  await send(c, { kind: "progress", taskCallId: "tc", entries: ended });
  const list = await w.until((raw) => rosterFrames(raw).find((f) => f.params.subagents.some((s) => s.sessionId === "omp:E299"))?.params.subagents);
  assert.equal(list.length, 256);
  assert.equal(list[0].sessionId, "omp:Live0", "a live run outlives every ended one");
  assert.equal(list[1].sessionId, "omp:E45", "the 45 oldest ended runs were evicted");
  c.end();
  w.p.stdin.end();
  await w.exited;
});

const INIT = JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: 1 } });
const INIT_RESULT = { protocolVersion: 1, agentCapabilities: { loadSession: true }, _meta: { other: { keep: 1 } } };
const TEXT = '<user_message>\nalso say "PINEAPPLE" — ü\n</user_message>';
const steerLine = (id, sessionId, message = TEXT) => JSON.stringify({ jsonrpc: "2.0", id, method: "_session/steer", params: { sessionId, message } });

test("missing socket dir degrades to pure passthrough", async () => {
  const { dir, fake } = setup();
  const w = runWrapper({ PI_ACP_REAL: fake, KIROCREW_SCRATCH: path.join(dir, "nope", "missing"), KIROCREW_OMP_BRIDGE_SOCK: "/stale/sock" });
  w.p.stdin.write(INIT + "\n");
  w.p.stdin.write("a\n");
  w.p.stdin.write(steerLine(9, "S1") + "\n");
  w.p.stdin.end();
  const { code } = await w.exited;
  assert.equal(code, 3);
  const frames = lines(w.st.raw).map((l) => JSON.parse(l));
  assert.deepEqual(frames, [
    { jsonrpc: "2.0", method: "fake/env", params: { sock: null, argv: [] } },
    { jsonrpc: "2.0", id: 0, result: INIT_RESULT }, // no steer advertisement
    { jsonrpc: "2.0", id: 2, result: { echo: "a", pad: "x".repeat(64) } },
    { jsonrpc: "2.0", id: 3, result: { echo: steerLine(9, "S1"), pad: "x".repeat(64) } }, // not intercepted
  ]);
});

/** Lines a socket peer receives from the wrapper. */
function reader(conn) {
  const msgs = [];
  const st = { buf: "", wake: () => {} };
  conn.setEncoding("utf8");
  conn.on("data", (d) => {
    st.buf += d;
    let i;
    while ((i = st.buf.indexOf("\n")) !== -1) { msgs.push(JSON.parse(st.buf.slice(0, i))); st.buf = st.buf.slice(i + 1); }
    st.wake();
  });
  const until = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout; got " + JSON.stringify(msgs))), ms);
    const check = () => { const v = msgs.find(pred); if (v) { clearTimeout(t); st.wake = () => {}; resolve(v); } else st.wake = check; };
    check();
  });
  return { msgs, until };
}

test("steering: initialize advertisement, stdin passthrough, routing, answers, consumed echo", async () => {
  const { dir, fake } = setup();
  const w = runWrapper({ PI_ACP_REAL: fake, KIROCREW_SCRATCH: dir });
  const whole = () => lines(w.st.raw.slice(0, w.st.raw.lastIndexOf("\n") + 1)); // complete lines only
  const all = () => whole().map((l) => JSON.parse(l));
  const sock = (await w.until(() => all().find((f) => f.method === "fake/env"))).params.sock;
  const byId = (id) => w.until(() => all().find((f) => f.id === id && !("method" in f)));
  const rawById = (id) => w.until(() => whole().find((l) => l.startsWith(`{"jsonrpc":"2.0","id":${id},`)));

  // initialize: advertised, other _meta kept; a roster injected while half the result is out stays outside it.
  w.p.stdin.write(INIT + "\n");
  const reporter = await connect(sock);
  await new Promise((r) => setTimeout(r, 100));
  await send(reporter, { kind: "progress", taskCallId: "t", entries: [{ id: "Sub", agent: "a", status: "running" }] });
  const init = await byId(0);
  assert.deepEqual(init.result, {
    ...INIT_RESULT,
    agentCapabilities: { loadSession: true, mcpCapabilities: { http: true, sse: true } }, // mcp-bridge.ts speaks both
    _meta: { other: { keep: 1 }, "kiro.dev/steer": { supported: true } },
  });
  const at = (pred) => all().findIndex(pred);
  const roster = at((f) => f.method === "_kiro.dev/subagent/list_update");
  assert.ok(roster !== -1 && roster < at((f) => f.id === 0), "injected while the result line was held, outside it");

  // Ordinary frames reach pi-acp byte for byte, partial writes included.
  const odd = '{"jsonrpc":"2.0","id":5,"method":"session/prompt","params":{"sessionId":"S1","prompt":[{"type":"text","text":"say \\"_session/steer\\" and \\"initialize\\" ü"}]}}';
  w.p.stdin.write(odd.slice(0, 20));
  await new Promise((r) => setTimeout(r, 50));
  w.p.stdin.write(odd.slice(20) + "\nnot json\n");
  await w.until(() => all().find((f) => f.result?.echo === "not json"));
  assert.ok(all().some((f) => f.result?.echo === odd));

  // No shim yet.
  w.p.stdin.write(steerLine(10, "S1") + "\n");
  assert.deepEqual((await byId(10)).error, { code: -32000, message: "steer not delivered: no omp process for this session" });
  w.p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 19, method: "_session/steer", params: { sessionId: "S1" } }) + "\n");
  assert.equal((await byId(19)).error.code, -32602);

  // A shim for S1: delivered, `{queued:true}` on its ack, then the echo with Crew's own text.
  const shim = await connect(sock);
  const fromWrapper = reader(shim);
  await send(shim, { kind: "shim", pid: 1, sessionId: "S1", turn: true });
  await new Promise((r) => setTimeout(r, 50));
  w.p.stdin.write(steerLine(11, "S1") + "\n");
  const m11 = await fromWrapper.until((m) => m.kind === "steer");
  assert.deepEqual(m11, { kind: "steer", ref: m11.ref, message: TEXT });
  await send(shim, { kind: "steer_result", ref: m11.ref, ok: true });
  assert.equal(await rawById(11), '{"jsonrpc":"2.0","id":11,"result":{"queued":true}}');
  await send(shim, { kind: "steer_consumed", ref: m11.ref, message: "the shim's copy is not used" });
  const echo = await w.until(() => all().find((f) => f.params?.update?.sessionUpdate === "steering_consumed"));
  assert.deepEqual(echo, { jsonrpc: "2.0", method: "session/update", params: { sessionId: "S1", update: { sessionUpdate: "steering_consumed", content: TEXT } } });
  assert.ok(whole().some((l) => l.includes(JSON.stringify(TEXT))), "content serialized from the exact request string");

  // Another session, a refusal, a drop, consumed-before-ack, a vanished shim.
  w.p.stdin.write(steerLine(12, "S2") + "\n");
  assert.equal((await byId(12)).error.message, "steer not delivered: no omp process for this session");
  let lastRef = m11.ref;
  const steerAnd = async (id, reply) => {
    w.p.stdin.write(steerLine(id, "S1") + "\n");
    const m = await fromWrapper.until((x) => x.kind === "steer" && x.ref > lastRef);
    lastRef = m.ref;
    if (reply) await send(shim, reply(m.ref));
    return m;
  };
  await steerAnd(13, (ref) => ({ kind: "steer_result", ref, ok: false, error: "no omp turn in flight" }));
  assert.equal((await byId(13)).error.message, "steer not delivered: no omp turn in flight");
  await steerAnd(14, (ref) => ({ kind: "steer_dropped", ref }));
  assert.equal((await byId(14)).error.message, "steer not delivered: the turn ended before omp used it");
  await steerAnd(15, (ref) => ({ kind: "steer_consumed", ref, message: TEXT }));
  const r15 = await byId(15);
  assert.deepEqual(r15.result, { queued: true });
  const echoes = () => all().filter((f) => f.params?.update?.sessionUpdate === "steering_consumed");
  await w.until(() => echoes().length === 2);
  const echoAt = all().map((f, i) => (f.params?.update?.sessionUpdate === "steering_consumed" ? i : -1)).filter((i) => i >= 0);
  assert.ok(at((f) => f.id === 15 && !("method" in f)) < echoAt[1], "answer precedes its echo");
  await steerAnd(16, null);
  shim.end();
  assert.equal((await byId(16)).error.message, "steer not delivered: the omp process went away");

  // The only shim, unnamed: addressable for any session.
  const shim2 = await connect(sock);
  const from2 = reader(shim2);
  await send(shim2, { kind: "shim", pid: 2, sessionId: null, turn: true });
  await new Promise((r) => setTimeout(r, 50));
  w.p.stdin.write(steerLine(17, "S9") + "\n");
  const m17 = await from2.until((m) => m.kind === "steer");
  await send(shim2, { kind: "steer_result", ref: m17.ref, ok: true });
  assert.deepEqual((await byId(17)).result, { queued: true });

  shim2.end();
  reporter.end();
  w.p.stdin.end();
  assert.equal((await w.exited).code, 3);
  const echoed = all().filter((f) => f.result?.echo !== undefined).map((f) => f.result.echo);
  assert.deepEqual(echoed, [odd, "not json"], "pi-acp saw no steer request");
});

test("session mcpServers: handed off before pi-acp sees session/new|load, 0600, emptied, cleaned up", async () => {
  const { dir, fake } = setup();
  const w = runWrapper({ PI_ACP_REAL: fake, KIROCREW_SCRATCH: dir });
  const all = () => lines(w.st.raw.slice(0, w.st.raw.lastIndexOf("\n") + 1)).map((l) => JSON.parse(l));
  const byId = (id) => w.until(() => all().find((f) => f.id === id && !("method" in f)));
  await w.until(() => all().find((f) => f.method === "fake/env"));
  const want = path.join(dir, `omp-bridge-${w.p.pid}.mcp.json`);

  const stdio = { name: "crew-probe", command: "node", args: ["probe.mjs"], env: [{ name: "TOKEN", value: "s3cret" }] };
  const http = { type: "http", name: "remote", url: "http://127.0.0.1:9/mcp", headers: [{ name: "Authorization", value: "Bearer x" }] };
  w.p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: dir, mcpServers: [stdio, http] } }) + "\n");
  assert.deepEqual((await byId(1)).result.handoff, { path: want, mode: 0o600, servers: [stdio, http] });

  // A load replaces it whole; the line itself still reaches pi-acp unchanged.
  w.p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/load", params: { sessionId: "S", cwd: dir, mcpServers: [http] } }) + "\n");
  assert.deepEqual((await byId(2)).result.handoff.servers, [http]);

  // No servers: nothing for the next shim to load.
  w.p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "session/new", params: { cwd: dir, mcpServers: [] } }) + "\n");
  assert.deepEqual((await byId(3)).result.handoff, { path: want, servers: null });
  assert.equal(fs.existsSync(want), false);

  // Other methods never touch it.
  w.p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "session/new", params: { cwd: dir, mcpServers: [stdio] } }) + "\n");
  await byId(4);
  w.p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 5, method: "session/prompt", params: { sessionId: "S", mcpServers: [] } }) + "\n");
  await w.until(() => all().find((f) => f.result?.echo?.includes('"id":5')));
  assert.deepEqual(JSON.parse(fs.readFileSync(want, "utf8")), [stdio]);

  w.p.stdin.end();
  await w.exited;
  assert.equal(fs.existsSync(want), false, "handoff unlinked on exit");
});

test("session mcpServers: no handoff and no advertisement when the bridge is down", async () => {
  const { dir, fake } = setup();
  const w = runWrapper({ PI_ACP_REAL: fake, KIROCREW_SCRATCH: path.join(dir, "nope", "missing"), KIROCREW_OMP_MCP_HANDOFF: "/stale/handoff" });
  w.p.stdin.write(INIT + "\n");
  w.p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: dir, mcpServers: [{ name: "x", command: "y" }] } }) + "\n");
  w.p.stdin.end();
  await w.exited;
  const frames = lines(w.st.raw).map((l) => JSON.parse(l));
  assert.deepEqual(frames.find((f) => f.id === 0).result, INIT_RESULT);
  assert.deepEqual(frames.find((f) => f.id === 1).result.handoff, { path: null });
});
