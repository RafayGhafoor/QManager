# Rust poll-parser parity data (B5.29 Phase D)

`expected.txt` holds the globals the **shell** produces on the device (BusyBox
1.36.1 ash, RM551E) for 2184 cases, plus every fixture it uses, so the host
test `parse::tests::parity_with_device_shell` is self-contained.

- Shell sources (device-generated 2026-10-21 from commit b9c91aa0):
  `parse_at.sh` md5 `657b5b9d70c6e1fac3c87f6605e039aa`, `qmanager_poller`
  md5 `f8ce47a90f4d3f418322ca705d8b1bd3` (its `poll_serving_cell`,
  `poll_per_antenna_signal`, `poll_tier2`, `refresh_sim_identity`,
  `_qc_read`, `qcmd_exec_g` and the QCAINFO / CFUN blocks of `poll_cycle`
  are extracted verbatim by `rx_expect.sh`); `expected.bin` md5
  `78af5568f08d62e77af44be83393ce5f`.
- Harness policy: `_AT_LATCH=0` (no busy latch) and `SC_FAIL_LIMIT=1` /
  `SC_BUSY_LIMIT=1`, so a failed or busy serving-cell read takes the failure
  branch at once; the keep-last-values streak is poller policy, not parsing.
- Fixtures: `tools/poller-parity/fixtures/` (216, from `gen_fixtures.sh`) and
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


**Known drift (2026-10-21, open).** This corpus makes
`parity_with_device_shell` fail on 15 single-step cases with a non-zero qcmd
exit; every rc 0 case and every multi-step batch matches. The Rust port
predates the poller's `_qc_read` (34c94bd4, busy latch), which changed two
things the port does not model yet:
- On rc != 0 `_qc_read` moves the reply out of `_QRAW`, so `sig`, `ident`,
  `cfun` and `simid` see an empty reply and leave every global untouched
  (sig 6, ident 6, cfun 1, simid 1 case). Rust still parses the output.
- `ca` on rc 3 (busy) keeps the last CA values; Rust still resets them
  (1 case).
Fix the port (`step_*` in `src/parse.rs`), not the corpus.
