#!/bin/sh
# smartdns_lib.sh — SmartDNS resolver: package facts, config rendering, dnsmasq wiring
# Sourced by: scripts/etc/init.d/qmanager_smartdns, network/smartdns.sh (CGI),
#             qmanager_smartdns_install, uninstall.sh
#
# WHAT THIS FEATURE IS
#   smartdns is a loopback cache-and-race resolver. It is NOT the LAN-facing
#   resolver: dnsmasq keeps 192.168.88.1:53, DHCP and the lease names. smartdns
#   listens on 127.0.0.1:<port> and is used only once the operator turns on
#   `lan_dns`, which adds it to dnsmasq's upstream list IN FRONT of the carrier
#   resolvers with `strictorder`. That layering is what makes the switch safe:
#   with the resolver stopped or useless, dnsmasq falls through to the carrier
#   and the LAN still resolves names.
#
# THE SOURCE OF TRUTH IS UCI, NOT THE CONFIG FILE
#   /etc/qmanager/smartdns/smartdns.conf is GENERATED from quecmanager.smartdns
#   on every service start and on every save. Hand edits are overwritten on the
#   next start — by design: it keeps one writer, and it means a reboot restores
#   the operator's settings rather than whatever the file last said. (The
#   greenpacket reference build ships a free-text config editor instead; we do
#   not, because it would hand a root daemon an arbitrary directive string.)
#
# NOBODY MAY ASSUME smartdns IS INSTALLED
#   This device has no smartdns package, and the runbook forbids `opkg install`
#   for missing *utilities*. smartdns is a product feature, so installing it is
#   allowed — but only as an explicit operator action (qmanager_smartdns_install)
#   and every entry point here has to degrade cleanly when the binary is absent:
#   smartdns_installed returns 1, the service refuses to start, and the CGI
#   still answers 200 with installed:false.

[ -n "$_SMARTDNS_LIB_LOADED" ] && return 0
_SMARTDNS_LIB_LOADED=1

# safe_tmp.sh for qm_durable_write / qm_atomic_write / qm_run_dir. Guarded: a
# `.` on a missing file aborts a non-interactive BusyBox ash script.
[ -f /usr/lib/qmanager/safe_tmp.sh ] && . /usr/lib/qmanager/safe_tmp.sh

SMARTDNS_DIR="/etc/qmanager/smartdns"
SMARTDNS_CONF="$SMARTDNS_DIR/smartdns.conf"
SMARTDNS_BACKUP="$SMARTDNS_DIR/smartdns.conf.pre-qmanager"
# Ledger of the dnsmasq upstream entries THIS feature added, one per line. Unwire
# deletes exactly these and nothing else, so an operator's own `server` entries
# survive both a save and an uninstall.
SMARTDNS_WIRED_LIST="$SMARTDNS_DIR/dnsmasq-wired.list"
# The `strictorder` value found before the first wire, or the literal `unset`.
SMARTDNS_STRICT_PREV="$SMARTDNS_DIR/dnsmasq-strictorder.prev"
SMARTDNS_INSTALL_RESULT="/tmp/qmanager_smartdns_install.json"

SMARTDNS_UCI="quecmanager.smartdns"
SMARTDNS_DEFAULT_PORT=5353
SMARTDNS_DEFAULT_CACHE=4096
# Plain resolvers used ONLY to look up the DoH hostnames themselves. They never
# answer client queries, so a blocked DoH endpoint cannot take DNS down through
# them.
SMARTDNS_DEFAULT_BOOTSTRAP="1.1.1.1 8.8.8.8"
# The shipped pool. Deliberately three, and deliberately not measured here: the
# reference build measured these on a DIFFERENT network, so its near/far classes
# do not transfer. smartdns races every `server` it has, so one endpoint being
# unreachable costs a race, not an answer.
SMARTDNS_DEFAULT_UPSTREAM="https://dns.google/dns-query https://cloudflare-dns.com/dns-query https://dns.quad9.net/dns-query"
# Where the carrier's own resolvers are recorded. dnsmasq reads the first; the
# second is the OpenWrt fallback when the resolv.d directory is absent.
SMARTDNS_RESOLV_AUTO="/tmp/resolv.conf.d/resolv.conf.auto"
SMARTDNS_RESOLV_AUTO_ALT="/tmp/resolv.conf.auto"

# --- binary and package -----------------------------------------------------

# smartdns_bin — print the resolver binary path. The OpenWrt package installs
# /usr/sbin/smartdns; /usr/bin is the location a manual smartdns-rs drop uses.
smartdns_bin() {
    for _sd_b in /usr/sbin/smartdns /usr/bin/smartdns; do
        [ -x "$_sd_b" ] && { printf '%s' "$_sd_b"; return 0; }
    done
    return 1
}

smartdns_installed() { smartdns_bin >/dev/null 2>&1; }

# smartdns_package_installed — the opkg record, not the binary. The install
# helper needs this to refuse a second install and to know what to remove.
smartdns_package_installed() {
    opkg list-installed 2>/dev/null | grep -q '^smartdns '
}

# --- UCI settings -----------------------------------------------------------

# smartdns_ensure_section — create the section and backfill missing keys.
# Idempotent, and the same defaults install.sh seeds, so an OTA onto a device
# whose section predates a key still ends up complete.
smartdns_ensure_section() {
    local changed=0
    local v

    [ -n "$(uci -q get "$SMARTDNS_UCI")" ] || {
        uci set "$SMARTDNS_UCI=smartdns" || return 1
        changed=1
    }

    v=$(uci -q get "$SMARTDNS_UCI.enabled")
    [ -n "$v" ] || { uci set "$SMARTDNS_UCI.enabled=0"; changed=1; }
    v=$(uci -q get "$SMARTDNS_UCI.lan_dns")
    [ -n "$v" ] || { uci set "$SMARTDNS_UCI.lan_dns=0"; changed=1; }
    v=$(uci -q get "$SMARTDNS_UCI.port")
    [ -n "$v" ] || { uci set "$SMARTDNS_UCI.port=$SMARTDNS_DEFAULT_PORT"; changed=1; }
    v=$(uci -q get "$SMARTDNS_UCI.cache_size")
    [ -n "$v" ] || { uci set "$SMARTDNS_UCI.cache_size=$SMARTDNS_DEFAULT_CACHE"; changed=1; }
    v=$(uci -q get "$SMARTDNS_UCI.prefetch")
    [ -n "$v" ] || { uci set "$SMARTDNS_UCI.prefetch=1"; changed=1; }
    v=$(uci -q get "$SMARTDNS_UCI.upstream")
    [ -n "$v" ] || {
        for v in $SMARTDNS_DEFAULT_UPSTREAM; do
            uci add_list "$SMARTDNS_UCI.upstream=$v"
        done
        changed=1
    }
    v=$(uci -q get "$SMARTDNS_UCI.bootstrap")
    [ -n "$v" ] || {
        for v in $SMARTDNS_DEFAULT_BOOTSTRAP; do
            uci add_list "$SMARTDNS_UCI.bootstrap=$v"
        done
        changed=1
    }

    [ "$changed" = "1" ] && uci commit quecmanager 2>/dev/null
    return 0
}

# smartdns_uci KEY DEFAULT — one setting, with a fallback for a missing key.
smartdns_uci() {
    _su_v=$(uci -q get "$SMARTDNS_UCI.$1" 2>/dev/null)
    [ -n "$_su_v" ] || _su_v="$2"
    printf '%s' "$_su_v"
}

# smartdns_port — the loopback port, clamped to a usable range. A corrupt value
# must not produce a `bind` line the daemon refuses at boot with no explanation.
smartdns_port() {
    _sp_v=$(smartdns_uci port "$SMARTDNS_DEFAULT_PORT")
    case "$_sp_v" in
        ''|*[!0-9]*) _sp_v=$SMARTDNS_DEFAULT_PORT ;;
        *)
            if [ "$_sp_v" -lt 1024 ] || [ "$_sp_v" -gt 65535 ]; then
                _sp_v=$SMARTDNS_DEFAULT_PORT
            fi
            ;;
    esac
    printf '%s' "$_sp_v"
}

smartdns_cache_size() {
    _sc_v=$(smartdns_uci cache_size "$SMARTDNS_DEFAULT_CACHE")
    case "$_sc_v" in
        ''|*[!0-9]*) _sc_v=$SMARTDNS_DEFAULT_CACHE ;;
        *)
            if [ "$_sc_v" -lt 512 ] || [ "$_sc_v" -gt 65536 ]; then
                _sc_v=$SMARTDNS_DEFAULT_CACHE
            fi
            ;;
    esac
    printf '%s' "$_sc_v"
}

# smartdns_upstreams — the configured upstream list, one per line.
smartdns_upstreams() {
    uci -q get "$SMARTDNS_UCI.upstream" 2>/dev/null | tr ' ' '\n' | grep -v '^$'
}

# smartdns_upstream_valid VALUE — a config line is only as safe as its
# characters. The value is written into a generated file, so anything that could
# end the line (whitespace, `#`) or start a new directive is rejected outright
# rather than escaped.
smartdns_upstream_valid() {
    case "$1" in
        https://*|tls://*|http://*|quic://*|h3://*) ;;
        *) return 1 ;;
    esac
    # Anything outside this set could end the generated line (space, `#`) or
    # start a new directive. `&` is tested on its own: BusyBox's parser reads an
    # `&` inside a bracket expression as a control operator and refuses the file.
    case "$1" in
        *[!A-Za-z0-9:/._?=%+~-]*) return 1 ;;
        *'&'*) return 1 ;;
    esac
    return 0
}

# --- config rendering -------------------------------------------------------

# smartdns_render_body PORT CACHE PREFETCH UPSTREAMS BOOTSTRAP — print a config
# from the given values, one upstream per line in UPSTREAMS.
#
# Split out from smartdns_render_conf so the save path can validate a candidate
# settings set BEFORE it is committed to UCI. Validating after the commit would
# mean either a rollback of the operator's own config or a settings set that is
# live and unrunnable.
#
smartdns_render_body() {
    _srb_ok=0

    printf '# SmartDNS — GENERATED by QManager from uci %s\n' "$SMARTDNS_UCI"
    printf '# Edits here are overwritten on the next start or save.\n'
    printf 'bind 127.0.0.1:%s\n' "$1"
    printf 'cache-size %s\n' "$2"
    printf 'serve-expired yes\n'

    if [ "$3" = "1" ]; then
        printf 'prefetch-domain yes\n'
    else
        printf 'prefetch-domain no\n'
    fi

    for _srb_u in $4; do
        smartdns_upstream_valid "$_srb_u" || continue
        printf 'server %s\n' "$_srb_u"
        _srb_ok=$((_srb_ok + 1))
    done

    # A resolver with no server answers nothing. Refusing here is what keeps the
    # service from starting into a state the page then has to explain.
    [ "$_srb_ok" -gt 0 ] || return 1

    for _srb_b in $5; do
        case "$_srb_b" in
            ''|*[!0-9a-fA-F:.]*) continue ;;
        esac
        printf 'bootstrap-dns %s\n' "$_srb_b"
    done

    return 0
}

# smartdns_render_conf [PORT] — print the config for the CURRENT uci settings.
#
# PORT exists for validation: the candidate is proved on a throwaway port, and
# since the port lives in a `bind` line we generate, substituting it here is
# exact. Passing `-p` on the command line instead would NOT be exact — an
# explicit `bind` directive outranks it, so the test instance would fight the
# live one for the real port and always fail.
smartdns_render_conf() {
    _src_port="${1:-$(smartdns_port)}"
    smartdns_render_body \
        "$_src_port" \
        "$(smartdns_cache_size)" \
        "$(smartdns_uci prefetch '1')" \
        "$(uci -q get "$SMARTDNS_UCI.upstream" 2>/dev/null)" \
        "$(uci -q get "$SMARTDNS_UCI.bootstrap" 2>/dev/null)"
}

# smartdns_write_conf — render and install the config durably, keeping the
# previous file as .pre-qmanager. Returns 1 without touching the live file when
# rendering fails.
smartdns_write_conf() {
    local text
    text=$(smartdns_render_conf) || return 1
    qm_smartdns_mode_dir || return 1
    if [ -f "$SMARTDNS_CONF" ]; then
        cp "$SMARTDNS_CONF" "$SMARTDNS_BACKUP" 2>/dev/null
    fi
    printf '%s\n' "$text" | qm_durable_write "$SMARTDNS_CONF" 0600 || return 1
    return 0
}

# qm_smartdns_mode_dir — make $SMARTDNS_DIR a real root-owned 0700 directory.
# It holds a root daemon's config and the wiring ledger; the CGI writes here, and
# a directory another user created first would make every write steerable.
qm_smartdns_mode_dir() {
    qm_root_dir "$SMARTDNS_DIR" 0700 || return 1
}

# smartdns_free_port — a throwaway port for validation, printed. Scans upward
# from 15353 because a stale validation instance from a killed CGI is possible
# and binding a port something else holds would report a good config as bad.
smartdns_free_port() {
    _sfp_p=15353
    while [ "$_sfp_p" -lt 15373 ]; do
        smartdns_port_listening "$_sfp_p" || { printf '%s' "$_sfp_p"; return 0; }
        _sfp_p=$((_sfp_p + 1))
    done
    return 1
}

# --- process and listener facts --------------------------------------------

# smartdns_pid — the daemon running OUR config, found through /proc. Excluded by
# construction: a validation instance, which runs a different config path.
smartdns_pid() {
    for _sp_d in /proc/[0-9]*; do
        [ "$(cat "$_sp_d/comm" 2>/dev/null)" = "smartdns" ] || continue
        _sp_c=$(tr '\0' ' ' < "$_sp_d/cmdline" 2>/dev/null) || continue
        case "$_sp_c" in
            *"$SMARTDNS_CONF"*) printf '%s' "${_sp_d#/proc/}"; return 0 ;;
        esac
    done
    return 1
}

# smartdns_proc_uptime PID — seconds since the process started, or `null`.
# From /proc only: `ps -o etimes` is not portable across BusyBox builds, and
# `date +%s%N` has no sub-second resolution on this board.
smartdns_proc_uptime() {
    _spt_st=$(awk '{print $22}' "/proc/$1/stat" 2>/dev/null)
    case "$_spt_st" in ''|*[!0-9]*) printf 'null'; return ;; esac
    _spt_now=$(cut -d. -f1 /proc/uptime 2>/dev/null)
    case "$_spt_now" in ''|*[!0-9]*) printf 'null'; return ;; esac
    # HZ=100 on this target (aarch64 OpenWrt). A wrong HZ shows up as an uptime
    # that disagrees with the service's own log lines, not as a failure.
    _spt_sec=$(( _spt_now - _spt_st / 100 ))
    [ "$_spt_sec" -lt 0 ] && _spt_sec=0
    printf '%s' "$_spt_sec"
}

# smartdns_port_listening [PORT] — is something bound to 127.0.0.1:PORT?
#
# Read from /proc/net directly rather than `netstat`: this board's BusyBox may
# or may not carry the applet, and an absent applet prints nothing — which reads
# as "not listening" and would make a healthy resolver look dead.
smartdns_port_listening() {
    _spl_port="${1:-$(smartdns_port)}"
    _spl_hex=$(printf '%04X' "$_spl_port" 2>/dev/null) || return 1
    case "$_spl_hex" in ''|*[!0-9A-F]*) return 1 ;; esac

    for _spl_f in /proc/net/udp /proc/net/udp6; do
        [ -r "$_spl_f" ] || continue
        awk -v want="$_spl_hex" '
            NR > 1 { n = split($2, a, ":"); if (a[n] == want) { f = 1; exit } }
            END { exit !f }
        ' "$_spl_f" && return 0
    done

    # A TCP listener is accepted too (smartdns can be configured both ways); an
    # outbound connection that happens to use this local port is not, which is
    # why the state must be 0A (LISTEN).
    for _spl_f in /proc/net/tcp /proc/net/tcp6; do
        [ -r "$_spl_f" ] || continue
        awk -v want="$_spl_hex" '
            NR > 1 { n = split($2, a, ":"); if (a[n] == want && $4 == "0A") { f = 1; exit } }
            END { exit !f }
        ' "$_spl_f" && return 0
    done

    return 1
}

# --- dnsmasq wiring ---------------------------------------------------------

# smartdns_dnsmasq_section — the dnsmasq UCI section to extend, printed as a UCI
# path suffix (`@dnsmasq[0]` or a named section). Resolved from the config, never
# hardcoded: dns.sh in this tree writes to `dhcp.lan_dns`, which is a different
# section name on a different firmware.
smartdns_dnsmasq_section() {
    # Two passes, no alternation: BusyBox sed does not reliably support `\|` in
    # a basic regex, and a silent non-match here would make `wire` a no-op that
    # reported success.
    _sdd_sec=$(uci show dhcp 2>/dev/null | awk -F'=' '$2 == "dnsmasq" { print $1 }' \
        | sed -n 's/^dhcp\.\(@dnsmasq\[[0-9][0-9]*\]\)$/\1/p' | head -n 1)
    if [ -z "$_sdd_sec" ]; then
        _sdd_sec=$(uci show dhcp 2>/dev/null | awk -F'=' '$2 == "dnsmasq" { print $1 }' \
            | sed -n 's/^dhcp\.\([A-Za-z0-9_][A-Za-z0-9_]*\)$/\1/p' | head -n 1)
    fi
    [ -n "$_sdd_sec" ] || return 1
    printf '%s' "$_sdd_sec"
}

# smartdns_carrier_resolvers — the carrier's own nameservers, as dnsmasq's
# fallback tier. Read live because they change per SIM and per network; a
# hardcoded pair would be a resolver the router does not actually use.
smartdns_carrier_resolvers() {
    for _scr_f in "$SMARTDNS_RESOLV_AUTO" "$SMARTDNS_RESOLV_AUTO_ALT"; do
        [ -r "$_scr_f" ] || continue
        awk '/^nameserver[[:space:]]+[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/ { print $2 }' "$_scr_f" \
            | grep -v '^127\.' \
            | awk '!seen[$0]++' \
            | head -n 2
        return 0
    done
    return 1
}

# smartdns_wired — is our loopback entry in dnsmasq's upstream list?
smartdns_wired() {
    _sw_sec=$(smartdns_dnsmasq_section) || return 1
    _sw_port=$(smartdns_port)
    uci -q get "dhcp.$_sw_sec.server" 2>/dev/null \
        | tr ' ' '\n' \
        | grep -qx "127\.0\.0\.1#$_sw_port"
}

# smartdns_other_upstreams — how many `server` entries in the dnsmasq section are
# neither ours nor the carrier fallbacks we added. A non-zero count means Custom
# DNS (or a hand edit) already names upstreams; with our loopback entry first and
# `strictorder` set they are used only when the resolver does not answer, which is
# the right behaviour — but the page says so rather than leaving the operator to
# discover it.
#
# The ledger is subtracted because the carrier entries are part of OUR wiring:
# counting them would report a conflict that does not exist.
smartdns_other_upstreams() {
    _sfo_sec=$(smartdns_dnsmasq_section) || { printf '0'; return; }
    _sfo_port=$(smartdns_port)
    _sfo_n=0

    if [ -f "$SMARTDNS_WIRED_LIST" ]; then
        _sfo_n=$(uci -q get "dhcp.$_sfo_sec.server" 2>/dev/null | tr ' ' '\n' \
            | grep -v '^$' \
            | awk -v ours="127.0.0.1#$_sfo_port" '
                NR == FNR { skip[$0] = 1; next }
                $0 == ours { next }
                !($0 in skip) { n++ }
                END { print n + 0 }
            ' "$SMARTDNS_WIRED_LIST" -)
    else
        _sfo_n=$(uci -q get "dhcp.$_sfo_sec.server" 2>/dev/null | tr ' ' '\n' \
            | grep -v '^$' | grep -vxF "127.0.0.1#$_sfo_port" | wc -l | tr -d ' ')
    fi

    case "$_sfo_n" in ''|*[!0-9]*) _sfo_n=0 ;; esac
    printf '%s' "$_sfo_n"
}

# smartdns_wire — put the resolver in front of the carrier, reversibly.
#
# Order matters and is the whole safety story: our loopback entry is added
# BEFORE the carrier resolvers and `strictorder` makes dnsmasq try them in that
# order, so a stopped or useless resolver costs a hop, not the network. Every
# entry added is recorded in SMARTDNS_WIRED_LIST so smartdns_unwire can remove
# exactly those and nothing an operator added.
#
# `reload`, never `restart`: dnsmasq serves every client on this LAN. reload is
# a SIGHUP and keeps the socket; a restart drops :53 for a moment on a box whose
# uptime is somebody's internet connection.
smartdns_wire() {
    _swr_sec=$(smartdns_dnsmasq_section) || return 1
    _swr_port=$(smartdns_port)
    _swr_entry="127.0.0.1#$_swr_port"

    qm_smartdns_mode_dir || return 1

    if smartdns_wired; then
        return 0
    fi

    # First wire only: keep revert material. A later wire must not overwrite the
    # snapshot with a state that already contains our own entries.
    if [ ! -f "$SMARTDNS_WIRED_LIST" ]; then
        _swr_prev=$(uci -q get "dhcp.$_swr_sec.strictorder")
        printf '%s' "${_swr_prev:-unset}" | qm_durable_write "$SMARTDNS_STRICT_PREV" 0600
        : > "$SMARTDNS_WIRED_LIST.tmp" && mv -f "$SMARTDNS_WIRED_LIST.tmp" "$SMARTDNS_WIRED_LIST"
        chmod 0600 "$SMARTDNS_WIRED_LIST" 2>/dev/null
    fi

    # Rebuild the list with our loopback entry FIRST rather than appending it.
    # `strictorder` makes dnsmasq walk the list in order, and an operator's own
    # upstream sitting ahead of the resolver would mean the resolver never gets
    # asked. Their entries keep their relative order, so unwiring (which deletes
    # only ledger entries) restores exactly what they had.
    #
    # The rebuild deletes the list before it recreates it, so a failed add must
    # put it back: leaving it empty would take away upstreams nobody asked us to
    # touch.
    _swr_cur=$(uci -q get "dhcp.$_swr_sec.server" 2>/dev/null)
    uci -q delete "dhcp.$_swr_sec.server" 2>/dev/null
    if ! uci add_list "dhcp.$_swr_sec.server=$_swr_entry"; then
        for _swr_keep in $_swr_cur; do
            uci add_list "dhcp.$_swr_sec.server=$_swr_keep" 2>/dev/null
        done
        uci commit dhcp 2>/dev/null
        return 1
    fi
    printf '%s\n' "$_swr_entry" >> "$SMARTDNS_WIRED_LIST"
    for _swr_keep in $_swr_cur; do
        uci add_list "dhcp.$_swr_sec.server=$_swr_keep" || continue
    done

    _swr_any=0
    for _swr_ip in $(smartdns_carrier_resolvers); do
        uci add_list "dhcp.$_swr_sec.server=$_swr_ip" || continue
        printf '%s\n' "$_swr_ip" >> "$SMARTDNS_WIRED_LIST"
        _swr_any=1
    done
    # No carrier found means the loopback entry would be dnsmasq's ONLY upstream,
    # so a dead resolver really would break name resolution. Refuse instead: an
    # unwired resolver is useless, a wired one with no fallback is an outage.
    if [ "$_swr_any" = "0" ]; then
        smartdns_unwire >/dev/null 2>&1
        return 2
    fi

    uci set "dhcp.$_swr_sec.strictorder=1" || { smartdns_unwire >/dev/null 2>&1; return 1; }
    uci commit dhcp 2>/dev/null || { smartdns_unwire >/dev/null 2>&1; return 1; }
    [ -x /etc/init.d/dnsmasq ] && /etc/init.d/dnsmasq reload >/dev/null 2>&1
    return 0
}

# smartdns_unwire — restore dnsmasq's upstream list and `strictorder` to what
# they were. Idempotent: safe with no ledger, and safe when the entries are
# already gone (an install that was interrupted between commit and bookkeeping).
smartdns_unwire() {
    _suw_sec=$(smartdns_dnsmasq_section) || return 0
    _suw_port=$(smartdns_port)
    _suw_changed=0

    # The loopback entry unconditionally: it is ours by construction, and this
    # is the case where the ledger is missing.
    if uci -q del_list "dhcp.$_suw_sec.server=127.0.0.1#$_suw_port" 2>/dev/null; then
        _suw_changed=1
    fi

    if [ -f "$SMARTDNS_WIRED_LIST" ]; then
        while IFS= read -r _suw_e; do
            [ -n "$_suw_e" ] || continue
            uci -q del_list "dhcp.$_suw_sec.server=$_suw_e" 2>/dev/null && _suw_changed=1
        done < "$SMARTDNS_WIRED_LIST"
    fi

    if [ -f "$SMARTDNS_STRICT_PREV" ]; then
        _suw_prev=$(cat "$SMARTDNS_STRICT_PREV" 2>/dev/null)
        if [ "$_suw_prev" = "unset" ]; then
            uci -q delete "dhcp.$_suw_sec.strictorder" 2>/dev/null && _suw_changed=1
        elif [ -n "$_suw_prev" ]; then
            uci set "dhcp.$_suw_sec.strictorder=$_suw_prev" && _suw_changed=1
        fi
    fi

    [ "$_suw_changed" = "1" ] && uci commit dhcp 2>/dev/null
    rm -f "$SMARTDNS_WIRED_LIST" "$SMARTDNS_STRICT_PREV" 2>/dev/null

    [ "$_suw_changed" = "1" ] && [ -x /etc/init.d/dnsmasq ] \
        && /etc/init.d/dnsmasq reload >/dev/null 2>&1
    return 0
}

# --- config validation ------------------------------------------------------

# smartdns_validate_text TEXT — prove a candidate config by RUNNING it on a
# throwaway port and requiring it to bind.
#
# Why not a `test` subcommand: the OpenWrt build (pymumu/smartdns) has none, and
# the reference build measured that smartdns-rs 0.13.1's `test -c` accepts
# `totally-bogus-directive` and `bind not-a-port` with exit 0. A validator that
# passes garbage is worse than no validator, because it is believed.
#
# What this DOES catch: syntax errors, unknown-but-fatal directives, an
# unbindable port, a missing cache directory. What it does NOT catch: an
# unreachable upstream — the daemon starts happily and answers nothing. That gap
# is why wiring keeps the carrier as an ordered fallback.
#
# Returns 1 and prints the daemon's own first error lines on failure.
smartdns_validate_text() {
    local bin
    local conf
    local err
    local pid
    local port
    local bound
    local i
    bin=$(smartdns_bin) || { printf '%s\n' "smartdns is not installed"; return 1; }

    port=$(printf '%s\n' "$1" | awk '/^bind 127\.0\.0\.1:/ { split($2, a, ":"); print a[2]; exit }')
    case "$port" in
        ''|*[!0-9]*) printf '%s\n' "candidate config has no usable bind line"; return 1 ;;
    esac

    qm_smartdns_mode_dir || { printf '%s\n' "cannot prepare $SMARTDNS_DIR"; return 1; }
    conf="$SMARTDNS_DIR/smartdns.conf.candidate"
    err="$SMARTDNS_DIR/smartdns.conf.candidate.err"

    printf '%s\n' "$1" > "$conf" || return 1
    chmod 0600 "$conf" 2>/dev/null
    : > "$err"

    "$bin" -c "$conf" -f >"$err" 2>&1 &
    pid=$!

    bound=0
    i=0
    while [ "$i" -lt 30 ]; do
        # A daemon that exits before binding has already refused the config.
        kill -0 "$pid" 2>/dev/null || break
        if smartdns_port_listening "$port"; then
            bound=1
            break
        fi
        i=$((i + 1))
        sleep 0.1
    done

    kill "$pid" 2>/dev/null
    i=0
    while [ "$i" -lt 10 ] && kill -0 "$pid" 2>/dev/null; do
        i=$((i + 1))
        sleep 0.1
    done
    kill -9 "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null

    if [ "$bound" = "1" ]; then
        rm -f "$conf" "$err" 2>/dev/null
        return 0
    fi

    # Only the first lines: a config error repeats once per server and would be
    # unreadable as a toast.
    sed -n '1,3p' "$err" 2>/dev/null
    rm -f "$conf" "$err" 2>/dev/null
    return 1
}

# smartdns_validate_uci — render the CURRENT uci settings on a throwaway port and
# validate that. Both the save path and the service start use it, so a settings
# set that cannot run is refused before it becomes the live config.
smartdns_validate_uci() {
    local port
    local text
    port=$(smartdns_free_port) || { printf '%s\n' "no free port to validate on"; return 1; }
    text=$(smartdns_render_conf "$port") || { printf '%s\n' "no upstream server is configured"; return 1; }
    smartdns_validate_text "$text"
}
