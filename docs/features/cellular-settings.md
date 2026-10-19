# Cellular Basic Settings (`/cellular/settings`)

Six writable modem settings behind one CGI, a poller-fed live-state strip and the carrier's AMBR rate ceiling. Re-authored in the RM520N canon by ledger row U4.18a (2026-10-19); the fork's long-form reference is `git show a05c4e92:docs/reference/cellular-basic-settings.md`.

## Quick reference

| Thing | Where |
|---|---|
| CGI | `scripts/www/cgi-bin/quecmanager/cellular/settings.sh` (GET + POST) |
| Hook | `hooks/use-cellular-settings.ts` |
| Types | `types/cellular-settings.ts` (+ `networkTypeLabel`, `SimBlock` in `types/modem-status.ts`) |
| Components | `components/cellular/settings/{cellular-settings,cellular-settings-card,live-state-strip,rate-ceiling-disclosure,setting-row,apply-foot}.tsx` |
| Geometry/tone | `components/cellular/settings/shapes.ts` (family-wide: also IMEI, FPLMN, Network Priority, APN) |
| Poller fields | `.network.{type,carrier,sim_slot,ca_*,nr_ca_*,carrier_components,apn,wan_ipv4,wan_ipv6}`, `.sim.status` |
| i18n | `cellular` → `core_settings.basic.*`; `errors` → `invalid_sim_detect`, `sim_slot_switch_unverified` |
| Other caller | Onboarding Network Mode step POSTs `mode_pref` to the same CGI. Keep POST additive |

| Field | AT write | Values |
|---|---|---|
| `sim_slot` | CFUN 0 → `AT+QUIMSLOT=n` → CFUN 1, verified read-back, one retry | 1, 2 |
| `cfun` | `AT+CFUN=n` | 0 (radio off, SIM deselected), 1, 4 (airplane) |
| `mode_pref` | `AT+QNWPREFCFG="mode_pref",v` | all 7 strings the validator accepts; UI offers 4 |
| `nr5g_mode` | `AT+QNWPREFCFG="nr5g_disable_mode",n` | 0, 1, 2 |
| `roam_pref` | `AT+QNWPREFCFG="roam_pref",n` | 1, 3, 255 |
| `sim_detect` | `AT+QSIMDET=v,<level read back>` | 0, 1 |

Apply order: nr5g_mode → roam_pref → sim_detect → mode_pref → sim_slot → cfun.

## Invariants

1. **Read contract.** A transport failure on the compound read (`at_exec` rc 1) returns `modem_error` and no `settings`/`ambr`; it never publishes the seeded defaults. A modem ERROR (rc 2) keeps the partial parse. The hook treats a `success:true` envelope without `settings`/`ambr` as a failed read.
2. **`+QSIMDET?` is the last sub-command** of the compound read, so a firmware that rejects it loses only its own line. When the line is absent, `sim_detect` and `sim_detect_level` are **omitted** (not defaulted to 0) and the row is hidden; a guessed "Off" would be written back on the next save.
3. **`sim_detect` write preserves `insert_level`.** POST reads `AT+QSIMDET?` first; a failed read skips the write and reports the field failed. Only a successful read without the line falls back to level 1. `sim_detect_level` is never writable (not in `WRITABLE_SETTING_KEYS`).
4. **`dual_slot` is a separate, isolated AT call** (`AT+QSIMCFG="dual_slot_status"`), never part of the compound read. It requires exactly 12 tokens; only fields 2/6 (slot 1) and 8/12 (slot 2) are read. On any failure the key is omitted (never `null`), and the hook does not treat that as a failed read. An empty slot reports ICCID `"0"`; the strip's `maskIccid()` turns it into "Empty".
5. **AMBR.** Scratch files are PID-suffixed (`.tmp.$$`). NR5G fields are guarded before the arithmetic, and the multiply runs in `awk` (BusyBox ash arithmetic is 32-bit and wraps silently).
6. **SIM switch** keeps the target's B5.1 path unchanged: poller quiesce flag `/tmp/qmanager_sim_switch_active` (trap-cleared), pre-switch ICCID capture, `verify_quimslot` plus one retry, `sim_db_add` + `auto_apply_profile … sim_switch` only after a verified switch, `qmanager_force_tier2` + `qmanager_refresh_policy_band`. An unverified switch returns `sim_slot_switch_unverified` **with** `applied_fields`/`failed_fields`, so other fields that landed are cleared in the UI.
7. **Dirty-merge rule.** The hook keeps the server snapshot and the pending patch separate; `draft = {...settings, ...pending}`. Reconciliation runs during render and only prunes edits the server has caught up with, so a refresh or the post-save re-read never clobbers an unsaved edit. A new writable field must be added to `WRITABLE_SETTING_KEYS` or it is invisible to the dirty set.
8. **Recovery window keys on attempted fields** (8 s if `sim_slot` was attempted, 3 s for `cfun`/`mode_pref`, else 0), because a failed slot write cycles the radio twice.
9. **`refresh` is a no-arg wrapper.** Passing the fetcher straight to `onClick` made Retry run silently (a MouseEvent landed in `silent`).
10. **Toasts read the returned result.** `saveSettings()` returns `CellularSettingsApplyResult` with `errorCode`; a plain `partial_failure` names the failed rows, any other code shows its resolved message.

## Connection loss

A CFUN cycle (slot switch, `cfun`, and re-registration after a mode change) drops the cellular link, not LAN/HTTP: the POST finishes inline and nothing on this page reboots, so no deferred-reboot banner is needed. The apply foot shows a writing → recovering → verifying step ledger for the ~35 s worst case. The SIM tile (poller) and the slot control (draft) may disagree during a switch; that is intended.

## Poller: `.sim`

`status.json` carries `"sim": {"status": "<ready|pin_required|puk_required|not_inserted|error|unknown>"}` from the existing `t2_sim_status` (AT+CPIN?), `unknown` until the first Tier-2 read. Both composers emit it; `tools/poller-parity/status_parity.sh` pins the top-level key list. `ModemStatus.sim` is optional for older pollers.

## Open items

- `AT+QSIMDET` reboot persistence is unverified (needs a write plus a reboot).
- A manual `mode_pref` save overrides an active Connection Scenario without warning (same as before this row).
