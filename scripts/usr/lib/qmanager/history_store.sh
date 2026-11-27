#!/bin/sh
# =============================================================================
# history_store.sh - storage maintenance for the durable history archives
# =============================================================================
# Shared by the cell-history recorder (/usrdata/qmanager/cell_history) and the
# ping-minute archive (/usrdata/qmanager/ping_history). Sourced by
# qmanager_poller; both archives are one NDJSON file per UTC day named
# YYYY-MM-DD.jsonl, compressed in place to YYYY-MM-DD.jsonl.gz once closed.
#
#   hs_maintain <dir> <keep_days> <cap_kb> <floor_kb> [state_file]
#
# One pass, always in this order:
#   1. expire    every day file (.jsonl or .jsonl.gz) older than keep_days
#   2. compress  ONE closed (not today's UTC day) .jsonl per call, niced, via a
#                .gz.tmp that is verified before it replaces the original; on any
#                failure the original is left untouched
#   3. cap       delete oldest day files first until the directory (sum of
#                `ls -ln` sizes) fits cap_kb; today's file is never deleted
#   4. floor     df -k of the directory vs floor_kb
# Returns 0 when writing is allowed, 1 when free space is under the floor.
# There is no latch: the caller decides when to ask again (UTC rotation, and
# hourly while refused).
#
# State file (default /tmp/qmanager_<dirname>_state, e.g.
# /tmp/qmanager_cell_history_state), written atomically:
#   state=ok|low_space  free_kb=N  archive_kb=N  checked=<epoch>
#
# Outputs left in globals: HS_PENDING (1 = closed .jsonl files remain, so a
# further pass is worthwhile), HS_FREE_KB, HS_ARCHIVE_KB.
# HS_NOW (optional) overrides the clock, for tests.
# =============================================================================

[ -n "${_HISTORY_STORE_LOADED:-}" ] && return 0
_HISTORY_STORE_LOADED=1

HS_PENDING=0
HS_FREE_KB=0
HS_ARCHIVE_KB=0
_HS_D=""
_HS_N=""
_HS_KB=0

# _hs_day <epoch>: _HS_D = UTC YYYY-MM-DD (civil-from-days, builtins only, so no
# fork and no dependency on the date applet's options); rc 1 on a non-number.
_hs_day() {
    local _hy_z
    local _hy_era
    local _hy_doe
    local _hy_yoe
    local _hy_y
    local _hy_doy
    local _hy_mp
    local _hy_d
    local _hy_m
    _HS_D=""
    case "$1" in ''|*[!0-9]*) return 1 ;; esac
    _hy_z=$(( $1 / 86400 + 719468 ))
    _hy_era=$(( _hy_z / 146097 ))
    _hy_doe=$(( _hy_z - _hy_era * 146097 ))
    _hy_yoe=$(( (_hy_doe - _hy_doe / 1460 + _hy_doe / 36524 - _hy_doe / 146096) / 365 ))
    _hy_y=$(( _hy_yoe + _hy_era * 400 ))
    _hy_doy=$(( _hy_doe - (365 * _hy_yoe + _hy_yoe / 4 - _hy_yoe / 100) ))
    _hy_mp=$(( (5 * _hy_doy + 2) / 153 ))
    _hy_d=$(( _hy_doy - (153 * _hy_mp + 2) / 5 + 1 ))
    if [ "$_hy_mp" -lt 10 ]; then _hy_m=$((_hy_mp + 3)); else _hy_m=$((_hy_mp - 9)); fi
    [ "$_hy_m" -le 2 ] && _hy_y=$((_hy_y + 1))
    [ "$_hy_m" -lt 10 ] && _hy_m="0$_hy_m"
    [ "$_hy_d" -lt 10 ] && _hy_d="0$_hy_d"
    _HS_D="${_hy_y}-${_hy_m}-${_hy_d}"
    return 0
}

# _hs_daynum <YYYY-MM-DD>: _HS_N = YYYYMMDD for numeric comparison.
_hs_daynum() {
    local _hd_y
    local _hd_r
    _hd_y="${1%%-*}"
    _hd_r="${1#*-}"
    _HS_N="${_hd_y}${_hd_r%%-*}${_hd_r#*-}"
}

# _hs_archive_kb <dir>: _HS_KB = sum of `ls -ln` sizes of the day files, in KB
# (rounded up). Only names shaped like a day file are counted.
_hs_archive_kb() {
    _HS_KB=$(ls -ln "$1"/*.jsonl "$1"/*.jsonl.gz 2>/dev/null | awk '
        $1 ~ /^-/ {
            b = $9; sub(/.*\//, "", b)
            if (b ~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]\.jsonl(\.gz)?$/) s += $5
        }
        END { printf "%d", int((s + 1023) / 1024) }')
    case "$_HS_KB" in ''|*[!0-9]*) _HS_KB=0 ;; esac
}

# _hs_gz_one <file.jsonl>: compress in place. Original untouched on failure.
_hs_gz_one() {
    local _hg_f
    local _hg_t
    local _hg_rc
    _hg_f="$1"
    _hg_t="${_hg_f}.gz.tmp"
    if command -v nice >/dev/null 2>&1; then
        nice gzip -c "$_hg_f" > "$_hg_t" 2>/dev/null
    else
        gzip -c "$_hg_f" > "$_hg_t" 2>/dev/null
    fi
    _hg_rc=$?
    if [ "$_hg_rc" -eq 0 ] && [ -s "$_hg_t" ] \
        && gzip -dc < "$_hg_t" > /dev/null 2>&1 \
        && mv -f "$_hg_t" "${_hg_f}.gz" 2>/dev/null; then
        rm -f "$_hg_f"
        return 0
    fi
    rm -f "$_hg_t"
    return 1
}

# _hs_write_state <file> <state> <free_kb> <archive_kb> <now>
_hs_write_state() {
    local _hw_tmp
    _hw_tmp="${1}.tmp.$$"
    if printf 'state=%s\nfree_kb=%s\narchive_kb=%s\nchecked=%s\n' "$2" "$3" "$4" "$5" > "$_hw_tmp" 2>/dev/null; then
        mv -f "$_hw_tmp" "$1" 2>/dev/null || rm -f "$_hw_tmp"
    else
        rm -f "$_hw_tmp"
    fi
}

hs_maintain() {
    local _hm_dir
    local _hm_keep
    local _hm_cap
    local _hm_floor
    local _hm_state
    local _hm_now
    local _hm_today
    local _hm_todaynum
    local _hm_cutnum
    local _hm_f
    local _hm_name
    local _hm_day
    local _hm_gzdone
    local _hm_free
    local _hm_del

    _hm_dir="$1"
    _hm_keep="$2"
    _hm_cap="$3"
    _hm_floor="$4"
    case "$_hm_keep" in ''|*[!0-9]*) _hm_keep=30 ;; esac
    case "$_hm_cap" in ''|*[!0-9]*) _hm_cap=3072 ;; esac
    case "$_hm_floor" in ''|*[!0-9]*) _hm_floor=4096 ;; esac
    if [ -n "${5:-}" ]; then
        _hm_state="$5"
    else
        _hm_state="/tmp/qmanager_${_hm_dir##*/}_state"
    fi
    _hm_now="${HS_NOW:-}"
    case "$_hm_now" in ''|*[!0-9]*) _hm_now=$(date +%s) ;; esac
    HS_PENDING=0

    [ -d "$_hm_dir" ] || mkdir -p "$_hm_dir" 2>/dev/null
    if [ ! -d "$_hm_dir" ]; then
        _hs_write_state "$_hm_state" "low_space" 0 0 "$_hm_now"
        return 1
    fi

    _hs_day "$_hm_now" || return 0
    _hm_today="$_HS_D"
    _hs_daynum "$_hm_today"
    _hm_todaynum="$_HS_N"
    _hs_day $((_hm_now - _hm_keep * 86400)) || return 0
    _hs_daynum "$_HS_D"
    _hm_cutnum="$_HS_N"

    # Debris from an interrupted compression pass.
    rm -f "$_hm_dir"/*.gz.tmp 2>/dev/null

    # 1. expire
    for _hm_f in "$_hm_dir"/*.jsonl "$_hm_dir"/*.jsonl.gz; do
        [ -f "$_hm_f" ] || continue
        _hm_name="${_hm_f##*/}"
        _hm_day="${_hm_name%%.*}"
        case "$_hm_day" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;; *) continue ;; esac
        _hs_daynum "$_hm_day"
        [ "$_HS_N" -lt "$_hm_cutnum" ] && rm -f "$_hm_f"
    done

    # 2. compress ONE closed day, oldest first; note whether more remain.
    _hm_gzdone=0
    for _hm_f in "$_hm_dir"/*.jsonl; do
        [ -f "$_hm_f" ] || continue
        _hm_name="${_hm_f##*/}"
        _hm_day="${_hm_name%.jsonl}"
        case "$_hm_day" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;; *) continue ;; esac
        _hs_daynum "$_hm_day"
        [ "$_HS_N" -lt "$_hm_todaynum" ] || continue
        if [ "$_hm_gzdone" = "1" ]; then
            HS_PENDING=1
            break
        fi
        _hm_gzdone=1
        if [ ! -s "$_hm_f" ]; then
            rm -f "$_hm_f"
        elif [ -f "${_hm_f}.gz" ] && gzip -dc < "${_hm_f}.gz" > /dev/null 2>&1; then
            # A previous pass died between the move and the delete.
            rm -f "$_hm_f"
        elif ! _hs_gz_one "$_hm_f"; then
            HS_PENDING=1
        fi
    done

    # 3. cap, oldest first, never today's file.
    _hs_archive_kb "$_hm_dir"
    if [ "$_HS_KB" -gt "$_hm_cap" ]; then
        _hm_del=$(ls -ln "$_hm_dir"/*.jsonl "$_hm_dir"/*.jsonl.gz 2>/dev/null | awk \
            -v cap="$((_hm_cap * 1024))" -v today="$_hm_today" '
            $1 ~ /^-/ {
                b = $9; sub(/.*\//, "", b)
                if (b ~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]\.jsonl(\.gz)?$/) {
                    n++; sz[n] = $5; nm[n] = $9; bn[n] = b; tot += $5
                }
            }
            END {
                for (i = 1; i <= n && tot > cap; i++) {
                    if (substr(bn[i], 1, 10) == today) continue
                    print nm[i]
                    tot -= sz[i]
                }
            }')
        for _hm_f in $_hm_del; do
            rm -f "$_hm_f"
        done
        _hs_archive_kb "$_hm_dir"
    fi
    HS_ARCHIVE_KB="$_HS_KB"

    # 4. free-space floor.
    _hm_free=$(df -k "$_hm_dir" 2>/dev/null | awk 'NR > 1 { v = $4 } END { print v + 0 }')
    case "$_hm_free" in ''|*[!0-9]*) _hm_free=0 ;; esac
    HS_FREE_KB="$_hm_free"
    # An unreadable df (0) is not evidence of a full volume: allow the write.
    if [ "$_hm_free" -gt 0 ] && [ "$_hm_free" -lt "$_hm_floor" ]; then
        _hs_write_state "$_hm_state" "low_space" "$_hm_free" "$HS_ARCHIVE_KB" "$_hm_now"
        return 1
    fi
    _hs_write_state "$_hm_state" "ok" "$_hm_free" "$HS_ARCHIVE_KB" "$_hm_now"
    return 0
}
