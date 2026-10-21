# Item 2: wd_ledger_recent_json. Mixed reasons -> only tier4_escalation rows,
# epochs newest first (sorted, not file order), capped at the limit, junk
# epochs dropped. The no-globals line runs with CRASH_LOG unset (the CGI case:
# the default device path, which the harness rewrites into the fake root).
# Pass 3 removes the file -> []; pass 4 leaves an empty file -> [].
SC_PASSES=4
sc_setup() {
    crash_log_epoch 1790000500 tier4_escalation
    crash_log_epoch 1789999000 user
    crash_log_epoch 1790001500 tier4_escalation
    crash_log_epoch 1789998000 unplanned
    crash_log_epoch 400 tier4_escalation
    crash_log_epoch abc tier4_escalation
    crash_log_epoch 1790001000 tier4_escalation
    crash_log_epoch 1789990000 tier4_escalation
    crash_log_epoch 1789995000 tier4_escalation
    crash_log_epoch 1789996000 tier4_escalation
    printf '1790002000|notareboot|tier4_escalation\n' >> "$H_ROOT/etc/qmanager/crash.log"
    printf 'garbage line\n' >> "$H_ROOT/etc/qmanager/crash.log"
}
sc_pass_3() { rm -f "$H_ROOT/etc/qmanager/crash.log"; }
sc_pass_4() { : > "$H_ROOT/etc/qmanager/crash.log"; }
sc_snap_extra() {
    echo "limit5: $(wd_ledger_recent_json 5)"
    echo "limit2: $(wd_ledger_recent_json 2)"
    echo "limit0: $(wd_ledger_recent_json 0)"
    echo "limit-bad: $(wd_ledger_recent_json abc)"
    echo "no-globals: $( unset CRASH_LOG; wd_ledger_recent_json 3 )"
}
