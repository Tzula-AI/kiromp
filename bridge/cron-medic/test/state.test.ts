import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, statePath } from "../src/state.js";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "cron-medic-state-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("a cursor saved without a watermark takes the state file's save time", () => {
	writeFileSync(
		statePath(dir),
		JSON.stringify({
			version: 1,
			seeded: true,
			cursors: { "a.jsonl": { ino: 1, offset: 10 }, "b.jsonl": { ino: 2, offset: 20, watermark: 5 } },
			jobs: {},
			pending: [],
		}),
	);
	utimesSync(statePath(dir), 1_000, 1_000);
	const { cursors } = loadState(dir);
	expect(cursors["a.jsonl"]).toEqual({ ino: 1, offset: 10, watermark: 1_000 });
	expect(cursors["b.jsonl"]).toEqual({ ino: 2, offset: 20, watermark: 5 });
});
