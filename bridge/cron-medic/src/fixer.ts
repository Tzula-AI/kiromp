/**
 * One fix attempt: an in-process Oh My Pi SDK session (user's normal omp
 * settings, auth and model) persisted like any omp session, bounded by a hard
 * timeout and an external abort signal. Every attempt leaves a runs/*.md file.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AgentSession, createAgentSession, SessionManager } from "@oh-my-pi/pi-coding-agent";
import type { Config } from "./config.js";
import { log } from "./log.js";
import { buildPrompt, gatherContext } from "./prompt.js";
import type { Incident } from "./state.js";

/** After abort is requested, how long to wait for the session to wind down (and again for dispose). */
const ABORT_GRACE_MS = 15_000;

export type Outcome = "completed" | "timeout" | "aborted" | "error" | "dry-run";

export interface FixResult {
	outcome: Outcome;
	report: string;
	sessionFile: string | undefined;
	runFile: string;
}

function utcStamp(d: Date): string {
	return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function writeRunFile(
	cfg: Config,
	incident: Incident,
	started: Date,
	res: Omit<FixResult, "runFile">,
	jobName: string | undefined,
	prompt: string,
): string {
	const dir = join(cfg.stateDir, "runs");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${utcStamp(started)}-${incident.jobId}.md`);
	const folded = incident.folded.length
		? incident.folded.map((r) => `- run ${r.run_id ?? "?"} at ${typeof r.started_at === "number" ? new Date(r.started_at * 1000).toISOString() : "?"}: ${String(r.error ?? r.summary ?? "").replace(/\s+/g, " ").slice(0, 300)}`).join("\n")
		: "(none)";
	const body = `# Cron medic — ${jobName ?? "(unknown job)"} (${incident.jobId})

- started: ${started.toISOString()}
- finished: ${new Date().toISOString()}
- outcome: ${res.outcome}
- signature: \`${incident.signature}\`
- normalized error: ${incident.normalized}
- history file: ${incident.file}
- omp session file: ${res.sessionFile ?? "(none)"}

## Incident record

\`\`\`json
${JSON.stringify(incident.record, null, 2)}
\`\`\`

## Folded failures

${folded}

## Report

${res.report}

## Prompt

\`\`\`\`text
${prompt}
\`\`\`\`
`;
	writeFileSync(path, body);
	return path;
}

export async function runFix(cfg: Config, incident: Incident, signal: AbortSignal): Promise<FixResult> {
	const started = new Date();
	const ctx = gatherContext(cfg, incident);
	const prompt = buildPrompt(cfg, incident, ctx);

	if (cfg.dryRun) {
		log("dry_run_prompt", { job_id: incident.jobId, signature: incident.signature, prompt });
		const res = { outcome: "dry-run" as const, report: "(dry run — no session spawned)", sessionFile: undefined };
		return { ...res, runFile: writeRunFile(cfg, incident, started, res, ctx.job?.name, prompt) };
	}

	let outcome: Outcome = "completed";
	let report = "";
	let sessionFile: string | undefined;
	let session: AgentSession | undefined;
	let gaveUp = false;
	// Resolves ABORT_GRACE_MS after a stop was requested, so a session that
	// ignores abort is abandoned instead of wedging the medic.
	const abandon = Promise.withResolvers<void>();
	let graceTimer: Timer | undefined;
	const requestStop = (why: "timeout" | "aborted") => {
		if (outcome !== "completed") return;
		outcome = why;
		if (why === "timeout") log("fix_timeout", { job_id: incident.jobId, timeout_ms: cfg.timeoutMs }, "warn");
		void session?.abort({ reason: `cron-medic ${why}` });
		graceTimer = setTimeout(abandon.resolve, ABORT_GRACE_MS);
	};
	const onAbort = () => requestStop("aborted");
	const timer = setTimeout(() => requestStop("timeout"), cfg.timeoutMs);
	if (signal.aborted) onAbort();
	else signal.addEventListener("abort", onAbort, { once: true });

	const run = (async () => {
		const created = await createAgentSession({
			cwd: cfg.kiroHome,
			sessionManager: SessionManager.create(cfg.kiroHome),
			...(cfg.model ? { modelPattern: cfg.model } : {}),
		});
		if (gaveUp) {
			void created.session.dispose();
			return;
		}
		session = created.session;
		sessionFile = session.sessionFile;
		log("fix_session_started", {
			job_id: incident.jobId,
			signature: incident.signature,
			session_file: sessionFile,
			model: session.model ? `${session.model.provider}/${session.model.id}` : undefined,
		});
		if (outcome !== "completed") return; // stop requested while the session was being created
		await session.prompt(prompt);
		await session.waitForIdle();
	})();
	let settled = false;
	run.then(
		() => (settled = true),
		() => (settled = true),
	);
	try {
		await Promise.race([run, abandon.promise]);
		if (!settled) {
			gaveUp = true;
			log("fix_abandoned", { job_id: incident.jobId, grace_ms: ABORT_GRACE_MS }, "warn");
		}
	} catch (err) {
		if (outcome === "completed") outcome = "error";
		report = `Session error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n\n`;
	} finally {
		clearTimeout(timer);
		clearTimeout(graceTimer);
		signal.removeEventListener("abort", onAbort);
		if (session) {
			sessionFile ??= session.sessionFile;
			report += session.getLastAssistantText() ?? "(no final assistant text)";
			try {
				await Promise.race([session.dispose(), Bun.sleep(ABORT_GRACE_MS)]);
			} catch (err) {
				log("fix_dispose_error", { job_id: incident.jobId, error: String(err) }, "warn");
			}
		} else if (!report) {
			report = "(session was never created)";
		}
	}
	if (outcome !== "completed") report = `**Session ${outcome}** — the report below may be partial.\n\n${report}`;
	const res = { outcome, report, sessionFile };
	return { ...res, runFile: writeRunFile(cfg, incident, started, res, ctx.job?.name, prompt) };
}
