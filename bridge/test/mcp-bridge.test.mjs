// mcp-bridge.ts against real MCP servers: the stdio probe in fixtures/, and in-process
// streamable-HTTP and legacy HTTP+SSE servers. mcp-bridge.ts is transpiled once with
// `bun build --target=node` (the same source omp loads natively) and driven through a
// fake omp ExtensionAPI that records registerTool() calls.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "mcp-bridge.ts");
const PROBE = path.join(HERE, "fixtures", "mcp-probe-server.mjs");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-bridge-test-"));
const ENV_FILE = "KIROCREW_OMP_MCP_SERVERS_FILE";
const STORE_KEYS = ["omp-kiro-bridge.mcp-bridge.mounts", "omp-kiro-bridge.mcp-bridge.servers"].map((k) => Symbol.for(k));

let mod;
before(async () => {
  process.env.KIROCREW_OMP_MCP_CONNECT_MS = "5000"; // read at module load
  process.env.KIROCREW_OMP_MCP_STARTUP_MS = "1500"; // read at module load
  const out = path.join(TMP, "mcp-bridge.mjs");
  execFileSync("bun", ["build", "--target=node", "--format=esm", SRC, "--outfile", out], { stdio: "pipe" });
  mod = await import(pathToFileURL(out).href);
});
// Each test is a fresh omp process as far as the extension can tell; its servers are closed
// so live children and streams do not keep the test process alive.
const resetStore = () => {
  for (const p of globalThis[STORE_KEYS[0]]?.values() ?? []) p.then((m) => m?.conn.close()).catch(() => {});
  for (const k of STORE_KEYS) delete globalThis[k];
};
after(() => { resetStore(); fs.rmSync(TMP, { recursive: true, force: true }); });
beforeEach(() => { resetStore(); delete process.env[ENV_FILE]; });

class FakePi {
  tools = new Map();
  registerTool(t) { this.tools.set(t.name, t); }
}

/** Write a servers file the way the shim hands one over, and point the env at it. */
function handOver(servers) {
  const f = path.join(TMP, `servers-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(f, JSON.stringify(servers), { mode: 0o600 });
  process.env[ENV_FILE] = f;
  return f;
}
const readLog = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const text = (r) => r.content.map((c) => c.text).join("");

async function waitFor(pred, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

// ------------------------------------------------------------ pure helpers

test("toolName: Crew's mcp__<server>__<tool> grammar, provider-safe, <= 64 chars, deterministic", () => {
  assert.equal(mod.toolName("crew-probe", "crew_probe_echo"), "mcp__crew-probe__crew_probe_echo");
  assert.equal(mod.toolName("my server", "a.b/c"), "mcp__my_server__a_b_c");
  const long = mod.toolName("s".repeat(40), "t".repeat(40));
  assert.equal(long.length, 64);
  assert.match(long, /^mcp__s+__t+_[0-9a-f]{8}$/);
  assert.equal(long, mod.toolName("s".repeat(40), "t".repeat(40)));
  assert.notEqual(long, mod.toolName("s".repeat(40), "t".repeat(41)));
});

test("parseServers: ACP elements kept (stdio with or without type), junk and duplicate names dropped", () => {
  const stdio = { name: "a", command: "x", args: [], env: [] };
  const tagged = { name: "b", command: "y", type: "stdio" };
  const httpEl = { name: "c", type: "http", url: "http://h/mcp", headers: [] };
  assert.deepEqual(mod.parseServers([stdio, tagged, httpEl, { name: "a", command: "dup" }, { name: "d" }, null, { command: "x" }, "s"]),
    [stdio, tagged, httpEl]);
  assert.deepEqual(mod.parseServers({ a: 1 }), []);
});

test("outboundArgs: omp's intent field and empty optional placeholders dropped, the rest kept", () => {
  const schema = { type: "object", properties: { q: { type: "string" }, opt: { type: "string" }, o: { type: "object" } }, required: ["q"] };
  assert.deepEqual(mod.outboundArgs({ q: "", opt: "", o: {}, i: "intent", extra: 1 }, schema), { q: "", extra: 1 });
  assert.deepEqual(mod.outboundArgs({ i: 3 }, { type: "object", properties: { i: { type: "number" } } }), { i: 3 });
  assert.deepEqual(mod.outboundArgs(null, schema), {});
});

test("toolSchema: always an object schema", () => {
  assert.deepEqual(mod.toolSchema(undefined), { type: "object", properties: {} });
  const s = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };
  assert.deepEqual(mod.toolSchema(s), s);
});

test("toolResult: content mapped, structuredContent fallback, isError throws its text", () => {
  assert.deepEqual(mod.toolResult({ content: [
    { type: "text", text: "t" },
    { type: "image", data: "AAA", mimeType: "image/jpeg" },
    { type: "resource", resource: { uri: "file:///x", text: "body" } },
    { type: "resource_link", name: "doc", uri: "file:///d" },
  ] }).content, [
    { type: "text", text: "t" },
    { type: "image", data: "AAA", mimeType: "image/jpeg" },
    { type: "text", text: "body" },
    { type: "text", text: "doc: file:///d" },
  ]);
  assert.deepEqual(mod.toolResult({ content: [], structuredContent: { n: 1 } }).content, [{ type: "text", text: '{"n":1}' }]);
  assert.deepEqual(mod.toolResult({}).content, [{ type: "text", text: "(no output)" }]);
  assert.throws(() => mod.toolResult({ isError: true, content: [{ type: "text", text: "nope" }] }), /nope/);
});

test("parseSse: CRLF, multi-line data, comments, named events, partial tail kept", () => {
  const { events, rest } = mod.parseSse(": hi\r\nevent: endpoint\r\ndata: /m?s=1\r\n\r\ndata: {\"a\":\ndata: 1}\n\ndata: part");
  assert.deepEqual(events, [{ event: "endpoint", data: "/m?s=1" }, { event: "message", data: '{"a":\n1}' }]);
  assert.equal(rest, "data: part");
});

// ------------------------------------------------------------ stdio, end to end

test("stdio: mounted, tools registered for omp, calls round-trip, file consumed, bad server dropped, subagent reuses", async () => {
  const log = path.join(TMP, "probe.log");
  const file = handOver([
    { name: "crew-probe", command: process.execPath, args: [PROBE], env: [{ name: "PROBE_LOG", value: log }, { name: "PROBE_TOKEN", value: "tok-1" }] },
    { name: "broken", command: path.join(TMP, "no-such-binary"), args: [], env: [] },
  ]);
  const pi = new FakePi();
  await mod.default(pi);
  assert.equal(fs.existsSync(file), false, "the servers file (credentials) is unlinked once read");
  assert.deepEqual([...pi.tools.keys()], ["mcp__crew-probe__crew_probe_echo", "mcp__crew-probe__crew_probe_fail"], "broken server dropped, probe kept");

  const echo = pi.tools.get("mcp__crew-probe__crew_probe_echo");
  assert.equal(echo.loadMode, "essential");
  assert.equal(echo.mcpServerName, "crew-probe");
  assert.equal(echo.mcpToolName, "crew_probe_echo");
  assert.deepEqual(echo.parameters, { type: "object", properties: { text: { type: "string" } }, additionalProperties: false });

  const r = await echo.execute("tc1", { text: "hi", i: "calling the probe" }, undefined, undefined, {});
  assert.equal(text(r), "crew-stdio-mount-proved hi");
  assert.deepEqual(r.details, { server: "crew-probe", tool: "crew_probe_echo" });
  await assert.rejects(pi.tools.get("mcp__crew-probe__crew_probe_fail").execute("tc2", {}, undefined, undefined, {}), /probe failure/);

  // An in-process subagent re-runs the extension: same tools, same connection, no second child.
  const sub = new FakePi();
  await mod.default(sub);
  assert.deepEqual([...sub.tools.keys()], [...pi.tools.keys()]);
  assert.equal(text(await sub.tools.get("mcp__crew-probe__crew_probe_echo").execute("tc3", {}, undefined, undefined, {})), "crew-stdio-mount-proved");

  const recs = readLog(log);
  assert.deepEqual(recs.map((x) => x.method), ["initialize", "notifications/initialized", "tools/list", "tools/call", "tools/call", "tools/call"]);
  assert.equal(new Set(recs.map((x) => x.pid)).size, 1, "one server process for parent and subagent");
  assert.ok(recs.every((x) => x.token === "tok-1"), "element env reaches the child");
  assert.deepEqual(recs[3].params, { name: "crew_probe_echo", arguments: { text: "hi" } }, "intent field stripped");
});

test("no servers file, or an empty array: nothing registered", async () => {
  const pi = new FakePi();
  await mod.default(pi);
  assert.equal(pi.tools.size, 0);
  resetStore();
  handOver([]);
  await mod.default(pi);
  assert.equal(pi.tools.size, 0);
});

// ------------------------------------------------------------ remote transports

const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (d) => { b += d; }); req.on("end", () => r(b)); });
const PROBE_TOOL = { name: "probe", description: "p", inputSchema: { type: "object", properties: {} } };
/** The answer a minimal MCP server gives `msg`, or null for a notification. */
function answer(msg) {
  if (msg.id === undefined) return null;
  if (msg.method === "initialize") return { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "h", version: "1" } } };
  if (msg.method === "tools/list") return { jsonrpc: "2.0", id: msg.id, result: { tools: [PROBE_TOOL] } };
  if (msg.method === "tools/call") return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "remote-ok" }] } };
  return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "nope" } };
}

/** Streamable HTTP: JSON for initialize/list, an SSE stream (a server ping first) for calls. */
async function mcpHttpServer({ hang = false, initDelayMs = 0 } = {}) {
  const seen = [];
  const headers = [];
  const server = http.createServer(async (req, res) => {
    const msg = JSON.parse(await readBody(req));
    if (msg.method === "initialize" && initDelayMs) await new Promise((r) => setTimeout(r, initDelayMs));
    seen.push(msg);
    headers.push({ ...req.headers });
    if (msg.method !== "initialize" && req.headers["mcp-session-id"] !== "sid-1") { res.writeHead(404).end(); return; }
    const a = answer(msg);
    if (!a) { res.writeHead(202).end(); return; }
    if (msg.method === "tools/call") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: "srv-1", method: "ping" })}\n\n`);
      if (!hang) res.end(`data: ${JSON.stringify(a)}\n\n`);
      return;
    }
    res.writeHead(200, { "content-type": "application/json", ...(msg.method === "initialize" ? { "mcp-session-id": "sid-1" } : {}) });
    res.end(JSON.stringify(a));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}/mcp`, seen, headers,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}

test("streamable HTTP: headers + session id carried, SSE call answer, server ping answered", async () => {
  const srv = await mcpHttpServer();
  try {
    handOver([{ type: "http", name: "remote", url: srv.url, headers: [{ name: "Authorization", value: "Bearer k" }] }]);
    const pi = new FakePi();
    await mod.default(pi);
    assert.deepEqual([...pi.tools.keys()], ["mcp__remote__probe"]);
    assert.equal(text(await pi.tools.get("mcp__remote__probe").execute("t", {}, undefined, undefined, {})), "remote-ok");
    await waitFor(() => srv.seen.some((m) => m.id === "srv-1" && m.result));
    assert.ok(srv.headers.every((h) => h.authorization === "Bearer k"));
    assert.equal(srv.headers.at(-1)["mcp-protocol-version"], "2025-06-18");
    assert.deepEqual(srv.seen.slice(0, 4).map((m) => m.method), ["initialize", "notifications/initialized", "tools/list", "tools/call"]);
  } finally {
    await srv.close();
  }
});

test("a slow server does not hold the extension load: the fast one is ready, the slow one registers later", async () => {
  const fast = await mcpHttpServer();
  const slow = await mcpHttpServer({ initDelayMs: 3000 }); // past STARTUP_MS (1500), inside CONNECT_MS (5000)
  try {
    // The slow server first, as aws-mcp is first in the projected array.
    handOver([{ type: "http", name: "slowinit", url: slow.url, headers: [] }, { type: "http", name: "fast", url: fast.url, headers: [] }]);
    const pi = new FakePi();
    const t0 = Date.now();
    await mod.default(pi);
    const loadMs = Date.now() - t0;
    assert.ok(loadMs < 2500, `extension load waited ${loadMs} ms`);
    assert.deepEqual([...pi.tools.keys()], ["mcp__fast__probe"], "the fast server is in the first tool list");
    await waitFor(() => pi.tools.has("mcp__slowinit__probe"), 4000);
    assert.equal(text(await pi.tools.get("mcp__slowinit__probe").execute("t", {}, undefined, undefined, {})), "remote-ok");
  } finally {
    await fast.close();
    await slow.close();
  }
});

test("aborting a call sends notifications/cancelled and rejects", async () => {
  const srv = await mcpHttpServer({ hang: true });
  try {
    handOver([{ type: "http", name: "slow", url: srv.url, headers: [] }]);
    const pi = new FakePi();
    await mod.default(pi);
    const ctl = new AbortController();
    const p = pi.tools.get("mcp__slow__probe").execute("t", {}, ctl.signal, undefined, {});
    setTimeout(() => ctl.abort(), 50);
    await assert.rejects(p, /aborted/);
    await waitFor(() => srv.seen.some((m) => m.method === "notifications/cancelled"));
  } finally {
    await srv.close();
  }
});

test("legacy HTTP+SSE: endpoint event, POSTed requests, answers on the stream", async () => {
  const seen = [];
  let stream = null;
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("event: endpoint\ndata: /messages?sid=7\n\n");
      stream = res;
      return;
    }
    const msg = JSON.parse(await readBody(req));
    seen.push({ url: req.url, method: msg.method });
    res.writeHead(202).end();
    const a = answer(msg);
    if (a) stream.write(`event: message\ndata: ${JSON.stringify(a)}\n\n`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    handOver([{ type: "sse", name: "legacy", url: `http://127.0.0.1:${server.address().port}/sse`, headers: [] }]);
    const pi = new FakePi();
    await mod.default(pi);
    assert.equal(text(await pi.tools.get("mcp__legacy__probe").execute("t", {}, undefined, undefined, {})), "remote-ok");
    assert.deepEqual(seen.map((m) => m.method), ["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    assert.ok(seen.every((m) => m.url === "/messages?sid=7"));
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
