#!/bin/sh
# =============================================================================
# wd_state.sh - qmanager_watchcat: state file writer and maintenance-lock check
# =============================================================================
# Sourced by qmanager_watchcat (never executed). BusyBox ash safe.
#
# Owns: state, prev_state, failure_counter
# Functions: write_state, check_locked
#
# write_state serialises globals owned by every lib into STATE_FILE (the poller
# reads it); it only reads them. Function definitions and global initialisers
# only. The last line sets WD_STATE_LOADED.
# =============================================================================

# --- State Variables (owned here) --------------------------------------------
state="monitor"
prev_state=""
failure_counter=0

# =============================================================================
# STATE FILE WRITER
# =============================================================================

write_state() {
    local ts
    ts=$(date +%s)

    jq -n -c \
        --argjson ts "$ts" \
        --argjson enabled "$CFG_ENABLED" \
        --arg state "$state" \
        --argjson tier "$current_tier" \
        --argjson failures "$failure_counter" \
        --argjson last_time "${last_recovery_time:-null}" \
        --argjson last_tier "${last_recovery_tier:-null}" \
        --argjson total "$total_recoveries" \
        --argjson cooldown "$cooldown_remaining" \
        --arg sf_active "$sim_failover_active" \
        --argjson sf_orig "${original_sim_slot:-null}" \
        --argjson sf_curr "${current_sim_slot:-null}" \
        --argjson reboots "$reboots_this_hour" \
        --argjson quality_breach "$quality_breach_counter" \
        --argjson quality_enabled "$CFG_QUALITY_ENABLED" \
        --arg recovery_reason "$recovery_reason" \
        --argjson ssr_hold "$ssr_hold" \
        --argjson last_ssr_detected "$last_ssr_detected" \
        '{
            timestamp: $ts, enabled: ($enabled == 1),
            state: $state, current_tier: $tier,
            failure_count: $failures,
            last_recovery_time: $last_time,
            last_recovery_tier: $last_tier,
            total_recoveries: $total,
            cooldown_remaining: $cooldown,
            sim_failover_active: ($sf_active == "true"),
            original_sim_slot: $sf_orig,
            current_sim_slot: $sf_curr,
            reboots_this_hour: $reboots,
            quality_breach_count: $quality_breach,
            quality_enabled: ($quality_enabled == 1),
            last_recovery_reason: $recovery_reason,
            ssr_hold: $ssr_hold,
            last_ssr_detected: $last_ssr_detected
        }' > "$STATE_TMP"

    mv "$STATE_TMP" "$STATE_FILE"
}

# =============================================================================
# HELPERS
# =============================================================================

# Check if maintenance mode is active (any lock condition)
check_locked() {
    # Explicit maintenance lock
    [ -f "$LOCK_FILE" ] && return 0

    # Long-running AT command (cell scan, firmware update)
    [ -f "$LONG_RUNNING_FLAG" ] && return 0

    # Profile apply in progress
    if [ -f "$PROFILE_APPLY_PID" ]; then
        local pid
        pid=$(cat "$PROFILE_APPLY_PID" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi

    return 1
}

WD_STATE_LOADED=1
