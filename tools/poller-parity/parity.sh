#!/bin/sh
# parity.sh <old_parse_at> <new_parse_at> <fixture_dir>
# parity.sh --tap <new_parse_at> <tap_dir>
#
# Fixture mode: every <parser>__<name>.txt in <fixture_dir> is run through
# dump_globals.sh with the OLD and NEW library; outputs must be byte-identical.
# Prints "PASS name" / "FAIL name" (+ the diff), then a summary. Exit 0 only if
# there are zero failures. Set PARITY_FILTER=<substring> to run a subset.
# Set PARITY_NICE=0 to skip the low-priority wrapper.
#
# temperature__*.txt (content ignored): parse_temperature reads live sysfs, so
# the two libraries are run back-to-back on the device (old, new, old). PASS if
# new matches either old reading (sysfs jitter between calls is tolerated).
#
# Tap mode: delegates to tap_replay.sh (see there for what is compared).

HERE=${0%/*}
[ "$HERE" = "$0" ] && HERE=.

if [ "$1" = "--tap" ]; then
    [ -n "$2" ] && [ -n "$3" ] || { echo "usage: parity.sh --tap <new_parse_at> <tap_dir>" >&2; exit 2; }
    exec sh "$HERE/tap_replay.sh" "$2" "$3"
fi

OLD=$1
NEW=$2
FXD=$3
if [ -z "$OLD" ] || [ -z "$NEW" ] || [ -z "$FXD" ]; then
    echo "usage: parity.sh <old_parse_at> <new_parse_at> <fixture_dir>" >&2
    echo "       parity.sh --tap <new_parse_at> <tap_dir>" >&2
    exit 2
fi
[ -f "$OLD" ] && [ -f "$NEW" ] && [ -d "$FXD" ] || { echo "bad arguments (missing file/dir)" >&2; exit 2; }

. "$HERE/shim.sh"
TMP="${TMPDIR:-/tmp}/pp_run_$$"
mkdir -p "$TMP" || exit 2
trap 'rm -rf "$TMP"' EXIT

NICE=""
if [ "${PARITY_NICE:-1}" = "1" ] && command -v nice >/dev/null 2>&1; then
    NICE="nice -n 19"
fi

rm -f /tmp/pp_pwned
pass=0
fail=0
skip=0

run_dump() { # lib parser fixture outfile -> exit code of dump_globals
    $NICE sh "$HERE/dump_globals.sh" "$1" "$2" "$3" > "$4" 2>"$4.err"
}

show_diff() { # old new
    pp_diff "$1" "$2" 2>&1 | sed 's/^/    /'
}

for f in "$FXD"/*__*.txt; do
    [ -f "$f" ] || continue
    name=${f##*/}
    name=${name%.txt}
    if [ -n "$PARITY_FILTER" ]; then
        case "$name" in *"$PARITY_FILTER"*) ;; *) continue ;; esac
    fi
    parser=${name%%__*}
    case "$parser" in
        serving_cell|qrsrp|qrsrq|qsinr|signal|ca_info|carrier|sim_slot|sim_status|tier2|temperature|helpers) ;;
        *) skip=$((skip + 1)); continue ;;
    esac

    if [ "$parser" = "temperature" ]; then
        try=0 ; ok=0
        while [ $try -lt 5 ] && [ $ok -eq 0 ]; do
            try=$((try + 1))
            run_dump "$OLD" "$parser" "$f" "$TMP/o1"; rc1=$?
            run_dump "$NEW" "$parser" "$f" "$TMP/n";  rc2=$?
            run_dump "$OLD" "$parser" "$f" "$TMP/o2"; rc3=$?
            if [ $rc1 -ne 0 ] || [ $rc2 -ne 0 ] || [ $rc3 -ne 0 ]; then break; fi
            if cmp -s "$TMP/o1" "$TMP/n" || cmp -s "$TMP/o2" "$TMP/n"; then ok=1; fi
        done
        if [ $rc1 -ne 0 ] || [ $rc2 -ne 0 ] || [ $rc3 -ne 0 ]; then
            echo "FAIL $name (dump exit codes old=$rc1 new=$rc2 old2=$rc3)"
            fail=$((fail + 1))
        elif [ $ok -eq 1 ]; then
            echo "PASS $name (try $try)"
            pass=$((pass + 1))
        else
            echo "FAIL $name (live sysfs: new matched neither old reading in 5 tries)"
            echo "    old1: $(grep '^t1_temperature=' "$TMP/o1")  new: $(grep '^t1_temperature=' "$TMP/n")  old2: $(grep '^t1_temperature=' "$TMP/o2")"
            fail=$((fail + 1))
        fi
        continue
    fi

    run_dump "$OLD" "$parser" "$f" "$TMP/o"; rc1=$?
    run_dump "$NEW" "$parser" "$f" "$TMP/n"; rc2=$?
    if [ $rc1 -ne 0 ] || [ $rc2 -ne 0 ]; then
        echo "FAIL $name (dump exit codes old=$rc1 new=$rc2)"
        [ -s "$TMP/o.err" ] && sed 's/^/    old stderr: /' "$TMP/o.err" | head -5
        [ -s "$TMP/n.err" ] && sed 's/^/    new stderr: /' "$TMP/n.err" | head -5
        fail=$((fail + 1))
    elif [ ! -s "$TMP/o" ]; then
        echo "FAIL $name (old produced no output: harness problem)"
        fail=$((fail + 1))
    elif cmp -s "$TMP/o" "$TMP/n"; then
        echo "PASS $name"
        pass=$((pass + 1))
    else
        echo "FAIL $name"
        show_diff "$TMP/o" "$TMP/n"
        fail=$((fail + 1))
    fi
done

echo "----"
if [ -e /tmp/pp_pwned ]; then
    echo "FAIL injection: hostile fixture text was executed (/tmp/pp_pwned exists)"
    rm -f /tmp/pp_pwned
    fail=$((fail + 1))
fi
echo "parity: pass=$pass fail=$fail skipped=$skip"
[ "$fail" -eq 0 ] && [ "$pass" -gt 0 ]
