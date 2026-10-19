# U4.17 — Tower Locking in the RM520N canon (plan)

Route: `/cellular/cell-locking/tower-locking`. Reference: fork `a05c4e92` (it already contains `a66d037e`, `786c366b`, `7400831c`). Base: `development-home` `73d6e74c`. Size: Large (one small backend fix, then frontend).

## 1. Recon findings

**Live modem (read-only, 2026-10-19).** Both RATs unlocked (`AT+QNWLOCK="common/4g"` and `"common/5g"` both `,0`). `/etc/qmanager/tower_lock.json`: LTE disabled with slot 1 stored (EARFCN 1350 / PCI 135), NR-SA empty, `persist:true`, failover off (threshold 30), schedule off (08:00–22:00, Mon–Fri). `qmanager_tower_failover` is not running. No tower crontab lines, no tower runtime files. There is no tower config in UCI; it lives in the JSON file. `settings.sh` and `schedule.sh` are POST-only (GET returns `method_not_allowed`). The page reads everything from `status.sh` plus `failover_status.sh`.

**Shell: which side is ahead**

| File | Verdict | Why |
|---|---|---|
| `tower/lock.sh` | Keep target | Target has the B5.1 fail-closed `rc` + `*ERROR*` checks on every lock and unlock. The fork's extra `service_enable_failed` / `service_disable_failed` come from systemd units the target doesn't have. |
| `tower/schedule.sh`, `qmanager_tower_schedule` | Keep target | Target has the B1.11 clock-step guard (`schedule_guard.sh`) and the 2026-10-19 crontab-header fix. The fork's `armed` / `reason` come from a systemd timer (`qmanager_tower_schedule_arm`), and cron has nothing like it. |
| `tower/settings.sh` | Keep target | It already emits `persist_command_failed` (line 157), so the fork's warning has a real backend source here. Threshold validation is the same on both sides. |
| `tower/failover_status.sh` | Keep target | Same shape. The target adds the orphan-watcher self-heal (83 vs 49 lines). |
| `tower/status.sh` + `tower_lock_mgr.sh` | **Port fork intent (786c366b)** | The target never says whether a read failed. On a failed `AT+QNWLOCK` read it falls back to `lte_locked=false` / `persist_*=false`, so the UI shows a confident "Unlocked" / "Disabled". And `tower_read_nr_lock` returns `unlocked` with rc 0 when the `+QNWLOCK:` line is missing (lines ~285–290). The LTE reader already returns `error` with rc 1. |

**Hook and types drift**
- The target is ahead on `normalizeTowerConfig` (pads LTE slots to 3, sanitises days), and on never forcing `failover.enabled=true` from `failover_armed`, which is documented. Keep both.
- The fork is ahead on these, and I'll adopt them:
  - `isRefreshing` with a quiet `refresh()` that returns a Promise. The target's `refresh()` brings the skeleton back.
  - `isSavingFailover`.
  - `lastWarning` / `clearWarning`.
  - Lock guard. The target blocks a lock when `watcher_running && hasAnyActiveLock`. The tower watcher is `while true` and runs for as long as a lock is active, so with failover on, re-targeting a locked leg is blocked for good. The fork guards with an in-flight ref instead. I'll take the fork's guard and keep unlock always allowed.
- `TowerWarningCode` is cut down to the codes the target can actually emit: `persist_command_failed` only. Systemd's `service_*` codes are dropped.
- `TowerScheduleSaveResult` is **not adopted**. `updateSchedule` keeps resolving `boolean`. Cron has no "armed" signal, and the fork itself treats a missing `armed` as "assume armed".
- New optional `lte_read_ok?` / `nr_read_ok?` / `persist_read_ok?` on `TowerModemState`. A missing flag means true; consumers test `=== false` only.

**Dependencies.** Nothing outside the tower tree imports these components, except `SCS_OPTIONS` from `types/tower-locking` (used by `frequency-locking/nr-freq-locking.tsx`, so keep that export). `simple-mode-utils.test.ts` must keep passing. U4.13 is building `components/cellular/tile-shape.ts` in parallel and it isn't on development-home yet. If it lands before this row merges, the on-air tiles import it. Otherwise they keep a local constant in `shapes.ts`, and the follow-up is noted in the ledger row.

## 2. Build order (bottom-up)

### Step 1 — Backend (Sonnet High builder, then `validator`)
1. `scripts/usr/lib/qmanager/tower_lock_mgr.sh` → `tower_read_nr_lock`: when the `+QNWLOCK:` line is missing, return `error` with rc 1 instead of `unlocked` with rc 0. An explicit `,0` / empty params still means unlocked. First check every caller (`status.sh`, `qmanager_tower_failover`, `qmanager_tower_schedule`, `lock.sh`, if any of them read it) so none of them now treats `error` as locked.
2. `tower/status.sh`: derive `lte_read_ok` / `nr_read_ok` / `persist_read_ok` from each reader's rc (persist fails when its reply doesn't parse into two digits). Add them to `modem_state` with `--argjson`. Keep the existing fields and values, so old clients render as they do today.
3. Don't touch `lock.sh`, `schedule.sh`, `settings.sh` or `failover_status.sh`.

### Step 2 — Types + hook (main session)
- `types/tower-locking.ts`: add the three `*_read_ok?` fields and `TowerWarningCode = "persist_command_failed"`. Keep `SCS_OPTIONS`.
- `hooks/use-tower-locking.ts`:
  - Add `isRefreshing` and the quiet `refresh(): Promise<boolean>`, plus `isSavingFailover` and `lastWarning` / `clearWarning`.
  - Swap the watcher guard for the in-flight ref.
  - Return `{ ok, error }` from `lockLte` / `unlockLte` / `lockNrSa` / `unlockNrSa` / `updateSettings` / `updateSchedule`, with errors through `resolveErrorMessage` and translated fallbacks, the way band locking does. Components raise the toasts.
  - `error` (read failure) stays a separate channel from write failures.
  - Keep `normalizeTowerConfig` and the failover poll lifecycle.

### Step 3 — Components (Sonnet High builder, from the fork's anatomy and the target's band-locking port)
New files in `components/cellular/tower-locking/`:
- `shapes.ts`: geometry and tone contract, condensed the way `band-locking/shapes.ts` condensed the fork's (~300 lines, not 1,487).
- `tower-locking.tsx`: page coordinator.
  - `CellularPageHeader` with a tonal "Cell Scanner" link and a tonal-neutral Refresh that is blocked while a write is in flight.
  - Read failure: a destructive `ConditionScreen` with a gated Retry.
  - `lastWarning`: a `Banner`.
  - Then section 1 "Right now", section 2 "While nobody is watching", then the 2-up leg cards.
  - Owns the prefill bus (nonce) and `canTarget`.
- `live-strip.tsx`: shows the verdict (on target / off target / unverified / unlocked / unknown; unknown whenever a `*_read_ok === false`) and the on-air carrier tiles. Each tile shows PCC/SCC as a `Tag`, PCI, and RSRP on the quality ramp with a `MetricBar`. Each tile has a "use this cell" action with the block reason in a tooltip.
- `automation-tiles.tsx` holds three tiles:
  - **Persist:** `SegmentedField` Off/On, plus a modem read-back chip (on / off / split / unknown).
  - **Signal failover:** `SegmentedField` Off/On, a status chip (disabled / armed / watching / released), and a percent `InputGroup` for the threshold (from `a66d037e`). The threshold is shown empty when it hasn't been read, never a default of 20.
  - **Schedule:** the next file.
- `schedule-tile.tsx`:
  - Enable is a `SegmentedField`; turning it on with no lock target reverts.
  - Time and day edits debounce 800 ms and save only while the schedule is enabled.
  - Day chips are `aria-pressed` buttons.
  - Every finished save toasts. There's no armed warning.
- `lte-tower-card.tsx`:
  - Three slot rows with per-slot clear and a "Serving" chip.
  - Simple Mode is a `SegmentedField` (Type / Pick), kept in localStorage, and it disables itself when there's no LTE carrier.
  - Shows the modem read-back status chip.
  - A `CardFoot` holds the status, the failure, the Unlock tonal-neutral button, and the `SaveButton` Lock.
  - Unlock asks for confirmation in an `AlertDialog`.
- `nr-sa-tower-card.tsx`:
  - The same, for one cell with four fields: PCI, ARFCN, SCS select, band.
  - Gated in NSA (warning) and in LTE-only (info) with full contrast and a notice. Remove Lock stays live whenever the modem reports an NR lock.
  - An empty `networkType` gets the loading state.
  - When the picked cell isn't the serving cell, SCS is flagged as a band-default guess.
- `simple-mode-utils.ts`: keep the target's file and its test, and extend it only if a card needs it.

Delete `lte-locking.tsx`, `nr-sa-locking.tsx`, `schedule-locking.tsx`, `tower-settings.tsx` and `carrier-label.tsx`. Update `app/cellular/cell-locking/tower-locking/page.tsx` only if the import changes.

Canon checks:
- Material Symbols only, no lucide, 0 `<Switch`.
- Filled tonal chips for status, `Tag` for identity.
- `CardFoot` apply, a toast for every finished write in all five locales.
- No `max-w`.
- Loading, empty and loaded states for every card.
- Tabular numbers on the readouts.
- No middle-dot separators.

### Step 4 — i18n (main session + Haiku/Sonnet sweep)
Rewrite `cellular.json` → `cell_locking.tower_locking.*` (keep the target's path, don't move it to the fork's root `tower_locking`) in en, zh-CN, zh-TW, it and id. Base it on the fork's keys under the target's prefix, drop keys nobody uses, and keep literal key maps (no interpolated key stems). zh-TW is converted from zh-CN with OpenCC s2twp. Touch only the tower-locking sub-tree. Add any missing glyph names to the Material subset (`bun run icons:check`).

### Step 5 — Docs
- `docs/features/tower-lock-failover.md`: record the read-confidence invariant (missing means true, test `=== false`), the new lock guard, and the renamed component files (it still names `tower-settings.tsx`).
- Ledger: close the existing **U4.17** row (opened in `73d6e74c`) with the commit and verification details.
- No `RELEASE_NOTE.md` change unless asked.

## 3. Risks
- **Caller semantics of `tower_read_nr_lock`.** The failover daemon or schedule might branch on `unlocked` vs `error`. The builder audits every caller first. If one relies on the old behaviour, that change stops and comes back to you.
- **Changing the lock guard.** This is the real behaviour change. With failover on and a leg locked, re-locking is now allowed while the watcher runs; `lock.sh` already respawns the watcher through `tower_spawn_failover_watcher`. Concurrent writes are still blocked by the in-flight ref.
- **Merge order.** Every wave row touches `public/locales/*/cellular.json`. Merge only after U4.13 / U4.18a, or rebase onto them. Edit only the tower sub-tree.
- **Self-severing writes.** A lock on an unreachable cell can take down the UI. Remove Lock stays reachable in every state.
- **Old clients against the new CGI.** The added fields are optional and missing means true, so old and new pages both render correctly against either backend.

## 4. Validation
1. **Static shell:** `.claude/check-crlf.sh` on both touched shell files; BusyBox/POSIX audit (no bashisms, no multi-var `local`, `jq` without regex, `--argjson` only with literal booleans); `sh -n`.
2. **On device (`validator`):**
   - Back up `status.sh` and `tower_lock_mgr.sh` (`cp` to `.bak`, record md5).
   - scp to `/tmp`, then `mv`, then `sync`.
   - GET `status.sh` and check that `*_read_ok:true` appears and the other fields are unchanged.
   - Read-path failure: run `status.sh` once with a shim `qcmd` that returns an empty reply, in a `/tmp` harness with `PATH` overridden and the real binary untouched. Expect `nr_read_ok:false` and `lte_read_ok:false`, and the daemon untouched.
   - No lock or unlock write without your OK.
   - Rollback: restore from `.bak`, compare md5, `sync`.
3. **Frontend:** `bunx tsc --noEmit`, eslint on touched files, `bun test components/cellular/tower-locking`, `bun run i18n:check` (0/0 across five locales), `bun run icons:check`, `bun run build`.
4. **Preview:** static export plus live CGI GETs (or captured shapes if the modem drops). Check 1440 px and 375 px, light and dark, with no horizontal scroll at 375. States: loading, read error, all unlocked (live), LTE locked, NR gated in NSA and in LTE-only, failover watching, and the persist split. The locked and watching states use stubbed responses, not live writes.
5. **Optional live write pass (only with your OK):** lock LTE to the stored slot 1 (1350/135) → verdict "on target" → Unlock, then restore `tower_lock.json` and check it against the baseline.

## 5. Rollback
Frontend: revert the row's merge commit on `development-home`. Backend: restore the two `.bak` files on the device (md5 check, `sync`). The CGI change only adds fields, so a frontend-only revert is also safe.

## 6. Close
Commit on the worktree branch, self-merge into `development-home` (after U4.13 / U4.18a if they land first, resolving locale conflicts in the tower sub-tree only), never push. Close the U4.17 ledger row.
