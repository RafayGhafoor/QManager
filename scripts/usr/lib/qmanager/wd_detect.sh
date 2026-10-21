#!/bin/sh
# =============================================================================
# wd_detect.sh - qmanager_watchcat: inputs that start or hold recovery
# =============================================================================
# Sourced by qmanager_watchcat (never executed). BusyBox ash safe.
#
# Owns: ping_streak_fail, ping_reachable, ping_during_recovery, q_avg_latency,
#       q_packet_loss, quality_breach_counter, ssr_hold, last_ssr_detected,
#       ssr_hold_started
# Functions: read_ping, read_quality, quality_breached, evaluate_quality,
#            ssr_in_progress, ssr_hold_gate, ssr_hold_clear
#
# evaluate_quality starts the recovery ladder (find_next_tier / do_recovery from
# wd_tiers.sh), so it writes state, recovery_reason and current_tier, which other
# libs own. Function definitions and global initialisers only. The last line sets
# WD_DETECT_LOADED.
# =============================================================================

# --- State Variables (owned here) --------------------------------------------
quality_breach_counter=0
ssr_hold="false"          # JSON bool literal for write_state
last_ssr_detected="null"  # JSON null literal or monotonic-seconds integer
ssr_hold_started=0        # monotonic seconds-since-boot when hold began; 0 = not holding

# Read ping daemon data — returns 0 if valid, 1 if stale/missing
# Sets: ping_streak_fail, ping_reachable, ping_during_recovery
ping_streak_fail=0
ping_reachable="true"
ping_during_recovery="false"

read_ping() {
    # conn_state_read owns the read + staleness rule (max(3 * interval_sec, 15)
    # on the monotonic clock). On failure the ping_* vars keep their previous
    # values; every caller treats a non-zero return as "unknown, skip".
    if ! conn_state_read; then
        if [ "$CQ_STALE_REASON" = "missing" ]; then
            qlog_warn "Ping cache missing"
        else
            qlog_warn "Ping data stale ($(conn_state_why)), skipping cycle"
        fi
        return 1
    fi

    # reachable is true/false, or "null" when the cache did not say — "null"
    # is never treated as up. The down decision stays on the probe-count streak.
    ping_streak_fail="$CQ_STREAK_FAIL"
    ping_reachable="$CQ_REACHABLE"
    ping_during_recovery="$CQ_DURING_RECOVERY"
    return 0
}

# Read poller status.json for connection-quality metrics, with a staleness
# guard. The .connectivity object has no timestamp of its own, so freshness
# is judged from the ROOT .timestamp. Returns 0 if FRESH+valid, 1 if
# stale/missing/unparseable (= NO-SIGNAL).
# Sets: q_avg_latency (may be "null"), q_packet_loss (sanitized int)
q_avg_latency="null"
q_packet_loss="0"
read_quality() {
    [ -f "$STATUS_CACHE" ] || return 1
    local _qdata
    _qdata=$(jq -r '[
        (.timestamp | if . == null then "0" else tostring end),
        (.connectivity.avg_latency_ms | if . == null then "null" else tostring end),
        (.connectivity.packet_loss_pct | if . == null then "0" else tostring end)
    ] | @tsv' "$STATUS_CACHE" 2>/dev/null)
    [ -z "$_qdata" ] && return 1
    local _ts
    _ts=$(printf '%s' "$_qdata" | cut -f1)
    q_avg_latency=$(printf '%s' "$_qdata" | cut -f2)
    q_packet_loss=$(printf '%s' "$_qdata" | cut -f3)
    # sanitize loss to a clean integer (avg_latency may legitimately be "null")
    case "$q_packet_loss" in ''|*[!0-9]*) q_packet_loss=0 ;; esac
    # Staleness check — prefer monotonic /proc/uptime; wall-clock fallback when .mono absent
    local _mono
    _mono=$(jq -r '.mono | if . == null then "" else tostring end' "$STATUS_CACHE" 2>/dev/null)
    case "$_mono" in
        ''|0|*[!0-9]*)
            local _now
            local _age
            _now=$(date +%s)
            _age=$((_now - _ts))
            if [ "$_ts" -le 0 ] 2>/dev/null || [ "$_age" -gt "$STATUS_STALE_THRESHOLD" ]; then
                qlog_warn "Quality data stale/wc (age=${_age}s) — treating as no-signal"
                return 1
            fi
            ;;
        *)
            local _age_mono
            _age_mono=$(( $(mono_now) - _mono ))
            if [ "$_ts" -le 0 ] 2>/dev/null || [ "$_age_mono" -gt "$STATUS_STALE_THRESHOLD" ]; then
                qlog_warn "Quality data stale (age_mono=${_age_mono}s) — treating as no-signal"
                return 1
            fi
            ;;
    esac
    return 0
}

# Decide whether current quality (already read by read_quality) breaches the
# configured ceilings. OR logic; a ceiling of 0 means IGNORE that metric.
# avg_latency_ms is a FLOAT — comparison MUST use awk (BusyBox [ -gt ] errors
# on decimals). Returns 0 if breached, 1 if not.
quality_breached() {
    # latency: only if threshold > 0 AND we have a numeric windowed average
    if [ "$CFG_LATENCY_THRESHOLD_MS" -gt 0 ] 2>/dev/null && [ "$q_avg_latency" != "null" ]; then
        if awk -v a="$q_avg_latency" -v c="$CFG_LATENCY_THRESHOLD_MS" 'BEGIN{ exit !((a+0) > (c+0)) }'; then
            qlog_warn "QUALITY breach: avg latency ${q_avg_latency}ms > ${CFG_LATENCY_THRESHOLD_MS}ms (shared)"
            return 0
        fi
    fi
    # loss: only if threshold > 0
    if [ "$CFG_LOSS_THRESHOLD_PCT" -gt 0 ] 2>/dev/null; then
        if [ "$q_packet_loss" -ge "$CFG_LOSS_THRESHOLD_PCT" ] 2>/dev/null; then
            qlog_warn "QUALITY breach: loss ${q_packet_loss}% >= ${CFG_LOSS_THRESHOLD_PCT}% (shared)"
            return 0
        fi
    fi
    return 1
}

# Accrue the consecutive-breach counter and, on reaching the threshold, kick
# off the SAME Tier 1->4 recovery ladder used by the reachability path.
# Returns 0 if it TRIGGERED recovery this cycle (caller skips rest of cycle),
# 1 otherwise.
evaluate_quality() {
    [ "$CFG_QUALITY_ENABLED" = "1" ] || return 1
    if ! read_quality; then
        # no-signal: leave counter unchanged (never count as breach, never reset)
        return 1
    fi
    if quality_breached; then
        quality_breach_counter=$((quality_breach_counter + 1))
        qlog_info "QUALITY: breach ${quality_breach_counter}/${CFG_QUALITY_CONSECUTIVE} (avg ${q_avg_latency}ms vs ${CFG_LATENCY_THRESHOLD_MS}ms, loss ${q_packet_loss}% vs ${CFG_LOSS_THRESHOLD_PCT}%)"
        if [ "$quality_breach_counter" -ge "$CFG_QUALITY_CONSECUTIVE" ]; then
            qlog_warn "QUALITY → RECOVERY: ${CFG_QUALITY_CONSECUTIVE} consecutive breaches (avg ${q_avg_latency}ms / loss ${q_packet_loss}% vs ${CFG_LATENCY_THRESHOLD_MS}ms / ${CFG_LOSS_THRESHOLD_PCT}%)"
            append_event "watchcat_recovery" "Watchcat: connection quality degraded (latency ${q_avg_latency}ms / loss ${q_packet_loss}%) — starting recovery" "warning"
            quality_breach_counter=0
            recovery_reason="quality"

            # SSR-aware hold: if a recoverable baseband SSR is mid-flight, hold
            # the ladder this cycle rather than forcing a detach. Not the main
            # loop here — return from evaluate_quality so do_recovery is skipped;
            # the main loop's write_state + sleep proceed normally.
            if ssr_hold_gate; then
                state="ssr_hold"
                return 0
            fi

            state="recovery"
            if [ "$current_tier" -eq 0 ]; then
                find_next_tier 1
            fi
            do_recovery
            return 0
        fi
    else
        quality_breach_counter=0
    fi
    return 1
}

# --- SSR (baseband subsystem restart) awareness ---------------------------
# The RM551E periodically suffers RECOVERABLE Qualcomm MPSS baseband SSRs: the
# kernel logs "4080000.remoteproc-mss: fatal error received" then brings the
# remoteproc back up ~3-4s later, with the data path restored in ~10-25s. If
# watchcat fires its recovery ladder (forced AT+COPS / AT+CFUN detach) WHILE the
# baseband is mid-self-heal, it amplifies a ~30-60s self-healing outage into a
# multi-minute thrash. This gate detects an in-progress SSR and HOLDS the ladder
# for a grace window, only falling through to the normal ladder if connectivity
# does not return (the genuine stuck / AP-hang case).

# Best-effort read-only check of the kernel ring buffer for a RECENT MPSS crash.
# Returns 0 (true) if a fatal-error line exists AND it is within CFG_SSR_GRACE
# seconds of now; 1 (false) otherwise — including when dmesg yields nothing, the
# crash line was evicted, or the timestamp fails to parse (graceful degradation:
# absence of evidence is NOT evidence of absence; we never block recovery on it).
# dmesg timestamps are monotonic seconds-since-boot floats like "[ 12345.678901]"
# (BusyBox dmesg has no -T / -l); we parse integer seconds only and compare to
# /proc/uptime. Calls dmesg ONCE per invocation (only at an escalation decision).
ssr_in_progress() {
    [ "$CFG_SSR_AWARE" = "1" ] || return 1

    local crash_line
    local crash_ts
    local now

    crash_line=$(dmesg 2>/dev/null | grep "4080000.remoteproc-mss: fatal error received" | tail -n 1)
    [ -n "$crash_line" ] || return 1

    # Extract leading integer seconds from the dmesg monotonic timestamp. Real
    # lines on this kernel are double-bracketed: "[ 12345.678901][ T8033] msg"
    # (CONFIG_PRINTK_CALLER); the older single-bracket "[ 12345.678901] msg" also
    # works. sed (not awk -F) because BusyBox awk 1.36.1 rejects a bracket-class
    # field separator as an "Unknown collating element" — verified on-device.
    crash_ts=$(printf '%s' "$crash_line" | sed 's/^\[[ ]*\([0-9]*\)\..*/\1/')
    case "$crash_ts" in ''|*[!0-9]*) return 1 ;; esac

    now=$(cut -d. -f1 /proc/uptime 2>/dev/null)
    case "$now" in ''|*[!0-9]*) return 1 ;; esac

    local delta
    delta=$((now - crash_ts))
    [ "$delta" -ge 0 ] && [ "$delta" -le "$CFG_SSR_GRACE" ] && return 0
    return 1
}

# Decide whether to HOLD the recovery ladder this cycle. Returns 0 to HOLD
# (caller skips do_recovery and lets the modem self-heal), 1 to PROCEED to the
# normal ladder. Sits BELOW all existing guards (LOCKED, cooldown, revert) and
# only intercepts at the do_recovery initiation sites.
ssr_hold_gate() {
    local now
    local held

    # Already holding? Check whether the grace window expired.
    if [ "$ssr_hold" = "true" ]; then
        now=$(cut -d. -f1 /proc/uptime 2>/dev/null)
        case "$now" in ''|*[!0-9]*) now=0 ;; esac
        held=$((now - ssr_hold_started))
        if [ "$held" -ge "$CFG_SSR_GRACE" ]; then
            qlog_warn "SSR-hold grace (${CFG_SSR_GRACE}s) expired without recovery; releasing to ladder"
            ssr_hold="false"
            ssr_hold_started=0
            return 1   # fall through to the normal ladder (genuine stuck case)
        fi
        return 0       # keep holding
    fi

    # Not yet holding — start a hold only if an SSR is detectable right now.
    if ssr_in_progress; then
        now=$(cut -d. -f1 /proc/uptime 2>/dev/null)
        case "$now" in ''|*[!0-9]*) now=0 ;; esac
        ssr_hold="true"
        ssr_hold_started="$now"
        last_ssr_detected="$now"   # monotonic seconds; UI surfaces "self-recovery"
        qlog_warn "Recoverable baseband SSR detected; holding recovery ladder up to ${CFG_SSR_GRACE}s for self-heal"
        append_event "watchcat_recovery" "Watchcat: recoverable baseband restart detected — holding recovery to let the modem self-heal" "info"
        return 0
    fi
    return 1
}

# Clear an SSR hold on natural recovery (connectivity returned on its own — the
# expected happy path; we did nothing harmful). Idempotent.
ssr_hold_clear() {
    if [ "$ssr_hold" = "true" ]; then
        qlog_info "SSR-hold cleared: connectivity recovered naturally"
    fi
    ssr_hold="false"
    ssr_hold_started=0
}

WD_DETECT_LOADED=1
