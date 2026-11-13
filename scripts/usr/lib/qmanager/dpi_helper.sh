#!/bin/sh
# dpi_helper.sh — Video Optimizer (DPI evasion) shared functions
# Sourced by: qmanager_dpi (init.d), qmanager_dpi_tpws, video_optimizer.sh (CGI),
# qmanager_dpi_verify
#
# TWO ENGINES, ONE VIDEO OPTIMIZER
#
#   nfqws  packet-queue engine. Needs NFQUEUE in the kernel; it is handed packets
#          by the static nft rules in /etc/nftables.d/12-mangle-qmanager-dpi.nft.
#          Also the only engine that can do Masquerade (fake-SNI injection).
#   tpws   redirect engine. Needs only iptables REDIRECT, so it is the default
#          where NFQUEUE is absent. Driven by NAT rules this file adds and
#          removes (see the DPI_TPWS_* block below) and supervised by
#          /usr/bin/qmanager_dpi_tpws.
#
# Revert everything by hand:
#   /etc/init.d/qmanager_dpi stop && /etc/init.d/qmanager_dpi disable
#   iptables -t nat -D PREROUTING -j QMANAGER_DPI_TPWS
#   iptables -t nat -F QMANAGER_DPI_TPWS; iptables -t nat -X QMANAGER_DPI_TPWS

[ -n "$_DPI_HELPER_LOADED" ] && return 0
_DPI_HELPER_LOADED=1
[ -f /usr/lib/qmanager/safe_tmp.sh ] && . /usr/lib/qmanager/safe_tmp.sh

NFQWS_BIN="/usr/bin/nfqws"
NFQWS_PID="/var/run/nfqws.pid"
TPWS_BIN="/usr/bin/tpws"
# procd owns this pidfile and writes the supervisor's pid into it. Status is
# proved from the LISTENER, not this file: the listener is what the redirect
# rules depend on. The pidfile is kept for uptime (its mtime is the last spawn).
TPWS_PID="/var/run/tpws.pid"
DPI_ENGINE_NFQWS="nfqws"
DPI_ENGINE_TPWS="tpws"
DPI_HOSTLIST="/etc/qmanager/video_domains.txt"
DPI_HOSTLIST_DEFAULT="/etc/qmanager/video_domains_default.txt"
DPI_QUEUE_NUM=200
# The redirect engine's listening port. Any free high port works; REDIRECT
# rewrites the destination to it, so it must never collide with a local service
# (uhttpd listens on 80 and on the web port, never here).
DPI_TPWS_PORT=12443
# Our own NAT chain. Nothing else references it, so teardown is one jump plus
# -F/-X on this chain and cannot disturb fw4's rules.
DPI_TPWS_CHAIN="QMANAGER_DPI_TPWS"
# Auto-detect cellular interface from default route, fallback to rmnet_data0
DPI_INTERFACE=$(ip route 2>/dev/null | awk '/^default/{print $5; exit}')
DPI_INTERFACE="${DPI_INTERFACE:-rmnet_data0}"
DPI_NFT_COMMENT="qmanager_dpi"

# Check if nfqws binary is installed and executable
dpi_check_binary() {
    [ -x "$NFQWS_BIN" ]
}

# Check if tpws (the redirect engine) is installed and executable
dpi_check_tpws_binary() {
    [ -x "$TPWS_BIN" ]
}

# dpi_check_engine_binary ENGINE — is that engine's binary installed?
dpi_check_engine_binary() {
    case "$1" in
        "$DPI_ENGINE_TPWS") dpi_check_tpws_binary ;;
        *) dpi_check_binary ;;
    esac
}

# dpi_engine_pidfile ENGINE — the pidfile procd keeps for that engine
dpi_engine_pidfile() {
    case "$1" in
        "$DPI_ENGINE_TPWS") printf '%s' "$TPWS_PID" ;;
        *) printf '%s' "$NFQWS_PID" ;;
    esac
}

# dpi_default_engine — tpws wherever the packet queue is unavailable, which is
# the whole reason the redirect engine exists. Prints the engine name.
dpi_default_engine() {
    if dpi_check_kmod; then
        printf '%s' "$DPI_ENGINE_NFQWS"
    else
        printf '%s' "$DPI_ENGINE_TPWS"
    fi
}

# dpi_vo_engine — the Video Optimizer's engine: the saved choice, else the
# default. An unrecognised stored value falls back to the default rather than
# failing a save (the CGI refuses a bad value on write; this is the read path).
dpi_vo_engine() {
    local e
    e=$(uci -q get quecmanager.video_optimizer.engine)
    case "$e" in
        "$DPI_ENGINE_NFQWS"|"$DPI_ENGINE_TPWS") printf '%s' "$e" ;;
        *) dpi_default_engine ;;
    esac
}

# Check if NFQUEUE kernel support is available (built-in or module)
dpi_check_kmod() {
    # Check if compiled into kernel (CONFIG_NETFILTER_NETLINK_QUEUE=y)
    if zcat /proc/config.gz 2>/dev/null | grep -q 'CONFIG_NETFILTER_NETLINK_QUEUE=y'; then
        return 0
    fi
    # Check if loaded as module
    if lsmod 2>/dev/null | grep -q nfnetlink_queue; then
        return 0
    fi
    # Try loading as module
    modprobe nfnetlink_queue 2>/dev/null || return 1
    return 0
}

# nftables rules are now shipped as a static /etc/nftables.d/12-mangle-qmanager-dpi.nft
# file (sourced by fw4 on every load/reload — survives `fw4 reload`). No runtime
# rule manipulation needed here. See that file for the rule definitions. Those
# rules carry `bypass`, so they are inert while nfqws is not bound to the queue.

# -----------------------------------------------------------------------------
# Redirect engine (tpws): NAT rules + listener proof
# -----------------------------------------------------------------------------
# SAFETY INVARIANT: a REDIRECT rule whose listener is gone refuses ALL HTTPS for
# the traffic it matches, so the rules may exist ONLY while a verified listener
# does. Every function here is written to keep that true in both directions:
# rules are added after the listener is proven, and removed before the engine is
# stopped (and again if anything crashed).

# dpi_lan_device — the LAN bridge the redirect is scoped to.
#
# Scoping to the LAN is what makes a mistake harmless: if the name is wrong the
# rule matches nothing and the engine simply does not intercept (no traffic
# broken), whereas an unscoped PREROUTING rule would also capture WAN-inbound
# port forwards on 443. There is deliberately no OUTPUT rule: redirecting the
# router's own traffic would loop the engine's own outbound connections back
# into itself.
dpi_lan_device() {
    local d
    d=$(uci -q get network.lan.device)
    if [ -z "$d" ]; then
        d=$(uci -q get network.lan.ifname)
        set -- $d
        d="${1:-}"
    fi
    printf '%s' "${d:-br-lan}"
}

# dpi_tpws_listening — is anything LISTENing on $DPI_TPWS_PORT?
#
# /proc/net/tcp instead of netstat/ss (this BusyBox has neither reliably): the
# local address column is ADDR:PORT in hex and st is 0A for LISTEN.
dpi_tpws_listening() {
    local hexport
    hexport=$(printf '%04X' "$DPI_TPWS_PORT" 2>/dev/null)
    [ -n "$hexport" ] || return 1
    awk -v p="$hexport" '$4 == "0A" && $2 ~ (":" p "$") { found = 1 } END { exit(found ? 0 : 1) }' \
        /proc/net/tcp 2>/dev/null
}

# dpi_tpws_rules_present — our jump is in place (so traffic IS being redirected)
dpi_tpws_rules_present() {
    command -v iptables >/dev/null 2>&1 || return 1
    iptables -t nat -C PREROUTING -j "$DPI_TPWS_CHAIN" >/dev/null 2>&1
}

# dpi_tpws_rules_add — build the chain, then the one jump into it.
#
# Order matters as much as it does on the way out: the main chain is built first
# and nothing jumps to it yet, so a failure part way through leaves an INERT
# chain rather than a redirect to a port nobody is serving. The caller removes
# the leftovers when this returns non-zero.
dpi_tpws_rules_add() {
    local lan
    if ! command -v iptables >/dev/null 2>&1; then
        return 1
    fi
    lan=$(dpi_lan_device)
    # A chain left behind by a hard kill is emptied, never appended to.
    if ! iptables -t nat -N "$DPI_TPWS_CHAIN" 2>/dev/null; then
        iptables -t nat -F "$DPI_TPWS_CHAIN" 2>/dev/null || return 1
    fi
    iptables -t nat -A "$DPI_TPWS_CHAIN" -i "$lan" -p tcp --dport 443 \
        -j REDIRECT --to-ports "$DPI_TPWS_PORT" || return 1
    # A second identical jump would be accepted by iptables and would redirect
    # every matching packet twice, so the jump is only inserted when missing.
    if ! dpi_tpws_rules_present; then
        iptables -t nat -I PREROUTING 1 -j "$DPI_TPWS_CHAIN" || return 1
    fi
    return 0
}

# dpi_tpws_rules_remove — drop the jump FIRST, then flush and delete the chain.
#
# Removing the jump is what stops the interception, so it must come first even
# though the chain deletion follows in the same call. Idempotent: every step is
# allowed to fail because "already gone" is the desired end state.
dpi_tpws_rules_remove() {
    local i
    if ! command -v iptables >/dev/null 2>&1; then
        return 0
    fi
    i=0
    while [ "$i" -lt 8 ]; do
        iptables -t nat -D PREROUTING -j "$DPI_TPWS_CHAIN" 2>/dev/null || break
        i=$((i + 1))
    done
    iptables -t nat -F "$DPI_TPWS_CHAIN" 2>/dev/null
    iptables -t nat -X "$DPI_TPWS_CHAIN" 2>/dev/null
    return 0
}

# dpi_tpws_args — the tpws command line for Video Optimizer mode.
#
# --hostlist matches the SAME list the packet-queue engine uses, so "Acts on"
# means the same thing in both engines. tpws is a transparent relay for every
# connection redirected to it and only desyncs the ones whose SNI is listed, so
# the redirect rule can stay broad and UDP/QUIC is untouched (tpws handles TCP
# only; nothing here drops or blocks QUIC — that is the operator's call).
dpi_tpws_args() {
    printf '%s' "--port=$DPI_TPWS_PORT --hostlist=$DPI_HOSTLIST --split-pos=1 --disorder"
}

# dpi_engine_status ENGINE — running or stopped.
#
# nfqws proves itself through its pidfile (qm_read_pid, B5.11). tpws is proven by
# its listener: that is the fact the redirect rules depend on, and a supervisor
# pid alone would not tell us whether connections are being served.
dpi_engine_status() {
    case "$1" in
        "$DPI_ENGINE_TPWS")
            if dpi_tpws_listening; then
                echo "running"
            else
                echo "stopped"
            fi
            ;;
        *) dpi_get_status ;;
    esac
}

# Get service status: running, stopped, or error (the packet-queue engine)
dpi_get_status() {
    # B5.11: /var/run is root-only, but still require a root-owned pidfile
    # whose pid really is nfqws (a stale pid can be reused by anything).
    if command -v qm_read_pid >/dev/null 2>&1; then
        if qm_read_pid "$NFQWS_PID" nfqws >/dev/null; then
            echo "running"
        else
            echo "stopped"
        fi
        return
    fi
    if [ -f "$NFQWS_PID" ] && kill -0 "$(cat "$NFQWS_PID" 2>/dev/null)" 2>/dev/null; then
        echo "running"
    else
        echo "stopped"
    fi
}

# Calculate uptime from PID file timestamp
dpi_get_uptime() {
    local pidfile
    local now pid_mtime elapsed
    pidfile="${1:-$NFQWS_PID}"
    if [ ! -f "$pidfile" ]; then
        echo "0s"
        return
    fi

    now=$(date +%s)
    # `date -r` rather than `stat -c %Y`: this board's BusyBox has no stat(1),
    # where the old line yielded "" and every caller saw "0s".
    pid_mtime=$(date -r "$pidfile" +%s 2>/dev/null) || { echo "0s"; return; }
    elapsed=$((now - pid_mtime))

    if [ "$elapsed" -ge 86400 ]; then
        echo "$((elapsed / 86400))d $((elapsed % 86400 / 3600))h"
    elif [ "$elapsed" -ge 3600 ]; then
        echo "$((elapsed / 3600))h $((elapsed % 3600 / 60))m"
    elif [ "$elapsed" -ge 60 ]; then
        echo "$((elapsed / 60))m $((elapsed % 60))s"
    else
        echo "${elapsed}s"
    fi
}

# Read packet count from the engine's own rule counters.
#   nfqws: the persistent nft chain (see the .nft file).
#   tpws:  our NAT chain — one REDIRECT rule, so the counter is the number of
#          connections it has intercepted.
dpi_get_packet_count() {
    local count=0
    case "${1:-$DPI_ENGINE_NFQWS}" in
        "$DPI_ENGINE_TPWS")
            count=$(iptables -t nat -L "$DPI_TPWS_CHAIN" -vnx 2>/dev/null | \
                awk '$3 == "REDIRECT" { sum += $1 } END { print sum+0 }')
            ;;
        *)
            count=$(nft list chain inet fw4 mangle_postrouting_qmanager_dpi 2>/dev/null | \
                awk '/packets/ {for(i=1;i<=NF;i++) if($i=="packets") sum+=$(i+1)} END {print sum+0}')
            ;;
    esac
    echo "${count:-0}"
}

# Count domains loaded from hostlist. Prints exactly ONE integer, because the
# caller feeds it to `jq --argjson`: `grep -c` prints `0` AND exits 1 when
# nothing matches, so a trailing `|| echo 0` emitted a second line, jq then
# rejected "0\n0" and printed nothing - the engine's whole GET came back empty
# and the Traffic Engine page could only show its load-error card, with no way
# back through the UI (the hostname editor is behind that same read).
dpi_get_domain_count() {
    if [ -f "$DPI_HOSTLIST" ]; then
        grep -v '^[[:space:]]*#' "$DPI_HOSTLIST" 2>/dev/null \
            | grep -c -v '^[[:space:]]*$' || true
    else
        echo "0"
    fi
}