#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# sms.sh — CGI Endpoint: SMS Center (GET + POST), storage-aware
# =============================================================================
# GET:  Returns all received SMS messages (merged across ME + SM storage) and
#       combined storage status via qsms.
# POST: Sends, deletes individual (storage-aware), or deletes all SMS messages.
#
# STORAGE ROUTING:
#   The modem routes incoming SMS by CPMS mem3. On the RM551E it defaults to
#   mem3=SM (SIM), so new messages would land in SIM storage. qsms (the SMS
#   client of the qmanager_atd broker) selects each storage per operation and
#   ALWAYS restores AT+CPMS="ME","ME","ME" afterwards, so every GET/POST also
#   re-asserts ME routing. We read BOTH ME and SM, tag each message with its
#   storage, and merge so historical SIM messages stay visible and
#   individually deletable. qmanager_sms_storage sets the same routing at boot.
#
# Transport (/usr/bin/qsms -> qmanager_atd; one JSON line on stdout, rc 0/1):
#   qsms list all                 -> {"success":true,"msg":[{index,storage,...}]}
#   qsms status all               -> {"success":true,"storages":[{storage,used,total}]}
#   qsms send <phone> <msg>       -> {"success":true,"parts":N,"refs":[...]}
#   qsms delete <ME|SM> <i,j,..>  -> {"success":..,"deleted":[..],"failed":[..]}
#   qsms delete <ME|SM> all       -> {"success":..,"deleted":N,"remaining":0}
#   Failure: {"success":false,"error":<code>[,"detail":...]}
#   The broker takes /var/lock/qmanager.lock itself: never wrap qsms in flock
#   on that lock (the broker would wait on us until modem_busy).
#
# POST body: { "action": "send"|"delete"|"delete_all", ... }
#   action=send:       { "action":"send", "phone":"...", "message":"..." }
#   action=delete:     { "action":"delete", "indexes":[...], "storage":"ME"|"SM" }
#   action=delete_all: { "action":"delete_all" }
#
# Endpoint: GET/POST /cgi-bin/quecmanager/cellular/sms.sh
# Install location: /www/cgi-bin/quecmanager/cellular/sms.sh
# =============================================================================

# --- Logging -----------------------------------------------------------------
qlog_init "cgi_sms"
cgi_headers
cgi_handle_options

# --- qsms wrapper ------------------------------------------------------------
# stdout is the JSON envelope (also on failure); stderr is dropped.
_sms_q() {
    /usr/bin/qsms "$@" 2>/dev/null
}

# Echo the envelope's error code ("" when absent / not JSON).
_sms_err_code() {
    printf '%s' "$1" | jq -r 'if .error == null then empty else .error end' 2>/dev/null
}

# Echo a human detail for a failed envelope: detail, else the code, else $2.
_sms_err_detail() {
    _d=$(printf '%s' "$1" | jq -r 'if .detail != null then (.detail | tostring) elif .error != null then (.error | tostring) else empty end' 2>/dev/null)
    [ -n "$_d" ] || _d="$2"
    printf '%s' "$_d"
}

# True when a failure means "another AT user holds the modem". Reported as
# modem_busy, exactly like the old lock timeout.
_sms_is_busy() {
    case "$1" in
        modem_busy|scan_in_progress) return 0 ;;
    esac
    return 1
}

_sms_busy_reply() {
    jq -n '{"success":false,"error":"modem_busy","detail":"Could not acquire AT lock"}'
}

# =============================================================================
# GET — Fetch inbox messages + storage status
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching SMS inbox and status (ME + SM)"

    # 1. Read ME + SM in one broker operation. Each message already carries
    #    its storage. An unusable SIM store is reported in .storage_errors and
    #    does not hide ME.
    list_json=$(_sms_q list all)
    list_rc=$?
    if [ "$list_rc" -ne 0 ]; then
        code=$(_sms_err_code "$list_json")
        if _sms_is_busy "$code"; then
            qlog_error "SMS list: modem busy ($code)"
            _sms_busy_reply
            exit 0
        fi
        detail=$(_sms_err_detail "$list_json" "qsms list failed (rc=$list_rc)")
        qlog_error "SMS list failed: $detail"
        jq -n --arg error "${code:-command_failed}" --arg detail "$detail" \
            '{"success":false,"error":$error,"detail":$detail}'
        exit 0
    fi
    list_errs=$(printf '%s' "$list_json" | jq -c 'if .storage_errors == null then empty else .storage_errors end' 2>/dev/null)
    [ -n "$list_errs" ] && qlog_warn "SMS list storage errors: $list_errs"

    raw_msgs=$(printf '%s' "$list_json" | jq -c 'if .msg == null then [] else .msg end' 2>/dev/null)
    [ -z "$raw_msgs" ] && raw_msgs="[]"
    printf '%s' "$raw_msgs" | jq empty 2>/dev/null || raw_msgs="[]"

    # 2. Merge multi-part messages into single entries, storage-aware.
    #    - Group key is sender + reference + storage + total so ME index 0 and
    #      SM index 0 never collide into one merged message.
    #    - The concat reference is 8 bits, so a sender reuses it: within a
    #      group, parts are walked oldest-first and a repeated part number
    #      starts a new message (live case: ref 185 seven weeks apart).
    #    - Each output object carries its storage so delete can target the
    #      right memory (ME vs SM).
    #    - Singles (no "reference") pass through, also carrying storage.
    #    Ordered newest-first by timestamp (indexes are per-storage, so a raw
    #    index sort would interleave the two pools incorrectly).
    #    qsms emits "MM/DD/YY HH:MM:SS" (zero-padded, fixed width). A plain
    #    string sort of that key mis-orders across month/year boundaries
    #    (12/31/25 would sort AFTER 01/01/26). Reorder the fixed-width slices
    #    into a sortable "YYMMDD HH:MM:SS" key before sorting, then reverse for
    #    newest-first. Slice offsets: MM=[0:2] DD=[3:5] YY=[6:8] rest=[8:].
    messages=$(printf '%s' "$raw_msgs" | jq '
        [.[] | select(has("reference") | not) |
            {indexes: [.index], sender, content, timestamp, storage}
        ] as $singles |
        ([.[] | select(has("reference"))] |
            group_by(.sender + "|" + (.reference | tostring) + "|" + .storage + "|" + ((.total // 0) | tostring)) |
            [.[]
             | sort_by((.timestamp[6:8] + .timestamp[0:2] + .timestamp[3:5] + .timestamp[8:]), .index)
             | reduce .[] as $p ([];
                 if length > 0 and ((.[-1] | any(.[]; .part == $p.part)) | not)
                 then .[:-1] + [.[-1] + [$p]]
                 else . + [[$p]] end)
             | .[] | sort_by(.part) | {
                indexes: [.[].index],
                sender: .[0].sender,
                content: ([.[].content] | join("")),
                timestamp: .[0].timestamp,
                storage: .[0].storage
            }]
        ) as $merged |
        ($singles + $merged)
        | sort_by(.timestamp[6:8] + .timestamp[0:2] + .timestamp[3:5] + .timestamp[8:])
        | reverse
    ' 2>/dev/null)
    [ -z "$messages" ] && messages="[]"
    printf '%s' "$messages" | jq empty 2>/dev/null || messages="[]"

    # 3. Combined storage status: sum used and total across ME + SM. If the
    #    combined query fails (e.g. no usable SIM store), fall back to ME
    #    alone so the inbox still renders (SM counts as 0/0, as before).
    if status_json=$(_sms_q status all); then
        storage_used=$(printf '%s' "$status_json" | jq '[.storages[]?.used // 0] | add // 0' 2>/dev/null)
        storage_total=$(printf '%s' "$status_json" | jq '[.storages[]?.total // 0] | add // 0' 2>/dev/null)
    else
        status_json=$(_sms_q status ME)
        storage_used=$(printf '%s' "$status_json" | jq '.used // 0' 2>/dev/null)
        storage_total=$(printf '%s' "$status_json" | jq '.total // 0' 2>/dev/null)
    fi
    case "$storage_used" in ''|*[!0-9]*) storage_used=0 ;; esac
    case "$storage_total" in ''|*[!0-9]*) storage_total=0 ;; esac

    # 4. Build JSON response.
    jq -n \
        --argjson messages "$messages" \
        --argjson used "$storage_used" \
        --argjson total "$storage_total" \
        '{
            success: true,
            messages: $messages,
            storage: {
                used: $used,
                total: $total
            }
        }'
    exit 0
fi

# =============================================================================
# POST — Send / Delete / Delete All
# =============================================================================
if [ "$REQUEST_METHOD" = "POST" ]; then
    cgi_read_post

    ACTION=$(printf '%s' "$POST_DATA" | jq -r 'if .action == null then empty else .action end')

    if [ -z "$ACTION" ]; then
        cgi_error "missing_action" "action field is required"
        exit 0
    fi

    # --- action: send --------------------------------------------------------
    if [ "$ACTION" = "send" ]; then
        RAW_PHONE=$(printf '%s' "$POST_DATA" | jq -r 'if .phone == null then empty else .phone end')
        MESSAGE=$(printf '%s' "$POST_DATA" | jq -r 'if .message == null then empty else .message end')

        if [ -z "$RAW_PHONE" ]; then
            cgi_error "missing_phone" "phone number is required"
            exit 0
        fi
        if [ -z "$MESSAGE" ]; then
            cgi_error "missing_message" "message text is required"
            exit 0
        fi

        # Only normalization: strip a leading + if present. The user is
        # responsible for providing the full international number — we do not
        # rewrite local-format numbers.
        PHONE=$(printf '%s' "$RAW_PHONE" | sed 's/^+//')

        qlog_info "Sending SMS to $PHONE (raw: $RAW_PHONE)"
        result=$(_sms_q send "$PHONE" "$MESSAGE")
        rc=$?

        if [ $rc -ne 0 ]; then
            code=$(_sms_err_code "$result")
            if _sms_is_busy "$code"; then
                qlog_error "SMS send: modem busy ($code)"
                _sms_busy_reply
                exit 0
            fi
            detail=$(_sms_err_detail "$result" "qsms send failed (rc=$rc)")
            qlog_error "SMS send failed (${code:-rc=$rc}): $detail"
            jq -n --arg detail "$detail" \
                '{"success":false,"error":"send_failed","detail":$detail}'
            exit 0
        fi

        qlog_info "SMS sent successfully to $PHONE"
        cgi_success
        exit 0
    fi

    # --- action: delete ------------------------------------------------------
    # Accepts "indexes": [n, ...] — deletes all storage slots for a (possibly
    # merged multi-part) message, in one qsms call.
    if [ "$ACTION" = "delete" ]; then
        INDEXES_JSON=$(printf '%s' "$POST_DATA" | jq -c 'if .indexes == null then empty else .indexes end' 2>/dev/null)

        if [ -z "$INDEXES_JSON" ] || [ "$INDEXES_JSON" = "null" ]; then
            cgi_error "missing_indexes" "indexes array is required"
            exit 0
        fi

        # Storage target: which memory the indexes live in. Defaults to ME and
        # is constrained to exactly ME or SM so it can never inject other args
        # into the qsms call.
        STORAGE=$(printf '%s' "$POST_DATA" | jq -r 'if .storage == null then "ME" else .storage end' 2>/dev/null)
        case "$STORAGE" in
            ME|SM) : ;;
            *) STORAGE="ME" ;;
        esac

        qlog_info "Deleting SMS indexes from $STORAGE: $INDEXES_JSON"
        # Only plain non-negative integers reach qsms; anything else counts as
        # one failed delete.
        fail_count=0
        idx_list=""
        idx_count=0
        # No globbing while splitting the jq output (an index of "*" must
        # stay a literal invalid index, not expand to file names).
        set -f
        for idx in $(printf '%s' "$INDEXES_JSON" | jq -r '.[]?' 2>/dev/null); do
            case "$idx" in
                *[!0-9]*)
                    qlog_warn "Skipping invalid SMS index: $idx"
                    fail_count=$((fail_count + 1))
                    ;;
                *)
                    idx_list="${idx_list:+$idx_list,}$idx"
                    idx_count=$((idx_count + 1))
                    ;;
            esac
        done
        set +f

        if [ -n "$idx_list" ]; then
            result=$(_sms_q delete "$STORAGE" "$idx_list")
            rc=$?
            if [ $rc -ne 0 ]; then
                code=$(_sms_err_code "$result")
                if _sms_is_busy "$code"; then
                    qlog_error "SMS delete: modem busy ($code)"
                    _sms_busy_reply
                    exit 0
                fi
                # Per-index failures are listed in .failed; anything else
                # (transport error) means every requested index failed.
                failed=$(printf '%s' "$result" | jq -r 'if (.failed | type) == "array" then (.failed | length) else empty end' 2>/dev/null)
                case "$failed" in
                    ''|*[!0-9]*) failed=$idx_count ;;
                esac
                qlog_warn "SMS delete from $STORAGE: $failed index(es) failed: $(_sms_err_detail "$result" "rc=$rc")"
                fail_count=$((fail_count + failed))
            fi
        fi

        if [ "$fail_count" -gt 0 ]; then
            qlog_warn "SMS delete completed with $fail_count failure(s)"
            cgi_error "partial_failure" "$fail_count message(s) failed to delete"
            exit 0
        fi

        qlog_info "SMS delete complete"
        cgi_success
        exit 0
    fi

    # --- action: delete_all --------------------------------------------------
    # qsms clears every index the store reports (not just 0..49).
    if [ "$ACTION" = "delete_all" ]; then
        qlog_info "Deleting all SMS messages (ME + SM)"

        me_result=$(_sms_q delete ME all)
        me_rc=$?
        sm_result=$(_sms_q delete SM all)
        sm_rc=$?

        if [ $me_rc -ne 0 ] || [ $sm_rc -ne 0 ]; then
            me_detail="ok"
            sm_detail="ok"
            [ $me_rc -ne 0 ] && me_detail=$(_sms_err_detail "$me_result" "rc=$me_rc")
            [ $sm_rc -ne 0 ] && sm_detail=$(_sms_err_detail "$sm_result" "rc=$sm_rc")
            qlog_error "SMS delete all failed (me_rc=$me_rc sm_rc=$sm_rc): ME='$me_detail' SM='$sm_detail'"
            jq -n \
                --arg me_detail "$me_detail" \
                --arg sm_detail "$sm_detail" \
                '{"success":false,"error":"delete_all_failed","detail":("ME: " + $me_detail + " | SM: " + $sm_detail)}'
            exit 0
        fi

        qlog_info "All SMS messages deleted (ME + SM)"
        cgi_success
        exit 0
    fi

    # --- Unknown action ------------------------------------------------------
    cgi_error "invalid_action" "action must be send, delete, or delete_all"
    exit 0
fi

# --- Method not allowed ------------------------------------------------------
cgi_method_not_allowed
