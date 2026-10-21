# Item 3: TERM while the daemon sits in the (real, interruptible) boot settle,
# with the radio marked down as if it had been killed between CFUN=0 and CFUN=1.
# Expected: exit code 143 within ~1 s (not after 30 s), the exit cleanup sends
# AT+CFUN=1, the PID file and state file are gone, and no orphan sleep is left.
SC_PASSES=1
SC_REAL_SLEEP=1
sc_post_source() {
    unset -f sleep
    wd_radio_down=1
    (
        sleep 1
        kill -TERM "$H_MAINPID"
        sleep 1
        echo "orphan sleeps: $(ps | grep -c '[s]leep 30')" > "$H_OUT/orphans.txt"
    ) > /dev/null 2>&1 &
}
