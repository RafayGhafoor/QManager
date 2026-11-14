#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
[ -f /usr/lib/qmanager/smartdns_lib.sh ] && . /usr/lib/qmanager/smartdns_lib.sh
# =============================================================================
# smartdns.sh — CGI: SmartDNS resolver status and settings (GET + POST)
# =============================================================================
# GET   -> the resolver's whole state, including the settings the page edits
# POST  {"action":"save", "enabled":bool, "lan_dns":bool, "cache_size":int,
#        "prefetch":bool, "upstreams":[...]}   -> validate, apply, restart
# POST  {"action":"install"}                   -> spawn the package install
# POST  {"action":"uninstall"}                 -> spawn the package removal
#
# -----------------------------------------------------------------------------
# THE DNS SAFETY SHAPE OF THIS FILE
#
#   1. Nothing here is on by default, and `save` is the only writer. There is no
#      action that silently turns the resolver on.
#
#   2. `lan_dns` is the ONLY thing that can change what the LAN resolves
#      through, it defaults to 0, and it refuses to apply without a carrier
#      fallback in place. dnsmasq keeps :53, DHCP and the lease names either
#      way — see smartdns_lib.sh for the ordering argument.
#
#   3. A settings set is proved by RUNNING it on a throwaway port before it is
#      committed. A rejected set changes nothing: the previous config keeps
#      serving and the daemon's own message goes back to the page verbatim.
#      (`smartdns test -c` is not used — the reference build measured that it
#      accepts garbage with exit 0.)
#
#   4. A save that leaves the resolver unable to listen ROLLS BACK to
#      smartdns.conf.pre-qmanager and restarts, and says so. A bad paste must
#      never be able to take the resolver — or the LAN's DNS — down.
#
#   5. Nothing in this file stops, starts or restarts dnsmasq or any other
#      network-critical service. The one dnsmasq call is `reload` (SIGHUP),
#      inside smartdns_wire / smartdns_unwire, and only when the upstream list
#      actually changed.
#
# Endpoint: GET/POST /cgi-bin/quecmanager/network/smartdns.sh
# Install location: /www/cgi-bin/quecmanager/network/smartdns.sh
# =============================================================================

qlog_init "cgi_smartdns"
cgi_headers
cgi_handle_options

# No library means the install is broken, not that the feature is off. Answer a
# complete, empty state so the page renders its "not installed" card instead of
# a transport error.
if ! command -v smartdns_bin >/dev/null 2>&1; then
    if [ "$REQUEST_METHOD" = "GET" ]; then
        jq -n '{
            success: true,
            installed: false,
            binary: null,
            enabled: false,
            running: false,
            listening: false,
            pid: null,
            uptime_sec: null,
            rss_kb: null,
            port: 5353,
            config_path: null,
            config_size: null,
            config_mtime: null,
            upstream_count: 0,
            cache_size: 4096,
            prefetch: true,
            lan_dns: false,
            wired: false,
            other_upstreams: 0,
            carrier_resolvers: [],
            settings: {
                enabled: false, lan_dns: false, cache_size: 4096,
                prefetch: true, upstreams: []
            },
            logs_tail: [],
            install: null
        }'
    else
        cgi_error "library_missing" "The SmartDNS library is not installed"
    fi
    exit 0
fi

INSTALL_HELPER="/usr/bin/qmanager_smartdns_install"
INSTALL_PID="/var/run/qmanager/smartdns_install.pid"

smartdns_ensure_section

# --- helpers ---------------------------------------------------------------

# json_bool VALUE — "true"/"false" from a shell-ish flag, for jq --argjson.
json_bool() {
    case "$1" in
        1|true|yes|on) printf 'true' ;;
        *)             printf 'false' ;;
    esac
}

# read_install_state — the poll result of a running or finished install. Absent
# file means "never started", which is not the same as "finished".
read_install_state() {
    if qm_trusted_file "$SMARTDNS_INSTALL_RESULT"; then
        jq -c '.' "$SMARTDNS_INSTALL_RESULT" 2>/dev/null || printf 'null'
        return 0
    fi
    # A malformed result file must not stop the page from reporting the package
    # that is actually installed.
    printf 'null'
}

build_status() {
    # One variable per `local`: BusyBox ash's multi-name form has bitten this
    # tree before, and the audit greps for it.
    local _installed=false
    local _enabled=false
    local _lan=false
    local _prefetch=false
    local _running=false
    local _listening=false
    local _pid=null
    local _up=null
    local _rss=null
    local _size=null
    local _mtime=null
    local _bin=null
    local _upstream_count=0
    local _wired=false
    local _foreign=0
    local _logs='[]'
    local _carriers='[]'
    local _port
    local _cache

    _port=$(smartdns_port)
    _cache=$(smartdns_cache_size)

    smartdns_installed && { _installed=true; _bin=$(smartdns_bin); }
    [ "$(uci -q get quecmanager.smartdns.enabled 2>/dev/null)" = "1" ] && _enabled=true
    [ "$(uci -q get quecmanager.smartdns.lan_dns 2>/dev/null)" = "1" ] && _lan=true
    [ "$(smartdns_uci prefetch '1')" = "1" ] && _prefetch=true

    _upstream_count=$(smartdns_upstreams | wc -l | tr -d ' ')
    case "$_upstream_count" in ''|*[!0-9]*) _upstream_count=0 ;; esac

    smartdns_wired && _wired=true
    _foreign=$(smartdns_other_upstreams)
    case "$_foreign" in ''|*[!0-9]*) _foreign=0 ;; esac

    # Running is decided by the PROCESS, listening by the SOCKET: they are two
    # facts and the page draws both, because "enabled, running, not listening"
    # is how a resolver that cannot bind renders as healthy.
    if _pid_v=$(smartdns_pid); then
        _running=true
        _pid=$_pid_v
        _up=$(smartdns_proc_uptime "$_pid_v")
        _rss_v=$(awk '/VmRSS/{print $2}' "/proc/$_pid_v/status" 2>/dev/null)
        case "$_rss_v" in ''|*[!0-9]*) ;; *) _rss=$_rss_v ;; esac
    fi
    smartdns_port_listening "$_port" && _listening=true

    # No `stat` applet on this board: `stat -c` exits 127 and prints nothing,
    # which would read as a zero-byte config rather than as a failure.
    if [ -f "$SMARTDNS_CONF" ]; then
        _size=$(wc -c < "$SMARTDNS_CONF" 2>/dev/null | tr -d ' ')
        case "$_size" in ''|*[!0-9]*) _size=null ;; esac
        _mtime=$(date -r "$SMARTDNS_CONF" +%s 2>/dev/null)
        case "$_mtime" in ''|*[!0-9]*) _mtime=null ;; esac
    fi

    # The carrier resolvers are what dnsmasq falls back to once wired, so the
    # page shows the list rather than asserting "there is a fallback".
    _carriers=$(smartdns_carrier_resolvers 2>/dev/null | jq -R -s -c 'split("\n") | map(select(length > 0))')
    case "$_carriers" in \[*\]) ;; *) _carriers='[]' ;; esac

    # Daemon log tail. logread is a ring buffer, so this is "recent", never a
    # counter — and an empty result is an empty list, not a healthy zero.
    _logs=$(logread 2>/dev/null | grep -i 'smartdns' | tail -n 6 | jq -R -s -c 'split("\n") | map(select(length > 0))')
    case "$_logs" in \[*\]) ;; *) _logs='[]' ;; esac

    jq -n \
        --argjson installed "$_installed" \
        --argjson enabled "$_enabled" \
        --argjson lan "$_lan" \
        --argjson prefetch "$_prefetch" \
        --argjson running "$_running" \
        --argjson listening "$_listening" \
        --argjson pid "$_pid" \
        --argjson uptime "$_up" \
        --argjson rss "$_rss" \
        --argjson port "$_port" \
        --argjson cache "$_cache" \
        --argjson size "$_size" \
        --argjson mtime "$_mtime" \
        --argjson upstream_count "$_upstream_count" \
        --argjson wired "$_wired" \
        --argjson foreign "$_foreign" \
        --argjson carriers "$_carriers" \
        --argjson logs "$_logs" \
        --argjson install "$(read_install_state)" \
        --arg bin "$_bin" \
        --arg conf "$SMARTDNS_CONF" \
        --argjson upstreams "$(smartdns_upstreams | jq -R -s -c 'split("\n") | map(select(length > 0))')" \
        '{
            success: true,
            installed: $installed,
            binary: (if $installed then $bin else null end),
            enabled: $enabled,
            running: $running,
            listening: $listening,
            pid: $pid,
            uptime_sec: (if $running then $uptime else null end),
            rss_kb: (if $running then $rss else null end),
            port: $port,
            config_path: (if $installed then $conf else null end),
            config_size: $size,
            config_mtime: $mtime,
            upstream_count: $upstream_count,
            cache_size: $cache,
            prefetch: $prefetch,
            lan_dns: $lan,
            wired: $wired,
            other_upstreams: $foreign,
            carrier_resolvers: $carriers,
            settings: {
                enabled: $enabled,
                lan_dns: $lan,
                cache_size: $cache,
                prefetch: $prefetch,
                upstreams: $upstreams
            },
            logs_tail: $logs,
            install: $install
        }'
}

# service_wait_listening SECONDS — bounded wait for the resolver to bind.
service_wait_listening() {
    _swl_i=0
    _swl_max=$((${1:-5} * 10))
    while [ "$_swl_i" -lt "$_swl_max" ]; do
        smartdns_port_listening && return 0
        _swl_i=$((_swl_i + 1))
        sleep 0.1
    done
    return 1
}

# --- POST: save ------------------------------------------------------------

do_save() {
    local want_enabled
    local want_lan
    local want_prefetch
    local want_cache
    local upstreams_text
    local rendered

    want_enabled=$(printf '%s' "$POST_DATA" | jq -r 'if .enabled == true then "1" else "0" end' 2>/dev/null)
    want_lan=$(printf '%s' "$POST_DATA" | jq -r 'if .lan_dns == true then "1" else "0" end' 2>/dev/null)
    want_prefetch=$(printf '%s' "$POST_DATA" | jq -r 'if .prefetch == true then "1" else "0" end' 2>/dev/null)
    want_cache=$(printf '%s' "$POST_DATA" | jq -r '.cache_size // empty' 2>/dev/null)
    upstreams_text=$(printf '%s' "$POST_DATA" | jq -r '(.upstreams // []) | .[]' 2>/dev/null)

    case "$want_cache" in
        ''|*[!0-9]*)
            cgi_error "invalid_value" "cache_size must be a number"
            return
            ;;
    esac
    if [ "$want_cache" -lt 512 ] || [ "$want_cache" -gt 65536 ]; then
        cgi_error "invalid_value" "cache_size must be between 512 and 65536"
        return
    fi

    # One upstream per line, and each one has to survive the allowlist: a value
    # is written verbatim into a generated file, so a newline or a `#` would
    # become a directive the page never rendered.
    if [ -z "$upstreams_text" ]; then
        cgi_error "invalid_value" "Select at least one upstream resolver"
        return
    fi
    _ds_count=0
    for _ds_u in $upstreams_text; do
        if ! smartdns_upstream_valid "$_ds_u"; then
            cgi_error "invalid_value" "Unsupported upstream resolver: $_ds_u"
            return
        fi
        _ds_count=$((_ds_count + 1))
    done
    if [ "$_ds_count" -gt 8 ]; then
        cgi_error "invalid_value" "At most 8 upstream resolvers"
        return
    fi

    # Turning the LAN over to a resolver that is not running would leave
    # dnsmasq's first upstream dead. Refuse the combination rather than apply
    # half of it.
    if [ "$want_lan" = "1" ] && [ "$want_enabled" != "1" ]; then
        cgi_error "invalid_value" "Turn the resolver on before routing DNS through it"
        return
    fi

    if ! smartdns_installed; then
        cgi_error "not_installed" "The resolver is not installed"
        return
    fi

    # --- validate the candidate BEFORE anything is committed ---------------
    _ds_port=$(smartdns_free_port)
    rendered=$(smartdns_render_body "$_ds_port" "$want_cache" "$want_prefetch" "$upstreams_text" \
        "$(uci -q get quecmanager.smartdns.bootstrap 2>/dev/null)")
    if [ $? -ne 0 ] || [ -z "$rendered" ]; then
        cgi_error "config_invalid" "The resolver rejected every upstream in that list"
        return
    fi
    _ds_err=$(smartdns_validate_text "$rendered")
    if [ $? -ne 0 ]; then
        qlog_warn "SmartDNS candidate config refused: $_ds_err"
        cgi_error "config_invalid" "${_ds_err:-The resolver refused the generated configuration}"
        return
    fi

    # --- commit ------------------------------------------------------------
    uci set "quecmanager.smartdns.enabled=$want_enabled"
    uci set "quecmanager.smartdns.lan_dns=$want_lan"
    uci set "quecmanager.smartdns.cache_size=$want_cache"
    uci set "quecmanager.smartdns.prefetch=$want_prefetch"
    uci -q delete "quecmanager.smartdns.upstream"
    for _ds_u in $upstreams_text; do
        uci add_list "quecmanager.smartdns.upstream=$_ds_u"
    done
    uci commit quecmanager 2>/dev/null || qlog_warn "uci commit quecmanager failed"

    # --- apply -------------------------------------------------------------
    _ds_restarted=false
    _ds_rolled_back=false

    if [ "$want_enabled" = "1" ]; then
        if smartdns_write_conf; then
            /etc/init.d/qmanager_smartdns restart >/dev/null 2>&1
            _ds_restarted=true
        fi

        if ! service_wait_listening 8; then
            # The config passed a throwaway-port run but the live port did not
            # come up. Restore the last config that did work; if there is none,
            # leave the resolver down rather than loop.
            qlog_error "SmartDNS did not listen after the save; rolling back"
            _ds_rolled_back=true
            if [ -f "$SMARTDNS_BACKUP" ]; then
                cp "$SMARTDNS_BACKUP" "$SMARTDNS_CONF" 2>/dev/null
                /etc/init.d/qmanager_smartdns restart >/dev/null 2>&1
                service_wait_listening 8 || qlog_error "Rollback config also failed to listen"
            fi
            cgi_error "start_failed" "The resolver did not come up; the previous configuration was restored"
            return
        fi
    else
        /etc/init.d/qmanager_smartdns stop >/dev/null 2>&1
    fi

    # --- wire / unwire dnsmasq --------------------------------------------
    # Only reached with a listening resolver, or with the resolver off (unwire).
    if [ "$want_lan" = "1" ]; then
        smartdns_wire
        case "$?" in
            0) ;;
            2)
                cgi_error "no_carrier_fallback" \
                    "The carrier's DNS servers could not be found, so LAN DNS was left unchanged"
                return
                ;;
            *)
                cgi_error "wire_failed" "LAN DNS was left unchanged"
                return
                ;;
        esac
    else
        smartdns_unwire
    fi

    jq -n \
        --argjson enabled "$(json_bool "$want_enabled")" \
        --argjson running "$(json_bool "$(smartdns_pid >/dev/null 2>&1 && echo 1)")" \
        --argjson wired "$(json_bool "$(smartdns_wired && echo 1)")" \
        --argjson restarted "$_ds_restarted" \
        --argjson rolled_back "$_ds_rolled_back" \
        '{success: true, enabled: $enabled, running: $running, wired: $wired,
          restarted: $restarted, rolled_back: $rolled_back}'
}

# --- POST: install / uninstall --------------------------------------------

# spawn_helper ACTION — start the package helper in the background and answer
# immediately. The page polls the status until `install.status` moves on.
spawn_helper() {
    if ! command -v qm_read_pid >/dev/null 2>&1 || ! qm_run_dir >/dev/null; then
        cgi_error "state_dir_failed" "Cannot prepare the install state directory"
        return
    fi
    if qm_read_pid "$INSTALL_PID" qmanager_smartdns_install >/dev/null; then
        jq -n '{success: true, status: "running"}'
        return
    fi
    [ -x "$INSTALL_HELPER" ] || {
        cgi_error "helper_missing" "qmanager_smartdns_install is not installed"
        return
    }
    rm -f "$SMARTDNS_INSTALL_RESULT"
    "$INSTALL_HELPER" "$1" </dev/null >/dev/null 2>&1 &
    printf '%s\n' "$!" | qm_atomic_write "$INSTALL_PID"
    jq -n --arg action "$1" '{success: true, status: "running", action: $action}'
}

# --- dispatch --------------------------------------------------------------
case "$REQUEST_METHOD" in
    GET)
        build_status
        ;;
    POST)
        cgi_read_post
        _action=$(printf '%s' "$POST_DATA" | jq -r '.action // empty' 2>/dev/null)
        case "$_action" in
            save)
                qlog_info "SmartDNS settings save requested"
                do_save
                ;;
            install)
                if smartdns_installed; then
                    cgi_error "already_installed" "The resolver is already installed"
                else
                    qlog_info "SmartDNS install requested"
                    spawn_helper install
                fi
                ;;
            uninstall)
                if [ "$(uci -q get quecmanager.smartdns.enabled 2>/dev/null)" = "1" ]; then
                    cgi_error "service_running" "Turn the resolver off before removing it"
                else
                    qlog_info "SmartDNS removal requested"
                    spawn_helper uninstall
                fi
                ;;
            '') cgi_error "missing_action" "action is required" ;;
            *)  cgi_error "unknown_action" "Unsupported action: $_action" ;;
        esac
        ;;
    *)
        cgi_method_not_allowed
        ;;
esac
exit 0
