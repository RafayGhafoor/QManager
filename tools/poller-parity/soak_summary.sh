#!/bin/sh
# soak_summary.sh [dir=/usrdata/b529_mon]: summarise a soakd.sh run (dev-only,
# BusyBox ash + awk). Reads soak.log.1 then soak.log; safe to run while the
# soak is going (progress view). soakd.sh writes its output to summary.txt at
# the end.
#
# Each window is put in the tier it spent most samples in. Gates (B5.29,
# poller-on-broker.md Section 14): active cpu <= 10 %, idle/deep ~2 %, status
# period 2.0 s +- 0.2 (window average), mono age < 3 s.

DIR=${1:-/usrdata/b529_mon}
FILES=""
[ -f "$DIR/soak.log.1" ] && FILES="$DIR/soak.log.1"
[ -f "$DIR/soak.log" ] && FILES="$FILES $DIR/soak.log"
[ -n "$FILES" ] || { echo "soak_summary: no soak.log in $DIR"; exit 1; }

state=""
[ -f "$DIR/state" ] && state=$(tr '\n' ' ' < "$DIR/state")

# done = the run logged its "# end" line (soakd.sh writes it before this runs).
# shellcheck disable=SC2086
awk -v state="$state" '
BEGIN { done_mark = "no" }
/^# end/ { done_mark = "yes" }
/^# boot/ { boots++ }
/^# skip/ { skips++ }
/^# resume/ { resumes++ }
/^ts=/ {
    split("", v)
    for (i = 1; i <= NF; i++) {
        p = index($i, "=")
        if (p) v[substr($i, 1, p - 1)] = substr($i, p + 1)
    }
    nt = split(v["tiers"], t, ",")
    best = "other"; bn = -1
    for (j = 1; j <= nt; j++) {
        split(t[j], kv, ":")
        if (kv[2] + 0 > bn) { bn = kv[2] + 0; best = kv[1] }
    }
    k = best
    n[k]++; w++
    c = v["cpu_pct_core"] + 0; cpu[k] += c; if (c > cpumax[k]) cpumax[k] = c
    pa = v["status_period_avg"] + 0; per[k] += pa
    pm = v["max"] + 0; if (pm > pmax[k]) pmax[k] = pm
    ma = v["mono_age_max"] + 0; if (ma > mage[k]) mage[k] = ma
    f = v["forks_per_s"] + 0; fps[k] += f
    if (ma >= 3) bad_age++
    if (pa < 1.8 || pa > 2.2) bad_per++
    if (pm > 4.5) bad_stall++
    if (first == "") first = v["ts"]; last = v["ts"]
    ssr = v["ssr_total"] + 0
    lf += v["log_fail"]; lb += v["log_busy"]; lu += v["log_unreach"]
    lr += v["log_restart"]; ls += v["log_ssr"]
    a = v["at_ms"] + 0; if (a > atmax) atmax = a
}
END {
    printf "B5.29 soak summary  done=%s  windows=%d  boots=%d  resumes=%d  skipped=%d\n", done_mark, w, boots, resumes, skips
    if (first != "") printf "span: ts %s .. %s (%.1f h wall clock)\n", first, last, (last - first) / 3600.0
    printf "state: %s\n", state
    printf "%-6s %4s %8s %8s %9s %10s %9s %9s\n", "tier", "n", "cpu_avg", "cpu_max", "period", "period_max", "mono_max", "forks/s"
    split("active idle deep other", order, " ")
    for (o = 1; o <= 4; o++) {
        k = order[o]
        if (!(k in n)) continue
        printf "%-6s %4d %7.2f%% %7.2f%% %8.2fs %9.2fs %8ds %9.2f\n", k, n[k], cpu[k] / n[k], cpumax[k], per[k] / n[k], pmax[k], mage[k], fps[k] / n[k]
    }
    printf "gate breaches (windows): mono_age>=3s=%d  period_avg outside 1.8-2.2s=%d  any period>4.5s=%d\n", bad_age, bad_per, bad_stall
    printf "baseband crashes during soak: %d   max qcmd AT round trip: %d ms\n", ssr, atmax
    printf "log lines: fail=%d busy=%d unreachable=%d poller_restarts=%d channel_reset/airplane=%d\n", lf, lb, lu, lr, ls
}' $FILES
