#!/bin/sh
# tap_replay.sh <new_parse_at> <tap_dir>      (normally run via: parity.sh --tap ...)
#
# Replays the poller's recorded AT replies (tap records written by _tap_at /
# _tap_end in qmanager_poller) through the NEW parsers, in poller call order and
# with the poller's pre-processing, and compares the parser-owned globals with
# the GLOBALS block the poller recorded at the end of the same cycle.
#
# Compared (parser-owned) names:
#   lte_{state,band,earfcn,bandwidth,pci,rsrp,rsrq,sinr,rssi,cell_id,enodeb_id,
#        sector_id,tac}
#   nr_{state,band,arfcn,pci,rsrp,rsrq,sinr,scs,cell_id,enodeb_id,sector_id,tac}
#   t2_{carrier,sim_status,sim_slot,ca_active,ca_count,nr_ca_active,nr_ca_count,
#       total_bandwidth_mhz,bandwidth_details,carrier_components}
#   sig_* (six JSON arrays), network_type
# NOT compared (poller-side or not replayable):
#   service_status  (parse_serving_cell sets it, determine_service_status then
#                    overwrites it from SIM/CFUN/reachability state)
#   t1_temperature  (sysfs, not an AT reply)      lte_ta / nr_ta (on-demand cache)
#   t1_cfun, modem_reachable, errors, boot_phone_number (poller logic, not parsers)
#   _cid_*          (parser-internal; not in the recorded set)
#
# Known tap limitation: the poller records GLOBALS with a line-oriented grep, so
# the multi-line (pretty-printed jq) t2_carrier_components value is recorded as
# only its first line ("t2_carrier_components='[" for a non-empty array). The
# replay compares the same first line, i.e. emptiness only. Carrier-component
# content is covered by the fixture corpus, not by the tap.
#
# Seeding: state is carried from cycle to cycle exactly as in the poller (deep /
# idle cycles skip some ATs and leave their globals stale). The first record, and
# any record after a gap in cycle numbers, is seeded from that record's OWN
# recorded values (single-line ones), which cannot detect a parser that wrongly
# leaves a stale value in that one cycle; those cycles are marked "(reseeded)".

NEW=$1
TAPDIR=$2
[ -f "$NEW" ] && [ -d "$TAPDIR" ] || { echo "usage: tap_replay.sh <new_parse_at> <tap_dir>" >&2; exit 2; }

HERE=${0%/*}
[ "$HERE" = "$0" ] && HERE=.
. "$HERE/shim.sh"

TMP="${TMPDIR:-/tmp}/pp_tap_$$"
mkdir -p "$TMP" || exit 2
trap 'rm -rf "$TMP" /tmp/ppx_$$_*.tmp "${TMPDIR:-/tmp}/ppx_lib_$$.sh"' EXIT

RE_OWNED='^(lte_(state|band|earfcn|bandwidth|pci|rsrp|rsrq|sinr|rssi|cell_id|enodeb_id|sector_id|tac)|nr_(state|band|arfcn|pci|rsrp|rsrq|sinr|scs|cell_id|enodeb_id|sector_id|tac)|t2_(carrier|sim_status|sim_slot|ca_active|ca_count|nr_ca_active|nr_ca_count|total_bandwidth_mhz|bandwidth_details|carrier_components)|sig_[a-z_]+|network_type)='

pp_init_defaults
pp_source_lib "$NEW"

NL='
'

tap_dispatch() { # cmd rc raw
    case "$1" in
        'AT+QENG="servingcell"')           pp_call_serving_cell "$3" "$2" ;;
        'AT+QCAINFO')                      pp_call_ca_info "$3" "$2" ;;
        'AT+QRSRP;+QRSRQ;+QSINR')          pp_call_signal "$3" ;;
        'AT+COPS?;+QUIMSLOT?;+CNUM;+CPIN?') pp_call_tier2 "$3" ;;
    esac
}

# recorded owned globals of a record -> sorted file
tap_recorded() { # rec out
    sed -n '/^### GLOBALS$/,/^### END$/p' "$1" | sed '1d;$d' | grep -E "$RE_OWNED" | sort > "$2"
}

tap_seed() { # rec
    sed -n '/^### GLOBALS$/,/^### END$/p' "$1" | sed '1d;$d' | grep -E "$RE_OWNED" \
        | awk -v q="'" '{ n = split($0, a, q) - 1; if (n % 2 == 0) print }' > "$TMP/seed.sh"
    . "$TMP/seed.sh"
}

# index: "<cycle> <path>" ordered by cycle
grep -H '^### CYCLE ' "$TAPDIR"/*.rec 2>/dev/null \
    | sed 's/^\(.*\.rec\):### CYCLE \([0-9][0-9]*\) tier=\(.*\)$/\2 \3 \1/' \
    | sort -n > "$TMP/index"

if [ ! -s "$TMP/index" ]; then
    echo "no complete tap records in $TAPDIR" >&2
    exit 2
fi

pass=0
fail=0
reseeded=0
prev=""

while read -r cyc tier rec; do
    mark=""
    if [ -z "$prev" ] || [ "$cyc" -ne $((prev + 1)) ]; then
        tap_seed "$rec"
        mark=" (reseeded)"
        reseeded=$((reseeded + 1))
    fi
    prev=$cyc

    # replay the AT sections in order
    state=none ; cmd="" ; rc="" ; buf="" ; first=1
    while IFS= read -r line; do
        case "$state" in
            none)
                case "$line" in
                    '### AT '*)
                        rest=${line#'### AT '}
                        rc=${rest##* rc=}
                        cmd=${rest% rc=*}
                        state=raw ; buf="" ; first=1
                        ;;
                    '### CYCLE '*) break ;;
                esac
                ;;
            raw)
                if [ "$line" = "### END" ]; then
                    tap_dispatch "$cmd" "$rc" "$buf"
                    state=none
                elif [ "$first" = "1" ]; then
                    buf=$line ; first=0
                else
                    buf="$buf$NL$line"
                fi
                ;;
        esac
    done < "$rec"

    set | grep -E "$RE_OWNED" | sort > "$TMP/got"
    tap_recorded "$rec" "$TMP/want"
    if cmp -s "$TMP/want" "$TMP/got"; then
        echo "PASS cycle $cyc tier=$tier$mark"
        pass=$((pass + 1))
    else
        echo "FAIL cycle $cyc tier=$tier$mark   (< recorded by poller, > replayed by new parsers)"
        pp_diff "$TMP/want" "$TMP/got" | sed 's/^/    /'
        fail=$((fail + 1))
    fi
done < "$TMP/index"

echo "----"
echo "tap replay: pass=$pass fail=$fail reseeded=$reseeded"
[ "$fail" -eq 0 ] && [ "$pass" -gt 0 ]
