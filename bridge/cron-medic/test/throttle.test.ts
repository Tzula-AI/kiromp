import { describe, expect, test } from "bun:test";
import { decide, type Limits, markGaveUp, recordAttempt } from "../src/throttle.js";

const H = 3_600_000;
const limits: Limits = { signatureCooldownMs: 6 * H, maxAttemptsPerWindow: 3, attemptWindowMs: 24 * H };
const T0 = 1_800_000_000_000;

describe("decide", () => {
	test("first failure of a job → fix", () => {
		expect(decide(undefined, "j:a", T0, false, limits)).toEqual({ kind: "fix" });
	});

	test("failure while the job's fix is running or queued → fold (even if otherwise throttled)", () => {
		const t = recordAttempt(undefined, "j:a", T0, limits);
		expect(decide(t, "j:a", T0 + 1, true, limits)).toEqual({ kind: "fold" });
		expect(decide(t, "j:b", T0 + 1, true, limits)).toEqual({ kind: "fold" });
	});

	test("same signature within 6h → skip; at 6h → fix", () => {
		const t = recordAttempt(undefined, "j:a", T0, limits);
		const d = decide(t, "j:a", T0 + 6 * H - 1, false, limits);
		expect(d).toEqual({ kind: "skip", reason: "signature-cooldown", retryAfterMs: 1 });
		expect(decide(t, "j:a", T0 + 6 * H, false, limits)).toEqual({ kind: "fix" });
	});

	test("different signature for the same job is not blocked by cooldown", () => {
		const t = recordAttempt(undefined, "j:a", T0, limits);
		expect(decide(t, "j:b", T0 + 1, false, limits)).toEqual({ kind: "fix" });
	});

	test("4th attempt within rolling 24h → attempt-cap; give-up logged only once; window rolls", () => {
		let t = recordAttempt(undefined, "j:a", T0, limits);
		t = recordAttempt(t, "j:b", T0 + H, limits);
		t = recordAttempt(t, "j:c", T0 + 2 * H, limits);
		const capped = decide(t, "j:d", T0 + 3 * H, false, limits);
		expect(capped).toEqual({ kind: "skip", reason: "attempt-cap", logGiveUp: true });
		t = markGaveUp(t);
		expect(decide(t, "j:e", T0 + 4 * H, false, limits)).toEqual({ kind: "skip", reason: "attempt-cap", logGiveUp: false });
		// First attempt ages out of the 24h window → allowed again.
		expect(decide(t, "j:d", T0 + 24 * H, false, limits)).toEqual({ kind: "fix" });
	});

	test("recordAttempt prunes expired attempts/signatures and re-arms give-up logging", () => {
		let t = markGaveUp(recordAttempt(undefined, "j:a", T0, limits));
		t = recordAttempt(t, "j:b", T0 + 25 * H, limits);
		expect(t.attempts).toEqual([T0 + 25 * H]);
		expect(Object.keys(t.signatures)).toEqual(["j:b"]);
		expect(t.gaveUpLogged).toBe(false);
	});
});
