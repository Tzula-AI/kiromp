import { describe, expect, test } from "bun:test";
import { failureText, normalizeError, signatureOf } from "../src/signature.js";

const gateError = (pid: number, sandbox: string, gate: string, secs: string) =>
	`Pi tool calls would not reach Kiro Crew's security gate (the harness's command registry could not be read back (Command '['/home/tommy/.kiro/crew-venv/bin/python', '-I', '-S', '/home/tommy/.kiro/crew/run/kirocrew_sandbox_${pid}_${sandbox}.py', '/home/tommy/.kiro/crew/pi-gate/kirocrew_pi_gate_${pid}_${gate}.sh', '--mode', 'rpc', '--no-themes']' timed out after ${secs} seconds))`;

describe("normalizeError", () => {
	test("same fault with different pids, sandbox names and timings normalizes identically", () => {
		const a = normalizeError(gateError(1839178, "1ssjhe9y", "mycb8ocg", "30.0"));
		const b = normalizeError(gateError(42, "zz9abc12", "q1w2e3r4", "45.5"));
		expect(a).toBe(b);
		expect(a).not.toMatch(/\d/);
		expect(a).toContain("kirocrew_pi_gate_<id>.sh");
		expect(a).toContain("<tmpfile>");
	});

	test("strips hex ids, uuids, timestamps and /tmp paths", () => {
		const a = normalizeError("run 0f805c84411f failed at 2026-11-02T09:00:01.5Z writing /tmp/omp-xyz/out.json id 3f2b1c9e-1d2a-4b3c-9d8e-7f6a5b4c3d2e");
		const b = normalizeError("run 7124a68dd56a failed at 2025-01-01T00:00:00Z writing /tmp/abc/q.json id 00000000-1111-2222-3333-444444444444");
		expect(a).toBe(b);
		expect(a).toBe("run <hex> failed at <ts> writing <tmpfile> id <id>");
	});

	test("keeps distinguishing words (different faults stay different)", () => {
		expect(normalizeError("3 of 93 tool call(s) blocked by the security gate: bash, bash, edit")).toBe(
			"<n> of <n> tool call(s) blocked by the security gate: bash, bash, edit",
		);
		expect(normalizeError("provider quota exceeded")).not.toBe(normalizeError("provider timeout"));
	});

	test("does not treat ordinary words containing 'tmp'/'temp' as temp files", () => {
		expect(normalizeError("attempt to template failed")).toBe("attempt to template failed");
	});

	test("collapses whitespace and caps length", () => {
		expect(normalizeError("  a \n\t b  ")).toBe("a b");
		expect(normalizeError("x ".repeat(2000)).length).toBe(600);
	});
});

describe("signatureOf / failureText", () => {
	test("signature is job-scoped and stable across volatile noise", () => {
		const s1 = signatureOf("5fff6dfd", gateError(1, "aaaa1111", "bbbb2222", "30.0"));
		const s2 = signatureOf("5fff6dfd", gateError(2, "cccc3333", "dddd4444", "31.0"));
		const other = signatureOf("1caae56b", gateError(1, "aaaa1111", "bbbb2222", "30.0"));
		expect(s1.signature).toBe(s2.signature);
		expect(s1.signature.startsWith("5fff6dfd:")).toBe(true);
		expect(other.signature).not.toBe(s1.signature);
	});

	test("failureText prefers error, falls back to summary", () => {
		expect(failureText({ error: "boom", summary: "s" })).toBe("boom");
		expect(failureText({ error: "  ", summary: "s" })).toBe("s");
		expect(failureText({})).toBe("(no error text)");
	});
});
