# B5.37 SIM-mismatch activation: plan

Ledger row B5.37 (polish wave, `docs/plans/polish-wave.md`). Large because it is on the profile apply path. **Decided 2026-10-19: option (b), frontend only. Built on this branch.**

## What actually happens today (traced + live)

Manual Activate: `profile-view.tsx` `handleActivate` opens the apply dialog and calls `profiles/apply.sh`. That CGI checks the id, the locks and Verizon USB mode. It does **not** look at the ICCID. The worker runs without `--auto`, so its stale-SIM guard (`_auto_sim_guard`) is off. Every step runs on the SIM that is in the modem: APN to the CID, TTL/HL, the Verizon MPDN rule, the IMEI. Then the active marker is written.

The row then shows `SIM mismatch` (`deriveStatus`: active + `sim_iccid` set + not equal to the live ICCID). Its note says *"The device keeps its current settings until a matching SIM is inserted."* That is false twice:

1. The settings were already applied. The B5.24 sweep saw CID 1 rewritten.
2. A matching SIM is not what ends it. The next `auto_apply_profile` call ends it: at boot, after a SIM switch, or on a watchdog Tier 3 or SIM-failover revert. That call finds no profile for the live SIM, clears the marker, tears down the scenario cron, resets the scenario to Balanced, and reverts MPDN for Verizon (pending reboot). At boot the poller then runs `reconcile_active_apn_slot_at_boot`, which restores the APN slot because there is no active profile any more. An IMEI override is not reverted. It stays in NV.

Live modem, read-only (2026-10-19 23:00): no active profile; SIM in slot 1 is `…8636` (Smart, CID 1 `SMARTLTE`); both saved profiles are bound to other SIMs (`GOMO Profile …9682`, `TEST Slot1 Auto …8860`). So on this modem **every** manual activation is a mismatch activation, which is how the sweep hit it. The boot log shows the auto-apply no-match branch running at 21:45.

A second bug: `deriveStatus` compares the raw strings. `current_settings.sh` returns the canonical ICCID (the trailing BCD `F` pad is stripped). A profile whose stored ICCID still has the `F` pad would show a false mismatch. The backend compares through `iccid_canonicalize`, and the frontend should do the same.

## The choice

| | What the user gets | Cost |
|---|---|---|
| **(a) Copy fix only** | The row note tells the truth: applied to this SIM, ends at the next restart or SIM change. | Frontend copy only. The foot-gun stays silent: one click puts a Verizon MPDN rule or an IMEI override on the wrong SIM. |
| **(b) Confirm, then apply** (recommended) | Activating a profile bound to another SIM opens an `AlertDialog` first. It says what will happen and how long it lasts, then *Apply to this SIM* or *Cancel*. Plus the copy fix from (a). Plus a Fact-Is-Info chip on inactive rows bound to another SIM, so the user sees it before clicking. | Frontend only, no shell change. |
| **(c) Refuse** | `apply.sh` rejects with a new error code `profile_sim_mismatch` (in `errors.json` × 5 and `docs/features/error-codes.md`); the UI disables Activate on those rows. | Backend + frontend. It blocks real uses: building and testing a profile before the SIM arrives, a replacement SIM with a new ICCID for the same line, or a SIM-agnostic setup the user forgot to unbind. The only way out is to edit the profile. |

**Recommendation: (b).** It keeps the action, makes the consequence visible at the moment it matters (Copy & Help: consequences stay visible), and needs no backend change. The worker's per-step skip logic and the ICCID auto-apply path stay untouched.

How (b) behaves:

- **Mismatch test** (one shared helper, used both for the dialog gate and for `deriveStatus`): the profile's `sim_iccid` is non-empty, the live ICCID is known, and the two differ after canonicalization (trim, uppercase, strip one trailing `F`). This mirrors `iccid_canonicalize` in `sim_db.sh`.
- **Live ICCID unknown** (`current_settings.sh` not loaded or empty): no dialog, apply as today. This matches the backend's rule that an empty read is "don't know", not evidence of a mismatch.
- **Dialog** (`AlertDialog`; `AlertDialogContent` already carries `card-sheen`): the title is *Apply "{{name}}" to this SIM?* The description: *This profile is bound to a different SIM. Its settings apply to the SIM in the modem now and turn off at the next restart or SIM change.* For Verizon profiles there is one extra line, because the MPDN rule is the dangerous step: *The Verizon data routing rule is set on this SIM too.* The actions are Cancel and *Apply to this SIM* (default variant). Confirming runs today's `handleActivate`, and the Sequenced Pipeline Dialog follows. Cancel does nothing and shows no toast (no mutation happened).
- **Toasts**: unchanged. There is one outcome toast on apply-dialog close (Toast-Confirms Rule already met).
- **Row note** for the active `SIM mismatch` row, rewritten: *Applied to the SIM in the modem, not the one this profile is bound to. It turns off at the next restart or SIM change.* The `warning` chip + `sim_card` note container stays: it is a real caveat on the live state.
- **Inactive rows bound to another SIM**: an `info` `Badge` *Other SIM* with its own glyph (`sim_card_alert` if it is in the subset, else one that is; `icons:check` decides). It shows only while it applies (Fact-Is-Info). It is not shown on the active row, which already carries the mismatch chip.
- **Copy**: new keys plus the rewritten `custom_profiles.view.mismatch_note`, in all five catalogs (en, zh-CN, zh-TW, it, id; zh-TW from zh-CN via OpenCC-style conversion). The unused `custom_profiles.active_card.mismatch_note` is left alone (U4.23's sweep owns dead keys).

## ICCID auto-apply interaction

None of the options change `auto_apply_profile`, the worker, or the `--auto` guard. A manual mismatch activation still ends at the next auto-apply call (boot / SIM switch / watchdog), and the boot APN reconcile still restores the slot. The new copy describes exactly that. The IMEI override is not reverted by that path. The dialog does not promise that it is; it says the *profile* turns off. A one-line `HintIcon` could carry "an IMEI change stays until you change it". I propose to leave that out unless you want it.

## Files ((b))

1. `components/cellular/custom-profiles/profile-view.tsx`: shared `iccidMismatch()` helper, `deriveStatus` uses it, a confirm `AlertDialog` state (`pendingMismatch`), the info chip on inactive rows, and `currentIccid` threaded into `ProfileRow`.
2. `public/locales/{en,zh-CN,zh-TW,it,id}/cellular.json`: rewritten `view.mismatch_note`, plus `view.mismatch_confirm.{title,description,verizon_note,confirm}` and `pills.other_sim`.
3. `docs/features/custom-sim-profiles.md`: Activate section + the SIM Mismatch invariant (canonical compare, confirm gate, lifetime of a mismatch activation).
4. `RELEASE_NOTE.md`: one Improvements bullet.
5. Ledger row B5.37 only (CRLF bytes).

Builder split: this is one component and five catalogs. I write the component (the profile path), and one Sonnet builder does the four non-en catalogs in parallel. No Haiku recon is needed (the trace is done).

## Validation

- `bunx tsc --noEmit`, eslint on `profile-view.tsx`, `bun run i18n:check`, `bun run icons:check`, `bun run build`.
- The browser preview of `/cellular/custom-profiles` (phone 375 and desktop, light and dark): the chip, the dialog, Cancel.
- No shell change, so no static shell audit is needed. **Live (needs your OK):** one activation on the shared modem through the deployed build: the dialog, then apply, the row note and the toast; then Deactivate, and check that CID 1 is back to `SMARTLTE` and there is no `active_profile`. The baseline is above. GOMO Profile (no IMEI, non-Verizon) is the safe one to use.

## Rollback

Revert the commit. It is frontend + copy only, and there is no state on the modem.
