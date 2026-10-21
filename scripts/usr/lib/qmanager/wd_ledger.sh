#!/bin/sh
# =============================================================================
# wd_ledger.sh - qmanager_watchcat: reboot ledger (crash.log) accounting
# =============================================================================
# Sourced by qmanager_watchcat (never executed). BusyBox ash safe.
#
# Owns: reboots_this_hour
# Functions: count_recent_reboots
#
# Reads CRASH_LOG (defined by the daemon). Function definitions and global
# initialisers only. The last line sets WD_LEDGER_LOADED.
# =============================================================================

# --- State Variables (owned here) --------------------------------------------
reboots_this_hour=0

# Count WATCHDOG reboots in the last hour from crash.log.
# crash.log is now a shared reboot ledger: watchcat writes tier4_escalation rows,
# and record_planned_reboot (qlog.sh) writes user/unplanned rows for the reboot-
# alert feature. The tier-4 token bucket + the dashboard's reboots_this_hour must
# keep their original meaning ("watchdog-caused reboots this hour"), so we count
# ONLY tier4_escalation rows here. Field layout: <epoch>|reboot|<reason>.
count_recent_reboots() {
    if [ ! -f "$CRASH_LOG" ]; then
        reboots_this_hour=0
        return
    fi
    local now
    local cutoff
    local count
    now=$(date +%s)
    cutoff=$((now - 3600))
    count=$(awk -v cutoff="$cutoff" -F'|' '$1 >= cutoff && $3 == "tier4_escalation" { n++ } END { print n+0 }' "$CRASH_LOG" 2>/dev/null)
    reboots_this_hour="${count:-0}"
}

WD_LEDGER_LOADED=1
