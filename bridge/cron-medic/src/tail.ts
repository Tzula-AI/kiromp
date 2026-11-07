/**
 * Incremental JSONL tailing with byte cursors. A trailing line without a
 * newline is left unconsumed until it is completed. Truncation (size below
 * cursor) and rotation (inode change) restart the file from offset 0; with a
 * `stampOf`, records at or below the cursor's watermark are dropped as replays
 * of content already delivered. The floor applies on every read, not only the
 * one that saw the reset: a scan landing between an in-place truncate and the
 * rewrite resets on the empty file and reads the old content back later.
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";

export interface Cursor {
	ino: number;
	offset: number;
	/** Highest `stampOf` value consumed from this file; absent until one is seen. */
	watermark?: number;
}

export interface TailResult {
	records: unknown[];
	/** Lines that were complete but not valid JSON. */
	badLines: string[];
	cursor: Cursor;
	/** Why the cursor was reset, if it was. */
	reset?: "truncated" | "rotated";
	/** Records dropped because their stamp was at or below the watermark. */
	replayed: number;
}

const NL = 0x0a;

/**
 * `stampOf` must increase in append order (e.g. a run's finish time when runs
 * never overlap); a record it returns `undefined` for is always delivered.
 */
export function readNewRecords(
	path: string,
	cursor: Cursor | undefined,
	stampOf?: (record: unknown) => number | undefined,
): TailResult {
	const fd = openSync(path, "r");
	try {
		const st = fstatSync(fd);
		const ino = Number(st.ino);
		let offset = cursor?.offset ?? 0;
		let reset: TailResult["reset"];
		if (cursor && cursor.ino !== ino) {
			offset = 0;
			reset = "rotated";
		} else if (offset > st.size) {
			offset = 0;
			reset = "truncated";
		}
		let watermark = cursor?.watermark;
		const length = st.size - offset;
		if (length <= 0) return { records: [], badLines: [], cursor: { ino, offset, watermark }, reset, replayed: 0 };
		const buf = Buffer.allocUnsafe(length);
		let read = 0;
		while (read < length) {
			const n = readSync(fd, buf, read, length - read, offset + read);
			if (n === 0) break;
			read += n;
		}
		const lastNl = buf.lastIndexOf(NL, read - 1);
		if (lastNl < 0) return { records: [], badLines: [], cursor: { ino, offset, watermark }, reset, replayed: 0 };
		const floor = watermark;
		const records: unknown[] = [];
		const badLines: string[] = [];
		let replayed = 0;
		for (const line of buf.toString("utf8", 0, lastNl).split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			let record: unknown;
			try {
				record = JSON.parse(trimmed);
			} catch {
				badLines.push(trimmed.slice(0, 200));
				continue;
			}
			const stamp = stampOf?.(record);
			if (stamp !== undefined) {
				if (floor !== undefined && stamp <= floor) {
					replayed++;
					continue;
				}
				if (watermark === undefined || stamp > watermark) watermark = stamp;
			}
			records.push(record);
		}
		return { records, badLines, cursor: { ino, offset: offset + lastNl + 1, watermark }, reset, replayed };
	} finally {
		closeSync(fd);
	}
}

/** Cursor positioned after the last complete line (used to seed at EOF). */
export function eofCursor(path: string): Cursor {
	const fd = openSync(path, "r");
	try {
		const st = fstatSync(fd);
		const ino = Number(st.ino);
		if (st.size === 0) return { ino, offset: 0 };
		const chunk = Math.min(st.size, 1 << 20);
		const buf = Buffer.allocUnsafe(chunk);
		const n = readSync(fd, buf, 0, chunk, st.size - chunk);
		const lastNl = buf.lastIndexOf(NL, n - 1);
		return { ino, offset: lastNl < 0 ? st.size - chunk : st.size - chunk + lastNl + 1 };
	} finally {
		closeSync(fd);
	}
}

/** Last `count` parseable records of a JSONL file (reads at most the final `maxBytes`). */
export function lastRecords(path: string, count: number, maxBytes = 512 * 1024): unknown[] {
	let fd: number;
	try {
		fd = openSync(path, "r");
	} catch {
		return [];
	}
	try {
		const st = fstatSync(fd);
		const len = Math.min(st.size, maxBytes);
		const buf = Buffer.allocUnsafe(len);
		const n = readSync(fd, buf, 0, len, st.size - len);
		const lines = buf.toString("utf8", 0, n).split("\n");
		if (len < st.size) lines.shift(); // first line may be partial
		const out: unknown[] = [];
		for (let i = lines.length - 1; i >= 0 && out.length < count; i--) {
			const line = lines[i].trim();
			if (!line) continue;
			try {
				out.unshift(JSON.parse(line));
			} catch {
				/* partial or corrupt line */
			}
		}
		return out;
	} finally {
		closeSync(fd);
	}
}
