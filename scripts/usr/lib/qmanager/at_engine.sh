#!/bin/sh
# =============================================================================
# at_engine.sh — AT engine selection + host AT port (port-bridge) control
# =============================================================================
# Sourced by /etc/init.d/qmanager_atd, system/at_engine.sh and
# system/host_at_ports.sh. See docs/features/at-broker.md.
#
# AT engine (UCI quecmanager.at.engine = broker | legacy, default broker):
#   /usr/bin/qcmd is a SYMLINK. broker -> qmanager_atd (Rust client that talks
#   to the broker socket and falls back to an in-process exchange when the
#   daemon is down). legacy -> qcmd.sh (the original shell gatekeeper). Both
#   keep the identical output contract, so callers never notice the switch.
#
# Host AT ports (UCI quecmanager.ports.host_at = 1 | 0, default 1):
#   The vendor port-bridged service relays the USB/PCIe host AT ports into the
#   baseband (at_mdm0<->at_usb0, smd7<->at_usb2 or mhi_pipe_32). QManager never
#   uses them; turning them off stops a USB/PCIe-attached host from issuing AT
#   commands and closes the world-writable /dev/smd7 path. It does not change
#   QManager's own AT speed (that path is /dev/smd11).
#
# Install location: /usr/lib/qmanager/at_engine.sh
# =============================================================================

[ -n "$_AT_ENGINE_LOADED" ] && return 0
_AT_ENGINE_LOADED=1

ATE_BROKER_BIN="/usr/bin/qmanager_atd"
ATE_LEGACY_BIN="/usr/bin/qcmd.sh"
ATE_LINK="/usr/bin/qcmd"
ATE_SOCK="/var/run/qmanager_atd.sock"
PB_INIT="/etc/init.d/port-bridged"

# --- AT engine ---------------------------------------------------------------

# Configured engine: "broker" (default) or "legacy".
at_engine_get() {
    case "$(uci -q get quecmanager.at.engine)" in
        legacy) echo "legacy" ;;
        *)      echo "broker" ;;
    esac
}

at_broker_available() {
    [ -x "$ATE_BROKER_BIN" ]
}

at_broker_running() {
    [ -S "$ATE_SOCK" ] && pidof qmanager_atd >/dev/null 2>&1
}

# Engine actually in effect, read from where the link points.
at_engine_effective() {
    case "$(readlink "$ATE_LINK" 2>/dev/null)" in
        *qmanager_atd) echo "broker" ;;
        *qcmd.sh)      echo "legacy" ;;
        *)             echo "unknown" ;;
    esac
}

# Atomically repoint /usr/bin/qcmd. ln -sf would unlink then create, leaving a
# moment with no qcmd at all; a temp link + rename(2) never does.
_ate_link_to() {
    _ate_tmp="/usr/bin/.qcmd.$$"
    rm -f "$_ate_tmp"
    ln -s "$1" "$_ate_tmp" || return 1
    if ! mv -f "$_ate_tmp" "$ATE_LINK"; then
        rm -f "$_ate_tmp"
        return 1
    fi
    return 0
}

# Point /usr/bin/qcmd at the configured engine. Falls back to whichever engine
# is installed if the configured one is missing. Idempotent.
at_engine_link() {
    if [ "$(at_engine_get)" = "broker" ] && at_broker_available; then
        _ate_target="qmanager_atd"
    elif [ -f "$ATE_LEGACY_BIN" ]; then
        _ate_target="qcmd.sh"
    else
        _ate_target="qmanager_atd"
    fi
    [ "$(readlink "$ATE_LINK" 2>/dev/null)" = "$_ate_target" ] && return 0
    _ate_link_to "$_ate_target"
}

# --- Host AT ports (port-bridge) ---------------------------------------------

host_at_available() {
    [ -x "$PB_INIT" ]
}

# Configured state: 1 (on, default) or 0 (off).
host_at_get() {
    [ "$(uci -q get quecmanager.ports.host_at)" = "0" ] && echo 0 || echo 1
}

host_at_running() {
    pidof port-bridge >/dev/null 2>&1
}

# In PCIe mode the host's AT port is the PCIe link itself.
host_at_pcie() {
    [ -e /dev/mhi_ctrl ]
}

# Reconcile live state to UCI. Idempotent; safe at boot and on every apply.
# disable/enable persist across reboots (rc.d links); a firmware update can
# reset them, so qmanager_atd re-runs this at boot.
host_at_apply() {
    host_at_available || return 0
    if [ "$(host_at_get)" = "0" ]; then
        "$PB_INIT" enabled >/dev/null 2>&1 && "$PB_INIT" disable >/dev/null 2>&1
        # procd stop kills both instances and suppresses respawn.
        host_at_running && "$PB_INIT" stop >/dev/null 2>&1
        # port-bridged chmods /dev/smd7 777 on start; close that direct path
        # into the AT engine while the bridge is off. Its start restores it.
        [ -c /dev/smd7 ] && chmod 600 /dev/smd7 2>/dev/null
    else
        "$PB_INIT" enabled >/dev/null 2>&1 || "$PB_INIT" enable >/dev/null 2>&1
        host_at_running || "$PB_INIT" start >/dev/null 2>&1
    fi
    return 0
}
