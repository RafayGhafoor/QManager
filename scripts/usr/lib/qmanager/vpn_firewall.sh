#!/bin/sh
# =============================================================================
# vpn_firewall.sh — Shared VPN Firewall & Routing Management
# =============================================================================
# Sourced by VPN CGI scripts (tailscale.sh, netbird.sh) and the boot-time
# self-heal init script (qmanager_vpn_zone) to:
#   1. Create/remove fw4 firewall zones for VPN interfaces (UCI-persistent)
#   2. Add/remove the VPN CGNAT range to mwan3's connected-routes ipset
#      (ephemeral — must be re-applied on every install AND every boot)
#
# Why both pieces are required:
#   - fw4's default input policy is DROP, and its input chain only jumps on
#     iifname matches (lo, br-lan, rmnet_data0, mhi_swip0). Without an explicit
#     zone for tailscale0 / wt0, inbound packets on the VPN interface fall
#     through to the policy and are silently dropped.
#   - mwan3 marks outbound traffic for WAN egress unless its source/dest is in
#     mwan3_connected_ipv4. mwan3 only auto-scans connected routes at startup,
#     and the VPN interfaces (tailscale0 / wt0) are not UCI-managed netifd
#     interfaces, so mwan3 does NOT pick them up via hotplug when the daemon
#     comes up later. On a fresh VPN install, the modem's reply packets to
#     100.x peers get marked for WAN egress and never make it back through
#     the tunnel — symptom: tailscale ping works (TS protocol), regular IP
#     ping/SSH/HTTPS time out. The explicit ipset add fixes this.
#
# Persistence:
#   Zones live in UCI (/etc/config/firewall) and survive reboot. The mwan3
#   ipset entry is in-kernel only and is cleared on every reboot, so the
#   boot self-heal must re-add it. The ensure functions are idempotent.
#
# Usage:
#   . /usr/lib/qmanager/vpn_firewall.sh
#   vpn_fw_ensure_zone "tailscale" "tailscale0"
#   vpn_fw_remove_zone "tailscale"
#   vpn_fw_zone_exists "tailscale"   # exit 0 if exists, 1 otherwise
# =============================================================================

[ -n "$_VPN_FW_LOADED" ] && return 0
_VPN_FW_LOADED=1

# Source logging if available
if [ -f /usr/lib/qmanager/qlog.sh ]; then
    . /usr/lib/qmanager/qlog.sh
else
    qlog_info()  { :; }
    qlog_error() { :; }
fi

# Tailscale CGNAT range (RFC 6598). Both Tailscale and Netbird use this range.
VPN_CGNAT_RANGE="100.64.0.0/10"

# -----------------------------------------------------------------------------
# vpn_fw_zone_exists <zone_name>
#   Returns 0 if a firewall zone with the given name exists, 1 otherwise.
# -----------------------------------------------------------------------------
vpn_fw_zone_exists() {
    local name="$1" i=0
    while true; do
        val=$(uci -q get "firewall.@zone[$i].name") || break
        [ "$val" = "$name" ] && return 0
        i=$((i + 1))
    done
    return 1
}

# -----------------------------------------------------------------------------
# vpn_fw_ensure_mwan3_exception
#   Adds the VPN CGNAT range (100.64.0.0/10) to the mwan3_connected_ipv4
#   ipset so mwan3 skips marking VPN-bound traffic. Without this, mwan3 marks
#   reply packets from the modem for WAN egress and they never reach the VPN
#   tunnel.
#   Idempotent — safe to call multiple times. Ephemeral (cleared on reboot),
#   so must be called on every install AND on every boot.
# -----------------------------------------------------------------------------
vpn_fw_ensure_mwan3_exception() {
    if ! command -v ipset >/dev/null 2>&1; then
        qlog_info "ipset not available, skipping mwan3 exception"
        return 0
    fi

    # Check if the ipset exists (mwan3 may not be installed)
    if ! ipset list mwan3_connected_ipv4 >/dev/null 2>&1; then
        qlog_info "mwan3_connected_ipv4 ipset not found, skipping"
        return 0
    fi

    # Check if already present
    if ipset test mwan3_connected_ipv4 "$VPN_CGNAT_RANGE" 2>/dev/null; then
        qlog_info "mwan3 exception for $VPN_CGNAT_RANGE already present"
        return 0
    fi

    ipset add mwan3_connected_ipv4 "$VPN_CGNAT_RANGE" 2>/dev/null
    qlog_info "Added $VPN_CGNAT_RANGE to mwan3_connected_ipv4 ipset"
    return 0
}

# -----------------------------------------------------------------------------
# vpn_fw_remove_mwan3_exception
#   Removes the VPN CGNAT range from mwan3 ipset. Only called when BOTH
#   VPNs are being removed (if either is still installed, keep the exception).
# -----------------------------------------------------------------------------
vpn_fw_remove_mwan3_exception() {
    if ! command -v ipset >/dev/null 2>&1; then
        return 0
    fi

    if ! ipset list mwan3_connected_ipv4 >/dev/null 2>&1; then
        return 0
    fi

    ipset del mwan3_connected_ipv4 "$VPN_CGNAT_RANGE" 2>/dev/null
    qlog_info "Removed $VPN_CGNAT_RANGE from mwan3_connected_ipv4 ipset"
    return 0
}

# -----------------------------------------------------------------------------
# vpn_fw_ensure_zone <zone_name> <device>
#   Idempotent: creates firewall zone + forwarding rules if they don't exist.
#   Always re-asserts the mwan3 exception (ephemeral, lost on reboot).
#   Zone: input=ACCEPT, output=ACCEPT, forward=ACCEPT, device=<device>
#   Forwarding: <zone>→lan and lan→<zone>
# -----------------------------------------------------------------------------
vpn_fw_ensure_zone() {
    local zone_name="$1" device="$2"

    if [ -z "$zone_name" ] || [ -z "$device" ]; then
        qlog_error "vpn_fw_ensure_zone: missing zone_name or device"
        return 1
    fi

    # Zone already exists — still ensure mwan3 exception (ephemeral, lost on reboot)
    if vpn_fw_zone_exists "$zone_name"; then
        qlog_info "Firewall zone '$zone_name' already exists, skipping zone creation"
        vpn_fw_ensure_mwan3_exception
        return 0
    fi

    qlog_info "Creating firewall zone '$zone_name' for device '$device'"

    # Create zone
    uci add firewall zone >/dev/null
    uci set "firewall.@zone[-1].name=$zone_name"
    uci set "firewall.@zone[-1].input=ACCEPT"
    uci set "firewall.@zone[-1].output=ACCEPT"
    uci set "firewall.@zone[-1].forward=ACCEPT"
    uci set "firewall.@zone[-1].device=$device"

    # Forwarding: vpn → lan
    uci add firewall forwarding >/dev/null
    uci set "firewall.@forwarding[-1].src=$zone_name"
    uci set "firewall.@forwarding[-1].dest=lan"

    # Forwarding: lan → vpn
    uci add firewall forwarding >/dev/null
    uci set "firewall.@forwarding[-1].src=lan"
    uci set "firewall.@forwarding[-1].dest=$zone_name"

    uci commit firewall
    /etc/init.d/firewall restart >/dev/null 2>&1

    # Add mwan3 ipset exception for VPN CGNAT range
    vpn_fw_ensure_mwan3_exception

    qlog_info "Firewall zone '$zone_name' created successfully"
    return 0
}

# -----------------------------------------------------------------------------
# vpn_fw_remove_zone <zone_name>
#   Removes the firewall zone and all associated forwarding rules.
#   Deletes forwarding indices in reverse order to avoid index shifting.
#   Removes the mwan3 ipset exception only if the OTHER VPN is also not
#   installed (both VPNs share the same CGNAT range).
# -----------------------------------------------------------------------------
vpn_fw_remove_zone() {
    local zone_name="$1"

    if [ -z "$zone_name" ]; then
        qlog_error "vpn_fw_remove_zone: missing zone_name"
        return 1
    fi

    if ! vpn_fw_zone_exists "$zone_name"; then
        qlog_info "Firewall zone '$zone_name' does not exist, skipping removal"
        return 0
    fi

    qlog_info "Removing firewall zone '$zone_name'"

    # --- Remove forwarding rules (reverse order) ---
    local fwd_indices="" i=0
    while true; do
        src=$(uci -q get "firewall.@forwarding[$i].src") || break
        dest=$(uci -q get "firewall.@forwarding[$i].dest") || break
        if [ "$src" = "$zone_name" ] || [ "$dest" = "$zone_name" ]; then
            fwd_indices="$i $fwd_indices"   # prepend → builds reverse order
        fi
        i=$((i + 1))
    done

    for idx in $fwd_indices; do
        uci delete "firewall.@forwarding[$idx]" 2>/dev/null
    done

    # --- Remove zone ---
    i=0
    while true; do
        val=$(uci -q get "firewall.@zone[$i].name") || break
        if [ "$val" = "$zone_name" ]; then
            uci delete "firewall.@zone[$i]"
            break
        fi
        i=$((i + 1))
    done

    uci commit firewall
    /etc/init.d/firewall restart >/dev/null 2>&1

    # Only remove mwan3 exception if the OTHER VPN is also not installed.
    # Both Tailscale and NetBird use the same CGNAT range.
    local other_vpn_present=false
    if [ "$zone_name" = "tailscale" ] && command -v netbird >/dev/null 2>&1; then
        other_vpn_present=true
    elif [ "$zone_name" = "netbird" ] && command -v tailscale >/dev/null 2>&1; then
        other_vpn_present=true
    fi

    if [ "$other_vpn_present" = "false" ]; then
        vpn_fw_remove_mwan3_exception
    else
        qlog_info "Other VPN still installed, keeping mwan3 exception"
    fi

    qlog_info "Firewall zone '$zone_name' removed successfully"
    return 0
}

# -----------------------------------------------------------------------------
# vpn_check_other_installed <binary_name>
#   Echoes "true" if the given binary is found, "false" otherwise.
#   Emitted as a JSON literal — consumed by VPN CGI GET handlers via
#   jq --argjson to report whether the "other" VPN is present.
# -----------------------------------------------------------------------------
vpn_check_other_installed() {
    if command -v "$1" >/dev/null 2>&1; then
        echo "true"
    else
        echo "false"
    fi
}
