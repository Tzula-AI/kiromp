/**
 * Pure dedupe/throttle policy. Per job: one active fix (later failures fold
 * into it), a per-signature cooldown, and a rolling cap on fix attempts.
 */

export interface JobThrottle {
	/** Epoch ms of fix attempts, pruned to the rolling window. */
	attempts: number[];
	/** signature -> epoch ms of the last attempt for it. */
	signatures: Record<string, number>;
	/** "giving up" already logged for the current saturated window. */
	gaveUpLogged: boolean;
}

export interface Limits {
	signatureCooldownMs: number;
	maxAttemptsPerWindow: number;
	attemptWindowMs: number;
}

export type Decision =
	| { kind: "fix" }
	| { kind: "fold" }
	| { kind: "skip"; reason: "signature-cooldown"; retryAfterMs: number }
	| { kind: "skip"; reason: "attempt-cap"; logGiveUp: boolean };

export function emptyThrottle(): JobThrottle {
	return { attempts: [], signatures: {}, gaveUpLogged: false };
}

/**
 * @param busy a fix for this job is running or queued.
 */
export function decide(job: JobThrottle | undefined, signature: string, now: number, busy: boolean, limits: Limits): Decision {
	if (busy) return { kind: "fold" };
	const t = job ?? emptyThrottle();
	const last = t.signatures[signature];
	if (last !== undefined && now - last < limits.signatureCooldownMs) {
		return { kind: "skip", reason: "signature-cooldown", retryAfterMs: limits.signatureCooldownMs - (now - last) };
	}
	const recent = t.attempts.filter((ts) => now - ts < limits.attemptWindowMs).length;
	if (recent >= limits.maxAttemptsPerWindow) {
		return { kind: "skip", reason: "attempt-cap", logGiveUp: !t.gaveUpLogged };
	}
	return { kind: "fix" };
}

/** Returns the updated throttle after starting an attempt; prunes expired entries. */
export function recordAttempt(job: JobThrottle | undefined, signature: string, now: number, limits: Limits): JobThrottle {
	const t = job ?? emptyThrottle();
	const signatures: Record<string, number> = {};
	for (const [sig, ts] of Object.entries(t.signatures)) {
		if (now - ts < limits.signatureCooldownMs) signatures[sig] = ts;
	}
	signatures[signature] = now;
	return {
		attempts: [...t.attempts.filter((ts) => now - ts < limits.attemptWindowMs), now],
		signatures,
		gaveUpLogged: false,
	};
}

export function markGaveUp(job: JobThrottle | undefined): JobThrottle {
	return { ...(job ?? emptyThrottle()), gaveUpLogged: true };
}
