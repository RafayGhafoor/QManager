// Live smoke test: `bun run smoke.ts` from tools/modem-mcp/. Read-only apart
// from scratch files under /tmp that it removes again.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const c = new Client({ name: "smoke", version: "0" });
await c.connect(new StdioClientTransport({ command: "bun", args: ["run", "server.ts"], cwd: import.meta.dir }));
console.log("tools:", (await c.listTools()).tools.map((t) => t.name).join(", "));

let failures = 0;
async function call(name: string, args: Record<string, unknown>, expectError = false) {
  const r = (await c.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const ok = !!r.isError === expectError;
  if (!ok) failures++;
  console.log(`--- ${ok ? "PASS" : "FAIL"} ${name} isError=${!!r.isError}\n${r.content[0].text.slice(0, 500)}`);
}

await call("modem_exec", { command: "echo lines=$(uci show quecmanager | wc -l); uci show quecmanager | head -3" });
await call("modem_write", { path: "/tmp/modem_mcp_smoke.sh", content: "#!/bin/sh\r\necho hi from bridge\r\n" });
await call("modem_read", { path: "/tmp/modem_mcp_smoke.sh" });
await call("modem_exec", { command: "grep -c $(printf '\\r') /tmp/modem_mcp_smoke.sh; /tmp/modem_mcp_smoke.sh" });
await call("modem_write", { path: "/tmp/modem_mcp_bad.sh", content: "if then fi (\n" }, true);
await call("modem_exec", { command: "sleep 2; reboot" }, true);
await call("modem_exec", { command: "echo AT+CFUN=1,1" }, true);
await call("modem_exec", { command: "grep -c reboot /etc/qmanager/crash.log 2>/dev/null; echo grep-ok" });
await call("modem_exec", { command: "sleep 5", timeout_s: 1 }, true);

// Containment regressions (2026-10-16): interactive tools get EOF, timeouts
// kill the whole remote tree, nothing is left behind.
async function check(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`--- ${ok ? "PASS" : "FAIL"} ${label}\n${detail.slice(0, 500)}`);
}
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0].text;
// qmi_simple_ril_test ignores EOF and idles, so without input the on-device
// timeout is what ends it; with "quit" on stdin it exits by itself.
let t0 = Date.now();
let r = await c.callTool({ name: "modem_exec", arguments: { command: "/usr/bin/qmi_simple_ril_test 2>&1 | tail -3", timeout_s: 4 } });
let jr = JSON.parse(text(r));
await check("REPL without stdin is reaped at timeout", jr.timed_out === true && jr.orphans?.length === 0 && Date.now() - t0 < 9000, `${Date.now() - t0}ms ${text(r)}`);
t0 = Date.now();
r = await c.callTool({ name: "modem_exec", arguments: { command: "/usr/bin/qmi_simple_ril_test 2>&1 | tail -1", stdin: "quit\n", timeout_s: 20 } });
jr = JSON.parse(text(r));
await check("REPL driven via stdin exits by itself", jr.exit_code === 0 && !jr.timed_out && Date.now() - t0 < 10000, `${Date.now() - t0}ms ${text(r)}`);
r = await c.callTool({ name: "modem_ps", arguments: { pattern: "qmi_simple_ril_test" } });
await check("no qmi_simple_ril_test left", JSON.parse(text(r)).length === 0, text(r));
r = await c.callTool({ name: "modem_exec", arguments: { command: "cat; echo done", stdin: "fed-input\n" } });
await check("stdin is fed", text(r).includes("fed-input") && text(r).includes("done"), text(r));
t0 = Date.now();
r = await c.callTool({ name: "modem_exec", arguments: { command: "sleep 120 & sleep 121; echo never", timeout_s: 3 } });
const tr = JSON.parse(text(r));
await check("timeout kills tree", tr.timed_out === true && Array.isArray(tr.orphans) && tr.orphans.length === 0 && Date.now() - t0 < 9000, `${Date.now() - t0}ms ${text(r)}`);
r = await c.callTool({ name: "modem_exec", arguments: { command: "pgrep -f 'sleep 12[01]' | while read p; do grep -qsF QM_MCP_RUN= /proc/$p/environ || echo LEFT $p; done; echo checked" } });
await check("no sleep 120/121 survivors", !text(r).includes("LEFT"), text(r));
r = await c.callTool({ name: "modem_exec", arguments: { command: "ls /tmp/.qm_mcp_* 2>/dev/null | wc -l" } });
await check("no timeout marker files left", JSON.parse(text(r)).stdout.trim() === "0", text(r));
r = await c.callTool({ name: "modem_exec", arguments: { command: "nohup sleep 97 >/dev/null 2>&1 &" } });
r = await c.callTool({ name: "modem_ps", arguments: { pattern: "sleep 97" } });
await check("modem_ps finds process", JSON.parse(text(r)).length === 1, text(r));
r = await c.callTool({ name: "modem_kill", arguments: { pattern: "sleep 97" } });
const kr = JSON.parse(text(r));
await check("modem_kill kills it", kr.matched?.length === 1 && kr.survivors?.length === 0, text(r));
await call("modem_kill", { pid: 1 }, true);
await call("modem_kill", { pattern: "reboot" }, true);
await call("modem_cgi", { endpoint: "auth/check.sh" });
await call("modem_exec", { command: "rm -f /tmp/modem_mcp_smoke.sh /tmp/modem_mcp_bad.sh; ls /tmp/modem_mcp_* 2>&1; echo sessions=$(ls /tmp/qmanager_sessions | wc -l)" });

await c.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
