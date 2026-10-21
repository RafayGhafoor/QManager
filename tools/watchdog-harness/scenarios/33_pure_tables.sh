# Items 6/7: truth tables of the two pure decision functions, printed in the
# extra block of pass 1 (no daemon behaviour involved).
#   wd_decide_start <tiers_any> <cfun> <holdoff_left>   -> none|holdoff|radio_off|go
#   wd_cooldown_verdict <reason> <ping_ok> <reachable> <q_state> <stale_retries>
#                                                       -> success|extend|fail
SC_PASSES=1
sc_snap_extra() {
    echo "== wd_decide_start: any cfun holdoff_left -> verdict"
    for _t_any in 0 1; do
        for _t_cf in "" 0 1 4 7; do
            for _t_hl in 0 30 abc; do
                echo "any=$_t_any cfun='$_t_cf' hold=$_t_hl -> $(wd_decide_start "$_t_any" "$_t_cf" "$_t_hl")"
            done
        done
    done
    echo "== wd_cooldown_verdict: reason ping_ok reachable q_state retries -> verdict"
    for _t_r in quality unreachable; do
        for _t_p in 0 1; do
            for _t_re in true false null; do
                for _t_q in 0 1 2; do
                    for _t_n in 0 2 3; do
                        echo "$_t_r ok=$_t_p reach=$_t_re q=$_t_q retries=$_t_n -> $(wd_cooldown_verdict "$_t_r" "$_t_p" "$_t_re" "$_t_q" "$_t_n")"
                    done
                done
            done
        done
    done
}
