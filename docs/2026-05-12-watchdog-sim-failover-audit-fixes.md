> ⚠️ HISTORICAL: this May 2026 plan is superseded. The code it names (`CFG_MAX_FAILURES`, `last_iccid`, `watchdog-settings-card.tsx`, the single-file daemon) has since been replaced or split. The current behaviour is documented in [`features/connection-watchdog.md`](features/connection-watchdog.md); the October 2026 rework is in [`plans/2026-10-21-watchdog-modular-lean-plan.md`](plans/2026-10-21-watchdog-modular-lean-plan.md). Do not implement from this file.

# Watchdog SIM Failover — Audit Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address 8 bugs / risks identified in the 2026-05-12 audit of `qmanager_watchcat`'s automated SIM failover, plus surface a follow-up brainstorm for the "test backup SIM" feature (#9).

**Architecture:** All fixes are localized to four files — the watchdog daemon (`scripts/usr/bin/qmanager_watchcat`), the watchdog hook (`hooks/use-watchdog-settings.ts`), the settings card (`components/monitoring/watchdog/watchdog-settings-card.tsx`), and the four `monitoring.json` locale files. No new files. No new dependencies. No CGI contract changes.

**Tech Stack:** POSIX `/bin/sh` (BusyBox-compatible), `jq`, `qcmd`, React + TypeScript, react-i18next.

---

## File Map

| File | Reason for change | Tasks |
|---|---|---|
| `scripts/usr/bin/qmanager_watchcat` | Daemon logic fixes for fallback resilience, ICCID persistence, ping-stale handling, slot verification, JSON safety, success event | 1, 2, 3, 4, 5, 6 |
| `hooks/use-watchdog-settings.ts` | Periodic settings re-fetch so `auto_disabled` banner appears live | 8 |
| `components/monitoring/watchdog/watchdog-settings-card.tsx` | Block save when Tier 3 enabled with no backup slot | 7 |
| `public/locales/{en,zh-CN,it,id}/monitoring.json` | One new error string for #7, one new event string for #6 | 6, 7 |
| `RELEASE_NOTE.md` | User-facing summary of fixes | 10 |

---

## Constraints (don't violate these)

From `CLAUDE.md` and project memory:
- **Line endings:** All files in `scripts/**/*.sh` MUST be LF. CRLF will silently break CGI execution.
- **POSIX only:** No bashisms, no `[[ ]]`, no `local` outside functions, no `setsid`. BusyBox sh.
- **`jq` has no `test()` regex** — use `endswith()` / `startswith()` / `contains()`.
- **Active CID detection:** never write to `/etc/qmanager/active_profile` from this code path; profile_mgr.sh owns that.
- **Lock files:** never collapse `PROFILE_SPAWN_LOCK_FILE` and `PROFILE_APPLY_PID_FILE` (separate concerns).
- **Single shared `auto_apply_profile`** — call only via `( . /usr/lib/qmanager/profile_mgr.sh && auto_apply_profile "$iccid" "<tag>" )`.

---

## Verification baseline (run once before starting)

- [ ] **Step A: Confirm working tree is clean and on the right branch**

```sh
git status
git branch --show-current
```

Expected: `(clean)` and `development-home`.

- [ ] **Step B: Type-check the frontend baseline**

```sh
bun tsc --noEmit
```

Expected: zero errors. If it fails, stop and resolve before starting Task 7+.

- [ ] **Step C: Syntax-check the watchdog daemon baseline**

```sh
sh -n scripts/usr/bin/qmanager_watchcat
echo "exit=$?"
```

Expected: `exit=0` (no output, clean parse). If it fails, stop and investigate.

---

## Task 1: Persist new ICCID after Tier 3 success (fixes audit #2 — HIGH)

**Why:** When Tier 3 swaps SIMs, `/etc/qmanager/last_iccid` is not updated. On the next reboot, the poller compares boot ICCID to the (stale) stored ICCID, sees a mismatch, and false-fires the "New SIM card detected" banner. The fix writes the active ICCID to that file at the same moment we persist `SIM_FAILOVER_FILE`.

**Files:**
- Modify: `scripts/usr/bin/qmanager_watchcat` (lines 552–607 = `finish_cooldown`; lines 400–434 = `sim_failover_fallback`)

- [ ] **Step 1: Add ICCID persistence on Tier 3 confirmed success**

In `finish_cooldown()`, immediately AFTER the `printf '{"active":true,...` line (currently line 571–573) and BEFORE the existing `qlog_info "SIM failover state saved..."` line, insert:

```sh
            # Update last_iccid so poller's boot-time SIM swap detector treats
            # this failover SIM as expected (not a physical user swap).
            if [ -n "$curr_iccid" ]; then
                printf '%s' "$curr_iccid" > /etc/qmanager/last_iccid
            fi
```

- [ ] **Step 2: Add ICCID persistence on Tier 3 fallback (revert to original)**

In `sim_failover_fallback()`, the loop already populates `_rv_iccid` (lines 415–421). Immediately AFTER that loop and BEFORE the `if [ -n "$_rv_iccid" ]; then ( . /usr/lib/qmanager/profile_mgr.sh ...)` block, insert:

```sh
    # Persist the reverted SIM's ICCID so the poller's boot-time swap
    # detector doesn't false-fire on the next reboot.
    if [ -n "$_rv_iccid" ]; then
        printf '%s' "$_rv_iccid" > /etc/qmanager/last_iccid
    fi
```

- [ ] **Step 3: Syntax check**

```sh
sh -n scripts/usr/bin/qmanager_watchcat
echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 4: Verify line endings stayed LF**

```sh
file scripts/usr/bin/qmanager_watchcat
```

Expected output contains `ASCII text` and does NOT contain `CRLF`. If it shows CRLF, run `dos2unix scripts/usr/bin/qmanager_watchcat` and re-check.

- [ ] **Step 5: Manual logic review (no automated test infra for shell)**

Confirm by reading the diff:
1. The new code lives inside `if [ -n "$curr_iccid" ]` / `if [ -n "$_rv_iccid" ]` guards (no empty-write).
2. The path is exactly `/etc/qmanager/last_iccid` (matches `qmanager_poller:459`).
3. `printf '%s'` with no trailing newline matches the poller's `cat | tr -d ' \r\n'` reader (line 464).

- [ ] **Step 6: Commit**

```sh
git add scripts/usr/bin/qmanager_watchcat
git commit -m "fix(watchcat): persist last_iccid after T3 swap and fallback

Prevents the poller's boot-time SIM swap detector from false-firing
'New SIM card detected' on the next reboot after a watchdog-driven
failover. The failover SIM is now treated as the expected ICCID."
```

---

## Task 2: Propagate `wait_for_modem` failure in fallback (fixes audit #1 — HIGH)

**Why:** `sim_failover_fallback()` calls `wait_for_modem` but ignores its return code. If the modem fails to come back within 60 s, the function still proceeds to call `auto_apply_profile` (which will hit a dead modem) and restart `qmanager_tower_failover` (whose first AT command will also fail). The fix logs the error, emits an event, skips the profile auto-apply, and returns early — leaving tower failover stopped (its own respawn / future restart will pick it up if the modem recovers).

**Files:**
- Modify: `scripts/usr/bin/qmanager_watchcat` (lines 400–434 = `sim_failover_fallback`)

- [ ] **Step 1: Replace the unguarded `wait_for_modem` call with a guarded one**

Locate the existing block (around line 411):

```sh
    qcmd 'AT+CFUN=1' >/dev/null 2>&1

    wait_for_modem

    # Auto-apply profile matching reverted SIM (watchdog_revert)
```

Replace with:

```sh
    qcmd 'AT+CFUN=1' >/dev/null 2>&1

    if ! wait_for_modem; then
        qlog_error "SIM revert: modem unresponsive after CFUN=1, skipping profile auto-apply"
        append_event "sim_failover" "Watchcat: SIM reverted but modem unresponsive — manual check needed" "error"
        # Update last_iccid even on failure path; the slot command was sent.
        # Tower failover daemon will be (re)started by next normal recovery cycle.
        current_sim_slot="$original_sim_slot"
        sim_failover_active="false"
        original_sim_slot="null"
        return
    fi

    # Auto-apply profile matching reverted SIM (watchdog_revert)
```

- [ ] **Step 2: Syntax check**

```sh
sh -n scripts/usr/bin/qmanager_watchcat
echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 3: Logic review**

Confirm:
1. Early-return path resets state vars consistently with the success path tail (`current_sim_slot`, `sim_failover_active`, `original_sim_slot`).
2. The error event uses severity `"error"` (not `"warning"`), distinguishing it from the routine fallback notice.
3. We do NOT call `auto_apply_profile` on a dead modem.

- [ ] **Step 4: Commit**

```sh
git add scripts/usr/bin/qmanager_watchcat
git commit -m "fix(watchcat): handle wait_for_modem failure in SIM revert

Previously the fallback continued blindly after a 60s timeout, hitting
auto_apply_profile and tower_failover restart against a dead modem.
Now logs an error event and returns cleanly; tower failover will be
started by the next recovery cycle if the modem recovers."
```

---

## Task 3: Distinguish stale ping data from "unreachable" in cooldown (fixes audit #3 — MEDIUM)

**Why:** `finish_cooldown()` treats `read_ping` failure (stale or missing data) the same as `ping_reachable=false`, which can cause spurious escalation to Tier 4 reboot when the ping daemon merely hiccupped. The fix extends the cooldown by `CFG_CHECK_INTERVAL` for up to 3 retries before treating stale data as a recovery failure.

**Files:**
- Modify: `scripts/usr/bin/qmanager_watchcat` (lines 75–88 = state vars; lines 552–607 = `finish_cooldown`)

- [ ] **Step 1: Add the new state variable**

In the `# --- State Variables ---` block (around line 75–87), AFTER the existing `reboots_this_hour=0` line, add:

```sh
cooldown_stale_retries=0
```

- [ ] **Step 2: Extract the failure-handling tail into a helper**

Above `finish_cooldown()` (so it's defined first), add:

```sh
# Shared failure path for cooldown — fallback if Tier 3, then escalate.
_cooldown_handle_failure() {
    qlog_warn "COOLDOWN failure path entered for Tier $current_tier"

    # If Tier 3 failed to restore connectivity, fall back to original SIM
    if [ "$current_tier" -eq 3 ] && [ "$current_sim_slot" != "$original_sim_slot" ] && [ "$original_sim_slot" != "null" ]; then
        sim_failover_fallback
    fi

    # Escalate to next enabled tier
    if find_next_tier $((current_tier + 1)); then
        state="suspect"
        failure_counter="$CFG_MAX_FAILURES"
        qlog_info "Escalating to Tier $current_tier"
    else
        qlog_error "All recovery tiers exhausted — returning to monitor"
        state="monitor"
        current_tier=0
        failure_counter=0
    fi
}
```

- [ ] **Step 3: Rewrite `finish_cooldown()` to use the helper and handle stale data**

Replace the entire existing `finish_cooldown()` body with:

```sh
finish_cooldown() {
    rm -f "$RECOVERY_FLAG"

    # Try to read fresh ping data
    if ! read_ping; then
        if [ "$cooldown_stale_retries" -lt 3 ]; then
            cooldown_stale_retries=$((cooldown_stale_retries + 1))
            qlog_warn "COOLDOWN: ping data stale (retry $cooldown_stale_retries/3) — extending by ${CFG_CHECK_INTERVAL}s"
            cooldown_remaining="$CFG_CHECK_INTERVAL"
            touch "$RECOVERY_FLAG"   # keep events suppressed during extension
            return
        fi
        qlog_error "COOLDOWN: ping data still stale after 3 retries — treating as recovery failure"
        cooldown_stale_retries=0
        _cooldown_handle_failure
        return
    fi
    cooldown_stale_retries=0

    if [ "$ping_reachable" = "true" ]; then
        qlog_info "COOLDOWN complete: connectivity RESTORED after Tier $current_tier"

        # If this was Tier 3 SIM failover, finalize the failover state
        if [ "$current_tier" -eq 3 ] && [ "$current_sim_slot" != "$original_sim_slot" ] && [ "$original_sim_slot" != "null" ]; then
            sim_failover_active="true"

            local curr_iccid_raw curr_iccid
            curr_iccid_raw=$(qcmd 'AT+QCCID' 2>/dev/null)
            curr_iccid=$(printf '%s' "$curr_iccid_raw" | grep '+QCCID:' | sed 's/+QCCID: //g' | tr -d '\r ')

            local ts
            ts=$(date +%s)
            jq -n -c \
                --argjson orig "$original_sim_slot" \
                --argjson curr "$current_sim_slot" \
                --argjson ts "$ts" \
                --arg iccid "$curr_iccid" \
                '{active:true, original_slot:$orig, current_slot:$curr, switched_at:$ts, reason:"connectivity_failure", original_iccid:"", current_iccid:$iccid}' \
                > "$SIM_FAILOVER_FILE"

            # Update last_iccid so poller's boot-time SIM swap detector treats
            # this failover SIM as expected (not a physical user swap).
            if [ -n "$curr_iccid" ]; then
                printf '%s' "$curr_iccid" > /etc/qmanager/last_iccid
            fi

            qlog_info "SIM failover state saved: slot $original_sim_slot → $current_sim_slot"
            append_event "sim_failover" "Watchcat: SIM failover confirmed — running on slot $current_sim_slot" "info"

            # Auto-apply profile matching new SIM (watchdog)
            if [ -n "$curr_iccid" ]; then
                ( . /usr/lib/qmanager/profile_mgr.sh && auto_apply_profile "$curr_iccid" "watchdog" )
            fi
        fi

        # Reset — connectivity recovered
        state="monitor"
        current_tier=0
        failure_counter=0
        return
    fi

    qlog_warn "COOLDOWN complete: connectivity NOT restored after Tier $current_tier"
    _cooldown_handle_failure
}
```

> **Note:** This single rewrite folds in Tasks 1, 5, and 6 changes (ICCID write, jq-based JSON, success event). If you implemented Tasks 1/5/6 separately first, the diff for this task only changes the stale-handling logic and helper extraction.

- [ ] **Step 4: Reset `cooldown_stale_retries` on LOCKED entry and on monitor reset**

In `main()` LOCKED-state entry block (around line 706–714), AFTER `failure_counter=0`, add:

```sh
                cooldown_stale_retries=0
```

In the LOCKED-state exit block (around line 721–726), AFTER `failure_counter=0`, add:

```sh
            cooldown_stale_retries=0
```

- [ ] **Step 5: Syntax check**

```sh
sh -n scripts/usr/bin/qmanager_watchcat
echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 6: Logic review**

Confirm:
1. `cooldown_stale_retries` is reset to 0 in three places: after a successful read, after exhausting retries, and on LOCKED enter/exit. (It does NOT need reset on normal monitor→suspect→recovery flow because successful `read_ping` resets it.)
2. The extension `cooldown_remaining="$CFG_CHECK_INTERVAL"` causes the cooldown branch in `main()` to run at least one more loop iteration before calling `finish_cooldown` again.
3. `touch "$RECOVERY_FLAG"` during extension keeps the poller suppressing noisy events.
4. `_cooldown_handle_failure` is defined BEFORE `finish_cooldown` (POSIX sh requires definition order for nested calls? — actually no, sh resolves function names at call time, but defining first is clearer).

- [ ] **Step 7: Commit**

```sh
git add scripts/usr/bin/qmanager_watchcat
git commit -m "fix(watchcat): retry stale ping data instead of treating it as failure

Cooldown previously treated a missing/stale ping cache as 'connectivity
not restored', which could escalate to Tier 4 reboot during a transient
ping daemon hiccup. Now extends cooldown by check_interval up to 3
retries, then escalates only if data is still stale.

Also extracts the cooldown failure tail into _cooldown_handle_failure
so stale-after-retry and 'reachable=false' share the same path. Folds
in JSON-safe ICCID write (jq -n) and the new T3 confirmed event."
```

> **Note on commit grouping:** Because Task 3's rewrite of `finish_cooldown` already includes the Task 1 ICCID write, the Task 5 jq-based JSON, and the Task 6 confirmed event, you have two valid execution paths:
> - **Path A (recommended):** Implement Task 1 first as a separate commit, then Task 3 (which preserves Task 1's ICCID logic in the rewrite). Tasks 5 and 6 then become no-ops because Task 3 folded them in. Skip them and continue at Task 4.
> - **Path B:** Skip Task 1's commit. Implement Task 3 directly (which contains all of 1, 5, 6). Then continue at Task 2 and Task 4.
> Either way, do not commit Task 1, then Task 5, then Task 3 — the third would conflict with itself.

---

## Task 4: Verify SIM slot on resume-from-reboot (fixes audit #7 — LOW)

**Why:** When watchcat starts, it trusts `SIM_FAILOVER_FILE` blindly. If something else changed the SIM slot while watchcat was down (manual `AT+QUIMSLOT`, a config-restore, or a power-cycle that landed on a different slot), the daemon's idea of "current slot" diverges from reality. The fix runs one `AT+QUIMSLOT?` at startup and clears the failover state if the live slot doesn't match the recorded one.

**Files:**
- Modify: `scripts/usr/bin/qmanager_watchcat` (lines 670–679 = startup SIM-failover-resume block in `main()`)

- [ ] **Step 1: Replace the resume block with verified resume**

Locate (around lines 669–679):

```sh
    # Check for stale SIM failover state from before reboot
    if [ -f "$SIM_FAILOVER_FILE" ]; then
        local sf_active_val
        sf_active_val=$(jq -r '(.active) | if . == null then "false" else tostring end' "$SIM_FAILOVER_FILE" 2>/dev/null)
        if [ "$sf_active_val" = "true" ]; then
            sim_failover_active="true"
            original_sim_slot=$(jq -r '(.original_slot) | if . == null then "null" else tostring end' "$SIM_FAILOVER_FILE" 2>/dev/null)
            current_sim_slot=$(jq -r '(.current_slot) | if . == null then "null" else tostring end' "$SIM_FAILOVER_FILE" 2>/dev/null)
            qlog_info "Resuming SIM failover state: slot $original_sim_slot → $current_sim_slot"
        fi
    fi
```

Replace with:

```sh
    # Check for stale SIM failover state from before reboot, verifying the
    # live slot matches what the file records. If the modem is on a
    # different slot than recorded, clear the file rather than carry stale
    # state forward.
    if [ -f "$SIM_FAILOVER_FILE" ]; then
        local sf_active_val
        sf_active_val=$(jq -r '(.active) | if . == null then "false" else tostring end' "$SIM_FAILOVER_FILE" 2>/dev/null)
        if [ "$sf_active_val" = "true" ]; then
            local _sf_orig _sf_curr _live_slot
            _sf_orig=$(jq -r '(.original_slot) | if . == null then "null" else tostring end' "$SIM_FAILOVER_FILE" 2>/dev/null)
            _sf_curr=$(jq -r '(.current_slot) | if . == null then "null" else tostring end' "$SIM_FAILOVER_FILE" 2>/dev/null)
            _live_slot=$(qcmd 'AT+QUIMSLOT?' 2>/dev/null | grep '+QUIMSLOT:' | sed 's/.*: *//' | tr -d '\r ')

            if [ -n "$_live_slot" ] && [ "$_live_slot" = "$_sf_curr" ]; then
                sim_failover_active="true"
                original_sim_slot="$_sf_orig"
                current_sim_slot="$_sf_curr"
                qlog_info "Resumed SIM failover state: slot $original_sim_slot → $current_sim_slot (verified)"
            else
                qlog_warn "SIM failover file recorded slot $_sf_curr but modem is on slot ${_live_slot:-unknown} — clearing stale state"
                rm -f "$SIM_FAILOVER_FILE"
            fi
        fi
    fi
```

- [ ] **Step 2: Syntax check**

```sh
sh -n scripts/usr/bin/qmanager_watchcat
echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 3: Logic review**

Confirm:
1. The `qcmd 'AT+QUIMSLOT?'` runs INSIDE the `if [ "$sf_active_val" = "true" ]` guard — no AT command if no failover state exists.
2. If `qcmd` fails (`_live_slot` is empty), the `else` branch fires and the file is cleared. This is intentional — better to lose resumed state than to act on unverified state.
3. The file is removed with `rm -f` (forgiving if already gone).
4. Position: this block runs BEFORE `BOOT_SETTLE` sleep, so `qcmd` is hitting a possibly-not-fully-ready modem. That's acceptable here because failure → clear, which is the safe default.

- [ ] **Step 4: Commit**

```sh
git add scripts/usr/bin/qmanager_watchcat
git commit -m "fix(watchcat): verify modem slot on SIM failover state resume

Previously the daemon trusted /tmp/qmanager_sim_failover blindly at
startup. If the modem booted on a different slot than recorded,
sim_failover_active stayed true with wrong slot numbers. Now runs one
AT+QUIMSLOT? and clears the file if the live slot disagrees."
```

---

## Task 5: JSON-safe `SIM_FAILOVER_FILE` write (fixes audit #8 — LOW)

> **Skip if Task 3 was implemented** — Task 3's rewrite of `finish_cooldown` already uses `jq -n -c` for this write. Verify by grepping; if the new `jq -n -c` block exists in `finish_cooldown`, mark this task complete and move on.

```sh
grep -n "jq -n -c" scripts/usr/bin/qmanager_watchcat | head -5
```

Expected: at least one match inside `finish_cooldown` writing to `SIM_FAILOVER_FILE`. If present, skip Task 5 entirely.

If for any reason Task 3 was not implemented, perform the equivalent jq replacement on the `printf '{"active":true,...` line standalone (replacement code is shown verbatim in Task 3 Step 3).

---

## Task 6: Emit "SIM failover confirmed" event (fixes audit #5 — MEDIUM)

> **Skip if Task 3 was implemented** — Task 3's rewrite already inserts `append_event "sim_failover" "Watchcat: SIM failover confirmed — running on slot $current_sim_slot" "info"`. Verify:

```sh
grep -n "SIM failover confirmed" scripts/usr/bin/qmanager_watchcat
```

Expected: 1 match. If present, skip Task 6.

If Task 3 was not implemented, add that single `append_event` line in `finish_cooldown` immediately after the `qlog_info "SIM failover state saved..."` line.

**i18n note:** The `sim_failover` event label is already translated in all four `events.json` locale files. No locale changes needed for this task.

---

## Task 7: Block save when Tier 3 enabled with no backup slot (fixes audit #4 — MEDIUM)

**Why:** The settings form lets the user enable Tier 3 without picking a backup SIM slot. The save succeeds, the daemon silently logs `TIER 3 SKIPPED: no backup SIM slot configured` on every recovery — the user is unprotected and unaware. The fix adds a frontend validation gate and a translated error string.

**Files:**
- Modify: `components/monitoring/watchdog/watchdog-settings-card.tsx` (validation block around line 151–178; backup-sim Field around line 415–442)
- Modify: `public/locales/en/monitoring.json` (insert one key alongside `backup_sim_description`)
- Modify: `public/locales/zh-CN/monitoring.json` (same key, Chinese translation)
- Modify: `public/locales/it/monitoring.json` (same key, Italian translation)
- Modify: `public/locales/id/monitoring.json` (same key, Indonesian translation)

- [ ] **Step 1: Add the new i18n key to EN**

In `public/locales/en/monitoring.json`, find the line:

```json
    "backup_sim_description": "Which SIM slot to fail over to when Tier 3 activates.",
```

Insert AFTER it:

```json
    "backup_sim_required_error": "Choose a backup SIM slot or disable Tier 3.",
```

- [ ] **Step 2: Add the same key to zh-CN**

In `public/locales/zh-CN/monitoring.json`, after `"backup_sim_description"`:

```json
    "backup_sim_required_error": "请选择备用 SIM 槽，或关闭 Tier 3。",
```

- [ ] **Step 3: Add the same key to it**

In `public/locales/it/monitoring.json`, after `"backup_sim_description"`:

```json
    "backup_sim_required_error": "Seleziona uno slot SIM di backup o disabilita il Livello 3.",
```

- [ ] **Step 4: Add the same key to id**

In `public/locales/id/monitoring.json`, after `"backup_sim_description"`:

```json
    "backup_sim_required_error": "Pilih slot SIM cadangan atau nonaktifkan Tier 3.",
```

- [ ] **Step 5: Add the validation derivation in `WatchdogSettingsForm`**

In `components/monitoring/watchdog/watchdog-settings-card.tsx`, locate the validation block (around line 151–178). AFTER `maxRebootsError` and BEFORE `hasValidationErrors`, insert:

```tsx
  const backupSimSlotError =
    tier3Enabled && !backupSimSlot
      ? t("watchdog.backup_sim_required_error")
      : null;
```

Then update `hasValidationErrors`:

```tsx
  const hasValidationErrors = !!(
    maxFailuresError ||
    cooldownError ||
    maxRebootsError ||
    backupSimSlotError
  );
```

- [ ] **Step 6: Surface the error under the backup SIM `Select`**

Locate the existing `<FieldDescription>` after the `<Select>` in the Tier 3 backup-SIM Field (around line 437–439):

```tsx
                      <FieldDescription>
                        {t("watchdog.backup_sim_description")}
                      </FieldDescription>
```

Replace with:

```tsx
                      {backupSimSlotError ? (
                        <FieldError id="backup-sim-error">
                          {backupSimSlotError}
                        </FieldError>
                      ) : (
                        <FieldDescription>
                          {t("watchdog.backup_sim_description")}
                        </FieldDescription>
                      )}
```

Also update the `<SelectTrigger>` to wire `aria-invalid` and `aria-describedby`:

```tsx
                        <SelectTrigger
                          id="backup-sim-slot"
                          className="max-w-sm"
                          aria-invalid={!!backupSimSlotError}
                          aria-describedby={
                            backupSimSlotError ? "backup-sim-error" : undefined
                          }
                        >
```

- [ ] **Step 7: Verify `bun tsc` is clean**

```sh
bun tsc --noEmit
```

Expected: zero errors. If `FieldError` is not yet imported, add it to the existing `import` from `@/components/ui/field` near the top of the file (it should already be there — verify the import statement at line 14–22 includes `FieldError`).

- [ ] **Step 8: Verify i18n parity check passes**

```sh
bun run i18n:check
```

Expected: exit 0, no missing-key warnings.

- [ ] **Step 9: Manual UI smoke test**

1. `bun run dev` (or hit your existing dev URL).
2. Navigate to `/monitoring/watchdog`.
3. With Tier 3 enabled and backup SIM slot empty, verify:
   - The Save button is disabled.
   - A red error message reads "Choose a backup SIM slot or disable Tier 3."
4. Pick a slot — error disappears, Save enables.
5. Disable Tier 3 — backup-SIM Field hides, error clears, Save enables.

Report explicitly if you cannot run the dev server (per `CLAUDE.md`: type-check verifies code correctness, not feature correctness).

- [ ] **Step 10: Commit**

```sh
git add components/monitoring/watchdog/watchdog-settings-card.tsx public/locales/*/monitoring.json
git commit -m "fix(watchdog): block save when Tier 3 enabled without backup SIM

Previously the form allowed enabling Tier 3 with no slot picked; the
daemon would silently log 'TIER 3 SKIPPED' on every recovery cycle,
leaving the user unprotected and unaware. Now requires a slot
selection before Save and shows a translated error."
```

---

## Task 8: Poll watchdog settings for live `auto_disabled` (fixes audit #6 — MEDIUM)

**Why:** `useWatchdogSettings` calls `fetchSettings()` once on mount. If the daemon auto-disables itself (Tier 4 reboot quota hit) while the user is on the watchdog page, the red banner stays hidden until they navigate away or reload. The fix adds a 30s silent poll.

**Files:**
- Modify: `hooks/use-watchdog-settings.ts` (lines 135–137 = mount effect)

- [ ] **Step 1: Replace the one-shot mount effect with a polling effect**

Locate (around lines 135–137):

```tsx
  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);
```

Replace with:

```tsx
  useEffect(() => {
    fetchSettings();
    const id = setInterval(() => {
      fetchSettings(true);
    }, 30_000);
    return () => clearInterval(id);
  }, [fetchSettings]);
```

- [ ] **Step 2: Type-check**

```sh
bun tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Logic review**

Confirm:
1. The polled call passes `silent = true` so it does NOT flip `isLoading` (no skeleton flash every 30 s).
2. `setError(null)` inside `fetchSettings` will clear and re-set on each poll — that's fine; if the daemon is unreachable the user sees a transient error rather than a stale "saved fine" state.
3. Cleanup `clearInterval` runs on unmount; no leaked interval.

- [ ] **Step 4: Manual smoke test (optional, requires real device)**

If you can SSH to a test device:

```sh
# On device — force the auto-disabled state
touch /tmp/qmanager_watchcat_disabled
uci set quecmanager.watchcat.enabled=0 && uci commit quecmanager
```

In the browser, with the watchdog page already open, the red `auto_disabled_alert` banner should appear within 30 s without reloading.

- [ ] **Step 5: Commit**

```sh
git add hooks/use-watchdog-settings.ts
git commit -m "fix(watchdog): poll settings every 30s to surface auto_disabled live

Previously the auto-disabled banner only appeared on initial mount or
explicit refresh. If the daemon disabled itself (Tier 4 quota) while
the user was on the page, they saw stale state until next navigation."
```

---

## Task 9: "Test backup SIM" feature (audit #9 — LOW, deferred)

**Why this is NOT in scope for this plan:** Adding a UI-driven dry-run of Tier 3 is a feature, not a fix. It needs:
- A new CGI POST action (`test_backup_sim`).
- A daemon-side worker that performs Golden Rule swap, waits for connectivity, and unconditionally swaps back regardless of result.
- UX: a button in the watchdog status card, a multi-step progress dialog, abort handling, "your internet will drop for ~60s" warning, success/failure outcome with diagnostic detail.
- Locking so it cannot run simultaneously with active recovery, profile apply, or another test.
- Edge cases: what if the user is sitting on a remote SSH session? How long is the swap-back guaranteed?

**Recommended next step:** Run `superpowers:brainstorming` (or `/gsd-spec-phase`) on this feature, then a separate plan. Reference this audit document.

- [ ] **Step 1: Capture as a backlog item**

```sh
# If GSD is in use:
# /gsd-add-backlog "Test backup SIM dry-run feature (watchdog audit #9)"

# Otherwise just leave a TODO marker:
echo "## Watchdog Audit Follow-Up

- [ ] Test backup SIM dry-run feature (audit finding #9 LOW). Needs design discussion before planning. See docs/2026-05-12-watchdog-sim-failover-audit-fixes.md Task 9." >> RELEASE_NOTE_DRAFT.md
```

(Skip Step 1 entirely if you have a different backlog system. The point is: don't lose the idea.)

---

## Task 10: Update `RELEASE_NOTE.md`

**Why:** Per `CLAUDE.md`, every shipped change goes in `RELEASE_NOTE.md` with user-facing language.

**Files:**
- Modify: `RELEASE_NOTE.md`

- [ ] **Step 1: Read the current top of the file**

```sh
head -40 RELEASE_NOTE.md
```

- [ ] **Step 2: Add bullets under the appropriate section**

Append (or insert under existing) section headers, using user-facing wording — not internal function names. Example bullets:

Under `## ✅ Improvements`:

```markdown
- Watchdog: SIM failover now writes the active SIM's ICCID so the next reboot doesn't false-fire the "New SIM card detected" notification.
- Watchdog: Settings form now requires a backup SIM slot when Tier 3 is enabled.
- Watchdog: Status page now reflects auto-disabled state within 30 seconds without needing a refresh.
- Watchdog: Brief gaps in connectivity-check data no longer trigger spurious recovery escalation; the watchdog now extends cooldown briefly for a stable reading.
- Watchdog: Network Events log now records a "SIM failover confirmed" entry once the swap is verified, complementing the existing "switching SIM" notice.
- Watchdog: SIM revert now logs and surfaces a clear error if the modem fails to come back, instead of silently chasing a dead modem.
- Watchdog: At startup, the watchdog now verifies the modem is on the recorded SIM slot before resuming SIM failover state.
```

- [ ] **Step 3: Commit**

```sh
git add RELEASE_NOTE.md
git commit -m "docs: release notes for watchdog SIM failover audit fixes"
```

---

## Final verification checklist

Run these once after all tasks are committed.

- [ ] **All commits present**

```sh
git log --oneline development-home ^HEAD~12 | head -15
```

Expect commits matching the messages above (Tasks 1, 2, 3, 4, 7, 8, 10 — 5 and 6 are folded into Task 3).

- [ ] **Watchdog daemon parses cleanly**

```sh
sh -n scripts/usr/bin/qmanager_watchcat && echo OK
```

Expected: `OK`.

- [ ] **No CRLF crept in**

```sh
file scripts/usr/bin/qmanager_watchcat
# (and any other modified .sh files if applicable)
```

Expected output contains `ASCII text`, NOT `CRLF`.

- [ ] **Frontend type-check clean**

```sh
bun tsc --noEmit
```

Expected: zero errors.

- [ ] **i18n parity intact**

```sh
bun run i18n:check
```

Expected: zero missing-key warnings across en, zh-CN, it, id.

- [ ] **Update auto-memory if anything new was learned**

Any new gotcha discovered while implementing (e.g., "AT+QUIMSLOT? returns empty during boot for X seconds") should be added under `C:\Users\RUS-LEGION5\.claude\projects\D--Projects-QM-PROJECT-QManager\memory\` as a new `feedback_*.md` file with an entry in `MEMORY.md`.

---

## Out of scope for this plan

- New feature: "Test backup SIM" dry-run (audit #9). Captured as Task 9 backlog item.
- Restructuring of the watchdog state machine. Current state machine is sound; we are bug-fixing, not redesigning.
- Tower failover daemon changes. Out of audit scope.
- Adding a shell-test framework. Project does not use one for shell scripts; introducing one is a separate decision.
