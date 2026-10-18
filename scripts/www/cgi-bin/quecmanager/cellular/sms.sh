#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# sms.sh — CGI Endpoint: SMS Center (GET + POST), storage-aware
# =============================================================================
# GET:  Returns all received SMS messages (merged across ME + SM storage) and
#       combined storage status via sms_tool.
# POST: Sends, deletes individual (storage-aware), or deletes all SMS messages.
#
# STORAGE ROUTING (the load-bearing fix):
#   The modem routes incoming SMS by CPMS mem3. On the RM551E it defaults to
#   mem3=SM (SIM), so new messages land in SIM storage while sms_tool reads
#   ME (modem) by default — the inbox shows empty while real messages sit on
#   the SIM. We:
#     1. Self-heal routing on every GET via AT+CPMS="ME","ME","ME" so mem3=ME
#        (255 slots) catches future incoming.
#     2. Read BOTH ME and SM, tag each message with its storage, and merge so
#        the historical SIM messages surface and stay individually deletable.
#     3. A boot-time daemon (qmanager_sms_storage) re-asserts the same routing
#        even if the SMS page is never opened.
#   NOTE: the `-s <storage>` read flips mem1; we re-assert ME at the end of GET
#   so a bare `sms_tool recv` elsewhere keeps reading ME.
#
# External tool (bundled; hard-wired to /dev/smd11):
#   sms_tool -d /dev/smd11 [-s ME|SM] recv -j   -> JSON: {"msg":[...]}
#   sms_tool -d /dev/smd11 send <phone> <msg>   -> Send an SMS
#   sms_tool -d /dev/smd11 [-s ME|SM] delete <index> -> Delete one message
#   sms_tool -d /dev/smd11 delete all           -> Delete all (ME) messages
#   sms_tool -d /dev/smd11 [-s ME|SM] status    -> Storage status (plain text)
#   sms_tool -d /dev/smd11 at '<AT command>'    -> Raw AT passthrough
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

# --- Shared AT lock ----------------------------------------------------------
# Shared with qcmd/atcli_smd11 so sms_tool calls serialize against every other
# process touching /dev/smd11. Without this, an inbox fetch can collide with a
# concurrent atcli_smd11 call from the poller/watchcat and either block on the
# char device or return interleaved data.
_SMS_LOCK_FILE="/var/lock/qmanager.lock"
_SMS_LOCK_WAIT=10

# AT device resolved via platform.sh (smd11 on barebone images, mhi_DUN on
# PCIe/MHI-attached ODUs). Guarded: BusyBox ash exits when `.` cannot find it.
if [ -f /usr/lib/qmanager/platform.sh ]; then
    . /usr/lib/qmanager/platform.sh
fi
if ! command -v qm_at_device >/dev/null 2>&1; then
    qm_at_device() { printf '%s' /dev/smd11; }
fi
_SMS_AT_DEVICE="$(qm_at_device)"

# BusyBox-compatible flock with timeout (polling loop).
# Usage: _sms_flock_wait <fd> <timeout_seconds>
_sms_flock_wait() {
    _fd="$1"
    _wait="$2"
    _elapsed=0
    while [ "$_elapsed" -lt "$_wait" ]; do
        if flock -x -n "$_fd" 2>/dev/null; then
            return 0
        fi
        sleep 1
        _elapsed=$((_elapsed + 1))
    done
    flock -x -n "$_fd" 2>/dev/null
}

# --- sms_tool wrapper --------------------------------------------------------
# Always talks to /dev/smd11. Wrapped in the shared /var/lock/qmanager.lock so
# every call serializes against qcmd/atcli_smd11.
#
# sms_tool writes harmless tcgetattr/tcsetattr diagnostics to stderr because
# /dev/smd11 is a char device, not a real TTY. We MUST NOT merge stderr into
# stdout with 2>&1, because when the JSON payload is larger than the stdout
# block buffer (~4 KB), partial flushes interleave the cleanup error line
# INTO the middle of the JSON stream. Line-based filtering then sees the
# JSON bytes glued onto `...Inappropriate ioctl for device` and drops the
# whole chunk (see sms_alerts.sh for the same fix).
#
# Instead: capture stderr to a temp file and stdout into a variable. On
# success return pure stdout (JSON is intact). On failure return stderr
# with the known noise lines stripped so the UI sees a meaningful message.
_sms_run() {
    [ -e "$_SMS_LOCK_FILE" ] || : > "$_SMS_LOCK_FILE" 2>/dev/null
    _sms_err="/tmp/qmanager_sms_err.$$"

    (
        _sms_flock_wait 9 "$_SMS_LOCK_WAIT" || exit 2
        _sms_out=$(sms_tool -d "$_SMS_AT_DEVICE" "$@" 2>"$_sms_err")
        _sms_rc=$?

        if [ "$_sms_rc" -eq 0 ]; then
            printf '%s' "$_sms_out"
        else
            _sms_err_clean=$(grep -v -e '^tcgetattr(' -e '^tcsetattr(' -e 'Inappropriate ioctl for device$' < "$_sms_err" 2>/dev/null)
            if [ -n "$_sms_err_clean" ]; then
                printf '%s' "$_sms_err_clean"
            else
                printf '%s' "$_sms_out"
            fi
        fi

        rm -f "$_sms_err"
        exit "$_sms_rc"
    ) 9<"$_SMS_LOCK_FILE"
}

# =============================================================================
# GET — Fetch inbox messages + storage status
# =============================================================================
if [ "$REQUEST_METHOD" = "GET" ]; then
    qlog_info "Fetching SMS inbox and status (ME + SM)"

    # 0. Self-heal incoming routing: force CPMS mem1/mem2/mem3 = ME so future
    #    incoming SMS land in modem (ME) storage instead of the SIM (SM).
    #    Single-quote the AT string so the inner double quotes reach sms_tool.
    #    Output is ignored on purpose — this is best-effort routing.
    _sms_run at 'AT+CPMS="ME","ME","ME"' >/dev/null 2>&1

    # Helper-free inline read: pull {"msg":[...]} for one storage and tag each
    # message with its storage. Falls back to [] on any parse failure.
    # 1a. Read ME storage.
    me_json=$(_sms_run -s ME recv -j)
    if [ -n "$me_json" ]; then
        me_msgs=$(printf '%s' "$me_json" | jq 'if .msg == null then [] else .msg end' 2>/dev/null)
        [ -z "$me_msgs" ] && me_msgs="[]"
    else
        me_msgs="[]"
    fi
    printf '%s' "$me_msgs" | jq empty 2>/dev/null || me_msgs="[]"
    me_msgs=$(printf '%s' "$me_msgs" | jq 'map(. + {storage:"ME"})' 2>/dev/null)
    [ -z "$me_msgs" ] && me_msgs="[]"

    # 1b. Read SM (SIM) storage — this is where the historical messages sit.
    sm_json=$(_sms_run -s SM recv -j)
    if [ -n "$sm_json" ]; then
        sm_msgs=$(printf '%s' "$sm_json" | jq 'if .msg == null then [] else .msg end' 2>/dev/null)
        [ -z "$sm_msgs" ] && sm_msgs="[]"
    else
        sm_msgs="[]"
    fi
    printf '%s' "$sm_msgs" | jq empty 2>/dev/null || sm_msgs="[]"
    sm_msgs=$(printf '%s' "$sm_msgs" | jq 'map(. + {storage:"SM"})' 2>/dev/null)
    [ -z "$sm_msgs" ] && sm_msgs="[]"

    # 1c. Concatenate the two tagged arrays into one raw pool.
    raw_msgs=$(printf '%s\n%s' "$me_msgs" "$sm_msgs" | jq -s 'add' 2>/dev/null)
    [ -z "$raw_msgs" ] && raw_msgs="[]"
    printf '%s' "$raw_msgs" | jq empty 2>/dev/null || raw_msgs="[]"

    # 2. Merge multi-part messages into single entries, storage-aware.
    #    - Group key is sender + reference + storage so ME index 0 and SM
    #      index 0 never collide into one merged message.
    #    - Each output object carries its storage so delete can target the
    #      right memory (ME vs SM).
    #    - Singles (no "reference") pass through, also carrying storage.
    #    Ordered newest-first by timestamp (indexes are now per-storage, so a
    #    raw index sort would interleave the two pools incorrectly).
    #    sms_tool emits "MM/DD/YY HH:MM:SS" (zero-padded, fixed width). A plain
    #    string sort of that key mis-orders across month/year boundaries
    #    (12/31/25 would sort AFTER 01/01/26). Reorder the fixed-width slices
    #    into a sortable "YYMMDD HH:MM:SS" key before sorting, then reverse for
    #    newest-first. Slice offsets: MM=[0:2] DD=[3:5] YY=[6:8] rest=[8:].
    messages=$(printf '%s' "$raw_msgs" | jq '
        [.[] | select(has("reference") | not) |
            {indexes: [.index], sender, content, timestamp, storage}
        ] as $singles |
        ([.[] | select(has("reference"))] |
            group_by(.sender + "|" + (.reference | tostring) + "|" + .storage) |
            [.[] | sort_by(.part) | {
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

    # 3. Combined storage status: sum used and total across ME + SM.
    # sms_tool status prints "Storage type: ME, used: 0, total: 255" (word
    # format, NOT N/M). Match the "used:"/"total:" tokens directly.
    me_status_raw=$(_sms_run -s ME status)
    me_used=$(printf '%s' "$me_status_raw" | grep -o 'used: [0-9]*' | grep -o '[0-9]*')
    me_total=$(printf '%s' "$me_status_raw" | grep -o 'total: [0-9]*' | grep -o '[0-9]*')
    [ -z "$me_used" ] && me_used=0
    [ -z "$me_total" ] && me_total=0

    sm_status_raw=$(_sms_run -s SM status)
    sm_used=$(printf '%s' "$sm_status_raw" | grep -o 'used: [0-9]*' | grep -o '[0-9]*')
    sm_total=$(printf '%s' "$sm_status_raw" | grep -o 'total: [0-9]*' | grep -o '[0-9]*')
    [ -z "$sm_used" ] && sm_used=0
    [ -z "$sm_total" ] && sm_total=0

    storage_used=$((me_used + sm_used))
    storage_total=$((me_total + sm_total))

    # 4. Re-assert ME routing: the `-s SM` read above flipped mem1 to SM, so a
    #    bare `sms_tool recv` (e.g. from sms_alerts) would otherwise read SM.
    _sms_run at 'AT+CPMS="ME","ME","ME"' >/dev/null 2>&1

    # 5. Build JSON response.
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
        result=$(_sms_run send "$PHONE" "$MESSAGE")
        rc=$?

        if [ $rc -ne 0 ]; then
            qlog_error "sms_tool send failed (rc=$rc): $result"
            jq -n --arg detail "$result" \
                '{"success":false,"error":"send_failed","detail":$detail}'
            exit 0
        fi

        qlog_info "SMS sent successfully to $PHONE"
        cgi_success
        exit 0
    fi

    # --- action: delete ------------------------------------------------------
    # Accepts "indexes": [n, ...] — deletes all storage slots for a (possibly
    # merged multi-part) message.
    if [ "$ACTION" = "delete" ]; then
        INDEXES_JSON=$(printf '%s' "$POST_DATA" | jq -c 'if .indexes == null then empty else .indexes end' 2>/dev/null)

        if [ -z "$INDEXES_JSON" ] || [ "$INDEXES_JSON" = "null" ]; then
            cgi_error "missing_indexes" "indexes array is required"
            exit 0
        fi

        # Storage target: which memory the indexes live in. Defaults to ME and
        # is constrained to exactly ME or SM so it can never inject other args
        # into the sms_tool call.
        STORAGE=$(printf '%s' "$POST_DATA" | jq -r 'if .storage == null then "ME" else .storage end' 2>/dev/null)
        case "$STORAGE" in
            ME|SM) : ;;
            *) STORAGE="ME" ;;
        esac

        qlog_info "Deleting SMS indexes from $STORAGE: $INDEXES_JSON"
        fail_count=0
        idx_tmp="/tmp/qmanager_sms_idx.tmp"
        printf '%s' "$INDEXES_JSON" | jq -r '.[]' > "$idx_tmp"
        while read -r idx; do
            result=$(_sms_run -s "$STORAGE" delete "$idx")
            rc=$?
            if [ $rc -ne 0 ]; then
                qlog_warn "Failed to delete index $idx from $STORAGE: $result"
                fail_count=$((fail_count + 1))
            fi
        done < "$idx_tmp"
        rm -f "$idx_tmp"

        # A `-s SM` delete leaves modem mem1=SM; re-assert ME so a bare `recv`
        # elsewhere (e.g. sms_alerts) keeps reading modem storage.
        if [ "$STORAGE" = "SM" ]; then
            _sms_run at 'AT+CPMS="ME","ME","ME"' >/dev/null 2>&1
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
    if [ "$ACTION" = "delete_all" ]; then
        qlog_info "Deleting all SMS messages (ME + SM)"

        me_result=$(_sms_run delete all)
        me_rc=$?
        sm_result=$(_sms_run -s SM delete all)
        sm_rc=$?

        if [ $me_rc -ne 0 ] || [ $sm_rc -ne 0 ]; then
            qlog_error "sms_tool delete all failed (me_rc=$me_rc sm_rc=$sm_rc): ME='$me_result' SM='$sm_result'"
            jq -n \
                --arg me_detail "$me_result" \
                --arg sm_detail "$sm_result" \
                '{"success":false,"error":"delete_all_failed","detail":("ME: " + $me_detail + " | SM: " + $sm_detail)}'
            exit 0
        fi

        # Re-assert ME routing: the `-s SM` call flipped mem1 to SM.
        _sms_run at 'AT+CPMS="ME","ME","ME"' >/dev/null 2>&1

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
