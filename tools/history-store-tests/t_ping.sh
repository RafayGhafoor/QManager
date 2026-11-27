#!/bin/sh
# t_ping.sh - ping-minute archive rows and the boot log.
HT_NAME="t_ping"
. "${HT_HERE:-$(cd "$(dirname "$0")" && pwd)}/lib.sh"
ht_stubs
. "$HT_LIB/history_store.sh"
. "$HT_LIB/l1_stats.sh"
ht_load_poller_fns

B="$HT_TMP/ping"
PING_ARCHIVE_DIR="$B/ping_history"
PING_ARCHIVE_STATE="$B/state"
BOOT_LOG_FILE="$B/boot_log.jsonl"
BOOT_LOG_MARK="$B/boot_mark"
CRASH_LOG_FILE="$B/crash.log"
CLOCK_SYNC_MARK="$B/clock_synced"
CLOCK_NTP_STATE="$B/dnsmasqsec"
mono_now_set() { _MONO="${HT_UPTIME:-0}"; }
fresh() {
    rm -rf "$B"; mkdir -p "$B"
    : > "$CLOCK_SYNC_MARK"; _MONO_TOP=""; _bl_start_done=0; _BL_START_LA=""
    _pg_reset; _pg_min=0; _pg_maint_day=""; _pg_next_maint=0; _pg_allowed=1; _pg_dir_ok=0
    conn_internet_available=true; conn_latency=null
    rm -f /tmp/qmanager_ping_attaching
}
tick() { # tick <now> <latency|null> [internet]
    _NOW="$1"; conn_latency="$2"; conn_internet_available="${3:-true}"
    ping_minute_tick
}
M0=$(ht_epoch 2026-11-27 12:00:00)

# --- one minute of six 10 s samples -------------------------------------------------
fresh
tick $((M0 + 3))  20.0
tick $((M0 + 13)) 25.5
tick $((M0 + 23)) null
tick $((M0 + 33)) 22.5
tick $((M0 + 43)) 10
tick $((M0 + 53)) 30.0
no "row not written before the minute closes" test -e "$PING_ARCHIVE_DIR/2026-11-27.jsonl"
tick $((M0 + 63)) 12.0
F="$PING_ARCHIVE_DIR/2026-11-27.jsonl"
yes "row written on rollover" test -f "$F"
# answered: 20.0 25.5 22.5 10 30.0 -> n=6 ok=5 avg=21.6 (108/5) min=10.0 max=30.0
# jitter: |25.5-20|=5.5 |22.5-25.5|=3 |10-22.5|=12.5 |30-10|=20 -> 41/4 = 10.25 -> 10.3
eq "row values" "$(cat "$F")" "[$M0,6,5,21.6,10.0,30.0,10.3,17]"
eq "ts is the minute start" "$(awk -F, '{ print $1 }' "$F" | tr -d '[')" "$M0"
eq "state file written by the first pass" "$(sed -n 's/^state=//p' "$PING_ARCHIVE_STATE")" ok

# --- all lost: avg/min/max/jit null, loss 100 ---------------------------------------
fresh
tick $((M0 + 5)) null false; tick $((M0 + 15)) null false; tick $((M0 + 25)) null false
tick $((M0 + 65)) null false
eq "100% loss" "$(cat "$PING_ARCHIVE_DIR/2026-11-27.jsonl")" "[$M0,3,0,null,null,null,null,100]"

# --- unmeasured (stale ping cache) is not loss, but the heartbeat row is still written -
fresh
tick $((M0 + 5)) null null; tick $((M0 + 15)) null null
tick $((M0 + 65)) null null
eq "unmeasured minute: heartbeat row, n 0, loss null" "$(cat "$PING_ARCHIVE_DIR/2026-11-27.jsonl")" "[$M0,0,0,null,null,null,null,null]"

# --- one answered probe: jitter null; zero-padded and dotless RTTs -------------------
fresh
tick $((M0 + 5)) 07.25 ; tick $((M0 + 15)) null
tick $((M0 + 65)) 1
eq "single answer: jitter null, loss 50" "$(cat "$PING_ARCHIVE_DIR/2026-11-27.jsonl")" "[$M0,2,1,7.2,7.2,7.2,null,50]"
fresh
tick $((M0 + 5)) .5; tick $((M0 + 65)) 1
eq "RTT .5 ms parses" "$(cat "$PING_ARCHIVE_DIR/2026-11-27.jsonl")" "[$M0,1,1,0.5,0.5,0.5,null,0]"
fresh
tick $((M0 + 5)) "1e3"; tick $((M0 + 15)) "12.3.4"; tick $((M0 + 65)) 1
eq "non-numeric RTTs count as unanswered" "$(cat "$PING_ARCHIVE_DIR/2026-11-27.jsonl")" "[$M0,2,0,null,null,null,null,100]"

# --- attach warm-up samples are skipped ----------------------------------------------
fresh
: > /tmp/qmanager_ping_attaching
tick $((M0 + 5)) 20 true; tick $((M0 + 65)) 1
rm -f /tmp/qmanager_ping_attaching
eq "attaching: sample not counted" "$(cat "$PING_ARCHIVE_DIR/2026-11-27.jsonl")" "[$M0,0,0,null,null,null,null,null]"

# --- a minute skipped entirely (no ticks) writes nothing; clock not set writes nothing --
fresh
tick $((M0 + 5)) 20; tick $((M0 + 305)) 20
eq "gap of minutes: only the minute that had ticks" "$(wc -l < "$PING_ARCHIVE_DIR/2026-11-27.jsonl" | tr -d ' ')" 1
fresh
tick 1000 20; tick 1070 20
no "1970 clock: nothing written" test -e "$PING_ARCHIVE_DIR"

# --- midnight: the closing minute stays in the OLD day file; rotation compresses it ---
fresh
D1=$(ht_epoch 2026-11-27 23:59:00)
tick $((D1 + 5)) 20
tick $((D1 + 65)) 20
yes "23:59 row in the 11-27 file" test -f "$PING_ARCHIVE_DIR/2026-11-27.jsonl.gz" -o -f "$PING_ARCHIVE_DIR/2026-11-27.jsonl"
eq "23:59 row content intact (plain or gz)" "$( { cat "$PING_ARCHIVE_DIR/2026-11-27.jsonl" 2>/dev/null || gzip -dc < "$PING_ARCHIVE_DIR/2026-11-27.jsonl.gz"; } | tr -d '\n')" "[$D1,1,1,20.0,20.0,20.0,null,0]"
tick $((D1 + 125)) 20
yes "the 11-27 file is compressed at rotation" test -f "$PING_ARCHIVE_DIR/2026-11-27.jsonl.gz"
no "no plain 11-27 file is recreated" test -e "$PING_ARCHIVE_DIR/2026-11-27.jsonl"
yes "00:00 row went to the 11-28 file" test -f "$PING_ARCHIVE_DIR/2026-11-28.jsonl"

# --- refused when low on space, written again once it recovers -----------------------
fresh
PING_ARCHIVE_MIN_FREE_KB=999999999
tick $((M0 + 5)) 20; tick $((M0 + 65)) 20
no "below floor: no row" test -e "$PING_ARCHIVE_DIR/2026-11-27.jsonl"
eq "below floor: low_space" "$(sed -n 's/^state=//p' "$PING_ARCHIVE_STATE")" low_space
PING_ARCHIVE_MIN_FREE_KB=0
tick $((M0 + 125)) 20
no "inside the retry hour: still refused" test -e "$PING_ARCHIVE_DIR/2026-11-27.jsonl"
tick $((M0 + 3700)) 20; tick $((M0 + 3760)) 20
yes "after the hour the archive writes again" test -f "$PING_ARCHIVE_DIR/2026-11-27.jsonl"
PING_ARCHIVE_MIN_FREE_KB=4096

# =================================== boot log ===========================================
bl_fresh() { fresh; mkdir -p "$PING_ARCHIVE_DIR"; rm -f "$BOOT_LOG_FILE" "$BOOT_LOG_MARK" "$CRASH_LOG_FILE"; _bl_done=0; }
BOOT=$(ht_epoch 2026-11-27 08:00:00)
mkdir -p "$PING_ARCHIVE_DIR"
# The poller reads the archive's newest heartbeat ONCE, at start, before it writes
# a row of its own (boot_log_prime); here that is the first bl_run after bl_fresh,
# bounded at boot_ts like a respawn with a trusted clock.
bl_run() { # bl_run <uptime>  (now = BOOT + uptime)
    [ "$_bl_start_done" = "1" ] || _bl_capture_alive "$BOOT"
    _NOW=$((BOOT + $1)); _MONO_TOP="$1"; boot_log_try
}
last_line() { tail -n 1 "$BOOT_LOG_FILE"; }

# restart: last alive 60 s before boot
bl_fresh
printf '[%s,6,6,20.0,20.0,20.0,null,0]\n[%s,6,6,20.0,20.0,20.0,null,0]\n' $((BOOT - 120)) $((BOOT - 60)) > "$PING_ARCHIVE_DIR/2026-11-27.jsonl"
printf '[%s,6,6,20.0,20.0,20.0,null,0]\n' $((BOOT + 120)) >> "$PING_ARCHIVE_DIR/2026-11-27.jsonl"
bl_run 30
no "uptime under a minute: not yet" test -e "$BOOT_LOG_FILE"
bl_run 90
eq "restart: gap 60 s" "$(last_line)" "{\"boot_ts\":$BOOT,\"last_alive_ts\":$((BOOT - 60)),\"down_sec\":60,\"cause\":\"restart\"}"
# ... a second try in the same boot, and a poller restart (new shell state) do not duplicate
bl_run 200
_bl_done=0; bl_run 300
eq "once per boot (mark file)" "$(wc -l < "$BOOT_LOG_FILE" | tr -d ' ')" 1
rm -f "$BOOT_LOG_MARK"; _bl_done=0; _NOW=$((BOOT + 303)); _MONO_TOP=300; boot_log_try
eq "once per boot (+-5 s match without the mark)" "$(wc -l < "$BOOT_LOG_FILE" | tr -d ' ')" 1
rm -f "$BOOT_LOG_MARK"; _bl_done=0; _NOW=$((BOOT + 3600)); _MONO_TOP=3590; boot_log_try
eq "a boot_ts 10 s off is a different boot" "$(wc -l < "$BOOT_LOG_FILE" | tr -d ' ')" 2

# power loss: last alive 900 s before boot, row only in a gz yesterday file
bl_fresh
Y=$(ht_epoch 2026-11-26 23:50:00)
rm -f "$PING_ARCHIVE_DIR"/*
printf '[%s,6,6,20.0,20.0,20.0,null,0]\n' "$Y" | gzip -c > "$PING_ARCHIVE_DIR/2026-11-26.jsonl.gz"
bl_run 90
eq "power_loss from a gz archive, yesterday" "$(last_line)" "{\"boot_ts\":$BOOT,\"last_alive_ts\":$Y,\"down_sec\":$((BOOT - Y)),\"cause\":\"power_loss\"}"

# unknown: no heartbeat at all
bl_fresh; rm -f "$PING_ARCHIVE_DIR"/*
bl_run 90
eq "unknown: no heartbeat" "$(last_line)" "{\"boot_ts\":$BOOT,\"last_alive_ts\":null,\"down_sec\":null,\"cause\":\"unknown\"}"

# planned: breadcrumb 100 s before boot wins over the gap
bl_fresh
printf '[%s,6,6,20.0,20.0,20.0,null,0]\n' $((BOOT - 2000)) > "$PING_ARCHIVE_DIR/2026-11-27.jsonl"
printf '%s|reboot|unplanned\n%s|reboot|user\n' $((BOOT - 5000)) $((BOOT - 100)) > "$CRASH_LOG_FILE"
bl_run 90
eq "planned (user breadcrumb)" "$(last_line | sed 's/^.*"cause"://')" '"planned"}'
eq "planned keeps the measured gap" "$(last_line | sed 's/^.*"down_sec":\([0-9]*\).*$/\1/')" 2000
bl_fresh
printf '%s|reboot|tier4_escalation\n' $((BOOT - 30)) > "$CRASH_LOG_FILE"
bl_run 90
eq "planned (watchdog breadcrumb)" "$(last_line | sed 's/^.*"cause"://')" '"planned"}'
bl_fresh
printf '%s|reboot|user\n' $((BOOT - 700)) > "$CRASH_LOG_FILE"
bl_run 90
eq "breadcrumb outside the 600 s window is ignored" "$(last_line | sed 's/^.*"cause"://')" '"unknown"}'
bl_fresh
printf '%s|reboot|unplanned\n' $((BOOT + 3)) > "$CRASH_LOG_FILE"
bl_run 90
eq "an 'unplanned' row is never planned" "$(last_line | sed 's/^.*"cause"://')" '"unknown"}'

# --- the heartbeat is the archive as it was at poller START -----------------------------
# A previous life's last row 2000 s before boot. After the poller starts (capture),
# this boot's own first ping-minute row is flushed at its MINUTE start, which is
# before boot_ts; reading the archive at boot-log time would take that row and report
# a 20 s "restart". The captured value must win.
bl_fresh
B2=$((BOOT + 25))
printf '[%s,6,6,20.0,20.0,20.0,null,0]\n' $((BOOT - 2000)) > "$PING_ARCHIVE_DIR/2026-11-27.jsonl"
_bl_capture_alive            # first start of the boot: no bound, the archive is the previous life's
eq "capture: newest row of the previous life" "$_BL_START_LA" "$((BOOT - 2000))"
tick $((B2 + 30)) 20; tick $((B2 + 40)) 20      # 08:00:55 then 08:01:05: flushes the 08:00:00 row
eq "this boot's first row is stamped before boot_ts" "$(tail -n 1 "$PING_ARCHIVE_DIR/2026-11-27.jsonl" | awk -F, '{ print substr($1, 2) }')" "$((B2 - 25))"
_NOW=$((B2 + 90)); _MONO_TOP=90; boot_log_try
eq "own-row bug: last_alive is the captured row, not this boot's" "$(last_line)" "{\"boot_ts\":$B2,\"last_alive_ts\":$((BOOT - 2000)),\"down_sec\":$((2025)),\"cause\":\"power_loss\"}"

# a captured value at or after boot_ts is no heartbeat (clock stepped back / own row)
bl_fresh
printf '[%s,6,6,20.0,20.0,20.0,null,0]\n' $((BOOT + 10)) > "$PING_ARCHIVE_DIR/2026-11-27.jsonl"
_bl_capture_alive
_NOW=$((BOOT + 90)); _MONO_TOP=90; boot_log_try
eq "a heartbeat after boot_ts is ignored" "$(last_line)" "{\"boot_ts\":$BOOT,\"last_alive_ts\":null,\"down_sec\":null,\"cause\":\"unknown\"}"

# capture without prime: nothing known
bl_fresh
printf '[%s,6,6,20.0,20.0,20.0,null,0]\n' $((BOOT - 60)) > "$PING_ARCHIVE_DIR/2026-11-27.jsonl"
_NOW=$((BOOT + 90)); _MONO_TOP=90; boot_log_try
eq "never primed: unknown, not a late archive read" "$(last_line)" "{\"boot_ts\":$BOOT,\"last_alive_ts\":null,\"down_sec\":null,\"cause\":\"unknown\"}"

# capture reads the newest day files by NAME (no wall clock), gz included, newest first
bl_fresh; rm -f "$PING_ARCHIVE_DIR"/*
printf '[%s,6,6,20.0,20.0,20.0,null,0]\n' 1700000000 > "$PING_ARCHIVE_DIR/2026-11-20.jsonl"
printf '[%s,6,6,20.0,20.0,20.0,null,0]\n[%s,6,6,20.0,20.0,20.0,null,0]\n' 1700100000 1700100060 | gzip -c > "$PING_ARCHIVE_DIR/2026-11-21.jsonl.gz"
: > "$PING_ARCHIVE_DIR/2026-11-22.jsonl"
_bl_capture_alive
eq "capture: skips an empty newest day, reads the gz before it (newest row)" "$_BL_START_LA" 1700100060
_bl_capture_alive 1700100060
eq "capture: bound is exclusive" "$_BL_START_LA" 1700100000
bl_fresh; rm -rf "$PING_ARCHIVE_DIR"
_bl_capture_alive
eq "capture: no archive dir -> empty" "$_BL_START_LA" ""
mkdir -p "$PING_ARCHIVE_DIR"

# --- clock_trusted ---------------------------------------------------------------------
bl_fresh; rm -f "$CLOCK_SYNC_MARK"
_MONO_TOP=100;  no  "untrusted: no marker, young uptime" clock_trusted
_MONO_TOP=1799; no  "untrusted: just under the uptime fallback" clock_trusted
_MONO_TOP=1800; yes "trusted: uptime fallback (NTP never synced)" clock_trusted
_MONO_TOP=100;  : > "$CLOCK_NTP_STATE"
yes "trusted: stock dnsmasq time-valid file" clock_trusted
rm -f "$CLOCK_NTP_STATE"; : > "$CLOCK_SYNC_MARK"
yes "trusted: ntp hotplug marker" clock_trusted
_MONO_TOP=""; rm -f "$CLOCK_SYNC_MARK"
no "untrusted: uptime unknown" clock_trusted

# --- nothing is stamped while the clock is untrusted -------------------------------------
bl_fresh; rm -f "$CLOCK_SYNC_MARK"; _MONO_TOP=100
tick $((M0 + 3)) 20; tick $((M0 + 13)) 20; tick $((M0 + 63)) 20; tick $((M0 + 123)) 20
no "untrusted clock: no ping-minute row" test -e "$PING_ARCHIVE_DIR/2026-11-27.jsonl"
eq "untrusted clock: nothing accumulated" "$_pg_n,$_pg_min" "0,0"
# the marker appears mid-minute: the first row only holds samples taken afterwards
: > "$CLOCK_SYNC_MARK"
tick $((M0 + 190)) 30; tick $((M0 + 200)) 40; tick $((M0 + 250)) 50
eq "first trusted row holds only trusted samples (pre-sync span not averaged in)" "$(cat "$PING_ARCHIVE_DIR/2026-11-27.jsonl")" "[$((M0 + 180)),2,2,35.0,30.0,40.0,10.0,0]"
# boot log waits for a trusted clock too, and is retried (not latched)
bl_fresh; rm -f "$CLOCK_SYNC_MARK"
printf '[%s,6,6,20.0,20.0,20.0,null,0]\n' $((BOOT - 60)) > "$PING_ARCHIVE_DIR/2026-11-27.jsonl"
_bl_capture_alive "$BOOT"
_NOW=$((BOOT + 90)); _MONO_TOP=90; boot_log_try
no "boot log: untrusted clock, nothing recorded" test -e "$BOOT_LOG_FILE"
eq "boot log: untrusted clock, retried later" "$_bl_done" 0
: > "$CLOCK_SYNC_MARK"; boot_log_try
eq "boot log: recorded once trusted" "$(last_line)" "{\"boot_ts\":$BOOT,\"last_alive_ts\":$((BOOT - 60)),\"down_sec\":60,\"cause\":\"restart\"}"

# the clock must be sane
bl_fresh
_NOW=1000; _MONO_TOP=500; boot_log_try
no "1970 clock: not recorded" test -e "$BOOT_LOG_FILE"
eq "and retried later" "$_bl_done" 0

# cap: 60 newest lines kept
bl_fresh
i=1; while [ "$i" -le 65 ]; do printf '{"boot_ts":%s,"last_alive_ts":null,"down_sec":null,"cause":"unknown"}\n' "$((BOOT - 100000 - i * 1000))"; i=$((i + 1)); done > "$BOOT_LOG_FILE"
bl_run 90
eq "capped at 60 lines" "$(wc -l < "$BOOT_LOG_FILE" | tr -d ' ')" 60
eq "newest line is this boot" "$(last_line | sed 's/^{"boot_ts":\([0-9]*\),.*$/\1/')" "$BOOT"
eq "oldest lines dropped" "$(head -n 1 "$BOOT_LOG_FILE" | sed 's/^{"boot_ts":\([0-9]*\),.*$/\1/')" "$((BOOT - 100000 - 7 * 1000))"
if command -v jq >/dev/null 2>&1; then
    eq "every boot log line is valid JSON" "$(jq -c . "$BOOT_LOG_FILE" | wc -l | tr -d ' ')" 60
fi

rm -rf "$B"
ht_done
