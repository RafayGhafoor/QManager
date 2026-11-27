#!/bin/sh
# t_store.sh - hs_maintain: expire, gzip one closed day, cap, floor, state file.
HT_NAME="t_store"
. "${HT_HERE:-$(cd "$(dirname "$0")" && pwd)}/lib.sh"
. "$HT_LIB/history_store.sh"

NOW=$(ht_epoch 2026-11-27 12:00:00)
D="$HT_TMP/store"
ST="$HT_TMP/store_state"

mkrow() { # file rows
    _i=0
    while [ "$_i" -lt "$2" ]; do
        printf '[2,%s,"LTE",0,"a",1,2,null,null,0,0,10,11,12.0,5,1,19,null,null,null,null,null,null,null,null,null,null,null,45,30,40,-85,-125,-118,-74,null,null,null,null,["P","L",1,250,10,104,-75,-10,6,-47]]\n' "$_i"
        _i=$((_i + 1))
    done > "$1"
}
fresh() { rm -rf "$D" "$ST"; mkdir -p "$D"; }
sz() { ls -ln "$1" 2>/dev/null | awk '{ print $5 }'; }
nfiles() { ls "$D" 2>/dev/null | wc -l | tr -d ' '; }
state_get() { sed -n "s/^$1=//p" "$ST"; }

# --- expire -------------------------------------------------------------------
fresh
for d in 2026-11-20 2026-11-23 2026-11-24 2026-11-26 2026-11-27; do mkrow "$D/$d.jsonl" 20; done
HS_NOW="$NOW"
hs_maintain "$D" 3 100000 0 "$ST"; rc=$?
eq "expire rc" "$rc" 0
no "11-20 expired" test -e "$D/2026-11-20.jsonl"
no "11-23 expired" test -e "$D/2026-11-23.jsonl"
yes "11-24 kept (cutoff day itself)" test -e "$D/2026-11-24.jsonl.gz" -o -e "$D/2026-11-24.jsonl"

# --- gzip one closed day per call, oldest first, today untouched ---------------
eq "first pass compressed the oldest closed day" "$(test -f "$D/2026-11-24.jsonl.gz" && echo y)" y
yes "second closed day still plain" test -f "$D/2026-11-26.jsonl"
yes "today untouched" test -f "$D/2026-11-27.jsonl"
eq "pending flag set while a closed day waits" "$HS_PENDING" 1
eq "gz round trip" "$(gzip -dc < "$D/2026-11-24.jsonl.gz" | wc -l | tr -d ' ')" 20
hs_maintain "$D" 3 100000 0 "$ST"
yes "second pass compressed 11-26" test -f "$D/2026-11-26.jsonl.gz"
no "11-26 plain removed" test -e "$D/2026-11-26.jsonl"
eq "no pending once all closed days are compressed" "$HS_PENDING" 0
yes "today still plain" test -f "$D/2026-11-27.jsonl"
no "no tmp debris" test -e "$D/2026-11-26.jsonl.gz.tmp"

# --- state file ---------------------------------------------------------------
eq "state ok" "$(state_get state)" ok
case "$(state_get free_kb)" in ''|*[!0-9]*) ht_bad "free_kb numeric" "$(state_get free_kb)" ;; *) ht_ok ;; esac
case "$(state_get archive_kb)" in ''|*[!0-9]*) ht_bad "archive_kb numeric" ;; *) ht_ok ;; esac
eq "checked = now" "$(state_get checked)" "$NOW"
eq "state has four lines" "$(wc -l < "$ST" | tr -d ' ')" 4

# --- floor --------------------------------------------------------------------
hs_maintain "$D" 3 100000 999999999 "$ST"; rc=$?
eq "floor above free -> refused" "$rc" 1
eq "state low_space" "$(state_get state)" low_space
hs_maintain "$D" 3 100000 0 "$ST"; rc=$?
eq "no latch: allowed again as soon as the floor allows" "$rc" 0
eq "state back to ok" "$(state_get state)" ok

# --- cap: oldest first, never today -------------------------------------------
fresh
for d in 2026-11-22 2026-11-23 2026-11-24; do mkrow "$D/$d.jsonl" 3000; done
mkrow "$D/2026-11-27.jsonl" 3000
HS_NOW="$NOW"
big=$(sz "$D/2026-11-27.jsonl")
hs_maintain "$D" 30 1 0 "$ST"
no "oldest evicted first" test -e "$D/2026-11-22.jsonl"
no "next oldest evicted" test -e "$D/2026-11-23.jsonl"
no "11-24 evicted (gz or plain)" test -e "$D/2026-11-24.jsonl.gz" -a -e "$D/2026-11-24.jsonl"
yes "today never deleted, even over the cap" test -f "$D/2026-11-27.jsonl"
eq "today's bytes intact" "$(sz "$D/2026-11-27.jsonl")" "$big"
# cap large enough: nothing evicted
fresh
for d in 2026-11-24 2026-11-26; do mkrow "$D/$d.jsonl" 10; done
mkrow "$D/2026-11-27.jsonl" 10
hs_maintain "$D" 30 100000 0 "$ST"
yes "within cap nothing evicted" test -f "$D/2026-11-24.jsonl.gz" -o -f "$D/2026-11-24.jsonl"
yes "within cap 11-26 present" test -f "$D/2026-11-26.jsonl.gz" -o -f "$D/2026-11-26.jsonl"

# --- gzip failure leaves the original ------------------------------------------
fresh
mkdir -p "$HT_TMP/fakebin"
printf '#!/bin/sh\nexit 1\n' > "$HT_TMP/fakebin/gzip"; chmod +x "$HT_TMP/fakebin/gzip"
mkrow "$D/2026-11-25.jsonl" 10
mkrow "$D/2026-11-27.jsonl" 10
before=$(sz "$D/2026-11-25.jsonl")
OLDPATH="$PATH"; PATH="$HT_TMP/fakebin:$PATH"
hs_maintain "$D" 30 100000 0 "$ST"; rc=$?
PATH="$OLDPATH"
eq "failed gzip: still allowed" "$rc" 0
yes "failed gzip: original kept" test -f "$D/2026-11-25.jsonl"
eq "failed gzip: original unchanged" "$(sz "$D/2026-11-25.jsonl")" "$before"
no "failed gzip: no .gz" test -e "$D/2026-11-25.jsonl.gz"
no "failed gzip: no tmp debris" test -e "$D/2026-11-25.jsonl.gz.tmp"
eq "failed gzip: pending so it is retried" "$HS_PENDING" 1

# --- crash between mv and rm: a valid .gz beside the plain file ----------------
fresh
mkrow "$D/2026-11-25.jsonl" 10
gzip -c "$D/2026-11-25.jsonl" > "$D/2026-11-25.jsonl.gz"
mkrow "$D/2026-11-27.jsonl" 5
hs_maintain "$D" 30 100000 0 "$ST"
no "leftover plain file removed once its .gz verifies" test -e "$D/2026-11-25.jsonl"
yes ".gz kept" test -f "$D/2026-11-25.jsonl.gz"
# a truncated .gz is NOT trusted
fresh
mkrow "$D/2026-11-25.jsonl" 10
printf 'junk' > "$D/2026-11-25.jsonl.gz"
mkrow "$D/2026-11-27.jsonl" 5
hs_maintain "$D" 30 100000 0 "$ST"
eq "corrupt .gz replaced by a good one" "$(gzip -dc < "$D/2026-11-25.jsonl.gz" 2>/dev/null | wc -l | tr -d ' ')" 10

# --- stale tmp debris, foreign names, v1 rows ---------------------------------
fresh
printf '{"ts":1,"rat":"LTE"}\n' > "$D/2026-11-25.jsonl"
printf 'x' > "$D/2026-11-24.jsonl.gz.tmp"
printf 'keep' > "$D/notes.txt"
mkrow "$D/2026-11-27.jsonl" 3
hs_maintain "$D" 30 100000 0 "$ST"
no "stale .gz.tmp removed" test -e "$D/2026-11-24.jsonl.gz.tmp"
yes "foreign file untouched" test -f "$D/notes.txt"
eq "v1 day compressed and intact" "$(gzip -dc < "$D/2026-11-25.jsonl.gz")" '{"ts":1,"rat":"LTE"}'

# --- missing directory is created; default state-file name ---------------------
rm -rf "$HT_TMP/newdir"
HS_NOW="$NOW"
hs_maintain "$HT_TMP/newdir/cell_history" 30 3072 0 "$ST"
yes "directory created" test -d "$HT_TMP/newdir/cell_history"
rm -rf "$HT_TMP/newdir" "$D" "$ST"

ht_done
