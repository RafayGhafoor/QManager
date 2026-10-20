# Remove Low Power Mode + System Settings tidy (2026-10-20)

Large change (cron, init.d, UCI, installer lifecycle, CFUN). Work in a fresh worktree reset onto `development-home` (the main checkout has another session's uncommitted Custom Profiles edits).

## Live modem (read-only, just now)
- `low_power_enabled='0'`, no low-power cron lines, no `/tmp/qmanager_low_power_active`.
- `/etc/init.d/qmanager_low_power_check` is **enabled** (S99/K10 rc.d links) even with the feature off: the installer enables every init.d. So upgrades must disable + delete it, not just stop shipping it.
- Config Backup never carried `low_power_*`, so no restore path to change.

## A. Backend removal (backend-writer, Sonnet High; install.sh retire step reviewed by me)
1. **Delete** `scripts/usr/bin/qmanager_low_power`, `scripts/usr/bin/qmanager_low_power_check`, `scripts/etc/init.d/qmanager_low_power_check`.
2. `system/settings.sh`: drop the `low_power_*` UCI seed, the `low_power` GET block, the `save_low_power` action and its cron/init.d handling; fix header + TZ-change comments. `save_low_power` then falls through to the existing unknown-action error.
3. `events.sh` (2 flag gates), `alert_engine.sh` (`_AE_LOW_POWER` gate + guardrail-3 comment): remove the low-power suppression. `scenario_mgr.sh` / `public/units.sh`: comment-only edits.
4. `install.sh`: new `retire_low_power()` beside `retire_bandwidth_monitor()`, called unconditionally from `main()` (Software Update runs with `--skip-packages`). Idempotent, silent on fresh installs:
   - if `/tmp/qmanager_low_power_active` exists (a box upgraded mid-window): `qcmd 'AT+CFUN=1'`, then `rm` that flag and `/tmp/qmanager_watchcat.lock` (only in this case; the lock is shared with watchcat otherwise);
   - init.d `disable`, `rm` init.d + `/etc/rc.d/*qmanager_low_power*`, `rm` both `/usr/bin` binaries;
   - strip `qmanager_low_power` + `# QManager Low Power Mode` lines from the crontab (only rewrite when they exist);
   - `uci -q delete` the four `quecmanager.settings.low_power_*` keys, commit if any were present.
   No reboot, no `CFUN=1,1`.
5. `uninstall.sh`: keep the `/tmp/qmanager_low_power_active` cleanup line (harmless for old boxes); its generic `qmanager*` cron/init.d sweeps already cover leftovers. Verify, no other change expected.

## B. Frontend (me, via Impeccable craft)
1. `types/system-settings.ts`, `hooks/use-system-settings.ts`: remove `LowPowerConfig`, `low_power`, `lowPower`, `saveLowPower`, `SaveLowPowerPayload`.
2. `scheduled-operations-card.tsx`: delete the low-power block, fallback, toast keys and the second autosave; only Scheduled Reboot remains. Card title becomes **Scheduled Reboot** and the now-redundant inner "Scheduled Reboot" group label goes; description reworded to one sentence about the weekly restart.
3. **Tracked SIMs moves into the Time & Units card** as a second labelled group under the time-zone / temperature / distance rows (fills the empty left column). The full-width Tracked SIMs band is removed. Its Clear button becomes an inline row action on the count row (operational action, exempt from CardFoot), keeping the AlertDialog confirm and toasts; the card keeps one CardFoot (Save for the units draft). Loading / empty / error for the SIM group stay inline in that group.
   - New title/description (all five catalogs): **Device & Units**, "How this modem keeps time, the units readings use, and the SIMs it remembers." (open to your wording)
4. Page header: remove the hostname `Tag`; Refresh becomes icon-only at rest with the label revealing on hover/focus, same pattern as `components/cellular/settings/refresh-button.tsx` but with the lucide glyph (this page is lucide) and `tonal-neutral` instead of stroked `outline`.
5. Dashboard: `network.low_power` labels the radio-off (CFUN=0) orb title. With the feature gone that copy misleads, so the title becomes **Radio off**-family copy ("Airplane mode") in all five catalogs; no logic change.
6. i18n: delete `system-settings` `low_power` subtree in all five catalogs; `bun run i18n:check` 0/0.

## C. Docs (docs-writer, Haiku sweep)
`scheduled-jobs.md`, `system-settings.md`, `alerts.md`, `connection-quality.md`, `scenario-profile-binding.md`, `BACKEND.md`, `ARCHITECTURE.md`, `API-REFERENCE.md`, `FRONTEND.md`, `busybox-shell-quirks.md`, `icon-system.md`, `overview-splash.md`, `features/README.md`, CLAUDE.md line, READMEs (en/it/id/root) feature lists, `RELEASE_NOTE.md` (Improvements: "Low Power Mode removed"). Ledger rows stay as history; add a one-line note to U4.2's "Target-only kept" only if it reads as current.

## Build order
A1-A3 backend + B1-B6 frontend in parallel (disjoint files) → A4/A5 installer → validator (CRLF, POSIX, `sh -n` under device BusyBox) → **on-device**: deploy `settings.sh`, `events.sh`, `alert_engine.sh` (with backups, `sync`), GET settings shape, POST `save_low_power` returns an error, poller still writes status; run `retire_low_power` body against the live box (removes its enabled init.d + binaries + UCI keys) → `bunx tsc --noEmit`, eslint on touched files, `icons:check`, preview the page (light/dark, 375px) → docs → atomic commits per step.

## Risks / rollback
- A box upgraded while inside a low-power window would stay radio-off forever: covered by the CFUN=1 in `retire_low_power`.
- Removing the events/alert gates changes nothing on boxes where the flag never exists.
- Rollback: revert the commits; the retire step only deletes files a reinstall of the old version recreates.
