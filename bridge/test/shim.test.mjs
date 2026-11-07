// pi-shim.mjs against a fake omp. The shim + protocol are copied into temp dirs so
// the reporter.ts-present / -absent cases are real filesystem states.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const FIXTURE = path.join(HERE, "fixtures", "task-frames.jsonl"); // captured omp `task` frames
const GATE = "/opt/gate/kiro_crew_tool_gate.ts";

// Fake omp: prints its argv, then ready + available_commands_update; on `prompt`
// replays the captured task frames and session_settled (or, for the "fail" and
// "partial-fail" messages, a provider-rejected assistant message); answers
// `negotiate_protocol` and, like omp's v2 encoder, splits frames over 1 MiB into
// `rpc_chunk` lines once negotiated (v1 answers oversized responses with an error);
// exits on stdin EOF. With FAKE_DIE set it instead dies at startup like omp does on
// an unresumable session: a Bun-style stack dump on stderr, exit 1, no `ready`.
// FAKE_CMDS_ON_EOF holds the command list until stdin closes (omp still in startup:
// session_start waiting on what only the client's hang-up settles); FAKE_EXIT_DELAY_MS
// stretches the exit after EOF (omp's dispose: memory, MCP teardown).
const FAKE_OMP = `
import readline from "node:readline";
import fs from "node:fs";
const out = (o) => process.stdout.write((typeof o === "string" ? o : JSON.stringify(o)) + "\\n");
if (process.argv.includes("--version")) { out("omp/fake"); process.exit(0); }
if (process.env.FAKE_DIE) {
  process.stderr.write("noise before the end\\n632509 |       throw new Error(\`Could not restore model \${ht[0]}\`);\\n                     ^\\n"
    + "error: Could not restore model prov/mdl\\n      at lUu (/$bunfs/root/omp-linux-x64:632509:13)\\n\\n");
  process.exit(1);
}
const mcpFile = process.env.KIROCREW_OMP_MCP_SERVERS_FILE ?? null;
let mcpBody = null;
try { mcpBody = mcpFile && JSON.parse(fs.readFileSync(mcpFile, "utf8")); } catch {}
out({ type: "fake_argv", argv: process.argv.slice(2), gateTarget: process.env.KIROCREW_OMP_GATE_TARGET ?? null,
  mcpFile, mcpBody, mcpHandoff: process.env.KIROCREW_OMP_MCP_HANDOFF ?? null });
out({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2] });
const cmdList = { type: "available_commands_update", commands: [
  { name: "model", description: "m", source: "builtin" },
  { name: "kiro-crew-gate", description: "Kiro Crew tool gate", source: "extension" },
] };
if (!process.env.FAKE_CMDS_ON_EOF) out(cmdList);
let v2 = false;
let chunkIds = 0;
const big = (frame) => {
  const bytes = Buffer.from(JSON.stringify(frame), "utf8");
  if (bytes.length + 1 <= 1048576) return out(frame);
  if (!v2) return out(frame.type === "response"
    ? { id: frame.id, type: "response", command: frame.command, success: false, error: "RPC response exceeded the transport limit" }
    : { type: "rpc_frame_error", originalType: frame.type, error: "RPC frame exceeded the transport limit" });
  const chunkId = "rpc-" + ++chunkIds, count = Math.ceil(bytes.length / 262144);
  for (let index = 0; index < count; index++) out({ type: "rpc_chunk", chunkId, index, count, byteLength: bytes.length,
    data: bytes.subarray(index * 262144, (index + 1) * 262144).toString("base64") });
};
const failed = (content) => ({ role: "assistant", content, api: "openai-completions", provider: "prov", model: "mdl",
  stopReason: "error", timestamp: 1791631176232, errorStatus: 403, errorMessage: "403 Access to model denied." });
// Steering, like omp 18: steers queue (queue_update) and a run injects them as a user message
// with steering:true; remove_queued_message / abort_and_restore_queue take them back out; abort
// keeps the queue, and an idle omp with a queued steer starts a fresh run with it (the drain;
// FAKE_DRAIN_MS, 0 = synchronously). Prompt modes: "steerable" injects a steer and ends,
// "hold" never injects and ends only on abort, "race" settles just before taking the steer.
let queue = [];
let running = null;
const drainMs = Number(process.env.FAKE_DRAIN_MS ?? 30);
const steerMsg = (text) => ({ role: "user", content: [{ type: "text", text }], steering: true, attribution: "user", timestamp: 1 });
const queueUpdate = () => out({ type: "queue_update", steering: queue.slice(), followUp: [], liveSteered: 0 });
const inject = () => {
  const text = queue.shift();
  queueUpdate();
  out({ type: "turn_start" });
  out({ type: "message_start", message: steerMsg(text), messageId: "m-s" });
  out({ type: "message_end", message: steerMsg(text), messageId: "m-s" });
  out({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "ack: " + text } });
};
const endRun = () => {
  running = null;
  out({ type: "agent_end", isTerminal: true });
  out({ type: "fake_queue", steering: queue.slice() });
  out({ type: "session_settled" });
};
const drain = () => {
  if (running || !queue.length) return;
  running = { mode: "drain" };
  out({ type: "agent_start" });
  inject();
  endRun();
};
const scheduleDrain = () => (drainMs === 0 ? drain() : setTimeout(drain, drainMs));
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const f = JSON.parse(line);
  if (process.env.FAKE_LOG_CMDS) out({ type: "fake_got", cmd: f });
  if (f.type === "negotiate_protocol") {
    out({ id: f.id, type: "response", command: "negotiate_protocol", success: true, data: { protocolVersion: 2 } });
    v2 = true;
    return;
  }
  if (f.type === "get_messages") {
    big({ type: "tool_execution_update", toolCallId: "huge", toolName: "bash", partialResult: { content: [{ type: "text", text: "y".repeat(2000000) }] } });
    const messages = Array.from({ length: 300 }, (_, i) => ({ role: "user", content: "é".repeat(2500) + i }));
    big({ id: f.id, type: "response", command: "get_messages", success: true, data: { messages } });
    return;
  }
  if (f.type === "get_state") return out({ id: f.id, type: "response", command: "get_state", success: true, data: { sessionId: "sess-1", steeringMode: "one-at-a-time" } });
  if (f.type === "steer") {
    // omp queues a steer asynchronously; FAKE_STEER_DELAY_MS stretches that gap.
    const take = () => {
      if (running?.mode === "race") endRun(); // settled just before the steer landed
      queue.push(f.message);
      queueUpdate();
      out({ id: f.id, type: "response", command: "steer", success: true });
      if (running?.mode === "steerable") setTimeout(() => { if (running && queue.length) { inject(); endRun(); scheduleDrain(); } }, 20);
      else if (!running) scheduleDrain();
    };
    if (process.env.FAKE_STEER_DELAY_MS) setTimeout(take, Number(process.env.FAKE_STEER_DELAY_MS));
    else take();
    return;
  }
  if (f.type === "remove_queued_message") {
    const i = queue.indexOf(f.message);
    if (i >= 0) { queue.splice(i, 1); queueUpdate(); }
    return out({ id: f.id, type: "response", command: "remove_queued_message", success: true, data: { removed: i >= 0 } });
  }
  if (f.type === "abort_and_restore_queue" || f.type === "abort") {
    const steering = f.type === "abort" ? null : queue.splice(0).map((text) => ({ text }));
    if (running) endRun();
    out({ id: f.id, type: "response", command: f.type, success: true, ...(steering ? { data: { steering, followUp: [] } } : {}) });
    scheduleDrain();
    return;
  }
  if (f.type !== "prompt") return;
  out({ id: f.id, type: "response", command: "prompt", success: true });
  if (["steerable", "hold", "race"].includes(f.message)) {
    running = { mode: f.message };
    out({ type: "agent_start" });
    out({ type: "turn_start" });
    return;
  }
  if (f.message === "fail" || f.message === "partial-fail") {
    const text = f.message === "partial-fail" ? [{ type: "text", text: "Hel" }] : [];
    out({ type: "message_start", message: failed([]), messageId: "msg-3" });
    if (text.length) out({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hel", partial: failed(text) }, message: failed(text), messageId: "msg-3" });
    out({ type: "message_end", message: { ...failed(text), completedAt: 1 }, messageId: "msg-3" });
    out({ type: "turn_end", message: failed(text), toolResults: [] });
    out({ type: "session_settled" });
    return;
  }
  for (const l of fs.readFileSync(process.env.FAKE_FRAMES, "utf8").split("\\n")) if (l) out(l);
  out({ type: "tool_execution_update", toolCallId: "other", toolName: "bash", partialResult: { content: [{ type: "text", text: "raw" }] } });
  out({ type: "session_settled" });
}).on("close", () => {
  if (process.env.FAKE_CMDS_ON_EOF) out(cmdList);
  // exit only once big frames are flushed
  setTimeout(() => process.stdout.write("", () => process.exit(0)), Number(process.env.FAKE_EXIT_DELAY_MS ?? 0));
});
`;

function stage(withReporter, withRelay = false, withMcp = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "okb-s-"));
  for (const f of ["pi-shim.mjs", "protocol.mjs"]) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  if (withReporter) fs.writeFileSync(path.join(dir, "reporter.ts"), "export default function () {}\n");
  if (withRelay) fs.writeFileSync(path.join(dir, "gate-relay.ts"), "export default function () {}\n");
  if (withMcp) fs.writeFileSync(path.join(dir, "mcp-bridge.ts"), "export default function () {}\n");
  const omp = path.join(dir, "fake-omp.mjs");
  fs.writeFileSync(omp, FAKE_OMP);
  const bin = path.join(dir, "omp");
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${omp}" "$@"\n`, { mode: 0o755 });
  return { dir, bin, shim: path.join(dir, "pi-shim.mjs"), reporter: path.join(dir, "reporter.ts"), relay: path.join(dir, "gate-relay.ts"),
    mcp: path.join(dir, "mcp-bridge.ts") };
}

// Stands in for the wrapper's socket: collects messages, can write back to the latest client.
async function listenSock(dir) {
  const sockPath = path.join(dir, "bridge.sock");
  const msgs = [];
  const st = { conn: null, wake: () => {} };
  const server = net.createServer((c) => {
    let buf = "";
    st.conn = c;
    c.setEncoding("utf8");
    c.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) !== -1) { msgs.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
      st.wake();
    });
  });
  await new Promise((r) => server.listen(sockPath, r));
  const send = (obj) => st.conn.write(JSON.stringify(obj) + "\n");
  const until = (pred, ms = 5000) => waitFor(() => msgs.find(pred), (w) => { st.wake = w; }, () => JSON.stringify(msgs), ms);
  return { sockPath, msgs, server, send, until };
}

/** Resolve with the first truthy `probe()`, re-checked whenever `arm(wake)`'s wake fires. */
function waitFor(probe, arm, dump, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout; so far: " + dump())), ms);
    const check = () => { const v = probe(); if (v) { clearTimeout(t); arm(() => {}); resolve(v); } else arm(check); };
    check();
  });
}

/** The shim with stdin kept open (we play pi-acp line by line). */
const live = new Set(); // killed after the suite so a failed test cannot hang it
after(() => { for (const p of live) p.kill("SIGKILL"); });

function startShim(s, env = {}) {
  const p = spawn(process.execPath, [s.shim, ...BASE_ARGS], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, OMP_BIN: s.bin, FAKE_FRAMES: FIXTURE, FAKE_LOG_CMDS: "1", ...env },
  });
  live.add(p);
  p.on("close", () => live.delete(p));
  const frames = [];
  const st = { buf: "", wake: () => {} };
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (d) => {
    st.buf += d;
    let i;
    while ((i = st.buf.indexOf("\n")) !== -1) { frames.push(JSON.parse(st.buf.slice(0, i))); st.buf = st.buf.slice(i + 1); }
    st.wake();
  });
  const exited = new Promise((r) => p.on("close", (code) => r(code)));
  const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
  const until = (pred, ms = 5000) => waitFor(() => frames.find(pred), (w) => { st.wake = w; }, () => JSON.stringify(frames.slice(-15)), ms);
  const got = () => frames.filter((f) => f.type === "fake_got").map((f) => f.cmd); // what omp received
  return { p, frames, send, until, exited, got };
}

async function runShim(s, args, stdinLines, env = {}) {
  const p = spawn(process.execPath, [s.shim, ...args], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, OMP_BIN: s.bin, FAKE_FRAMES: FIXTURE, ...env },
  });
  let raw = "";
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (d) => { raw += d; });
  for (const l of stdinLines) p.stdin.write(JSON.stringify(l) + "\n");
  p.stdin.end();
  const [code] = await new Promise((r) => p.on("close", (...a) => r(a)));
  return { code, frames: raw.split("\n").filter(Boolean).map((l) => JSON.parse(l)) };
}

const STDIN = [{ type: "get_commands", id: "g1" }, { type: "prompt", id: "p1", message: "go" }];
const BASE_ARGS = ["--mode", "rpc", "--no-themes", "--session", "/s/sess.jsonl", "--extension", GATE];

test("rpc mode: args, reporter, get_commands, settled mirror, task table, progress feed", async () => {
  const s = stage(true);
  const sock = await listenSock(s.dir);
  const { code, frames } = await runShim(s, BASE_ARGS, STDIN, { KIROCREW_OMP_BRIDGE_SOCK: sock.sockPath });
  assert.equal(code, 0);

  const argv = frames.find((f) => f.type === "fake_argv").argv;
  assert.deepEqual(argv, ["--mode", "rpc", "--resume", "/s/sess.jsonl", "--extension", GATE, "--extension", s.reporter]);

  const gc = frames.find((f) => f.id === "g1");
  assert.equal(gc.success, true);
  const gate = gc.data.commands.find((c) => c.name === "kiro-crew-gate");
  assert.deepEqual(gate.sourceInfo, { path: GATE });
  assert.equal(gc.data.commands.find((c) => c.name === "model").sourceInfo, undefined);

  const settled = frames.findIndex((f) => f.type === "session_settled");
  assert.deepEqual(frames[settled + 1], { type: "agent_settled" });

  const orig = fs.readFileSync(FIXTURE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const task = frames.filter((f) => f.toolName === "task");
  assert.equal(task.length, orig.length);
  task.forEach((f, i) => {
    const o = orig[i];
    const res = f.partialResult ?? f.result;
    const ores = o.partialResult ?? o.result;
    assert.deepEqual(res.details, ores.details, "details never altered");
    assert.deepEqual({ ...f, partialResult: undefined, result: undefined }, { ...o, partialResult: undefined, result: undefined });
    const text = res.content[0].text;
    const row = text.split("\n")[0];
    const p = ores.details.progress[0];
    assert.match(row, new RegExp(`^SubProbe · sonic · ${p.status} · `));
    if (f.type === "tool_execution_end") assert.ok(text.endsWith("\n\n" + ores.content[0].text), "final report preserved");
    else assert.equal(text, row);
  });
  const lastRow = task.at(-1).partialResult.content[0].text;
  assert.equal(lastRow, "SubProbe · sonic · completed · deepseek/deepseek-v4-flash:low · Run probe command · yield · tools=2 · 2.9s · $0.0003");
  const running = task.find((f) => f.partialResult?.details.progress[0].recentTools.length === 1);
  assert.match(running.partialResult.content[0].text, / · bash: echo SUB_PROBE · tools=\d+ · /);
  assert.deepEqual(frames.find((f) => f.toolCallId === "other").partialResult.content[0].text, "raw", "non-task tools untouched");

  await new Promise((r) => setTimeout(r, 100));
  sock.server.close();
  const shimMsgs = sock.msgs.filter((m) => m.kind === "shim");
  assert.equal(sock.msgs[0].kind, "shim", "the shim announces itself first");
  assert.ok(shimMsgs.every((m) => m.sessionId === null && m.pid > 0), "no get_state yet: session unnamed");
  assert.ok(shimMsgs.some((m) => m.turn === true), "turn window opened on the prompt");
  assert.equal(shimMsgs.at(-1).turn, false, "and closed on session_settled");
  const progress = sock.msgs.filter((m) => m.kind !== "shim");
  assert.equal(progress.length, orig.length, "one progress message per task frame");
  for (const m of progress) {
    assert.equal(m.kind, "progress");
    assert.equal(m.taskCallId, "toolu_019uPJ3bPtMG9mxbNcEfzbkK");
    assert.equal(m.entries[0].id, "SubProbe");
    assert.equal(m.entries[0].agent, "sonic");
    assert.equal(m.entries[0].extractedToolData, undefined);
  }
  assert.equal(progress.at(-1).entries[0].status, "completed");
  assert.equal(progress.at(-1).entries[0].resolvedModel, "deepseek/deepseek-v4-flash:low");
});

test("reporter absent: not appended; no socket: still works", async () => {
  const s = stage(false);
  const { code, frames } = await runShim(s, BASE_ARGS, STDIN, { KIROCREW_OMP_BRIDGE_SOCK: path.join(s.dir, "missing.sock") });
  assert.equal(code, 0);
  assert.deepEqual(frames.find((f) => f.type === "fake_argv").argv, ["--mode", "rpc", "--resume", "/s/sess.jsonl", "--extension", GATE]);
  assert.deepEqual(frames.find((f) => f.id === "g1").data.commands.find((c) => c.name === "kiro-crew-gate").sourceInfo, { path: GATE });
  assert.ok(frames.some((f) => f.type === "agent_settled"));
  assert.match(frames.find((f) => f.toolName === "task").partialResult.content[0].text, /^SubProbe · sonic · pending · /);
});

test("Crew read-back (get_commands, EOF): EOF reaches a still-starting omp, late list answers it, exit 0 before omp's slow shutdown", async () => {
  const s = stage(false);
  const t0 = Date.now();
  const { code, frames } = await runShim(s, BASE_ARGS, [{ type: "get_commands", id: "kiro-crew-gate-readback" }],
    { FAKE_CMDS_ON_EOF: "1", FAKE_EXIT_DELAY_MS: "6000" });
  const took = Date.now() - t0;
  assert.equal(code, 0);
  const gc = frames.find((f) => f.id === "kiro-crew-gate-readback");
  assert.equal(gc?.success, true, "answered from omp's command list, not given up on");
  assert.deepEqual(gc.data.commands.find((c) => c.name === "kiro-crew-gate").sourceInfo, { path: GATE });
  assert.ok(took < 4000, `exited ${took} ms after start: must not wait out omp's 6 s shutdown`);
});

test("hang-up after a command reached omp: output still relayed until omp exits", async () => {
  const s = stage(false);
  const t0 = Date.now();
  const { code, frames } = await runShim(s, BASE_ARGS, STDIN, { FAKE_EXIT_DELAY_MS: "1500" });
  assert.equal(code, 0);
  assert.ok(Date.now() - t0 >= 1500, "waited for omp's own exit");
  assert.equal(frames.find((f) => f.id === "g1").success, true);
  assert.ok(frames.some((f) => f.type === "agent_settled"), "the prompt's turn reached pi-acp");
});

test("explicit reporter arg is not duplicated nor used for attribution", async () => {
  const s = stage(true);
  const { frames } = await runShim(s, [...BASE_ARGS, "--extension", s.reporter], STDIN);
  assert.deepEqual(frames.find((f) => f.type === "fake_argv").argv,
    ["--mode", "rpc", "--resume", "/s/sess.jsonl", "--extension", GATE, "--extension", s.reporter]);
  assert.deepEqual(frames.find((f) => f.id === "g1").data.commands.find((c) => c.name === "kiro-crew-gate").sourceInfo, { path: GATE });
});

test("non-rpc passthrough: no reporter, args translated", async () => {
  const s = stage(true);
  const p = spawn(process.execPath, [s.shim, "--version", "--no-themes"], { env: { ...process.env, OMP_BIN: s.bin } });
  let out = "";
  p.stdout.on("data", (d) => { out += d; });
  const code = await new Promise((r) => p.on("close", r));
  assert.equal(code, 0);
  assert.equal(out.trim(), "omp/fake");
});

const gateOf = (frames) => frames.find((f) => f.id === "g1").data.commands.find((c) => c.name === "kiro-crew-gate").sourceInfo;

test("gate relay: Crew gate swapped for gate-relay.ts, target in env, attribution unchanged", async () => {
  const s = stage(false, true);
  const { code, frames } = await runShim(s, BASE_ARGS, STDIN, { KIROCREW_OMP_GATE_TARGET: "/stale" });
  assert.equal(code, 0);
  const fa = frames.find((f) => f.type === "fake_argv");
  assert.deepEqual(fa.argv, ["--mode", "rpc", "--resume", "/s/sess.jsonl", "--extension", s.relay]);
  assert.equal(fa.gateTarget, GATE);
  assert.deepEqual(gateOf(frames), { path: GATE });
});

test("gate relay: Crew's sealed gate copy (kirocrew_pi_gate_<pid>.ts) is the Crew gate too", async () => {
  const s = stage(false, true);
  const sealed = "/h/.kiro/crew/pi-gate/kirocrew_pi_gate_1839178.ts";
  const args = ["--mode", "rpc", "--no-themes", "--extension", sealed];
  const { frames } = await runShim(s, args, STDIN);
  const fa = frames.find((f) => f.type === "fake_argv");
  assert.deepEqual(fa.argv, ["--mode", "rpc", "--extension", s.relay]);
  assert.equal(fa.gateTarget, sealed);
  assert.deepEqual(gateOf(frames), { path: sealed }, "the read-back still names Crew's file");
  // Launcher scripts and look-alikes are not gates.
  for (const p of ["/h/kirocrew_pi_gate_1839178_ab12.sh", "/h/kirocrew_pi_gate_x.ts"]) {
    const other = (await runShim(s, ["--mode", "rpc", "--extension", p], STDIN)).frames.find((f) => f.type === "fake_argv");
    assert.equal(other.gateTarget, null, p);
  }
});

test("gate relay: --extension= form keeps its shape", async () => {
  const s = stage(true, true);
  const { frames } = await runShim(s, ["--mode=rpc", "-e", "/x/other.ts", "--extension=" + GATE], STDIN);
  const fa = frames.find((f) => f.type === "fake_argv");
  assert.deepEqual(fa.argv, ["--mode=rpc", "-e", "/x/other.ts", "--extension=" + s.relay, "--extension", s.reporter]);
  assert.equal(fa.gateTarget, GATE);
});

test("gate relay: relay absent or two Crew gates -> args untouched, no env var", async () => {
  const absent = stage(false);
  let fa = (await runShim(absent, BASE_ARGS, STDIN, { KIROCREW_OMP_GATE_TARGET: "/stale" })).frames.find((f) => f.type === "fake_argv");
  assert.deepEqual(fa.argv, ["--mode", "rpc", "--resume", "/s/sess.jsonl", "--extension", GATE]);
  assert.equal(fa.gateTarget, null);
  const two = stage(false, true);
  const other = "/y/kiro_crew_tool_gate.ts";
  fa = (await runShim(two, [...BASE_ARGS, "--extension", other], STDIN)).frames.find((f) => f.type === "fake_argv");
  assert.deepEqual(fa.argv, ["--mode", "rpc", "--resume", "/s/sess.jsonl", "--extension", GATE, "--extension", other]);
  assert.equal(fa.gateTarget, null);
});

test("gate relay: non-rpc mode untouched", async () => {
  const s = stage(false, true);
  const p = spawn(process.execPath, [s.shim, "--extension", GATE], { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, OMP_BIN: s.bin, FAKE_FRAMES: FIXTURE } });
  let out = "";
  p.stdout.on("data", (d) => { out += d; });
  await new Promise((r) => p.on("close", r));
  const fa = out.split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((f) => f.type === "fake_argv");
  assert.deepEqual(fa.argv, ["--extension", GATE]);
  assert.equal(fa.gateTarget, null);
});

test("provider error: surfaced once as a text_delta; after a blank line when text was streamed", async () => {
  const s = stage(false);
  const { frames } = await runShim(s, BASE_ARGS, [{ type: "prompt", id: "p1", message: "fail" }]);
  const deltas = frames.filter((f) => f.type === "message_update");
  assert.equal(deltas.length, 1, "message_end and turn_end both carry the error; inject once");
  assert.equal(deltas[0].assistantMessageEvent.type, "text_delta");
  assert.equal(deltas[0].assistantMessageEvent.delta, "⚠️ Model error (prov/mdl): 403 Access to model denied.");
  assert.equal(deltas[0].messageId, "msg-3");
  assert.equal(frames[frames.indexOf(deltas[0]) + 1].type, "message_end", "injected right before the errored message_end");
  assert.equal(frames.filter((f) => f.type === "message_end" || f.type === "turn_end").length, 2, "originals pass through");
  assert.ok(frames.some((f) => f.type === "agent_settled"));

  const partial = await runShim(s, BASE_ARGS, [{ type: "prompt", id: "p1", message: "partial-fail" }]);
  assert.deepEqual(partial.frames.filter((f) => f.type === "message_update").map((f) => f.assistantMessageEvent.delta),
    ["Hel", "\n\n⚠️ Model error (prov/mdl): 403 Access to model denied."], "mid-stream error appended once");
});

test("protocol v2: oversized response reassembled into one line; other oversized frames get v1 shrink", async () => {
  const s = stage(false);
  const { code, frames } = await runShim(s, BASE_ARGS, [{ type: "get_messages", id: "m1" }]);
  assert.equal(code, 0);
  assert.equal(frames.filter((f) => f.type === "rpc_chunk").length, 0, "no chunk frames reach pi-acp");
  assert.equal(frames.filter((f) => f.command === "negotiate_protocol").length, 0, "negotiation reply swallowed");
  const res = frames.find((f) => f.id === "m1");
  assert.equal(res.success, true);
  assert.equal(res.data.messages.length, 300);
  assert.equal(res.data.messages[299].content, "é".repeat(2500) + 299, "multi-byte text survives chunk boundaries");
  const huge = frames.find((f) => f.toolCallId === "huge");
  assert.ok(Buffer.byteLength(JSON.stringify(huge)) + 1 <= 1024 * 1024, "non-response frame kept within v1's 1 MiB");
  assert.match(huge.partialResult.content[0].text, /^y+\n…\[\d+ chars elided for RPC frame\]$/);
});

test("omp dies at startup: pending and later requests get its error, stderr passes through, exit with its code", async () => {
  const s = stage(false);
  const p = spawn(process.execPath, [s.shim, ...BASE_ARGS], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, OMP_BIN: s.bin, FAKE_FRAMES: FIXTURE, FAKE_DIE: "1" },
  });
  const frames = [];
  let buf = "", stderr = "", wake = () => {};
  p.stdout.setEncoding("utf8");
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) !== -1) { frames.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
    wake();
  });
  p.stderr.setEncoding("utf8");
  p.stderr.on("data", (d) => { stderr += d; });
  p.stdin.on("error", () => {});
  let closed = false;
  const exited = new Promise((r) => p.on("close", (c) => { closed = true; wake(); r(c); }));
  // Resolves early if the shim exits, so a regression fails the asserts instead of hanging.
  const until = (pred) => new Promise((r) => { const check = () => (pred() || closed ? r() : (wake = check)); check(); });
  const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");

  send({ type: "get_state", id: "s1" });
  send({ type: "get_commands", id: "g1" });
  await until(() => frames.some((f) => f.id === "s1") && frames.some((f) => f.id === "g1"));
  // After omp is gone: a later request is still answered; a UI reply expects none.
  send({ type: "extension_ui_response", id: "ui1", cancelled: true });
  send({ type: "get_available_models", id: "m1" });
  await until(() => frames.some((f) => f.id === "m1"));
  p.stdin.end();
  const code = await exited;

  const error = "omp exited (code 1): noise before the end\nerror: Could not restore model prov/mdl";
  assert.deepEqual(frames, [
    { id: "s1", type: "response", command: "get_state", success: false, error },
    { id: "g1", type: "response", command: "get_commands", success: false, error },
    { id: "m1", type: "response", command: "get_available_models", success: false, error },
  ]);
  assert.match(stderr, /error: Could not restore model prov\/mdl\n {6}at lUu/, "omp stderr passes through untouched");
  assert.equal(code, 1);
});

// ---------------------------------------------------------------- mid-turn steering

const TEXT = '<user_message>\nalso say "PINEAPPLE" — ü\n</user_message>';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isBridgeId = (f) => typeof f.id === "string" && f.id.startsWith("omp-kiro-bridge:");
const count = (frames, type) => frames.filter((f) => f.type === type).length;

/** Shim + fake omp + our socket, with the session named and a prompt running in omp. */
async function steerSetup(prompt, env = {}) {
  const s = stage(false);
  const sock = await listenSock(s.dir);
  const sh = startShim(s, { KIROCREW_OMP_BRIDGE_SOCK: sock.sockPath, ...env });
  await sock.until((m) => m.kind === "shim");
  sh.send({ type: "get_state", id: "gs" });
  await sock.until((m) => m.kind === "shim" && m.sessionId === "sess-1");
  if (prompt) {
    sh.send({ type: "prompt", id: "p1", message: prompt });
    await sock.until((m) => m.kind === "shim" && m.turn === true);
  }
  return { s, sock, sh };
}

async function finish(sh, sock) {
  sh.p.stdin.end();
  assert.equal(await sh.exited, 0);
  sock.server.close();
  assert.equal(sh.frames.filter(isBridgeId).length, 0, "no response to a bridge id reaches pi-acp");
}

test("steering: mid-turn steer reaches omp, is acked, then consumed with identical text inside the same turn", async () => {
  const { sock, sh } = await steerSetup("steerable");
  sock.send({ kind: "steer", ref: 7, message: TEXT });
  const consumed = await sock.until((m) => m.kind === "steer_consumed");
  assert.deepEqual(consumed, { kind: "steer_consumed", ref: 7, message: TEXT });
  const result = sock.msgs.find((m) => m.kind === "steer_result");
  assert.deepEqual(result, { kind: "steer_result", ref: 7, ok: true });
  assert.ok(sock.msgs.indexOf(result) < sock.msgs.indexOf(consumed));
  await sh.until((f) => f.type === "agent_settled");
  await sleep(150); // an orphan drain run would show up here
  await finish(sh, sock);

  const steers = sh.got().filter((c) => c.type === "steer");
  assert.equal(steers.length, 1);
  assert.match(steers[0].id, /^omp-kiro-bridge:steer:\d+$/);
  assert.equal(steers[0].message, TEXT);
  assert.equal(sh.got().filter((c) => c.type === "remove_queued_message").length, 0, "nothing to clean up");
  assert.equal(count(sh.frames, "agent_settled"), 1);
  assert.equal(count(sh.frames, "agent_start"), 1);
  const reply = sh.frames.findIndex((f) => f.assistantMessageEvent?.delta === "ack: " + TEXT);
  assert.ok(reply !== -1 && reply < sh.frames.findIndex((f) => f.type === "agent_settled"), "steered reply before the turn settles");
  assert.ok(sh.frames.some((f) => f.type === "message_end" && f.message.steering === true), "omp's own events pass through");
  assert.equal(sock.msgs.filter((m) => m.kind === "shim").at(-1).turn, false);
});

test("steering: refused with no turn in flight; nothing reaches omp", async () => {
  const { sock, sh } = await steerSetup(null);
  sock.send({ kind: "steer", ref: 1, message: TEXT });
  assert.deepEqual(await sock.until((m) => m.kind === "steer_result" && m.ref === 1),
    { kind: "steer_result", ref: 1, ok: false, error: "no omp turn in flight" });
  sh.send({ type: "prompt", id: "p1", message: "go" }); // replay prompt: settles by itself
  await sh.until((f) => f.type === "agent_settled");
  sock.send({ kind: "steer", ref: 2, message: TEXT });
  assert.equal((await sock.until((m) => m.kind === "steer_result" && m.ref === 2)).ok, false, "window closed on session_settled");
  sock.send({ kind: "steer", ref: 3, message: "" });
  assert.equal((await sock.until((m) => m.kind === "steer_result" && m.ref === 3)).error, "empty steer");
  await finish(sh, sock);
  assert.deepEqual(sh.got().map((c) => c.type), ["negotiate_protocol", "get_state", "prompt"]);
});

for (const [name, env] of [["acked", {}], ["ack still due", { FAKE_STEER_DELAY_MS: "150" }]]) {
  test(`steering: cancel with an unconsumed steer (${name}) clears omp's queue before pi-acp's abort; no orphan run`, async () => {
    const { sock, sh } = await steerSetup("hold", env);
    sock.send({ kind: "steer", ref: 1, message: TEXT });
    if (!env.FAKE_STEER_DELAY_MS) await sock.until((m) => m.kind === "steer_result");
    else await sh.until((f) => f.type === "fake_got" && f.cmd.type === "steer");
    sh.send({ type: "abort", id: "a1" });
    await sock.until((m) => m.kind === "steer_dropped" && m.ref === 1);
    const abort = await sh.until((f) => f.id === "a1");
    assert.deepEqual(abort, { id: "a1", type: "response", command: "abort", success: true });
    await sh.until((f) => f.type === "agent_settled");
    await sleep(150); // the fake drains a leftover queue 30 ms after going idle
    await finish(sh, sock);

    const cmds = sh.got().map((c) => c.type);
    assert.deepEqual(cmds.slice(-3), ["steer", "abort_and_restore_queue", "abort"], "queue cleared ahead of pi-acp's abort");
    if (env.FAKE_STEER_DELAY_MS) {
      const queued = sh.frames.findIndex((f) => f.type === "queue_update" && f.steering.length === 1);
      const cleared = sh.frames.findIndex((f) => f.type === "fake_got" && f.cmd.type === "abort_and_restore_queue");
      assert.ok(queued !== -1 && queued < cleared, "abort held until omp had queued (and acked) the steer");
    }
    assert.deepEqual(sh.frames.filter((f) => f.type === "fake_queue").map((f) => f.steering), [[]], "nothing left queued at the end");
    assert.equal(count(sh.frames, "agent_start"), 1, "no orphan run");
    assert.equal(count(sh.frames, "session_settled"), 1);
    assert.equal(count(sh.frames, "agent_settled"), 1);
    assert.ok(!sh.frames.some((f) => f.assistantMessageEvent?.delta === "ack: " + TEXT), "the steer never ran");
    assert.equal(sock.msgs.filter((m) => m.kind === "steer_consumed").length, 0);
  });
}

test("steering: a steer landing as omp settles is pulled back out of its queue (slow drain)", async () => {
  const { sock, sh } = await steerSetup("race", { FAKE_DRAIN_MS: "400" });
  sock.send({ kind: "steer", ref: 1, message: TEXT });
  await sock.until((m) => m.kind === "steer_dropped" && m.ref === 1);
  await sh.until((f) => f.type === "agent_settled");
  await sleep(600); // past the fake's drain delay
  await finish(sh, sock);
  assert.ok(sh.got().some((c) => c.type === "remove_queued_message" && c.queue === "steering" && c.message === TEXT));
  assert.equal(count(sh.frames, "agent_start"), 1, "no orphan run");
  assert.equal(count(sh.frames, "session_settled"), 1);
  assert.equal(count(sh.frames, "agent_settled"), 1);
  const settled = sh.frames.findIndex((f) => f.type === "session_settled");
  assert.deepEqual(sh.frames[settled + 1], { type: "agent_settled" });
  assert.ok(settled > sh.frames.findIndex((f) => f.type === "queue_update" && f.steering.length === 0 && f.followUp),
    "settle withheld until the steer was removed");
  assert.deepEqual(sock.msgs.find((m) => m.kind === "steer_result"), { kind: "steer_result", ref: 1, ok: true });
});

test("steering: a steer omp drains right after settling is answered inside the same pi-acp turn (fast drain)", async () => {
  const { sock, sh } = await steerSetup("race", { FAKE_DRAIN_MS: "0" });
  sock.send({ kind: "steer", ref: 1, message: TEXT });
  assert.deepEqual(await sock.until((m) => m.kind === "steer_consumed"), { kind: "steer_consumed", ref: 1, message: TEXT });
  await sh.until((f) => f.type === "agent_settled");
  await sleep(150);
  await finish(sh, sock);
  assert.equal(count(sh.frames, "agent_start"), 2, "omp's drain run");
  assert.equal(count(sh.frames, "session_settled"), 1, "the settle before the drain run was withheld");
  assert.equal(count(sh.frames, "agent_settled"), 1);
  const reply = sh.frames.findIndex((f) => f.assistantMessageEvent?.delta === "ack: " + TEXT);
  assert.ok(reply !== -1 && reply < sh.frames.findIndex((f) => f.type === "agent_settled"));
  assert.equal(sock.msgs.filter((m) => m.kind === "steer_dropped").length, 0);
});

const SERVERS = [{ name: "crew-probe", command: "node", args: ["p.mjs"], env: [{ name: "T", value: "s" }] }];
const handoffIn = (s) => {
  const f = path.join(s.dir, "omp-bridge-1.mcp.json");
  fs.writeFileSync(f, JSON.stringify(SERVERS), { mode: 0o600 });
  return f;
};

test("session mcp: handoff taken over, mcp-bridge.ts loaded with its own copy, nothing left behind", async () => {
  const s = stage(false, false, true);
  const handoff = handoffIn(s);
  const { code, frames } = await runShim(s, BASE_ARGS, STDIN, { KIROCREW_OMP_MCP_HANDOFF: handoff, KIROCREW_OMP_MCP_SERVERS_FILE: "/stale" });
  assert.equal(code, 0);
  const fa = frames.find((f) => f.type === "fake_argv");
  assert.deepEqual(fa.argv, ["--mode", "rpc", "--resume", "/s/sess.jsonl", "--extension", GATE, "--extension", s.mcp]);
  assert.match(fa.mcpFile, new RegExp(`^${handoff.replace(/[.]/g, "\\.")}\\.\\d+$`), "a shim-owned name beside the handoff");
  assert.deepEqual(fa.mcpBody, SERVERS);
  assert.equal(fa.mcpHandoff, null, "omp never sees the handoff path");
  assert.equal(fs.existsSync(handoff), false, "consumed: the next session's spawn cannot load it again");
  assert.equal(fs.existsSync(fa.mcpFile), false, "the shim's copy is gone once it exits");
  assert.deepEqual(gateOf(frames), { path: GATE }, "attribution unchanged");
});

test("session mcp: no handoff file, or mcp-bridge.ts absent -> nothing loaded, nothing consumed", async () => {
  const s = stage(false, false, true);
  let fa = (await runShim(s, BASE_ARGS, STDIN, { KIROCREW_OMP_MCP_HANDOFF: path.join(s.dir, "missing.json") })).frames.find((f) => f.type === "fake_argv");
  assert.deepEqual(fa.argv, ["--mode", "rpc", "--resume", "/s/sess.jsonl", "--extension", GATE]);
  assert.equal(fa.mcpFile, null);
  const bare = stage(false);
  const handoff = handoffIn(bare);
  fa = (await runShim(bare, BASE_ARGS, STDIN, { KIROCREW_OMP_MCP_HANDOFF: handoff })).frames.find((f) => f.type === "fake_argv");
  assert.deepEqual(fa.argv, ["--mode", "rpc", "--resume", "/s/sess.jsonl", "--extension", GATE]);
  assert.equal(fa.mcpFile, null);
  assert.equal(fa.mcpHandoff, null);
  assert.equal(fs.existsSync(handoff), true);
});
