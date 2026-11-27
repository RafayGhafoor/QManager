#!/bin/sh
# gen.sh - deterministic synthetic archive rows for the history-agg tests.
#
#   gen.sh v2   <day_start_epoch> <rows> [seed] [l1=1|0]   cell archive v2 rows
#   gen.sh v1   <day_start_epoch> <rows> [seed]            cell archive v1 rows
#   gen.sh ping <day_start_epoch> <rows> [seed]            ping archive rows
#
# One row per minute from day_start. Built-in "weather": a PCI handover late in
# each 8 h block, a 30-minute 5G dropout every 6 h, a 5-minute recorder gap every
# ~8 h, one NOSVC row per ~12 h (v2), a saturated-throughput episode every 90
# min (v2 with L1). Pure POSIX awk; the generator itself must run on macOS awk
# and BusyBox awk alike.
kind="$1"; day="$2"; rows="$3"; seed="${4:-7}"; l1="${5:-1}"
[ -n "$kind" ] && [ -n "$day" ] && [ -n "$rows" ] || { echo "usage: gen.sh v2|v1|ping day_start rows [seed] [l1]" >&2; exit 2; }

awk -v kind="$kind" -v day="$day" -v rows="$rows" -v seed="$seed" -v l1="$l1" '
function rnd() { S = (S * 16807) % 2147483647; return S / 2147483647 }
function ri(lo, hi) { return lo + int(rnd() * (hi - lo + 1)) }
function f1(x) { return sprintf("%.1f", x) }
function sine(i, per, amp) { return amp * sin(6.2831853 * i / per) }
function nn(v) { return (v == "") ? "null" : v }
BEGIN {
    S = seed + 0; if (S <= 0) S = 7
    for (i = 0; i < rows; i++) {
        m = i % 480
        if ((i % 500) >= 300 && (i % 500) <= 304) continue
        ts = day + i * 60 + ri(0, 4)
        dropout = ((i % 360) >= 200 && (i % 360) <= 229)
        cellb = (m >= 400)
        nosvc = (kind == "v2" && (i % 700) == 650)
        if (kind == "ping") {
            n = 6; ok = n
            if ((i % 97) == 5) ok = 5
            if ((i % 311) >= 100 && (i % 311) <= 102) ok = 0
            if (ok == 0) printf "[%d,%d,0,null,null,null,null,100]\n", ts, n
            else {
                avg = 55 + sine(i, 180, 15) + rnd() * 10
                printf "[%d,%d,%d,%s,%s,%s,%s,%.0f]\n", ts, n, ok, f1(avg), f1(avg - 12), f1(avg + 25 + rnd() * 30), f1(3 + rnd() * 9), 100 * (n - ok) / n
            }
            continue
        }
        rsrp = int(-85 + sine(i, 240, 8) + ri(-2, 2))
        rsrq = -11 + ri(-2, 2); sinr = int(8 + sine(i, 150, 7) + ri(-2, 2))
        if (kind == "v1") {
            if (nosvc) continue
            if (dropout) {
                printf "{\"ts\":%d,\"rat\":\"LTE\",\"lte_pci\":%d,\"lte_band\":\"%s\",\"lte_earfcn\":%d,\"lte_bw\":%d,\"lte_cell_id\":%d,\"lte_tac\":55383,\"nr_pci\":null,\"nr_band\":null,\"nr_arfcn\":null,\"nr_cell_id\":null,\"nr_tac\":null,\"nr_avail\":0,\"rsrp\":%d,\"rsrq\":%d,\"sinr\":%d}\n", ts, (cellb ? 77 : 104), (cellb ? "B3" : "B1"), (cellb ? 1650 : 250), (cellb ? 20 : 10), (cellb ? 48466201 : 48466199), rsrp, rsrq, sinr
            } else {
                printf "{\"ts\":%d,\"rat\":\"5G-NSA\",\"lte_pci\":%d,\"lte_band\":\"%s\",\"lte_earfcn\":%d,\"lte_bw\":%d,\"lte_cell_id\":%d,\"lte_tac\":55383,\"nr_pci\":47,\"nr_band\":\"N41\",\"nr_arfcn\":509070,\"nr_cell_id\":null,\"nr_tac\":null,\"nr_avail\":1,\"rsrp\":%d,\"rsrq\":%d,\"sinr\":%d}\n", ts, (cellb ? 77 : 104), (cellb ? "B3" : "B1"), (cellb ? 1650 : 250), (cellb ? 20 : 10), (cellb ? 48466201 : 48466199), rsrp, rsrq, sinr
            }
            continue
        }
        # ---- v2 ----
        if (nosvc) {
            printf "[2,%d,\"NOSVC\",0,\"a\",null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,%d,%d,%d,null,null,null,null,null,null,null,null]\n", ts, ri(40, 50), ri(20, 40), ri(30, 45)
            continue
        }
        l1on = (l1 == 1 && (i % 211) != 0)
        sat = ((i % 90) < 20)
        dl = sat ? ri(120, 260) * 1000000 : ri(0, 6) * 100000
        prbn = 6; nrb = 133
        prbm = sat ? ri(90, 128) : ri(3, 30); prbx = prbm + ri(2, 8)
        lmcs = f1(12 + rnd() * 10); nmcs = f1(15 + rnd() * 10)
        txp = f1(5 + rnd() * 10)
        pr = cellb ? "3,1650,20,77" : "1,250,10,104"
        split(pr, q, ",")
        nar = dropout ? "LTE" : "NSA"
        c[1] = 2; c[2] = ts; c[3] = "\"" nar "\""; c[4] = (dropout ? 0 : 1); c[5] = "\"a\""
        c[6] = (cellb ? 48466201 : 48466199); c[7] = 55383; c[8] = "null"; c[9] = "null"
        c[10] = 1; c[11] = (dropout ? 0 : 1); c[12] = (dropout ? 30 : 60)
        c[13] = ri(9, 12); c[14] = txp
        if (l1on) {
            c[15] = lmcs; c[16] = ri(1, 4); c[17] = ri(5, 20); c[18] = (dropout ? "null" : nmcs); c[19] = (dropout ? "null" : ri(1, 4)); c[20] = (dropout ? "null" : ri(9, 15)); c[21] = (dropout ? "null" : ri(5, 20))
            c[22] = prbm; c[23] = prbx; c[24] = prbn; c[25] = nrb; c[26] = dl; c[27] = ri(1, 9) * 100000
        } else {
            for (k = 15; k <= 27; k++) c[k] = "null"
        }
        c[28] = ri(40, 50); c[29] = ri(20, 40); c[30] = ri(30, 45)
        for (a = 0; a < 4; a++) c[31 + a] = rsrp + ((a == 2 || a == 3) ? -30 : -2 * a) + ri(-2, 2)
        for (a = 0; a < 4; a++) c[35 + a] = dropout ? "null" : (rsrp + 8 + ((a == 2 || a == 3) ? -25 : -3 * a) + ri(-2, 2))
        line = "[" c[1]
        for (k = 2; k <= 38; k++) line = line "," c[k]
        # carriers: LTE PCC, LTE SCC (other band), NR SCC unless dropped out
        if (cellb) line = line ",[\"P\",\"L\",3,1650,20,77," rsrp "," rsrq "," sinr "," (rsrp + 38) "]"
        else line = line ",[\"P\",\"L\",1,250,10,104," rsrp "," rsrq "," sinr "," (rsrp + 38) "]"
        line = line ",[\"S\",\"L\"," (cellb ? "1,250,10,104" : "3,1650,20,77") "," (rsrp - 6 + ri(-2, 2)) "," (rsrq - 1) "," (sinr - 3) ",null]"
        if (!dropout) line = line ",[\"S\",\"N\",41,509070,50,47," (rsrp - 14 + ri(-2, 2)) "," (rsrq - 1) "," (sinr + 12) ",null]"
        print line "]"
    }
}'
