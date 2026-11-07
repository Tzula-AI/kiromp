#!/usr/bin/env node
// Minimal stdio MCP server for the bridge's tests and live captures. Newline-delimited
// JSON-RPC on stdin/stdout. Every message it receives is appended to $PROBE_LOG (one JSON
// line: {pid, method, params, token}) so a test can see exactly what the client asked.
// Tools: crew_probe_echo -> "crew-stdio-mount-proved" (plus " <text>" when given);
//        crew_probe_fail -> isError result.
import fs from "node:fs";
import readline from "node:readline";

const log = (rec) => {
  if (process.env.PROBE_LOG) fs.appendFileSync(process.env.PROBE_LOG, JSON.stringify({ pid: process.pid, ...rec }) + "\n");
};
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const TOOLS = [
  {
    name: "crew_probe_echo",
    description: "Returns a fixed proof string, followed by `text` when given.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, additionalProperties: false },
  },
  { name: "crew_probe_fail", description: "Always fails.", inputSchema: { type: "object", properties: {} } },
];

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  log({ method: msg.method ?? null, params: msg.params, token: process.env.PROBE_TOKEN ?? null });
  if (msg.id === undefined || msg.method === undefined) return;
  switch (msg.method) {
    case "initialize":
      return out({ jsonrpc: "2.0", id: msg.id, result: {
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "crew-probe", version: "1" },
      } });
    case "tools/list":
      return out({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
    case "tools/call": {
      const { name, arguments: args = {} } = msg.params ?? {};
      if (name === "crew_probe_echo") {
        const text = typeof args.text === "string" && args.text ? ` ${args.text}` : "";
        return out({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `crew-stdio-mount-proved${text}` }] } });
      }
      if (name === "crew_probe_fail")
        return out({ jsonrpc: "2.0", id: msg.id, result: { isError: true, content: [{ type: "text", text: "probe failure" }] } });
      return out({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: `unknown tool ${name}` } });
    }
    default:
      return out({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } });
  }
});
