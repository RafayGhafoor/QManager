#!/bin/sh
# =============================================================================
# wd_sim.sh - qmanager_watchcat: Tier 3 SIM failover, fallback, revert, recheck
# =============================================================================
# Sourced by qmanager_watchcat (never executed). BusyBox ash safe.
#
# Owns: sim_failover_active, original_sim_slot, original_sim_iccid,
#       current_sim_slot, revert_settle_active, primary_recheck_active,
#       recheck_return_slot, recheck_interrupted, last_recheck_time
# Functions: wd_read_slot, wd_swap_slot, execute_tier3, sim_failover_fallback,
#            finalize_sim_failover, initiate_primary_recheck,
#            check_revert_request, wd_sim_finish_recheck,
#            wd_sim_resume_at_start, wd_sim_on_unlock
#
# Every SIM slot change goes through wd_swap_slot, which proves the swap by
# reading the slot back: AT+QUIMSLOT= can return OK and change nothing.
#
# The wd_sim_* functions are verbatim blocks lifted out of finish_cooldown
# (wd_tiers.sh) and main() (qmanager_watchcat) so every SIM-failover path lives
# in this file; each is called from the spot it came from. They also write
# globals owned by other libs (state, cooldown_remaining, recovery_reason,
# current_tier, ...), as the originals did. Function definitions and global
# initialisers only. The last line sets WD_SIM_LOADED.
# =============================================================================

# --- State Variables (owned here) --------------------------------------------
sim_failover_active="false"
original_sim_slot="null"
original_sim_iccid=""           # ICCID of the original (pre-swap) SIM; "" = unknown
current_sim_slot="null"
revert_settle_active="false"    # "true" while holding the post-revert SIM settle floor
primary_recheck_active="false"  # "true" while holding the blind primary-recheck settle floor
recheck_return_slot="null"      # backup slot to return to if a primary recheck fails
recheck_interrupted="false"     # "true" when LOCKED abandoned a primary-recheck settle
last_recheck_time=0             # mono_now of the last failover finalize / recheck; auto-failback clock
                                # (monotonic: a boot-time clock step must not make a recheck due at once)

# Flags shared with the poller (qmanager_poller) and cellular/settings.sh.
WD_SIM_SWITCH_FLAG="/tmp/qmanager_sim_switch_active"       # poller pauses AT while present
WD_FORCE_TIER2_FLAG="/tmp/qmanager_force_tier2"
WD_REFRESH_POLICY_FLAG="/tmp/qmanager_refresh_policy_band"
WD_SWAP_NOOP="false"            # "true" when the last wd_swap_slot found the target already live

# Prints the live SIM slot digit (up to 3 tries, 1 s apart), or nothing when it
# cannot be read. Callers treat empty as "unknown", never as a slot.
wd_read_slot() {
    local _rs_try
    local _rs_raw
    local _rs_slot
    for _rs_try in 1 2 3; do
        _rs_raw=$(qcmd 'AT+QUIMSLOT?' 2>/dev/null)
        _rs_slot=$(printf '%s' "$_rs_raw" | grep '+QUIMSLOT:' | sed 's/.*: *//' | tr -d '\r ')
        case "$_rs_slot" in
            ''|*[!0-9]*) ;;
            *) printf '%s' "$_rs_slot"; return 0 ;;
        esac
        [ "$_rs_try" -lt 3 ] && sleep 1
    done
    return 0
}

# Move the modem to SIM slot <target> and prove it: returns 0 only when the slot
# reads back as <target> AND the radio is on (CFUN=1). Two attempts of the
# CFUN=0 -> QUIMSLOT -> CFUN=1 sequence. Returns 1 otherwise (radio restored to
# CFUN=1 where the modem answers). Never AT+CFUN=1,1. The poller is held off AT
# by the SIM-switch flag for the duration.
wd_swap_slot() {
    local _sw_target
    local _sw_live
    local _sw_cfun
    local _sw_attempt
    local _sw_ok
    _sw_target="$1"
    WD_SWAP_NOOP="false"

    case "$_sw_target" in
        ''|*[!0-9]*)
            qlog_error "SIM swap: invalid target slot '$_sw_target'"
            return 1
            ;;
    esac

    _sw_live=$(wd_read_slot)
    if [ "$_sw_live" = "$_sw_target" ]; then
        WD_SWAP_NOOP="true"
        qlog_info "SIM swap: already on slot $_sw_target, radio not cycled"
        return 0
    fi

    _sw_ok=1
    _sw_attempt=1
    while [ "$_sw_attempt" -le 2 ]; do
        # Re-touched each attempt: the poller drops a flag older than its max age.
        : > "$WD_SIM_SWITCH_FLAG"
        command -v write_state_busy >/dev/null 2>&1 && write_state_busy
        wd_mark_radio_down
        qcmd 'AT+CFUN=0' >/dev/null 2>&1
        sleep 2
        qcmd "AT+QUIMSLOT=$_sw_target" >/dev/null 2>&1
        sleep 2
        qcmd 'AT+CFUN=1' >/dev/null 2>&1

        if wait_for_modem; then
            : > "$WD_SIM_SWITCH_FLAG"
            command -v write_state_busy >/dev/null 2>&1 && write_state_busy
            _sw_live=$(wd_read_slot)
            _sw_cfun=$(wd_cfun_now)
            if [ "$_sw_cfun" != "1" ]; then
                qlog_warn "SIM swap: CFUN is '${_sw_cfun:-unreadable}' after AT+CFUN=1, sending it again"
                qcmd 'AT+CFUN=1' >/dev/null 2>&1
                sleep 2
                _sw_cfun=$(wd_cfun_now)
            fi
            [ "$_sw_cfun" = "1" ] && wd_mark_radio_up
            if [ "$_sw_live" = "$_sw_target" ] && [ "$_sw_cfun" = "1" ]; then
                _sw_ok=0
                break
            fi
            qlog_warn "SIM swap attempt $_sw_attempt/2 to slot $_sw_target not verified (slot '${_sw_live:-unreadable}', CFUN '${_sw_cfun:-unreadable}')"
        else
            qlog_error "SIM swap attempt $_sw_attempt/2 to slot $_sw_target: modem unresponsive after CFUN=1"
        fi
        _sw_attempt=$((_sw_attempt + 1))
    done

    rm -f "$WD_SIM_SWITCH_FLAG"
    if [ "$_sw_ok" -ne 0 ]; then
        return 1
    fi

    # Dashboard shows the new SIM at once (same flags as cellular/settings.sh).
    touch "$WD_FORCE_TIER2_FLAG" "$WD_REFRESH_POLICY_FLAG"
    command -v wd_quality_mark >/dev/null 2>&1 && wd_quality_mark
    return 0
}

execute_tier3() {
    # Pre-check: backup SIM configured
    if [ -z "$CFG_BACKUP_SIM_SLOT" ]; then
        qlog_warn "TIER 3 SKIPPED: no backup SIM slot configured"
        return 1
    fi

    # Read current SIM slot
    local current_slot
    current_slot=$(wd_read_slot)

    if [ -z "$current_slot" ]; then
        qlog_error "TIER 3: Cannot read current SIM slot"
        return 1
    fi

    if [ "$CFG_BACKUP_SIM_SLOT" = "$current_slot" ]; then
        qlog_warn "TIER 3 SKIPPED: backup slot ($CFG_BACKUP_SIM_SLOT) equals current slot ($current_slot)"
        return 1
    fi

    qlog_info "TIER 3: SIM failover from slot $current_slot to slot $CFG_BACKUP_SIM_SLOT"
    append_event "sim_failover" "Watchcat: switching to SIM slot $CFG_BACKUP_SIM_SLOT (Tier 3)" "warning"

    touch "$RECOVERY_FLAG"

    # Capture the ORIGINAL slot's ICCID (3×1s retry) BEFORE detaching, so the
    # failover file records an honest original_iccid. Best-effort: if it can't be
    # read after 3 tries, leave it "" and continue — never block the swap.
    # Kept local until the swap is verified: original_sim_slot/_iccid stay unset
    # for a swap that never happened.
    local _orig_iccid_raw
    local _orig_iccid
    local _orig_try
    _orig_iccid=""
    for _orig_try in 1 2 3; do
        _orig_iccid_raw=$(qcmd 'AT+QCCID' 2>/dev/null)
        _orig_iccid=$(printf '%s' "$_orig_iccid_raw" | grep '+QCCID:' | sed 's/+QCCID: //g' | tr -d '\r ')
        [ -n "$_orig_iccid" ] && break
        sleep 1
    done

    # Stop tower failover daemon (locks are meaningless on different SIM)
    /etc/init.d/qmanager_tower_failover stop 2>/dev/null

    # Verified Golden Rule swap (wd_swap_slot). If the slot never moved there is
    # no failover to record: put tower failover back and skip the tier.
    if ! wd_swap_slot "$CFG_BACKUP_SIM_SLOT"; then
        qlog_error "TIER 3: SIM swap to slot $CFG_BACKUP_SIM_SLOT not verified, skipping tier"
        append_event "sim_failover" "Watchcat: SIM swap to slot $CFG_BACKUP_SIM_SLOT did not take effect — skipped" "error"
        /etc/init.d/qmanager_tower_failover start 2>/dev/null
        return 1
    fi

    original_sim_slot="$current_slot"
    original_sim_iccid="$_orig_iccid"
    current_sim_slot="$CFG_BACKUP_SIM_SLOT"

    # Verify SIM presence. AT+CPIN? right after AT+CFUN=1 can answer
    # "+CME ERROR: 14" (SIM busy) while SIM init is still running, because
    # wait_for_modem only waits for a bare AT. One failed read is routine, not
    # proof the slot is empty, so retry 3x (1s apart) like the ICCID read above.
    # qcmd prints a modem ERROR on stdout with rc=0; a transport failure (lock
    # timeout, broker down) is rc!=0 with empty stdout. Only READY passes.
    local cpin_result
    local cpin_rc
    local cpin_try
    local cpin_ready
    cpin_result=""
    cpin_rc=1
    cpin_ready=0
    for cpin_try in 1 2 3; do
        cpin_result=$(qcmd 'AT+CPIN?' 2>/dev/null)
        cpin_rc=$?
        if [ "$cpin_rc" -eq 0 ] && printf '%s' "$cpin_result" | grep -q '^+CPIN: READY'; then
            cpin_ready=1
            break
        fi
        sleep 1
    done

    [ "$cpin_rc" -eq 0 ] || cpin_result=""
    case "$cpin_ready:$cpin_result" in
        1:*) ;;
        *'+CPIN:'*)
            # Present but not usable (PIN/PUK required): log the real state.
            cpin_result=$(printf '%s' "$cpin_result" | grep '+CPIN:' | head -1 | tr -d '\r')
            qlog_error "TIER 3: Backup slot $CFG_BACKUP_SIM_SLOT SIM not ready ($cpin_result), falling back"
            sim_failover_fallback
            return 0
            ;;
        *)
            qlog_error "TIER 3: Could not confirm a SIM in backup slot $CFG_BACKUP_SIM_SLOT after 3 attempts (rc=$cpin_rc), falling back"
            sim_failover_fallback
            return 0
            ;;
    esac

    # Read new ICCID for logging
    local new_iccid_raw
    local new_iccid
    local iccid_suffix
    new_iccid_raw=$(qcmd 'AT+QCCID' 2>/dev/null)
    new_iccid=$(printf '%s' "$new_iccid_raw" | grep '+QCCID:' | sed 's/+QCCID: //g' | tr -d '\r ')
    iccid_suffix=$(printf '%s' "$new_iccid" | tail -c 4)

    qlog_info "TIER 3: Switched to slot $CFG_BACKUP_SIM_SLOT (ICCID: ...$iccid_suffix)"

    # Don't write SIM failover state yet — wait for cooldown to verify connectivity
    # The cooldown handler will check reachability and finalize
    return 0
}

# Fallback: revert SIM to original slot
sim_failover_fallback() {
    qlog_warn "SIM failover fallback: reverting to slot $original_sim_slot"
    append_event "sim_failover" "Watchcat: backup SIM failed, reverting to slot $original_sim_slot" "warning"

    local _rv_iccid_raw
    local _rv_iccid
    local _try

    # Returns 1 with every failover variable intact when the swap back cannot be
    # verified: the caller keeps the record and the state it had.
    if ! wd_swap_slot "$original_sim_slot"; then
        qlog_error "SIM revert: swap back to slot $original_sim_slot not verified, failover state kept"
        append_event "sim_failover" "Watchcat: could not revert to SIM slot $original_sim_slot — manual check needed" "error"
        return 1
    fi

    # Auto-apply profile matching reverted SIM (watchdog_revert)
    _rv_iccid=""
    for _try in 1 2 3; do
        _rv_iccid_raw=$(qcmd 'AT+QCCID' 2>/dev/null)
        _rv_iccid=$(printf '%s' "$_rv_iccid_raw" | grep '+QCCID:' | sed 's/+QCCID: //g' | tr -d '\r ')
        [ -n "$_rv_iccid" ] && break
        sleep 1
    done
    # Mark the reverted SIM as known so the poller's boot-time swap
    # detector doesn't false-fire on the next reboot.
    if [ -n "$_rv_iccid" ]; then
        sim_db_add "$_rv_iccid"
    fi

    if [ -n "$_rv_iccid" ]; then
        ( . /usr/lib/qmanager/profile_mgr.sh && auto_apply_profile "$_rv_iccid" "watchdog_revert" )
    else
        qlog_info "[watchdog_revert] ICCID query failed after revert, skipping auto-apply"
    fi

    # Restart tower failover daemon
    /etc/init.d/qmanager_tower_failover start 2>/dev/null

    current_sim_slot="$original_sim_slot"
    sim_failover_active="false"
    original_sim_slot="null"
    original_sim_iccid=""
    return 0
}

# Finalize a Tier-3 SIM failover after a successful recovery cooldown. Shared by
# BOTH the reachability and quality success arms so a quality-triggered swap is
# finalized identically (writes $SIM_FAILOVER_FILE, marks sim_failover_active,
# records the SIM, auto-applies the profile, starts the auto-failback clock).
# GUARDED: a no-op unless this episode was a real Tier-3 swap, so either arm may
# call it unconditionally.
finalize_sim_failover() {
    [ "$current_tier" -eq 3 ] || return 0
    [ "$current_sim_slot" != "$original_sim_slot" ] || return 0
    [ "$original_sim_slot" != "null" ] || return 0

    sim_failover_active="true"

    # Reason recorded in the failover file mirrors WHY recovery fired.
    local _fail_reason
    if [ "$recovery_reason" = "quality" ]; then
        _fail_reason="quality_degradation"
    else
        _fail_reason="connectivity_failure"
    fi

    # Read backup ICCID with 3×1s retry — matches sim_failover_fallback pattern.
    local curr_iccid_raw
    local curr_iccid
    local _try
    curr_iccid=""
    for _try in 1 2 3; do
        curr_iccid_raw=$(qcmd 'AT+QCCID' 2>/dev/null)
        curr_iccid=$(printf '%s' "$curr_iccid_raw" | grep '+QCCID:' | sed 's/+QCCID: //g' | tr -d '\r ')
        [ -n "$curr_iccid" ] && break
        sleep 1
    done

    local ts
    ts=$(date +%s)
    jq -n -c \
        --argjson orig "$original_sim_slot" \
        --argjson curr "$current_sim_slot" \
        --argjson ts "$ts" \
        --arg reason "$_fail_reason" \
        --arg orig_iccid "$original_sim_iccid" \
        --arg iccid "$curr_iccid" \
        '{active:true, original_slot:$orig, current_slot:$curr, switched_at:$ts, reason:$reason, original_iccid:$orig_iccid, current_iccid:$iccid}' \
        | qm_atomic_write "$SIM_FAILOVER_FILE"

    # Mark this failover SIM as known so the poller's boot-time SIM swap detector
    # treats it as expected (not a physical user swap).
    if [ -n "$curr_iccid" ]; then
        sim_db_add "$curr_iccid"
    fi

    qlog_info "SIM failover state saved: slot $original_sim_slot → $current_sim_slot (reason=$_fail_reason)"
    append_event "sim_failover" "Watchcat: SIM failover confirmed — running on slot $current_sim_slot" "info"

    # Auto-apply profile matching new SIM (watchdog)
    if [ -n "$curr_iccid" ]; then
        ( . /usr/lib/qmanager/profile_mgr.sh && auto_apply_profile "$curr_iccid" "watchdog" )
    fi

    # Start the auto-failback clock from the moment failover is confirmed.
    last_recheck_time=$(mono_now)
}

# Initiate a BLIND recheck of the primary SIM: temporarily swap back to the
# original (primary) slot and let the post-settle health test decide whether to
# stay (failback) or return to the backup. Each call is a real outage — only the
# guarded main-loop call site fires it, and only when opted-in + due.
initiate_primary_recheck() {
    # Defensive precondition re-check (caller guards too).
    [ "$sim_failover_active" = "true" ] || return 0
    [ "$original_sim_slot" != "null" ] || return 0

    # If primary is still bad, this is the slot we return to.
    recheck_return_slot="$current_sim_slot"

    touch "$RECOVERY_FLAG"
    qlog_info "PRIMARY RECHECK: temporary swap-back to primary slot $original_sim_slot"
    append_event "sim_failover" "Watchcat: rechecking primary SIM (slot $original_sim_slot) — temporary swap-back" "info"

    # Verified swap to PRIMARY. On failure stay on the backup (nothing changed),
    # restart the recheck clock and do not enter a settle.
    if ! wd_swap_slot "$original_sim_slot"; then
        qlog_error "PRIMARY RECHECK: swap to slot $original_sim_slot not verified, staying on backup"
        append_event "sim_failover" "Watchcat: primary SIM recheck failed (slot swap not verified) — staying on slot $recheck_return_slot" "error"
        last_recheck_time=$(mono_now)
        rm -f "$RECOVERY_FLAG"
        return 0
    fi

    # Tentatively on primary now; the post-settle test confirms or reverts.
    current_sim_slot="$original_sim_slot"

    # Enter the settle cooldown. Leave recovery_reason AS-IS so the post-settle
    # health test uses the quality criterion iff the failover was quality-driven.
    # Do NOT clear sim_failover_active yet — finish_cooldown's recheck arm decides.
    primary_recheck_active="true"
    cooldown_remaining="$SIM_SETTLE_SECS"
    state="cooldown"
    qlog_info "Entering primary-recheck settle for ${SIM_SETTLE_SECS}s (reason=$recovery_reason)"
}

# Primary-recheck settle verdict, called by finish_cooldown when
# primary_recheck_active is "true": a FRESH health read decides failback to the
# primary SIM or a return to the backup slot. Both paths end in return, so the
# caller returns right after this.
wd_sim_finish_recheck() {
    primary_recheck_active="false"

    local _primary_healthy
    _primary_healthy="no"
    if read_ping && [ "$ping_reachable" = "true" ]; then
        if [ "$recovery_reason" = "quality" ]; then
            # Quality failover: primary must also pass the quality criterion.
            if read_quality && ! quality_breached; then
                _primary_healthy="yes"
            fi
        else
            _primary_healthy="yes"
        fi
    fi
    # Stale ping data => read_ping returned 1 => stays "no" (conservative).

    local _ph_iccid_raw
    local _ph_iccid
    local _ph_try

    if [ "$_primary_healthy" = "yes" ]; then
        qlog_info "PRIMARY RECHECK: primary SIM healthy — failing back to slot $current_sim_slot"
        sim_failover_active="false"
        rm -f "$SIM_FAILOVER_FILE"

        _ph_iccid=""
        for _ph_try in 1 2 3; do
            _ph_iccid_raw=$(qcmd 'AT+QCCID' 2>/dev/null)
            _ph_iccid=$(printf '%s' "$_ph_iccid_raw" | grep '+QCCID:' | sed 's/+QCCID: //g' | tr -d '\r ')
            [ -n "$_ph_iccid" ] && break
            sleep 1
        done
        if [ -n "$_ph_iccid" ]; then
            sim_db_add "$_ph_iccid"
            ( . /usr/lib/qmanager/profile_mgr.sh && auto_apply_profile "$_ph_iccid" "watchdog_failback" )
        fi

        # Back on primary — its tower locks are valid again.
        /etc/init.d/qmanager_tower_failover start 2>/dev/null

        append_event "sim_failover" "Watchcat: primary SIM healthy again — failed back to slot $current_sim_slot" "info"

        original_sim_slot="null"
        original_sim_iccid=""
        current_tier=0
        failure_counter=0
        quality_breach_counter=0
        _recovery_marker_emitted=""
        last_recheck_time=$(mono_now)
        state="monitor"
        rm -f "$RECOVERY_FLAG"
        return
    fi

    # Primary still unhealthy — swap BACK to the backup slot.
    qlog_warn "PRIMARY RECHECK: primary SIM still unhealthy — returning to backup slot $recheck_return_slot"
    local _rt_slot
    if wd_swap_slot "$recheck_return_slot"; then
        current_sim_slot="$recheck_return_slot"
    else
        # Report where the modem really is: possibly still on the primary.
        qlog_error "PRIMARY RECHECK: return to backup slot $recheck_return_slot not verified"
        append_event "sim_failover" "Watchcat: could not return to backup SIM slot $recheck_return_slot — manual check needed" "error"
        _rt_slot=$(wd_read_slot)
        case "$_rt_slot" in
            ''|*[!0-9]*) current_sim_slot="$recheck_return_slot" ;;
            *) current_sim_slot="$_rt_slot" ;;
        esac
    fi
    sim_failover_active="true"

    local _bk_iccid_raw
    local _bk_iccid
    local _bk_try
    _bk_iccid=""
    for _bk_try in 1 2 3; do
        _bk_iccid_raw=$(qcmd 'AT+QCCID' 2>/dev/null)
        _bk_iccid=$(printf '%s' "$_bk_iccid_raw" | grep '+QCCID:' | sed 's/+QCCID: //g' | tr -d '\r ')
        [ -n "$_bk_iccid" ] && break
        sleep 1
    done

    local _rc_reason
    if [ "$recovery_reason" = "quality" ]; then
        _rc_reason="quality_degradation"
    else
        _rc_reason="connectivity_failure"
    fi

    local _rc_ts
    _rc_ts=$(date +%s)
    jq -n -c \
        --argjson orig "$original_sim_slot" \
        --argjson curr "$current_sim_slot" \
        --argjson ts "$_rc_ts" \
        --arg reason "$_rc_reason" \
        --arg orig_iccid "$original_sim_iccid" \
        --arg iccid "$_bk_iccid" \
        '{active:true, original_slot:$orig, current_slot:$curr, switched_at:$ts, reason:$reason, original_iccid:$orig_iccid, current_iccid:$iccid}' \
        | qm_atomic_write "$SIM_FAILOVER_FILE"
    if [ -n "$_bk_iccid" ]; then
        sim_db_add "$_bk_iccid"
    fi

    # On backup again — tower locks are meaningless, keep the daemon stopped.
    # (If the return swap failed and the modem is still on the primary, the
    # error event above says so and the daemon is left running.)
    if [ "$current_sim_slot" = "$recheck_return_slot" ]; then
        /etc/init.d/qmanager_tower_failover stop 2>/dev/null
        append_event "sim_failover" "Watchcat: primary SIM still unhealthy — staying on backup slot $recheck_return_slot" "info"
    fi

    # Restart the interval clock so the next recheck is one full interval away.
    last_recheck_time=$(mono_now)

    # Benign post-swap settle: reuse the revert mechanism so the modem
    # stabilizes on backup WITHOUT escalation. Keep suppression (RECOVERY_FLAG
    # stays touched) during the settle, mirroring check_revert_request.
    revert_settle_active="true"
    recovery_reason="unreachable"
    cooldown_remaining="$SIM_SETTLE_SECS"
    state="cooldown"
    touch "$RECOVERY_FLAG"
    qlog_info "Entering post-recheck backup settle for ${SIM_SETTLE_SECS}s"
    return
}

# =============================================================================
# USER-REQUESTED SIM REVERT
# =============================================================================

check_revert_request() {
    [ -f "$REVERT_FLAG" ] || return 1
    # B4.1: act only on a root-owned flag; a planted one is dropped
    if ! qm_trusted_file "$REVERT_FLAG"; then
        qlog_warn "Ignoring untrusted SIM revert flag (not root-owned)"
        rm -f "$REVERT_FLAG"
        return 1
    fi

    # Finalized failover — safe to revert now.
    if [ "$sim_failover_active" = "true" ]; then
        # Never revert concurrently with an in-flight recovery/cooldown cycle;
        # the recovery path owns the modem. Leave the flag pending for a later
        # cycle once we are back in a quiescent state.
        if [ "$state" = "recovery" ] || [ "$state" = "cooldown" ]; then
            qlog_info "SIM revert requested but $state in progress — deferring to next cycle"
            return 1
        fi

        # A maintenance lock, airplane mode or an SSR hold owns the modem too:
        # a swap now would cycle the radio under it. check_locked is read live
        # because the loop sets state="locked" only after this call.
        if check_locked || [ "$state" = "locked" ] || [ "$state" = "radio_off" ] || [ "$state" = "ssr_hold" ]; then
            qlog_info "SIM revert requested but modem is busy (state=$state) — deferring"
            return 1
        fi

        qlog_info "User requested SIM revert to slot $original_sim_slot"
        rm -f "$REVERT_FLAG"
        append_event "sim_failover" "Watchcat: reverting to original SIM slot $original_sim_slot (user request)" "info"

        touch "$RECOVERY_FLAG"
        if ! sim_failover_fallback; then
            # Not verified: the record and the active failover stay as they were.
            # The request is consumed; the user can ask again.
            rm -f "$RECOVERY_FLAG"
            return 1
        fi
        rm -f "$RECOVERY_FLAG" "$SIM_FAILOVER_FILE"

        sim_failover_active="false"
        failure_counter=0
        current_tier=0

        # Already on the original slot: nothing was cycled, so no settle.
        if [ "$WD_SWAP_NOOP" = "true" ]; then
            qlog_info "SIM revert: modem already on the original slot, failover record cleared"
            return 0
        fi

        # Enforce the SIM settle floor after the reverse Golden-Rule swap: hold
        # ~90s before the daemon resumes normal connectivity evaluation, just as
        # a forward Tier-3 swap does. Reuse the cooldown state so the UI gets an
        # honest countdown; revert_settle_active marks this as a benign hold so
        # finish_cooldown returns to monitor without recovery escalation.
        revert_settle_active="true"
        recovery_reason="unreachable"
        cooldown_remaining="$SIM_SETTLE_SECS"
        state="cooldown"
        qlog_info "Entering post-revert SIM settle for ${SIM_SETTLE_SECS}s"
        return 0
    fi

    # No finalized failover. If a Tier-3 swap is mid-flight (slot already moved to
    # the backup but cooldown hasn't finalized sim_failover_active yet), KEEP the
    # request pending so it is consumed on a later cycle after finalization —
    # do NOT silently delete it.
    if [ "$original_sim_slot" != "null" ] && [ "$current_sim_slot" != "$original_sim_slot" ]; then
        qlog_info "SIM revert requested while a swap is mid-flight — keeping request pending"
        return 1
    fi

    # Genuinely nothing to revert (no failover active, no swap in progress).
    rm -f "$REVERT_FLAG"
    return 1
}

# Resume a Tier-3 failover recorded before this daemon start, called by main()
# before the boot settle. The locals were main() locals.
wd_sim_resume_at_start() {
    # Check for stale SIM failover state from before reboot, verifying the
    # live slot matches what the file records. If the modem is on a
    # different slot than recorded, clear the file rather than carry stale
    # state forward.
    # B4.1: trust the failover state only when root-owned; otherwise drop it
    if command -v qm_trusted_file >/dev/null 2>&1 \
            && { [ -e "$SIM_FAILOVER_FILE" ] || [ -L "$SIM_FAILOVER_FILE" ]; }; then
        if ! qm_trusted_file "$SIM_FAILOVER_FILE"; then
            qlog_warn "Ignoring untrusted SIM failover file (not root-owned) - removing"
            rm -f "$SIM_FAILOVER_FILE"
        fi
    fi
    if [ -f "$SIM_FAILOVER_FILE" ]; then
        local sf_active_val
        sf_active_val=$(jq -r '(.active) | if . == null then "false" else tostring end' "$SIM_FAILOVER_FILE" 2>/dev/null)
        if [ "$sf_active_val" = "true" ]; then
            local _sf_orig
            local _sf_curr
            local _live_slot
            _sf_orig=$(jq -r '(.original_slot) | if . == null then "null" else tostring end' "$SIM_FAILOVER_FILE" 2>/dev/null)
            _sf_curr=$(jq -r '(.current_slot) | if . == null then "null" else tostring end' "$SIM_FAILOVER_FILE" 2>/dev/null)
            _live_slot=$(qcmd 'AT+QUIMSLOT?' 2>/dev/null | grep '+QUIMSLOT:' | sed 's/.*: *//' | tr -d '\r ')

            if [ -n "$_live_slot" ] && [ "$_live_slot" = "$_sf_curr" ]; then
                sim_failover_active="true"
                original_sim_slot="$_sf_orig"
                current_sim_slot="$_sf_curr"
                # Restore the original ICCID so a later recheck/return-to-backup
                # rewrites the failover file honestly.
                original_sim_iccid=$(jq -r '(.original_iccid) | if . == null then "" else tostring end' "$SIM_FAILOVER_FILE" 2>/dev/null)
                # Start the auto-failback clock from boot-resume so a recheck is at
                # most one interval away (not immediately on boot).
                last_recheck_time=$(mono_now)
                qlog_info "Resumed SIM failover state: slot $original_sim_slot → $current_sim_slot (verified)"
            else
                qlog_warn "SIM failover file recorded slot $_sf_curr but modem is on slot ${_live_slot:-unknown} — clearing stale state"
                rm -f "$SIM_FAILOVER_FILE"
            fi
        fi
    fi
}

# SIM clean-up on LOCKED exit, called by main() right after the generic LOCKED
# reset: reverts an unconfirmed Tier-3 swap and re-arms an interrupted primary
# recheck.
wd_sim_on_unlock() {
    # Entering LOCKED mid-cooldown abandons a Tier-3 swap the cooldown never
    # confirmed: the modem stays on the backup SIM with no failover record,
    # a revert request waits forever and the next outage skips Tier 3
    # (backup == current). Revert it now, as an unrestored Tier 3 is. A Tier 3
    # that aborted before the swap leaves current_sim_slot "null": no revert. Not
    # on LOCKED entry: the lock holder owns the modem until here.
    if [ "$sim_failover_active" != "true" ] && [ "$original_sim_slot" != "null" ] && [ "$current_sim_slot" != "null" ] && [ "$current_sim_slot" != "$original_sim_slot" ]; then
        qlog_warn "LOCKED exit: unconfirmed Tier 3 swap on slot $current_sim_slot, reverting to slot $original_sim_slot"
        touch "$RECOVERY_FLAG"
        if sim_failover_fallback; then
            revert_settle_active="true"
            recovery_reason="unreachable"
            cooldown_remaining="$SIM_SETTLE_SECS"
            state="cooldown"
            qlog_info "Entering post-revert SIM settle for ${SIM_SETTLE_SECS}s"
        else
            rm -f "$RECOVERY_FLAG"
        fi
    fi

    # LOCKED during a primary-recheck settle left the modem on the primary
    # slot with sim_failover_active=true and the record still naming the
    # backup. Re-arm the settle so finish_cooldown's recheck arm decides
    # failback or return-to-backup from a fresh health read.
    if [ "$recheck_interrupted" = "true" ]; then
        recheck_interrupted="false"
        if [ "$sim_failover_active" = "true" ] && [ "$original_sim_slot" != "null" ] && [ "$current_sim_slot" = "$original_sim_slot" ] && [ "$recheck_return_slot" != "null" ]; then
            qlog_warn "LOCKED exit: primary recheck was interrupted on slot $current_sim_slot, re-arming its settle for ${SIM_SETTLE_SECS}s"
            touch "$RECOVERY_FLAG"
            primary_recheck_active="true"
            cooldown_remaining="$SIM_SETTLE_SECS"
            state="cooldown"
        fi
    fi
}

WD_SIM_LOADED=1
