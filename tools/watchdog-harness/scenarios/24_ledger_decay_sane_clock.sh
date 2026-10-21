# Item 1, sane clock: only tier4_escalation rows inside the rolling hour count.
# Rows: now-100 and now-3560 count (2); now-3700, a 1970-era row, a user row and
# a non-numeric epoch do not. The now-3560 row ages out at t+40; the recount runs
# every 60 s, so reboots_this_hour goes 2 -> 1 on the pass at t+90 (pass 7).
SC_PASSES=8
sc_setup() {
    crash_log_add 100 tier4_escalation
    crash_log_add 3560 tier4_escalation
    crash_log_add 3700 tier4_escalation
    crash_log_epoch 400 tier4_escalation
    crash_log_add 50 user
    crash_log_epoch abc tier4_escalation
}
