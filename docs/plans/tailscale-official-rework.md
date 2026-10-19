# Tailscale: official builds, in-app Update, consolidated network fixes

Status: **approved** (2026-10-19), with the decisions below folded in. Large change: it touches the installer, an init.d script, fw4 and OTA.

## Why

- **The "Tiny" variant is Cameron's build.** It installs `tailscale-tiny` from the iamromulan opkg feed, and `install.sh migrate_tailscale_packages` moves old installs *onto* it.
- **Where the official builds live.** Tailscale's GitHub releases carry **no binaries** (v1.104.1 has 0 assets). Their official static builds are on `pkgs.tailscale.com/stable`, which their GitHub links to, and each tarball comes with a `.sha256` file.
- **Plain IP over Tailscale is broken on the live modem right now**, even with Force Tailscale Fixes on. Checked on the device:
  - `100.64.0.0/10` is NOT in `mwan3_connected_ipv4`.
  - `ip route get <peer> mark 0x11` leaves through `rmnet_data0 table 5`.
  - **Cause:** mwan3 flushes and rebuilds that ipset on every refresh, so the boot-time add never lasts. Rule `2005 fwmark 0x11 lookup 5` wins over tailscaled's `5270 lookup 52`.
  - **The fw4 zone is still needed.** The fw4 input policy is drop, and tailscaled's own accept lives in another table.
- **Version bug:** the installer reads `.Version`, but the key is `TarballsVersion`, so the version shows "latest".

## Unchanged (confirmed working on the modem)

- `tailscale_initd.sh` stays byte for byte: `tailscaled --state=/etc/tailscale/tailscaled.state`, procd with respawn, START=99 / STOP=10, and a no-op `stop_service`.
- Connect: `tailscale up --accept-dns=false --json`, double-forked.
- Boot-enable: the UCI `service_enabled` flag plus `init.d enable`.
- Exit node and SSH: set with `tailscale set`.
- `--accept-routes` and `--advertise-routes` stay banned.
- NetBird (`netbird_firewall.sh`, `qmanager_netbird_zone`) is not touched.

## Architecture

| New / changed | Role |
|---|---|
| `usr/lib/qmanager/tailscale_net.sh` (replaces `vpn_firewall.sh`) | The single owner of reachability. **Zone:** an idempotent fw4 zone plus lan↔tailscale forwardings. It reuses a zone the firmware already ships, and applies it with `firewall reload` in the background, never inside a response. **Routing:** an `ip rule to 100.64.0.0/10 lookup 52 pref 1990` rule plus the IPv6 `fd7a:115c:a1e0::/48` one. mwan3 never touches pref 1990, and the rule only reorders what tailscaled's 5270 rule already routes. The ipset hack goes away. API: `ts_net_apply`, `ts_net_teardown`, `ts_net_ensure_rules`, `ts_net_status_json`. |
| `usr/lib/qmanager/tailscale_mgr.sh` (new) | Install, update and switch logic. **Shared:** `ts_stage_official` downloads to RAM, checks the arch, verifies sha256 (fails closed), extracts, and smoke-tests that `tailscale version` matches. **Update:** `ts_space_plan` chooses hard-link backups on the overlay or a RAM backup, and the swap goes `.new` then `mv`. `ts_wait_healthy` checks the daemon after a restart and **rolls back** to the old binaries automatically. **Housekeeping:** a version cache with a 6 h TTL, and a stale-pid-aware lock (today a crashed holder wedges `migration_in_progress` forever). |
| `etc/init.d/qmanager_tailscale_net` (replaces `qmanager_vpn_zone`) | Boot re-assert. Always on whenever Tailscale is installed, with a hidden UCI escape hatch `quecmanager.tailscale_net.enabled`. |
| `vpn/tailscale.sh` | Becomes a thin dispatcher. **New actions:** `check_update` and `update` (background, same progress file and log as install). Connect and start re-assert the rule. Uninstall tears the network setup down after the response. **GET:** adds `latest_version`, `update_available`, `migration_available` and a `busy` guard. `install_hint` and `install_variants` are dropped, and `variant: "tiny"` returns `invalid_variant`. |
| `system/settings.sh` + frontend | **Force Tailscale Fixes toggle removed.** The fixes are now automatic. |
| `install.sh` | **Removed:** `migrate_tailscale_packages` (the push to tiny) and the workarounds seed. **Replaced:** `migrate_tailscale_firewall_zone` (which deleted the zone) becomes `migrate_tailscale_net`, which deletes `tailscale_workarounds` and applies zone and rule when Tailscale is installed. **OTA never downloads binaries.** |
| `uninstall.sh`, `qmanager_health_check` | `ts_net_teardown`; the health checks keep working. |

**Update flow.** Restarting with `/etc/init.d/tailscale restart` keeps the state, `WantRunning` and the command line, so the node stays logged in and the tunnel drops for about 10 s.

**Legacy tiny/opkg installs** keep running until the user clicks **Switch to official build**:
1. Stage and verify the new build first.
2. Back up state, config, init and the old binaries.
3. `opkg remove`.
4. Install official, restore state and boot-enable, start.
5. Health check, with automatic rollback to the tiny binaries on failure.

The user is never left without a working binary.

## Frontend

- **Install card:** the Official/Tiny picker and the manual-command row are removed. Install is a single path.
- **Connection card:** an `info` badge "Update available (1.104.1)" and a tonal **Update** button behind a confirm dialog ("the tunnel reconnects in a few seconds"). Legacy builds show a "Community build" Tag and **Switch to official build**. The install log is shown while busy, and toasts are handler-level.
- The hook tolerates fetch failures while tailscaled restarts, because the page may itself be loaded over Tailscale.
- **Locales:** `common.json`, `system-settings.json` and `errors.json` in all 5 catalogs. `monitoring.json` is not touched because it has your uncommitted edits.
- Your uncommitted `connection-card.tsx` edits are built on in place (no stash or checkout), so **this work stays in this checkout, not a worktree.**

## Build order (Sonnet 5.5 High builders, disjoint files; Opus for the shell libs)

1. **WP-A:** libs and init (Opus, sensitive).
2. In parallel, after WP-A:
   - **WP-B:** the CGIs.
   - **WP-C:** install, uninstall and health-check.
   - **WP-D:** hook, types and components.
   - **WP-E:** locales.
3. **WP-F:** docs (`tailscale-vpn.md`, `reference/tailscale.md`, `system-settings.md`, `API-REFERENCE.md`, the routing rows) and **`RELEASE_NOTE.md`**.

## Validation (each live write needs your OK)

1. **Go/no-go before building.** Add the live rule `ip rule add to 100.64.0.0/10 lookup 52 pref 1990` and check that ping and SSH reach a peer. If you can, also open QManager from a phone at 100.64.230.102. Undo is `ip rule del pref 1990`. If this fails, the fallback is an iface hotplug ipset re-add.
2. Static audit: CRLF, `sh -n`, bashisms, jq without regex, locks, envelope. Then `bunx tsc --noEmit` and lint.
3. Deploy the libs and CGI and check the GET and `check_update` contracts. Show that `ts_net_apply` is idempotent.
4. **A real update from 1.102.2 to 1.104.1:** about 27 MB of cellular data and a ~10 s tunnel blip. Check that the init md5 and the cmdline are unchanged and that there is no re-auth. Also exercise rollback through a shell-only test knob.
5. OTA `install.sh --no-reboot`, then a reboot. Rule 1990 must survive the WAN coming up.
6. The tiny switch can't be live-tested without reinstalling tiny on the modem. That is your call; by default it is validated statically, plus by reading the `tailscale-tiny` package layout.

**Rollback.**
- **Code:** revert the branch.
- **Live rule:** `ip rule del pref 1990`, or reboot.
- **Binaries:** the old ones are kept until the health check passes.

## Decisions (user, 2026-10-19)

1. **Network-fixes toggle moves to the Tailscale page.** It is removed from System Settings, defaults to **ON**, and is stored in UCI `quecmanager.tailscale_net.enabled`. The new CGI action `set_net_fixes {enabled}` applies or tears down the setup in the background after the response. GET reports `net_fixes_enabled`. The OTA migration maps the old `tailscale_workarounds` key to `tailscale_net.enabled=1`, the new default.
2. **No switch action.** A legacy tiny/opkg install shows a persistent `Banner` on the Tailscale page saying it is on the old community build, and that Uninstall followed by Install gets the official build. Every new install uses only the official build. The Update action exists only for official installs. `ts_do_switch` is dropped.
3. **No health-check entry for now.**

## Go/no-go result (2026-10-19)

PASS. `ip rule add to 100.64.0.0/10 lookup 52 pref 1990` (plus the v6 equivalent) on the live modem changed two things:
- `ip route get <peer> mark 0x11` now goes to `dev tailscale0 table 52` (before: `rmnet_data0 table 5`).
- Ping to 3 online peers went from 100% loss to 0% loss.

The rule is left live; a reboot clears it.

## Fixed contract (all work packages build against this)

### UCI
- `quecmanager.tailscale_net` (type `tailscale_net`), option `enabled` = `1` (default) or `0`.
- `quecmanager.tailscale_workarounds` is deleted by the OTA migration.

### `/usr/lib/qmanager/tailscale_net.sh` (guard `_TS_NET_LOADED`)
Constants: `TS_NET_ZONE=tailscale`, `TS_NET_DEV=tailscale0`, `TS_NET_PREF=1990`, `TS_NET_TABLE=52`, `TS_NET_V4=100.64.0.0/10`, `TS_NET_V6=fd7a:115c:a1e0::/48`.

| Function | Behaviour |
|---|---|
| `ts_net_enabled` | rc 0 unless the UCI value is `0` |
| `ts_net_zone_present` | rc 0 if a zone is named `tailscale`, or any zone's `device`/`network` contains `tailscale0` |
| `ts_net_ensure_zone` | UCI only, commit, no reload; rc 0 = changed, 1 = no change |
| `ts_net_remove_zone` | same as `ts_net_ensure_zone`, but removes the zone and its forwardings |
| `ts_net_fw_reload` | `/etc/init.d/firewall reload >/dev/null 2>&1` |
| `ts_net_ensure_rules` | idempotent v4 + v6 `ip rule ... pref 1990`; v6 is skipped silently if unsupported |
| `ts_net_remove_rules` | deletes every pref 1990 rule, v4 and v6 |
| `ts_net_apply [--no-reload]` | rules + zone; reloads fw4 only if the zone changed and `--no-reload` was not given |
| `ts_net_teardown` | removes rules + zone (reloads if changed); also the legacy `ipset del mwan3_connected_ipv4 100.64.0.0/10` when no `netbird` binary is present |
| `ts_net_status_json` | `{"enabled":bool,"zone":bool,"rule_v4":bool,"rule_v6":bool}` |

### `/usr/lib/qmanager/tailscale_mgr.sh` (guard `_TS_MGR_LOADED`)
- **Detection:** `ts_variant` echoes `official` / `tiny` / `opkg` / `none`; `ts_installed_version`; `ts_version_gt a b`.
- **Latest version:** `ts_fetch_latest` echoes `ver<TAB>tarball`; `ts_latest_cache_read` echoes the version or nothing (cache `/var/run/qmanager/tailscale_latest.json`, 6 h TTL, 30 min on failure).
- **Install pipeline:** `ts_stage_official <dir>`; `ts_space_plan`; `ts_swap_binaries`; `ts_restore_binaries`; `ts_drop_backup`; `ts_wait_healthy <ver> <secs>`.
- **Progress:** `ts_progress <status> <message> [detail] [error_code]` writes `/tmp/qmanager_tailscale_install.json` as `{success,status,message,detail?,error?,op}`, where `op` is `install` or `update`.
- **Lock:** `ts_lock_acquire` / `ts_lock_release` use `/var/lock/qmanager_tailscale_migrate.lock`, which holds the pid; a dead pid counts as stale.
- **Entry points:** `ts_do_install` and `ts_do_update`.
- **Rules:** sources `tailscale_initd.sh` and `tailscale_net.sh`. Never changes tailscaled params.

### Init
`/etc/init.d/qmanager_tailscale_net`: START=99, non-procd. `start()` runs `ts_net_apply` when a Tailscale binary exists and `ts_net_enabled` holds. `stop()` is a no-op.

**Deleted:** `vpn_firewall.sh` and `etc/init.d/qmanager_vpn_zone`.

### CGI `vpn/tailscale.sh`

**GET**
- **Removed:** `install_hint` and `install_variants`.
- **Added on installed tiers:** `latest_version` (string, `""` if unknown), `update_available` (bool, official only), `legacy_build` (bool, variant tiny/opkg), `net_fixes_enabled` (bool).
- **While the lock is held by a live pid:** `{success:true, installed:true, busy:"install"|"update"}`.

**POST, new actions**
- `check_update {force?:bool}` returns `{success, installed_version, latest_version, update_available, checked_at}`.
- `update` runs in the background and returns `{success:true}`. Errors: `not_installed`, `legacy_build`, `up_to_date`, `already_running`, `migration_in_progress`.
- `set_net_fixes {enabled:bool}` writes UCI, then `ts_net_apply` / `ts_net_teardown` in the background after the response. Returns `{success:true, enabled}`.

**POST, changed actions**
- `install`: `variant` absent or `official` is accepted; anything else returns `invalid_variant`.
- `install_status`: unchanged, plus `op` and `error`.
- `connect` / `start_service`: also run `ts_net_ensure_rules` when enabled.
- `uninstall`: `ts_net_teardown` in the background.

**New progress / error codes** (add to `errors.json` in 5 locales): `insufficient_space`, `unsupported_arch`, `checksum_mismatch` (reuse if present), `update_failed`, `update_rolled_back`, `up_to_date`, `update_check_failed`, `legacy_build`, `invalid_variant`.

### `system/settings.sh`
The `force_tailscale_fixes` GET and POST paths are removed (the POST key is ignored).
