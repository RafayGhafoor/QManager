#!/bin/sh
# soakd.sh: B5.29 reboot-proof soak daemon (dev-only; build.sh never packages
# tools/). Run by procd through /etc/init.d/b529_soak (respawn, no retry
# limit), BusyBox ash. Install: tools/poller-parity/soak_install.sh.
#
# Every EVERY s it runs one measure.sh window of WIN s and appends ONE line to
# $DIR/soak.log, then syncs. Progress lives in $DIR/state (temp + sync + mv),
# so a reboot, a power cut or a crash resumes the soak where it stopped. The
# soak ends after TARGET windows that measured something (144 x 300 s = 12 h);
# time spent rebooting does not count toward it. At the end it writes
# $DIR/summary.txt (soak_summary.sh), drops $DIR/done, disables its own boot
# start and idles. Progress at any time: sh $DIR/bin/soak_summary.sh
#
# Line: ts= up= boot=<n> n=<window> <measure.sh fields> at_ms= ssr_boot=
#       ssr_total= poller_pid= atd_pid= log_fail= log_busy= log_unreach=
#       log_restart= log_ssr=
# ssr_* count baseband crashes ("handling crash #N" in dmesg) seen during the
# soak: ssr_boot in this boot, ssr_total across every boot of the soak.
#
# Start over: /etc/init.d/b529_soak stop; rm -f $DIR/state $DIR/done
# $DIR/soak.log*; /etc/init.d/b529_soak enable; /etc/init.d/b529_soak start

DIR=${SOAK_DIR:-/usrdata/b529_mon}
BIN=$DIR/bin
MEASURE=$BIN/measure.sh
LOG=$DIR/soak.log
STATE=$DIR/state
QLOG=/tmp/qmanager.log
EVERY=${SOAK_EVERY:-300}
WIN=${SOAK_WIN:-60}
TARGET=${SOAK_TARGET:-144}
CAP=524288

for _v in "$EVERY" "$WIN" "$TARGET"; do
    case "$_v" in ''|*[!0-9]*) echo "soakd: bad SOAK_* value" >&2; exit 2 ;; esac
done
[ "$WIN" -lt "$EVERY" ] || { echo "soakd: window must be shorter than every" >&2; exit 2; }

up_s() { read -r _u _x < /proc/uptime; echo "${_u%%.*}"; }
up_cs() { read -r _u _x < /proc/uptime; _f=${_u#*.}; _f=${_f#0}; echo $(( ${_u%%.*} * 100 + ${_f:-0} )); }
pid_of() { pidof "$1" 2>/dev/null | cut -d' ' -f1; }

# Append one line and push it to flash.
logl() { echo "$1" >> "$LOG"; sync; }

idle() {
    while :; do
        sleep 3600 &
        wait $!
    done
}

# Crash counter of this boot's baseband (0 when the ring holds no crash line).
crash_count() {
    _c=$(dmesg 2>/dev/null | grep -o 'handling crash #[0-9]*' | tail -1)
    _c=${_c##*#}
    case "$_c" in ''|*[!0-9]*) _c=0 ;; esac
    echo "$_c"
}

load_state() {
    S_WINDOWS=0
    S_BOOTS=0
    S_BOOT_ID=""
    S_SSR_BASE=0
    S_SSR_BOOT=0
    S_SSR_OFF=0
    S_START_TS=0
    [ -f "$STATE" ] || return 0
    while IFS='=' read -r _k _v; do
        case "$_k" in
            windows)  S_WINDOWS=$_v ;;
            boots)    S_BOOTS=$_v ;;
            boot_id)  S_BOOT_ID=$_v ;;
            ssr_base) S_SSR_BASE=$_v ;;
            ssr_boot) S_SSR_BOOT=$_v ;;
            ssr_off)  S_SSR_OFF=$_v ;;
            start_ts) S_START_TS=$_v ;;
        esac
    done < "$STATE"
    case "$S_WINDOWS" in ''|*[!0-9]*) S_WINDOWS=0 ;; esac
    case "$S_BOOTS" in ''|*[!0-9]*) S_BOOTS=0 ;; esac
    case "$S_SSR_BASE" in ''|*[!0-9]*) S_SSR_BASE=0 ;; esac
    case "$S_SSR_BOOT" in ''|*[!0-9]*) S_SSR_BOOT=0 ;; esac
    case "$S_SSR_OFF" in ''|*[!0-9]*) S_SSR_OFF=0 ;; esac
    case "$S_START_TS" in ''|*[!0-9]*) S_START_TS=0 ;; esac
}

# Durable: temp in the same directory, sync, rename, sync.
save_state() {
    printf 'windows=%s\nboots=%s\nboot_id=%s\nssr_base=%s\nssr_boot=%s\nssr_off=%s\nstart_ts=%s\n' \
        "$S_WINDOWS" "$S_BOOTS" "$S_BOOT_ID" "$S_SSR_BASE" "$S_SSR_BOOT" "$S_SSR_OFF" "$S_START_TS" \
        > "$STATE.new" || return 1
    sync
    mv -f "$STATE.new" "$STATE"
    sync
}

finish() {
    logl "# end ts=$(date +%s) up=$(up_s) windows=$S_WINDOWS boots=$S_BOOTS ssr_total=$((S_SSR_BASE + S_SSR_BOOT))"
    if [ -f "$BIN/soak_summary.sh" ]; then
        sh "$BIN/soak_summary.sh" "$DIR" > "$DIR/summary.txt.new" 2>&1
        sync
        mv -f "$DIR/summary.txt.new" "$DIR/summary.txt"
    fi
    : > "$DIR/done"
    sync
    /etc/init.d/b529_soak disable 2>/dev/null
    idle
}

mkdir -p "$DIR" || exit 1
[ -f "$MEASURE" ] || { echo "soakd: $MEASURE missing" >&2; exit 1; }
[ -f "$DIR/done" ] && idle
trap 'rm -f "$STATE.new"; exit 0' INT TERM

load_state
[ "$S_WINDOWS" -ge "$TARGET" ] && finish

bid=""
read -r bid < /proc/sys/kernel/random/boot_id 2>/dev/null
if [ "$bid" != "$S_BOOT_ID" ]; then
    # A new boot (or the first start): fold the last boot's crashes into the
    # base, and count this boot's from what dmesg already shows. After a
    # reboot the whole (fresh) qmanager.log belongs to the soak; on the first
    # start only what comes next does.
    if [ "$S_BOOTS" -eq 0 ]; then
        qoff=$(wc -c < "$QLOG" 2>/dev/null)
    else
        qoff=0
    fi
    S_SSR_BASE=$((S_SSR_BASE + S_SSR_BOOT))
    S_SSR_BOOT=0
    S_SSR_OFF=$(crash_count)
    S_BOOTS=$((S_BOOTS + 1))
    S_BOOT_ID=$bid
    [ "$S_START_TS" -gt 0 ] || S_START_TS=$(date +%s)
    save_state
    logl "# boot n=$S_BOOTS ts=$(date +%s) up=$(up_s) windows=$S_WINDOWS/$TARGET ssr_off=$S_SSR_OFF poller_md5=$(md5sum /usr/bin/qmanager_poller 2>/dev/null | cut -d' ' -f1) atd_md5=$(md5sum /usr/bin/qmanager_atd 2>/dev/null | cut -d' ' -f1) atd_proto=$(tr '\n' ',' < /var/run/qmanager_atd.proto 2>/dev/null)"
else
    logl "# resume ts=$(date +%s) up=$(up_s) windows=$S_WINDOWS/$TARGET (daemon restart, same boot)"
    qoff=$(wc -c < "$QLOG" 2>/dev/null)
fi
case "$qoff" in ''|*[!0-9]*) qoff=0 ;; esac

# Let a fresh boot settle before the first window (the poller's boot block).
u=$(up_s)
if [ "$u" -lt 240 ]; then
    sleep $((240 - u)) &
    wait $!
fi

cnt() { printf '%s\n' "$new" | grep -ciE "$1"; }

while [ "$S_WINDOWS" -lt "$TARGET" ]; do
    t0=$(up_s)
    m=$(sh "$MEASURE" "$WIN" 2>&1 | tail -1)

    a0=$(up_cs); qcmd AT >/dev/null 2>&1; a1=$(up_cs)
    at_ms=$(( (a1 - a0) * 10 ))

    c=$(crash_count)
    c=$((c - S_SSR_OFF))
    [ "$c" -gt "$S_SSR_BOOT" ] && S_SSR_BOOT=$c

    # New qmanager.log lines since the last window (tmpfs; restarts per boot).
    qsz=$(wc -c < "$QLOG" 2>/dev/null)
    case "$qsz" in ''|*[!0-9]*) qsz=0 ;; esac
    [ "$qsz" -lt "$qoff" ] && qoff=0
    new=$(tail -c +$((qoff + 1)) "$QLOG" 2>/dev/null)
    qoff=$qsz

    case "$m" in
        window=*)
            S_WINDOWS=$((S_WINDOWS + 1))
            logl "ts=$(date +%s) up=$(up_s) boot=$S_BOOTS n=$S_WINDOWS $m at_ms=$at_ms ssr_boot=$S_SSR_BOOT ssr_total=$((S_SSR_BASE + S_SSR_BOOT)) poller_pid=$(pid_of qmanager_poller) atd_pid=$(pid_of qmanager_atd) log_fail=$(cnt 'qcmd_exec failed|modem_timeout') log_busy=$(cnt 'modem_busy|Lock acquisition failed') log_unreach=$(cnt 'Modem unreachable') log_restart=$(cnt 'QManager Poller starting') log_ssr=$(cnt 'Channel reset|airplane_mode')"
            ;;
        *)
            logl "# skip ts=$(date +%s) up=$(up_s) boot=$S_BOOTS reason=$(printf '%s' "$m" | tr -s ' \t' '_' | cut -c1-120)"
            ;;
    esac

    if [ "$(wc -c < "$LOG")" -gt "$CAP" ]; then
        mv -f "$LOG" "$LOG.1"
        sync
    fi
    save_state

    left=$((EVERY - ($(up_s) - t0)))
    if [ "$left" -gt 0 ] && [ "$S_WINDOWS" -lt "$TARGET" ]; then
        sleep "$left" &
        wait $!
    fi
done

finish
