#!/bin/sh
# data-used-test.sh — dev-only test of scripts/usr/lib/qmanager/data_used.sh
# under the device's BusyBox sh. Fakes sysfs, boot_id and the state dirs in a
# scratch dir; never touches the live poller's files.
#   usage: sh data-used-test.sh /path/to/data_used.sh
LIB="${1:?path to data_used.sh}"
T="${TMPDIR:-/tmp}/du_test.$$"
rm -rf "$T"
mkdir -p "$T/sys/rmnet_ipa0/statistics" "$T/run" "$T/state"
trap 'rm -rf "$T"' EXIT

qlog_info() { :; }
qlog_warn() { :; }
DU_SYS_DIR="$T/sys"
DU_BOOT_ID_FILE="$T/boot_id"
DU_STATE_DIR="$T/state"
DU_RUN_DIR="$T/run"
DU_SAMPLE_EVERY=1
DU_FLUSH_EVERY=1
_NOW=1792420000

fails=0
setc() { echo "$1" > "$T/sys/rmnet_ipa0/statistics/rx_bytes"; echo "$2" > "$T/sys/rmnet_ipa0/statistics/tx_bytes"; }
val() { jq -r ".$1" "$T/$2/data_used.json"; }
check() { # name expected actual
    if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: want $2 got $3"; fails=$((fails + 1)); fi
}
# Run a fresh poller "process": a subshell that loads the lib, inits, ticks N.
run() { # ticks
    (
        unset _QM_DATA_USED_LOADED
        . "$LIB"
        du_init
        i=0
        while [ "$i" -lt "$1" ]; do du_tick; i=$((i + 1)); done
        du_flush
    )
}

echo "b-1" > "$T/boot_id"
# 1. fresh install: baseline only
setc 5000 700
run 0
check "fresh baseline rx" 0 "$(val rx_bytes state)"
check "fresh since" 1792420000 "$(val since state)"
# 2. normal deltas within the same boot (poller restart)
setc 6000 900
run 1
check "delta rx" 1000 "$(val rx_bytes state)"
check "delta tx" 200 "$(val tx_bytes state)"
check "mirror rx" 1000 "$(val rx_bytes run)"
# 3. netdev restarted (PDN drop): counter below prev -> add cur
setc 300 50
run 1
check "restart rx" 1300 "$(val rx_bytes state)"
check "restart tx" 250 "$(val tx_bytes state)"
check "restart count" 1 "$(val iface_resets state)"
# 4. reboot: new boot_id, counter (since boot) above prev -> still add cur
echo "b-2" > "$T/boot_id"
setc 9000 1000
run 0
check "reboot rx" 10300 "$(val rx_bytes state)"
check "reboot tx" 1250 "$(val tx_bytes state)"
# 5. netdev absent: state kept, iface_present false
rm -f "$T/sys/rmnet_ipa0/statistics/rx_bytes"
run 1
check "absent rx kept" 10300 "$(val rx_bytes state)"
check "absent flag" false "$(val iface_present run)"
# 6. garbage read: skipped
echo "abc" > "$T/sys/rmnet_ipa0/statistics/rx_bytes"
run 1
check "garbage rx kept" 10300 "$(val rx_bytes state)"
# 7. back with growth
setc 9500 1100
run 1
check "back rx" 10800 "$(val rx_bytes state)"
# 8. user reset: zero, re-baseline, flag consumed
: > "$T/run/data_used_reset"
setc 9600 1200
_NOW=1792430000
run 1
check "reset rx" 0 "$(val rx_bytes state)"
check "reset since" 1792430000 "$(val since state)"
check "reset flag gone" no "$([ -e "$T/run/data_used_reset" ] && echo yes || echo no)"
setc 9700 1250
run 1
check "post-reset rx" 100 "$(val rx_bytes state)"
check "post-reset tx" 50 "$(val tx_bytes state)"
# 9. 1970 clock: since stored as 0 on reset
: > "$T/run/data_used_reset"
_NOW=5
run 1
check "1970 since" 0 "$(val since state)"
# 10. corrupt state file: start from zero
echo '{"schema":1,"rx_bytes":"x"}' > "$T/state/data_used.json"
_NOW=1792440000
setc 10000 2000
run 0
check "corrupt rx" 0 "$(val rx_bytes state)"
check "corrupt baseline" 10000 "$(val prev_rx state)"
# 11. large values (64-bit)
setc 9000000000000 2000
run 1
check "64-bit rx" 8999999990000 "$(val rx_bytes state)"
# 12. flush cadence: sample every 1, flush every 3 -> file lags the mirror
DU_FLUSH_EVERY=3
setc 9000000000100 2000
( unset _QM_DATA_USED_LOADED; . "$LIB"; du_init; setc 9000000000200 2000; du_tick; \
  echo "$(jq -r .rx_bytes "$T/run/data_used.json") $(jq -r .rx_bytes "$T/state/data_used.json")" > "$T/r" )
check "flush lag" "8999999990200 8999999990100" "$(cat "$T/r")"

echo "fails=$fails"
[ "$fails" -eq 0 ]
