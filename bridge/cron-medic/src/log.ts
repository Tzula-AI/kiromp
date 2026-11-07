/** One JSON object per line on stdout (journald picks it up). */
export function log(event: string, fields: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info"): void {
	const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
	if (level === "info") console.log(line);
	else console.error(line);
}
