#!/bin/sh
# Fixture test for scripts/usr/lib/qmanager/data_cid.sh (pure parser, no device).
# Usage: sh tools/data-cid/test.sh   (BusyBox sh or bash --posix)
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/../../scripts/usr/lib/qmanager/data_cid.sh"
FAIL=0
# check <name> <blob> <route> <local4> <local6> <want_cid> <want_source>
check() {
    qm_parse_data_cid "$2" "$3" "$4" "$5"
    if [ "$QM_DATA_CID" = "$6" ] && [ "$QM_DATA_CID_SOURCE" = "$7" ]; then
        echo "PASS $1 -> cid='$QM_DATA_CID' src=$QM_DATA_CID_SOURCE"
    else
        echo "FAIL $1 -> got cid='$QM_DATA_CID' src=$QM_DATA_CID_SOURCE, want cid='$6' src=$7"; FAIL=1
    fi
}
LIVE='+CGDCONT: 1,"IPV4V6","SMARTLTE",,0,0,0,,,,,,0,,0
+CGDCONT: 2,"IPV4V6","ims",,0,0,0,,,,,,0,,0
+CGDCONT: 3,"IPV4V6","sos",,0,0,0,,,,,,0,,0
+CGACT: 1,1
+CGACT: 2,1
+CGACT: 3,0
+CGPADDR: 1,"10.182.243.150"
+CGPADDR: 2,"36.4.216.0.174.2.9.74.0.1.0.0.218.43.30.170"
+CGPADDR: 3,""'
check a_live_route "$LIVE" "10.182.243.150" "127.0.0.1 10.182.243.150" "" 1 route
check b_no_kernel_facts "$LIVE" "" "" "" 1 pdp
VZ='+CGDCONT: 1,"IPV4V6","vzwims"
+CGDCONT: 2,"IPV4V6","vzwadmin"
+CGDCONT: 3,"IPV4V6","vzwinternet"
+CGACT: 1,1
+CGACT: 2,1
+CGACT: 3,1
+CGPADDR: 1,"10.1.1.1"
+CGPADDR: 2,"10.2.2.2"
+CGPADDR: 3,"10.3.3.3"'
check c_verizon_pdp "$VZ" "" "" "" 3 pdp
V6='+CGDCONT: 1,"IPV6","data.v6"
+CGDCONT: 2,"IPV4V6","ims"
+CGACT: 1,1
+CGACT: 2,1
+CGPADDR: 1,"36.4.216.0.174.2.9.74.0.1.0.0.218.43.30.170"
+CGPADDR: 2,"32.1.13.184.0.0.0.2.0.0.0.0.0.0.0.5"'
check d_ipv6_only_prefix "$V6" "" "" "2404:d800:ae02:94a:1:0:da2b:1eaa fe80::1" 1 ipv6_prefix
IMS='+CGDCONT: 1,"IPV4V6","internet"
+CGDCONT: 2,"IPV4V6","ims"
+CGACT: 1,0
+CGACT: 2,1
+CGPADDR: 1,""
+CGPADDR: 2,"10.9.9.9"'
check e_ims_only "$IMS" "" "" "" "" none
DET='+CGDCONT: 1,"IPV4V6","internet"
+CGACT: 1,0
+CGPADDR: 1,"0.0.0.0"'
check f_detached "$DET" "" "" "" "" none
TWO='+CGDCONT: 1,"IP","internet"
+CGDCONT: 2,"IP","iot"
+CGACT: 1,1
+CGACT: 2,1
+CGPADDR: 1,"10.1.1.1"
+CGPADDR: 2,"10.2.2.2"'
check g_two_data_route "$TWO" "192.168.1.9 10.2.2.2" "" "" 2 route
check g2_two_data_no_route "$TWO" "" "" "" 1 pdp
check h_qmap_ignored "$LIVE
+QMAP: \"WWAN\",1,1,\"IPV4\",\"10.99.99.99\"" "10.182.243.150" "" "" 1 route
NOACT='+CGDCONT: 1,"IP","internet"
+CGPADDR: 1,"10.1.1.1"'
check i_missing_cgact "$NOACT" "" "" "" 1 pdp
HEX='+CGDCONT: 1,"IPV6","data"
+CGACT: 1,1
+CGPADDR: 1,"2400:AE02:94A:0:1::1EAA"'
check j_colon_hex "$HEX" "" "" "2400:ae02:94a:0:5:6:7:8" 1 ipv6_prefix
check k_local4 "$TWO" "" "10.2.2.2 127.0.0.1" "" 2 local
check l_dual_stack_route '+CGDCONT: 1,"IPV4V6","internet"
+CGACT: 1,1
+CGPADDR: 1,"10.1.1.1","2400:ae02:94a:0:1::1"' "10.1.1.1" "" "" 1 route
[ "$QM_DATA_IPV6" = "2400:ae02:94a:0:1:0:0:1" ] && echo "PASS l_ipv6_recorded" || { echo "FAIL l_ipv6_recorded ($QM_DATA_IPV6)"; FAIL=1; }
exit $FAIL
