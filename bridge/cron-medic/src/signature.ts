/**
 * Failure signatures: job id + the error text with volatile parts (numbers,
 * hex/random ids, temp and sandbox file names, timestamps) stripped, so the
 * same underlying fault maps to the same signature across runs.
 */
import { createHash } from "node:crypto";

const MAX_NORMALIZED = 600;

const RULES: Array<[RegExp, string]> = [
	// ISO-8601 timestamps.
	[/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<ts>"],
	// UUIDs.
	[/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>"],
	// Paths inside temp/runtime dirs (…/tmp/…, …/run/…, /dev/shm/…).
	[/(?:\/[^\s'"`,;:()[\]]*)?\/(?:tmp|run|shm)\/[^\s'"`,;:()[\]]+/g, "<tmpfile>"],
	// Temp/sandbox file names outside such dirs (kirocrew_sandbox_<pid>_<rand>.py, tmp_xyz, foo.tmp).
	[/[\w.-]*(?:_sandbox_|(?<![A-Za-z])tmp[_.-])[\w.-]*/gi, "<tmpfile>"],
	[/[\w-]+\.tmp(?![\w])/gi, "<tmpfile>"],
	// <pid>_<random> suffixes embedded in generated names (kirocrew_pi_gate_1839178_mycb8ocg.sh).
	[/_\d+_[A-Za-z0-9]{4,}/g, "_<id>"],
	// Hex ids (≥6 chars, at least one digit), with or without 0x.
	[/(?<![A-Za-z0-9])(?:0x)?(?=[a-f]*\d)[0-9a-f]{6,}(?![A-Za-z0-9])/gi, "<hex>"],
	// Mixed alphanumeric random tokens (≥6 chars, letters and digits).
	[/(?<![A-Za-z0-9])(?=[a-z]*\d)(?=\d*[a-z])[a-z0-9]{6,}(?![A-Za-z0-9])/gi, "<id>"],
	// Remaining numbers.
	[/\d+(?:\.\d+)?/g, "<n>"],
];

export function normalizeError(text: string): string {
	let out = text;
	for (const [re, replacement] of RULES) out = out.replace(re, replacement);
	out = out.replace(/\s+/g, " ").trim();
	return out.length > MAX_NORMALIZED ? out.slice(0, MAX_NORMALIZED) : out;
}

/** Text that identifies a failure record: `error`, falling back to `summary`. */
export function failureText(record: { error?: unknown; summary?: unknown }): string {
	if (typeof record.error === "string" && record.error.trim()) return record.error;
	if (typeof record.summary === "string" && record.summary.trim()) return record.summary;
	return "(no error text)";
}

export function signatureOf(jobId: string, errorText: string): { signature: string; normalized: string } {
	const normalized = normalizeError(errorText);
	const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
	return { signature: `${jobId}:${digest}`, normalized };
}
