# Tailscale VPN

QManager installs, updates, connects and manages the Tailscale daemon from the monitoring UI, and keeps the modem reachable over the tailnet. Because the modem runs OpenWRT/BusyBox with constrained overlay storage, the install and update pipeline (`tailscale_mgr.sh`) stages the official static arm64 build in RAM, verifies it, and swaps it into `/usr/bin` with a kept backup and an automatic rollback. A second library (`tailscale_net.sh`) owns the two things plain IP over the tunnel needs: an fw4 zone and a routing rule. The CGI is a thin control layer over `tailscale`/`tailscaled`; it does not own Tailscale's config beyond the UCI boot-enable flag and the install-method marker (exit-node and SSH prefs are set through `tailscale set` and live in tailscaled's own state).

Only the **official** build is installable. The old "Tiny" opkg variant (iamromulan `tailscale-tiny`) is retired; installs that already exist keep working and are flagged `legacy_build`.

Frontend anatomy lives in [`docs/reference/tailscale.md`](../reference/tailscale.md).

---

## Quick Reference

| Item | Value |
|---|---|
| CGI | `scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh` (`GET/POST /cgi-bin/quecmanager/vpn/tailscale.sh`) |
| Install / update pipeline | `scripts/usr/lib/qmanager/tailscale_mgr.sh` (guard `_TS_MGR_LOADED`) |
| Reachability (zone + rule) | `scripts/usr/lib/qmanager/tailscale_net.sh` (guard `_TS_NET_LOADED`) |
| Boot re-assert | `scripts/etc/init.d/qmanager_tailscale_net` (START=99, non-procd, `stop()` is a no-op) |
| Official init writer (shared lib) | `scripts/usr/lib/qmanager/tailscale_initd.sh` (canonical `qm_write_ts_initd`; sourced by `tailscale_mgr.sh` and the OTA boot-fix migration). Unchanged by the rework |
| Install marker | `/etc/tailscale/.qm_install_method` (`official` or `tiny`) |
| Tailscale state | `/etc/tailscale/tailscaled.state` |
| Install / update progress | `/tmp/qmanager_tailscale_install.json` (`{success,status,message,detail?,error?,op,variant?}`) |
| Install / update live log | `/var/run/qmanager/tailscale_install.log` |
| Install / update lock | `/var/lock/qmanager_tailscale_migrate.lock` (`<pid>\n<op>`, stale when the pid is dead) |
| Latest-version cache | `/var/run/qmanager/tailscale_latest.json` (6 h TTL, 30 min back-off after a failed check) |
| Auth URL cache | `/tmp/qmanager_tailscale_auth_url` |
| `tailscale up` PID / output | `/tmp/qmanager_tailscale_up_pid`, `/var/run/qmanager/tailscale_up_output` |
| UCI (boot enable) | `tailscale.settings.service_enabled` (`0`/`1`) |
| UCI (network fixes) | `quecmanager.tailscale_net.enabled` (`1` default, `0` = off) |
| Routing rule | `ip rule to 100.64.0.0/10 lookup 52 pref 1990` plus v6 `to fd7a:115c:a1e0::/48` |
| fw4 zone | `tailscale` (device `tailscale0`, ACCEPT, `lan` to `tailscale` and `tailscale` to `lan` forwardings) |
| init.d script | `/etc/init.d/tailscale` (written by `qm_write_ts_initd` on the official path; opkg-owned on legacy installs) |
| Reboot? | No |
| Hook | `hooks/use-tailscale.ts` |
| Frontend | `components/monitoring/tailscale/tailscale.tsx` (page root) |
| i18n | `tailscale.*` in `common.json`; error codes in `errors.json`, all five locales |

---

## Endpoint Contract

### GET `/cgi-bin/quecmanager/vpn/tailscale.sh`

Returns a tiered response. The GET never touches the network: `latest_version` comes from the cache file only.

**Busy (checked first).** While `ts_lock_op` finds a live holder (an install or update worker, or a CGI that pre-acquired the lock), the GET answers immediately and reads nothing else:

```json
{ "success": true, "installed": true, "busy": "install" }
```

`busy` is `"install"` or `"update"` (any other recorded op reads as `"install"`).

**Tier 1, not installed:**

```json
{
  "success": true,
  "installed": false,
  "other_vpn_installed": false,
  "other_vpn_name": "NetBird"
}
```

`install_hint` and `install_variants` no longer exist.

**Tier 2, installed, daemon not running:**

```json
{
  "success": true,
  "installed": true,
  "daemon_running": false,
  "enabled_on_boot": false,
  "version": "1.102.2",
  "install_variant": "official",
  "latest_version": "1.104.1",
  "update_available": true,
  "legacy_build": false,
  "net_fixes_enabled": true,
  "other_vpn_installed": false,
  "other_vpn_name": "NetBird"
}
```

**Tier 3, daemon running but `tailscale status --json` unparseable:** the tier-2 fields (with `daemon_running: true`) plus `backend_state: "Unknown"` and `error_detail`.

**Tier 4, daemon running, status parsed:** the tier-2 fields plus:

```json
{
  "backend_state": "Running",
  "exit_node_advertised": false,
  "ssh_enabled": false,
  "auth_url": "",
  "self": { "hostname": "rm551e", "dns_name": "rm551e.tail1234.ts.net.", "tailscale_ips": ["100.x.y.z"], "online": true, "os": "linux", "relay": "sfo" },
  "tailnet": { "name": "example.com", "magic_dns_suffix": "tail1234.ts.net", "magic_dns_enabled": true },
  "peers": [ { "hostname": "laptop", "dns_name": "laptop.tail1234.ts.net.", "tailscale_ips": ["100.a.b.c"], "os": "windows", "online": true, "last_seen": "", "relay": "sfo", "exit_node": false } ],
  "health": []
}
```

| Field | Meaning |
|---|---|
| `install_variant` | `"official"`, `"tiny"` or `"opkg"` from `ts_variant`. The marker file is authoritative; `opkg list-installed` is the fallback for installs that predate it |
| `legacy_build` | `true` when the variant is `tiny` or `opkg`. The page shows a banner; Update is refused |
| `latest_version` | Cached official version (`""` when unknown or the last good check is older than 6 h) |
| `update_available` | `true` only on an `official` install and only when `latest_version` is greater than `version` (`ts_version_gt`, dotted-numeric) |
| `net_fixes_enabled` | `ts_net_enabled`: UCI `quecmanager.tailscale_net.enabled` is not `0` |
| `exit_node_advertised` | `.Self.ExitNodeOption` from `tailscale status --json` (tier 4 only) |
| `ssh_enabled` | `RunSSH` from `tailscale debug prefs`, or `null` when unreadable (tier 4 only) |
| `backend_state` | Raw `BackendState` (`Running`, `NeedsLogin`, `Stopped`, ...) |
| `auth_url` | From the status JSON, else the persisted file; cleared once `Running` |

### POST `/cgi-bin/quecmanager/vpn/tailscale.sh`

All POST bodies are JSON. Mutating actions call `check_migration_lock` first: a live lock holder returns `migration_in_progress`; a dead or untrusted holder is stale and the lock file is removed so a crashed worker can never wedge the page.

| Action | Request | Behaviour |
|---|---|---|
| `install` | `{variant?: "official"}` | Background install (below). Any other `variant`, including `"tiny"`, returns `invalid_variant` |
| `install_status` | none | The progress file plus `log` (see below) |
| `check_update` | `{force?: bool}` | `{success, installed_version, latest_version, update_available, checked_at}`. Uses the cache unless `force` is true or `ts_latest_cache_due`; a refresh is synchronous and bounded (`TS_FETCH_RETRY=1`: at most two 20 s attempts) |
| `update` | none | Official builds only. Background update (below). Returns `{success:true}` |
| `set_net_fixes` | `{enabled: bool}` | Writes UCI now, returns `{success:true, enabled}`, then applies or tears down in an orphaned background job after the response (`ts_net_apply` / `ts_net_teardown`, after `sleep 1`). Apply is skipped when Tailscale is not installed. Runs before the `not_installed` gate |
| `connect` | none | Starts the daemon if needed, re-asserts reachability (`ts_net_prep`), then `tailscale up --accept-dns=false --json` as a double-forked orphan; polls up to 10 s. On the official variant it also sets `service_enabled=1` and `init.d enable` |
| `disconnect` | none | `tailscale down`; the device stays registered |
| `logout` | none | `tailscale logout`; the device leaves the tailnet |
| `start_service` | none | Starts `tailscaled` via init.d, then `ts_net_prep` |
| `stop_service` | none | Stops `tailscaled`; kills an in-flight `tailscale up` first |
| `set_boot_enabled` | `{enabled: bool}` | Toggles `tailscale.settings.service_enabled` and `init.d enable|disable` |
| `set_exit_node` | `{enabled: bool}` | `tailscale set --advertise-exit-node=<bool>`; requires `BackendState == "Running"` |
| `set_ssh` | `{enabled: bool}` | `tailscale set --ssh=<bool>`; requires `BackendState == "Running"`. QManager stores no copy; the GET reads it back from prefs |
| `uninstall` | none | Method-aware removal (see Uninstall Flow), then `ts_net_teardown` in the background after the response |

> ℹ️ NOTE: Advertising an exit node does not make peers route through it. The node must also be approved in the Tailscale admin console. IP-forwarding warnings appear in the `health` array until the kernel is configured.

**Error codes** (all in `errors.json`, five locales):

| Code | Action(s) | Meaning |
|---|---|---|
| `library_missing` | any | `tailscale_mgr.sh` or `tailscale_net.sh` is absent |
| `invalid_variant` | install | `variant` present and not `"official"` |
| `other_vpn_installed` | install | NetBird is installed |
| `already_installed` | install | Tailscale binaries already present |
| `already_running` | install, update, start_service | A worker holds the lock (install or update), or the daemon is already up |
| `migration_in_progress` | other mutating actions | The lock is held (any op) |
| `not_installed` | most post-install actions, update | Tailscale not installed |
| `legacy_build` | update | The variant is `tiny` or `opkg` |
| `up_to_date` | update | The cached latest is not newer than the installed version (the worker re-checks and reports the same code through progress) |
| `update_check_failed` | check_update, install, update | `pkgs.tailscale.com` unreachable or the response format changed |
| `insufficient_space` | install, update | Not enough RAM for staging, or not enough flash for the swap |
| `unsupported_arch` | install, update | `uname -m` is not `aarch64` |
| `checksum_mismatch` | install, update | The `.sha256` file is missing, malformed or does not match |
| `install_failed` / `update_failed` | install / update | Generic worker failure (`<op>_failed`) |
| `update_rolled_back` | update | The new build failed its health check and the old binaries were restored |
| `missing_field` / `invalid_value` | set_boot_enabled, set_exit_node, set_ssh, set_net_fixes | Required field absent / wrong type |
| `save_failed` | set_net_fixes | `uci commit quecmanager` failed |
| `no_init_script` | set_boot_enabled | `/etc/init.d/tailscale` absent |
| `not_connected` | set_exit_node, set_ssh | Daemon down or `BackendState != "Running"` |
| `set_failed` | set_exit_node, set_ssh | `tailscale set` exited non-zero |
| `daemon_start_failed` / `auth_timeout` | connect | Daemon did not start in 5 s / no auth URL in 10 s |
| `start_failed` | start_service | Daemon not running after start |
| `disconnect_failed` / `logout_failed` | disconnect / logout | The CLI exited non-zero |
| `uninstall_failed` | uninstall | A binary is still present after removal |

**`install_status`.** Returns `/tmp/qmanager_tailscale_install.json` (or `{"success":true,"status":"idle"}` when absent; a half-written file reads as `running`) plus `log`: the last 50 lines of `/var/run/qmanager/tailscale_install.log`, CR translated to LF first. The progress file carries:

```json
{ "success": true, "status": "running", "message": "Downloading Tailscale 1.104.1...", "op": "update" }
```

Terminal success adds `"variant":"official"`. Terminal failure is `{"success":false,"status":"error","message":"...","detail":"...","error":"update_rolled_back","op":"update"}`; `error` is one of the codes above and the frontend resolves it through `resolveErrorMessage`. `status` is `idle`, `running`, `complete` or `error`; `op` is `install` or `update`.

---

## Install (official only)

The CGI checks `invalid_variant`, `check_worker_lock`, NetBird and `already_installed`, then `spawn_ts_worker install`: it takes the lock with its own pid, truncates the log, writes a fresh `running` progress (so `install_status` never shows the previous run's terminal state) and orphans `( ts_do_install ) </dev/null >>log 2>&1 &`.

`ts_do_install` runs, under the lock:

1. `ts_stage_official <dir>` (shared with update, below), working dir `/var/run/qmanager/tailscale_dl`.
2. Flash guard: `/usr/bin` free must be at least the new CLI plus daemon plus 8 MB, else `insufficient_space`.
3. `ts_swap_binaries` with no backup mode (fresh install). On failure the half-installed files are removed and `install_failed` is reported.
4. `qm_write_ts_initd` writes `/etc/init.d/tailscale` (fails with `install_failed` if the lib is missing).
5. Marker `official`, written with `qm_durable_write`; `ts_seed_uci_settings` seeds `tailscale.settings.service_enabled=0`.
6. `ts_net_apply` when network fixes are enabled.
7. Progress `complete`.

### Staging (`ts_stage_official`)

Shared by install and update. Nothing under `/usr/bin` is touched until every step passes.

1. Refuse non-`aarch64` (`unsupported_arch`).
2. RAM guard: work dir free at least 100 MB and `MemAvailable` at least 128 MB (`insufficient_space`).
3. `ts_latest_refresh`: reads `https://pkgs.tailscale.com/stable/?mode=json`. The version is `.TarballsVersion`, falling back to `.Version`; the tarball is `.Tarballs.arm64` and must equal `tailscale_<ver>_arm64.tgz`.
4. `curl --proto =https` download of the tarball, then its `.sha256`. **Fail closed:** a missing, non-hex or wrong-length checksum, or a mismatch, is `checksum_mismatch`.
5. Extraction needs free RAM of at least 3x the tarball. `tar -xzf`, falling back to `gzip -dc | tar -x` when the BusyBox `tar` lacks `-z`.
6. Smoke test in RAM: `tailscale version` and `tailscaled --version` must both report the resolved version.

> ℹ️ NOTE: Tailscale's GitHub releases carry no binaries. The official static builds live on `pkgs.tailscale.com/stable`, which is the only source.

**Why `TarballsVersion`:** the old installer read `.Version`, which is not the tarball version in that JSON, so the UI showed "latest" instead of a number.

---

## Update

`update` is available only on `official` installs. The CGI refuses `legacy_build`, `already_running` / `migration_in_progress`, and `up_to_date` (only when the cache holds a latest version), then spawns the worker with op `update`. The worker (`_ts_update_body`):

1. `ts_variant` must be `official` (else `not_installed` / `legacy_build`).
2. `ts_latest_refresh`, then `ts_version_gt latest installed` or `up_to_date`.
3. `ts_stage_official`, and a second version check against the staged build.
4. `ts_space_plan` picks how the old binaries are kept:

   | Mode | Condition | Backup |
   |---|---|---|
   | `overlay` | overlay free at least new total + 16 MB | Hard links `/usr/bin/.tailscale.old` and `.tailscaled.old` (no flash cost) |
   | `tmp` | free at least new CLI + 8 MB, free after the CLI swap at least new daemon + 8 MB, and `MemAvailable` at least old total + 96 MB | Copies in `/var/run/qmanager/tailscale_bak` (RAM) |
   | neither | | `insufficient_space` |

5. `ts_swap_binaries`: back up per mode, then for the CLI first and `tailscaled` second, `cp` to `/usr/bin/.NAME.new`, `chmod 755`, `sync`, `mv -f` over the target. If the daemon was running before the swap, the old `tailscaled` inode stays allocated; swapping the CLI first frees its inode before the larger daemon file is written, which is what the `tmp` arithmetic assumes.
6. If the daemon was running: `/etc/init.d/tailscale restart`. The official init's `stop_service` is a no-op, so `tailscaled.state`, `WantRunning` and the command line are preserved and the node stays logged in. The tunnel drops for about 10 s.
7. `ts_wait_healthy <ver> 30`: the CLI reports the new version, `tailscaled` is running, and `tailscale status --json` parses. When the daemon was not running before, it only checks the CLI version (`nodaemon`).
8. **Failure:** `ts_restore_binaries` (rename the `.old` links back, or reinstall from RAM), restart again if it had been running, drop the backup and report `update_rolled_back`. If the restore itself fails, the backup is kept (`TS_KEEP_BACKUP=1`) and `update_failed` is reported.
9. **Success:** drop the backup, `ts_net_ensure_rules` when enabled, progress `complete`.

The worker's EXIT trap (`_ts_worker_exit`) rolls back a swap that was still pending when the worker was killed, removes the work dir and the RAM backup, and releases the lock.

> ⚠️ WARNING: The page may be served over the tunnel that the restart drops. The frontend tolerates up to 20 s of failed `install_status` reads during an update; see [`docs/reference/tailscale.md`](../reference/tailscale.md).

**Shell-only test knob.** `TS_TEST_FAIL_HEALTH=1` makes `ts_wait_healthy` fail so the rollback path can be exercised from a shell. The CGI runs `unset TS_TEST_FAIL_HEALTH` at load, so a request can never set it.

### Latest-version cache

`ts_latest_refresh` writes `/var/run/qmanager/tailscale_latest.json` (`{version, tarball, checked_at, ok_at, ok}`). `ts_latest_cache_read` returns the version only while the last good check (`ok_at`) is under 6 h old and never touches the network. `ts_latest_cache_due` is true when there is no cache, it has expired, or a failed attempt is older than 30 min; a failed check keeps the last good version in the file but stamps the attempt so callers back off. A clock step backwards counts as due. Uninstall deletes the cache.

---

## Lock

`/var/lock/qmanager_tailscale_migrate.lock` holds `<pid>\n<op>` and serializes install and update workers (and any other Tailscale mutation, through `check_migration_lock`).

- The CGI acquires it with its own pid **before** spawning the worker, so a second click cannot start a second worker. The worker then takes it over by rewriting it with its own pid (`ts_lock_acquire`, which accepts a holder equal to `$$`).
- A pid that is not alive, or a lock file that is not root-owned, is stale (`ts_lock_holder` uses `qm_read_pid`). A crashed holder therefore no longer wedges `migration_in_progress` forever, which the old pid-less lock did.
- `ts_lock_acquire` creates the file with `set -C` (noclobber) for atomic creation.
- `check_worker_lock` (install and update actions) returns `already_running` for an `install` / `update` holder and `migration_in_progress` for anything else.

**Why:** the old `/var/run/qmanager/tailscale_install.pid` is gone. `install.sh` no longer takes this lock (`migrate_tailscale_packages` was removed).

---

## Network Reachability (`tailscale_net.sh`)

Two pieces, both required for plain IP (ping, SSH, HTTPS to `100.x.y.z`) over the tailnet. `tailscale_net.sh` is the single owner; it replaces `vpn_firewall.sh` and the `qmanager_vpn_zone` init, both deleted. NetBird keeps its own `netbird_firewall.sh` and `qmanager_netbird_zone`.

**Root cause (validated on the live modem, 2026-10-19).** The old fix added `100.64.0.0/10` to the mwan3 ipset `mwan3_connected_ipv4`. mwan3 flushes and rebuilds that ipset on every refresh, so the add never lasted. Without it, mwan3 marks replies `0x11` and its rule `2005 fwmark 0x11 lookup 5` beats tailscaled's `5270 lookup 52`, so replies to peers and LAN-to-tailnet traffic left through `rmnet_data0`. Adding `ip rule add to 100.64.0.0/10 lookup 52 pref 1990` took peer ping from 100% to 0% loss and moved `ip route get <peer> mark 0x11` from `rmnet_data0 table 5` to `tailscale0 table 52`. The fw4 zone is still needed because fw4's input policy is drop and tailscaled's own accept rules live in a different nft table.

| Piece | Where | Persistence |
|---|---|---|
| fw4 zone `tailscale` | UCI `firewall` | Persistent; re-checked at boot |
| `ip rule ... pref 1990` v4 + v6 | Kernel only | Gone every reboot; re-asserted at boot, on connect and on daemon start |

mwan3 never touches pref 1990, and the rule only reorders what table 52 already routes, so it cannot send traffic anywhere tailscaled would not.

### API

Constants: `TS_NET_ZONE=tailscale`, `TS_NET_DEV=tailscale0`, `TS_NET_PREF=1990`, `TS_NET_TABLE=52`, `TS_NET_V4=100.64.0.0/10`, `TS_NET_V6=fd7a:115c:a1e0::/48`.

| Function | Behaviour |
|---|---|
| `ts_net_enabled` | rc 0 unless UCI `quecmanager.tailscale_net.enabled` is `0` |
| `ts_net_zone_present` | rc 0 if a zone is named `tailscale`, or any zone's `device`/`network` lists `tailscale0` |
| `ts_net_ensure_zone` | UCI only, commits, never reloads. rc 0 = changed, 1 = no change. Creates the zone when none is present, and the two `lan` forwardings only for **its own** zone. A firmware zone that already lists `tailscale0` is reused and never modified |
| `ts_net_remove_zone` | Removes the zone named `tailscale` and every forwarding to or from it. UCI only, commits, never reloads |
| `ts_net_fw_reload` | `/etc/init.d/firewall reload` |
| `ts_net_ensure_rules` | Idempotent v4 + v6 `ip rule`; v6 is skipped silently when unsupported |
| `ts_net_remove_rules` | Deletes every pref-1990 rule, v4 and v6 (loop capped at 16) |
| `ts_net_apply [--no-reload]` | Rules, then zone; reloads fw4 only when the zone changed and `--no-reload` was not given |
| `ts_net_teardown` | Removes rules and zone (reloads if changed), plus `ipset del mwan3_connected_ipv4 100.64.0.0/10` when no `netbird` binary exists (NetBird shares the range) |
| `ts_net_status_json` | `{"enabled":bool,"zone":bool,"rule_v4":bool,"rule_v6":bool}` |

### Who calls what

| Caller | When |
|---|---|
| `qmanager_tailscale_net` (boot init) | At boot, when a Tailscale binary exists and `ts_net_enabled`: `ts_net_apply`, then logs `ts_net_status_json` via `logger` |
| CGI `connect`, `start_service` | `ts_net_prep`: `ts_net_ensure_rules` immediately; a missing zone is written to UCI now and fw4 is reloaded by the CGI's EXIT trap in an orphaned job one second after the response |
| CGI `set_net_fixes` | Apply or teardown in the background after the response |
| CGI `uninstall` | `ts_net_teardown` in the background after the response |
| `tailscale_mgr.sh` | `ts_net_apply` after install, `ts_net_ensure_rules` after a successful update |
| `install.sh migrate_tailscale_net` | OTA, see Lifecycle Scripts |
| `uninstall.sh` | `ts_net_teardown` |

**Why not reload in the request:** `firewall reload` inside an HTTP response can drop the connection that carries it, and the page is often served over the very tunnel being changed. Every request-path caller uses `ts_net_ensure_zone` / `--no-reload` and reloads after the response.

### Always on, with an escape hatch

The fixes are on by default for every Tailscale install. The Tailscale page's **Network fixes** row toggles UCI `quecmanager.tailscale_net.enabled` through `set_net_fixes`. The old **Force Tailscale Fixes** toggle (`force_tailscale_fixes` in `system/settings.sh`) and its UCI key `quecmanager.tailscale_workarounds` are removed; a client that still posts `force_tailscale_fixes` is ignored.

---

## Key Invariants

### 1. `tailscale up` must be double-forked

```sh
( tailscale up --accept-dns=false --json </dev/null >"$TS_UP_OUTPUT" 2>&1 &
  echo $! | qm_atomic_write "$TS_UP_PID_FILE"
)
```

A plain `( cmd ) &` without stdin redirection stays in the CGI's process group. When uhttpd closes the connection it signals the group, killing `tailscale up` before it pushes post-auth prefs to `tailscaled`; the device then shows as "registered but disconnected" until the user stops, starts and re-authenticates. The inner `&` with `</dev/null` orphans the process to init.

### 2. `--accept-routes` and `--advertise-routes` are permanently banned

`--accept-routes` makes the device accept every route every peer advertises. On this hardware that disconnects the modem from the network entirely and only a physical reboot recovers it. The flag is never passed, even as an opt-in. `--advertise-routes` is banned too; use `set_exit_node` for controlled exit-node advertising.

### 3. The init.d script must never be shipped as a static file

The official tarball ships no init script. `qm_write_ts_initd` (in `tailscale_initd.sh`) writes `/etc/init.d/tailscale`. Never add `scripts/etc/init.d/tailscale` to the repo.

**Why:** `scripts/install.sh` force-copies every file under `scripts/etc/init.d/` on every install and OTA, which would clobber the opkg-owned init of a legacy install.

### 4. The official init `stop_service()` must be a no-op

It returns `0` and does NOT run `tailscale down`.

**Why:** `tailscale down` persists `WantRunning=false` in `tailscaled.state`; if `stop_service()` ran it, every reboot would save the node as "down" and boot idle. procd already kills the tracked instance for `USE_PROCD=1`. Deliberate disconnects belong to the CGI `disconnect` action. The same property is what lets **update** restart the daemon without logging the node out.

### 5. Boot-reconnect relies on persisted `WantRunning`; no boot-time `tailscale up`

A boot-time `tailscale up` would override a deliberate Disconnect.

| Event | `WantRunning` after | Result on next boot |
|---|---|---|
| Plain reboot or `init.d restart` (including update) | Unchanged | Daemon reconnects |
| Deliberate Disconnect (`tailscale down`) | `false` | Daemon boots idle |
| Stop Service (boot still enabled) | Unchanged | Daemon restarts and reconnects |
| Successful Connect (official) | `true` (set by `tailscale up`) | Boot-enable is also set, so it reconnects |

### 6. `uci delete` + `uci commit` does NOT remove the config file

`uci -q delete tailscale && uci -q commit tailscale` leaves `/etc/config/tailscale` on disk and the section resurrects on the next read. Uninstall always follows the delete with `rm -f /etc/config/tailscale`. See [`docs/reference/busybox-shell-quirks.md`](../reference/busybox-shell-quirks.md).

### 7. The marker file is the authoritative variant detector

`ts_variant` reads `/etc/tailscale/.qm_install_method` (`official` / `tiny`) first. Without it, `opkg list-installed` containing `tailscale-tiny` reports `tiny`; any other opkg-managed Tailscale reports `opkg`. Both are `legacy_build`.

### 8. Boot-enable UCI key is the authoritative flag

`tailscale.settings.service_enabled` is read first by `get_boot_enabled`; `init.d enabled` is the fallback only when the UCI section is absent. Writes always do both. `ts_seed_uci_settings` bootstraps a missing `/etc/config/tailscale` file because `uci set pkg=type` cannot create one on this device.

### 9. Binaries are replaced by `.new` + `sync` + `mv`, never copied in place

**Why:** an in-place copy over the running daemon fails with "text file busy", and UBIFS can persist an unsynced rename as a 0-byte binary after a power cut. Every swap syncs before the `mv`.

### 10. Update never changes tailscaled's parameters

`tailscaled --state=/etc/tailscale/tailscaled.state` under procd with respawn, START=99 / STOP=10, is unchanged. `tailscale_initd.sh` is the only init writer.

---

## Uninstall Flow

```
POST { action:"uninstall" }
  check_migration_lock
  daemon up -> kill stale `tailscale up`, `tailscale down`, init.d stop (or killall)
  /etc/init.d/tailscale disable
  ts_variant == "official" ?
    YES: rm /usr/bin/tailscale{,d} /etc/init.d/tailscale, the .X.old/.X.new leftovers,
         /etc/rc.d/*tailscale; uci delete tailscale + commit;
         rm -f /etc/config/tailscale   (explicit: uci delete alone does not remove the file)
    NO (tiny / opkg): opkg remove of whichever of the 6 known packages is installed
         {tailscale, tailscaled, tailscale-tiny, luci-app-tailscale,
          luci-app-tailscale-community, luci-app-tailscale-community-tiny}
  rm -rf /var/lib/tailscale /etc/tailscale; rm auth-url / up-output / up-pid / latest cache
  hash -r; verify /usr/bin/tailscale, /usr/sbin/tailscale, /usr/sbin/tailscaled are gone
    -> uninstall_failed if any remain
  cgi_success, then (after the response, sleep 1) ts_net_teardown
```

---

## Lifecycle Scripts

### `scripts/install.sh`

- `migrate_tailscale_net()` (replaces `migrate_tailscale_firewall_zone`, which deleted the zone). Runs after `install_backend`, because it sources the freshly copied `tailscale_net.sh`. When the old `quecmanager.tailscale_workarounds` section exists, it deletes it and forces `quecmanager.tailscale_net.enabled=1` (the seeded `0` cannot be told apart from a user choice and the new default is on); otherwise an existing `tailscale_net.enabled` value is left alone. When a Tailscale binary exists and the fixes are not `0`, it runs `ts_net_ensure_rules` and, if the zone changed, `ts_net_fw_reload`, in a subshell, so the `--no-reboot` OTA path is reachable over Tailscale without waiting for a boot. A failure is a warning; `qmanager_tailscale_net` retries at boot.
- `migrate_tailscale_packages` is **removed**. OTA never downloads Tailscale binaries and never moves a legacy install onto the tiny package.
- `migrate_tailscale_initd_boot_fix()` is unchanged: official variant only, sources `qm_write_ts_initd` and rewrites `/etc/init.d/tailscale`, idempotent.
- `cleanup_legacy_scripts()` retires `qmanager_vpn_zone` (disable, remove, drop rc.d links) and `vpn_firewall.sh`.
- `seed_uci_defaults()` seeds `quecmanager.tailscale_net.enabled=1` only when absent. The old `tailscale_workarounds` seed is gone, and `qmanager_vpn_zone` is no longer in `UCI_GATED_SERVICES`.

### `scripts/uninstall.sh`

`remove_backend()` runs `ts_net_teardown` in a subshell (before `/usr/lib/qmanager` is wiped), deletes `quecmanager.tailscale_net`, and keeps its official-variant branch (binaries, init.d, rc.d, UCI section, `/etc/config/tailscale`, `/etc/tailscale/`, `/var/lib/tailscale/`). `remove_runtime_state()` also removes `/tmp/qmanager_tailscale_install.json` (and `.tmp`) and `/var/lock/qmanager_tailscale_migrate.lock`.

---

## Frontend Files

See [`docs/reference/tailscale.md`](../reference/tailscale.md). The hook returns `TailscaleActionResult { ok, reason }` from every mutation (reason already resolved through `resolveErrorMessage`), so handlers toast the returned reason and never read hook state after an `await`. `runUpdate()` follows `install_status` (`op: "update"`) and tolerates the failed reads the tunnel restart causes.

---

## Gotchas

- **`tailscale up` orphan requirement.** Without the double-fork, uhttpd kills it when the connection closes (Invariant 1).
- **`--accept-routes` is destructive.** Never pass it (Invariant 2).
- **`tailscale set` vs `tailscale up`.** `tailscale up` resets every pref not passed, clobbering `--accept-dns=false`. Use `tailscale set` for exit node and SSH.
- **UCI delete leaves the config file.** Follow it with `rm -f /etc/config/tailscale` (Invariant 6).
- **No static init.d file in the repo** (Invariant 3).
- **The official init `stop_service()` must never call `tailscale down`** (Invariant 4). Update relies on it.
- **Boot-reconnect is passive.** Do not add a boot-time `tailscale up` (Invariant 5).
- **Never `firewall reload` inside a response.** Use `--no-reload` / `ts_net_ensure_zone` and reload after the response (Network Reachability).
- **The pref-1990 rule is kernel-only.** It disappears on reboot; the boot init, `connect` and `start_service` re-assert it. If peers cannot reach the modem, check `ip rule show | grep 1990` before suspecting the firewall.
- **Do not put `100.64.0.0/10` back into `mwan3_connected_ipv4`.** mwan3 rebuilds that ipset on every refresh.
- **The shared CGNAT range.** `ts_net_teardown` skips the legacy `ipset del` when a `netbird` binary exists, because NetBird shares the range.
- **A firmware-provided zone is never edited or removed.** `ts_net_ensure_zone` reuses any zone listing `tailscale0` and only adds forwardings to its own `tailscale` zone.
- **Device jq has no regex.** Version resolution uses plain key access and `tostring`; no `test()`, `match()` or `sub()`. See [`docs/reference/busybox-shell-quirks.md`](../reference/busybox-shell-quirks.md).
- **`timeout` may be absent.** `tailscale status --json` calls are guarded with `command -v timeout`.
- **Exit-node advertising requires admin-console approval** (see the NOTE under POST).
- **Legacy installs are not auto-converted.** A `tiny` / `opkg` install keeps running until the user uninstalls and installs again; the UI banner says so. There is no switch action.
