#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# radio_details.sh — CGI Endpoint: On-demand Layer-1 / data-plane radio details
# =============================================================================
# Reads the radio details that USED to ride the recurring poller timer but are
# now fetched ONLY while the UI page that displays them is open:
#   - MIMO layers       (AT+QNWCFG="lte_mimo_layers" / "nr5g_mimo_layers")
#   - Timing advance    (AT+QNWCFG="lte_time_advance" / "nr5g_time_advance")
#   - APN + DNS         (AT+CGCONTRDP)
#   - WAN IPv4/IPv6     (AT+QMAP="WWAN")
#
# WHY on-demand: these are L1/RF-measurement / data-plane reads. Issued on a
# background timer they eventually land mid-RAT-transition / mid-reselection,
# which on the RM551E-GL correlates with a Qualcomm MPSS baseband SSR. The
# predecessor (QuecManager), which lacks the drop bug, reads these only while a
# UI tab is open. See docs/features/ondemand-radio-details.md.
#
# RAT gate: mimo_layers crashes the firmware in the wrong RAT. The shared
# fetch re-reads the serving cell first and only issues the mode-appropriate
# mimo read; an unknown / transitioning RAT skips mimo entirely.
#
# The fetch also refreshes /tmp/qmanager_ondemand.json, which the poller's
# write_cache() reads so the public status snapshot retains last-known values
# between fetches.
#
# Endpoint: GET /cgi-bin/quecmanager/cellular/radio_details.sh
# Response (success):
# {
#   "success": true,
#   "details": {
#     "mimo": "LTE 1x4 | NR 2x4",   // string, "" if unknown
#     "lte_ta": "12",               // numeric string, "" if unknown
#     "nr_ta": "8",                 // numeric string, "" if unknown
#     "apn": "internet",            // string, "" if unknown
#     "wan_ipv4": "10.1.2.3",       // string, "" if unknown
#     "wan_ipv6": "2001:db8::1",    // string, "" if none/unknown
#     "primary_dns": "8.8.8.8",
#     "secondary_dns": "8.8.4.4",
#     "primary_dns_v4": "8.8.8.8",
#     "primary_dns_v6": "",
#     "secondary_dns_v4": "8.8.4.4",
#     "secondary_dns_v6": "",
#     "updated_at": 1718539200      // epoch seconds of this read; 0 if never
#   }
# }
# Response (modem unreachable): last-known cache is still returned with
# "success": true and a "stale": true flag, so the UI shows the prior value
# instead of a scary empty state.
# Response (error): {"success": false, "error": "...", "detail": "..."}
#
# Install location: /www/cgi-bin/quecmanager/cellular/radio_details.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_radio_details"
cgi_headers
cgi_handle_options

# --- Dependencies ------------------------------------------------------------
# parse_at.sh provides the parsers; ondemand_radio.sh provides the fetch +
# cache helpers (and the t2_*/lte_ta/nr_ta variables they populate).
if [ -f /usr/lib/qmanager/parse_at.sh ]; then
    . /usr/lib/qmanager/parse_at.sh
else
    cgi_error "internal_error" "parse library unavailable"
    exit 0
fi
if [ -f /usr/lib/qmanager/ondemand_radio.sh ]; then
    . /usr/lib/qmanager/ondemand_radio.sh
else
    cgi_error "internal_error" "radio library unavailable"
    exit 0
fi

# --- Emit the current on-demand cache as the response details ----------------
# Reads the same 12 fields ondemand_radio_fetch persists, with explicit null
# handling so absent keys render as empty strings (never JSON null), matching
# the documented contract.
emit_details() {
    _stale_flag="$1"   # "true" or "false"
    if [ -s "$ONDEMAND_CACHE_FILE" ]; then
        jq --argjson stale "$_stale_flag" '{
            success: true,
            stale: $stale,
            details: {
                mimo:             (if .mimo == null then "" else .mimo end),
                lte_ta:           (if .lte_ta == null then "" else .lte_ta end),
                nr_ta:            (if .nr_ta == null then "" else .nr_ta end),
                apn:              (if .apn == null then "" else .apn end),
                wan_ipv4:         (if .wan_ipv4 == null then "" else .wan_ipv4 end),
                wan_ipv6:         (if .wan_ipv6 == null then "" else .wan_ipv6 end),
                primary_dns:      (if .primary_dns == null then "" else .primary_dns end),
                secondary_dns:    (if .secondary_dns == null then "" else .secondary_dns end),
                primary_dns_v4:   (if .primary_dns_v4 == null then "" else .primary_dns_v4 end),
                primary_dns_v6:   (if .primary_dns_v6 == null then "" else .primary_dns_v6 end),
                secondary_dns_v4: (if .secondary_dns_v4 == null then "" else .secondary_dns_v4 end),
                secondary_dns_v6: (if .secondary_dns_v6 == null then "" else .secondary_dns_v6 end),
                updated_at:       (if .updated_at == null then 0 else .updated_at end)
            }
        }' "$ONDEMAND_CACHE_FILE" 2>/dev/null && return 0
    fi
    # No cache file yet (never fetched and modem unreachable on first call):
    # emit an all-empty, never-updated payload so the UI binds cleanly.
    jq -n --argjson stale "$_stale_flag" '{
        success: true,
        stale: $stale,
        details: {
            mimo: "", lte_ta: "", nr_ta: "",
            apn: "", wan_ipv4: "", wan_ipv6: "",
            primary_dns: "", secondary_dns: "",
            primary_dns_v4: "", primary_dns_v6: "",
            secondary_dns_v4: "", secondary_dns_v6: "",
            updated_at: 0
        }
    }'
}

# --- Run the on-demand fetch, or serve a fresh cache -------------------------
# ondemand_radio_fetch loads last-known first, issues the RAT-gated reads, then
# rewrites ONDEMAND_CACHE_FILE. On total modem unreachability it returns 1 and
# leaves the prior cache intact — we then serve that with stale=true.
#
# TTL (change 24): the UI polls this endpoint every 7 s while its page is open,
# and the values it carries - MIMO layers, timing advance, APN, DNS, WAN IP -
# change on the order of minutes. Re-reading the modem on every poll was 4 AT
# reads plus a parse each time, for a value that had not changed. Serve the
# cache while it is younger than ONDEMAND_TTL_SEC (default 30) and fetch
# otherwise.
#
#   ?force=1             always fetch - a manual refresh cannot be defeated here
#   ONDEMAND_TTL_SEC=0   restore the old always-fetch behaviour
#
# This is a deliberate staleness contract: `stale` keeps its meaning, "the modem
# did not answer". A cached value younger than the TTL is served as fresh, which
# is what the UI already assumes at a 7 s poll.
_od_ttl="${ONDEMAND_TTL_SEC:-30}"
case "$_od_ttl" in ''|*[!0-9]*) _od_ttl=30 ;; esac
_od_force=0
case "$QUERY_STRING" in *force=1*) _od_force=1 ;; esac
_od_age=""
if [ "$_od_ttl" -gt 0 ] && [ -s "$ONDEMAND_CACHE_FILE" ]; then
    _od_ts=$(jsonfilter -i "$ONDEMAND_CACHE_FILE" -e '@.updated_at' 2>/dev/null)
    case "$_od_ts" in ''|*[!0-9]*) _od_ts=0 ;; esac
    [ "$_od_ts" -gt 0 ] && _od_age=$(( $(date +%s) - _od_ts ))
fi
if [ "$_od_force" = "0" ] && [ -n "$_od_age" ] && [ "$_od_age" -lt "$_od_ttl" ]; then
    qlog_debug "radio_details: cache age ${_od_age}s < ${_od_ttl}s - serving without a modem read"
    emit_details "false"
    exit 0
fi

if ondemand_radio_fetch; then
    emit_details "false"
else
    qlog_warn "radio_details: fetch failed (modem unreachable); serving last-known"
    emit_details "true"
fi

exit 0
