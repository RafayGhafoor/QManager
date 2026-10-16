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
await call("modem_cgi", { endpoint: "auth/check.sh" });
await call("modem_exec", { command: "rm -f /tmp/modem_mcp_smoke.sh /tmp/modem_mcp_bad.sh; ls /tmp/modem_mcp_* 2>&1; echo sessions=$(ls /tmp/qmanager_sessions | wc -l)" });

await c.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
