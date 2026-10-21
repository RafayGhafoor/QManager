# Item 3: TERM during the end-of-pass wait of the main loop (real sleep, boot
# settle zeroed). The state file exists before the TERM (copied to
# state_before_term.json) and is gone after it; the radio was never marked down,
# so the cleanup sends no AT command. Exit code 143, no orphan sleep.
SC_PASSES=1
SC_REAL_SLEEP=1
sc_post_source() {
    unset -f sleep
    BOOT_SETTLE=0
    (
        sleep 2
        cp "$H_ROOT/tmp/qmanager_watchcat.json" "$H_OUT/state_before_term.json"
        kill -TERM "$H_MAINPID"
        sleep 1
        echo "orphan sleeps: $(ps | grep -c '[s]leep 10')" > "$H_OUT/orphans.txt"
    ) > /dev/null 2>&1 &
}
