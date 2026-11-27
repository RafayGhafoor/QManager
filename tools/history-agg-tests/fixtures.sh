#!/bin/sh
# fixtures.sh <outdir> - build every test case's archive tree (deterministic).
#
# One directory per case under <outdir>:
#   cell/ ping/ boot_log.jsonl state ring.json   the archive inputs
#   env                                           QM_NOW=... for the case
#
# Time anchor: NOW = 2026-11-27 07:01:00 UTC. Days: today 2026-11-27 (rows up to
# NOW), yesterday 2026-11-26 and 2026-11-25 (full, gzipped as the recorder leaves
# closed days).
out="$1"
[ -n "$out" ] || { echo "usage: fixtures.sh outdir" >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)
gen="$here/gen.sh"

NOW=1795761660
TODAY=1795737600
D1=1795651200
D2=1795564800
TODAY_N=400        # rows from 00:00 UTC to ~06:40
NAME_T=2026-11-27
NAME_1=2026-11-26
NAME_2=2026-11-25

mk() { mkdir -p "$out/$1/cell" "$out/$1/ping"; printf 'QM_NOW=%s\n' "${2:-$NOW}" > "$out/$1/env"; }
gz() { gzip -nf "$1"; }

# ---- v1_only: the pre-v3 archive ------------------------------------------
mk v1_only
sh "$gen" v1 $D1 1440 11 > "$out/v1_only/cell/$NAME_1.jsonl"; gz "$out/v1_only/cell/$NAME_1.jsonl"
sh "$gen" v1 $TODAY $TODAY_N 12 > "$out/v1_only/cell/$NAME_T.jsonl"

# ---- v2_full: v2 rows + L1 + ping archive + ring + boot log + recorder state ---
mk v2_full 1795761720
sh "$gen" v2 $D2 1440 20 1 > "$out/v2_full/cell/$NAME_2.jsonl"; gz "$out/v2_full/cell/$NAME_2.jsonl"
sh "$gen" v2 $D1 1440 21 1 > "$out/v2_full/cell/$NAME_1.jsonl"; gz "$out/v2_full/cell/$NAME_1.jsonl"
sh "$gen" v2 $TODAY 402 22 1 > "$out/v2_full/cell/$NAME_T.jsonl"
sh "$gen" ping $D1 1440 31 > "$out/v2_full/ping/$NAME_1.jsonl"
sh "$gen" ping $TODAY $TODAY_N 32 > "$out/v2_full/ping/$NAME_T.jsonl"
lastreal=$(awk -F, '/^\[/ { t = substr($1, 2) + 0 } END { print t }' "$out/v2_full/ping/$NAME_T.jsonl")
# a minute with no measured sample (recorder writes n=0): must be omitted
printf '[%d,0,0,null,null,null,null,null]\n' $((lastreal + 60)) >> "$out/v2_full/ping/$NAME_T.jsonl"
gz "$out/v2_full/ping/$NAME_1.jsonl"
last=$((lastreal + 60))
# ring: 10 s probes from 3 minutes before the last archive row up to NOW; one lost probe
awk -v from=$((last - 180)) -v to=$((1795761720 - 5)) 'BEGIN {
    for (t = from; t <= to; t += 10) {
        k++
        if (k % 7 == 0) printf "{\"ts\":%d,\"lat\":null,\"avg\":60.0,\"min\":40.0,\"max\":90.0,\"loss\":1,\"jit\":null}\n", t
        else printf "{\"ts\":%d,\"lat\":%d.5,\"avg\":60.0,\"min\":40.0,\"max\":90.0,\"loss\":0,\"jit\":%d.2}\n", t, 50 + k % 9, 3 + k % 5
    }
}' > "$out/v2_full/ring.json"
printf '%s\n' "$last" > "$out/v2_full/last_ping_ts"
cat > "$out/v2_full/boot_log.jsonl" <<BOOT
{"boot_ts":$((NOW - 100000)),"last_alive_ts":$((NOW - 100090)),"down_sec":90,"cause":"restart"}
{"boot_ts":$((NOW - 40000)),"last_alive_ts":$((NOW - 41500)),"down_sec":1500,"cause":"power_loss"}
{"boot_ts":$((NOW - 3000)),"last_alive_ts":null,"down_sec":null,"cause":"unknown"}
{"boot_ts":$((NOW - 2000)),"last_alive_ts":$((NOW - 2050)),"down_sec":50,"cause":"plan
BOOT
cat > "$out/v2_full/state" <<STATE
state=ok
free_kb=9000
archive_kb=999
checked=1795761720
STATE

# ---- mixed: v1 rows then v2 rows inside ONE day file --------------------------
mk mixed
sh "$gen" v1 $D1 1440 41 > "$out/mixed/cell/$NAME_1.jsonl"; gz "$out/mixed/cell/$NAME_1.jsonl"
{
    sh "$gen" v1 $TODAY 150 42
    sh "$gen" v2 $((TODAY + 150 * 60)) 250 43 1
} > "$out/mixed/cell/$NAME_T.jsonl"

# ---- torn: the recorder was killed mid-write ----------------------------------
mk torn
sh "$gen" v2 $D1 1440 51 1 > "$out/torn/cell/$NAME_1.jsonl"; gz "$out/torn/cell/$NAME_1.jsonl"
{
    sh "$gen" v2 $TODAY $TODAY_N 52 1
    printf '[2,%d,"NSA",1,"a",48466199,55383,null,null,1,1,60,11,6.0,19.4,1,19,24.5,3,14,9,127' $((NOW - 20))
} > "$out/torn/cell/$NAME_T.jsonl"

# ---- gz_wins: a day present both as .jsonl and .jsonl.gz (compression in flight)
mk gz_wins
sh "$gen" v2 $D2 1440 61 1 > "$out/gz_wins/cell/$NAME_2.jsonl"; gz "$out/gz_wins/cell/$NAME_2.jsonl"
# the plain file must be ignored: its rows are in a different place and would show
awk 'BEGIN { for (i = 0; i < 5; i++) printf "[2,%d,\"LTE\",0,\"a\",1,1,null,null,0,0,20,5,1.0,null,null,null,null,null,null,null,null,null,null,null,null,null,40,20,30,null,null,null,null,null,null,null,null,[\"P\",\"L\",20,6300,20,999,-70,-10,10,-40]]\n", 1795564800 + 600 + i * 60 }' > "$out/gz_wins/cell/$NAME_2.jsonl"
sh "$gen" v2 $D1 1440 62 1 > "$out/gz_wins/cell/$NAME_1.jsonl"; gz "$out/gz_wins/cell/$NAME_1.jsonl"
sh "$gen" v2 $TODAY $TODAY_N 63 1 > "$out/gz_wins/cell/$NAME_T.jsonl"

# ---- empty: no archive at all --------------------------------------------------
mk empty

# ---- stale / low_space: the recorder stopped two hours ago ---------------------
mk stale
sh "$gen" v2 $D1 1440 71 1 > "$out/stale/cell/$NAME_1.jsonl"; gz "$out/stale/cell/$NAME_1.jsonl"
sh "$gen" v2 $TODAY 280 72 1 > "$out/stale/cell/$NAME_T.jsonl"
mk low_space
cp "$out/stale/cell/"* "$out/low_space/cell/"
cat > "$out/low_space/state" <<STATE
state=low_space
free_kb=1200
archive_kb=2100
checked=$NOW
STATE

# ---- clock_unset: no NITZ/NTP yet ----------------------------------------------
mk clock_unset 1000
sh "$gen" v2 $D1 100 81 1 > "$out/clock_unset/cell/$NAME_1.jsonl"
