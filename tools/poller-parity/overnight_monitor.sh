#!/bin/sh
# overnight_monitor.sh [duration_s=43200] [every_s=300] [window_s=60]
# B5.29 unattended monitor (dev-only, BusyBox ash). Every <every_s> it runs one
# measure.sh window of <window_s> and appends ONE line to $DIR/mon.log:
#
#   ts=<epoch> up=<s> <measure.sh fields> fpc=<forks per status write>
#   at_ms=<qcmd AT round trip> ssr=<total> ssr_new=<n> poller_pid=<pid>
#   atd_pid=<pid> log_fail=<n> log_busy=<n> log_unreach=<n> log_watch=<n>
#   log_restart=<n> log_reboot=<n>
#
# fpc is system-wide forks/s x status period: an upper bound on the poller's
# forks per cycle (it includes the ping daemon, CGIs and anything the user runs).
# log_* count new /tmp/qmanager.log lines since the previous window.
# Stops by itself after <duration_s>; stop early: kill "$(cat $DIR/pid)".
# The log is capped: at 256 KB it rotates to mon.log.1 (one generation kept).

DUR=${1:-43200}
EVERY=${2:-300}
WIN=${3:-60}
for _v in "$DUR" "$EVERY" "$WIN"; do
    case "$_v" in ''|*[!0-9]*) echo "usage: overnight_monitor.sh [duration] [every] [window]" >&2; exit 2 ;; esac
done
[ "$WIN" -lt "$EVERY" ] || { echo "window must be shorter than every" >&2; exit 2; }

DIR=${MON_DIR:-/tmp/b529_mon}
HERE=$(cd "$(dirname "$0")" && pwd)
MEASURE="$HERE/measure.sh"
LOG="$DIR/mon.log"
QLOG=/tmp/qmanager.log
CAP=262144

mkdir -p "$DIR" || exit 1
[ -f "$MEASURE" ] || { echo "measure.sh not found next to this script" >&2; exit 1; }
echo $$ > "$DIR/pid"
trap 'rm -f "$DIR/pid"; exit 0' INT TERM

up_s() { read -r _u _x < /proc/uptime; echo "${_u%%.*}"; }
up_cs() { read -r _u _x < /proc/uptime; _f=${_u#*.}; _f=${_f#0}; echo $(( ${_u%%.*} * 100 + ${_f:-0} )); }
pid_of() { ps | grep "[${1%"${1#?}"}]${1#?}" | head -1 | awk '{print $1}'; }

start=$(up_s)
end=$((start + DUR))
ssr0=$(dmesg | grep -c 'remoteproc-mss: fatal error')
qoff=$(wc -c < "$QLOG" 2>/dev/null || echo 0)
echo "# start ts=$(date +%s) up=$start dur=$DUR every=$EVERY win=$WIN ssr=$ssr0 poller_md5=$(md5sum /usr/bin/qmanager_poller | cut -d' ' -f1)" >> "$LOG"

while [ "$(up_s)" -lt "$end" ]; do
    t0=$(up_s)
    m=$("$MEASURE" "$WIN" 2>&1 | tail -1)

    # Forks per status write (upper bound, system-wide).
    fpc=$(printf '%s\n' "$m" | awk '{for(i=1;i<=NF;i++){split($i,a,"=");v[a[1]]=a[2]} if(v["status_period_avg"]>0) printf "%.1f", v["forks_per_s"]*v["status_period_avg"]; else print "na"}')

    # Broker round trip: one read-only AT through qcmd.
    a0=$(up_cs); qcmd AT >/dev/null 2>&1; a1=$(up_cs)
    at_ms=$(( (a1 - a0) * 10 ))

    ssr=$(dmesg | grep -c 'remoteproc-mss: fatal error')

    # New qmanager.log lines since the last window (handles rotation).
    qsz=$(wc -c < "$QLOG" 2>/dev/null || echo 0)
    [ "$qsz" -lt "$qoff" ] && qoff=0
    new=$(tail -c +$((qoff + 1)) "$QLOG" 2>/dev/null)
    qoff=$qsz
    cnt() { printf '%s\n' "$new" | grep -ciE "$1"; }
    l_fail=$(cnt 'qcmd_exec failed|modem_timeout')
    l_busy=$(cnt 'modem_busy|lock timeout')
    l_unr=$(cnt 'Modem unreachable')
    l_watch=$(cnt 'watchcat|watchdog')
    l_rst=$(cnt 'QManager Poller starting')
    l_rbt=$(cnt 'reboot|ssr_hold|baseband|remoteproc')

    echo "ts=$(date +%s) up=$(up_s) $m fpc=$fpc at_ms=$at_ms ssr=$ssr ssr_new=$((ssr - ssr0)) poller_pid=$(pid_of qmanager_poller) atd_pid=$(pid_of qmanager_atd) log_fail=$l_fail log_busy=$l_busy log_unreach=$l_unr log_watch=$l_watch log_restart=$l_rst log_reboot=$l_rbt" >> "$LOG"

    if [ "$(wc -c < "$LOG")" -gt "$CAP" ]; then
        mv -f "$LOG" "$LOG.1"
    fi

    left=$((EVERY - ($(up_s) - t0)))
    [ "$left" -gt 0 ] && sleep "$left"
done

echo "# end ts=$(date +%s) up=$(up_s) ssr=$(dmesg | grep -c 'remoteproc-mss: fatal error')" >> "$LOG"
rm -f "$DIR/pid"
