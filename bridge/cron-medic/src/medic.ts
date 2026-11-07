/**
 * The listener: tails the cron history dir, turns failure records into
 * incidents, applies the throttle policy, and runs fixes with bounded
 * concurrency. State is persisted after every change.
 */
import { existsSync, type FSWatcher, mkdirSync, readdirSync, watch } from "node:fs";
import { basename, join } from "node:path";
import type { Config } from "./config.js";
import { runFix } from "./fixer.js";
import { log } from "./log.js";
import { failureText, signatureOf } from "./signature.js";
import { type FailureRecord, type Incident, loadState, type MedicState, saveState } from "./state.js";
import { eofCursor, readNewRecords, type TailResult } from "./tail.js";
import { decide, markGaveUp, recordAttempt } from "./throttle.js";

interface Running {
	incident: Incident;
	controller: AbortController;
	done: Promise<void>;
}

/**
 * Crew rewrites a job's history file (new inode) on every append once it holds
 * its record cap, so a rotation re-presents the retained tail. Runs of one job
 * never overlap (a second claim is refused "already running"), so a run's
 * finish time orders the file and is the watermark that tells the retained tail
 * from new records.
 */
function finishedAt(record: unknown): number | undefined {
	if (!record || typeof record !== "object" || !("finished_at" in record)) return undefined;
	const t = record.finished_at;
	return typeof t === "number" && Number.isFinite(t) ? t : undefined;
}

export class Medic {
	readonly #cfg: Config;
	#state: MedicState;
	readonly #running = new Map<string, Running>();
	#watcher: FSWatcher | undefined;
	#rescanTimer: Timer | undefined;
	#debounce: Timer | undefined;
	#scanning = false;
	#rescanRequested = false;
	#stopping = false;

	constructor(cfg: Config) {
		this.#cfg = cfg;
		mkdirSync(cfg.stateDir, { recursive: true });
		this.#state = loadState(cfg.stateDir);
	}

	start(): void {
		const cfg = this.#cfg;
		log("startup", {
			pid: process.pid,
			history_dir: cfg.historyDir,
			crons_file: cfg.cronsFile,
			state_dir: cfg.stateDir,
			cwd: cfg.kiroHome,
			concurrency: cfg.concurrency,
			signature_cooldown_h: cfg.signatureCooldownMs / 3_600_000,
			max_attempts: cfg.maxAttemptsPerWindow,
			attempt_window_h: cfg.attemptWindowMs / 3_600_000,
			timeout_min: cfg.timeoutMs / 60_000,
			rescan_s: cfg.rescanMs / 1000,
			dry_run: cfg.dryRun,
			model: cfg.model ?? "(omp settings)",
			seeded: this.#state.seeded,
			pending: this.#state.pending.length,
		});
		this.#scan();
		this.#watch();
		this.#rescanTimer = setInterval(() => {
			if (!this.#watcher) this.#watch();
			this.#scan();
		}, cfg.rescanMs);
		this.#pump();
	}

	async stop(reason: string): Promise<void> {
		if (this.#stopping) return;
		this.#stopping = true;
		clearInterval(this.#rescanTimer);
		clearTimeout(this.#debounce);
		this.#watcher?.close();
		log("shutdown", { reason, running: [...this.#running.keys()], pending: this.#state.pending.length });
		for (const r of this.#running.values()) r.controller.abort();
		await Promise.race([
			Promise.allSettled([...this.#running.values()].map((r) => r.done)),
			Bun.sleep(40_000),
		]);
		this.#save();
		log("shutdown_complete", {});
	}

	#save(): void {
		try {
			saveState(this.#cfg.stateDir, this.#state);
		} catch (err) {
			log("state_save_error", { error: String(err) }, "error");
		}
	}

	#watch(): void {
		if (!existsSync(this.#cfg.historyDir)) return;
		try {
			this.#watcher = watch(this.#cfg.historyDir, () => {
				clearTimeout(this.#debounce);
				this.#debounce = setTimeout(() => this.#scan(), 250);
			});
			this.#watcher.on("error", (err) => {
				log("watch_error", { error: String(err) }, "warn");
				this.#watcher?.close();
				this.#watcher = undefined; // re-armed by the periodic rescan
			});
		} catch (err) {
			log("watch_error", { error: String(err) }, "warn");
			this.#watcher = undefined;
		}
	}

	#scan(): void {
		if (this.#stopping) return;
		if (this.#scanning) {
			this.#rescanRequested = true;
			return;
		}
		this.#scanning = true;
		try {
			do {
				this.#rescanRequested = false;
				this.#scanOnce();
			} while (this.#rescanRequested && !this.#stopping);
		} finally {
			this.#scanning = false;
		}
	}

	#scanOnce(): void {
		const dir = this.#cfg.historyDir;
		let names: string[];
		try {
			// Per-job files only: `_index.jsonl` (and other `_` aggregates) duplicate their records.
			names = readdirSync(dir).filter((n) => n.endsWith(".jsonl") && !n.startsWith("_"));
		} catch (err) {
			log("history_dir_unreadable", { dir, error: String(err) }, "warn");
			return;
		}
		const state = this.#state;
		let changed = false;

		if (!state.seeded) {
			const seededAt = Date.now() / 1000;
			for (const name of names) {
				try {
					state.cursors[name] = { ...eofCursor(join(dir, name)), watermark: seededAt };
				} catch {
					/* vanished */
				}
			}
			state.seeded = true;
			log("seeded_at_eof", { files: names.length });
			this.#save();
			return;
		}

		const present = new Set(names);
		for (const name of Object.keys(state.cursors)) {
			if (!present.has(name)) {
				delete state.cursors[name];
				changed = true;
			}
		}
		for (const name of names) {
			const path = join(dir, name);
			const prev = state.cursors[name];
			let res: TailResult;
			try {
				res = readNewRecords(path, prev, finishedAt);
			} catch (err) {
				log("history_read_error", { file: path, error: String(err) }, "warn");
				continue;
			}
			if (res.reset || res.replayed) {
				log("history_file_reset", { file: path, reason: res.reset ?? "replayed", replayed_skipped: res.replayed });
			}
			for (const bad of res.badLines) log("history_bad_line", { file: path, line: bad }, "warn");
			if (
				!prev ||
				prev.offset !== res.cursor.offset ||
				prev.ino !== res.cursor.ino ||
				prev.watermark !== res.cursor.watermark
			) {
				state.cursors[name] = res.cursor;
				changed = true;
			}
			for (const rec of res.records) {
				if (rec && typeof rec === "object" && (rec as FailureRecord).status === "failure") {
					this.#onFailure(rec as FailureRecord, path);
					changed = true;
				}
			}
		}
		if (changed) this.#save();
		this.#pump();
	}

	#onFailure(record: FailureRecord, file: string): void {
		const cfg = this.#cfg;
		const jobId = typeof record.job_id === "string" && record.job_id ? record.job_id : basename(file, ".jsonl");
		const { signature, normalized } = signatureOf(jobId, failureText(record));
		const now = Date.now();
		const active = this.#running.get(jobId)?.incident ?? this.#state.pending.find((p) => p.jobId === jobId);
		const decision = decide(this.#state.jobs[jobId], signature, now, active !== undefined, cfg);
		const base = { job_id: jobId, run_id: record.run_id, signature, normalized };

		switch (decision.kind) {
			case "fold":
				active?.folded.push(record);
				log("incident_folded", { ...base, into_run: active?.record.run_id, running: this.#running.has(jobId) });
				return;
			case "skip":
				if (decision.reason === "signature-cooldown") {
					log("incident_throttled", { ...base, reason: decision.reason, retry_after_min: Math.ceil(decision.retryAfterMs / 60_000) });
				} else if (decision.logGiveUp) {
					this.#state.jobs[jobId] = markGaveUp(this.#state.jobs[jobId]);
					log("giving_up", { ...base, reason: decision.reason, max_attempts: cfg.maxAttemptsPerWindow, window_h: cfg.attemptWindowMs / 3_600_000 }, "warn");
				} else {
					log("incident_throttled", { ...base, reason: decision.reason });
				}
				return;
			case "fix":
				this.#state.jobs[jobId] = recordAttempt(this.#state.jobs[jobId], signature, now, cfg);
				this.#state.pending.push({ jobId, signature, normalized, file, detectedAt: now, record, folded: [] });
				log("incident_queued", { ...base, queue_length: this.#state.pending.length });
		}
	}

	#pump(): void {
		while (!this.#stopping && this.#running.size < this.#cfg.concurrency) {
			const idx = this.#state.pending.findIndex((p) => !this.#running.has(p.jobId));
			if (idx < 0) return;
			const [incident] = this.#state.pending.splice(idx, 1);
			const controller = new AbortController();
			const entry: Running = { incident, controller, done: Promise.resolve() };
			this.#running.set(incident.jobId, entry);
			this.#save();
			log("fix_started", { job_id: incident.jobId, run_id: incident.record.run_id, signature: incident.signature, dry_run: this.#cfg.dryRun });
			entry.done = runFix(this.#cfg, incident, controller.signal)
				.then((res) => {
					log("fix_finished", {
						job_id: incident.jobId,
						signature: incident.signature,
						outcome: res.outcome,
						folded: incident.folded.length,
						run_file: res.runFile,
						session_file: res.sessionFile,
					});
				})
				.catch((err) => {
					log("fix_failed", { job_id: incident.jobId, error: err instanceof Error ? (err.stack ?? err.message) : String(err) }, "error");
				})
				.finally(() => {
					this.#running.delete(incident.jobId);
					this.#save();
					this.#pump();
				});
		}
	}
}
