// pi-acp's session map (~/.pi/pi-acp/session-map.json, pi-acp 0.0.34 `SessionStore`) under omp.
//
// session/load resolves a sessionId through that map alone in practice: its fallback
// (`findPiSession`) scans ~/.pi/agent/sessions and reads a session header from each file's
// FIRST line, but omp keeps sessions in ~/.omp/agent/sessions and starts each file with a
// `title` record, so an id missing from the map is "Unknown sessionId" for good.
//
// Entries went missing wholesale: SessionStore rewrites the map in place (writeFileSync =
// truncate, then write) and reads any unparseable map as empty. With a pi-acp process per
// Crew session (hundreds an hour), one that read the file while another was mid-write saw
// "{}" and wrote back a map holding only its own session; every older entry was gone.
//
// - `atomicMapWrites()` (installed into pi-acp by pi-acp-preload.mjs) sends that file's
//   writes through a temp file renamed over it, so a reader sees the old map or the new one.
// - `recoverOmpSession(id)` (pi-acp-wrapper.mjs, before a session/load reaches pi-acp)
//   puts back the entry for an id the map lacks, from omp's own session file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const sessionMapPath = () => path.join(os.homedir(), ".pi", "pi-acp", "session-map.json");
const ompSessionsDir = () => path.join(os.homedir(), ".omp", "agent", "sessions");
const HEAD_BYTES = 16384; // the `session` header is the first or second record
const READ_TRIES = 5;     // a map written by a pi-acp without the preload can be caught mid-write

/** Write `data` to `file` through a sibling temp file renamed over it. */
function writeAtomic(write, file, data, options) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    write(tmp, data, options);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

/** Route `fs.writeFileSync` calls for the session map through `writeAtomic`. Returns the original. */
export function atomicMapWrites() {
  const map = sessionMapPath();
  const write = fs.writeFileSync;
  fs.writeFileSync = function writeFileSync(file, data, options) {
    if (file !== map) return write.apply(this, arguments);
    return writeAtomic(write, file, data, options);
  };
  return write;
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** The map, or null when it stays unreadable (never read as empty: writing that back is the wipe). */
function readMap(file) {
  for (let i = 0; i < READ_TRIES; i++) {
    let raw;
    try { raw = fs.readFileSync(file, "utf8"); } catch (e) {
      if (e?.code === "ENOENT") return { version: 1, sessions: {} };
      return null;
    }
    try {
      const db = JSON.parse(raw);
      if (db?.version === 1 && db.sessions && typeof db.sessions === "object") return db;
      return null; // a shape pi-acp itself would discard: leave it alone
    } catch {}
    sleepSync(20);
  }
  return null;
}

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** The `{type:"session", id, cwd}` header of an omp session file, if it names `id`. */
function sessionHeader(file, id) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    for (const line of buf.subarray(0, n).toString("utf8").split("\n").slice(0, 4)) {
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (rec?.type === "session") return rec.id === id && typeof rec.cwd === "string" ? rec : null;
    }
  } catch {} finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
  return null;
}

/** omp's directory name for `cwd` (home-relative, `/` → `-`): the likely place, tried first. */
function guessDir(cwd) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) return null;
  const home = os.homedir();
  const rel = cwd === home ? "" : cwd.startsWith(home + path.sep) ? cwd.slice(home.length) : cwd;
  return "-" + rel.replace(/^[/\\]+/, "").replace(/[/\\]/g, "-");
}

/** omp's session file for `id`: `<sessions>/<cwd dir>/<timestamp>_<id>.jsonl`, header verified. */
export function findOmpSession(id, cwd) {
  const root = ompSessionsDir();
  const suffix = `_${id}.jsonl`;
  const look = (dir) => {
    let names;
    try { names = fs.readdirSync(path.join(root, dir)); } catch { return null; }
    for (const name of names) {
      if (!name.endsWith(suffix)) continue;
      const file = path.join(root, dir, name);
      const header = sessionHeader(file, id);
      if (header) return { sessionFile: file, cwd: header.cwd };
    }
    return null;
  };
  const first = guessDir(cwd);
  const hit = first && look(first);
  if (hit) return hit;
  let dirs;
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  for (const d of dirs) {
    if (!d.isDirectory() || d.name === first) continue;
    const found = look(d.name);
    if (found) return found;
  }
  return null;
}

/**
 * Make sure pi-acp's map resolves `id` to an existing session file. A missing entry, or one
 * whose file is gone, is (re)written from omp's session file when there is one. Returns what
 * happened: "present" | "recovered" | "absent" (omp has no such session) | "unreadable".
 */
export function recoverOmpSession(id, cwd) {
  if (typeof id !== "string" || !/^[\w.-]+$/.test(id)) return "absent";
  const file = sessionMapPath();
  const db = readMap(file);
  if (!db) return "unreadable";
  const have = db.sessions[id];
  if (have && typeof have.sessionFile === "string" && isFile(have.sessionFile)) return "present";
  const found = findOmpSession(id, cwd);
  if (!found) return "absent";
  // Re-read right before writing so a concurrent pi-acp's entries are kept.
  const fresh = readMap(file);
  if (!fresh) return "unreadable";
  fresh.sessions[id] = { sessionId: id, cwd: found.cwd, sessionFile: found.sessionFile, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(fs.writeFileSync, file, JSON.stringify(fresh, null, 2) + "\n", "utf-8");
  return "recovered";
}
