# Watchdog audit, slice 03: surface (CGI, lifecycle, poller passthrough, consumers, frontend)

Scope: everything around `scripts/usr/bin/qmanager_watchcat` except its internals. Read-only. Live evidence taken from the RM551E test unit (watchcat disabled; no writes, no POST, no restart). One harmless probe ran an inline `sh -c` with a trap (no files written).

Question restated: where does the watchdog's settings/state surface (CGI, init/installer lifecycle, poller passthrough, other consumers, UI) lie, go stale, drift or lose data?

---------------------------------------------------------------------
## 1. Data-flow map

### State flow (daemon -> UI)
1. `qmanager_watchcat` `write_state()` (`scripts/usr/bin/qmanager_watchcat:267-310`) writes `/tmp/qmanager_watchcat.json` (tmpfs, atomic `mv`) with 17 keys: `timestamp, enabled, state, current_tier, failure_count, last_recovery_time, last_recovery_tier, total_recoveries, cooldown_remaining, sim_failover_active, original_sim_slot, current_sim_slot, reboots_this_hour, quality_breach_count, quality_enabled, last_recovery_reason, ssr_hold, last_ssr_detected`. Called once per main-loop iteration (`:1710`), on state edges, and from the EXIT/INT/TERM trap (`:1434`).
2. Poller `read_watchcat_state()` (`scripts/usr/bin/qmanager_poller:1747-1778`), run in Tier 1.5 (`:2833-2837`, every 5th cycle, ~20 s): reads **only 9 of the 17 keys** (`enabled, state, current_tier, failure_count, last_recovery_time, last_recovery_tier, total_recoveries, cooldown_remaining, reboots_this_hour`). Gated by `_state_reload` (mtime vs `/var/run/qmanager/watchcat.stamp`, forced re-read every 30 calls). File absent -> sets only `wc_enabled=false; wc_state=disabled` (`:1748-1752`).
3. Poller composes `status.json` `.watchcat` (`:2374-2383`, legacy writer `:2124-2133`). `timestamp`, `last_recovery_reason`, `quality_breach_count`, `ssr_hold`, `last_ssr_detected`, `sim_failover_active` are dropped. No age/heartbeat field is emitted.
4. `useModemStatus` (5 s on the page) -> `modemStatus.data.watchcat` -> `derivePhase`/`deriveBand` (`components/monitoring/watchdog/derive.ts`) -> `StatusCard`, `LadderCard.runningTier`. Same block feeds `useWatchdogIndicator` (sidebar, `components/app-sidebar.tsx`) and Prometheus `qmanager_watchdog_*` (`metrics/prometheus.sh:134,254-259`).
5. CGI GET (`watchdog.sh:164-316`) separately `cat`s the raw state file into `.status`, but the hook ignores it ("live state is read from the poller", `hooks/use-watchdog-settings.ts:~80`).
6. Activity card: `useRecentActivities` -> `at_cmd/fetch_events.sh` -> `/tmp/qmanager_events.json` (RAM, shared 50-line ring `MAX_EVENTS=50`), filtered to `watchcat_recovery`/`sim_failover`, newest 5 (`LOG_LIMIT=5`, `shapes.ts:261`).

### Settings flow (UI -> daemon)
1. Ladder / Detection card `submitScope` (`use-watchdog-form.ts`) -> `saveSettings` POST `monitoring/watchdog.sh` `{action:"save_settings", ...own keys}`.
2. CGI (`watchdog.sh:335-525`): `ensure_watchcat_config` -> per-key `jq`+`validate_int`+`uci set` -> `uci commit quecmanager` -> `touch /tmp/qmanager_watchcat_reload` (+ `/tmp/qmanager_ping_reload` if cadence changed) -> if UCI `enabled=1`: `rm DISABLED_FLAG; init enable; (init restart &)`; else `init stop; init disable`.
3. Daemon: init `start_service` guard `uci get ...enabled == 1` (`etc/init.d/qmanager_watchcat:21-25`) -> `read_config` (`:153-206`); a running instance would also consume `RELOAD_FLAG` (`:1508-1520`), but see F3: the restart makes the reload path redundant.
4. Other writers of the same keys: `config_backup_sections.sh::apply_watchdog` (`:497-545`), `system/quality_thresholds.sh` (touches only the reload flag), `install.sh` seed (`:1170-1250`), daemon itself on auto-disable (`uci set enabled=0`, `:871-873`).

---------------------------------------------------------------------
## 2. Defaults table

| Key | Daemon default (`qmanager_watchcat`) | install.sh seed | CGI `ensure_watchcat_config` seed | CGI GET fallback (`uci_get`) | Frontend fallback (`use-watchdog-settings.ts`) | Doc (`connection-watchdog.md`) | Live UCI |
|---|---|---|---|---|---|---|---|
| enabled | **1** (`CFG_ENABLED=1`, absent key -> 1, `:79,154-155`) | not seeded | 0 | 0 | boolean from CGI | 0 | 0 |
| fail_threshold | 5 | 5 (migrates `max_failures`) | 5 | 5 | 5 | 5 | 5 |
| check_interval | 10 | not seeded | 10 | 10 | 10 | 10 | 10 |
| cooldown | 60 | not seeded | 60 | 60 | 60 | 60 | 60 |
| tier1/2/3/4_enabled | 1/1/0/1 | not seeded | 1/1/0/1 | 1/1/0/1 | bool | 1/1/0/1 | 1/1/0/**0** (user set) |
| backup_sim_slot | "" | not seeded | "" (uci drops empty) | "" -> null | null | empty | absent |
| max_reboots_per_hour | 3 | not seeded | 3 | 3 | 3 | 3 | 3 |
| quality_enabled | 0 | 0 | 0 | 0 | bool | 0 | 1 |
| quality_consecutive | 5 | 5 | 5 | 5 | 5 | 5 | 5 |
| ssr_aware | 1 | 1 | 1 | 1 | bool | 1 | 1 |
| ssr_grace | 45 | 45 | 45 | 45 | 45 | 45 | 45 |
| primary_recheck_enabled | 0 | 0 | 0 | 0 | bool | 0 | 0 |
| primary_recheck_interval | 30 (min) | 30 | 30 | 30 | 30 | 30 | 30 |
| probe_interval (ping_profile) | n/a | n/a | n/a | `conn_state_cadence` | 5 (only if GET omits it) | profile-derived | quiet / 10 s |

Findings from the table:
- Only `enabled` disagrees (daemon 1 vs everything else 0). Masked by the init guard, which requires an explicit `enabled=1`; harmless unless the daemon is started outside init.d. See F14.
- **`ensure_watchcat_config` never seeds on fresh installs**: `install.sh:1179-1181` creates the `watchcat` section first, so the CGI sees "section exists" and only runs the migration (`watchdog.sh:36-40`). `enabled, check_interval, cooldown, tier*_enabled, max_reboots_per_hour, backup_sim_slot` are therefore never written until a Save. Behaviour still matches via matching fallbacks, but the docs (`connection-watchdog.md:166,229-231`) describe seeding that doesn't happen, and `uci show` / config backup collect see a half-empty section.

---------------------------------------------------------------------
## 3. Findings

Severity scale: High = wrong/unsafe behaviour users will hit; Med = data loss or misleading state; Low = polish/rule violation.

| ID | Sev | File:line | Status |
|---|---|---|---|
| F1 | High | derive.ts:76-91; qmanager_poller:1747-1778,2374-2383; qmanager_watchcat:1434,1711 | CONFIRMED |
| F2 | High | derive.ts:268-281; qmanager_watchcat:490-507 (known bug) | CONFIRMED |
| F3 | Med-High | watchdog.sh:501-522; etc/init.d/qmanager_watchcat | CONFIRMED (restart); SUSPECTED (5 s overlap) |
| F4 | Med | config_backup_sections.sh:499 | CONFIRMED |
| F5 | Med | qmanager_watchcat:867-875; watchdog.sh:236-238; derive.ts:76 | CONFIRMED |
| F6 | Med | events.sh:32-51; recovery-activity-card.tsx; qmanager_watchcat:884-905 | CONFIRMED |
| F7 | Med | watchdog.sh:219-222,225-234,247-277 | CONFIRMED |
| F8 | Med-Low | watchdog.sh:153-159,352-437 | CONFIRMED (UCI semantics; not reproduced) |
| F9 | Low-Med | derive.ts:233-240; poller:1748-1752 | CONFIRMED |
| F10 | Med | qmanager_watchcat:~1434 trap; /tmp/qmanager_sim_failover | SUSPECTED (design) |
| F11 | Low | watchdog.sh:342-437 | CONFIRMED |
| F12 | Low | banners.tsx:41-47; watchdog.sh:546-552 | CONFIRMED |
| F13 | Low | uninstall.sh:504-560 | CONFIRMED |
| F14 | Low | qmanager_watchcat:79,154; init.d | CONFIRMED |
| F15 | Low | prometheus.sh:254-259; use-watchdog-indicator.ts | CONFIRMED (derives from F1) |
| F16 | Low | watchdog.sh:166 (GET with side-effect) | CONFIRMED |
| F17 | Low | sim-swap-banner.tsx:27-35 | CONFIRMED |
| F18 | Low | derive.ts:445-489 vs daemon | SUSPECTED |
| F19 | Low | etc/init.d/qmanager_watchcat:36; qmanager_watchcat:871-880 | SUSPECTED |

### F1 (High, CONFIRMED) No heartbeat: a dead or frozen daemon shows its last state forever
- `derivePhase` (`derive.ts:76-91`) only returns `not_running` when the poller reports `watchcat.enabled == false` while UCI says enabled. `enabled` is copied from the state file's `enabled` field (`write_state`), i.e. the *daemon's own* view at its last write. A daemon that died after a write leaves `enabled:true, state:"monitor"` (or `recovery`) in the file.
- The poller re-reads the file only when its mtime is newer than the stamp, and otherwise **holds the old values indefinitely** (`_state_reload`, `:1737-1745`). It does not pass `timestamp` through, so neither the poller nor the UI can compute age. The UI's only staleness gate is the *poller snapshot's* staleness (`stale` prop, `derive.ts:81-89`), unrelated to the watchcat file.
- Ways the file gets frozen:
  - SIGKILL / OOM / crash.
  - procd respawn exhaustion: `procd_set_param respawn 3600 5 5` (`init.d:36`) gives up after 5 failures.
  - **Stop never writes a final correct state.** Live-verified on the device: a BusyBox `sh` with `trap ... TERM` running `sleep 6` received TERM at +1 s and **the trap fired only at +6 s, after the sleep** (output: `TRAP_FIRED at 1483`, TERM sent at ~1478). The daemon's main loop ends every iteration in `sleep "$CFG_CHECK_INTERVAL"` (`:1711`, default 10 s), and procd's default `term_timeout` is 5 s, then SIGKILL. So half or more of all `stop`s kill the daemon before `trap 'rm -f ...; write_state' EXIT INT TERM` (`:1434`) runs: `PID_FILE` stays, the state file keeps its last pre-stop contents. `stop_service` (`init.d:40-49`) removes the PID file and recovery flag but never the state file.
- Consumers that inherit the lie: status card (Monitoring / Recovering / Cooling down), pulsing ladder rung (`runningTier`), sidebar indicator `useWatchdogIndicator` (`hooks/use-watchdog-indicator.ts`: `if (!watchcat?.enabled) return null; REPORTABLE[state]`, so a frozen `recovery` shows a permanent "recovering tier N" pill), Prometheus `qmanager_watchdog_enabled/failure_count/recoveries`.
- Live today: file absent (watchdog off, after reboot), so poller emits zeros/`disabled`. The failure appears only with the watchdog enabled.
- Proposed fix: (a) poller passes `updated_at`/`mono` from the file (`.timestamp` plus a new daemon `mono` field, as ping/status already have) as `watchcat.age_sec`; (b) `derivePhase` returns `not_running` when `settingsEnabled && age > max(3*check_interval, 60 s)` (generous: tier code sleeps 1-2 s but `write_state` is not called inside every wait; confirm with other auditor); (c) daemon: run `sleep N & wait $!` so the trap fires promptly, and write `state:"stopped"` on clean exit; (d) `stop_service` removes the state file; (e) sidebar/Prometheus use the same age rule.

### F2 (High, CONFIRMED; known) `reboots_this_hour` is stale, and the UI both mislabels it and colours it as a verdict
- Daemon: `count_recent_reboots` runs only at start (`:1449`) and inside `execute_tier4` (`:863`), never in the loop (`:490-507`). Token-bucket enforcement itself is correct (it recounts), but the *displayed* number is a snapshot.
- UI: `deriveBand` renders `${reboots} / ${cap}` (`derive.ts:268-281`) with the caption key `watchdog.band.rebootsCaption` = "Since the watchdog started" and tone `bad` once `reboots >= cap`. Two UI problems:
  1. The caption is false in both directions. The start value is a *rolling last-hour* count of `tier4_escalation` rows from `crash.log` (so after a watchdog reboot it already shows `1 / 3` "since started", counting the reboot that happened before this process existed). Then it is never aged out, so it is not "this hour" either. The code comment at `derive.ts:274-275` ("a running total since start, never a rolling hour") describes neither behaviour.
  2. The figure is judged against a *per-hour* cap (`ladder.tier4.capLabel` = "Maximum reboots per hour") with a red `bad` tone at `>= cap`. A stale `3 / 3` shows red for days while the daemon would in fact allow a reboot.
- Also: `restart` on every save (F3) re-derives the count from `crash.log`, so the number changes with any unrelated save.
- Proposed fix: daemon calls `count_recent_reboots` once per main-loop iteration (single `awk` on a <=20-line file). UI: retitle "Reboots in the last hour", drop the "since started" caption, and keep the `bad` tone only when `reboots >= cap` *and* poller data is fresh (F1). Optionally show "resets in N min" using the oldest in-window row.

### F3 (Med-High, CONFIRMED + SUSPECTED) Every settings save restarts the daemon
- `watchdog.sh:511-516`: whenever UCI `enabled=1` after the write (true for any Ladder *or* Detection save while enabled, even if only `ssr_grace` changed), the CGI runs `init enable` then `init restart`. The reload flag touched at `:501` is therefore redundant for the enabled case, and the doc claim "No full daemon restart is needed ..." (`connection-watchdog.md:558`) is false for the CGI path.
- Consequences (CONFIRMED by code): all in-memory state resets: `total_recoveries` (shown as "Recoveries"), `last_recovery_time/tier`, `failure_counter`, `quality_breach_counter`, `last_recheck_time`; 30 s `BOOT_SETTLE` re-runs (no monitoring during it); `stop_service` deletes `RECOVERY_FLAG`. A save during an active Tier-3 SIM swap kills the daemon mid-Golden-Rule sequence. On restart, the failover record only exists if the swap was already finalized (`finalize_sim_failover`), so a swap in flight can strand the modem on the backup slot with no record and no banner (the guard for this lives only in the LOCKED-exit path, doc `:654`).
- SUSPECTED (strongly supported by the F1 trap test): `restart` = TERM old + start new. The old instance is still inside `sleep` for up to 5 s (until procd's SIGKILL), its PID file is live, so the new instance hits "Another watchcat already running ... exiting" (`:1422-1429`, exit 1, before the trap is installed) and relies on procd respawn (5 s, 5 retries) to come up. Net effect: up to ~5-10 s extra gap plus a spurious error log line on every save. Not reproduced (no writes allowed).
- Proposed fix: on `enabled=1` with the daemon already running, rely on `RELOAD_FLAG` and skip `restart` (start only when not running); restart only when `enabled` flipped 0->1. Keep `stop` for 1->0. If the restart is kept, make the daemon exit promptly on TERM (F1c).

### F4 (Med, CONFIRMED) Config Backup/Restore watchdog section is stale
- `config_backup_sections.sh:499`: `_WATCHCAT_KEYS="enabled max_failures check_interval cooldown tier1_enabled ... backup_sim_slot max_reboots_per_hour"`.
  - `max_failures` was retired and migrated to `fail_threshold` (install.sh `:1229-1249`, CGI `migrate_fail_threshold`). The key no longer exists on migrated devices, so collect emits `""` and apply skips it (`[ -n "$v" ]`).
  - **Missing from the backup**: `fail_threshold`, `quality_enabled`, `quality_consecutive`, `ssr_aware`, `ssr_grace`, `primary_recheck_enabled`, `primary_recheck_interval`. A restore onto a fresh/other device silently resets all of them to defaults (quality recovery off, threshold 5). `ssr_aware` default is on, so the loss is invisible.
  - Restoring a *pre-migration* backup onto a migrated device writes the orphan `max_failures` (daemon ignores it) while `fail_threshold` stays untouched.
- Restore does call the right lifecycle (reload flag, enable+restart or stop+disable; clears `DISABLED_FLAG`), but also restarts on any restored `enabled=1` (same as F3, harmless there since restore holds the watchcat lock).
- Proposed fix: replace the list with the current keys (accept `max_failures` on apply as a read-only legacy alias mapped to `fail_threshold` when the latter is absent). Update `config-backup-restore.md`.

### F5 (Med, CONFIRMED) "Turned itself off" state is volatile and un-notified
- Auto-disable (`execute_tier4`, `:864-877`) writes UCI `enabled=0` (persistent) and `touch /tmp/qmanager_watchcat_disabled` (tmpfs). `derivePhase` shows `auto_disabled` only while that flag exists (`auto_disabled` from the CGI GET, `watchdog.sh:236-238`). Any reboot (the test unit has a daily 04:00 `qmanager_scheduled_reboot` cron; any crash/power loss) wipes the flag, after which the page says plain "Off" with no reason. The CGI also clears the flag only when *enabling* (`:511-512`), so a manual disable leaves a stale `auto_disabled` showing the wrong copy until reboot.
- The matching event ("Watchcat disabled: reboot limit exceeded", `:867`) goes to the RAM event ring (F6). No SMS/email/alert hook exists for this transition (`alert_engine.sh` only *classifies* watchdog reboots from `crash.log`), so the user who "relied on the watchdog" is never told it quit.
- `doc connection-watchdog.md:751` says auto-disable "persists across reboots (UCI)" - true for the disable, silent about losing the explanation.
- Proposed fix: persist a reason on flash, e.g. `quecmanager.watchcat.disabled_reason=reboot_limit` + `disabled_at` (UCI) cleared on enable, or an `/etc/qmanager` marker; surface it in the status card; route one alert through `alert_routing`.

### F6 (Med, CONFIRMED) Recovery history is RAM-only and shared with CA churn; a watchdog reboot is never visible afterwards
- Events: `append_event` -> `/tmp/qmanager_events.json`, `MAX_EVENTS=50`, shared with `ca_change`, `internet_lost`, etc. (`events.sh:32-51`; watchcat `MAX_EVENTS=50`, `:44`). Live: 19 lines, **12 `ca_change`**, 0 `watchcat_*`. Busy CA flapping evicts watchdog rows in hours.
- Tier-4 appends "Watchcat: rebooting system (Tier 4)" (`:884`) then reboots -> tmpfs cleared -> **the row that explains the reboot is destroyed by the reboot it describes**. Same for `total_recoveries`, `last_recovery_*`.
- The persistent record already exists: `/etc/qmanager/crash.log` (flash, 20 rows, `<epoch>|reboot|tier4_escalation|user|unplanned`) and `monitoring/alerts.sh:157-176` already serves it as `reboots[]` (`cause: watchdog|user|unplanned`, cap 10). The Watchdog page doesn't use it. Live `crash.log` has 20 rows of `user`/`unplanned` reboots in ~4 days and no `tier4_escalation` (watchdog off).
- Activity card three-states are fine (skeleton / error w/ retry / empty), but the empty copy ("Older activity ages out of the modem event log") hides that a reboot also erases it, and the hook keeps showing stale events when a later poll errors (`useRecentActivities` sets `error` but keeps `events`; the card only shows the error when `total === 0`).
- Proposed fix: add a "Recent reboots" strip (or row group) to the Recovery Activity card fed by `crash.log` rows with `cause` (new tiny read endpoint or reuse `alerts.sh` GET), at least the `watchdog` ones with timestamps. Optionally add `watchcat_history` (last 20 recoveries, flash, trimmed) written by the daemon alongside the crash.log row.

### F7 (Med, CONFIRMED) GET is brittle: any malformed state/UCI value kills the whole response
- `watchdog.sh:247-277` passes `$status_json`, `$sim_failover_json`, `$sim_swap_json` (raw `cat` of /tmp files) and all UCI numerics through `jq --argjson`. Live-verified on the device: `jq -n --argjson s "" ...` and `--argjson e "on"` both exit **2** (`invalid JSON text passed to --argjson`) with no stdout.
- So a zero-byte or truncated `/tmp/qmanager_watchcat.json` (the project already hit unsynced zero-byte files, see memory "Unsynced deploy"), a hand-edited UCI value, or a bad restored value makes the CGI return an empty 200 body; the page shows "Could not read the watchdog settings" and **the user cannot disable the watchdog from the UI**. The state-file readers elsewhere (`poller`, `alert`) tolerate this with `2>/dev/null`/defaults; the CGI doesn't.
- Proposed fix: validate each JSON blob (`printf '%s' "$x" | jq -e . >/dev/null 2>&1 || x='{}'`) and coerce UCI numerics with `case *[!0-9]*) default`. Also read the sim files via `qm_trusted_file` like the daemon does.

### F8 (Med-Low, CONFIRMED by UCI semantics; not reproduced live) Rejected save leaves staged, later-committed UCI changes
- `save_settings` does `uci set` field by field and `reject_field` just prints the error and `exit 0` (`:153-159`, called mid-sequence e.g. `:352,358,364,402,413,419,435,457,473,485`). `uci set` without `commit` leaves a pending delta in `/tmp/.uci/quecmanager`; the next `uci commit quecmanager` by *any* script (poller auto-apply, tower failover, another CGI, `quality_thresholds.sh`) commits the half-applied request. E.g. a POST with valid `enabled:true`, `tier4_enabled:true` and invalid `cooldown:5` returns `invalid_field` but later turns the watchdog on with a reboot tier armed.
- The frontend pre-validates all ranges, so this needs a direct API caller or a UI/CGI range drift (e.g. UI bounds change), but a reboot-authority change with an "error" response is the worst case for staged writes.
- Proposed fix: validate everything first, then `uci set` + single commit; or call `uci revert quecmanager` (and `ping_profile`) inside `reject_field`.

### F9 (Low-Med, CONFIRMED) Status-card figures render zeros the device never reported
- `deriveBand`: `known = phase !== "unknown" && watchcat !== null` (`derive.ts:233-240`). In `off`, `not_running`, `starting`, `auto_disabled` the poller still emits an object. With the state file absent it fills zeros (live `status.json .watchcat` = all zeros, `enabled:false, state:"disabled"`), so the card shows `0 / 5`, `0`, `0 / 3` (copy "Reboot step is off" when tier 4 is off). With a leftover file after a disable (F1: stop never removes it) it shows the *last run's* numbers (e.g. `2 / 3` red) under an "Off" label. This contradicts the comment at `:221` ("a missing figure is `null` ... never a zero").
- Poller side (`:1748-1752`) resets only `enabled/state` when the file vanishes, so counters from the last read persist if the file is deleted under a running poller.
- Proposed fix: `known` also requires `phase` not in {`off`, `starting`, `not_running`, `auto_disabled`}; poller resets all `wc_*` when the file is absent.

### F10 (Med, SUSPECTED, design) `sim_failover` record and failover banner live on tmpfs
- `/tmp/qmanager_sim_failover` is the only record of "running on the backup SIM, original slot N" (`mount`: `/tmp` is tmpfs, `/etc` ubifs). The daemon's startup block ("stale SIM failover state from before reboot ... verify live slot", `:1450-1493`) can only help a *daemon restart*, never a real reboot (e.g. Tier 4, scheduled reboot, power loss). After a reboot the modem may still be on the backup slot (QUIMSLOT behaviour to be confirmed by the internals auditor) with no banner, no revert button and `primary_recheck` never armed. The UI banner (`FailoverBanner`) depends entirely on that file.
- Proposed fix: persist the record on flash (`/etc/qmanager/sim_failover.json`) or derive "on backup slot" from live `QUIMSLOT` vs `backup_sim_slot`.

### F11 (Low, CONFIRMED) Wrongly-typed booleans are silently accepted
- `enabled`, `tier*_enabled`, `quality_enabled`, `ssr_aware`, `primary_recheck_enabled` use `case "$val" in true) ... false) ... esac` with no default arm (`:342-346,368-386,406-409,423-431`). `{"enabled":1}`, `"true"` (string) or `"yes"` are no-ops that still return `{"success":true}` and then restart the daemon on the *old* value. Contrast with the int fields, which reject. Add `*) reject_field`.

### F12 (Low, CONFIRMED) Revert/dismiss: toast rule gaps and a no-op success
- `revertSim()` returns only a boolean (`use-watchdog-settings.ts:~226-240`); `FailoverBanner` toasts a fixed `watchdog.failover.failed` (`banners.tsx:45-46`), not `resolveErrorMessage` of the returned result (project toast rule). `useWatchdogSettings.refresh`/`revert` swallow `catch`.
- CGI `revert_sim` (`watchdog.sh:546-552`) writes the flag and returns success without checking that the daemon is running or a failover is active. With the watchdog disabled (or dead, F1) the flag sits in `/tmp` forever while the UI toasts "requested". Fix: return `daemon_not_running` when the daemon pid is absent; clear the flag if no failover.
- `dismiss_sim_swap` (`sim-swap-banner.tsx:27-35`) swallows errors with no toast (the whole banner is a toast, so low).

### F13 (Low, CONFIRMED) Uninstall leaves watchdog flags
- `uninstall.sh:504-560` removes `qmanager_watchcat.json`, `*.lock`, `*.pid`, `qmanager_recovery_active`, but **not** `/tmp/qmanager_watchcat_reload`, `/tmp/qmanager_watchcat_disabled`, `/tmp/qmanager_watchcat_revert_sim`, `/tmp/qmanager_sim_failover`, `/tmp/qmanager_sim_swap_detected` (grep for `watchcat_disabled|watchcat_reload|revert_sim|sim_failover|sim_swap` in uninstall.sh/install.sh/qmanager_update returned nothing). A reinstall without reboot resurrects the "Turned itself off" banner (`auto_disabled=true` with a freshly seeded `enabled=0`) and a stale revert flag. `install.sh` fresh-install path doesn't clear them either. Add them to both cleanup lists (lockstep rule).

### F14 (Low, CONFIRMED) Daemon treats a missing `enabled` key as ON
- `qmanager_watchcat:79` (`CFG_ENABLED=1`) and `:154-155` (`[ -z ... ] && CFG_ENABLED=1`) vs UCI/CGI/doc default 0. Guarded today by the init `enabled = 1` test, but on a fresh install the key is absent (see section 2), and any path starting the binary directly (manual run, procd respawn after a stray UCI delete, install reorder) would run the watchdog (with tier 4 armed) on a device whose UI says "Off". Change the daemon default to 0.

### F15 (Low, derives from F1) Other consumers
- Prometheus (`metrics/prometheus.sh:254-259`): `qmanager_watchdog_enabled`, `_failure_count`, `_recoveries` read the stale block; the HELP "resets with its state" is also wrong while the file survives a stop (counter not monotonic across restarts: F3). No `$fresh` gating on the watchcat sub-object beyond the whole-snapshot freshness.
- `qmanager_health_check` `t_svc_watchcat` (`:672-679`) correctly skips when UCI disabled and checks the procd instance, so it would catch a dead daemon, unlike the page. No file-age check.
- `alert_engine.sh` uses only `conn_during_recovery` (ping.json `during_recovery` <- `/tmp/qmanager_recovery_active`) and `crash.log` classification. `RECOVERY_FLAG` is removed by `stop_service` and the daemon trap, but not if the daemon is SIGKILLed outside init (installer does `killall -9`, then init stop handled earlier; ok). `qmanager_ping.sh` has no staleness rule on the flag: a crashed daemon leaves `during_recovery:true` until init stop/reboot.

### F16 (Low, CONFIRMED) GET writes
- `ensure_watchcat_config` (`:166`) does `uci set` + `uci commit` on a GET (only when the section is absent, which install.sh now prevents) and `migrate_fail_threshold` commits on GET. Side-effecting reads also run on the 30 s poll. Low risk now; move to install/migration.

### F17 (Low, CONFIRMED) Two pollers
- `SimSwapBanner` calls its own `useModemStatus()` while the watchdog page calls another at 5 s (and the sidebar a third at 15 s). Not wrong, but 3 independent `status.json` fetch loops on one page.

### F18 (Low, SUSPECTED) Timeline ignores loop granularity
- `deriveTimeline` (`derive.ts:445-489`) declares at `probeInterval x failThreshold`; the daemon samples `ping.json` every `check_interval` (default 10 s) and the first tier step waits up to one extra cycle; Tier 3 uses `max(90, cooldown)`. Presented times are optimistic by up to `check_interval`. `check_interval` is not editable in the UI.

### F19 (Low, SUSPECTED) Auto-disable relies on a comment that isn't true
- `execute_tier4` comment (`:879`) says "procd won't respawn since UCI disabled". procd respawns on any exit when `respawn` is set; the respawned instance exits at `read_config` (disabled) and the EXIT trap overwrites the state file with `{enabled:false, state:"monitor"}` (default `$state` at process start) up to 5 times at 5 s intervals. Outcome is correct (page uses `auto_disabled` first) but `state:"monitor"` with `enabled:false` is garbage in the file; also burns the respawn budget. Not reproduced (needs enabling).

### UI-specific checks requested
- **What "Reboots this hour" shows / source**: poller `watchcat.reboots_this_hour` <- state file `reboots_this_hour` <- `count_recent_reboots` at daemon start / inside tier 4. Label in UI = "Reboots" with caption "Since the watchdog started" (en `watchdog.band.reboots/rebootsCaption`); see F2.
- **Cap and auto-disable understandable?** Cap is editable inline in rung 4 ("Up to [N] per hour"); the confirm dialog explains the cap and self-disable (`save.confirmReboot.cap`). The status card says only `N / cap`. After auto-disable the copy is "It reached the reboot limit. Turn it back on once the link is stable." (good) but volatile (F5) and doesn't state *when* or how many reboots.
- **Persistent reboot history?** Yes, should be shown (F6): `crash.log` + `alerts.sh reboots[]` already exist.
- **Three states**: status card = skeleton / `SettingsUnreadable` / surface; poller loss = `unknown` phase; activity = skeleton / error+retry / empty. Gap: no "stale" state (F1) and zero-as-reading (F9).
- **Toasts**: save path is correct and follows the rule (`use-watchdog-form.ts:submitScope`: `toast.success(t("watchdog.save.toastOk"))` / `toast.error(..., {description: result.message})`, message from `resolveErrorMessage` in the call result). Revert path violates the failure-text rule (F12). No toast on dismiss (F12/F17).
- **Type drift**: `WatchcatStatus` (`types/modem-status.ts:625-635`) matches the 9-key poller output exactly. Daemon/state-file keys not in the type or the poller: `timestamp, sim_failover_active, original_sim_slot, current_sim_slot, quality_breach_count, quality_enabled, last_recovery_reason, ssr_hold, last_ssr_detected` (documented as intentionally dropped, doc `:~716`). Practical gap: the UI can't say *why* the last recovery fired (quality vs unreachable) or show `ssr_hold` as a distinct fact (`state:"ssr_hold"` does cover it). `types/modem-status.ts:517` comment for `during_recovery` is fine. `WatchdogSettings` vs CGI settings: fields match 1:1 (`probe_interval` folded from `interval_sec`); `WatchdogSavePayload` omits `check_interval` and `probe_profile`/`interval_override` (CGI still accepts them; undocumented in the TS type).
- **i18n parity**: `public/locales/{en,zh-CN,zh-TW,it,id}/monitoring.json` all contain the same 158 `watchdog.*` keys (script check: 0 missing, 0 extra in every non-en pack; it/id have 2 and 1 values identical to en with length >12, likely proper nouns). No parity gap in this slice. Event messages from the daemon are English-only by design.

---------------------------------------------------------------------
## 4. Lifecycle lockstep gaps

| Item | install.sh | update (qmanager_update) | uninstall.sh | Gap |
|---|---|---|---|---|
| Section seed | creates `watchcat` + quality/ssr/recheck/fail_threshold only (`:1179-1250`) | runs install.sh | `uci delete quecmanager` | Main keys never seeded (docs claim lazy CGI seeding that cannot run) - section 2, F14 |
| Daemon stop | `touch lock; init stop; killall -9` (`:1024-1043`), restore after (`:1437-1448`) | stops watchcat pre-install (`:342-345`), then always reboots | init stop all, kill `qmanager_*` | none; update reboots so `restore_running_services` omission is harmless |
| rc.d enable | gated by previous rc.d symlink (`:1371-1400`) | n/a | removes init scripts | Auto-disable leaves rc.d enabled with UCI 0 (harmless, init guard) |
| Lock | `/tmp/qmanager_watchcat.lock` removed on EXIT trap | n/a | `rm /tmp/qmanager_*.lock` | ok |
| `/tmp/qmanager_watchcat.json` | not cleaned | not cleaned | removed | stale state survives update-without-reboot (F1/F9); `stop_service` doesn't remove it |
| `/tmp/qmanager_watchcat_reload`, `_disabled`, `_revert_sim`, `qmanager_sim_failover`, `qmanager_sim_swap_detected` | not touched | not touched | **not removed** | F13 |
| Config backup | n/a | n/a | n/a | F4 key list stale |
| Reload flag consumers | `quality_thresholds.sh`, restore, CGI | | | flag touched even when daemon stopped (harmless: consumed on next start) |

---------------------------------------------------------------------
## 5. Doc-vs-code drift

`docs/features/connection-watchdog.md`
- `:166,229-231` "Seeded by `ensure_watchcat_config()` ... first CGI GET ... and by install.sh ... for the quality and probe-interval keys". Reality: install.sh creates the section so the CGI seeding is dead on fresh installs; install.sh seeds quality, ssr, primary_recheck and `fail_threshold`, **not** probe-interval keys (`ping_profile.*` are not touched by the watchcat block). Also "ensure_watchcat_config ... sets primary_recheck_*" is true but unreachable.
- `:369` `reboots_this_hour` "from crash.log in the last 3600s": only at start and in tier 4 (F2). `total_recoveries` "since daemon start" is correct but the doc doesn't say a settings save restarts the daemon (F3).
- `:548-558` Apply pipeline: shows `restart` and then says "No full daemon restart is needed". Contradictory; actual behaviour = restart on every enabled save.
- `:751` "Auto-disable persists across reboots (UCI)": UCI yes, `auto_disabled` indicator and event no (F5). `:19` "Ping reload flag ... touched when interval changes" ok.
- `:~716` (Types and i18n) correctly says the poller drops `quality_breach_count/ssr_hold/last_recovery_reason`; add `timestamp` and describe the missing heartbeat as a known gap.
- Missing: any statement that status/activity are RAM-only and lost on reboot; that `/tmp/qmanager_sim_failover` does not survive a reboot (F10); `derivePhase` cannot detect a dead daemon (F1).
- Frontend table: `sim-swap-banner.tsx` described as "rendered globally in app-layout.tsx" (unverified here); `use-watchdog-indicator.ts` / sidebar pill isn't listed.

`docs/API-REFERENCE.md`
- `:1179-1203` GET sample is the pre-U4.6 shape (flat `config{suspect_threshold, recovery_timeout, ...}`) and is flagged by a NOTE; replace with the real envelope (`settings{...}, probe_profile, interval_override, effective_interval, interval_sec, fail_secs, recover_secs, quality_thresholds, status, sim_failover, sim_swap, auto_disabled`). POST actions `dismiss_sim_swap`, `revert_sim` and the `invalid_field {field, reason}` envelope (note: `reason`, not `detail`) are not in API-REFERENCE.
- `:269-278` `status.json .watchcat` sample matches the 9 poller keys; add that it is a last-written snapshot with no age field (until F1 is fixed).

---------------------------------------------------------------------
## 6. Live evidence captured (read-only)

- `uci show quecmanager.watchcat`: `enabled='0'`, `tier4_enabled='0'`, `quality_enabled='1'`, `fail_threshold='5'`, `check_interval='10'`, `cooldown='60'`, `max_reboots_per_hour='3'`, `ssr_aware='1'`, `ssr_grace='45'`, `primary_recheck_*` present; **no** `backup_sim_slot`.
- GET `monitoring/watchdog.sh` -> `success:true`, `status:{}`, `auto_disabled:false`, `interval_sec:10`, `quality_thresholds:{800ms,20%,custom,custom}`.
- `/tmp/qmanager_watchcat.json` absent; `status.json .watchcat` = `{"enabled":false,"state":"disabled","current_tier":0,"failure_count":0,"last_recovery_time":null,"last_recovery_tier":null,"total_recoveries":0,"cooldown_remaining":0,"reboots_this_hour":0}` (zeros for an unreported daemon; F9).
- No `S99qmanager_watchcat` in `/etc/rc.d` (disabled); `/tmp` tmpfs, `/etc` ubifs.
- `/etc/qmanager/crash.log`: 20 rows, all `user`/`unplanned`; cron has `0 4 * * *` scheduled reboot.
- `/tmp/qmanager_events.json`: 19 lines, 12 `ca_change`, zero watchdog rows.
- BusyBox trap-vs-sleep test: TERM sent at +1 s, trap ran at +6 s (after the foreground `sleep`).
- `jq --argjson ""` / `"on"` -> exit 2, empty stdout.

---------------------------------------------------------------------
## 7. Suggested hand-offs

- backend-writer: F1c/d (daemon prompt TERM, final state, remove file on stop), F2 (recount per loop), F3 (no restart when already running), F4 (backup key list), F5 (persist reason + alert), F6 (flash history), F7/F8/F11/F12 (CGI hardening: validate-then-set, `uci revert`, reject non-boolean, daemon-running check), F13 (cleanup lists), F14 (default 0).
- ui-builder: F1b (stale/not_running by age), F2 (label/tone), F9 (no fake zeros), F6 (reboot history strip), F12 (revert toast via `resolveErrorMessage`).
- poller (backend-writer): pass `timestamp`/age (+ `last_recovery_reason`, `ssr_hold`) through `.watchcat`; reset all `wc_*` when the file is absent.
- docs-writer: items in section 5.
