#!/usr/bin/env bun
// QManager modem bridge: a local stdio MCP server holding one persistent SSH
// connection to the test modem. Tools: modem_exec, modem_read, modem_write,
// modem_cgi. Credentials come from the repo's .env and are never logged or
// returned. stdout is the MCP channel, so diagnostics go to stderr only.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client, type ClientChannel } from "ssh2";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_TIMEOUT_S = 30;
const MAX_TIMEOUT_S = 600;
const MAX_OUTPUT_BYTES = 256 * 1024;

// ---------------------------------------------------------------- env

function loadEnv(): { host: string; port: number; username: string; password: string } {
  const vars: Record<string, string> = {};
  try {
    for (const line of readFileSync(join(REPO_ROOT, ".env"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      vars[m[1]] = v;
    }
  } catch {
    // fall through to process.env
  }
  const get = (k: string) => process.env[k] || vars[k] || "";
  const host = get("SSH_HOST");
  const username = get("SSH_USERNAME");
  const password = get("SSH_PASSWORD");
  if (!host || !username) throw new Error("SSH_HOST / SSH_USERNAME missing from .env");
  return { host, port: Number(get("SSH_PORT")) || 22, username, password };
}

const ENV = loadEnv();

// Scrub any accidental echo of the password from text we return.
function redact(s: string): string {
  return ENV.password ? s.split(ENV.password).join("[REDACTED]") : s;
}

// ---------------------------------------------------------------- connection

let conn: Client | null = null;
let connecting: Promise<Client> | null = null;

function connect(): Promise<Client> {
  if (conn) return Promise.resolve(conn);
  if (connecting) return connecting;
  connecting = new Promise<Client>((res, rej) => {
    const c = new Client();
    let settled = false;
    c.on("ready", () => {
      settled = true;
      conn = c;
      connecting = null;
      res(c);
    });
    c.on("error", (err) => {
      if (conn === c) conn = null;
      if (!settled) {
        settled = true;
        connecting = null;
        rej(new Error(`SSH connect failed: ${redact(err.message)}`));
      }
    });
    c.on("close", () => {
      if (conn === c) conn = null;
    });
    // Dropbear on the modem may offer only keyboard-interactive.
    c.on("keyboard-interactive", (_n, _i, _l, prompts, finish) => finish(prompts.map(() => ENV.password)));
    c.connect({
      host: ENV.host,
      port: ENV.port,
      username: ENV.username,
      password: ENV.password,
      tryKeyboard: true,
      readyTimeout: 15000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
    });
  });
  return connecting;
}

type ExecResult = { stdout: string; stderr: string; exit_code: number | null; timed_out?: boolean; truncated?: boolean };

function execOnce(c: Client, command: string, timeoutS: number, stdin?: string): Promise<ExecResult> {
  return new Promise((res, rej) => {
    c.exec(command, (err, ch: ClientChannel) => {
      if (err) return rej(err);
      const out: Buffer[] = [];
      const errb: Buffer[] = [];
      let outLen = 0;
      let errLen = 0;
      let truncated = false;
      let code: number | null = null;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { ch.signal("KILL"); } catch {}
        try { ch.close(); } catch {}
      }, timeoutS * 1000);
      ch.on("data", (d: Buffer) => {
        if (outLen < MAX_OUTPUT_BYTES) out.push(d); else truncated = true;
        outLen += d.length;
      });
      ch.stderr.on("data", (d: Buffer) => {
        if (errLen < MAX_OUTPUT_BYTES) errb.push(d); else truncated = true;
        errLen += d.length;
      });
      ch.on("exit", (c2: number | null) => { code = c2; });
      ch.on("close", () => {
        clearTimeout(timer);
        const r: ExecResult = {
          stdout: redact(Buffer.concat(out).subarray(0, MAX_OUTPUT_BYTES).toString("utf8")),
          stderr: redact(Buffer.concat(errb).subarray(0, MAX_OUTPUT_BYTES).toString("utf8")),
          exit_code: timedOut ? null : code,
        };
        if (timedOut) r.timed_out = true;
        if (truncated) r.truncated = true;
        res(r);
      });
      if (stdin !== undefined) ch.end(stdin);
      else ch.end();
    });
  });
}

// Run a command, reconnecting once if the connection dropped underneath us.
async function run(command: string, timeoutS = DEFAULT_TIMEOUT_S, stdin?: string): Promise<ExecResult> {
  const t = Math.min(Math.max(timeoutS, 1), MAX_TIMEOUT_S);
  for (let attempt = 0; ; attempt++) {
    const c = await connect();
    try {
      return await execOnce(c, command, t, stdin);
    } catch (e) {
      if (conn === c) { conn = null; try { c.end(); } catch {} }
      if (attempt >= 1) throw e;
    }
  }
}

// ---------------------------------------------------------------- guard rails

const DENY: { name: string; re: RegExp }[] = [
  // Command position only, so `grep reboot crash.log` stays allowed.
  { name: "reboot/poweroff/halt", re: /(^|[;&|`(]|\$\(|\b(then|do|else|exec|nohup|sudo))\s*(\/s?bin\/|\/usr\/s?bin\/)?(reboot|poweroff|halt)\b/im },
  { name: "AT+CFUN=1,1", re: /AT\+CFUN\s*=\s*1\s*,\s*1/i },
  { name: "firstboot", re: /\bfirstboot\b/i },
  { name: "factory reset", re: /factory[\s_-]*reset|\bjffs2reset\b|AT\+QPRTPARA\s*=\s*3|AT&F/i },
  { name: "rm -rf /", re: /\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rR][a-zA-Z]*\s+(-[a-zA-Z]*\s+)*\/(\*|\s|$|[;&|])/ },
  { name: "opkg remove", re: /\bopkg\s+(remove|uninstall)\b/i },
  { name: "mtd/dd to block device", re: /\bmtd\s+(erase|write)\b|\bdd\b[^\n]*\bof=\/dev\//i },
];

function denied(text: string): string | null {
  for (const d of DENY) if (d.re.test(text)) return d.name;
  return null;
}

function refusal(rule: string) {
  return {
    isError: true,
    content: [{
      type: "text" as const,
      text: `Refused: command matches deny rule "${rule}". Re-call with confirm:true only if the user explicitly approved this destructive action.`,
    }],
  };
}

function json(obj: unknown, isError = false) {
  return { isError, content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function fail(e: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: redact(e instanceof Error ? e.message : String(e)) }] };
}

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// ---------------------------------------------------------------- server

const server = new McpServer({ name: "modem", version: "0.1.0" });

server.registerTool(
  "modem_exec",
  {
    description:
      "Run a shell command on the live QManager test modem (BusyBox /bin/sh over a persistent SSH connection). " +
      "Returns {stdout, stderr, exit_code}. Destructive commands (reboot, AT+CFUN=1,1, firstboot, factory reset, rm -rf /, opkg remove) are refused unless confirm:true.",
    inputSchema: {
      command: z.string().min(1),
      timeout_s: z.number().positive().max(MAX_TIMEOUT_S).optional().describe(`default ${DEFAULT_TIMEOUT_S}`),
      confirm: z.boolean().optional().describe("Bypass the deny-list; only with explicit user approval"),
    },
  },
  async ({ command, timeout_s, confirm }) => {
    const rule = denied(command);
    if (rule && !confirm) return refusal(rule);
    try {
      const r = await run(command, timeout_s);
      return json(r, !!r.timed_out);
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  "modem_read",
  {
    description: "Read a file on the modem. Returns {path, size, content, truncated}.",
    inputSchema: {
      path: z.string().min(1),
      max_bytes: z.number().int().positive().max(MAX_OUTPUT_BYTES).optional().describe("default 65536"),
    },
  },
  async ({ path, max_bytes }) => {
    const n = max_bytes ?? 65536;
    try {
      const r = await run(`[ -f ${sq(path)} ] || { echo "not a file: ${path.replace(/["$`\\]/g, "")}" >&2; exit 2; }; wc -c < ${sq(path)}; head -c ${n} ${sq(path)}`);
      if (r.exit_code !== 0) return json(r, true);
      const nl = r.stdout.indexOf("\n");
      const size = Number(r.stdout.slice(0, nl).trim());
      return json({ path, size, truncated: size > n, content: r.stdout.slice(nl + 1) });
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  "modem_write",
  {
    description:
      "Write a file on the modem by streaming content into `cat > path` (no SFTP/base64 needed). CRLF is stripped, mode applied (default 644, or 755 for .sh), " +
      "and .sh files are checked with `sh -n`. Returns {path, bytes, mode, syntax_ok, syntax_error}.",
    inputSchema: {
      path: z.string().min(1).regex(/^\//, "absolute path required"),
      content: z.string(),
      mode: z.string().regex(/^[0-7]{3,4}$/).optional(),
      mkdir: z.boolean().optional().describe("create parent directory first"),
      confirm: z.boolean().optional().describe("Bypass the deny-list for content; only with explicit user approval"),
    },
  },
  async ({ path, content, mode, mkdir, confirm }) => {
    const body = content.replace(/\r\n?/g, "\n");
    const isSh = /\.sh$/.test(path) || body.startsWith("#!/bin/sh");
    const rule = isSh ? denied(body) : null;
    if (rule && !confirm) return refusal(rule);
    const m = mode ?? (isSh ? "755" : "644");
    const p = sq(path);
    const parent = sq(path.replace(/\/[^/]*$/, "") || "/");
    const cmd =
      `${mkdir ? `mkdir -p ${parent} && ` : ""}cat > ${p} && chmod ${m} ${p} && wc -c < ${p}` +
      (isSh ? ` && { sh -n ${p} 2>&1 && echo SYNTAX_OK || echo SYNTAX_FAIL; }` : "");
    try {
      const r = await run(cmd, 60, body);
      if (r.exit_code !== 0) return json(r, true);
      const lines = r.stdout.trimEnd().split("\n");
      const bytes = Number(lines[0]);
      const res: Record<string, unknown> = { path, bytes, expected_bytes: Buffer.byteLength(body), mode: m };
      if (isSh) {
        const last = lines[lines.length - 1];
        res.syntax_ok = last === "SYNTAX_OK";
        if (!res.syntax_ok) res.syntax_error = lines.slice(1, -1).join("\n");
      }
      return json(res, bytes !== res.expected_bytes || res.syntax_ok === false);
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  "modem_cgi",
  {
    description:
      "Call a QManager CGI endpoint on-device via curl to http://127.0.0.1/cgi-bin/quecmanager/<endpoint>. " +
      "Authenticates with a throwaway session minted on-device and removed afterwards. Returns {status, body} (body parsed as JSON when possible).",
    inputSchema: {
      endpoint: z.string().min(1).describe("e.g. 'at_cmd/fetch_data.sh' or 'system/settings.sh?x=1'"),
      method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional(),
      body: z.union([z.string(), z.record(z.string(), z.unknown())]).optional().describe("request body; objects are JSON-encoded"),
      timeout_s: z.number().positive().max(MAX_TIMEOUT_S).optional(),
    },
  },
  async ({ endpoint, method, body, timeout_s }) => {
    const ep = endpoint.replace(/^\/+/, "").replace(/^cgi-bin\/quecmanager\//, "");
    if (/(^|\/)\.\.(\/|$)/.test(ep)) return fail("endpoint may not contain ..");
    const m = method ?? (body !== undefined ? "POST" : "GET");
    const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const tok = randomBytes(32).toString("hex");
    const sess = `/tmp/qmanager_sessions/${tok}`;
    const t = Math.min(timeout_s ?? DEFAULT_TIMEOUT_S, MAX_TIMEOUT_S);
    const curl =
      `curl -s -m ${t} -X ${m} -H 'Cookie: qm_session=${tok}' ` +
      (payload !== undefined ? `-H 'Content-Type: application/json' --data-binary @- ` : "") +
      `-w '\\n__HTTP_STATUS__%{http_code}' ${sq(`http://127.0.0.1/cgi-bin/quecmanager/${ep}`)}`;
    const cmd = `mkdir -p /tmp/qmanager_sessions && date +%s > ${sess}; ${curl}; rc=$?; rm -f ${sess}; exit $rc`;
    try {
      const r = await run(cmd, t + 5, payload);
      const idx = r.stdout.lastIndexOf("\n__HTTP_STATUS__");
      const status = idx >= 0 ? Number(r.stdout.slice(idx + 16).trim()) : null;
      const raw = idx >= 0 ? r.stdout.slice(0, idx) : r.stdout;
      let parsed: unknown = raw;
      try { parsed = JSON.parse(raw); } catch {}
      return json({ status, body: parsed, ...(r.exit_code ? { curl_exit: r.exit_code, stderr: r.stderr } : {}) },
        r.exit_code !== 0 || !status || status >= 400);
    } catch (e) { return fail(e); }
  },
);

await server.connect(new StdioServerTransport());
console.error(`[modem-mcp] ready (target from .env)`);
