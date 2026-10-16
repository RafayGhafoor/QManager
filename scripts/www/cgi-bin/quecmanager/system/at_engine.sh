#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# at_engine.sh — CGI Endpoint: AT engine (broker | legacy) (GET + POST)
# =============================================================================
# Switches which program serves /usr/bin/qcmd: the Rust AT broker (default)
# or the legacy shell gatekeeper. Both keep the same output contract, so every
# caller is unaffected. Applies immediately: repoints the qcmd link and
# starts/stops the broker daemon. Never touches the modem; never reboots.
#
# Auth: enforced at source time by cgi_base.sh (require_auth).
#
# GET  -> {"success":true,"engine":"broker|legacy","effective":"broker|legacy|unknown",
#          "broker_available":<bool>,"broker_running":<bool>}
# POST {"engine":"broker"|"legacy"} -> same shape as GET, after applying.
# Errors: invalid_engine | broker_unavailable | apply_failed | method_not_allowed
#
# Endpoint: GET/POST /cgi-bin/quecmanager/system/at_engine.sh
# Install location: /www/cgi-bin/quecmanager/system/at_engine.sh
# =============================================================================

qlog_init "cgi_at_engine"
cgi_headers
cgi_handle_options

[ -f /usr/lib/qmanager/at_engine.sh ] && . /usr/lib/qmanager/at_engine.sh

INIT="/etc/init.d/qmanager_atd"

bool() { "$@" && echo true || echo false; }

emit_state() {
    jq -n \
        --arg engine "$(at_engine_get)" \
        --arg effective "$(at_engine_effective)" \
        --argjson available "$(bool at_broker_available)" \
        --argjson running "$(bool at_broker_running)" \
        '{success:true, engine:$engine, effective:$effective,
          broker_available:$available, broker_running:$running}'
}

if ! command -v at_engine_get >/dev/null 2>&1; then
    cgi_error "apply_failed" "AT engine library is missing"
    exit 0
fi

if [ "$REQUEST_METHOD" = "GET" ]; then
    emit_state
    exit 0
fi

if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post
    ENGINE=$(printf '%s' "$POST_DATA" | jq -r 'if .engine == null then empty else .engine end')

    case "$ENGINE" in
        broker)
            if ! at_broker_available; then
                cgi_error "broker_unavailable" "The AT broker is not installed on this device"
                exit 0
            fi
            ;;
        legacy) ;;
        *)
            cgi_error "invalid_engine" "engine must be 'broker' or 'legacy'"
            exit 0
            ;;
    esac

    uci -q get quecmanager.at >/dev/null 2>&1 || uci set quecmanager.at=at
    uci set quecmanager.at.engine="$ENGINE"
    if ! uci commit quecmanager; then
        cgi_error "apply_failed" "Could not save the AT engine setting"
        exit 0
    fi

    # Repoint qcmd first, then start/stop the daemon. Order matters for the
    # broker->legacy switch: callers move to qcmd.sh before the daemon stops,
    # and either engine serialises on /var/lock/qmanager.lock meanwhile.
    if ! at_engine_link; then
        qlog_error "Failed to repoint /usr/bin/qcmd for engine=$ENGINE"
        cgi_error "apply_failed" "Could not switch the AT engine"
        exit 0
    fi
    if [ -x "$INIT" ]; then
        if [ "$ENGINE" = "broker" ]; then
            "$INIT" enable >/dev/null 2>&1
            "$INIT" restart >/dev/null 2>&1
        else
            "$INIT" restart >/dev/null 2>&1   # start_service opens no instance for legacy
        fi
    fi
    qlog_info "AT engine set to $ENGINE (effective: $(at_engine_effective))"
    emit_state
    exit 0
fi

cgi_error "method_not_allowed" "Only GET and POST are supported"
