#!/bin/sh
# =============================================================================
# parse_at.sh — AT Command Response Parsers for QManager
# =============================================================================
# Sourced by qmanager_poller. All functions here operate on raw AT command
# response strings and populate global state variables defined in the poller.
#
# Dependencies: qlog_* functions (from qlog.sh), global state variables
# Install location: /usr/lib/qmanager/parse_at.sh
# =============================================================================

[ -n "$_PARSE_AT_LOADED" ] && return 0
_PARSE_AT_LOADED=1

# --- Sentinel Value Mapping ---------------------------------------------------
# Maps Quectel sentinel values to JSON null for inactive/unavailable antennas.
# NOTE: _sig_val and _antenna_to_json_array use printf for performance — these
# run 3+ times per poll cycle and only handle integers/null (no string escaping).
_sig_val() {
    case "$1" in
        -32768|"") echo "null" ;;
        *) echo "$1" ;;
    esac
}

# Convert 4 antenna values to a JSON array string with sentinel mapping.
# Usage: _antenna_to_json_array val0 val1 val2 val3
# Output: "[-95,-97,null,null]"
_antenna_to_json_array() {
    printf '[%s,%s,%s,%s]' "$(_sig_val "$1")" "$(_sig_val "$2")" "$(_sig_val "$3")" "$(_sig_val "$4")"
}

# Parse a single response line from AT+QRSRP/QRSRQ/QSINR into a JSON array.
# Args: $1=response line (may be empty), $2=prefix (e.g. "QRSRP")
# Output: JSON array string like "[-95,-97,null,null]" on stdout
_antenna_line_to_json() {
    local line="$1" prefix="$2"
    if [ -z "$line" ]; then
        echo "[null,null,null,null]"
        return
    fi
    local csv
    csv=$(printf '%s' "$line" | sed "s/+${prefix}: *//" | tr -d ' \r')
    _antenna_to_json_array \
        "$(printf '%s' "$csv" | cut -d',' -f1)" \
        "$(printf '%s' "$csv" | cut -d',' -f2)" \
        "$(printf '%s' "$csv" | cut -d',' -f3)" \
        "$(printf '%s' "$csv" | cut -d',' -f4)"
}

# --- Hex-to-Decimal Cell ID Decomposition ------------------------------------
# Converts a hex cell ID to decimal and computes eNodeB/gNodeB ID + Sector ID.
# LTE (28-bit ECI): eNodeB ID = cell_id >> 8,  Sector ID = cell_id & 0xFF
# NR  (36-bit NCI): gNodeB ID = cell_id >> 14, Sector ID = cell_id & 0x3FFF
# Sets globals: _cid_dec, _cid_enb, _cid_sec
# Args: $1=hex_cell_id, $2="nr" for NR bit-split (default: LTE)
_compute_cell_parts() {
    _cid_dec="" ; _cid_enb="" ; _cid_sec=""
    [ -z "$1" ] && return
    _cid_dec=$(printf '%d' "0x$1" 2>/dev/null) || { _cid_dec=""; return; }
    if [ "$2" = "nr" ]; then
        _cid_enb=$((_cid_dec / 16384))
        _cid_sec=$((_cid_dec % 16384))
    else
        _cid_enb=$((_cid_dec / 256))
        _cid_sec=$((_cid_dec % 256))
    fi
}

# Converts a hex string (e.g. TAC) to decimal. Empty input → empty output.
_hex_to_dec() {
    [ -z "$1" ] && return
    printf '%d' "0x$1" 2>/dev/null
}

# --- SCS Enum to kHz Mapping --------------------------------------------------
map_scs_to_khz() {
    case "$1" in
        0) echo 15 ;;
        1) echo 30 ;;
        2) echo 60 ;;
        3) echo 120 ;;
        4) echo 240 ;;
        *) echo "" ;;
    esac
}

# --- LTE SINR scale conversion -----------------------------------------------
# AT+QENG's LTE <SINR> field is NOT dB. Per the RG520N/RM5xxN AT commands manual
# (5.20, <SINR>, "In LTE mode"): "The conversion formula for actual SINR is
# Y = (1/5) x X x 10 - 20", i.e. Y = 2X - 20 dB for raw X in 0..25 (Y -20..30).
# The same field is used by BOTH QENG LTE lines - the LTE-only "servingcell"
# line and the EN-DC "LTE" line. The 5G <SINR> values ("NR5G-NSA"/"NR5G-SA")
# are already dB and must NOT go through this.
#
# Measured on the Suncomm X75 (RM551EGL00AAR02A02M8G, 2026-10-19) while one cell
# was read three ways: QENG raw X 9..12, AT+QCAINFO RSSNR 0..2 dB, AT+QSINR
# -4..5 dB, and QENG CQI 4. The raw field read ~10 dB high - publishing X
# verbatim made the dashboard show "10 dB" for an actual 0 dB.
#
# Anything not convertible (empty, "-", -32768, non-numeric, X outside 0..25,
# or a digit string longer than two characters) prints nothing, so the caller
# publishes null instead of a fabricated dB value. The length guard keeps the
# arithmetic below inside ash's integer range whatever the modem sends.
# Usage: db=$(_lte_sinr_to_db "$raw")   ("-20".."30", or empty)
_lte_sinr_to_db() {
    case "$1" in
        ''|*[!0-9]*) return ;;
    esac
    [ ${#1} -le 2 ] || return
    [ "$1" -le 25 ] || return
    echo $(( $1 * 2 - 20 ))
}

# -----------------------------------------------------------------------------
# Parse AT+QENG="servingcell"
# Populates: lte_state, lte_band, lte_earfcn, lte_bandwidth, lte_pci,
#            lte_rsrp, lte_rsrq, lte_sinr (dB, converted from the raw QENG
#            scale), lte_rssi,
#            lte_cell_id, lte_enodeb_id, lte_sector_id, lte_tac,
#            nr_state, nr_band, nr_arfcn, nr_pci, nr_rsrp, nr_rsrq, nr_sinr,
#            nr_scs, nr_cell_id, nr_enodeb_id, nr_sector_id, nr_tac,
#            network_type, service_status
# -----------------------------------------------------------------------------
parse_serving_cell() {
    local raw="$1"

    # Reset all fields
    lte_state="unknown"
    nr_state="unknown"
    lte_band="" ; lte_earfcn="" ; lte_bandwidth="" ; lte_pci=""
    lte_rsrp="" ; lte_rsrq="" ; lte_sinr="" ; lte_rssi=""
    lte_cell_id="" ; lte_enodeb_id="" ; lte_sector_id="" ; lte_tac=""
    nr_band="" ; nr_arfcn="" ; nr_pci=""
    nr_rsrp="" ; nr_rsrq="" ; nr_sinr="" ; nr_scs=""
    nr_cell_id="" ; nr_enodeb_id="" ; nr_sector_id="" ; nr_tac=""

    # Only keep +QENG: response lines (strip any residual echo/OK lines)
    raw=$(printf '%s\n' "$raw" | grep '^+QENG:')

    if [ -z "$raw" ]; then
        qlog_warn "parse_serving_cell: no +QENG: lines in response"
        service_status="unknown"
        return
    fi

    # --- Detect connection state ---
    local sc_line
    sc_line=$(printf '%s\n' "$raw" | grep '"servingcell"' | head -1)

    case "$sc_line" in
        *'"NOCONN"'*)  service_status="idle" ;;
        *'"LIMSRV"'*)  service_status="limited" ;;
        *'"CONNECT"'*) service_status="connected" ;;
        *'"SEARCH"'*)  service_status="searching" ;;
    esac

    # --- Determine mode ---
    local has_nsa
    local has_sa
    local has_lte
    has_nsa=$(printf '%s\n' "$raw" | grep -c '"NR5G-NSA"')
    has_sa=$(printf '%s\n' "$raw" | grep -c '"NR5G-SA"')
    has_lte=$(printf '%s\n' "$raw" | grep -c '"LTE"')

    # ===== EN-DC / NSA MODE =====
    if [ "$has_nsa" -gt 0 ]; then
        network_type="5G-NSA"

        # LTE line (separate from "servingcell" line in EN-DC)
        local lte_line
        lte_line=$(printf '%s\n' "$raw" | grep '"LTE"' | grep -v '"servingcell"' | head -1)

        if [ -n "$lte_line" ]; then
            lte_state="connected"
            local csv
            csv=$(printf '%s' "$lte_line" | sed 's/+QENG: //g' | tr -d '"' | tr -d ' ')

            # LTE,is_tdd,MCC,MNC,cellID,PCID,earfcn,freq_band_ind,UL_bw,DL_bw,TAC,RSRP,RSRQ,RSSI,SINR
            # 1   2      3   4   5      6    7      8              9     10    11  12   13   14   15
            local raw_hex
            raw_hex=$(printf '%s' "$csv" | cut -d',' -f5 | tr -d '\r')
            _compute_cell_parts "$raw_hex"
            lte_cell_id="$_cid_dec" ; lte_enodeb_id="$_cid_enb" ; lte_sector_id="$_cid_sec"
            lte_pci=$(printf '%s' "$csv" | cut -d',' -f6)
            lte_earfcn=$(printf '%s' "$csv" | cut -d',' -f7)
            local band_num
            band_num=$(printf '%s' "$csv" | cut -d',' -f8)
            lte_band="B${band_num}"
            lte_bandwidth=$(printf '%s' "$csv" | cut -d',' -f10)
            lte_tac=$(_hex_to_dec "$(printf '%s' "$csv" | cut -d',' -f11 | tr -d '\r')")
            lte_rsrp=$(printf '%s' "$csv" | cut -d',' -f12)
            lte_rsrq=$(printf '%s' "$csv" | cut -d',' -f13)
            lte_rssi=$(printf '%s' "$csv" | cut -d',' -f14)
            lte_sinr=$(_lte_sinr_to_db "$(printf '%s' "$csv" | cut -d',' -f15 | tr -d '\r')")
        fi

        # NR5G-NSA line
        local nr_line
        nr_line=$(printf '%s\n' "$raw" | grep '"NR5G-NSA"' | head -1)

        if [ -n "$nr_line" ]; then
            nr_state="connected"
            local csv
            csv=$(printf '%s' "$nr_line" | sed 's/+QENG: //g' | tr -d '"' | tr -d ' ' | tr -d '\r')

            # NR5G-NSA,MCC,MNC,PCID,RSRP,SINR,RSRQ,ARFCN,band,NR_DL_bw,scs
            # 1        2   3   4    5    6    7    8     9    10        11
            nr_pci=$(printf '%s' "$csv" | cut -d',' -f4)
            nr_rsrp=$(printf '%s' "$csv" | cut -d',' -f5)
            nr_sinr=$(printf '%s' "$csv" | cut -d',' -f6)
            nr_rsrq=$(printf '%s' "$csv" | cut -d',' -f7)
            nr_arfcn=$(printf '%s' "$csv" | cut -d',' -f8)
            local nr_band_num
            nr_band_num=$(printf '%s' "$csv" | cut -d',' -f9)
            nr_band="N${nr_band_num}"
            local nr_scs_raw
            nr_scs_raw=$(printf '%s' "$csv" | cut -d',' -f11)
            nr_scs=$(map_scs_to_khz "$nr_scs_raw")
        fi

    # ===== SA MODE =====
    elif [ "$has_sa" -gt 0 ]; then
        network_type="5G-SA"
        lte_state="inactive"
        nr_state="connected"

        local csv
        csv=$(printf '%s' "$sc_line" | sed 's/+QENG: //g' | tr -d '"' | tr -d ' ')

        # servingcell,state,NR5G-SA,duplex,MCC,MNC,cellID,PCID,TAC,ARFCN,band,NR_DL_bw,RSRP,RSRQ,SINR,scs,srxlev
        # 1           2     3       4      5   6   7      8    9   10     11   12       13   14   15   16  17
        local raw_hex
        raw_hex=$(printf '%s' "$csv" | cut -d',' -f7 | tr -d '\r')
        _compute_cell_parts "$raw_hex" "nr"
        nr_cell_id="$_cid_dec" ; nr_enodeb_id="$_cid_enb" ; nr_sector_id="$_cid_sec"
        nr_pci=$(printf '%s' "$csv" | cut -d',' -f8)
        nr_tac=$(_hex_to_dec "$(printf '%s' "$csv" | cut -d',' -f9 | tr -d '\r')")
        nr_arfcn=$(printf '%s' "$csv" | cut -d',' -f10)
        local nr_band_num
        nr_band_num=$(printf '%s' "$csv" | cut -d',' -f11)
        nr_band="N${nr_band_num}"
        nr_rsrp=$(printf '%s' "$csv" | cut -d',' -f13)
        nr_rsrq=$(printf '%s' "$csv" | cut -d',' -f14)
        nr_sinr=$(printf '%s' "$csv" | cut -d',' -f15)
        local nr_scs_raw
        nr_scs_raw=$(printf '%s' "$csv" | cut -d',' -f16)
        nr_scs=$(map_scs_to_khz "$nr_scs_raw")

    # ===== LTE-ONLY MODE =====
    elif [ "$has_lte" -gt 0 ]; then
        network_type="LTE"
        nr_state="inactive"

        # LTE-only: "LTE" on the SAME line as "servingcell"
        local csv
        csv=$(printf '%s' "$sc_line" | sed 's/+QENG: //g' | tr -d '"' | tr -d ' ')

        case "$csv" in
            *SEARCH*)
                lte_state="searching"
                return
                ;;
            *NOCONN*)
                lte_state="connected"
                ;;
            *)
                lte_state="connected"
                ;;
        esac

        # servingcell,state,LTE,is_tdd,MCC,MNC,cellID,PCID,earfcn,freq_band_ind,UL_bw,DL_bw,TAC,RSRP,RSRQ,RSSI,SINR,...
        # 1           2     3   4      5   6   7      8    9      10             11    12    13  14   15   16   17
        local raw_hex
        raw_hex=$(printf '%s' "$csv" | cut -d',' -f7 | tr -d '\r')
        _compute_cell_parts "$raw_hex"
        lte_cell_id="$_cid_dec" ; lte_enodeb_id="$_cid_enb" ; lte_sector_id="$_cid_sec"
        lte_pci=$(printf '%s' "$csv" | cut -d',' -f8)
        lte_earfcn=$(printf '%s' "$csv" | cut -d',' -f9)
        local band_num
        band_num=$(printf '%s' "$csv" | cut -d',' -f10)
        lte_band="B${band_num}"
        lte_bandwidth=$(printf '%s' "$csv" | cut -d',' -f12)
        lte_tac=$(_hex_to_dec "$(printf '%s' "$csv" | cut -d',' -f13 | tr -d '\r')")
        lte_rsrp=$(printf '%s' "$csv" | cut -d',' -f14)
        lte_rsrq=$(printf '%s' "$csv" | cut -d',' -f15)
        lte_rssi=$(printf '%s' "$csv" | cut -d',' -f16)
        lte_sinr=$(_lte_sinr_to_db "$(printf '%s' "$csv" | cut -d',' -f17 | tr -d '\r')")

    else
        lte_state="unknown"
        nr_state="unknown"
        service_status="unknown"
    fi
}

# -----------------------------------------------------------------------------
# SoC thermal — Average temperature from /sys/class/thermal (no AT channel)
# Populates: t1_temperature
#
# Reads sysfs instead of AT+QTEMP: AT+QTEMP can crash this firmware's AT
# channel (/dev/smd11). Thermal sysfs is independent of AT and stable.
#
# Selection is by thermal-zone TYPE NAME, not zone index: indices renumber
# across firmware builds but type names are stable.
# -----------------------------------------------------------------------------
parse_temperature() {
    local zone
    local ztype
    local result

    # --- TUNING KNOB: thermal-zone type-name allowlist (case glob) -----------
    # Modem-relevant SoC sensors plus the AP CPU cores (cpuss-*), averaged into
    # the single overall temperature. Edit this glob to tune the zone set
    # for temperature parity. sysfs temp is in millidegrees C; non-positive
    # values (e.g. -273000, -40960, empty) are unavailable sentinels and are
    # excluded by the >0 filter below.
    # -------------------------------------------------------------------------
    result=$(for zone in /sys/class/thermal/thermal_zone*; do
        [ -r "$zone/type" ] || continue
        [ -r "$zone/temp" ] || continue
        ztype=$(cat "$zone/type" 2>/dev/null)
        case "$ztype" in
            mdmss-*|mdmq6-*|sdr[0-9]*|xo-therm*|sys-therm-*|cpuss-*)
                cat "$zone/temp" 2>/dev/null
                ;;
        esac
    done | awk '$1 > 0' | \
        awk '{ sum += $1; count++ } END { if (count > 0) printf "%.0f", sum/1000/count; }')

    if [ -n "$result" ]; then
        t1_temperature="$result"
    else
        t1_temperature=""
    fi
}

# -----------------------------------------------------------------------------
# Parse AT+COPS?
# Populates: t2_carrier
# -----------------------------------------------------------------------------
parse_carrier() {
    local raw="$1"
    local cops_line
    cops_line=$(printf '%s\n' "$raw" | grep '+COPS:' | head -1)

    if [ -z "$cops_line" ]; then
        t2_carrier=""
        return
    fi

    # Strip prefix and CR: "0,0,"Smart",7" or just "2" when deregistered
    local fields
    fields=$(printf '%s' "$cops_line" | sed 's/+COPS: //g' | tr -d '\r')

    # Need at least 3 comma-separated fields for operator name
    local comma_count
    comma_count=$(printf '%s' "$fields" | tr -cd ',' | wc -c)
    if [ "$comma_count" -lt 2 ]; then
        t2_carrier=""
        return
    fi

    t2_carrier=$(printf '%s' "$fields" | cut -d',' -f3 | tr -d '"')
}

# -----------------------------------------------------------------------------
# Parse AT+CPIN?
# Populates: t2_sim_status
# -----------------------------------------------------------------------------
parse_sim_status() {
    local raw="$1"

    case "$raw" in
        *"READY"*)         t2_sim_status="ready" ;;
        *"SIM PIN"*)       t2_sim_status="pin_required" ;;
        *"SIM PUK"*)       t2_sim_status="puk_required" ;;
        *"NOT INSERTED"*|*"NOT READY"*) t2_sim_status="not_inserted" ;;
        *ERROR*)           t2_sim_status="error" ;;
        *)                 t2_sim_status="unknown" ;;
    esac
}

# -----------------------------------------------------------------------------
# Parse AT+QUIMSLOT?
# Populates: t2_sim_slot
# -----------------------------------------------------------------------------
parse_sim_slot() {
    local raw="$1"
    local slot_line
    slot_line=$(printf '%s\n' "$raw" | grep '+QUIMSLOT:' | head -1)

    if [ -n "$slot_line" ]; then
        t2_sim_slot=$(printf '%s' "$slot_line" | sed 's/+QUIMSLOT: //g' | tr -d ' \r')
    fi
}

# -----------------------------------------------------------------------------
# Parse AT+CVERSION (Boot-only)
# Populates: boot_firmware, boot_build_date, boot_manufacturer
# -----------------------------------------------------------------------------
parse_version() {
    local raw="$1"

    boot_firmware=$(printf '%s\n' "$raw" | grep '^VERSION:' | sed 's/VERSION: //g' | tr -d '\r')
    boot_build_date=$(printf '%s\n' "$raw" | grep -E '^[A-Z][a-z]{2} +[0-9]' | head -1 | awk '{print $1, $2, $3}' | tr -d '\r')
    boot_manufacturer=$(printf '%s\n' "$raw" | grep '^Authors:' | sed 's/Authors: //g' | tr -d '\r')
}

# -----------------------------------------------------------------------------
# Parse AT+QGETCAPABILITY (Boot-only)
# Populates: boot_lte_category
# -----------------------------------------------------------------------------
parse_capability() {
    local raw="$1"

    local cat_line
    cat_line=$(printf '%s\n' "$raw" | grep '+QGETCAPABILITY: LTE-CATEGORY:' | head -1)

    if [ -n "$cat_line" ]; then
        boot_lte_category=$(printf '%s' "$cat_line" | sed 's/+QGETCAPABILITY: LTE-CATEGORY://g' | tr -d ' \r')
    fi
}

# -----------------------------------------------------------------------------
# Parse AT+QNWCFG="lte_mimo_layers" / "nr_mimo_layers" (Tier 2)
# Args: $1 = LTE mimo response, $2 = NR mimo response (optional)
# Populates: t2_mimo
# -----------------------------------------------------------------------------
parse_mimo() {
    local lte_raw="$1"
    local nr_raw="$2"

    local lte_part=""
    local nr_part=""

    # LTE MIMO: +QNWCFG: "lte_mimo_layers",<ul>,<dl>
    local lte_line
    lte_line=$(printf '%s\n' "$lte_raw" | grep '+QNWCFG: "lte_mimo_layers"' | head -1)
    if [ -n "$lte_line" ]; then
        local csv
        csv=$(printf '%s' "$lte_line" | sed 's/+QNWCFG: "lte_mimo_layers",//g' | tr -d ' \r')
        local ul_mimo dl_mimo
        ul_mimo=$(printf '%s' "$csv" | cut -d',' -f1)
        dl_mimo=$(printf '%s' "$csv" | cut -d',' -f2)
        if [ -n "$ul_mimo" ] && [ -n "$dl_mimo" ]; then
            lte_part="LTE ${ul_mimo}x${dl_mimo}"
        fi
    fi

    # NR MIMO: +QNWCFG: "nr5g_mimo_layers",<ul>,<dl>
    if [ -n "$nr_raw" ]; then
        local nr_line
        nr_line=$(printf '%s\n' "$nr_raw" | grep '+QNWCFG: "nr5g_mimo_layers"' | head -1)
        if [ -n "$nr_line" ]; then
            local csv
            csv=$(printf '%s' "$nr_line" | sed 's/+QNWCFG: "nr5g_mimo_layers",//g' | tr -d ' \r')
            local ul_mimo dl_mimo
            ul_mimo=$(printf '%s' "$csv" | cut -d',' -f1)
            dl_mimo=$(printf '%s' "$csv" | cut -d',' -f2)
            if [ -n "$ul_mimo" ] && [ -n "$dl_mimo" ]; then
                nr_part="NR ${ul_mimo}x${dl_mimo}"
            fi
        fi
    fi

    # Combine: "LTE 1x4 | NR 2x4" or just "LTE 1x4"
    if [ -n "$lte_part" ] && [ -n "$nr_part" ]; then
        t2_mimo="${lte_part} | ${nr_part}"
    elif [ -n "$lte_part" ]; then
        t2_mimo="$lte_part"
    elif [ -n "$nr_part" ]; then
        t2_mimo="$nr_part"
    fi
}

# --- LTE Resource Blocks → MHz Mapping ----------------------------------------
# QCAINFO uses resource block counts for LTE bandwidth, not the enum used by
# AT+QENG. Mapping per 3GPP 36.101 Table 5.6-1.
_lte_rb_to_mhz() {
    case "$1" in
        6)   echo 1 ;;    # 1.4 MHz — round to 1 for integer math
        15)  echo 3 ;;
        25)  echo 5 ;;
        50)  echo 10 ;;
        75)  echo 15 ;;
        100) echo 20 ;;
        *)   echo 0 ;;
    esac
}

# --- NR Bandwidth Enum → MHz Mapping ------------------------------------------
# Same enum as AT+QENG NR_DL_bandwidth. Mapping per 3GPP 38.101.
_nr_bw_to_mhz() {
    case "$1" in
        0)  echo 5 ;;
        1)  echo 10 ;;
        2)  echo 15 ;;
        3)  echo 20 ;;
        4)  echo 25 ;;
        5)  echo 30 ;;
        6)  echo 40 ;;
        7)  echo 50 ;;
        8)  echo 60 ;;
        9)  echo 70 ;;
        10) echo 80 ;;
        11) echo 90 ;;
        12) echo 100 ;;
        13) echo 200 ;;
        14) echo 400 ;;
        15) echo 35 ;;
        16) echo 45 ;;
        *)  echo 0 ;;
    esac
}

# -----------------------------------------------------------------------------
# Parse AT+QCAINFO (Tier 2) — Carrier Aggregation status + bandwidth +
#   per-carrier component details
# Populates: t2_ca_active, t2_ca_count, t2_nr_ca_active, t2_nr_ca_count,
#            t2_total_bandwidth_mhz, t2_bandwidth_details,
#            t2_carrier_components (JSON array string)
#
# Per-carrier component output (JSON array):
#   [{"type":"PCC","technology":"LTE","band":"B3","earfcn":1350,
#     "bandwidth_mhz":15,"pci":135,"rsrp":-115,"rsrq":-15,
#     "rssi":-82,"sinr":5}, ...]
#
# AT+QCAINFO response formats (all fields after stripping +QCAINFO: and quotes/spaces):
#
# LTE PCC/SCC: type,freq,bw_rb,LTEBAND<N>,state,PCI,RSRP,RSRQ,RSSI,RSSNR[,...]
#   Positions:  1    2    3     4          5     6   7    8    9    10
#
# NR short (PCC or old SCC): type,freq,bw_enum,NR5GBAND<N>,PCI[,RSRP,RSRQ[,SNR]]
#   Positions:                1    2    3       4           5  6    7     8
#   Total fields: 5-8
#
# NR long (SCC with UL info): type,freq,bw_enum,NR5GBAND<N>,state,PCI,UL_cfg,UL_bw,UL_ARFCN[,RSRP,RSRQ[,SNR]]
#   Positions:                 1    2    3       4           5     6   7      8     9       10   11    12
#   Total fields: 9-12
#
# NR_SNR conversion: actual_dB = raw_value / 100 (3GPP)
# -----------------------------------------------------------------------------
parse_ca_info() {
    local raw="$1"

    # --- CA counts ---
    local lte_scc_count
    lte_scc_count=$(printf '%s\n' "$raw" | grep '+QCAINFO: "SCC"' | grep -c 'LTE BAND')

    if [ "$lte_scc_count" -gt 0 ]; then
        t2_ca_active=true
        t2_ca_count=$lte_scc_count
    else
        t2_ca_active=false
        t2_ca_count=0
    fi

    local nr_scc_count
    nr_scc_count=$(printf '%s\n' "$raw" | grep '+QCAINFO: "SCC"' | grep -c 'NR')

    if [ "$nr_scc_count" -gt 0 ]; then
        # In NSA mode, the first NR SCC is the NR leg itself (LTE is PCC).
        # True NR CA only when there are 2+ NR SCCs.
        if [ "$network_type" = "5G-NSA" ]; then
            if [ "$nr_scc_count" -gt 1 ]; then
                t2_nr_ca_active=true
                t2_nr_ca_count=$((nr_scc_count - 1))
            else
                t2_nr_ca_active=false
                t2_nr_ca_count=0
            fi
        else
            t2_nr_ca_active=true
            t2_nr_ca_count=$nr_scc_count
        fi
    else
        t2_nr_ca_active=false
        t2_nr_ca_count=0
    fi

    # --- Bandwidth + per-carrier component parsing ---
    local total_mhz=0
    local details=""
    local cc_tmpfile="/tmp/qmanager_cc_data.tmp"
    : > "$cc_tmpfile"
    local qca_lines
    qca_lines=$(printf '%s\n' "$raw" | grep '^+QCAINFO:')

    if [ -z "$qca_lines" ]; then
        t2_total_bandwidth_mhz=0
        t2_bandwidth_details=""
        t2_carrier_components="[]"
        return
    fi

    # Process via file redirect to avoid BusyBox subshell trap.
    local tmpfile="/tmp/qmanager_ca_parse.tmp"
    printf '%s\n' "$qca_lines" > "$tmpfile"

    local nr_pcc_seen=0
    while IFS= read -r line; do
        # Strip prefix, quotes, spaces, carriage returns
        local csv
        csv=$(printf '%s' "$line" | sed 's/+QCAINFO: //g' | tr -d '"' | tr -d ' ' | tr -d '\r')

        local cc_type
        cc_type=$(printf '%s' "$csv" | cut -d',' -f1)

        local freq
        freq=$(printf '%s' "$csv" | cut -d',' -f2)

        local bw_raw
        bw_raw=$(printf '%s' "$csv" | cut -d',' -f3)

        local band_str
        band_str=$(printf '%s' "$csv" | cut -d',' -f4)

        # Count total comma-separated fields
        local nfields
        nfields=$(printf '%s' "$csv" | awk -F',' '{print NF}')

        local tech="" band_short="" mhz=0
        local cc_pci="null" cc_rsrp="null" cc_rsrq="null" cc_rssi="null" cc_sinr="null"

        case "$band_str" in
            LTEBAND*)
                # ---- LTE line ----
                tech="LTE"
                mhz=$(_lte_rb_to_mhz "$bw_raw")
                local band_num
                band_num=$(printf '%s' "$band_str" | sed 's/LTEBAND//')
                band_short="B${band_num}"

                # LTE fields: type(1),freq(2),bw(3),band(4),state(5),PCI(6),RSRP(7),RSRQ(8),RSSI(9),RSSNR(10)
                cc_pci=$(printf '%s' "$csv" | cut -d',' -f6)
                cc_rsrp=$(printf '%s' "$csv" | cut -d',' -f7)
                cc_rsrq=$(printf '%s' "$csv" | cut -d',' -f8)
                cc_rssi=$(printf '%s' "$csv" | cut -d',' -f9)
                cc_sinr=$(printf '%s' "$csv" | cut -d',' -f10)
                ;;
            NR5GBAND*|NRDCBAND*)
                # ---- NR line ----
                tech="NR"
                mhz=$(_nr_bw_to_mhz "$bw_raw")
                local band_num
                band_num=$(printf '%s' "$band_str" | sed 's/NR5GBAND//;s/NRDCBAND//')
                band_short="N${band_num}"

                if [ "$nfields" -ge 9 ]; then
                    # Long form (SCC with UL info):
                    # type(1),freq(2),bw(3),band(4),state(5),PCI(6),UL_cfg(7),UL_bw(8),UL_ARFCN(9)[,RSRP(10),RSRQ(11)[,SNR(12)]]
                    cc_pci=$(printf '%s' "$csv" | cut -d',' -f6)
                    [ "$nfields" -ge 10 ] && cc_rsrp=$(printf '%s' "$csv" | cut -d',' -f10)
                    [ "$nfields" -ge 11 ] && cc_rsrq=$(printf '%s' "$csv" | cut -d',' -f11)
                    if [ "$nfields" -ge 12 ]; then
                        local raw_snr
                        raw_snr=$(printf '%s' "$csv" | cut -d',' -f12)
                        case "$raw_snr" in
                            -32768) cc_sinr="null" ;;
                            *) cc_sinr=$(printf '%s' "$raw_snr" | awk '{if($1+0==$1) printf "%.1f", $1/100; else print "null"}') ;;
                        esac
                    fi
                else
                    # Short form (PCC or old SCC):
                    # type(1),freq(2),bw(3),band(4),PCI(5)[,RSRP(6),RSRQ(7)[,SNR(8)]]
                    cc_pci=$(printf '%s' "$csv" | cut -d',' -f5)
                    [ "$nfields" -ge 6 ] && cc_rsrp=$(printf '%s' "$csv" | cut -d',' -f6)
                    [ "$nfields" -ge 7 ] && cc_rsrq=$(printf '%s' "$csv" | cut -d',' -f7)
                    if [ "$nfields" -ge 8 ]; then
                        local raw_snr
                        raw_snr=$(printf '%s' "$csv" | cut -d',' -f8)
                        case "$raw_snr" in
                            -32768) cc_sinr="null" ;;
                            *) cc_sinr=$(printf '%s' "$raw_snr" | awk '{if($1+0==$1) printf "%.1f", $1/100; else print "null"}') ;;
                        esac
                    fi
                fi
                ;;
            *)
                # Unrecognized band string — skip
                continue
                ;;
        esac

        # --- Accumulate bandwidth totals ---
        if [ "$mhz" -gt 0 ] 2>/dev/null; then
            total_mhz=$((total_mhz + mhz))
            if [ -n "$details" ]; then
                details="${details} + ${band_short}: ${mhz} MHz"
            else
                details="${band_short}: ${mhz} MHz"
            fi
        fi

        # --- Sanitize numeric fields (empty / dash / non-numeric → null) ---
        case "$cc_pci"  in ''|'-'|*[!0-9-]*) cc_pci="null"  ;; esac
        case "$cc_rsrp" in ''|'-'|*[!0-9-]*) cc_rsrp="null" ;; esac
        case "$cc_rsrq" in ''|'-'|*[!0-9-]*) cc_rsrq="null" ;; esac
        case "$cc_rssi" in ''|'-'|*[!0-9-]*) cc_rssi="null" ;; esac
        # cc_sinr may be a float (NR /100 conversion) — validated by awk above
        case "$cc_sinr" in ''|'-') cc_sinr="null" ;; esac

        # --- Track NR PCC for reconciliation ---
        if [ "$cc_type" = "PCC" ] && [ "$tech" = "NR" ]; then
            nr_pcc_seen=1
        fi

        # --- Write carrier data for jq processing ---
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
            "$cc_type" "$tech" "$band_short" "${freq:-null}" "$mhz" \
            "$cc_pci" "$cc_rsrp" "$cc_rsrq" "$cc_rssi" "$cc_sinr" >> "$cc_tmpfile"

    done < "$tmpfile"
    rm -f "$tmpfile"

    t2_total_bandwidth_mhz=$total_mhz
    t2_bandwidth_details="$details"

    if [ -s "$cc_tmpfile" ]; then
        t2_carrier_components=$(jq -Rs '
            split("\n") | map(select(length > 0) | split("\t")) | map({
                type: .[0],
                technology: .[1],
                band: .[2],
                earfcn: (.[3] | if . == "null" then null else tonumber end),
                bandwidth_mhz: (.[4] | tonumber),
                pci: (.[5] | if . == "null" then null else tonumber end),
                rsrp: (.[6] | if . == "null" then null else tonumber end),
                rsrq: (.[7] | if . == "null" then null else tonumber end),
                rssi: (.[8] | if . == "null" then null else tonumber end),
                sinr: (.[9] | if . == "null" then null else tonumber end)
            })
        ' "$cc_tmpfile")
    else
        t2_carrier_components="[]"
    fi
    rm -f "$cc_tmpfile"

    # --- Reconcile network_type from QCAINFO NR PCC ---
    # QENG may transiently report LTE after a CFUN reset while QCAINFO already
    # shows NR5G as the PCC. If we saw an NR PCC and network_type is not already
    # NR, upgrade the state so the frontend renders the correct NR card.
    if [ "$nr_pcc_seen" = "1" ]; then
        case "$network_type" in
            "5G-SA"|"5G-NSA")
                # Already NR — nothing to do
                ;;
            *)
                qlog_warn "parse_ca_info: network_type reconciled ${network_type}→5G-SA based on NR PCC in QCAINFO"
                network_type="5G-SA"
                case "$nr_state" in
                    "unknown"|"inactive") nr_state="connected" ;;
                esac
                case "$lte_state" in
                    "unknown") lte_state="inactive" ;;
                esac
                ;;
        esac
    fi
}

# -----------------------------------------------------------------------------
# Parse AT+QNWCFG="lte_time_advance" and "nr_time_advance" (Tier 2)
# Populates: lte_ta, nr_ta
# -----------------------------------------------------------------------------
parse_time_advance() {
    local raw="$1"

    # LTE TA: +QNWCFG: "lte_time_advance",<enabled>,<ta>
    # The enable reply is +QNWCFG: "lte_time_advance",1 (2 fields); the query
    # reply adds <ta>. We want the reply line with 3+ fields.
    # Anchor on the reply prefix; qcmd's echoed AT+QNWCFG line also names the key.
    local lte_ta_line
    lte_ta_line=$(printf '%s\n' "$raw" | awk -F',' 'index($0,"+QNWCFG:")==1 && index($0,"\"lte_time_advance\"") && NF>=3 {print; exit}')

    if [ -n "$lte_ta_line" ]; then
        local ta_val
        ta_val=$(printf '%s' "$lte_ta_line" | tr -d '"' | tr -d ' ' | tr -d '\r' | awk -F',' '{print $3}')
        case "$ta_val" in
            *[!0-9-]*|'') lte_ta="" ;;
            *) lte_ta="$ta_val" ;;
        esac
    fi

    # NR TA: +QNWCFG: "nr5g_time_advance",<enabled>,<nta>,<extra>
    # Response has 4 fields — TA value is field 3, NOT last field
    local nr_ta_line
    # Anchor on the reply prefix; qcmd's echoed AT+QNWCFG line also names the key.
    nr_ta_line=$(printf '%s\n' "$raw" | awk -F',' 'index($0,"+QNWCFG:")==1 && index($0,"\"nr5g_time_advance\"") && NF>=3 {print; exit}')

    if [ -n "$nr_ta_line" ]; then
        local nta_val
        nta_val=$(printf '%s' "$nr_ta_line" | tr -d '"' | tr -d ' ' | tr -d '\r' | awk -F',' '{print $3}')
        case "$nta_val" in
            *[!0-9-]*|'') nr_ta="" ;;
            *) nr_ta="$nta_val" ;;
        esac
    fi
}

# =============================================================================
# PER-ANTENNA SIGNAL PARSERS (Tier 1.5)
# =============================================================================
# AT+QRSRP, AT+QRSRQ, AT+QSINR each return per-antenna-port values.
# Format: +Q<CMD>: <ant0>,<ant1>,<ant2>,<ant3>,<RAT>
# In EN-DC mode, two lines are returned (one LTE, one NR5G).
# Sentinel value -32768 indicates inactive/unavailable antenna port.

# -----------------------------------------------------------------------------
# Parse AT+QRSRP — Per-antenna RSRP
# Populates: sig_lte_rsrp, sig_nr_rsrp (JSON array strings)
# -----------------------------------------------------------------------------
parse_qrsrp() {
    local raw="$1"
    local lte_line nr_line
    lte_line=$(printf '%s\n' "$raw" | grep '+QRSRP:.*LTE' | head -1)
    nr_line=$(printf '%s\n' "$raw" | grep '+QRSRP:.*NR5G' | head -1)
    sig_lte_rsrp=$(_antenna_line_to_json "$lte_line" "QRSRP")
    sig_nr_rsrp=$(_antenna_line_to_json "$nr_line" "QRSRP")
}

# -----------------------------------------------------------------------------
# Parse AT+QRSRQ — Per-antenna RSRQ
# Populates: sig_lte_rsrq, sig_nr_rsrq (JSON array strings)
# -----------------------------------------------------------------------------
parse_qrsrq() {
    local raw="$1"
    local lte_line nr_line
    lte_line=$(printf '%s\n' "$raw" | grep '+QRSRQ:.*LTE' | head -1)
    nr_line=$(printf '%s\n' "$raw" | grep '+QRSRQ:.*NR5G' | head -1)
    sig_lte_rsrq=$(_antenna_line_to_json "$lte_line" "QRSRQ")
    sig_nr_rsrq=$(_antenna_line_to_json "$nr_line" "QRSRQ")
}

# -----------------------------------------------------------------------------
# Parse AT+QSINR — Per-antenna SINR
# Populates: sig_lte_sinr, sig_nr_sinr (JSON array strings)
# -----------------------------------------------------------------------------
parse_qsinr() {
    local raw="$1"
    local lte_line nr_line
    lte_line=$(printf '%s\n' "$raw" | grep '+QSINR:.*LTE' | head -1)
    nr_line=$(printf '%s\n' "$raw" | grep '+QSINR:.*NR5G' | head -1)
    sig_lte_sinr=$(_antenna_line_to_json "$lte_line" "QSINR")
    sig_nr_sinr=$(_antenna_line_to_json "$nr_line" "QSINR")
}

# =============================================================================
# CELLULAR INFORMATION PARSERS (Tier 2)
# =============================================================================

# Returns 0 when value looks like IPv6 in either colon form or Quectel's
# dotted-decimal 16-octet form.
_is_ipv6_like_addr() {
    local v="$1"
    case "$v" in
        *:*) return 0 ;;
        *[!0-9.]*|"") return 1 ;;
    esac

    [ "$(printf '%s' "$v" | awk -F'.' '{print NF}')" -eq 16 ]
}

# Prefer IPv6 DNS when available (UI compresses dotted-decimal IPv6 nicely).
_pick_preferred_dns() {
    local ipv4="$1" ipv6="$2"
    if _is_ipv6_like_addr "$ipv6"; then
        printf '%s' "$ipv6"
    elif [ -n "$ipv4" ]; then
        printf '%s' "$ipv4"
    else
        printf '%s' "$ipv6"
    fi
}

# Returns the WAN-active PDP CID by inspecting the +QMAP: "WWAN" lines in the
# same compound AT response that carries +CGCONTRDP. Picks the first QMAP line
# whose IP is non-zero. Falls back to "1" if no QMAP block is present or all
# entries are zero — matches the apn.sh CGI fallback behavior.
_cgcontrdp_active_cid() {
    local raw="$1"
    local cid
    cid=$(printf '%s\n' "$raw" | awk -F',' '
        /^\+QMAP: "WWAN"/ {
            ip = $5
            gsub(/"/, "", ip)
            gsub(/[[:space:]]/, "", ip)
            if (ip == "" || ip == "0.0.0.0" || ip == "0:0:0:0:0:0:0:0") next
            cid = $3
            gsub(/[^0-9]/, "", cid)
            if (cid != "") { print cid; exit }
        }
    ')
    [ -z "$cid" ] && cid="1"
    printf '%s' "$cid"
}

# -----------------------------------------------------------------------------
# Parse AT+CGCONTRDP — APN name and DNS servers
# Uses the WAN-active PDP context (identified by +QMAP "WWAN" mux_id).
#
# 3GPP TS 27.007 field positions (fixed, whatever the quoting):
#   +CGCONTRDP: <cid>,<bearer_id>,<apn>,<local_addr[ mask]>,<gw_addr>,
#               <dns_prim>,<dns_sec>,<p_cscf_prim>,<p_cscf_sec>,...
# Parsed by COMMA, never by quote: the gateway is bare on one record and
# quoted on the next, and some firmwares quote nothing at all, so counting
# quoted tokens shifts every later field (a quoted gateway read as DNS, an
# IMS record's P-CSCF addresses read as DNS). No field can contain a comma
# (APNs are DNS labels, 3GPP IPv6 is dotted-decimal). Quotes are stripped per
# field. A dual-stack DNS field may carry an adjacent v4/v6 pair
# ("<v4>" "<v6>"); each token is classified by octet count (4 = IPv4,
# 16 = IPv6, colon-hex as a fallback).
#
# Example (active CID determined from +QMAP "WWAN" mux_id, not by APN string):
#   +CGCONTRDP: 1,5,"SMARTBRO","10.110.61.83",,"10.151.151.44","10.151.151.48"
#   +CGCONTRDP: 2,6,"ims","36.4.216.0...",...
#   +QMAP: "WWAN",1,1,"IPV4","10.110.61.83"  <- mux=1 -> use CGCONTRDP cid=1
#
# Populates: t2_apn, t2_primary_dns, t2_secondary_dns,
#            t2_primary_dns_v4, t2_primary_dns_v6,
#            t2_secondary_dns_v4, t2_secondary_dns_v6
# -----------------------------------------------------------------------------

# _cgcontrdp_dns_split <field>
# Prints "<v4>|<v6>" for the one or two addresses in a DNS field (first of
# each family wins; anything that is not an address is dropped).
_cgcontrdp_dns_split() {
    local tok v4="" v6=""
    for tok in $1; do
        if _is_ipv6_like_addr "$tok"; then
            [ -n "$v6" ] || v6="$tok"
        else
            case "$tok" in
                *[!0-9.]*) ;;
                *.*.*.*) [ -n "$v4" ] || v4="$tok" ;;
            esac
        fi
    done
    printf '%s|%s' "$v4" "$v6"
}

parse_cgcontrdp() {
    local raw="$1"

    t2_apn=""
    t2_primary_dns=""
    t2_secondary_dns=""
    t2_primary_dns_v4=""
    t2_primary_dns_v6=""
    t2_secondary_dns_v4=""
    t2_secondary_dns_v6=""

    # Split CR-glued records onto their own lines first, so a bare-CR join
    # cannot hide (or merge into) the active CID's record.
    local normalized active_cid data_line
    normalized=$(printf '%s' "$raw" | tr '\r' '\n' | sed '/^$/d')

    # Identify the WAN-active PDP CID via +QMAP, then pick the matching CGCONTRDP line.
    active_cid=$(_cgcontrdp_active_cid "$normalized")
    data_line=$(printf '%s\n' "$normalized" | grep "^+CGCONTRDP: *${active_cid}," | head -1)

    if [ -z "$data_line" ]; then
        qlog_debug "parse_cgcontrdp: no CGCONTRDP line found for active CID $active_cid"
        return
    fi

    # "apn|dns_prim|dns_sec": fields 3, 6 and 7, quotes stripped, inner
    # whitespace collapsed to one space.
    local fields dns1 dns2 pair
    fields=$(printf '%s\n' "$data_line" | awk '
        function clean(v) {
            gsub(/"/, "", v)
            gsub(/[ \t]+/, " ", v)
            gsub(/^ | $/, "", v)
            return v
        }
        # DNS fields keep address characters only, so the unquoted word
        # split in _cgcontrdp_dns_split can never glob.
        function addrs(v) {
            v = clean(v)
            gsub(/[^0-9A-Fa-f.: ]/, "", v)
            return v
        }
        {
            line = $0
            sub(/^\+CGCONTRDP:[ \t]*/, "", line)
            n = split(line, f, ",")
            print clean(f[3]) "|" addrs(n >= 6 ? f[6] : "") "|" addrs(n >= 7 ? f[7] : "")
        }')

    t2_apn="${fields%%|*}"
    fields="${fields#*|}"
    dns1="${fields%%|*}"
    dns2="${fields#*|}"

    pair=$(_cgcontrdp_dns_split "$dns1")
    t2_primary_dns_v4="${pair%%|*}"
    t2_primary_dns_v6="${pair#*|}"
    pair=$(_cgcontrdp_dns_split "$dns2")
    t2_secondary_dns_v4="${pair%%|*}"
    t2_secondary_dns_v6="${pair#*|}"

    t2_primary_dns=$(_pick_preferred_dns "$t2_primary_dns_v4" "$t2_primary_dns_v6")
    t2_secondary_dns=$(_pick_preferred_dns "$t2_secondary_dns_v4" "$t2_secondary_dns_v6")
}

# -----------------------------------------------------------------------------
# Parse AT+QMAP="WWAN" — WAN IPv4 and IPv6 addresses
#
# Response format:
#   +QMAP: "WWAN",<connected>,<mux_id>,"IPV4","<ipv4_addr>"
#   +QMAP: "WWAN",<connected>,<mux_id>,"IPV6","<ipv6_addr>"
# Example:
#   +QMAP: "WWAN",1,1,"IPV4","10.110.61.83"
#   +QMAP: "WWAN",0,1,"IPV6","0:0:0:0:0:0:0:0"
#
# IPv6 "0:0:0:0:0:0:0:0" (all zeros) means no IPv6 assigned.
#
# Populates: t2_wan_ipv4, t2_wan_ipv6
# -----------------------------------------------------------------------------
parse_wan_ip() {
    local raw="$1"

    t2_wan_ipv4=""
    t2_wan_ipv6=""

    # IPv4 line
    local ipv4_line
    ipv4_line=$(printf '%s\n' "$raw" | grep '+QMAP:' | grep '"IPV4"' | head -1)

    if [ -n "$ipv4_line" ]; then
        local csv
        csv=$(printf '%s' "$ipv4_line" | sed 's/+QMAP: //g' | tr -d '\r')
        t2_wan_ipv4=$(printf '%s' "$csv" | cut -d',' -f5 | tr -d '"' | tr -d ' ')
    fi

    # IPv6 line
    local ipv6_line
    ipv6_line=$(printf '%s\n' "$raw" | grep '+QMAP:' | grep '"IPV6"' | head -1)

    if [ -n "$ipv6_line" ]; then
        local csv
        csv=$(printf '%s' "$ipv6_line" | sed 's/+QMAP: //g' | tr -d '\r')
        local ipv6_val
        ipv6_val=$(printf '%s' "$csv" | cut -d',' -f5 | tr -d '"' | tr -d ' ')

        # All-zeros means no IPv6 assigned
        case "$ipv6_val" in
            0:0:0:0:0:0:0:0|::|0::0|'') t2_wan_ipv6="" ;;
            *) t2_wan_ipv6="$ipv6_val" ;;
        esac
    fi
}

# =============================================================================
# BAND SUPPORT: AT+QNWPREFCFG="policy_band" (Boot-only)
# =============================================================================
# Parses the modem's hardware-supported band lists.
# Response format:
#   +QNWPREFCFG: "gw_band",1:2:4:5:6:8:19
#   +QNWPREFCFG: "lte_band",1:2:3:4:5:7:8:12:...
#   +QNWPREFCFG: "nsa_nr5g_band",1:2:3:5:7:8:...
#   +QNWPREFCFG: "nr5g_band",1:2:3:5:7:8:...
#   +QNWPREFCFG: "nrdc_nr5g_band",1:2:3:5:7:8:...
#
# Sets: boot_supported_lte_bands, boot_supported_nsa_nr5g_bands,
#        boot_supported_sa_nr5g_bands, boot_supported_nrdc_nr5g_bands
#        (colon-delimited strings)

parse_policy_band() {
    local raw="$1"

    boot_supported_lte_bands=""
    boot_supported_nsa_nr5g_bands=""
    boot_supported_sa_nr5g_bands=""
    boot_supported_nrdc_nr5g_bands=""

    # Extract colon-delimited band list after the key name for each type.
    # Format per line: +QNWPREFCFG: "<key>",<bands>
    local line

    line=$(printf '%s\n' "$raw" | grep '"lte_band"' | head -1)
    if [ -n "$line" ]; then
        boot_supported_lte_bands=$(printf '%s' "$line" | sed 's/.*"lte_band",//' | tr -d '\r ')
    fi

    line=$(printf '%s\n' "$raw" | grep '"nsa_nr5g_band"' | head -1)
    if [ -n "$line" ]; then
        boot_supported_nsa_nr5g_bands=$(printf '%s' "$line" | sed 's/.*"nsa_nr5g_band",//' | tr -d '\r ')
    fi

    # grep -v excludes nsa_ and nrdc_ lines that also contain "nr5g_band"
    line=$(printf '%s\n' "$raw" | grep '"nr5g_band"' | grep -v 'nsa_' | grep -v 'nrdc_' | head -1)
    if [ -n "$line" ]; then
        boot_supported_sa_nr5g_bands=$(printf '%s' "$line" | sed 's/.*"nr5g_band",//' | tr -d '\r ')
    fi

    line=$(printf '%s\n' "$raw" | grep '"nrdc_nr5g_band"' | head -1)
    if [ -n "$line" ]; then
        boot_supported_nrdc_nr5g_bands=$(printf '%s' "$line" | sed 's/.*"nrdc_nr5g_band",//' | tr -d '\r ')
    fi

    qlog_debug "policy_band: LTE=$boot_supported_lte_bands NSA=$boot_supported_nsa_nr5g_bands SA=$boot_supported_sa_nr5g_bands NRDC=$boot_supported_nrdc_nr5g_bands"
}

# =============================================================================
# IP Passthrough (IPPT) — boot-time parsers
# =============================================================================

# AT+QMAP="MPDN_RULE" → boot_ippt_mode ("disabled"|"eth"|"usb"), boot_ippt_mac
parse_ippt_mpdn_rule() {
    local raw="$1"
    local rule0
    local ippt_mode

    boot_ippt_mode="disabled"
    boot_ippt_mac=""

    # Anchor on the reply prefix; a set-form echo (AT+QMAP="MPDN_rule",0,...) also matches the key
    rule0=$(printf '%s\n' "$raw" | awk 'index($0,"+QMAP:")==1 && index($0,"\"MPDN_rule\",0,") {print; exit}')
    [ -z "$rule0" ] && return 0

    # Field 5 = IPPT_mode; +0 avoids BusyBox gsub $N rebuild bug
    ippt_mode=$(printf '%s' "$rule0" | awk -F',' '{print $5+0}')
    case "$ippt_mode" in
        1)
            boot_ippt_mode="eth"
            boot_ippt_mac=$(printf '%s' "$rule0" | awk -F',' 'NF>=7 {gsub(/"/, "", $7); print $7}')
            ;;
        3)
            boot_ippt_mode="usb"
            boot_ippt_mac=$(printf '%s' "$rule0" | awk -F',' 'NF>=7 {gsub(/"/, "", $7); print $7}')
            ;;
    esac

    qlog_debug "ippt_mpdn_rule: mode=$boot_ippt_mode mac=$boot_ippt_mac"
}

# AT+QMAP="IPPT_NAT" → boot_ippt_nat ("0"|"1")
parse_ippt_nat() {
    local raw="$1"
    local nat_val

    boot_ippt_nat="1"

    # Anchor on the +QMAP: reply line; a set-form echo (AT+QMAP="IPPT_NAT",N) also names the key
    nat_val=$(printf '%s\n' "$raw" | awk -F',' 'index($0,"+QMAP:")==1 && index($0,"\"IPPT_NAT\"") {print $2+0; exit}')
    case "$nat_val" in
        0|1) boot_ippt_nat="$nat_val" ;;
    esac

    qlog_debug "ippt_nat: $boot_ippt_nat"
}

# AT+QCFG="usbnet" → boot_ippt_usbnet ("0"|"1"|"2"|"3")
parse_ippt_usbnet() {
    local raw="$1"
    local usb_val

    boot_ippt_usbnet="1"

    # Anchor on the +QCFG: reply line; a set-form echo (AT+QCFG="usbnet",N) also names the key
    usb_val=$(printf '%s\n' "$raw" | awk -F',' 'index($0,"+QCFG:")==1 && index($0,"\"usbnet\"") {print $2+0; exit}')
    case "$usb_val" in
        0|1|2|3) boot_ippt_usbnet="$usb_val" ;;
    esac

    qlog_debug "ippt_usbnet: $boot_ippt_usbnet"
}

# AT+QMAP="DHCPV4DNS" → boot_ippt_dhcpv4dns ("enabled"|"disabled")
parse_ippt_dhcpv4dns() {
    local raw="$1"
    local dns_val

    boot_ippt_dhcpv4dns="disabled"

    # Anchor on the +QMAP: reply line; a set-form echo (AT+QMAP="DHCPV4DNS",...) also names the key
    dns_val=$(printf '%s\n' "$raw" | awk -F'"' 'index($0,"+QMAP:")==1 && index($0,"\"DHCPV4DNS\"") {print $4; exit}')
    case "$dns_val" in
        enable) boot_ippt_dhcpv4dns="enabled" ;;
    esac

    qlog_debug "ippt_dhcpv4dns: $boot_ippt_dhcpv4dns"
}
