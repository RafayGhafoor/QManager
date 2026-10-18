#!/bin/sh
# measure.sh [seconds=60]
# On-device poller cost sampler (BusyBox ash; mostly builtins). Prints ONE line:
#
#  window=60s ticks=N cpu_pct_core=X forks_per_s=Y status_period_avg=Z min=.. max=..
#  mono_age_max=.. tiers=active:n,idle:n,deep:n [extras: samples, own_forks, hb_age_*, ...]
#
# ticks         utime+stime+cutime+cstime delta of the poller (/proc/<pid>/stat
#               fields 14-17), CLK_TCK=100.
# cpu_pct_core  ticks / window, as percent of one core.
# forks_per_s   system-wide new processes/s (/proc/stat "processes" delta) MINUS
#               the sampler's own forks. The sampler forks once per 0.25 s tick
#               (sleep) and once per 10 s (date +%s); everything else is a
#               builtin. own_forks is printed; assumes 1 fork per external command.
# status_period seconds between consecutive changes of the integer ".mono" in
#               /tmp/qmanager_status.json (resolution 0.25 s; .mono is whole
#               seconds, so a sub-second write cadence reads as ~1 s). mono is
#               line 3 of the pretty-printed file and is read with builtins.
# mono_age_max  max over samples of (/proc/uptime seconds - .mono).
# tiers         .network.poller_tier sampled every 10 s (counts of samples).
# hb_age        now - epoch in /tmp/qmanager_ui_active, every 10 s (-1 if absent).

WIN=${1:-60}
case "$WIN" in ''|*[!0-9]*) echo "usage: measure.sh [seconds]" >&2; exit 2 ;; esac
STATUS=/tmp/qmanager_status.json
HB=/tmp/qmanager_ui_active

PID=$(pidof qmanager_poller 2>/dev/null)
PID=${PID%% *}
if [ -z "$PID" ]; then
    PID=$(ps 2>/dev/null | grep '[q]manager_poller' | head -1 | awk '{print $1}')
fi
[ -n "$PID" ] && [ -r "/proc/$PID/stat" ] || { echo "measure: qmanager_poller not found" >&2; exit 1; }

own=0

# read_ticks -> sets TICKS (sum of fields 14-17)
read_ticks() {
    read -r PSTAT < "/proc/$PID/stat" || return 1
    PREST=${PSTAT##*) }                # drops "pid (comm) "; first field left is field 3
    set -- $PREST                      # ${1}=field3 ... ${12}=utime(14) ${13} ${14} ${15}=cstime(17)
    TICKS=$((${12} + ${13} + ${14} + ${15}))
}

# read_forks -> sets FORKS (cumulative "processes" from /proc/stat)
read_forks() {
    FORKS=""
    while read -r K V REST; do
        if [ "$K" = "processes" ]; then FORKS=$V; break; fi
    done < /proc/stat
}

# read_cs -> sets CS (uptime in centiseconds) and UPI (whole seconds)
read_cs() {
    read -r UP _ < /proc/uptime
    UPI=${UP%.*}
    FR=${UP#*.}
    FR=${FR%"${FR#??}"}                # first two fraction digits
    FRN=${FR#0}
    CS=$((UPI * 100 + ${FRN:-0}))
}

# read_mono -> sets MONO (integer or empty): line 3 of the pretty-printed JSON
read_mono() {
    MONO=""
    { read -r _a; read -r _b; read -r _c; } 2>/dev/null < "$STATUS" || return 1
    _c=${_c#*:}
    _c=${_c%,*}
    MONO=${_c# }
    case "$MONO" in ''|*[!0-9]*) MONO="" ;; esac
}

# read_tier -> sets TIER (poller_tier) with builtins only
read_tier() {
    TIER=""
    while read -r _l; do
        case "$_l" in
            *'"poller_tier"'*)
                _l=${_l#*:}; _l=${_l#* \"}; TIER=${_l%%\"*}
                break
                ;;
        esac
    done 2>/dev/null < "$STATUS"
}

read_ticks || exit 1
T0=$TICKS
read_forks; F0=$FORKS
read_cs; CS0=$CS
END_CS=$((CS0 + WIN * 100))

last_mono=""
last_change_cs=""
n_changes=0
per_sum=0
per_min=""
per_max=0
mono_age_max=0
samples=0
n_active=0; n_idle=0; n_deep=0; n_other=0
next_hb=$CS0
hb_max=-1; hb_min=""; hb_n=0
sleeps=0

while :; do
    read_cs
    [ "$CS" -ge "$END_CS" ] && break
    samples=$((samples + 1))

    if read_mono && [ -n "$MONO" ]; then
        age=$((UPI - MONO))
        [ "$age" -gt "$mono_age_max" ] && mono_age_max=$age
        if [ -n "$last_mono" ] && [ "$MONO" != "$last_mono" ]; then
            if [ -n "$last_change_cs" ]; then
                per=$((CS - last_change_cs))          # centiseconds
                per_sum=$((per_sum + per))
                n_changes=$((n_changes + 1))
                if [ -z "$per_min" ] || [ "$per" -lt "$per_min" ]; then per_min=$per; fi
                [ "$per" -gt "$per_max" ] && per_max=$per
            fi
            last_change_cs=$CS
        fi
        last_mono=$MONO
    fi

    if [ "$CS" -ge "$next_hb" ]; then
        next_hb=$((next_hb + 1000))
        read_tier
        case "$TIER" in
            active) n_active=$((n_active + 1)) ;;
            idle)   n_idle=$((n_idle + 1)) ;;
            deep)   n_deep=$((n_deep + 1)) ;;
            *)      n_other=$((n_other + 1)) ;;
        esac
        hbv=""
        read -r hbv < "$HB" 2>/dev/null
        case "$hbv" in
            ''|*[!0-9]*) ;;
            *)
                now=$(date +%s); own=$((own + 1))
                hb_age=$((now - hbv))
                hb_n=$((hb_n + 1))
                [ "$hb_age" -gt "$hb_max" ] && hb_max=$hb_age
                if [ -z "$hb_min" ] || [ "$hb_age" -lt "$hb_min" ]; then hb_min=$hb_age; fi
                ;;
        esac
    fi

    sleep 0.25
    sleeps=$((sleeps + 1)); own=$((own + 1))
done

read_ticks
T1=$TICKS
read_forks; F1=$FORKS
read_cs; CS1=$CS

el=$((CS1 - CS0))                       # centiseconds actually elapsed
dticks=$((T1 - T0))
dforks=$((F1 - F0 - own))
[ "$n_changes" -gt 0 ] && per_avg_cs=$((per_sum / n_changes)) || per_avg_cs=0

awk -v win="$WIN" -v el="$el" -v t="$dticks" -v f="$dforks" -v own="$own" \
    -v pa="$per_avg_cs" -v pmin="${per_min:-0}" -v pmax="$per_max" -v nch="$n_changes" \
    -v mage="$mono_age_max" -v na="$n_active" -v ni="$n_idle" -v nd="$n_deep" -v no="$n_other" \
    -v smp="$samples" -v hbn="$hb_n" -v hbmax="$hb_max" -v hbmin="${hb_min:--1}" \
    'BEGIN {
        s = el / 100.0; if (s <= 0) s = win
        printf "window=%ds ticks=%d cpu_pct_core=%.2f forks_per_s=%.2f ", win, t, t / s, f / s
        printf "status_period_avg=%.2f min=%.2f max=%.2f mono_age_max=%d ", pa / 100.0, pmin / 100.0, pmax / 100.0, mage
        printf "tiers=active:%d,idle:%d,deep:%d", na, ni, nd
        if (no > 0) printf ",other:%d", no
        printf " changes=%d samples=%d own_forks=%d elapsed=%.2fs hb_age_min=%d hb_age_max=%d hb_n=%d\n", nch, smp, own, s, hbmin, hbmax, hbn
    }'
