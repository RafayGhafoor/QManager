# Rust poll-parser parity data (B5.29 Phase D)

`expected.txt` holds the globals the **shell** produces on the device (BusyBox
1.36.1 ash, RM551E) for 2074 cases, plus every fixture it uses, so the host
test `parse::tests::parity_with_device_shell` is self-contained.

- Shell sources: `parse_at.sh` md5 `4c67766de14d0b07053d66da5f532d20`,
  `qmanager_poller` md5 `c601b52c47a792bb0c5fa20645661e1e` (its
  `poll_serving_cell`, `poll_per_antenna_signal`, `poll_tier2`,
  `refresh_sim_identity`, `qcmd_exec_g` and the QCAINFO / CFUN blocks of
  `poll_cycle` are extracted verbatim by `rx_expect.sh`).
- Fixtures: `tools/poller-parity/fixtures/` (206, from `gen_fixtures.sh`) and
  `tools/poller-parity/fixtures_rust/` (69, from `gen_fixtures_rust.sh`),
  generated on the device and md5-compared with the repo copies.
- Cases: every fixture through every step (rc 0), non-zero qcmd exits,
  qeng then ca batches (ca reads network_type / lte_state / nr_state), and a
  few whole batches. Case id = `steps|rcs|fixtures`.

Regenerate (on the device, scratch dir only):

```
# stage tools/poller-parity/{shim,gen_fixtures,gen_fixtures_rust,rx_expect,rx_rust}.sh,
# parse_at.sh and the poller (as poller.src) flat into /tmp/rpx (scp), then:
cd /tmp/rpx
sh gen_fixtures.sh /tmp/rpx/fixtures && sh gen_fixtures_rust.sh /tmp/rpx/fixtures_rust
sh rx_expect.sh cases > cases.tsv
nice -n 19 sh rx_expect.sh run /tmp/rpx/parse_at.sh /tmp/rpx/poller.src cases.tsv > expected.bin
# host:
python3 tools/poller-parity/rx_pack.py expected.bin tools/poller-parity \
    native/qmanager_atd/tests/parity/expected.txt <parse_at md5> <poller md5>
```

Device leg (Rust binary with `qcmd --parse-only <step> <rc>` wired, staged as
`/tmp/rpx/qcmd`): `sh rx_rust.sh /tmp/rpx/qcmd cases.tsv > rust.bin` then
`cmp rust.bin expected.bin` (must be identical).

Format of `expected.txt`: `F <fixture> <bytes>`, `E <fixture> <sidecar>`,
`C <case id>`, `V <name> <value>` (globals that left their `SENT_<name>`
sentinel); bytes are printable ASCII verbatim, `\\` for a backslash, `\xHH`
otherwise.

**LTE SINR (2026-10-21).** `lte_sinr` values in `expected.txt` were converted on
the host to dB (`2X-20` for a CR-stripped raw `0..25`, else empty) when
`parse_at.sh` gained `_lte_sinr_db_g`. A device regeneration was not possible
because the poller md5 above was an uncommitted staging build, and today's
`rx_expect.sh` has no `_qc_read` stub for the current poller. The device gate
(`PARITY_ALLOW_SINR=1 sh parity.sh old new fixtures`) showed that conversion is
the only shell difference. Regenerate fully once `rx_expect.sh` stubs `_qc_read`.
