# U4.19 Setup wizard (`/setup`) re-author: plan

Ledger row U4.19, finishing wave (`docs/plans/finishing-wave.md`). Branch `claude/u4-19-setup-wizard-8d44f1`, worktree reset on `development-home` at `63d66786`. Status: **approved 2026-10-19 (with the live APN re-save), built and validated**.

## What recon found

**The fork's wizard is not a visual re-author.** Across `a05c4e92` the fork's onboarding differs from the target only by the motion sweep (`fb396127`, `783eb831`), the Tonal Q mark on the welcome lockup (`726831e5`), the band-lock failure fix (`578ddb2f`) and a check retry in `app/setup/page.tsx` (`7893a5a5`). Its look is still the pre-canon one (`border-primary bg-primary/5` washes, `rounded-xl border`, `bg-muted/60 border` callout, indigo hex confetti) and it has **no i18n at all**. The target is ahead on i18n (full `onboarding` namespace in five catalogs), the strong-password toggle and requirements list, the target-only Web Port step (7 steps, not 6), the bands-unavailable and no-bands states, and the hostname / display-name write. So the row is: target code as the base, fork intent carried in, then the canon applied to every step. "Port intent, not diffs."

**Write contracts, checked against the target CGIs (and the live RM551E, read-only):**

| Step | Call | Contract | Verdict |
|---|---|---|---|
| Password | `auth/login.sh` POST `{password, confirm, enforce_strong}` | setup mode only while `is_setup_required`; issues the session cookie | OK |
| Network mode | `cellular/settings.sh` POST `{mode_pref, nr5g_mode}` | `AUTO\|LTE\|NR5G\|LTE:NR5G` accepted; failure is `success:false` (+ `failed_fields`) at HTTP 200 | OK, but the step **discards the response** and always advances |
| Connection, APN | `cellular/apn.sh` POST `{cid, pdp_type, apn}` | needs `action:"save"`; `pdp_type` must be `ipv4\|ipv6\|ipv4v6` | **Broken twice**: no `action` → `invalid_action`; uppercase `IPV4V6` → would be `invalid_pdp_type`. Silently discarded, so "APN only" has never applied from the wizard |
| Connection, profile | `profiles/save.sh` POST flat keys | `pdp_type` `IP\|IPV6\|IPV4V6` (uppercase) | OK, response discarded |
| Band preferences | `bands/lock.sh` POST `{band_type, bands}` × up to 3 | `success:false` at HTTP 200 on `modem_error` / `at_error` | Target still has the pre-`578ddb2f` `Promise.allSettled` + `onSuccess()` in `finally` |
| Web port | `system/web_port.sh` POST | self-severing; Done step moves the origin via `lib/web-port.ts` | OK (target-only, kept as is) |

Live modem (read-only): `setup_required` is false (password set), web port 80/443 with no `last_result`, APN slot 1 `SMARTLTE` / `ipv4v6`, `band_failover_enabled` = `0` (so `lock.sh` arms no watcher from the wizard), supported bands present in `status.json` (32 LTE, 28 NSA, 31 SA). The APN drift is proven from code; a live POST was not sent.

## Scope (files)

All frontend. **No shell, init.d, UCI or installer change**, so no lifecycle lockstep work.

1. `app/setup/page.tsx`: fork's check retry (3 tries, 1.5 s apart) so a first-boot race does not bounce to `/login/`; after the retries it falls back to `/login/` as today (the target's safer default, deviation from the fork's "show the wizard anyway").
2. `components/onboarding/onboarding-shell.tsx`: canon card (`Card` primitive look: `rounded-hero`, `border-0`, `card-sheen`, no `shadow-2xl` / ring); step dots on `DUR.emphasized` + `EASE_EMPHASIZED` (the sanctioned `width` animation), no spring, dot ring off the retired `/30` alpha; step slide on `DUR.standard` + `EASE_STANDARD`, **enter only** (Enter-Only Rule: drop the `exit` variant, keep `mode="wait"` semantics by keyed remount); arrow nudge on `--duration-quick`. The `max-w-md` single-card column stays (DESIGN: onboarding runs its own single-card shell, not a feature page).
3. `onboarding-wizard.tsx`: unchanged wiring except passing failure-aware callbacks (below).
4. `steps/step-welcome.tsx`: Tonal Q mark `/qmanager-mark.svg` (already in `public/`), no tinted plate behind it; `fadeUp` on `DUR.standard` / `STAGGER_STEP` / `EASE_STANDARD`; preview list as label-left rows.
5. `steps/step-password.tsx`: motion tokens (4 raw sites incl. a spring); strength and match text on `-on-surface` inks; a server failure toasts (`resolveErrorMessage`), validation stays inline as `FieldError`. Consumes `PasswordRequirements` / `StrongPasswordToggle` from `components/auth/**` **without editing them** (U4.21 owns those files).
6. `steps/step-network-mode.tsx`: selection rows re-authored (below); **read the response**: on `success:false` stay on the step and `toast.error` the resolved reason; advance only on success. Skip stays available.
7. `steps/step-connection.tsx`: **fix the APN body** (`action:"save"`, map the select's `IPV4V6/IP/IPV6` to `ipv4v6/ipv4/ipv6` for APN, keep uppercase for the profile); read both responses; toast failure and stay; choice cards re-authored.
8. `steps/step-band-locking.tsx`: carry `578ddb2f` (serial writes, per-category outcome, retry only what failed, outcome cleared on any edit, never advance on failure) on top of the target's supported-band filtering and three states; strings translated; a toast on failure **plus** the persistent per-category notice (DESIGN > Confirmation Toasts: a failure may also leave a persistent line). Notice is a destructive `Banner` (lucide, the route's set; `TonalBanner` is Material-only and cannot mount on a lucide route). Band numerals `tabular-nums` in Rethink.
9. `steps/step-web-port.tsx`: target-only; motion and copy check only.
10. `steps/step-done.tsx`: completion glyph in a filled `success` disc (Glyph-Disc Rule); confetti colours from the brand ramp read off the CSS tokens at fire time (the indigo hex list is the retired Signal Indigo); callout on `surface-container` `rounded-tile` with no border; origin move untouched.
11. `public/locales/{en,zh-CN,zh-TW,it,id}/onboarding.json`: new keys only under `onboarding` (band-lock notice and categories, failure toasts for network mode / connection / band lock / password). zh-TW from zh-CN via OpenCC (`s2twp`).

**Canon applied to every selection list** (network mode, 5G architecture, band presets, connection choice): fill over stroke. Rest row `bg-surface-container`, selected row promoted to `bg-primary-container text-on-primary-container` (Highlight-by-Container), `rounded-tile`, no borders; glyph disc `bg-surface-container-high` at rest, `bg-primary text-primary-foreground` when selected; radio dot kept as the non-chromatic channel. Hover one tonal step (`surface-container-high`). `whileTap` scale stays as a `DUR.quick` / `EASE_QUICK` tween. Custom band grid sits in one `surface-container` tile (One-Nest Rule).

All 14 raw `duration-*` plus the 5 springs and 2 inline `{ duration }` go onto `lib/motion.ts` / `--duration-*` tokens (23 raw sites counted). lucide only (route stays outside the Material scope). Wizard is exempt from `CardFoot`; a step advance is its own success signal, failed writes toast (Toast-Confirms Rule).

## Build order

Mostly sequential in one session; the steps are small. 1) shell + wizard + page, 2) welcome / done / web-port, 3) password, 4) network mode + connection (the two contract fixes), 5) band locking (`578ddb2f`), 6) locales. UI craft via the impeccable skill directly (your preference), Sonnet builders only if the step files split cleanly (they share the selection-row pattern, so I expect to write it once in a small `components/onboarding/shapes.ts` and do the steps myself).

## Risks

- **U4.21 overlap.** `step-password.tsx` imports `components/auth/{password-requirements,strong-password-toggle}.tsx`, which U4.21 is re-authoring (Switch out). If it lands first with a changed API, I adapt the call site after merging; I never edit those files.
- **Shared catalogs.** Both siblings add keys to the same five `public/locales/*` folders but in other namespace files; re-run `bun run i18n:check` after merging whichever lands first.
- **Behaviour change.** Network mode, connection and band steps stop advancing on a failed write. Skip is the escape hatch on every optional step (already wired), so a failure can never trap the user.
- **Enter-only slide.** Removing the exit changes the feel of Back / Continue slightly; it is what the canon says for navigation.

## Validation

- `bunx tsc --noEmit`, eslint on touched files, `bun run i18n:check`, `bun run icons:check`, `bun run build`.
- Browser preview of all 7 steps at 1440 and 375, light and dark, through a **temporary, uncommitted** `app/setup-preview/` route that stubs `fetch` (live band lists, 80/443, `success:true` and `success:false` toggles to show the band-lock notice and failure toasts). Deleted before commit.
- No live writes. The real modem has its password set, so the real wizard cannot run without resetting it, and the brief says not to touch the shared modem's password, port or band locks without your OK. **Optional, your call:** one live APN re-save of the current value (`SMARTLTE` / `ipv4v6`) through the fixed body to prove the contract end to end; it re-applies CGDCONT on CID 1 and may drop the data link for a few seconds.

## Docs and close

Ledger U4.19 row: status, commits, deviations (retry fallback, enter-only slide, Banner instead of TonalBanner, the two Connection fixes and the network-mode fix beyond the fork). DESIGN.md Migration Deltas: only if a row's gap closes (the Icons row needs no change; onboarding stays lucide). `RELEASE_NOTE.md`: one Improvements bullet for "setup now reports failed network, APN and band settings instead of skipping them". Self-merge into `development-home` after validation; never push.

## Rollback

Frontend only: revert the merge commit on `development-home`. Nothing on the device changes.
