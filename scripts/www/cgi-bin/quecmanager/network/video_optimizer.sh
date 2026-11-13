#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/dpi_helper.sh
[ -f /usr/lib/qmanager/safe_tmp.sh ] && . /usr/lib/qmanager/safe_tmp.sh

qlog_init "cgi_video_optimizer"
cgi_headers
cgi_handle_options

DPI_VERIFY_RESULT="/tmp/qmanager_dpi_verify.json"
# B5.11: pidfiles in the root-only run dir (a planted /tmp pidfile could fake
# "running" forever); qmanager_dpi_install writes the same install path.
DPI_VERIFY_PID="/var/run/qmanager/dpi_verify.pid"
DPI_INSTALL_RESULT="/tmp/qmanager_dpi_install.json"
DPI_INSTALL_PID="/var/run/qmanager/dpi_install.pid"

# dpi_spawn_guard PIDFILE CMDLINE — exit with the envelope when the worker is
# already running or its state dir cannot be made trustworthy.
dpi_spawn_guard() {
    if ! command -v qm_read_pid >/dev/null 2>&1 || ! qm_run_dir >/dev/null; then
        cgi_error "state_dir_failed" "Cannot prepare the DPI state directory"
        exit 0
    fi
    if qm_read_pid "$1" "$2" >/dev/null; then
        printf '{"success":true,"status":"running"}'
        exit 0
    fi
}

# dpi_service_restart_checked ENGINE — restart the DPI service and prove that
# engine runs.
#
# The init script's exit status is captured (it used to reach the CGI's own
# stdout, where a stray byte corrupts the JSON body), but it cannot be the only
# gate: rc.common's procd wrapper discards start_service()'s return value, and
# procd registers the instance asynchronously, so a refused start and a slow one
# look identical at return time. Both signals therefore: a non-zero status is a
# failure outright, and otherwise wait, bounded, for the engine to prove itself
# (pidfile for the packet queue, listener for the redirect engine). rc 0 only
# when the engine is running; the reason goes to the log. For the redirect engine
# this call IS the safety gate: its supervisor adds the iptables rules only after
# the listener answers, so a redirect that would blackhole HTTPS is refused here.
dpi_service_restart_checked() {
    local engine="$1"
    local out
    local rc
    local i
    out=$(/etc/init.d/qmanager_dpi restart 2>&1)
    rc=$?
    if [ "$rc" -ne 0 ]; then
        qlog_error "qmanager_dpi restart exited $rc: $out"
        return 1
    fi
    i=0
    while [ "$i" -lt 20 ]; do
        [ "$(dpi_engine_status "$engine")" = "running" ] && return 0
        sleep 0.25
        i=$((i + 1))
    done
    qlog_error "qmanager_dpi restart did not bring $engine up within 5 s: $out"
    return 1
}

# dpi_service_stop_checked ENGINE — stop the DPI service and prove the engine is
# gone. Same bounded proof in the other direction: "disabled" must not be
# reported while traffic is still being intercepted. rc 0 only when it stopped.
dpi_service_stop_checked() {
    local engine="$1"
    local out
    local i
    out=$(/etc/init.d/qmanager_dpi stop 2>&1)
    i=0
    while [ "$i" -lt 20 ]; do
        [ "$(dpi_engine_status "$engine")" = "stopped" ] && return 0
        sleep 0.25
        i=$((i + 1))
    done
    qlog_error "qmanager_dpi stop left $engine running: $out"
    return 1
}

# Ensure UCI section exists with defaults
ensure_dpi_config() {
    local section
    local existing_repeats
    local existing_engine
    section=$(uci -q get quecmanager.video_optimizer)
    if [ -z "$section" ]; then
        uci set quecmanager.video_optimizer=video_optimizer
        uci set quecmanager.video_optimizer.enabled='0'
        uci set quecmanager.video_optimizer.quic_enabled='1'
        uci set quecmanager.video_optimizer.desync_repeats='1'
        uci set quecmanager.video_optimizer.engine="$(dpi_default_engine)"
        uci commit quecmanager
        return
    fi

    # Backfill desync_repeats for installs created before this key existed
    existing_repeats=$(uci -q get quecmanager.video_optimizer.desync_repeats)
    if [ -z "$existing_repeats" ]; then
        uci set quecmanager.video_optimizer.desync_repeats='1'
        uci commit quecmanager
    fi

    # Backfill the engine for installs created before this key existed. The
    # default is probed from the kernel, so a device without the packet queue
    # starts on the redirect engine without the operator choosing anything -
    # installing the code changes no traffic behaviour either way, because
    # `enabled` stays 0 until the mode switch is used.
    existing_engine=$(uci -q get quecmanager.video_optimizer.engine)
    if [ -z "$existing_engine" ]; then
        uci set quecmanager.video_optimizer.engine="$(dpi_default_engine)"
        uci commit quecmanager
    fi
}

ensure_masq_config() {
    local section
    section=$(uci -q get quecmanager.traffic_masquerade)
    if [ -z "$section" ]; then
        uci set quecmanager.traffic_masquerade=traffic_masquerade
        uci set quecmanager.traffic_masquerade.enabled='0'
        uci set quecmanager.traffic_masquerade.sni_domain='speedtest.net'
        uci commit quecmanager
    fi
}

ensure_dpi_config
ensure_masq_config

case "$REQUEST_METHOD" in
GET)
    # Check for verify_status action
    action=$(echo "$QUERY_STRING" | sed -n 's/.*action=\([^&]*\).*/\1/p')

    if [ "$action" = "verify_status" ]; then
        # Return verification test results
        if [ -f "$DPI_VERIFY_RESULT" ]; then
            cat "$DPI_VERIFY_RESULT"
        else
            printf '{"success":true,"status":"idle"}'
        fi
        exit 0
    fi

    if [ "$action" = "install_status" ]; then
        # Return install progress
        if [ -f "$DPI_INSTALL_RESULT" ]; then
            cat "$DPI_INSTALL_RESULT"
        else
            printf '{"success":true,"status":"idle"}'
        fi
        exit 0
    fi

    # --- Hostlist section ---
    section=$(echo "$QUERY_STRING" | sed -n 's/.*section=\([^&]*\).*/\1/p')
    if [ "$section" = "hostlist" ]; then
        if [ -f "$DPI_HOSTLIST" ]; then
            domains=$(grep -v '^[[:space:]]*#' "$DPI_HOSTLIST" | grep -v '^[[:space:]]*$' | jq -R . | jq -s .)
        else
            domains='[]'
        fi
        if [ -f "$DPI_HOSTLIST_DEFAULT" ]; then
            default_domains=$(grep -v '^[[:space:]]*#' "$DPI_HOSTLIST_DEFAULT" | grep -v '^[[:space:]]*$' | jq -R . | jq -s .)
        else
            default_domains='[]'
        fi
        count=$(echo "$domains" | jq 'length')
        jq -n --argjson domains "$domains" --argjson default_domains "$default_domains" --argjson count "$count" \
            '{"success":true,"domains":$domains,"default_domains":$default_domains,"count":$count}'
        exit 0
    fi

    # --- Traffic Masquerade section ---
    if [ "$section" = "masquerade" ]; then
        masq_enabled=$(uci -q get quecmanager.traffic_masquerade.enabled)
        vo_enabled=$(uci -q get quecmanager.video_optimizer.enabled)
        sni_domain=$(uci -q get quecmanager.traffic_masquerade.sni_domain)
        # Only report live stats when masquerade is the active mode —
        # VO and masq share a single nfqws process/PID/counters
        if [ "$masq_enabled" = "1" ]; then
            masq_status=$(dpi_get_status)
            masq_uptime=$(dpi_get_uptime)
            masq_packets=$(dpi_get_packet_count)
        else
            masq_status="stopped"
            masq_uptime="0s"
            masq_packets=0
        fi
        dpi_check_binary && binary_ok="true" || binary_ok="false"
        dpi_check_kmod && kmod_ok="true" || kmod_ok="false"

        jq -n \
            --argjson success true \
            --arg enabled "${masq_enabled:-0}" \
            --arg vo_enabled "${vo_enabled:-0}" \
            --arg status "$masq_status" \
            --arg uptime "$masq_uptime" \
            --argjson packets_processed "${masq_packets:-0}" \
            --arg sni_domain "${sni_domain:-speedtest.net}" \
            --argjson binary_installed "$binary_ok" \
            --argjson kernel_module_loaded "$kmod_ok" \
            '{
                success: $success,
                enabled: ($enabled == "1"),
                other_enabled: ($vo_enabled == "1"),
                status: $status,
                uptime: $uptime,
                packets_processed: $packets_processed,
                sni_domain: $sni_domain,
                binary_installed: $binary_installed,
                kernel_module_loaded: $kernel_module_loaded
            }'
        exit 0
    fi

    # Read UCI settings
    enabled=$(uci -q get quecmanager.video_optimizer.enabled)
    masq_enabled=$(uci -q get quecmanager.traffic_masquerade.enabled)
    vo_engine=$(dpi_vo_engine)
    desync_repeats=$(uci -q get quecmanager.video_optimizer.desync_repeats)
    case "$desync_repeats" in
        ''|*[!0-9]*) desync_repeats=1 ;;
        *)
            if [ "$desync_repeats" -lt 1 ] || [ "$desync_repeats" -gt 10 ]; then
                desync_repeats=1
            fi
            ;;
    esac

    # Only report live stats when video optimizer is the active mode — the two
    # modes are mutually exclusive, so exactly one engine owns the counters.
    if [ "$enabled" = "1" ]; then
        status=$(dpi_engine_status "$vo_engine")
        uptime=$(dpi_get_uptime "$(dpi_engine_pidfile "$vo_engine")")
        packets=$(dpi_get_packet_count "$vo_engine")
    else
        status="stopped"
        uptime="0s"
        packets=0
    fi
    domains=$(dpi_get_domain_count)
    # binary_installed is the SELECTED engine's binary: the page gates onboarding
    # and the mode switch on it, so it must answer "will this engine run?".
    dpi_check_engine_binary "$vo_engine" && binary_ok="true" || binary_ok="false"
    dpi_check_binary && nfqws_ok="true" || nfqws_ok="false"
    dpi_check_tpws_binary && tpws_ok="true" || tpws_ok="false"
    dpi_check_kmod && kmod_ok="true" || kmod_ok="false"

    # Build response
    jq -n \
        --argjson success true \
        --arg enabled "${enabled:-0}" \
        --arg masq_enabled "${masq_enabled:-0}" \
        --arg engine "$vo_engine" \
        --arg status "$status" \
        --arg uptime "$uptime" \
        --argjson packets_processed "${packets:-0}" \
        --argjson domains_loaded "${domains:-0}" \
        --argjson desync_repeats "$desync_repeats" \
        --argjson binary_installed "$binary_ok" \
        --argjson nfqws_installed "$nfqws_ok" \
        --argjson tpws_installed "$tpws_ok" \
        --argjson kernel_module_loaded "$kmod_ok" \
        '{
            success: $success,
            enabled: ($enabled == "1"),
            other_enabled: ($masq_enabled == "1"),
            engine: $engine,
            status: $status,
            uptime: $uptime,
            packets_processed: $packets_processed,
            domains_loaded: $domains_loaded,
            desync_repeats: $desync_repeats,
            binary_installed: $binary_installed,
            nfqws_installed: $nfqws_installed,
            tpws_installed: $tpws_installed,
            kernel_module_loaded: $kernel_module_loaded
        }'
    ;;

POST)
    cgi_read_post
    action=$(echo "$POST_DATA" | jq -r '.action // empty')

    case "$action" in
    save)
        # Extract enabled field
        new_enabled=$(echo "$POST_DATA" | jq -r '(.enabled) | if . == null then empty else tostring end')

        if [ -z "$new_enabled" ]; then
            cgi_error "missing_field" "enabled field is required"
            exit 0
        fi

        # Optional: desync_repeats (integer 1-10). Absence = no change.
        new_repeats=$(echo "$POST_DATA" | jq -r '(.desync_repeats) | if . == null then empty else tostring end')
        if [ -n "$new_repeats" ]; then
            case "$new_repeats" in
                ''|*[!0-9]*)
                    cgi_error "invalid_repeats" "desync_repeats must be an integer between 1 and 10"
                    exit 0
                    ;;
                *)
                    if [ "$new_repeats" -lt 1 ] || [ "$new_repeats" -gt 10 ]; then
                        cgi_error "invalid_repeats" "desync_repeats must be an integer between 1 and 10"
                        exit 0
                    fi
                    ;;
            esac
            uci set quecmanager.video_optimizer.desync_repeats="$new_repeats"
        fi

        # Optional: engine (nfqws | tpws). Absence = no change. A choice the
        # device cannot honour is refused here, before anything is written, so
        # the page never reports a mode that cannot run: the packet-queue engine
        # needs NFQUEUE, and either engine needs its own binary.
        new_engine=$(echo "$POST_DATA" | jq -r '(.engine) | if . == null then empty else tostring end')
        if [ -n "$new_engine" ]; then
            case "$new_engine" in
                "$DPI_ENGINE_NFQWS"|"$DPI_ENGINE_TPWS") ;;
                *)
                    cgi_error "invalid_engine" "engine must be nfqws or tpws"
                    exit 0
                    ;;
            esac
            if ! dpi_check_engine_binary "$new_engine"; then
                cgi_error "engine_not_installed" "The selected engine is not installed"
                exit 0
            fi
            if [ "$new_engine" = "$DPI_ENGINE_NFQWS" ] && ! dpi_check_kmod; then
                cgi_error "engine_unavailable" "The packet-queue engine needs kernel support this firmware lacks"
                exit 0
            fi
            uci set quecmanager.video_optimizer.engine="$new_engine"
        fi

        # Map to UCI value — enforce mutual exclusion with masquerade
        if [ "$new_enabled" = "true" ]; then
            uci set quecmanager.traffic_masquerade.enabled='0'
            uci set quecmanager.video_optimizer.enabled='1'
        else
            uci set quecmanager.video_optimizer.enabled='0'
        fi
        uci commit quecmanager

        # The engine the service will actually start, read back from UCI so the
        # proof below and the GET that follows cannot disagree with it.
        vo_engine=$(dpi_vo_engine)

        # Restart or stop service + manage boot persistence
        if [ "$new_enabled" = "true" ]; then
            /etc/init.d/qmanager_dpi enable 2>/dev/null
            if ! dpi_service_restart_checked "$vo_engine"; then
                cgi_error "engine_start_failed" "Daemon $(dpi_engine_status "$vo_engine") after restart"
                exit 0
            fi
            qlog_info "Video Optimizer enabled on $vo_engine (boot: on)"
        else
            if ! dpi_service_stop_checked "$vo_engine"; then
                cgi_error "engine_stop_failed" "Daemon $(dpi_engine_status "$vo_engine") after stop"
                exit 0
            fi
            # Disable boot if masquerade is also off
            masq_check=$(uci -q get quecmanager.traffic_masquerade.enabled)
            [ "$masq_check" != "1" ] && /etc/init.d/qmanager_dpi disable 2>/dev/null
            qlog_info "Video Optimizer disabled"
        fi

        cgi_success
        ;;

    verify)
        # Check if verification is already running
        dpi_spawn_guard "$DPI_VERIFY_PID" qmanager_dpi_verify

        # Clear old results
        rm -f "$DPI_VERIFY_RESULT"

        # Spawn background verification
        /usr/bin/qmanager_dpi_verify </dev/null >/dev/null 2>&1 &
        printf '%s\n' "$!" | qm_atomic_write "$DPI_VERIFY_PID"

        qlog_info "Verification test started"
        printf '{"success":true,"status":"started"}'
        ;;

    install)
        # Check if install is already running
        dpi_spawn_guard "$DPI_INSTALL_PID" qmanager_dpi_install

        # Clear old results
        rm -f "$DPI_INSTALL_RESULT"

        # Spawn background installer
        /usr/bin/qmanager_dpi_install </dev/null >/dev/null 2>&1 &
        printf '%s\n' "$!" | qm_atomic_write "$DPI_INSTALL_PID"

        qlog_info "nfqws installation started"
        printf '{"success":true,"status":"started"}'
        ;;

    test_masquerade)
        # Quick injection test: read counter, make HTTPS request, read counter again
        # Must verify masquerade specifically is enabled — VO shares the same process
        masq_test_enabled=$(uci -q get quecmanager.traffic_masquerade.enabled)
        if [ "$masq_test_enabled" != "1" ] || [ "$(dpi_get_status)" != "running" ]; then
            printf '{"success":false,"error":"Traffic Masquerade is not running. Enable it first."}'
            exit 0
        fi

        count_before=$(dpi_get_packet_count)
        curl -4 -so /dev/null --max-time 5 "https://speed.cloudflare.com/__down?bytes=1000" 2>/dev/null
        sleep 1
        count_after=$(dpi_get_packet_count)

        injected=$((count_after - count_before))
        if [ "$injected" -gt 0 ]; then
            printf '{"success":true,"injected":true,"packets":%d,"message":"Fake SNI injection confirmed (%d packets processed)"}' "$injected" "$injected"
        else
            printf '{"success":true,"injected":false,"packets":0,"message":"No packets intercepted. The cellular interface may have changed. Try restarting the service."}'
        fi
        ;;

    save_masquerade)
        new_enabled=$(echo "$POST_DATA" | jq -r '(.enabled) | if . == null then empty else tostring end')
        new_sni=$(echo "$POST_DATA" | jq -r '(.sni_domain) | if . == null then empty else . end')

        if [ -z "$new_enabled" ]; then
            cgi_error "missing_field" "enabled field is required"
            exit 0
        fi

        # Validate SNI domain (alphanumeric, dots, hyphens, must contain a dot)
        if [ -n "$new_sni" ]; then
            if ! echo "$new_sni" | grep -qE '^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$'; then
                cgi_error "invalid_domain" "Invalid domain format"
                exit 0
            fi
            if ! echo "$new_sni" | grep -q '\.'; then
                cgi_error "invalid_domain" "Domain must contain at least one dot"
                exit 0
            fi
            if [ "${#new_sni}" -gt 253 ]; then
                cgi_error "invalid_domain" "Domain name too long (max 253 chars)"
                exit 0
            fi
            uci set quecmanager.traffic_masquerade.sni_domain="$new_sni"
        fi

        # Enforce mutual exclusion with video optimizer
        if [ "$new_enabled" = "true" ]; then
            uci set quecmanager.video_optimizer.enabled='0'
            uci set quecmanager.traffic_masquerade.enabled='1'
        else
            uci set quecmanager.traffic_masquerade.enabled='0'
        fi
        uci commit quecmanager

        # Restart or stop service + manage boot persistence
        if [ "$new_enabled" = "true" ]; then
            /etc/init.d/qmanager_dpi enable 2>/dev/null
            # Masquerade is fake-SNI injection, which only the packet-queue
            # engine can do, so the saved Video Optimizer engine is irrelevant.
            if ! dpi_service_restart_checked "$DPI_ENGINE_NFQWS"; then
                cgi_error "engine_start_failed" "Daemon $(dpi_get_status) after restart"
                exit 0
            fi
            qlog_info "Traffic Masquerade enabled (sni=$new_sni, boot: on)"
        else
            if ! dpi_service_stop_checked "$DPI_ENGINE_NFQWS"; then
                cgi_error "engine_stop_failed" "Daemon $(dpi_get_status) after stop"
                exit 0
            fi
            # Disable boot if video optimizer is also off
            vo_check=$(uci -q get quecmanager.video_optimizer.enabled)
            [ "$vo_check" != "1" ] && /etc/init.d/qmanager_dpi disable 2>/dev/null
            qlog_info "Traffic Masquerade disabled"
        fi

        cgi_success
        ;;

    save_hostlist)
        domains=$(echo "$POST_DATA" | jq -r '.domains // empty')
        if [ -z "$domains" ] || [ "$domains" = "null" ]; then
            cgi_error "missing_field" "domains array is required"
            exit 0
        fi

        # Validate all domains upfront using jq (avoids subshell exit issue)
        bad_domain=$(echo "$POST_DATA" | jq -r '.domains[]' | while IFS= read -r d; do
            if ! echo "$d" | grep -qE '^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$'; then
                echo "$d"; break
            fi
            if ! echo "$d" | grep -q '\.'; then
                echo "$d"; break
            fi
        done)
        if [ -n "$bad_domain" ]; then
            cgi_error "invalid_domain" "Invalid domain: $bad_domain"
            exit 0
        fi

        # Atomic write: temp file + mv
        tmp_file="${DPI_HOSTLIST}.tmp.$$"
        echo "$POST_DATA" | jq -r '.domains[]' > "$tmp_file"
        mv "$tmp_file" "$DPI_HOSTLIST"

        # Restart service if VO is currently running to pick up new list
        vo_enabled=$(uci -q get quecmanager.video_optimizer.enabled)
        vo_engine=$(dpi_vo_engine)
        if [ "$vo_enabled" = "1" ] && [ "$(dpi_engine_status "$vo_engine")" = "running" ]; then
            if ! dpi_service_restart_checked "$vo_engine"; then
                cgi_error "engine_start_failed" "Hostname list saved; daemon $(dpi_engine_status "$vo_engine") after restart"
                exit 0
            fi
            qlog_info "Hostlist updated, service restarted"
        else
            qlog_info "Hostlist updated"
        fi

        cgi_success
        ;;

    restore_hostlist)
        if [ ! -f "$DPI_HOSTLIST_DEFAULT" ]; then
            cgi_error "no_default" "Default hostname list not found"
            exit 0
        fi

        cp "$DPI_HOSTLIST_DEFAULT" "${DPI_HOSTLIST}.tmp.$$"
        mv "${DPI_HOSTLIST}.tmp.$$" "$DPI_HOSTLIST"

        vo_enabled=$(uci -q get quecmanager.video_optimizer.enabled)
        vo_engine=$(dpi_vo_engine)
        if [ "$vo_enabled" = "1" ] && [ "$(dpi_engine_status "$vo_engine")" = "running" ]; then
            if ! dpi_service_restart_checked "$vo_engine"; then
                cgi_error "engine_start_failed" "Default list restored; daemon $(dpi_engine_status "$vo_engine") after restart"
                exit 0
            fi
            qlog_info "Hostlist restored to default, service restarted"
        else
            qlog_info "Hostlist restored to default"
        fi

        cgi_success
        ;;

    uninstall)
        # Safety: refuse while EITHER engine is up — a running redirect engine is
        # also a live iptables chain, and removing its binary under it would
        # strand the rules.
        if [ "$(dpi_get_status)" = "running" ] || [ "$(dpi_engine_status "$DPI_ENGINE_TPWS")" = "running" ]; then
            cgi_error "service_running" "Disable the service before uninstalling"
            exit 0
        fi

        qlog_info "Uninstalling DPI engine binaries"

        # Stop service, disable boot, and clean up the redirect rules
        [ -x /etc/init.d/qmanager_dpi ] && {
            /etc/init.d/qmanager_dpi stop >/dev/null 2>&1
            /etc/init.d/qmanager_dpi disable 2>/dev/null
        }
        # stop_service removes them, but a refused stop must not leave a chain
        # pointing at a binary that is about to disappear.
        dpi_tpws_rules_remove

        # Disable both features in UCI
        uci -q set quecmanager.video_optimizer.enabled='0'
        uci -q set quecmanager.traffic_masquerade.enabled='0'
        uci commit quecmanager 2>/dev/null

        # Remove both binaries
        rm -f "$NFQWS_BIN" "$TPWS_BIN"

        # Verify removal
        if [ -x "$NFQWS_BIN" ] || [ -x "$TPWS_BIN" ]; then
            qlog_error "engine binary still present after removal"
            cgi_error "uninstall_failed" "Failed to remove the engine binaries"
            exit 0
        fi

        qlog_info "DPI engine binaries uninstalled successfully"
        cgi_success
        ;;

    *)
        cgi_error "invalid_action" "Unknown action: $action"
        ;;
    esac
    ;;

*)
    cgi_method_not_allowed
    ;;
esac

exit 0
