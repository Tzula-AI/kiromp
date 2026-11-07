// pi-acp-store.mjs: session/load recovery through the wrapper, and the preload's atomic map writes.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WRAPPER = path.join(HERE, "..", "pi-acp-wrapper.mjs");
const PRELOAD = path.join(HERE, "..", "pi-acp-preload.mjs");
const ID = "01a19b42-80b0-7716-9509-463fe3169a92";

// Fake pi-acp: answers each request with the session map entry it finds for params.sessionId.
const FAKE_CHILD = `
import readline from "node:readline";
import fs from "node:fs";
import os from "node:os";
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  let entry = null;
  try { entry = JSON.parse(fs.readFileSync(os.homedir() + "/.pi/pi-acp/session-map.json", "utf8")).sessions[msg.params?.sessionId] ?? null; } catch {}
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { entry, execArgv: process.execArgv } }) + "\\n");
});
`;

const live = new Set();
after(() => { for (const p of live) p.kill("SIGKILL"); });

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "okb-store-"));
  fs.mkdirSync(path.join(dir, ".pi", "pi-acp"), { recursive: true });
  fs.writeFileSync(path.join(dir, "fake.mjs"), FAKE_CHILD);
  return dir;
}
const mapFile = (h) => path.join(h, ".pi", "pi-acp", "session-map.json");
const writeMap = (h, sessions) => fs.writeFileSync(mapFile(h), JSON.stringify({ version: 1, sessions }));
function ompSession(h, dir, id, cwd) {
  const d = path.join(h, ".omp", "agent", "sessions", dir);
  fs.mkdirSync(d, { recursive: true });
  const file = path.join(d, `2026-11-02T07-56-29-232Z_${id}.jsonl`);
  fs.writeFileSync(file, [
    { type: "title", v: 1, title: "", updatedAt: "2026-11-02T07:56:29.232Z" },
    { type: "session", version: 3, id, timestamp: "2026-11-02T07:56:29.232Z", cwd },
  ].map((r) => JSON.stringify(r)).join("\n") + "\n");
  return file;
}

/** Send one request through the wrapper (HOME = h); resolve with pi-acp's result and the wrapper's stderr. */
function request(h, msg) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [WRAPPER], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOME: h, PI_ACP_REAL: path.join(h, "fake.mjs"), KIROCREW_SCRATCH: h },
    });
    live.add(p);
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", () => {
      live.delete(p);
      const frame = out.split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((f) => f.id === msg.id);
      frame ? resolve({ result: frame.result, stderr: err }) : reject(new Error(`no answer; stderr: ${err}`));
    });
    p.stdin.end(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
  });
}

test("session/load: an id missing from the map is restored from omp's session file before pi-acp sees it", async () => {
  const h = home();
  const cwd = path.join(h, "Documents", "proj");
  const keep = { sessionId: "other", cwd: "/x", sessionFile: "/x/other.jsonl", updatedAt: "t" };
  writeMap(h, { other: keep });
  const file = ompSession(h, "-Documents-proj", ID, cwd);

  const { result, stderr } = await request(h, { id: 1, method: "session/load", params: { sessionId: ID, cwd, mcpServers: [] } });

  assert.equal(result.entry.sessionFile, file);
  assert.equal(result.entry.cwd, cwd);
  assert.match(stderr, /restored from omp's session file/);
  assert.deepEqual(JSON.parse(fs.readFileSync(mapFile(h), "utf8")).sessions.other, keep, "other entries kept");
});

test("session/load: a stale entry (file gone) is repointed; the session is found outside the cwd's directory", async () => {
  const h = home();
  writeMap(h, { [ID]: { sessionId: ID, cwd: "/old", sessionFile: path.join(h, "gone.jsonl"), updatedAt: "t" } });
  const file = ompSession(h, "-somewhere-else", ID, "/somewhere/else");

  const { result } = await request(h, { id: 1, method: "session/load", params: { sessionId: ID, cwd: "/elsewhere", mcpServers: [] } });
  assert.equal(result.entry.sessionFile, file);
});

test("session/load: a present entry, an unknown id and an unreadable map are left untouched", async () => {
  const h = home();
  const file = ompSession(h, "-p", ID, "/p");
  const entry = { sessionId: ID, cwd: "/p", sessionFile: file, updatedAt: "t" };
  writeMap(h, { [ID]: entry });
  const before = fs.readFileSync(mapFile(h), "utf8");
  assert.deepEqual((await request(h, { id: 1, method: "session/load", params: { sessionId: ID, cwd: "/p" } })).result.entry, entry);
  assert.equal((await request(h, { id: 2, method: "session/load", params: { sessionId: "nope", cwd: "/p" } })).result.entry, null);
  assert.equal(fs.readFileSync(mapFile(h), "utf8"), before);

  fs.writeFileSync(mapFile(h), '{"version":1,"sessi'); // a half-written map is never written back as empty
  const { stderr } = await request(h, { id: 3, method: "session/load", params: { sessionId: ID, cwd: "/p" } });
  assert.match(stderr, /unreadable, left as is/);
  assert.equal(fs.readFileSync(mapFile(h), "utf8"), '{"version":1,"sessi');
});

test("pi-acp runs with the preload", async () => {
  const h = home();
  const { result } = await request(h, { id: 1, method: "session/new", params: { cwd: h, mcpServers: [] } });
  assert.deepEqual(result.execArgv, ["--import", PRELOAD]);
});

// pi-acp 0.0.34's SessionStore load/save, verbatim (dist/index.js session-store section).
const UPSERTER = `
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
const P = join(homedir(), ".pi", "pi-acp", "session-map.json");
function loadFile(path) { try { const parsed = JSON.parse(readFileSync(path, "utf-8")); if (parsed?.version !== 1 || typeof parsed.sessions !== "object" || !parsed.sessions) return { version: 1, sessions: {} }; return parsed; } catch { return { version: 1, sessions: {} }; } }
function saveFile(path, data) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(data, null, 2) + "\\n", "utf-8"); }
for (let i = 0; i < 40; i++) { const db = loadFile(P); const id = process.pid + "-" + i; db.sessions[id] = { sessionId: id, cwd: "/x", sessionFile: "/x/" + "y".repeat(200), updatedAt: "" }; saveFile(P, db); }
`;

test("preload: concurrent pi-acp upserts never wipe the map", async () => {
  const h = home();
  const seeds = {};
  for (let i = 0; i < 400; i++) seeds[`seed-${i}`] = { sessionId: `seed-${i}`, cwd: "/x", sessionFile: "/x/" + "y".repeat(200), updatedAt: "" };
  writeMap(h, seeds);
  fs.writeFileSync(path.join(h, "upsert.mjs"), UPSERTER);
  await Promise.all(Array.from({ length: 12 }, () => new Promise((resolve) => {
    const p = spawn(process.execPath, ["--import", PRELOAD, path.join(h, "upsert.mjs")], { env: { ...process.env, HOME: h }, stdio: "inherit" });
    live.add(p);
    p.on("close", () => { live.delete(p); resolve(); });
  })));
  const sessions = JSON.parse(fs.readFileSync(mapFile(h), "utf8")).sessions;
  assert.equal(Object.keys(sessions).filter((k) => k.startsWith("seed-")).length, 400);
  assert.deepEqual(fs.readdirSync(path.dirname(mapFile(h))), ["session-map.json"], "no temp files left");
});
