/**
 * Runtime configuration, all from env vars with defaults. Paths resolve
 * against $HOME so the service and tests can point anywhere.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
	historyDir: string;
	cronsFile: string;
	stateDir: string;
	/** cwd for the fixer session (Kiro Crew home). */
	kiroHome: string;
	ompSessionsDir: string;
	bridgeRepo: string;
	concurrency: number;
	signatureCooldownMs: number;
	maxAttemptsPerWindow: number;
	attemptWindowMs: number;
	timeoutMs: number;
	rescanMs: number;
	dryRun: boolean;
	/** Optional omp model pattern override; unset = user's omp settings. */
	model: string | undefined;
}

const HOUR = 3_600_000;

function num(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
	const raw = env[key];
	if (raw === undefined || raw.trim() === "") return fallback;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a non-negative number, got ${JSON.stringify(raw)}`);
	return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const home = env.HOME || homedir();
	const kiroCrew = join(home, ".kiro", "crew");
	return {
		historyDir: env.CRON_MEDIC_HISTORY_DIR || join(kiroCrew, "cron-history"),
		cronsFile: env.CRON_MEDIC_CRONS_FILE || join(kiroCrew, "crons.json"),
		stateDir: env.CRON_MEDIC_STATE_DIR || join(home, ".local", "state", "kirocrew-cron-medic"),
		kiroHome: env.CRON_MEDIC_KIRO_HOME || kiroCrew,
		ompSessionsDir: env.CRON_MEDIC_OMP_SESSIONS_DIR || join(home, ".omp", "agent", "sessions"),
		bridgeRepo: env.CRON_MEDIC_BRIDGE_REPO || join(home, ".local", "lib", "omp-kiro-bridge"),
		concurrency: Math.max(1, Math.floor(num(env, "CRON_MEDIC_CONCURRENCY", 1))),
		signatureCooldownMs: num(env, "CRON_MEDIC_SIGNATURE_COOLDOWN_HOURS", 6) * HOUR,
		maxAttemptsPerWindow: Math.floor(num(env, "CRON_MEDIC_MAX_ATTEMPTS", 3)),
		attemptWindowMs: num(env, "CRON_MEDIC_ATTEMPT_WINDOW_HOURS", 24) * HOUR,
		timeoutMs: num(env, "CRON_MEDIC_TIMEOUT_MINUTES", 45) * 60_000,
		rescanMs: Math.max(1, num(env, "CRON_MEDIC_RESCAN_SECONDS", 60)) * 1000,
		dryRun: env.CRON_MEDIC_DRY_RUN === "1" || env.CRON_MEDIC_DRY_RUN === "true",
		model: env.CRON_MEDIC_MODEL || undefined,
	};
}
