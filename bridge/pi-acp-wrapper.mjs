#!/usr/bin/env node
// ACP-side proxy for the omp ↔ Kiro Crew subagent bridge.
// Spawns the real pi-acp (argv passthrough, stderr inherited), forwards its stdout
// line-for-line, and injects `_kiro.dev/subagent/list_update` and
// `_kiro.dev/session/update` notifications — built from what the shim and the omp
// reporter send to our Unix socket — only between whole child lines.
// Subagent roster: one entry per subagent RUN (`omp:<id>`, a re-run of the same id is
// `omp:<id>.2`, …), capped at MAX_ROSTER. Crew's card tracker is per turn, so on each
// `session/prompt` the runs whose end Crew was already shown leave the roster and the
// ones still going are announced again.
// Mid-turn steering (see protocol.mjs and pi-shim.mjs for the turn-window rules):
// - Crew's stdin is piped (not inherited) and split into lines. `_session/steer`
//   requests are answered here and never reach pi-acp; every other byte goes to
//   pi-acp unchanged (a line is held until its newline; one over MAX_LINE streams
//   through; backpressure and EOF are propagated).
// - pi-acp's `initialize` result gets `_meta["kiro.dev/steer"] = {supported: true}`.
// - A steer goes to the shim whose announced ACP sessionId matches (or the only shim,
//   if it named none); Crew gets `{queued: true}` once omp acked it (or a JSON-RPC
//   error), and a `session/update` `steering_consumed` echo — carrying the exact
//   `message` Crew sent — once omp injected it into the running turn.
// Session MCP servers (pi-acp accepts `mcpServers` and never hands them to pi):
// - The `mcpServers` of each `session/new` / `session/load` is written (0600, atomic)
//   to the handoff file named by $KIROCREW_OMP_MCP_HANDOFF before the line reaches
//   pi-acp, which spawns the shim for that session next; the shim takes the file
//   over and loads mcp-bridge.ts into omp, which mounts the servers as tools. An
//   empty array removes the file. One pi-acp per Crew session, so the latest
//   request is the one the next spawn belongs to.
// - pi-acp's `initialize` result advertises `mcpCapabilities: {http: true, sse: true}`
//   (mcp-bridge.ts speaks both; stdio is ACP's baseline) when mcp-bridge.ts exists.
// pi-acp's session map (see pi-acp-store.mjs):
// - pi-acp runs with `--import pi-acp-preload.mjs` (when present), so its writes of
//   ~/.pi/pi-acp/session-map.json are atomic and a concurrent reader can no longer read
//   a half-written map as empty and write that back.
// - Before a `session/load` reaches pi-acp, an id the map lacks (or whose file is gone)
//   is restored from omp's own session file: pi-acp's fallback lookup cannot find omp
//   sessions, so without the entry the load fails with "Unknown sessionId".
// Fail-open: if the socket cannot be created this is a pure passthrough (stdin
// inherited, nothing rewritten, no steering or MCP advertised), and no bridge error
// may alter or stall the child's stream.
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENV_SOCK, METHOD_LIST_UPDATE, METHOD_SESSION_UPDATE, SESSION_PREFIX, MAX_TOOL_TEXT, socketPathFor, privateDirFor, tail,
  METHOD_STEER, META_STEER, KIND_SHIM, KIND_STEER, KIND_STEER_RESULT, KIND_STEER_CONSUMED, KIND_STEER_DROPPED,
  ENV_MCP_HANDOFF,
} from "./protocol.mjs";
import { recoverOmpSession } from "./pi-acp-store.mjs";

const REAL = process.env.PI_ACP_REAL
  || path.join(os.homedir(), ".kiro", "crew", "pi-acp", "node_modules", "pi-acp", "dist", "index.js");
const DEBOUNCE_MS = 50;
const MAX_LINE = 4 << 20;
const NL = 0x0a;
const MCP_BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp-bridge.ts");
const PRELOAD = path.join(path.dirname(fileURLToPath(import.meta.url)), "pi-acp-preload.mjs");
const SESSION_MCP_METHODS = new Set(["session/new", "session/load"]);

// ------------------------------------------------------------ stdout splicer
let midLine = false; // child stdout is mid-frame: injections must wait
let injectQ = [];
const writeOut = (buf) => { try { process.stdout.write(buf); } catch {} };
const inject = (obj) => {
  try {
    const line = JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\n";
    if (midLine) injectQ.push(line); else writeOut(line);
  } catch {}
};
const flushInjected = () => {
  if (midLine || injectQ.length === 0) return;
  const q = injectQ;
  injectQ = [];
  writeOut(q.join(""));
};
process.stdout.on("error", () => {});

// ------------------------------------------------------------ roster
// One entry per subagent RUN, keyed by its Crew sessionId. omp ids are names the parent
// picks, so one id can run again (a later task call, a later turn): each run gets its
// own sessionId — `omp:<id>`, then `omp:<id>.2`, … (omp ids never contain ".") — so
// Crew shows it as a card of its own instead of reopening or swallowing the old one.
const MAX_ROSTER = 256;   // entries per list_update; past it the oldest finished run goes first
const MAX_RUN_IDS = 1024; // ids whose run count is remembered
const roster = new Map();  // sessionId -> entry, insertion order = first seen
const current = new Map(); // omp id -> its latest run's entry (always also in roster)
const runSeq = new Map();  // omp id -> runs started, oldest-touched first
let lastListJson = "";
let debounce = null;

const LIVE = new Set(["", "pending", "running", "queued", "in_progress", "working", "starting"]);
const DONE = new Set(["completed", "complete", "success", "succeeded", "done", "finished"]);
const mapStatus = (s) => {
  s = String(s ?? "").toLowerCase();
  if (LIVE.has(s)) return "working";
  if (DONE.has(s)) return "completed";
  if (["failed", "failure", "error", "errored", "cancelled", "canceled", "aborted", "killed", "timeout", "timed_out"].includes(s)) return "failed";
  return "working";
};
const str = (v, n = 200) => {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

const dropEntry = (e) => {
  roster.delete(e.sessionId);
  if (current.get(e.id) === e) current.delete(e.id);
};

/** Start a new run of `id`; a run it supersedes that never reported an end has ended. */
const newRun = (id) => {
  const prev = current.get(id);
  if (prev && !prev.terminal) { prev.type = "completed"; prev.terminal = true; }
  const n = (runSeq.get(id) ?? 0) + 1;
  runSeq.delete(id);
  runSeq.set(id, n);
  if (runSeq.size > MAX_RUN_IDS) runSeq.delete(runSeq.keys().next().value);
  if (roster.size >= MAX_ROSTER) {
    let victim = null;
    for (const r of roster.values()) if (r.terminal) { victim = r; break; }
    dropEntry(victim ?? roster.values().next().value);
  }
  const e = { id, sessionId: SESSION_PREFIX + id + (n > 1 ? `.${n}` : ""), agent: "", assignment: "", task: "",
    lastIntent: "", recentTool: "", lastToolTitle: "", error: "", type: "working", message: "", taskCallId: "",
    terminal: false, announced: false, endAnnounced: false, titles: new Map() };
  roster.set(e.sessionId, e);
  current.set(id, e);
  return e;
};

const crewEntry = (e) => {
  let message;
  if (e.type === "working") message = e.lastToolTitle || e.recentTool || e.lastIntent || "";
  else if (e.type === "failed") message = e.error || e.message || "failed";
  else message = e.message || "";
  const role = e.agent || "subagent";
  return {
    sessionId: e.sessionId,
    sessionName: e.id,
    role,
    agentName: role,
    initialQuery: e.assignment || e.task || e.id,
    status: { type: e.type, message: str(message.replace(/\s+/g, " ").trim(), 200) },
  };
};

const emitList = () => {
  if (debounce) { clearTimeout(debounce); debounce = null; }
  const subagents = [...roster.values()].map(crewEntry);
  const json = JSON.stringify(subagents);
  if (json === lastListJson) return;
  lastListJson = json;
  for (const e of roster.values()) { e.announced = true; e.endAnnounced = e.terminal; }
  inject({ method: METHOD_LIST_UPDATE, params: { subagents } });
};
const scheduleList = () => { if (!debounce) debounce = setTimeout(emitList, DEBOUNCE_MS); };
// Crew drops activity for a sessionId it has not seen in a roster.
const ensureAnnounced = (e) => { if (!e.announced) emitList(); };

/**
 * Crew sent `session/prompt`: a new turn, whose card tracker starts empty. Runs whose end
 * Crew was already shown leave the roster — re-announcing them would mint a fresh card
 * per old run every turn — and the runs still going are announced again at once, since
 * the new turn has not seen them and the list is otherwise re-sent only on a change.
 */
function onPrompt() {
  if (debounce) emitList();
  for (const e of [...roster.values()]) if (e.endAnnounced) dropEntry(e);
  lastListJson = "";
  for (const e of roster.values()) e.announced = false;
  if (roster.size) scheduleList();
}

function onProgress(m) {
  if (!Array.isArray(m.entries)) return;
  const taskCallId = str(m.taskCallId, 200);
  for (const p of m.entries) {
    const id = str(p?.id, 200);
    if (!id) continue;
    const type = mapStatus(p.status);
    let e = current.get(id);
    // Same id reused by a later task call: a fresh run.
    if (!e || (taskCallId && e.taskCallId && e.taskCallId !== taskCallId && type === "working")) e = newRun(id);
    if (taskCallId) e.taskCallId = taskCallId;
    if (p.agent) e.agent = str(p.agent, 100);
    if (p.assignment) e.assignment = str(p.assignment, 4000);
    if (p.task) e.task = str(p.task, 4000);
    if (p.lastIntent) e.lastIntent = str(p.lastIntent, 200);
    const t = Array.isArray(p.recentTools) ? p.recentTools[0] : null;
    if (t?.tool) e.recentTool = str(t.args ? `${t.tool}: ${t.args}` : t.tool, 200);
    if (p.error) e.error = str(p.error, 1000);
    if (!e.terminal) {
      e.type = type;
      e.terminal = type !== "working";
    }
  }
  scheduleList();
}

function onActivity(m) {
  const id = str(m.subagent, 200);
  if (!id) return;
  const toolCallId = str(m.toolCallId, 200);
  const starts = (m.event === "tool_start" && toolCallId) || (m.event === "text" && typeof m.text === "string" && m.text);
  if (!starts && !(m.event === "tool_end" && toolCallId)) return; // nothing usable; do not invent a card
  let e = current.get(id);
  const known = Boolean(e);
  // A finished run reports nothing more (the reporter closes its socket after `done`),
  // so a child that is working again under the same id is a new run.
  if (!e || (e.terminal && starts)) e = newRun(id);
  const sessionId = e.sessionId;
  if (m.event === "tool_start" && toolCallId) {
    const title = str(m.title, 200) || "tool";
    e.lastToolTitle = title;
    if (e.titles.size > 500) e.titles.clear();
    e.titles.set(toolCallId, title);
    if (known) scheduleList();
    ensureAnnounced(e);
    inject({ method: METHOD_SESSION_UPDATE, params: { sessionId, update: { sessionUpdate: "tool_call", toolCallId, title } } });
  } else if (m.event === "tool_end" && toolCallId) {
    const status = m.status === "failed" ? "failed" : "completed";
    const title = str(m.title, 200) || e.titles.get(toolCallId) || "tool";
    e.titles.delete(toolCallId);
    ensureAnnounced(e);
    inject({ method: METHOD_SESSION_UPDATE, params: { sessionId, update: { sessionUpdate: "tool_call_update", toolCallId, title, status } } });
    const text = tail(m.text, MAX_TOOL_TEXT);
    if (text) inject({ method: METHOD_SESSION_UPDATE, params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: text.endsWith("\n") ? text : text + "\n" } } } });
  } else {
    ensureAnnounced(e);
    inject({ method: METHOD_SESSION_UPDATE, params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: m.text } } } });
  }
}

function onDone(m) {
  const id = str(m.subagent, 200);
  if (!id) return;
  const e = current.get(id) ?? newRun(id);
  e.type = m.status === "failed" ? "failed" : "completed";
  e.terminal = true;
  if (m.message) e.message = str(m.message, 1000);
  scheduleList();
}

// ------------------------------------------------------------ steering
const STEER_ACK_MS = 5000; // Crew's steer request is answered with an error if omp has not acked by then
const ERR_STEER = -32000;  // JSON-RPC error code: steer not delivered
const shims = new Map();   // socket -> { sessionId, turn }: connections that announced a shim
const steers = new Map();  // ref -> { id, sessionId, message, conn, answered, timer }
let steerSeq = 0;

const writeConn = (conn, obj) => { try { conn.write(JSON.stringify(obj) + "\n"); } catch {} };

/** Answer Crew's steer request once: `{queued: true}`, or an error naming why it was not delivered. */
function answerSteer(e, error) {
  if (e.answered) return;
  e.answered = true;
  clearTimeout(e.timer);
  if (e.id === undefined) return; // sent as a notification: no answer expected
  inject(error
    ? { id: e.id, error: { code: ERR_STEER, message: `steer not delivered: ${error}` } }
    : { id: e.id, result: { queued: true } });
}

/** The shim socket to steer ACP session `sid` through, or why there is none. */
function routeSteer(sid) {
  const named = [];
  for (const [conn, s] of shims) if (s.sessionId === sid) named.push(conn);
  // A shim that never named its session is addressable only as the sole one.
  const only = shims.size === 1 ? [...shims][0] : null;
  const candidates = named.length ? named : only && !only[1].sessionId ? [only[0]] : [];
  if (candidates.length === 0) return "no omp process for this session";
  // The shim owns the turn window; its `turn` flag only breaks a tie (pi-acp briefly
  // runs two for one session while session/load replaces a process).
  if (candidates.length === 1) return candidates[0];
  const live = candidates.filter((c) => shims.get(c).turn);
  return live.length === 1 ? live[0] : live.length ? "several omp processes claim this session" : "no turn in flight";
}

function onSteerRequest(msg) {
  const p = msg.params;
  const e = { id: msg.id ?? undefined, sessionId: p?.sessionId, message: p?.message, conn: null, answered: false, timer: null };
  if (typeof e.sessionId !== "string" || typeof e.message !== "string" || !e.message) {
    e.answered = true;
    if (e.id !== undefined) inject({ id: e.id, error: { code: -32602, message: "_session/steer needs params.sessionId and a non-empty params.message" } });
    return;
  }
  const target = routeSteer(e.sessionId);
  if (typeof target === "string") return answerSteer(e, target);
  const ref = ++steerSeq;
  e.conn = target;
  e.timer = setTimeout(() => answerSteer(e, "omp did not acknowledge it"), STEER_ACK_MS);
  e.timer.unref();
  steers.set(ref, e);
  writeConn(target, { kind: KIND_STEER, ref, message: e.message });
}

function onShimMessage(m, conn) {
  if (m.kind === KIND_SHIM) {
    shims.set(conn, { sessionId: typeof m.sessionId === "string" && m.sessionId ? m.sessionId : null, turn: m.turn === true });
    return;
  }
  const e = steers.get(m.ref);
  if (!e || e.conn !== conn) return;
  if (m.kind === KIND_STEER_RESULT) {
    if (m.ok === true) return answerSteer(e, null);
    steers.delete(m.ref);
    answerSteer(e, str(m.error, 500) || "refused");
  } else if (m.kind === KIND_STEER_CONSUMED) {
    steers.delete(m.ref);
    answerSteer(e, null);
    // Our own copy of the text: byte-identical to Crew's request whatever the shim echoed.
    inject({ method: "session/update", params: { sessionId: e.sessionId, update: { sessionUpdate: "steering_consumed", content: e.message } } });
  } else if (m.kind === KIND_STEER_DROPPED) {
    steers.delete(m.ref);
    answerSteer(e, "the turn ended before omp used it");
  }
}

function onConnClose(conn) {
  if (!shims.delete(conn)) return;
  for (const [ref, e] of steers) {
    if (e.conn !== conn) continue;
    steers.delete(ref);
    answerSteer(e, "the omp process went away");
  }
}

function onMessage(line, conn) {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (!m || typeof m !== "object") return;
  try {
    if (m.kind === "progress") onProgress(m);
    else if (m.kind === "activity") onActivity(m);
    else if (m.kind === "done") onDone(m);
    else onShimMessage(m, conn);
  } catch {}
}

// ------------------------------------------------------------ Crew → pi-acp (bridge live only)
const initIds = new Set(); // JSON-encoded ids of `initialize` requests pi-acp has not answered yet
const idKey = (id) => JSON.stringify(id);

/**
 * Hand a session/new|load's `mcpServers` to the shim pi-acp spawns next: written whole
 * (temp file + rename, 0600 — elements carry credentials) or, when empty/absent, removed.
 */
function handOffMcp(servers) {
  if (!mcpHandoff) return;
  if (!Array.isArray(servers) || servers.length === 0) {
    try { fs.unlinkSync(mcpHandoff); } catch {}
    return;
  }
  const tmp = `${mcpHandoff}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(servers), { mode: 0o600 });
    fs.renameSync(tmp, mcpHandoff);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    process.stderr.write(`pi-acp-wrapper: cannot hand off mcpServers: ${e?.message ?? e}\n`);
  }
}

/** Put back pi-acp's map entry for the session a session/load names (fail-open). */
function ensureLoadable(params) {
  try {
    const how = recoverOmpSession(params?.sessionId, params?.cwd);
    if (how === "recovered" || how === "unreadable") {
      process.stderr.write(`pi-acp-wrapper: session/load ${params.sessionId}: session map entry ${how === "recovered" ? "restored from omp's session file" : "unreadable, left as is"}\n`);
    }
  } catch (e) {
    process.stderr.write(`pi-acp-wrapper: session/load ${params?.sessionId}: cannot check the session map: ${e?.message ?? e}\n`);
  }
}

/** One whole Crew line (Buffer, newline included). True: handled here, not for pi-acp. */
function interceptLine(line) {
  try {
    if (line.indexOf('"_session/steer"') === -1 && line.indexOf('"initialize"') === -1
      && line.indexOf('"session/new"') === -1 && line.indexOf('"session/load"') === -1
      && line.indexOf('"session/prompt"') === -1) return false;
    const msg = JSON.parse(line.toString("utf8"));
    if (msg?.method === METHOD_STEER) { onSteerRequest(msg); return true; }
    if (msg?.method === "initialize" && msg.id !== undefined && msg.id !== null) initIds.add(idKey(msg.id));
    else if (msg?.method === "session/prompt") onPrompt();
    else if (SESSION_MCP_METHODS.has(msg?.method)) {
      if (msg.method === "session/load") ensureLoadable(msg.params);
      if (mcpHandoff) handOffMcp(msg.params?.mcpServers);
    }
  } catch {}
  return false;
}

function pipeStdin(sink) {
  sink.on("error", () => {});
  let part = [];          // the current, incomplete line
  let partLen = 0;
  let streaming = false;  // the current line outgrew MAX_LINE: it flows through as it comes
  let waiting = false;
  const forward = (buf) => {
    if (buf.length === 0 || sink.write(buf) || waiting) return;
    waiting = true;
    process.stdin.pause();
    sink.once("drain", () => { waiting = false; process.stdin.resume(); });
  };
  process.stdin.on("data", (chunk) => {
    let start = 0, nl;
    while ((nl = chunk.indexOf(NL, start)) !== -1) {
      const seg = chunk.subarray(start, nl + 1);
      start = nl + 1;
      if (streaming) { streaming = false; forward(seg); continue; }
      const line = partLen ? Buffer.concat([...part, seg]) : seg;
      part = [];
      partLen = 0;
      if (!interceptLine(line)) forward(line);
    }
    if (start === chunk.length) return;
    const rest = chunk.subarray(start);
    if (streaming) return forward(rest);
    part.push(rest);
    partLen += rest.length;
    if (partLen > MAX_LINE) { forward(Buffer.concat(part)); part = []; partLen = 0; streaming = true; }
  });
  process.stdin.on("end", () => {
    if (partLen) forward(Buffer.concat(part));
    part = [];
    partLen = 0;
    sink.end();
  });
  process.stdin.on("error", () => { try { sink.end(); } catch {} });
}

/** A whole pi-acp line while an initialize result is due: that result gains the bridge's advertisements. */
function advertise(line) {
  if (line.indexOf('"result"') === -1 && line.indexOf('"error"') === -1) return line;
  try {
    const msg = JSON.parse(line.toString("utf8"));
    if (msg?.id === undefined || !initIds.delete(idKey(msg.id))) return line;
    const r = msg.result;
    if (!bridge || !r || typeof r !== "object" || Array.isArray(r)) return line;
    const meta = r._meta && typeof r._meta === "object" && !Array.isArray(r._meta) ? r._meta : {};
    r._meta = { ...meta, [META_STEER]: { supported: true } };
    const caps = r.agentCapabilities;
    if (mcpHandoff && caps && typeof caps === "object" && !Array.isArray(caps)) {
      const mcp = caps.mcpCapabilities && typeof caps.mcpCapabilities === "object" ? caps.mcpCapabilities : {};
      caps.mcpCapabilities = { ...mcp, http: true, sse: true };
    }
    return Buffer.from(JSON.stringify(msg) + "\n");
  } catch {
    return line;
  }
}

// ------------------------------------------------------------ socket server
async function listen() {
  const sockPath = socketPathFor(process.pid);
  try { fs.unlinkSync(sockPath); } catch {}
  const server = net.createServer((conn) => {
    let buf = "";
    conn.setEncoding("utf8");
    conn.on("error", () => {});
    conn.on("close", () => onConnClose(conn));
    conn.on("data", (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line) onMessage(line, conn);
      }
      if (buf.length > MAX_LINE) buf = ""; // oversized frame: drop it
    });
  });
  server.on("error", () => {});
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(sockPath, () => { server.off("error", reject); resolve(); });
  });
  try { fs.chmodSync(sockPath, 0o600); } catch {}
  server.unref();
  return { server, sockPath };
}

// ------------------------------------------------------------ main
let bridge = null;
try { bridge = await listen(); } catch { bridge = null; }
// Session MCP forwarding rides the same live-bridge condition as steering: it needs Crew's
// lines parsed, which only happens when stdin is piped.
let mcpHandoff = null;
if (bridge && fs.existsSync(MCP_BRIDGE)) mcpHandoff = path.join(privateDirFor(bridge.sockPath), `omp-bridge-${process.pid}.mcp.json`);
const cleanup = () => {
  if (mcpHandoff) {
    try { fs.unlinkSync(mcpHandoff); } catch {}
    mcpHandoff = null;
  }
  if (!bridge) return;
  try { bridge.server.close(); } catch {}
  try { fs.unlinkSync(bridge.sockPath); } catch {}
  bridge = null;
};

const env = { ...process.env };
if (bridge) env[ENV_SOCK] = bridge.sockPath; else delete env[ENV_SOCK];
if (mcpHandoff) env[ENV_MCP_HANDOFF] = mcpHandoff; else delete env[ENV_MCP_HANDOFF];

const preload = fs.existsSync(PRELOAD) ? ["--import", PRELOAD] : [];
const child = spawn(process.execPath, [...preload, REAL, ...process.argv.slice(2)], { stdio: [bridge ? "pipe" : "inherit", "pipe", "inherit"], env });
for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => { try { child.kill(s); } catch {} });
if (bridge) pipeStdin(child.stdin);

let outPart = []; // a pi-acp line held back while an initialize result is due
let outPartLen = 0;
const passChunk = (buf) => {
  const last = buf.lastIndexOf(NL);
  if (last === -1) { midLine = true; writeOut(buf); return; }
  if (last === buf.length - 1) {
    writeOut(buf);
    midLine = false;
    flushInjected();
  } else {
    // Complete lines, then the injections, then the partial tail.
    writeOut(buf.subarray(0, last + 1));
    midLine = false;
    flushInjected();
    writeOut(buf.subarray(last + 1));
    midLine = true;
  }
};
// While an initialize result is due, only whole lines go out (so it can be rewritten);
// otherwise chunks pass through untouched.
const scanChunk = (buf) => {
  let start = 0, nl;
  while ((nl = buf.indexOf(NL, start)) !== -1) {
    const seg = buf.subarray(start, nl + 1);
    start = nl + 1;
    const line = outPartLen ? Buffer.concat([...outPart, seg]) : seg;
    outPart = [];
    outPartLen = 0;
    writeOut(initIds.size ? advertise(line) : line);
  }
  flushInjected(); // only whole lines were written
  if (start === buf.length) return;
  const rest = buf.subarray(start);
  if (initIds.size && outPartLen + rest.length <= MAX_LINE) { outPart.push(rest); outPartLen += rest.length; return; }
  writeOut(outPartLen ? Buffer.concat([...outPart, rest]) : rest);
  outPart = [];
  outPartLen = 0;
  midLine = true;
};
child.stdout.on("data", (buf) => {
  if (midLine || (initIds.size === 0 && outPartLen === 0)) passChunk(buf);
  else scanChunk(buf);
});

child.on("error", (err) => {
  cleanup();
  process.stderr.write(`pi-acp-wrapper: cannot start ${REAL}: ${err.message}\n`);
  process.exit(127);
});
child.on("close", (code, sig) => {
  cleanup();
  if (outPartLen) writeOut(Buffer.concat(outPart));
  if (debounce) emitList();
  if (sig) {
    process.removeAllListeners(sig);
    process.kill(process.pid, sig);
  } else process.exit(code ?? 1);
});
process.on("exit", cleanup);
