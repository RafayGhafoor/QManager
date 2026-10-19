# Custom web port (plan)

Move QManager's web server off 80/443 from System Settings, or from SSH.

## What the live modem shows (2026-10-19, RM551E)

- QManager is served by **uhttpd's `main` instance**, shared with LuCI: `listen_http='0.0.0.0:80' '[::]:80'`, `listen_https='0.0.0.0:443' '[::]:443'`, `redirect_https='0'`. So moving the port moves LuCI with it (same server).
- fw4: `lan` / `lan_wan` input ACCEPT, `wan` / `wan_all` REJECT, tailscale accepted. **No firewall rule is needed** for a new port, and none is added (WAN stays closed).
- `install.sh` never touches uhttpd today, so a chosen port survives QManager updates on its own.

## Design

**Source of truth: UCI `quecmanager.web`** (`http_port`, `https_port`), pushed into `uhttpd.main` by one apply routine. uhttpd's config is what persists across reboots; the quecmanager keys are what the user edits.

**SSH command: `qmanager_web_port`** (same family as `qmanager_reset_password`):

```
qmanager_web_port                 # show configured + listening ports
qmanager_web_port set 8080 8443   # validate, write UCI, apply
qmanager_web_port reset           # back to 80 / 443
qmanager_web_port apply           # push quecmanager.web.* after a raw `uci set` + `uci commit`
```

So both `uci set quecmanager.web.http_port=8080 && uci commit quecmanager && qmanager_web_port apply` and the one-liner `set` work.

**Validation** (shared lib `web_port.sh`, used by the CLI and the CGI): integers 1–65535, HTTP ≠ HTTPS, and a port must not already be held by another process (`netstat -ltn`, excluding uhttpd itself). That catches dropbear 22, dnsmasq 53, ttyd, etc. without a hard-coded list.

**Apply + rollback (the lock-out guard):** write `uhttpd.main.listen_http/listen_https` (v4 + v6), commit, `/etc/init.d/uhttpd restart`, then wait up to ~8 s for both ports to show in `netstat`. If they don't, restore the previous `listen_*` values and restart again, and set UCI back. Never a reboot, never CFUN.

**CGI `system/web_port.sh`**:
- GET → `{success, http_port, https_port, listening: {http, https}}`.
- POST `{http_port, https_port}` → validate, reply `{success, apply_in_progress: true, http_port, https_port}` **first**, then a detached `( sleep 1; qmanager_web_port apply ) &` (the same self-severing pattern as `network/lan_config.sh`), because restarting uhttpd kills the request. Errors use the error-code envelope (`invalid_port`, `port_in_use`, `ports_equal`).

**Frontend:** a `WebPortCard` on System Settings (beside Host AT ports): two numeric fields, `CardFoot` with Discard + `SaveButton`. Saving opens a confirm dialog ("You'll be moved to port N"), then on success the browser goes to `protocol//host:newPort/system-settings/` after a short wait, with a failure toast if the POST errors. Hook `use-web-port.ts`, types in `types/web-port.ts`, copy in all five locales.

## Things that hard-code 80 today (fixed in the same change)

- `qmanager_health_check` `t_net_uhttpd_listen` checks 80/443 → read the configured ports.
- `components/local-network/lan-reconnecting.tsx` redirects to `http://<newIp>` → keep the current port.
- `tools/modem-mcp` `modem_cgi` curls `127.0.0.1` on 80 → read the port from `uci get uhttpd.main.listen_http` (dev tool only).

## Lifecycle

- **install**: seed `quecmanager.web` from the current uhttpd values if absent (never overwrite a user choice); copy the CLI + lib + CGI (usr/bin and lib are copied wholesale already, checked).
- **uninstall**: restore uhttpd to 80/443 if QManager moved it, delete `quecmanager.web`, so LuCI is back on the default port.
- **update**: nothing extra (install path, preserve the user choice).
- Config Backup / Restore: **not** included for now (restoring onto another device could move its port unexpectedly). Say if you want it.

## Build order

1. `scripts/usr/lib/qmanager/web_port.sh` (validate / read / apply / rollback)
2. `scripts/usr/bin/qmanager_web_port` (CLI)
3. `scripts/www/cgi-bin/quecmanager/system/web_port.sh`
4. install / uninstall + health check
5. types → hook → card → page slot → locales (5) → error codes
6. lan-reconnecting + modem-mcp port fix

## Validation

- Static: CRLF checker, BusyBox/POSIX audit, `sh -n`, `bunx tsc --noEmit`, lint on touched files, `bun run icons:check` n/a (lucide route).
- On-device: deploy, `qmanager_web_port` show; `set 8080 8443` → curl `127.0.0.1:8080` and `:8443` answer, 80 closed; `set 22 8443` refused (in use); rollback test by forcing a bad bind; CGI GET/POST round-trip on the new port; `reset` back to 80/443 and leave the modem on 80/443 at the end.

## Risks / rollback

- Main risk is lock-out if uhttpd fails to bind: covered by the in-use check plus the automatic rollback. Worst case on SSH: `qmanager_web_port reset`.
- Rolling the feature back = `qmanager_web_port reset`, then remove the files.

## Addendum (2026-10-19, approved with changes)

- Default stays 80 / 443. The SSH installer asks on a fresh interactive install (`prompt_web_port` / `seed_web_port`), and `/setup` gained an optional Web Port step (6 of 7).
- Built and live-validated; the shipped design is in `docs/features/web-port.md`.
