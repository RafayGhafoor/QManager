# U4.18a: Cellular Settings (`/cellular/settings`) in the RM520N canon

Opened 2026-10-19. Ledger row U4.18a (wave plan `docs/plans/cellular-core-wave.md`, Lane C). Size: **Large**. The apply runs a CFUN cycle and can cut the cellular link, so this plan stops for approval before any code is written.

Source: fork `a05c4e92`, `components/cellular/settings/*`, `hooks/use-cellular-settings.ts`, `types/cellular-settings.ts`, `cellular/settings.sh`, fork docs `docs/reference/cellular-basic-settings.md` + `cellular-settings-family.md` (commits `e8976cc8`, `80b5fe9b`, `bb137dcd`, `d7f09ba9`, `0f1dcf4f`, `d6e980d3`, `00db9dc9`).

## 1. Recon findings

### Live modem (RM551E, OpenWrt 23.05.4, read-only probes, 2026-10-19)

| Probe | Result |
|---|---|
| `GET cellular/settings.sh` | `success:true`, slot 1, cfun 1, `mode_pref` AUTO, `nr5g_mode` 0, `roam_pref` 255; LTE AMBR has 2 rows (`SMARTLTE` 2008640/2008640, `ims` 100000/50000); NR5G AMBR `[]` (camped 5G-NSA, so that's correct) |
| `AT+QSIMDET?` | `+QSIMDET: 0,1` (rc 0). Supported on this firmware |
| `AT+QSIMCFG="dual_slot_status"` | 12 tokens, the same shape as the fork's RM520N capture: slot 1 active with ICCID `…8636`, slot 2 empty (ICCID `0`) |
| Fork compound read with `+QSIMDET?` appended | rc 0, every line present. `nr5g_ambr` returns no line and no ERROR |
| `AT+QSIMSTAT?` / `+CPIN?` | `0,1` / `READY` |
| `/tmp/qmanager_status.json` | `network.type` 5G-NSA, `sim_slot` 1, carrier TNT, `apn` `""`, **`.sim` absent** |
| `/usr/lib/qmanager/` | no `slot_verify.sh` (the fork's shared helper); the target keeps `verify_quimslot` inline in `settings.sh` |

### Backend: the target is ahead on the write path, the fork is ahead on reads

Keep from the target (all of it survives):
- B5.1 `at_exec` from `cgi_at.sh` (rc 0 ok / 1 transport / 2 modem ERROR), the GET's `modem_error` fail-closed check on rc 1, and partial parse on rc 2.
- The SIM-switch path: the `/tmp/qmanager_sim_switch_active` poller quiesce plus trap, the pre-switch ICCID capture with stale-read rejection (5 tries), `verify_quimslot` plus one retry, `sim_slot_switch_unverified`, the quiesce cleared before `qmanager_force_tier2`, and `qmanager_refresh_policy_band`.
- The fork's `at_write` is **not** ported: `at_exec` already does the same job, and it also catches a modem ERROR in stdout.

Port from the fork:
1. **`sim_detect`** (`AT+QSIMDET`). GET appends `+QSIMDET?` as the **last** sub-command of the compound read, so a firmware that rejects it can only cost the lines after it, and there are none. It emits `sim_detect` + `sim_detect_level`. POST validates `sim_detect ∈ {0,1}`, reads `AT+QSIMDET?` first to preserve `insert_level`, **skips the write and marks it failed when that read fails** (`at_exec` rc ≠ 0), falls back to level 1 only when the read succeeds without the line, then writes `AT+QSIMDET=<v>,<level>`. The order is nr5g → roam → sim_detect → mode_pref → sim_slot → cfun.
2. **`dual_slot`**: its own isolated `AT+QSIMCFG="dual_slot_status"` call (never added to the compound read), plus the 12-token shape guard. Only fields 2/6 and 8/12 are parsed. The key is omitted, never `null`, when the read fails or doesn't parse.
3. **AMBR fixes**: scratch files get a `.$$` suffix; NR5G gets the `-n` guard **before** the arithmetic, and the multiply moves to `awk` (BusyBox ash is 32-bit and wraps silently).
4. Header comment updated.

Not ported:
- The fork renamed `modem_error` to `read_failed`. The target keeps `modem_error`, which `errors.json` already resolves, and the onboarding Network Mode step (`components/onboarding/steps/step-network-mode.tsx`) also POSTs to this CGI.
- POST stays additive, so onboarding is unaffected.

### Poller: the `.sim` block is missing

The fork's SIM tile shows a `.sim.status` chip. The target poller already computes `t2_sim_status` (from `+CPIN?` via `parse_sim_status`) but never publishes it.
- **Proposal:** publish `"sim": {"status": "<t2_sim_status or unknown>"}` from that existing variable. That adds one `--arg` and one object key to the status write: no new AT command, and no `+QSIMSTAT?`.
- `inserted` is not shipped. The fork's own JSDoc says not to read it.
- The frontend treats `.sim` as optional, so older pollers fall back to the `unknown` tone.
- If you would rather keep the poller out of this row, the SIM chip renders `unknown` until a later row. Say which you want (see §6).

### Frontend gap

| Fork | Target today |
|---|---|
| Hook ~504 lines: `pending` patch, render-phase `prunePending`, `draft`, `dirtyFields`, `changeCount`, `discard`, `ApplyPhase` idle/writing/recovering/verifying, `RECOVERY_MS` keyed on **attempted** fields, partial-apply narrowing, `refresh` wrapper (MouseEvent trap) | 183 lines: `saveSettings(changes)`, local mirror in the card, `refresh: fetchSettings` (**the MouseEvent bug is live today**: Retry runs silently), recovery keyed on `changes` |
| Types: `SimSlot`, `CfunMode`, `ModePref` (all 7), `Nr5gMode`, `RoamPref`, `SimDetect`, `WRITABLE_SETTING_KEYS`, `isWritableSettingKey`, `CellularSettingsPatch`, `DualSlotEntry`, `CellularSettingsApplyResult`, optional `settings`/`ambr` | 88 lines, loose `number`/`string` |
| `cellular-settings.tsx` shell: header, `TonalBanner` error, Band A `LiveStateStrip` (poller), Band A2 `RateCeilingDisclosure` (settings GET), Band B two write cards (SIM & Radio Power / Network Mode & Roaming), one shared `ApplyFoot` on the Network card | lucide, a `div` error, 2-col grid of the settings card plus `cellular-ambr.tsx` |
| `setting-row`, `apply-foot` (step ledger), `shapes.ts` (1383 lines, **family-wide** geometry and tone contract) | none |

Primitives already in the target: `CellularPageHeader`, `TonalBanner`, `SegmentedField`, `CardFoot`, `SaveButton`/`useSaveFlash`, `MaterialSymbol`, `Tag`, `useMotionReduced`, `staggerContainer/Item/Rows/RowItem`.
Missing:
- `components/cellular/tile-shape.ts`, which **U4.13 lands**. The build waits for U4.13 to merge, then resets onto it.
- `networkTypeLabel` in `types/modem-status.ts`. U4.13 probably ports it; if not, this row adds only that helper.

### Interactions (`docs/features/`)

- **Custom SIM Profiles:** a verified slot switch runs `sim_db_add` + `auto_apply_profile … sim_switch` (kept as is). The quiesce flag contract is unchanged, and `settings.sh` still never writes `status.json`.
- **Connection Scenarios / Custom Profiles:** a `mode_pref` write from this page overrides whatever an active scenario set, today and in the fork alike. This row does not change that (see §6, follow-ups).
- **Watchdog Tier 3** uses the same Golden Rule CFUN/QUIMSLOT sequence on its own path. That path is untouched.
- **APN Management** (U4.11.2) is already done and lives in its own folder. It's untouched.

## 2. Scope

In scope: `/cellular/settings` only, plus the family `shapes.ts` and `apply-foot.tsx` that U4.18b will import.
Out of scope:
- IMEI, FPLMN and Network Priority (U4.18b).
- APN (done).
- Changing the onboarding step.
- New AT URC handling.
- Verifying `QSIMDET` reboot persistence (that needs a write plus a reboot; the fork leaves it open as well, and this row does the same).

**U4.18b coordination:** this row lands `components/cellular/settings/shapes.ts` **whole**: the fork file minus the exports this page doesn't use is not worth the drift, so it's copied whole, with target-specific token fixes. It also lands `apply-foot.tsx`, so U4.18b imports both rather than re-creating them. If U4.18b starts first, whichever row merges second rebases onto the other's `shapes.ts`.

## 3. Files and build order (shell → hook → components)

1. **Shell**
   - `scripts/www/cgi-bin/quecmanager/cellular/settings.sh`: §1 items 1–4.
   - `scripts/usr/bin/qmanager_poller`: the `.sim.status` publish, **only if approved**.
   - Gate: static audit (CRLF via `.claude/check-crlf.sh`, BusyBox/POSIX, `jq` without regex, lock/trap, CGI envelope, no reboot/CFUN=1,1).
2. **Types and hook**
   - `types/cellular-settings.ts`: the fork's typed enums, keys, guard, patch, `DualSlotEntry`, `CellularSettingsApplyResult`, optional envelope; `formatBitrate` kept.
   - `types/modem-status.ts`: optional `sim?: { status: SimStatus }` and `SimStatus` (exact poller strings); `networkTypeLabel` only if U4.13 didn't port it.
   - `hooks/use-cellular-settings.ts`: the fork hook, re-based on the target's `resolveErrorMessage(t, …)` error text, plus `sim_slot_switch_unverified` → `failedFields: ["sim_slot"]`.
3. **Components** (Material Symbols only, no lucide, no `max-w`, three states with shape-constant skeletons)
   - `components/cellular/settings/shapes.ts` (new, family-wide)
   - `setting-row.tsx`, `apply-foot.tsx`, `live-state-strip.tsx`, `rate-ceiling-disclosure.tsx` (new)
   - `cellular-settings-card.tsx` and `cellular-settings.tsx` (rewritten)
   - `cellular-ambr.tsx` **deleted**: it folds into `rate-ceiling-disclosure.tsx`
   - Toasts from returned results: saved / partial (names the fields that failed) / `sim_slot_switch_unverified` / transport.
4. **i18n:** `public/locales/{en,id,it,zh-CN,zh-TW}/cellular.json`, the `core_settings.basic.*` sub-tree only.
   - Target today: 41 keys under `ambr|page|radio`. Fork: ~101 keys under 15 groups.
   - Port the fork's translations for all five locales from `a05c4e92`, and drop the now-unused `radio.*`/`ambr.*` keys only after a grep shows no consumer.
5. **Docs**
   - New `docs/features/cellular-settings.md`, condensed from the fork's reference: read contract, attempted-field recovery window, dirty-merge rule, the `dual_slot` absence contract, the `sim_detect` level preservation.
   - Rows in `CLAUDE.md` + `docs/features/README.md`.
   - Close the existing ledger row U4.18a (committed on development-home in `73d6e74c`) with commits and deviations.
   - `DESIGN.md` Migration Deltas > Icons (route converted).
   - `RELEASE_NOTE.md` Improvements bullets.

## 4. CFUN / connection-loss risk, and how the UI survives it

- **What can drop:** a SIM-slot change (CFUN 0 → QUIMSLOT → CFUN 1, ~35 s worst case with verify and retry), `cfun` 0/4 (radio off / airplane until changed back), and `mode_pref`/`nr5g_mode`/`roam_pref` (re-registration, a few seconds).
- **What can't drop:** the LAN/HTTP path. QManager runs on the modem and is reached over LAN, and a CFUN cycle is not a reboot. So the POST completes inline and its response arrives. Nothing on this page reboots, and no deferred-reboot banner is needed.
- **UI handling:**
  - Every row carries a visible consequence sentence (Principle 6).
  - `ApplyFoot` shows the three-step ledger (writing → recovering → verifying) instead of a 35 s spinner.
  - The recovery wait (8 s slot / 3 s cfun or mode / 0) is keyed on **attempted** fields, so a failed slot write still waits before the read-back.
  - Staged edits survive the post-save refetch and a Retry (dirty-merge rule).
  - The SIM tile (poller) and the slot control (draft) may disagree during the switch, and that is intentional.
  - A failed later refresh keeps the last-good snapshot under the error banner.
  - `cfun=0/4` leaves the radio off by the user's own choice; the page stays reachable over LAN to turn it back on.
- **Server-side:** the quiesce trap clears on any exit; the fail-closed GET never fabricates state on a transport failure.
- **No extra confirm dialog.** That matches the fork; consequence lines stay visible. If you want an AlertDialog on `sim_slot`/`cfun≠1`, say so (see §6).

## 5. Validation

1. **Static shell audit** of `settings.sh` (and the poller, if touched): CRLF, bashisms, `local` usage consistent with the existing file, `jq` without `test/match/sub/gsub`, `--argjson` sentinel, trap discipline, the envelope, no `CFUN=1,1`/reboot.
2. **On-device** (backups first; scp to `/tmp`, then `mv`, then **`sync`**):
   - Back up `/www/cgi-bin/quecmanager/cellular/settings.sh` (and `/usr/bin/qmanager_poller`) to `*.bak.u418a`.
   - Read-only: the GET returns `sim_detect: 0`, `sim_detect_level: 1`, and `dual_slot` with 2 entries (slot 2 iccid `"0"`); the AMBR rows are unchanged; repeat GETs return the same thing. If the poller is touched, `status.json` has `.sim.status == "ready"`, the poller is running, and the file is non-zero size.
   - Error paths without touching the radio: POST `{"sim_detect":5}` → `invalid_sim_detect`; POST `{"cfun":9}` → `invalid_cfun` (validators exit before any AT write).
   - **Writes need your OK at that moment, case by case.** The proposed set: (a) `sim_detect` 0 → 1 → 0 (NVM only, no radio impact, level preserved at 1); (b) `roam_pref` 255 → 255 no-op. **Not proposed:** SIM-slot switch (slot 2 is empty), `cfun`, or `mode_pref` writes on the live modem.
3. **Frontend:** `bunx tsc --noEmit`, eslint on touched files, `bun run i18n:check`, `bun run icons:check`, `bun run build`.
4. **Preview** at 1440 and 375 px, light and dark: loading, loaded, never-read (with the CGI pointed at a failure) and dirty/apply-ledger states, using the on-device CGI through the dev proxy if available, otherwise mocked responses.

## 6. Decisions for you (defaults in bold)

1. Poller `.sim.status` publish (one key, no new AT): **include** / skip.
2. Confirm dialog before `sim_slot`/`cfun` applies: **no (matches the fork)** / yes.
3. On-device write test: **`sim_detect` toggle + revert only** / none / more.

Follow-ups, not in this row: scenario-vs-manual `mode_pref` drift warning; `QSIMDET` reboot-persistence check; `+QSIMSTAT?` `inserted` field.

## 7. Rollback

- **Device:** `mv *.bak.u418a` back, then `sync`. GET is the same shape as before plus additive keys, so an old frontend still works against the new CGI, and the new frontend tolerates the old CGI (`sim_detect` absent → its row is hidden; `dual_slot` absent → no caption).
- **Repo:** the row lands as a series of commits on `claude/practical-solomon-1a399b`, merged into `development-home` with `--no-ff`. Reverting the merge commit restores the old page. Never pushed.
