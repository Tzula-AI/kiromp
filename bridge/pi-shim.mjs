#!/usr/bin/env node
// Shim: lets pi-acp (Kiro Crew's Pi backend) drive Oh My Pi (omp).
// - Arg translation: pi-acp spawns `pi --mode rpc --no-themes [--session FILE]`;
//   omp has no --no-themes and resumes a session via --resume.
// - RPC gap: omp has no `get_commands`. Crew sends it to verify its tool-gate
//   extension loaded. We answer it from omp's own `available_commands_update`
//   event, attributing extension commands to the -e/--extension file only when
//   exactly one non-bridge extension was passed (so the source path is
//   unambiguous). A command omp did not report is never invented. omp emits that
//   event only once its startup is over (extension session_start, memory, MCP),
//   which on a loaded machine takes well over 15 s, so the request waits for it
//   (or for omp's exit error) with no deadline of ours: Crew's read-back has its own.
// - Hang-up: Crew's read-back writes `get_commands`, closes stdin and waits for our
//   exit. EOF goes to omp at once (it then rejects startup dialogs nobody can answer
//   and exits after startup). When nothing pi-acp sent ever reached omp and every
//   get_commands is answered, omp owes pi-acp nothing more: we exit 0 and leave omp
//   to its own shutdown (session dispose, memory and MCP teardown can take tens of
//   seconds) instead of holding the read-back past its deadline. Once any line went
//   to omp, we still relay omp's output until it exits.
// - Turn completion: pi-acp ends a prompt turn on `agent_settled`; omp emits
//   `session_settled` for the same point, so we mirror it as `agent_settled`.
// - Subagent bridge (see protocol.mjs): in RPC mode, append this directory's
//   reporter.ts extension when present; rewrite the `task` tool's text into a
//   live per-subagent status table (Tier 1); feed `details.progress[]` to the
//   wrapper's socket (Tier 2). Every bridge step is fail-open: on any error the
//   original line passes through untouched.
// - Provider errors: omp reports a rejected request as an assistant message with
//   stopReason "error" + errorMessage and no content; pi-acp ignores errorMessage,
//   so the turn ends silently. When such a message streamed no text we inject one
//   `text_delta` message_update carrying the error, which pi-acp turns into an
//   agent_message_chunk (once per message; message_end and turn_end both carry it).
// - Large frames: omp's v1 RPC caps a line at 1 MiB and answers bigger responses
//   (e.g. get_messages of a long session) with "RPC response exceeded the transport
//   limit". We negotiate protocol v2, where omp splits such frames into `rpc_chunk`
//   lines, and reassemble them: responses go to pi-acp as one JSON line (its
//   readline has no length cap); other oversized frames get omp's own v1 shrink so
//   pi-acp sees exactly what v1 would have sent. If omp declines v2, nothing changes.
// - Early exit: omp exits at startup when it cannot resume (missing session file,
//   saved model without credentials) and pi-acp discards our stderr, so it only saw
//   "Cannot call write after a stream was destroyed". We tee omp's stderr and, when
//   omp dies before `ready` or owing responses, stay up answering every pending and
//   later request with `omp exited (code N): <stderr tail>` until pi-acp closes stdin
//   (or DEAD_GRACE_MS of silence), then exit with omp's status.
// - Mid-turn steering (see protocol.mjs; the wrapper routes Crew's `_session/steer`
//   here over the bridge socket). We announce `{kind:"shim", sessionId, turn}`; the
//   sessionId is omp's first get_state sessionId, which pi-acp adopts as the ACP id.
//   A steer becomes omp RPC `{"id":"omp-kiro-bridge:steer:<n>","type":"steer",…}`;
//   responses to every `omp-kiro-bridge:` id are swallowed (pi-acp never asked).
//   Turn-window rules:
//   1. The window opens when pi-acp's `prompt` goes to omp and closes on omp's
//      session_settled, on pi-acp's `abort`, on a failed or agent-less (local
//      command) prompt response, or when omp exits. Steers outside it are refused,
//      nothing reaches omp, and Crew re-queues them as a normal turn.
//   2. Consumed = omp's `message_end` of a user message with `steering: true` whose
//      text equals a steer we sent (omp keeps the raw text: no prompt-template
//      expansion for non-`/` text, no input handlers in Crew's gate). The wrapper
//      echoes its own copy of the text, so `steering_consumed` is byte-identical.
//   3. No orphan runs: omp keeps a queued steer across abort, restores one a provider
//      took "live", and its idle drain then starts a fresh run with it. So a steer still
//      unconsumed when the window closes is pulled back out: on a settle (or bad prompt
//      response) via `remove_queued_message` (by text, once its ack is in, since omp
//      queues it asynchronously); on pi-acp's `abort` by first sending
//      `abort_and_restore_queue` (drops every queued and live-held user steer) ahead of
//      pi-acp's own `abort`, holding both up to ABORT_WAIT_MS for steer acks still due.
//      Each removed steer is reported dropped; Crew re-queues it at turn end.
//   4. A steer can land just as omp settles (it settles only with an empty queue, but
//      ours may still be in the pipe). While a steer's fate is open, session_settled
//      and its agent_settled mirror are withheld from pi-acp; once every steer is
//      consumed or removed they are released, or discarded when omp started a run
//      meanwhile (it drained the steer) — that run's own settle ends pi-acp's turn, so
//      the steer is answered inside the same prompt.
//   pi-acp ignores message_start/message_end and queue_update, so the injected user
//   message never shows up as assistant text; nothing is rewritten for it.
// - Subagent permission relay: omp's in-process subagents reload CLI extensions with
//   hasUI:false, so Crew's gate refused every subagent tool call ("no permission
//   channel"). In RPC mode the Crew gate's --extension is swapped for gate-relay.ts
//   (target passed via KIROCREW_OMP_GATE_TARGET), which runs the real gate with
//   subagent confirms routed to the parent session's UI; get_commands still
//   attributes to Crew's path. Crew's gate is `kiro_crew_tool_gate.ts` or, since Crew
//   seals a verified copy per gateway, `kirocrew_pi_gate_<gateway pid>.ts`. Only when
//   gate-relay.ts exists and exactly one Crew gate was passed; otherwise args are
//   untouched (the gate keeps blocking).
// - Session MCP servers: in RPC mode, when the wrapper named a handoff file
//   ($KIROCREW_OMP_MCP_HANDOFF, holding the `mcpServers` of the session/new|load that
//   made pi-acp spawn us) and it exists, we take it over (rename to a shim-owned
//   name, so a later session's handoff cannot replace it) and load mcp-bridge.ts with
//   $KIROCREW_OMP_MCP_SERVERS_FILE pointing at it; the extension reads and unlinks
//   it, and we unlink it on exit regardless. No handoff file: nothing is loaded.
import { spawn } from "node:child_process";
import readline from "node:readline";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createBridgeClient, BRIDGE_ID_PREFIX, KIND_SHIM, KIND_STEER, KIND_STEER_RESULT, KIND_STEER_CONSUMED, KIND_STEER_DROPPED,
  ENV_MCP_HANDOFF, ENV_MCP_SERVERS_FILE,
} from "./protocol.mjs";

const OMP = process.env.OMP_BIN || path.join(os.homedir(), ".bun", "bin", "omp");
const RELEASE_FLUSH_MS = 200; // bridge-socket flush allowed before we exit
const REPORTER = path.join(path.dirname(fileURLToPath(import.meta.url)), "reporter.ts");
const GATE_RELAY = path.join(path.dirname(fileURLToPath(import.meta.url)), "gate-relay.ts");
const MCP_BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp-bridge.ts");
// The shipped gate, and the sealed copy Crew loads (kiro_crew/acp/harness/pi.py `sealed_name`).
const isCrewGate = (p) => typeof p === "string" && /^(?:kiro_crew_tool_gate|kirocrew_pi_gate_\d+)\.ts$/.test(path.basename(p));
const NEGOTIATE_ID = BRIDGE_ID_PREFIX + "negotiate";
const ABORT_WAIT_MS = 2000;   // longest pi-acp's abort waits for steer acks still due
const STDERR_TAIL = 2048;     // chars of omp stderr quoted when it dies
const DEAD_GRACE_MS = 10000;  // idle time we keep answering for a dead omp
const RESPONSE_ID = /^\{"id":"((?:[^"\\]|\\.)*)","type":"response"/;
const stripAnsi = (s) => s.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
/** omp's last words: Bun's source excerpt, caret and stack lines dropped (unless that is all there is), last STDERR_TAIL chars. */
function stderrSummary(raw) {
  const text = stripAnsi(raw);
  const kept = text.split("\n").filter((l) => !/^\s*\d+ \| /.test(l) && !/^\s*\^+\s*$/.test(l) && !/^\s+at /.test(l));
  return (kept.join("\n").trim() || text.trim()).slice(-STDERR_TAIL).trim();
}

const inArgs = process.argv.slice(2);
const args = [];
const extPaths = [];
const extArgIdx = []; // index in `args` of each extPaths value, for the gate-relay swap
for (let i = 0; i < inArgs.length; i++) {
  const a = inArgs[i];
  if (a === "--no-themes") continue;
  if (a === "--session") { args.push("--resume", inArgs[++i]); continue; }
  if (a.startsWith("--session=")) { args.push("--resume=" + a.slice(10)); continue; }
  if (a === "--extension" || a === "-e") { extPaths.push(inArgs[i + 1]); extArgIdx.push(args.length + 1); }
  else if (a.startsWith("--extension=")) { extPaths.push(a.slice(12)); extArgIdx.push(args.length); }
  args.push(a);
}

const exitLike = (code, sig) => {
  if (sig) {
    // Our own forwarding handler would swallow the re-raised signal.
    process.removeAllListeners(sig);
    process.kill(process.pid, sig);
  } else {
    // process.exit drops queued pipe writes (a reassembled response can be MiBs);
    // exit once stdout has drained, or after a grace period if the reader stalls.
    const exit = () => process.exit(code ?? 1);
    setTimeout(exit, 2000);
    process.stdout.write("", exit);
  }
};

const rpc = args.some((a, i) => (a === "--mode" && args[i + 1] === "rpc") || a === "--mode=rpc");
if (!rpc) {
  const c = spawn(OMP, args, { stdio: "inherit" });
  c.on("exit", exitLike);
  for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => c.kill(s));
} else {
  runRpc();
}

function isReporter(p) {
  try { return typeof p === "string" && path.resolve(p) === REPORTER; } catch { return false; }
}

function runRpc() {
  let hasReporter = false;
  try { hasReporter = fs.statSync(REPORTER).isFile(); } catch {}
  if (hasReporter && !extPaths.some(isReporter)) args.push("--extension", REPORTER);
  // The reporter registers no commands; Crew checks `kiro-crew-gate` comes from ITS file,
  // so attribution keeps the original gate path even when gate-relay.ts loads it.
  const cmdExtPaths = extPaths.filter((p) => !isReporter(p));
  const env = { ...process.env };
  delete env.KIROCREW_OMP_GATE_TARGET; // set only when we swap in the relay
  try {
    const gates = extPaths.flatMap((p, k) => (isCrewGate(p) ? [k] : []));
    const at = extArgIdx[gates[0]];
    if (gates.length === 1 && fs.statSync(GATE_RELAY).isFile() && typeof args[at] === "string") {
      args[at] = args[at].startsWith("--extension=") ? "--extension=" + GATE_RELAY : GATE_RELAY;
      env.KIROCREW_OMP_GATE_TARGET = path.resolve(extPaths[gates[0]]);
    }
  } catch {}
  // The handoff is consumed (renamed) by exactly one omp start; neither name leaks to omp's tools.
  const handoff = env[ENV_MCP_HANDOFF];
  delete env[ENV_MCP_HANDOFF];
  delete env[ENV_MCP_SERVERS_FILE];
  if (handoff) {
    const own = `${handoff}.${process.pid}`;
    try {
      if (!fs.statSync(MCP_BRIDGE).isFile()) throw new Error("no mcp-bridge.ts");
      fs.renameSync(handoff, own);
      args.push("--extension", MCP_BRIDGE);
      env[ENV_MCP_SERVERS_FILE] = own;
      process.on("exit", () => { try { fs.unlinkSync(own); } catch {} });
    } catch {}
  }

  let steering = null; // created below once emit exists; the socket connects after that
  const bridge = createBridgeClient(undefined, {
    hello: () => steering.hello(),
    onMessage: (m) => steering?.onWrapperMessage(m),
  });
  const child = spawn(OMP, args, { stdio: ["pipe", "pipe", "pipe"], env });
  let childDone = null; // { code, sig, error } once omp has exited and its stdio closed
  for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => (childDone ? exitLike(null, s) : child.kill(s)));
  // Tee omp's stderr: it still reaches ours, and its tail explains an early exit.
  let stderrTail = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d) => {
    process.stderr.write(d);
    stderrTail = (stderrTail + d).slice(-4 * STDERR_TAIL);
  });
  let spawnFailed = false;
  child.on("error", (e) => {
    spawnFailed = true;
    stderrTail = (stderrTail + `\n${e?.message ?? e}`).slice(-4 * STDERR_TAIL);
  });
  child.on("close", (code, sig) => onChildClose(code, sig));
  child.stdin.on("error", () => {});
  // First command omp sees, so v2 is active before pi-acp can ask for anything large.
  child.stdin.write(JSON.stringify({ id: NEGOTIATE_ID, type: "negotiate_protocol", protocolVersion: 2 }) + "\n");
  let commands = null;
  const pending = [];             // pi-acp get_commands ids awaiting omp's command list
  let stdinEnded = false;
  let forwarded = false;          // a pi-acp line reached omp: relay its output until it exits
  let ready = false;              // omp emitted `ready`
  const outstanding = new Map();  // pi-acp request id -> command type, until omp answers
  let idleTimer = null;
  let textStreamed = false; // the current assistant message streamed a text_delta
  let lastErrorKey = null;  // errored message already surfaced
  let chunks = null;        // v2 chunk sequence being reassembled

  const toPiCommand = (c) => {
    const out = { ...c };
    if (c.source === "extension" && cmdExtPaths.length === 1) out.sourceInfo = { path: cmdExtPaths[0] };
    return out;
  };
  const answer = (id, cmds, error) => {
    const frame = cmds
      ? { id, type: "response", command: "get_commands", success: true, data: { commands: cmds.map(toPiCommand) } }
      : { id, type: "response", command: "get_commands", success: false, error };
    process.stdout.write(JSON.stringify(frame) + "\n");
  };
  /** pi-acp hung up (stdin EOF), or answered after it: exit once nothing is owed to it. */
  const maybeRelease = () => {
    if (!stdinEnded || pending.length) return;
    if (childDone) finish();
    else if (!forwarded) exitOnce(0, null); // omp sees EOF and shuts down on its own
  };
  const emit = (line) => process.stdout.write(line + "\n");
  steering = createSteering({
    writeOmp: (l) => {
      if (!childDone && !child.stdin.writableEnded) child.stdin.write((typeof l === "string" ? l : JSON.stringify(l)) + "\n");
    },
    emit,
    send: (m) => bridge.send(m),
  });
  bridge.connect();

  // omp gone: answer pi-acp ourselves so it reports why instead of failing to write to
  // a dead pipe ("Cannot call write after a stream was destroyed").
  const deadAnswer = (id, command) =>
    emit(JSON.stringify({ id, type: "response", command, success: false, error: childDone.error }));
  let finished = false;
  const exitOnce = (status, sig) => {
    if (finished) return;
    finished = true;
    clearTimeout(idleTimer);
    bridge.flush(RELEASE_FLUSH_MS).then(() => exitLike(status, sig), () => exitLike(status, sig));
  };
  const finish = () => {
    const { code, sig } = childDone;
    exitOnce(code >= 0 ? code : 1, sig); // spawn failures report a negative errno
  };
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(finish, DEAD_GRACE_MS);
  };
  const onChildClose = (code, sig) => {
    const why = spawnFailed ? "omp failed to start"
      : `omp exited (${sig ? `signal ${sig}` : `code ${code ?? "?"}`})`;
    const tail = stderrSummary(stderrTail);
    childDone = { code, sig, error: tail ? `${why}: ${tail}` : why };
    steering.onChildClose();
    // Unusable from the start, or died owing answers: keep serving errors until pi-acp lets go.
    const early = !ready || outstanding.size > 0 || pending.length > 0;
    for (const [id, command] of outstanding) deadAnswer(id, command);
    outstanding.clear();
    while (pending.length) answer(pending.shift(), null, childDone.error);
    if (stdinEnded || !early) finish();
    else armIdle();
  };

  /** Every logical omp frame (a plain line or a reassembled v2 frame) goes through here. */
  const forward = (line) => {
    if (line.startsWith('{"id":"')) {
      const m = RESPONSE_ID.exec(line);
      if (m) {
        if (m[1].startsWith(BRIDGE_ID_PREFIX)) return steering.onBridgeResponse(m[1], line); // ours; pi-acp never asked
        try {
          const id = JSON.parse(`"${m[1]}"`);
          const type = outstanding.get(id);
          outstanding.delete(id);
          if (type === "get_state" || type === "prompt") steering.onPiResponse(id, type, line);
        } catch {}
      }
    } else if (!ready && line.startsWith('{"type":"ready"')) ready = true;
    if (line.includes('"available_commands_update"')) {
      try {
        const f = JSON.parse(line);
        if (f.type === "available_commands_update" && Array.isArray(f.commands)) {
          commands = f.commands;
          while (pending.length) answer(pending.shift(), commands);
          maybeRelease();
        }
      } catch {}
    }
    if ((line.startsWith('{"type":"tool_execution_update"') || line.startsWith('{"type":"tool_execution_end"'))
      && line.includes('"toolName":"task"')) {
      line = bridgeTaskFrame(line, bridge);
    } else if (line.startsWith('{"type":"message_start"')) {
      textStreamed = false;
    } else if (line.startsWith('{"type":"message_update","assistantMessageEvent":{"type":"text_delta"')) {
      textStreamed = true;
    } else if ((line.startsWith('{"type":"message_end"') || line.startsWith('{"type":"turn_end"'))
      && line.includes('"stopReason":"error"')) {
      const notice = providerErrorNotice(line, textStreamed, lastErrorKey);
      if (notice) {
        lastErrorKey = notice.key;
        if (notice.frame) emit(notice.frame);
      }
    }
    if (line.startsWith('{"type":"message_end"')) steering.onMessageEnd(line);
    else if (line.startsWith('{"type":"agent_start"')) steering.onAgentStart();
    else if (line.startsWith('{"type":"session_settled"')) return steering.onSettled(line); // emits it + agent_settled
    emit(line);
  };

  readline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
    if (!line.startsWith('{"type":"rpc_chunk"')) return forward(line);
    try {
      const res = pushChunk(chunks, line);
      chunks = res.pending;
      if (res.json !== undefined) forward(v1Line(res.json));
    } catch (e) {
      // Unusable sequence: drop it and pass the line on untouched (pi-acp ignores unknown events).
      chunks = null;
      process.stderr.write(`pi-shim: rpc chunk reassembly failed: ${e?.message ?? e}\n`);
      emit(line);
    }
  });

  readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
    .on("line", (line) => {
      let f;
      try { f = JSON.parse(line); } catch {}
      // Every pi-acp command carries an id and expects a response; UI replies do not.
      const request = f && typeof f.type === "string" && f.id !== undefined && f.type !== "extension_ui_response";
      if (childDone) {
        if (request) { deadAnswer(f.id, f.type); armIdle(); }
        return;
      }
      if (f?.type === "get_commands") {
        if (commands) answer(f.id, commands);
        else pending.push(f.id);
        return;
      }
      if (request) outstanding.set(f.id, f.type);
      forwarded = true;
      if (f && steering.onPiCommand(f, line)) return; // an abort held for steer acks
      child.stdin.write(line + "\n");
    })
    .on("close", () => {
      stdinEnded = true;
      if (!childDone) { steering.flushAbort(); child.stdin.end(); }
      maybeRelease();
    });
}

// ---------------------------------------------------------------- mid-turn steering

const AGENT_SETTLED = '{"type":"agent_settled"}';
// Steer states. sent: written to omp, no ack yet · queued: acked, presumably in omp's queue ·
// removing: remove_queued_message in flight · clearing: abort_and_restore_queue in flight ·
// limbo: omp no longer holds it (never queued, or taken by a run that may still inject it).
const OPEN = new Set(["sent", "queued", "removing", "clearing"]); // fate unknown: holds a settle
const SENT = new Set(["sent"]); // ack still due: holds a pi-acp abort

/**
 * The turn-window state machine from the header. `writeOmp(obj|line)` writes one line to omp,
 * `emit(line)` one line to pi-acp, `send(obj)` one message to the wrapper. Every entry point
 * is called from the shim's line handlers; nothing here may throw into them.
 */
function createSteering({ writeOmp, emit, send }) {
  let sessionId = null;     // ACP session id (omp's first get_state sessionId)
  let turn = false;         // window open
  let promptId;             // pi-acp id of the prompt that opened it
  let dead = false;         // omp exited
  let seq = 0;
  const steers = new Map(); // wrapper ref -> { ref, message, state, steerId }; consumed/dropped ones leave
  const byId = new Map();   // bridge rpc id -> steer, or the steers an abort_and_restore_queue clears
  let held = null;          // { line, agentStarted }: a session_settled withheld from pi-acp
  let abort = null;         // { lines, timer }: pi-acp abort(s) waiting for steer acks

  const nextId = (what) => `${BRIDGE_ID_PREFIX}${what}:${++seq}`;
  const some = (states) => { for (const s of steers.values()) if (states.has(s.state)) return true; return false; };
  const setTurn = (open) => {
    if (turn === open) return;
    turn = open;
    send({ kind: KIND_SHIM, pid: process.pid, sessionId, turn });
  };
  const consumed = (s) => {
    steers.delete(s.ref);
    send({ kind: KIND_STEER_CONSUMED, ref: s.ref, message: s.message });
  };
  const dropped = (s) => {
    steers.delete(s.ref);
    send({ kind: KIND_STEER_DROPPED, ref: s.ref });
  };
  const dropLimbo = () => { for (const s of [...steers.values()]) if (s.state === "limbo") dropped(s); };
  const remove = (s) => {
    s.state = "removing";
    const id = nextId("remove");
    byId.set(id, s);
    writeOmp({ id, type: "remove_queued_message", message: s.message, queue: "steering" });
  };
  /** Close the window; steers acked into omp's queue are pulled back out (an abort clears them itself). */
  const closeWindow = () => {
    setTurn(false);
    if (!abort) for (const s of steers.values()) if (s.state === "queued") remove(s);
  };
  const settle = (line) => { dropLimbo(); emit(line); emit(AGENT_SETTLED); };

  const flushAbort = () => {
    if (!abort) return;
    clearTimeout(abort.timer);
    const { lines } = abort;
    abort = null;
    const batch = [...steers.values()];
    for (const s of batch) s.state = "clearing";
    const id = nextId("abort");
    byId.set(id, batch);
    writeOmp({ id, type: "abort_and_restore_queue" });
    for (const l of lines) writeOmp(l);
  };
  const progress = () => {
    if (abort && !some(SENT)) flushAbort();
    if (held && !some(OPEN)) {
      const h = held;
      held = null;
      if (!h.agentStarted) settle(h.line);
    }
  };

  return {
    hello: () => ({ kind: KIND_SHIM, pid: process.pid, sessionId, turn }),

    /** A message from the wrapper. */
    onWrapperMessage(m) {
      if (m?.kind !== KIND_STEER || m.ref === undefined || steers.has(m.ref)) return;
      const refuse = (error) => send({ kind: KIND_STEER_RESULT, ref: m.ref, ok: false, error });
      if (typeof m.message !== "string" || !m.message) return refuse("empty steer");
      if (dead) return refuse("omp has exited");
      if (!turn) return refuse("no omp turn in flight");
      const s = { ref: m.ref, message: m.message, state: "sent", steerId: nextId("steer") };
      steers.set(s.ref, s);
      byId.set(s.steerId, s);
      writeOmp({ id: s.steerId, type: "steer", message: s.message });
    },

    /** A parsed pi-acp command about to go to omp. True: we took it (an abort held for steer acks). */
    onPiCommand(f, line) {
      if (f.type === "prompt") {
        dropLimbo();
        promptId = f.id;
        setTurn(true);
        return false;
      }
      if (f.type !== "abort") return false;
      setTurn(false);
      if (steers.size === 0) return false; // nothing of ours in omp: pi-acp's abort goes as is
      abort ??= { lines: [], timer: setTimeout(() => { flushAbort(); }, ABORT_WAIT_MS) };
      abort.lines.push(line);
      progress();
      return true;
    },

    /** omp's response to a pi-acp get_state / prompt (forwarded to pi-acp by the caller). */
    onPiResponse(id, type, line) {
      try {
        if (type === "get_state" && sessionId === null) {
          const sid = JSON.parse(line)?.data?.sessionId;
          if (typeof sid === "string" && sid) {
            sessionId = sid;
            send({ kind: KIND_SHIM, pid: process.pid, sessionId, turn });
          }
        } else if (type === "prompt" && turn && id === promptId) {
          const f = JSON.parse(line);
          if (f.success !== true || f.data?.agentInvoked === false) closeWindow();
        }
      } catch {}
    },

    /** omp's response to one of our own ids; never forwarded. */
    onBridgeResponse(id, line) {
      const s = byId.get(id);
      if (s === undefined) return; // negotiate_protocol, or already settled
      byId.delete(id);
      let f = null;
      try { f = JSON.parse(line); } catch {}
      const ok = f?.success === true;
      if (Array.isArray(s)) {
        // abort_and_restore_queue: on success nothing of ours is left in omp. Without the
        // command (older omp) pi-acp's abort still ran; what it left can only be waited out.
        for (const b of s) if (steers.get(b.ref) === b && b.state === "clearing") ok ? dropped(b) : (b.state = "limbo");
      } else if (steers.get(s.ref) !== s) {
        // consumed before this response arrived
      } else if (id === s.steerId) {
        if (!ok) {
          steers.delete(s.ref);
          send({ kind: KIND_STEER_RESULT, ref: s.ref, ok: false, error: typeof f?.error === "string" ? f.error : "omp refused the steer" });
        } else {
          send({ kind: KIND_STEER_RESULT, ref: s.ref, ok: true });
          if (s.state === "sent") {
            s.state = "queued";
            if (!turn && !abort) remove(s); // the window closed while it was in the pipe
          }
        }
      } else if (s.state === "removing") {
        if (ok && f.data?.removed === true) dropped(s);
        else s.state = "limbo"; // a run took it (its message_end may still come) or omp never queued it
      }
      progress();
    },

    /** omp message_end: a user message with `steering: true` and the text of one of ours = consumed. */
    onMessageEnd(line) {
      if (steers.size === 0 || !line.includes('"steering":true')) return;
      let m;
      try { m = JSON.parse(line).message; } catch { return; }
      if (m?.role !== "user" || m.steering !== true) return;
      const text = typeof m.content === "string" ? m.content
        : Array.isArray(m.content) ? m.content.map((c) => (c?.type === "text" && typeof c.text === "string" ? c.text : "")).join("")
        : null;
      for (const s of steers.values()) {
        if (s.message !== text) continue;
        consumed(s);
        progress();
        return;
      }
    },

    onAgentStart() { if (held) held.agentStarted = true; },

    /** omp session_settled: forward it with its agent_settled mirror now, or once no steer's fate is open. */
    onSettled(line) {
      closeWindow();
      if (!some(OPEN)) return settle(line);
      held = { line, agentStarted: false };
    },

    /** Write a held pi-acp abort now (pi-acp closed our stdin). */
    flushAbort,

    onChildClose() {
      dead = true;
      clearTimeout(abort?.timer);
      abort = null;
      setTurn(false);
      for (const s of [...steers.values()]) dropped(s);
      byId.clear();
      if (held) { const h = held; held = null; emit(h.line); emit(AGENT_SETTLED); }
    },
  };
}

// ---------------------------------------------------------------- provider errors

/**
 * For an omp message_end/turn_end line whose assistant message failed and was not surfaced
 * yet: `{ key, frame }`, frame being a text_delta message_update carrying the error (after a
 * blank line when text was already streamed). Undefined for any other line.
 */
function providerErrorNotice(line, textStreamed, lastKey) {
  try {
    const f = JSON.parse(line);
    const m = f.message;
    if (!m || m.role !== "assistant" || m.stopReason !== "error") return;
    if (typeof m.errorMessage !== "string" || !m.errorMessage.trim()) return;
    // turn_end repeats message_end's message (without messageId); the timestamp ties them.
    const key = `${m.timestamp}\u0000${m.errorMessage}`;
    if (key === lastKey) return;
    const content = Array.isArray(m.content) ? m.content : [];
    const midStream = textStreamed || content.some((c) => c?.type === "text" && c.text);
    const who = m.provider && m.model ? ` (${m.provider}/${m.model})` : "";
    const frame = {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: content.length,
        delta: `${midStream ? "\n\n" : ""}⚠️ Model error${who}: ${m.errorMessage}`,
        partial: m,
      },
      message: m,
    };
    if (f.messageId !== undefined) frame.messageId = f.messageId;
    return { key, frame: JSON.stringify(frame) };
  } catch {}
}

// ---------------------------------------------------------------- RPC protocol v2
// Mirrors omp's rpc-frame.ts (RpcFrameDecoder / encodeRpcFrameFromJson).

const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_REASSEMBLED_BYTES = 64 * 1024 * 1024;

/** Feed one `rpc_chunk` line. Returns the next pending state and, when complete, the logical frame's JSON. Throws on a broken sequence. */
function pushChunk(pend, line) {
  const { chunkId, index, count, byteLength, data } = JSON.parse(line);
  if (typeof chunkId !== "string" || !Number.isSafeInteger(index) || !Number.isSafeInteger(count)
    || !Number.isSafeInteger(byteLength) || count < 1 || index < 0 || index >= count
    || byteLength > MAX_REASSEMBLED_BYTES || typeof data !== "string") throw new Error("invalid rpc chunk metadata");
  if (index === 0) pend = { chunkId, count, byteLength, next: 0, bufs: [], size: 0 };
  if (!pend || pend.chunkId !== chunkId || pend.count !== count || pend.byteLength !== byteLength || pend.next !== index)
    throw new Error("rpc chunk sequence mismatch");
  const buf = Buffer.from(data, "base64");
  pend.bufs.push(buf);
  pend.size += buf.length;
  pend.next++;
  if (pend.size > pend.byteLength) throw new Error("rpc chunk sequence exceeds declared length");
  if (pend.next < pend.count) return { pending: pend };
  if (pend.size !== pend.byteLength) throw new Error("rpc chunk sequence length mismatch");
  return { pending: null, json: Buffer.concat(pend.bufs).toString("utf8") };
}

/**
 * The single line pi-acp gets for a reassembled frame: responses whole (that is the fix),
 * anything else shrunk exactly as omp's v1 encoder would have (omp already compacted it).
 */
function v1Line(json) {
  let frame;
  try { frame = JSON.parse(json); } catch { return json; }
  if (!isRecord(frame) || frame.type === "response" || fitsV1(json)) return json;
  for (const pass of SHRINK_PASSES) {
    const shrunk = JSON.stringify(shrinkValue(frame, pass));
    if (fitsV1(shrunk)) return shrunk;
  }
  return JSON.stringify(frame.type === "agent_end"
    ? { type: "agent_end", messages: [], messageCount: typeof frame.messageCount === "number" ? frame.messageCount : 0 }
    : {
      type: "rpc_frame_error",
      originalType: typeof frame.type === "string" ? shrinkString(frame.type, 1024) : undefined,
      error: "RPC frame exceeded the transport limit",
    });
}

const fitsV1 = (json) => Buffer.byteLength(json, "utf8") + 1 <= MAX_FRAME_BYTES;
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const SHRINK_PASSES = [
  [256 * 1024, 512, 512], [64 * 1024, 256, 256], [16 * 1024, 128, 128], [4 * 1024, 64, 64],
  [1024, 32, 32], [256, 8, 16], [64, 1, 8],
].map(([stringCap, arrayLimit, objectLimit]) => ({ stringCap, arrayLimit, objectLimit }));

function shrinkString(value, cap) {
  if (value.length <= cap) return value;
  const head = Math.max(0, cap - 80);
  return `${value.slice(0, head)}\n…[${value.length - head} chars elided for RPC frame]`;
}

function shrinkValue(value, pass) {
  if (typeof value === "string") return shrinkString(value, pass.stringCap);
  if (Array.isArray(value)) {
    const keep = Math.min(value.length, pass.arrayLimit);
    const out = value.slice(0, keep).map((v) => shrinkValue(v, pass));
    if (keep < value.length) out.push(`…[${value.length - keep} items elided for RPC frame]`);
    return out;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    const keep = Math.min(entries.length, pass.objectLimit);
    const out = {};
    for (let i = 0; i < keep; i++) out[entries[i][0]] = shrinkValue(entries[i][1], pass);
    if (keep < entries.length) out.rpcFrameElidedKeys = entries.length - keep;
    return out;
  }
  return value;
}

// ---------------------------------------------------------------- task bridge

const MAX_FIELD = 4000;
const clip = (s, n) => {
  s = typeof s === "string" ? s : s == null ? "" : String(s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};
const oneLine = (s, n) => clip(String(s ?? "").replace(/\s+/g, " ").trim(), n);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Returns the line to forward: rewritten on success, the original on any failure. */
function bridgeTaskFrame(line, bridge) {
  try {
    const f = JSON.parse(line);
    if (f.toolName !== "task") return line;
    const res = f.type === "tool_execution_update" ? f.partialResult
      : f.type === "tool_execution_end" ? f.result : null;
    const progress = res?.details?.progress;
    if (!Array.isArray(progress)) return line;

    try {
      bridge.send({ kind: "progress", taskCallId: String(f.toolCallId ?? ""), entries: progress.map(feedEntry) });
    } catch {}

    const first = Array.isArray(res.content) ? res.content[0] : null;
    if (!first || first.type !== "text" || typeof first.text !== "string" || progress.length === 0) return line;
    const table = progress.map(tableRow).join("\n");
    const text = f.type === "tool_execution_end" && first.text ? `${table}\n\n${first.text}` : table;
    res.content[0] = { ...first, text };
    return JSON.stringify(f);
  } catch {
    return line;
  }
}

function feedEntry(e) {
  const out = {
    id: String(e?.id ?? ""),
    agent: String(e?.agent ?? ""),
    status: String(e?.status ?? ""),
    assignment: clip(e?.assignment, MAX_FIELD),
    task: clip(e?.task, MAX_FIELD),
    lastIntent: clip(e?.lastIntent, 500),
    recentTools: Array.isArray(e?.recentTools)
      ? e.recentTools.slice(0, 10).map((t) => ({ tool: String(t?.tool ?? ""), args: clip(t?.args, 500) }))
      : [],
  };
  for (const k of ["toolCount", "tokens", "cost", "durationMs"]) if (num(e?.[k]) !== undefined) out[k] = e[k];
  if (e?.resolvedModel) out.resolvedModel = String(e.resolvedModel);
  if (e?.error) out.error = clip(e.error, MAX_FIELD);
  return out;
}

// `id · agent · status · model · last intent · last tool · tools=N · Ns · $cost`
function tableRow(e) {
  const dash = (s) => s || "-";
  const t = Array.isArray(e?.recentTools) ? e.recentTools[0] : null;
  const lastTool = t ? oneLine(t.args ? `${t.tool}: ${t.args}` : t.tool, 60) : "";
  const ms = num(e?.durationMs);
  const cost = num(e?.cost);
  const cols = [
    dash(oneLine(e?.id, 40)),
    dash(oneLine(e?.agent, 30)),
    dash(oneLine(e?.status, 20)),
    dash(oneLine(e?.resolvedModel, 60)),
    dash(oneLine(e?.lastIntent, 60)),
    dash(lastTool),
    `tools=${num(e?.toolCount) ?? 0}`,
    ms === undefined ? "-" : `${(ms / 1000).toFixed(1)}s`,
    cost === undefined ? "-" : `$${cost.toFixed(4)}`,
  ];
  if (e?.error) cols.push(`error: ${oneLine(e.error, 120)}`);
  return cols.join(" · ");
}
