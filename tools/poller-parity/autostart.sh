#!/bin/sh
# B5.29 monitor autostart (dev-only). Called from /etc/rc.local at boot and
# once by hand. Runs overnight_monitor.sh until the wall-clock deadline in
# $DIR/deadline, resuming after any reboot or power loss. Log lives on /usrdata.
# Remove: delete the b529_mon line from /etc/rc.local and rm -rf /usrdata/b529_mon.

DIR=/usrdata/b529_mon
BIN=$DIR/bin
SANE=1790000000

[ -f "$DIR/deadline" ] || exit 0
dl=$(cat "$DIR/deadline")
case "$dl" in ''|*[!0-9]*) exit 0 ;; esac

# Already running? (pid file survives a reboot, so check the cmdline too.)
if [ -f "$DIR/pid" ]; then
    p=$(cat "$DIR/pid")
    case "$p" in ''|*[!0-9]*) ;; *)
        grep -q overnight_monitor "/proc/$p/cmdline" 2>/dev/null && exit 0 ;;
    esac
    rm -f "$DIR/pid"
fi

# At boot the clock can read 1970 or a stale saved time until NITZ/NTP; wait
# for a sane clock, then give the poller time to settle. Max 15 min.
[ "${1:-}" = now ] || {
    i=0
    while [ "$(date +%s)" -lt "$SANE" ] && [ "$i" -lt 900 ]; do sleep 10; i=$((i + 10)); done
    sleep 120
}

now=$(date +%s)
[ "$now" -ge "$SANE" ] || exit 0
left=$((dl - now))
[ "$left" -gt 300 ] || { echo "# autostart: deadline passed ts=$now" >> "$DIR/mon.log"; exit 0; }

echo "# autostart ts=$now up=$(cut -d. -f1 /proc/uptime) left=$left" >> "$DIR/mon.log"
MON_DIR=$DIR exec "$BIN/overnight_monitor.sh" "$left" 300 60
