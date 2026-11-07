/**
 * Persistent medic state: per-file tail cursors, per-job throttle, and the
 * queue of incidents not yet started. Writes are atomic (tmp + rename).
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Cursor } from "./tail.js";
import type { JobThrottle } from "./throttle.js";

export interface FailureRecord {
	run_id?: string;
	job_id?: string;
	trigger?: string;
	started_at?: number;
	finished_at?: number;
	duration_ms?: number;
	status?: string;
	summary?: string;
	trace?: string;
	error?: string;
	[key: string]: unknown;
}

export interface Incident {
	jobId: string;
	signature: string;
	normalized: string;
	file: string;
	detectedAt: number;
	record: FailureRecord;
	/** Failures for the same job that arrived while this incident was queued/running. */
	folded: FailureRecord[];
}

export interface MedicState {
	version: 1;
	/** False until the first scan seeded cursors at EOF. */
	seeded: boolean;
	/** history file basename -> cursor. */
	cursors: Record<string, Cursor>;
	jobs: Record<string, JobThrottle>;
	pending: Incident[];
}

export function emptyState(): MedicState {
	return { version: 1, seeded: false, cursors: {}, jobs: {}, pending: [] };
}

export function statePath(stateDir: string): string {
	return join(stateDir, "state.json");
}

export function loadState(stateDir: string): MedicState {
	const path = statePath(stateDir);
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return emptyState();
	}
	const parsed = JSON.parse(raw) as Partial<MedicState>;
	if (parsed?.version !== 1) throw new Error(`unsupported state version in ${path}`);
	const cursors = parsed.cursors ?? {};
	// Cursors saved before watermarks existed: every scan saves after reading to
	// EOF, so a record finished before the last save was already consumed.
	const savedAt = statSync(path).mtimeMs / 1000;
	for (const cursor of Object.values(cursors)) cursor.watermark ??= savedAt;
	return {
		version: 1,
		seeded: parsed.seeded === true,
		cursors,
		jobs: parsed.jobs ?? {},
		pending: parsed.pending ?? [],
	};
}

export function saveState(stateDir: string, state: MedicState): void {
	mkdirSync(stateDir, { recursive: true });
	const path = statePath(stateDir);
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
	renameSync(tmp, path);
}
