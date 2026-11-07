import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eofCursor, lastRecords, readNewRecords } from "../src/tail.js";

let dir: string;
let file: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "cron-medic-tail-"));
	file = join(dir, "job.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("readNewRecords", () => {
	test("reads complete lines and leaves a partial trailing line for later", () => {
		writeFileSync(file, '{"n":1}\n{"n":2}\n{"n":');
		const r1 = readNewRecords(file, undefined);
		expect(r1.records).toEqual([{ n: 1 }, { n: 2 }]);
		expect(r1.cursor.offset).toBe(16);

		const again = readNewRecords(file, r1.cursor);
		expect(again.records).toEqual([]);
		expect(again.cursor.offset).toBe(16);

		appendFileSync(file, '3}\n{"n":4}\n');
		const r2 = readNewRecords(file, again.cursor);
		expect(r2.records).toEqual([{ n: 3 }, { n: 4 }]);
		expect(r2.cursor.offset).toBe(statSync(file).size);
	});

	test("multi-byte UTF-8 split across reads stays intact", () => {
		writeFileSync(file, '{"s":"h');
		const r1 = readNewRecords(file, undefined);
		appendFileSync(file, 'é⛔"}\n');
		expect(readNewRecords(file, r1.cursor).records).toEqual([{ s: "hé⛔" }]);
	});

	test("truncation restarts from 0", () => {
		writeFileSync(file, '{"n":1}\n{"n":2}\n');
		const r1 = readNewRecords(file, undefined);
		writeFileSync(file, '{"n":9}\n');
		const r2 = readNewRecords(file, r1.cursor);
		expect(r2.reset).toBe("truncated");
		expect(r2.records).toEqual([{ n: 9 }]);
	});

	test("rotation (inode change) restarts from 0 even if the new file is larger", () => {
		writeFileSync(file, '{"n":2}\n{"n":3}\n');
		const { ino } = readNewRecords(file, undefined).cursor;
		const r = readNewRecords(file, { ino: ino + 1, offset: 8 });
		expect(r.reset).toBe("rotated");
		expect(r.records).toEqual([{ n: 2 }, { n: 3 }]);
		expect(r.cursor).toEqual({ ino, offset: 16 });
	});

	test("bad JSON lines are reported, not fatal", () => {
		writeFileSync(file, '{"n":1}\nnot json\n{"n":2}\n');
		const r = readNewRecords(file, undefined);
		expect(r.records).toEqual([{ n: 1 }, { n: 2 }]);
		expect(r.badLines).toEqual(["not json"]);
	});

	describe("watermark", () => {
		const at = (r: unknown) => (r && typeof r === "object" && "t" in r && typeof r.t === "number" ? r.t : undefined);
		const line = (n: number, t?: number) => `${JSON.stringify(t === undefined ? { n } : { n, t })}\n`;

		test("a rotated rewrite delivers only records newer than the watermark", () => {
			writeFileSync(file, line(1, 10) + line(2, 20));
			const r1 = readNewRecords(file, undefined, at);
			expect(r1.cursor.watermark).toBe(20);
			// Crew's cap trim: keep the newest lines, append the new run, replace the file.
			const tmp = join(dir, "job.jsonl.tmp");
			writeFileSync(tmp, line(2, 20) + line(3, 30));
			renameSync(tmp, file);
			const r2 = readNewRecords(file, r1.cursor, at);
			expect(r2.reset).toBe("rotated");
			expect(r2.records).toEqual([{ n: 3, t: 30 }]);
			expect(r2.replayed).toBe(1);
			expect(r2.cursor.watermark).toBe(30);
		});

		test("truncation drops replays too, and an unstamped record is always delivered", () => {
			writeFileSync(file, line(1, 10) + line(2, 20) + line(3, 30));
			const r1 = readNewRecords(file, undefined, at);
			writeFileSync(file, line(3, 30) + line(4) + line(5, 40));
			const r2 = readNewRecords(file, r1.cursor, at);
			expect(r2.reset).toBe("truncated");
			expect(r2.records).toEqual([{ n: 4 }, { n: 5, t: 40 }]);
			expect(r2.replayed).toBe(1);
		});

		test("an empty rewrite keeps the watermark for the next one", () => {
			writeFileSync(file, line(1, 10));
			const r1 = readNewRecords(file, undefined, at);
			writeFileSync(file, "");
			const r2 = readNewRecords(file, r1.cursor, at);
			expect(r2.cursor.watermark).toBe(10);
			writeFileSync(file, line(1, 10) + line(2, 20));
			expect(readNewRecords(file, r2.cursor, at).records).toEqual([{ n: 2, t: 20 }]);
		});
	});
});

describe("eofCursor / lastRecords", () => {
	test("eofCursor seeds after the last complete line", () => {
		writeFileSync(file, '{"n":1}\n{"n":2}\n{"n":');
		const c = eofCursor(file);
		expect(c.offset).toBe(16);
		appendFileSync(file, '3}\n');
		expect(readNewRecords(file, c).records).toEqual([{ n: 3 }]);
	});

	test("eofCursor on empty file is 0", () => {
		writeFileSync(file, "");
		expect(eofCursor(file).offset).toBe(0);
	});

	test("lastRecords returns the newest N in order, skipping a partial tail", () => {
		writeFileSync(file, `${[1, 2, 3, 4, 5, 6].map((n) => JSON.stringify({ n })).join("\n")}\n{"n":`);
		expect(lastRecords(file, 3)).toEqual([{ n: 4 }, { n: 5 }, { n: 6 }]);
		expect(lastRecords(join(dir, "missing.jsonl"), 3)).toEqual([]);
	});
});
