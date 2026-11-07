// Shared constants + a fail-open socket client for the omp ↔ Kiro Crew subagent bridge.
// Imported by pi-shim.mjs, pi-acp-wrapper.mjs and (optionally) reporter.ts under Bun.
// Only node: builtins; nothing here may throw into a caller.
import net from "node:net";
import os from "node:os";
import path from "node:path";

/** Env var the wrapper exports to every descendant (shim, omp, reporter). */
export const ENV_SOCK = "KIROCREW_OMP_BRIDGE_SOCK";
/** Per-session writable scratch dir Crew exports; preferred socket location. */
export const ENV_SCRATCH = "KIROCREW_SCRATCH";
/** ACP extension methods Crew already parses for any backend. */
export const METHOD_LIST_UPDATE = "_kiro.dev/subagent/list_update";
export const METHOD_SESSION_UPDATE = "_kiro.dev/session/update";
/** Crew sessionId prefix for omp subagents: `omp:<id>`. */
export const SESSION_PREFIX = "omp:";
/** Bound for tool_end output tails. */
export const MAX_TOOL_TEXT = 2000;

// ---- mid-turn steering: Crew `_session/steer` → wrapper → shim → omp RPC `steer`
/** Crew's steer ext-method (request; params `{sessionId, message}`). */
export const METHOD_STEER = "_session/steer";
/** Key the wrapper merges into pi-acp's initialize `result._meta` while the bridge is live. */
export const META_STEER = "kiro.dev/steer";
/** Prefix of every RPC id the shim itself sends omp; responses to them never reach pi-acp. */
export const BRIDGE_ID_PREFIX = "omp-kiro-bridge:";
/**
 * Socket messages beyond the reporter's progress/activity/done:
 *   shim → wrapper `{kind:"shim", pid, sessionId, turn}`  first line of every shim connection
 *       (and re-sent on change): marks it steer-capable. sessionId = the ACP session id
 *       (omp's first get_state sessionId, which pi-acp adopts) or null; turn = a pi-acp
 *       prompt is running in omp and steers are accepted.
 *   wrapper → shim `{kind:"steer", ref, message}`
 *   shim → wrapper `{kind:"steer_result", ref, ok, error?}`  omp acked it / refused
 *   shim → wrapper `{kind:"steer_consumed", ref, message}`   omp injected it into the turn
 *   shim → wrapper `{kind:"steer_dropped", ref}`             it will never run
 */
export const KIND_SHIM = "shim";
export const KIND_STEER = "steer";
export const KIND_STEER_RESULT = "steer_result";
export const KIND_STEER_CONSUMED = "steer_consumed";
export const KIND_STEER_DROPPED = "steer_dropped";

// ---- session MCP servers: Crew `session/new`|`session/load` `mcpServers` → wrapper → shim → omp
/** Wrapper → shim: file (0600) holding the `mcpServers` array of the latest session/new|load. */
export const ENV_MCP_HANDOFF = "KIROCREW_OMP_MCP_HANDOFF";
/** Shim → omp (mcp-bridge.ts): the shim's own copy of that file, unlinked once read. */
export const ENV_MCP_SERVERS_FILE = "KIROCREW_OMP_MCP_SERVERS_FILE";

// sockaddr_un.sun_path is 108 bytes on Linux (104 on macOS); keep a margin.
const MAX_SOCK_PATH = 100;

/**
 * Socket path for a wrapper pid: the first of $KIROCREW_SCRATCH, os.tmpdir() and /tmp
 * whose joined path fits sun_path. Kiro Crew points TMPDIR at the session's scratch
 * directory, so os.tmpdir() is usually the SAME directory as $KIROCREW_SCRATCH: a
 * scratch path too long for a socket (a long data home, a crewmate's long slot label)
 * would leave the bridge dark -- no session MCP mount, no steer -- without the /tmp
 * leg. Only LENGTH moves the choice on: a path that fits and cannot bind (a missing
 * scratch) still leaves the bridge down, as before. The socket is 0600, names a pid.
 */
export function socketPathFor(pid = process.pid, env = process.env) {
  const name = `omp-bridge-${pid}.sock`;
  const dirs = [env[ENV_SCRATCH], os.tmpdir(), "/tmp"].filter(Boolean);
  for (const dir of dirs) {
    const p = path.join(dir, name);
    if (Buffer.byteLength(p) <= MAX_SOCK_PATH) return p;
  }
  return path.join("/tmp", name);
}

/**
 * Directory for the wrapper's private files (the mcpServers handoff): the session's
 * scratch when Crew set one -- a file path has no sun_path limit -- else the socket's.
 */
export function privateDirFor(sockPath, env = process.env) {
  return env[ENV_SCRATCH] || path.dirname(sockPath);
}

/** Keep the last `max` chars of `s` (output tails matter more than heads). */
export function tail(s, max = MAX_TOOL_TEXT) {
  s = typeof s === "string" ? s : s == null ? "" : String(s);
  return s.length > max ? "…" + s.slice(s.length - max + 1) : s;
}

const MAX_QUEUE_BYTES = 1 << 20;
const RETRY_MS = 1000;

/**
 * Fire-and-forget NDJSON client. `send(obj)` never throws and never blocks:
 * lines queue while connecting, are dropped when the socket is absent, and the
 * queue is bounded. With no socket path (bridge disabled) every call is a no-op.
 * The socket is unref'd so it never keeps a process alive.
 * `hello()` (optional) is written first on every (re)connect; `onMessage(obj)`
 * (optional) receives each JSON line the wrapper writes back. A lost connection
 * is re-made lazily by the next send()/connect().
 */
export function createBridgeClient(sockPath = process.env[ENV_SOCK], { hello, onMessage } = {}) {
  let sock = null;
  let connected = false;
  let queue = [];
  let queued = 0;
  let retryAt = 0;
  let closed = false;

  const reset = () => {
    try { sock?.destroy(); } catch {}
    sock = null;
    connected = false;
    queue = [];
    queued = 0;
    retryAt = Date.now() + RETRY_MS;
  };

  const connect = () => {
    if (sock || closed || !sockPath || Date.now() < retryAt) return;
    try {
      const s = net.createConnection(sockPath);
      sock = s;
      s.unref();
      s.on("error", () => { if (sock === s) reset(); });
      s.on("close", () => { if (sock === s) reset(); });
      s.on("connect", () => {
        if (sock !== s) return;
        connected = true;
        const q = queue;
        queue = [];
        queued = 0;
        if (hello) { try { s.write(JSON.stringify(hello()) + "\n"); } catch {} }
        for (const line of q) s.write(line);
      });
      if (onMessage) {
        let buf = "";
        s.setEncoding("utf8");
        s.on("data", (chunk) => {
          buf += chunk;
          let i;
          while ((i = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            let m;
            try { m = JSON.parse(line); } catch { continue; }
            try { onMessage(m); } catch {}
          }
          if (buf.length > MAX_QUEUE_BYTES) buf = "";
        });
      }
    } catch {
      reset();
    }
  };

  return {
    get enabled() { return Boolean(sockPath) && !closed; },
    /** Open the connection now (hello goes out on connect); no-op when connected or disabled. */
    connect() { try { connect(); } catch {} },
    send(obj) {
      if (!sockPath || closed) return;
      try {
        const line = JSON.stringify(obj) + "\n";
        connect();
        if (!sock) return;
        if (connected) { sock.write(line); return; }
        if (queued + line.length > MAX_QUEUE_BYTES) return;
        queue.push(line);
        queued += line.length;
      } catch {}
    },
    /** Resolve once written data is flushed (or after `timeoutMs`); never rejects. */
    flush(timeoutMs = 200) {
      return new Promise((resolve) => {
        try {
          if (!sock || (connected && sock.writableLength === 0 && queue.length === 0)) return resolve();
          const t = setTimeout(resolve, timeoutMs);
          const done = () => { clearTimeout(t); resolve(); };
          if (connected) sock.write("", done);
          else sock.once("connect", () => sock ? sock.write("", done) : done()).once("close", done);
        } catch { resolve(); }
      });
    },
    close() {
      closed = true;
      try { sock?.end(); } catch {}
      sock = null;
    },
  };
}
