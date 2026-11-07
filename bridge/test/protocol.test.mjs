// protocol.mjs: where the wrapper's socket and private files go.
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import { privateDirFor, socketPathFor } from "../protocol.mjs";

const PID = 2557281;
const NAME = `omp-bridge-${PID}.sock`;

test("socket goes under a short $KIROCREW_SCRATCH", () => {
  const scratch = "/home/u/.kiro/crew/scratch/dashboard-chat-1";
  assert.equal(socketPathFor(PID, { KIROCREW_SCRATCH: scratch }), path.join(scratch, NAME));
});

test("a scratch too long for sun_path falls past a TMPDIR that is the same directory", () => {
  // Kiro Crew sets TMPDIR to the session scratch, so os.tmpdir() is no shorter, and the
  // old fallback handed back a path that cannot bind: the bridge went dark.
  const scratch = "/home/someone.with.a.long.name/.kiro/crew/scratch/dashboard-member-probe.memory-member-pro-55f5058d";
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = scratch;
  try {
    assert.equal(os.tmpdir(), scratch);
    const sock = socketPathFor(PID, { KIROCREW_SCRATCH: scratch });
    assert.equal(sock, path.join("/tmp", NAME));
    assert.ok(Buffer.byteLength(sock) <= 100);
  } finally {
    if (saved === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
  }
});

test("private files stay in the session scratch even when the socket cannot", () => {
  const scratch = "/x".repeat(60);
  assert.equal(privateDirFor(path.join("/tmp", NAME), { KIROCREW_SCRATCH: scratch }), scratch);
  assert.equal(privateDirFor(path.join("/run/u", NAME), {}), "/run/u");
});
