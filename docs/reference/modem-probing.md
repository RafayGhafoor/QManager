# Probing the Live Modem

Detail behind the `CLAUDE.md` > Live Modem section. A live test modem is on the LAN; SSH credentials live in `.env` (`SSH_HOST`, `SSH_USERNAME`, `SSH_PASSWORD`). Never echo them; `.env` stays gitignored (`git check-ignore .env` before committing in the repo root).

## Modem bridge (`mcp__modem__*`)

A local MCP server at `tools/modem-mcp/`, registered in `.mcp.json`. It holds one persistent SSH connection, reads `.env` itself (secrets never enter the transcript), auto-reconnects and enforces per-call timeouts.

- `modem_exec(command, timeout_s?, stdin?)` returns `{stdout, stderr, exit_code}` (default 30 s, max 600 s). stdin is `/dev/null` unless `stdin` is passed (drive a REPL with e.g. `stdin: "quit\n"`; `qmi_simple_ril_test` ignores EOF). The timeout is enforced on the device: the whole process tree is killed and the result carries `timed_out: true` plus `orphans` (survivors, normally empty). Cancelling a call kills the tree too.
- `modem_ps(pattern?)` / `modem_kill(pid | pattern, signal?)` list and kill processes without `pkill`; PID 1 is refused, and more than 5 pattern matches need `confirm: true`.
- `modem_read(path, max_bytes?)` returns the file content and its real size.
- `modem_write(path, content, mode?, mkdir?)` streams content into `cat > path` (no SFTP or base64 needed), strips CRLF, chmods (755 for `.sh`), runs `sh -n` on shell scripts and returns the byte count plus the syntax result.
- `modem_cgi(endpoint, method?, body?)` curls `http://127.0.0.1/cgi-bin/quecmanager/<endpoint>` on-device with a throwaway session it mints and deletes, so authed endpoints work.

A server-side deny-list refuses `reboot`/`poweroff`/`halt` in command position, `AT+CFUN=1,1`, `firstboot`, factory resets, `rm -rf /`, `opkg remove` and raw `mtd`/`dd` writes unless the call passes `confirm: true`, which is only for an action the user explicitly approved.

Setup: `cd tools/modem-mcp && bun install` once; `bun run smoke.ts` there is a live read-only smoke test.

## Typical uses

Read live UCI config (`uci show quecmanager`), inspect `/tmp/qmanager_*.json` runtime state, tail `/tmp/qmanager.log` and other logs, hit a CGI endpoint, check lock files (`/var/run/qmanager_*.pid`, `/tmp/qmanager_*.lock`), exercise `qcmd` AT calls, confirm `nft list ruleset` after a DPI toggle, verify init.d state, deploy a script under test, and re-read written config after an apply.

## Fallback: Posh-SSH

When the bridge is unavailable (`Install-Module Posh-SSH -Scope CurrentUser`), read the variables from `.env` and never echo them:

```powershell
$cred = [pscredential]::new($env:SSH_USERNAME, (ConvertTo-SecureString $env:SSH_PASSWORD -AsPlainText -Force))
$sess = New-SSHSession -ComputerName $env:SSH_HOST -Credential $cred -AcceptKey -Force
(Invoke-SSHCommand -SessionId $sess.SessionId -Command 'uci show quecmanager').Output
Remove-SSHSession -SessionId $sess.SessionId | Out-Null
```
