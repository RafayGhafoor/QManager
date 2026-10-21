# Item 1, insane clock (1970 boot): the hour cannot be evaluated, so every
# tier4_escalation row older than 2025-01-01 counts (2 here) and the recent row
# does not. The clock turns sane at pass 4; the next recount (pass 7, t+90)
# applies the rolling hour and the count drops to 1.
SC_PASSES=8
sc_setup() {
    QM_TEST_YEAR=1970
    crash_log_epoch 400 tier4_escalation
    crash_log_epoch 500 tier4_escalation
    crash_log_add 100 tier4_escalation
    crash_log_epoch 600 user
}
sc_pass_4() { QM_TEST_YEAR=2026; }
