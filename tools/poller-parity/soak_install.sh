#!/bin/sh
# soak_install.sh <stage_dir>: install the B5.29 soak daemon (dev-only, runs ON
# the device, BusyBox ash). <stage_dir> holds soakd.sh, soak_summary.sh,
# measure.sh and b529_soak.init. Every write is temp + sync + mv + sync.
#
# It also retires the older overnight monitor: stops it and removes its
# /etc/rc.local line (the procd service replaces both). The old mon.log stays.
# It does not reset a soak in progress: state, soak.log and done are kept.

S=${1:-}
[ -n "$S" ] && [ -d "$S" ] || { echo "usage: soak_install.sh <stage_dir>" >&2; exit 2; }
DIR=/usrdata/b529_mon
BIN=$DIR/bin

for f in soakd.sh soak_summary.sh measure.sh b529_soak.init; do
    [ -f "$S/$f" ] || { echo "soak_install: $S/$f missing" >&2; exit 1; }
    sh -n "$S/$f" || { echo "soak_install: $f fails sh -n" >&2; exit 1; }
done

# _put <src> <dest> <mode>
_put() {
    cp "$1" "$2.new" || return 1
    chmod "$3" "$2.new"
    sync
    mv -f "$2.new" "$2"
    sync
}

mkdir -p "$BIN" || exit 1

# Stop the older monitor (pid file, then any survivor by name).
if [ -f "$DIR/pid" ]; then
    p=$(cat "$DIR/pid")
    case "$p" in ''|*[!0-9]*) ;; *) kill "$p" 2>/dev/null ;; esac
    rm -f "$DIR/pid"
fi
for p in $(pidof overnight_monitor.sh 2>/dev/null); do kill "$p" 2>/dev/null; done
ps | grep '[o]vernight_monitor' | while read -r p _r; do kill "$p" 2>/dev/null; done

if grep -q 'b529_mon' /etc/rc.local 2>/dev/null; then
    grep -v 'b529_mon' /etc/rc.local > /etc/rc.local.new && chmod 755 /etc/rc.local.new && sync &&
        mv -f /etc/rc.local.new /etc/rc.local && sync
fi

_put "$S/soakd.sh" "$BIN/soakd.sh" 755 || exit 1
_put "$S/soak_summary.sh" "$BIN/soak_summary.sh" 755 || exit 1
_put "$S/measure.sh" "$BIN/measure.sh" 755 || exit 1
_put "$S/b529_soak.init" /etc/init.d/b529_soak 755 || exit 1

/etc/init.d/b529_soak enable
/etc/init.d/b529_soak restart
sync

echo "soak_install: done"
md5sum "$BIN/soakd.sh" "$BIN/soak_summary.sh" "$BIN/measure.sh" /etc/init.d/b529_soak
ls -l /etc/rc.d/ | grep b529_soak
grep -c b529_mon /etc/rc.local
