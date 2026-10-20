# Persistent-write sweep (B5.29 Phase A, report only)

A read-only sweep of `scripts/` on 2026-10-19 for writes to persistent storage
(`/etc/qmanager`, `/etc/config`, `/usrdata`, crontab, firewall rule files).
Nothing was changed. It supports Section 13 of
[`poller-on-broker.md`](poller-on-broker.md): after a hang and a power cut, a
write that was never synced can come back as a 0-byte file.

## Headline

- **No script calls `sync`.**
- `qm_atomic_write` (`safe_tmp.sh`) writes a temp file in the target directory
  and renames it, but **does not sync**. After a power cut the rename can
  survive while the data does not, which leaves a 0-byte file. Adding `sync`
  inside the helper, before the `mv`, fixes every caller at once.
- About 48 `uci commit` sites write `/etc/config/*`. libuci's durability is not
  verifiable from this repo; a `sync` after the commit is the cheap guard.
- **No periodic loop writes persistent storage every few seconds.** The poller,
  watchcat, ping and SMS forwarding loops write tmpfs only. The
  only periodic persistent writer is the sites monitor's hourly
  `/usrdata/qmanager/sites/*.jsonl` append. Flash wear from loops is low.

## Most important writes

| # | File | Writer | Risk |
|---|---|---|---|
| 1 | `/etc/qmanager/crash.log` | `qmanager_watchcat` Tier 4 appends, trims with `mv`, then reboots about 1 s later; `qlog.sh` `record_planned_reboot` | the row is lost in exactly the window before a reboot, so the per-hour reboot cap can undercount |
| 2 | `/etc/qmanager/known_iccids` | `sim_db.sh` append, truncate-then-write clear | 0 bytes makes every SIM look new |
| 3 | `/etc/config/quecmanager` | every settings CGI via `uci commit` | loss reverts watchdog, ping profile, DPI, SIM and band settings |
| 4 | `/etc/qmanager/active_profile`, `profiles/*.json` | `profile_mgr.sh` direct truncate, tmp + mv | a 0-byte active profile reads as "none" at boot |
| 5 | `/etc/qmanager/auth.json` | `cgi_auth.sh` direct write | an empty file breaks login; check whether it reopens first-time setup |
| 6 | `/usrdata/qmanager/sms_sent.json` | `sms_sent.sh` via `qm_atomic_write` | the outbound history is lost |
| 7 | `/etc/qmanager/tower_lock.json` | `tower_lock_mgr.sh` tmp + mv | tower lock and failover config are lost |
| 8 | `/etc/qmanager/msmtprc` and the alert JSON files | `monitoring/alerts.sh` (heredoc for msmtprc) | email alerts stop silently |
| 9 | `/usrdata/qmanager/apn_profiles.json` | `apn_mgr.sh` tmp + mv, also on a GET-time migration | APN profiles are lost |
| 10 | `/etc/firewall.user.ttl`, `/etc/firewall.user.mtu` | `ttl.sh`, `mtu.sh`, restore path | TTL / MTU rules vanish at the next firewall reload |

Direct truncating writers worth converting to the helper:
`alert_engine.sh` (`last_boot_id`), `sim_db.sh`, `cgi_auth.sh`,
`profile_mgr.sh` (`active_profile`), `config_backup_sections.sh` (profiles,
active profile, IMEI backup, band failover flag, SMS storage),
`scenario_mgr.sh` (`active_scenario`), `monitoring/alerts.sh` (msmtprc),
`bands/failover_toggle.sh`, `cellular/sms_storage.sh` fallback,
`init.d/qmanager` (`long_commands.list` seed), `install.sh` default seeds.

## Suggested fix (a separate change, not part of B5.29)

1. `qm_atomic_write`: `sync` after writing the temp file and before `mv`.
2. Convert the direct writers above to `qm_atomic_write`.
3. `sync` after `uci commit` in the CGIs, and in the crash.log writers before
   any reboot.

Not traced in full: `qmanager_sms_storage`'s preference write, the tower-lock
default seed caller, `qmanager_config_restore` internals, `alert_routing.sh`.
