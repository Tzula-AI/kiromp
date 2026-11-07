/**
 * Incident context gathering (job definition, recent history, newest omp
 * transcript) and the fixer prompt.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import { failureText } from "./signature.js";
import type { FailureRecord, Incident } from "./state.js";
import { lastRecords } from "./tail.js";

const TRACE_TAIL_BYTES = 8 * 1024;
const FIELD_CAP = 8 * 1024;

export interface CronJob {
	id: string;
	name?: string;
	message?: string;
	schedule?: unknown;
	[key: string]: unknown;
}

export interface IncidentContext {
	job: CronJob | undefined;
	recent: FailureRecord[];
	transcript: string | undefined;
}

export function findJob(cronsFile: string, jobId: string): CronJob | undefined {
	try {
		const parsed = JSON.parse(readFileSync(cronsFile, "utf8")) as { jobs?: CronJob[] };
		return parsed.jobs?.find((j) => j.id === jobId);
	} catch {
		return undefined;
	}
}

/** Newest .jsonl across `<sessionsDir>/-workplace-kirocrew-workspace-cron_<jobId>_*`. */
export function newestTranscript(sessionsDir: string, jobId: string): string | undefined {
	const prefix = `-workplace-kirocrew-workspace-cron_${jobId}_`;
	let best: { path: string; mtime: number } | undefined;
	let dirs: string[];
	try {
		dirs = readdirSync(sessionsDir).filter((d) => d.startsWith(prefix));
	} catch {
		return undefined;
	}
	for (const d of dirs) {
		const dir = join(sessionsDir, d);
		let files: string[];
		try {
			files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
		} catch {
			continue;
		}
		for (const f of files) {
			const path = join(dir, f);
			try {
				const mtime = statSync(path).mtimeMs;
				if (!best || mtime > best.mtime) best = { path, mtime };
			} catch {
				/* raced with deletion */
			}
		}
	}
	return best?.path;
}

export function gatherContext(cfg: Config, incident: Incident): IncidentContext {
	return {
		job: findJob(cfg.cronsFile, incident.jobId),
		recent: lastRecords(incident.file, 5) as FailureRecord[],
		transcript: newestTranscript(cfg.ompSessionsDir, incident.jobId),
	};
}

function cap(text: string, bytes: number, from: "head" | "tail"): string {
	const buf = Buffer.from(text, "utf8");
	if (buf.length <= bytes) return text;
	return from === "tail"
		? `…[${buf.length - bytes} bytes omitted]…\n${buf.subarray(buf.length - bytes).toString("utf8")}`
		: `${buf.subarray(0, bytes).toString("utf8")}\n…[${buf.length - bytes} bytes omitted]…`;
}

function when(epochSec: unknown): string {
	return typeof epochSec === "number" ? new Date(epochSec * 1000).toISOString() : "?";
}

function historyLine(r: FailureRecord): string {
	const err = r.status === "failure" ? ` — ${failureText(r).replace(/\s+/g, " ").slice(0, 200)}` : "";
	return `- ${when(r.started_at)} ${r.trigger ?? "?"} ${r.status ?? "?"} (${r.duration_ms ?? "?"} ms, run ${r.run_id ?? "?"})${err}`;
}

function fence(text: string): string {
	const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
	const ticks = "`".repeat(longest + 1);
	return `${ticks}\n${text}\n${ticks}`;
}

export function buildPrompt(cfg: Config, incident: Incident, ctx: IncidentContext): string {
	const r = incident.record;
	const job = ctx.job;
	const schedule = job?.schedule === undefined ? "(unknown)" : JSON.stringify(job.schedule);
	const folded = incident.folded.length
		? `\n### Further failures of this job folded into this incident\n${incident.folded.map(historyLine).join("\n")}\n`
		: "";

	return `You are the Kiro Crew cron medic. A scheduled job just failed. Diagnose the root cause and fix it at the source, then verify.

## Failed job
- id: ${incident.jobId}
- name: ${job?.name ?? "(not found in crons.json)"}
- schedule: ${schedule}
- job definition file: ${cfg.cronsFile} (jobs[] where id == "${incident.jobId}")

### Full job message
${fence(job?.message ?? "(job not found in crons.json — it may have been removed)")}

## Failure record (${incident.file})
- run_id: ${r.run_id ?? "?"}, trigger: ${r.trigger ?? "?"}, started: ${when(r.started_at)}, finished: ${when(r.finished_at)}, duration_ms: ${r.duration_ms ?? "?"}
- normalized signature: ${incident.normalized}

### error
${fence(cap(typeof r.error === "string" ? r.error : "", FIELD_CAP, "head") || "(empty)")}

### summary
${fence(cap(typeof r.summary === "string" ? r.summary : "", FIELD_CAP, "head") || "(empty)")}

### trace (tail, ≤8KB)
${fence(cap(typeof r.trace === "string" ? r.trace : "", TRACE_TAIL_BYTES, "tail") || "(empty)")}
${folded}
## Last ${ctx.recent.length} history records for this job (oldest first)
${ctx.recent.map(historyLine).join("\n") || "(none)"}

## Newest omp transcript for this job
${ctx.transcript ?? "(none found)"}
(Session dirs: ${cfg.ompSessionsDir}/-workplace-kirocrew-workspace-cron_${incident.jobId}_*/ — read the transcript to see what the cron agent actually did.)

## How Kiro Crew runs cron agents (key facts)
- Kiro Crew home: ${cfg.kiroHome}; CLI: \`kirocrew\` (\`kirocrew cron list|update|pause|resume|trigger <job-id>\`, \`kirocrew gateway-pid\`). Jobs: ${cfg.cronsFile}; run history: ${cfg.historyDir}/<job_id>.jsonl.
- Cron agent runs use the "Pi" backend: Kiro spawns \`pi-acp\`, which spawns \`pi --mode rpc --no-themes\` through a Kiro-generated gate script \`~/.kiro/crew/pi-gate/kirocrew_pi_gate_<gwpid>_*.sh\` that adds \`--extension ~/.kiro/crew/pi-gate/kirocrew_pi_gate_<gwpid>.ts\` (Kiro's security tool gate).
- \`~/.local/bin/pi\` is a symlink to the user's bridge \`${cfg.bridgeRepo}/pi-shim.mjs\`, which translates pi-acp's protocol to Oh My Pi (\`~/.bun/bin/omp\`). Bridge repo: ${cfg.bridgeRepo} (pi-shim.mjs, gate-relay.ts, protocol.mjs, reporter.ts, pi-acp-wrapper.mjs, tests in test/ — run them with the command in test/package.json).
- Kiro Crew's own Python lives in \`~/.kiro/crew-venv/lib/python3*/site-packages/kiro_crew\`. NEVER edit the venv in place: fixes to Kiro Crew go through the user's patch stack (\`~/.local/bin/kirocrew-patch-sync\`, systemd user unit kirocrew-patch-sync, patch branches tommy/v<ver> in ~/workplace/KiroCrew) following its conventions — read its header first.

## Rules
- Find the root cause from evidence (history, transcript, logs, source). Fix it at the source, not the symptom.
- NEVER weaken Kiro Crew's security gate policy (denied-command rules, sensitive-path block, governance ceiling) to make a job pass. Fixing a genuine translation/compat bug (the gate cannot see a tool's real args) is legitimate; loosening policy is not. If the job legitimately needs something the gate denies, report that instead of changing policy.
- NEVER read or print secrets (e.g. ~/.kiro/crew/secrets/*, tokens, API keys, auth files).
- Do not git commit in repos unless the fix requires it there; prefer leaving changes in the working tree.
- Other sessions and automations run on this machine; treat unexpected changes as the user's work.
- Verify the fix. You MAY \`kirocrew cron trigger ${incident.jobId}\` only if the job is cheap and idempotent (read-only checks, no messages/posts/deploys/paid work). Never trigger expensive or side-effecting jobs (e.g. humanity-*, jollity-*, forge-security-review, forge-dashboard-sync); verify those by other means.
- If the failure is transient or outside your control (provider outage, quota, network), say so and change nothing.

## Final answer
End with a concise report in exactly these sections:
**Root cause** — with evidence (file:line, log lines).
**Changes** — exact files changed (or "none").
**Verification** — commands run and observed output.
**Remaining risk** — anything unresolved.`;
}
