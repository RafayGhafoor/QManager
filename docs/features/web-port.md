# Web Port (custom HTTP / HTTPS ports)

QManager can be served on ports other than 80 / 443. The default stays 80 / 443.

## Where it is set

| Surface | How |
|---|---|
| SSH installer | Fresh interactive install (`quecmanager.web` unset, stdin is a tty) asks `Use different ports? [y/N]`, then HTTP / HTTPS with the current ports as defaults (3 tries, then keeps them). The OTA updater runs without a tty and never prompts. |
| Onboarding (`/setup`) | Step 6 of 7, **Web Port**, optional and skippable. Saves on Continue; the Done step opens the dashboard on the new origin. |
| System Settings | **Web Port** card (`components/system-settings/web-port/web-port-card.tsx`) on **Device Access** (`/system-settings/device-access`), CardFoot apply plus confirm dialog. After a save the card redirects to `<new origin>/system-settings/device-access/`. |
| SSH, after install | `qmanager_web_port` (see below). |

## SSH commands

```sh
qmanager_web_port                  # show configured + listening ports
qmanager_web_port set 8080 8443    # validate, save, apply (rolls back on failure)
qmanager_web_port reset            # back to 80 / 443
# Raw UCI, then apply:
uci set quecmanager.web.http_port=8080
uci set quecmanager.web.https_port=8443
uci commit quecmanager && qmanager_web_port apply
```

Exit status: 0 success, 1 failure (including a rollback), 2 usage.

## Model

- **Server:** uhttpd's `main` instance, shared with LuCI, so LuCI moves too. `uhttpd.main.listen_http` / `listen_https` are rewritten keeping each entry's bind address (`0.0.0.0:P`, `[::]:P`); only the port changes.
- **Source of truth:** UCI `quecmanager.web.http_port` / `https_port`. Readers fall back to the first `uhttpd.main.listen_*` entry, then 80 / 443 (`wp_conf_http` / `wp_conf_https`). Other features that need the port (e.g. a scrape config) should use those functions or the CGI GET.
- **Firewall:** no change. LAN and tailscale zones accept all input; WAN / wan_all stay REJECT for every port.
- **Library:** `scripts/usr/lib/qmanager/web_port.sh` (validate, save, write uhttpd, apply with rollback). Used by the CLI, the CGI, `install.sh` and `uninstall.sh`.

## Invariants

1. **Validation:** integers 1 to 65535, no leading zero, HTTP ≠ HTTPS, and neither port held by a non-uhttpd TCP listener (`netstat -ltnp`). No hard-coded reserved list; dropbear 22, dnsmasq 53, ttyd 7681 and the rest are caught live.
2. **Apply with rollback:** `wp_apply` takes `/var/lock/qmanager_web_port.lock` (BusyBox `flock` has no `-w`: `-n` poll, 30 s), writes uhttpd, `restart`s it with FD 8 closed, and waits up to 10 s for uhttpd to listen on both ports. If not, it restores the old `listen_*` lists **and** `quecmanager.web`, restarts again, and reports `rolled_back`. Live-verified by forcing a bind on port 22.
3. **Self-severing CGI:** `system/web_port.sh` POST validates, saves UCI, replies `{apply_in_progress:true}` first, then runs `qmanager_web_port apply` in a double-forked background (`sleep 1`). The restart kills the request otherwise. Never a reboot.
4. **Last result:** `/var/run/qmanager/web_port.result` (`status http https epoch`), surfaced as `last_result` in GET.
5. **Browser move:** `lib/web-port.ts` builds the new origin on the **same protocol** (http page → HTTP port, https page → HTTPS port; an https page can't probe http anyway) and polls it with a no-cors fetch. The login cookie is host-scoped, so the session survives the move. `localStorage` is origin-scoped (port included), so per-browser conveniences (SMS read state, logo cache, remembered tabs) start fresh on a new port.
6. **`set -e` safety:** `install.sh` / `uninstall.sh` run under `set -e`; every lib call that can return non-zero inside `$(...)` or a bare `uci -q delete` is guarded with `|| true`.

## Lifecycle

- **install:** `prompt_web_port` (after preflight) then `seed_web_port` (end of `seed_uci_defaults`). Seeds `quecmanager.web` only if absent (an existing choice is preserved). With the default reboot, only the config is written; with `--no-reboot`, `wp_apply` restarts uhttpd now. The summary prints `http://<ip>:<port>` when the port is not 80.
- **update (OTA):** no prompt; an existing section is preserved.
- **uninstall:** if `quecmanager.web` exists and uhttpd is off 80 / 443, rewrite uhttpd to 80 / 443 (restart only with `--no-reboot`), before `/usr/lib/qmanager` and the UCI namespace are deleted.
- **Config Backup / Restore:** not included (restoring onto another device could move its port unexpectedly).

## Other places that knew about port 80

- `qmanager_health_check` `t_net_uhttpd_listen` reads the configured ports.
- `components/local-network/lan-reconnecting.tsx` keeps the page's protocol and port when redirecting to the new LAN address.
- `tools/modem-mcp` `modem_cgi` reads the HTTP port from uhttpd (dev tool; needs an MCP server restart to pick up).

## CGI

`GET/POST /cgi-bin/quecmanager/system/web_port.sh`

- GET → `{success, http_port, https_port, listening:{http,https}, last_result:{status,http_port,https_port,at}|null}`
- POST `{http_port:N, https_port:N}` (JSON numbers) → `{success, apply_in_progress, http_port, https_port}`
- Errors: `invalid_port`, `ports_equal`, `port_in_use`, `apply_failed`, `method_not_allowed`.
