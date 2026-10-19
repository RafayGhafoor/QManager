#!/bin/sh
# deploy.sh: crash-safe dev deploy for ledger row B5.29 (dev-only; build.sh
# never packages tools/). Runs ON the device, BusyBox ash.
#
# Why: on 2026-10-19 a plain `cp` deploy followed by an AP hang and a power
# cycle left eight files at 0 bytes (UBIFS had journaled the truncate, not the
# data). Every write here goes to <dest>.new in the same directory, is synced,
# renamed over the target and synced again, and the result is re-read from
# flash (drop_caches) before it is reported good.
#
# Usage:
#   deploy.sh <phase> <stage_dir>   install every file under <stage_dir>,
#                                   mirrored to / (stage/usr/bin/x -> /usr/bin/x)
#   deploy.sh --restore <phase>     put back the files that phase backed up
#   deploy.sh --verify <phase>      re-check the deployed md5s from flash
#
# Backups: /usrdata/qmanager_bak_b529/<phase>/root/<path>, taken once per phase
# (a second deploy of the same phase keeps the first, true original). The
# manifests md5.before / md5.after sit next to root/. Restarting the touched
# service is left to the caller; this script never restarts or reboots.

BAK_BASE="${DEPLOY_BAK_BASE:-/usrdata/qmanager_bak_b529}"
# Test hook: install under this prefix instead of / (dev self-test only).
R="${DEPLOY_ROOT:-}"
CR=$(printf '\r')

die() { echo "deploy: $1" >&2; exit 1; }

# _durable_copy <src> <dest>: src -> dest.new, sync, mv, sync. The mode of an
# existing dest is kept; a new dest takes the source's mode.
_durable_copy() {
    local _src="$1"
    local _dst="$2"
    local _mode
    local _dir
    _dir="${_dst%/*}"
    [ -n "$_dir" ] && [ ! -d "$_dir" ] && { mkdir -p "$_dir" || return 1; }
    _mode=""
    [ -e "$_dst" ] && _mode=$(stat -c %a "$_dst" 2>/dev/null)
    [ -z "$_mode" ] && _mode=$(stat -c %a "$_src" 2>/dev/null)
    rm -f "$_dst.new"
    cp "$_src" "$_dst.new" || { rm -f "$_dst.new"; return 1; }
    [ -n "$_mode" ] && chmod "$_mode" "$_dst.new"
    sync
    mv -f "$_dst.new" "$_dst" || { rm -f "$_dst.new"; return 1; }
    sync
}

_flash_md5() {
    sync
    echo 3 > /proc/sys/vm/drop_caches 2>/dev/null
    md5sum "$1" 2>/dev/null | cut -d' ' -f1
}

_list_stage() {
    (cd "$1" && find . -type f | sed 's|^\./||' | sort)
}

do_deploy() {
    local _phase="$1"
    local _stage="$2"
    local _bak="$BAK_BASE/$_phase"
    local _rel
    local _want
    local _got
    local _bad=0
    [ -d "$_stage" ] || die "no stage dir: $_stage"
    _list_stage "$_stage" > /tmp/deploy_list.$$
    [ -s /tmp/deploy_list.$$ ] || { rm -f /tmp/deploy_list.$$; die "stage dir is empty"; }

    # Refuse CRLF scripts before touching anything (a CR in a #! line breaks it).
    while IFS= read -r _rel; do
        if head -c 2 "$_stage/$_rel" 2>/dev/null | grep -q '^#!'; then
            if grep -q "$CR" "$_stage/$_rel"; then
                rm -f /tmp/deploy_list.$$
                die "CRLF in $_rel; strip it before staging"
            fi
        fi
    done < /tmp/deploy_list.$$

    mkdir -p "$_bak/root" || die "cannot create $_bak"
    : > "$_bak/md5.after.new"
    # md5.before is cumulative across runs of the phase: copied, appended, renamed.
    if [ -f "$_bak/md5.before" ]; then
        cp "$_bak/md5.before" "$_bak/md5.before.new"
    else
        : > "$_bak/md5.before.new"
    fi

    # 1. Back up originals (the first time a path is seen by this phase).
    while IFS= read -r _rel; do
        if grep -qxF "absent  $R/$_rel" "$_bak/md5.before.new"; then
            # Added by this phase on an earlier run: not an original.
            :
        elif [ -e "$R/$_rel" ] && [ ! -e "$_bak/root/$_rel" ]; then
            _durable_copy "$R/$_rel" "$_bak/root/$_rel" || die "backup failed: $R/$_rel"
            echo "$(md5sum "$R/$_rel" | cut -d' ' -f1)  $R/$_rel" >> "$_bak/md5.before.new"
        elif [ ! -e "$R/$_rel" ] && [ ! -e "$_bak/root/$_rel" ]; then
            echo "absent  $R/$_rel" >> "$_bak/md5.before.new"
        fi
    done < /tmp/deploy_list.$$
    sync
    mv -f "$_bak/md5.before.new" "$_bak/md5.before"
    sync

    # 2. Install.
    while IFS= read -r _rel; do
        _durable_copy "$_stage/$_rel" "$R/$_rel" || { echo "deploy: FAILED $R/$_rel" >&2; _bad=1; }
    done < /tmp/deploy_list.$$

    # 3. Verify from flash.
    while IFS= read -r _rel; do
        _want=$(md5sum "$_stage/$_rel" | cut -d' ' -f1)
        _got=$(_flash_md5 "$R/$_rel")
        echo "$_want  $R/$_rel" >> "$_bak/md5.after.new"
        if [ "$_want" = "$_got" ]; then
            echo "ok   $R/$_rel $_got"
        else
            echo "BAD  $R/$_rel want=$_want got=$_got" >&2
            _bad=1
        fi
    done < /tmp/deploy_list.$$
    sync
    mv -f "$_bak/md5.after.new" "$_bak/md5.after"
    sync
    rm -f /tmp/deploy_list.$$
    [ "$_bad" -eq 0 ] || die "deploy incomplete; see above (restore: $0 --restore $_phase)"
    echo "deploy: phase $_phase installed and verified from flash; restart the touched service now"
}

do_restore() {
    local _phase="$1"
    local _bak="$BAK_BASE/$_phase"
    local _rel
    local _bad=0
    [ -d "$_bak/root" ] || die "no backup for phase $_phase"
    _list_stage "$_bak/root" > /tmp/deploy_list.$$
    while IFS= read -r _rel; do
        _durable_copy "$_bak/root/$_rel" "$R/$_rel" || { echo "restore: FAILED $R/$_rel" >&2; _bad=1; continue; }
        if [ "$(md5sum "$_bak/root/$_rel" | cut -d' ' -f1)" = "$(_flash_md5 "$R/$_rel")" ]; then
            echo "restored $R/$_rel"
        else
            echo "BAD  $R/$_rel after restore" >&2
            _bad=1
        fi
    done < /tmp/deploy_list.$$
    rm -f /tmp/deploy_list.$$
    # Files the phase added (absent before) are listed, not deleted.
    [ -f "$_bak/md5.before" ] && grep '^absent ' "$_bak/md5.before" | sed 's/^absent  /added by the phase, remove by hand if needed: /'
    [ "$_bad" -eq 0 ] || die "restore incomplete"
    echo "restore: phase $_phase restored; restart the touched service now"
}

do_verify() {
    local _bak="$BAK_BASE/$1/md5.after"
    local _want
    local _path
    local _bad=0
    [ -f "$_bak" ] || die "no manifest $_bak"
    while read -r _want _path; do
        if [ "$_want" = "$(_flash_md5 "$_path")" ]; then
            echo "ok   $_path"
        else
            echo "BAD  $_path" >&2
            _bad=1
        fi
    done < "$_bak"
    [ "$_bad" -eq 0 ]
}

case "$1" in
    --restore) [ -n "$2" ] || die "usage: $0 --restore <phase>"; do_restore "$2" ;;
    --verify)  [ -n "$2" ] || die "usage: $0 --verify <phase>"; do_verify "$2" ;;
    ''|-*)     die "usage: $0 <phase> <stage_dir> | --restore <phase> | --verify <phase>" ;;
    *)         [ -n "$2" ] || die "usage: $0 <phase> <stage_dir>"; do_deploy "$1" "$2" ;;
esac
