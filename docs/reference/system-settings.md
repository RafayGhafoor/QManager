# System Settings (`/system-settings`)

> **Applies to:** the QManager target, ported from the RM520N fork's re-authored index (ledger U4.2).
> Family: `components/system-settings/**` · namespace `public/locales/*/system-settings.json`

The route's **index only**. The sub-routes route to their own docs:
[logs.md](logs.md), [languages.md](languages.md), [software-update.md](software-update.md),
[at-terminal.md](at-terminal.md).

The index is a header (title, hostname `Tag`, Refresh), a status band of three tiles,
and a grid of seven cards. The first four are the page's own; the last three are
device-level cards that keep their own internals.

| Cell | Component | Data |
| --- | --- | --- |
| Time & Units | `system-settings-card.tsx` | `useSystemSettings()` -> `settings` |
| Scheduled Operations | `scheduled-operations-card.tsx` | `scheduledReboot`, `lowPower` |
| SSH Access | `ssh-password-card.tsx` | `useSshPassword()` |
| Tracked SIMs | `tracked-sims-card.tsx` | `useKnownSims()` |
| IPA offload / Host AT ports / Diagnostics | `ipa-offload/`, `at-engine/`, `diagnostics/` | their own hooks |

`modem-subsystem-card.tsx` from the source is **not** ported; the target has no
subsystem endpoint for it.

---

## The family contract

`shapes.ts` owns every geometry string, control height, tone map and skeleton line box on
the surface; the loaded views and their skeletons read the same values. `derive.ts` is
the non-geometry sibling (`formatOffset`, currently without a consumer on this index
because the target's `settings.sh` does not report a live offset). `condition-block.tsx`
is the lucide state block.

Geometry is restated from the system's numbers, never imported across a family boundary.

### Load-bearing constants

| Constant | Why it is the way it is |
| --- | --- |
| `TILE.ROOT` | 104px **pinned**, never `min-h`. The skeleton wears `ROOT` itself so the two cannot drift. |
| `CARD_GRID` | `*:h-full *:*:data-[slot=card]:h-full`. The second step lets the height lock reach **through** each card's motion wrapper. |
| `COARSE_TARGET` | A pseudo-element overlay, so a 44px touch target does not move the row's baseline. Used on both schedule switches and the password reveal toggles. |
| `ROW.RAIL_ROOT` | The row holding a day rail; it never flips beside its label. An `auto-fit` track list inside `ROW.CONTROL`'s shrink-to-fit box has no width to count against and collapses to one column. |
| `CARD_BODY` | The content box that fills a height-locked cell. Gaps stay composed at the call site. |

---

## What the backend actually sends

`system/settings.sh` GET returns `settings` (`force_tailscale_fixes`, `hostname`,
`temp_unit`, `distance_unit`, `timezone`, `zonename`), `scheduled_reboot` and
`low_power`. It does **not** send the fields the source UI used: `effective_offset`,
`effective_zone_abbr`, `timezone_applied`, `timezone_apply_status`, and the reboot
`armed` / `reason` arm status. The UI that needed them is therefore absent, not faked:

- The band's first tile is **Time zone** (the saved `zonename`), not the source's
  **Device clock**. It never grades the live clock, so it has no `drifted` face.
- Preferences has no "clock not updated" notice, and saves do not warn that a timer was
  not armed.
- The `sms_tool_device` payload field is not sent: `settings.sh` ignores it.

`known_sims.sh` returns only `{success, count}` (GET and `clear`). There is no
registry sidecar, so the **Tracked SIMs** card shows a count, not a list, and the band's
SIM tile reads the same count.

## Save results

Every save in `useSystemSettings()` resolves to `SaveResult { success, message? }`.
`message` is the device's reason already translated through `resolveErrorMessage`
(`errors` namespace); it is absent for a transport failure or an empty reason, and the
caller then toasts its own generic line. `useSshPassword().changePassword` and
`useKnownSims().clear` follow the same shape. Toasts are fired from the returned value,
never from hook state read after an `await`.

`error` on `useSystemSettings()` is set by a failed **read** only. A rejected write does
not touch it, so a refused edit cannot light the "last confirmed read" badge or the
stale notices.

---

## Invariants

- **`useKnownSims().count` is `number | null`.** The hook swallows a failed GET by
  design; without the null a swallowed failure is indistinguishable from a genuine zero.
  The card has an error screen for `null` and a separate empty screen for `0`; the band
  tile renders `—` for `null`.
- **A payload that omits a key is not an error.** Cards gate their condition block on
  `!data`, not on `error && !data`; the second form renders invented defaults as though
  the device had reported them. The schedule card needs **both** `scheduledReboot` and
  `lowPower` before it renders the form.
- **Schedule blocks sync on identity** (`server !== prev`), never on truthiness, and are
  held off while a save is queued or in flight (`savePending`), so a refresh landing
  inside the debounce window cannot overwrite the edit being saved.
- **Preferences syncs field by field.** The Force Tailscale Fixes row saves
  immediately and refetches `settings`; resetting every draft on that refetch would wipe
  an unsaved zone or unit edit.
- **One cascade root per route, for everything present at mount.** `system-settings.tsx`
  declares `initial`/`animate`; the card grid is a nested `staggerContainer`. A row
  cascade that mounts on a skeleton -> data swap arrives after the page's clock has run,
  so it declares its own `initial="hidden" animate="visible"` (the Tracked SIMs row).
- **`DAY_PILL.RAIL` needs a definite host**, so it rides `ROW.RAIL_ROOT`.
- **Icons are lucide here.** `/system-settings` is not in the Material set.
  `HintIcon` is the only exception, and the index uses none.

---

## Cards

### Time & Units (`system-settings-card.tsx`)

Time zone, temperature and distance rows in one tonal group, committed from `CardFoot`
(Discard, then `SaveButton`). Each row has its own `Unsaved` marker. The last row is
**Force Tailscale Fixes**, target-only: a `SegmentedField` (Off / On, caller passes the
lucide check through `glyph`) that saves immediately with its own toast and is excluded
from the draft and the dirty check.

### Scheduled Operations (`scheduled-operations-card.tsx`)

Two blocks, **Scheduled reboot** and **Low power window** (target-only), each an
`ROW_GROUP` with an enable switch, time field(s) and a day rail. Both save the same way,
through one internal hook (`useAutosaveSchedule`): the switch saves at once; any other
edit saves 800ms after the last, only while the block is on; a failure reverts to the
server's values and toasts the returned reason; unmounting with an edit queued warns
through `*.toast.unsaved`. There is no Save button, so the card keeps a decorative
receipt strip plus an `sr-only` hint wired by `aria-describedby`.

The receipt strip's `aria-hidden="true"` is correct: `toast.success` announces every
save through Sonner's live region, and the strip's layers are cross-faded by opacity,
which would otherwise read as one permanent string.

The backend rejects "enabled with no days" (`no_days`), so the `Never fires` chip and
the band's `no_day` face are reachable only transiently, between a day being cleared and
its save being refused.

### SSH Access (`ssh-password-card.tsx`)

Three password fields plus an **Enforce strong password** `SegmentedField` (default On,
mirroring the CGI's default). The form mirrors the device policy (five characters
minimum; with the strong policy, upper case, lower case and a digit) so it can refuse
before the round trip. A client-side refusal shows an inline notice; a device failure
toasts the returned reason. The web session is not affected by a change. The field
reveal toggles are a ghost `Button` over an `Input` (the target's `InputGroup` does not
take the canon `host` prop yet).

### Tracked SIMs (`tracked-sims-card.tsx`)

See [known-sims.md](../features/known-sims.md#frontend-tracked-sims-cardtsx).

---

## The status band

Three tiles, all reading data the page already fetches. No new endpoint, no poller.

| Tile | Source | States |
| --- | --- | --- |
| Time zone | `settings.zonename` | unreachable, unread, saved |
| Next reboot | `scheduled_reboot` | unreachable, unread, off, no_day, armed |
| Tracked SIMs | `known_sims.sh` count | count, unknown (`—`), none |

Each tile derives **one state union** and reads tone and glyph from a `Record`-typed
face map, so the value line, the caption and the disc cannot answer the same question
differently. Every state carries its own glyph: `success-container` and
`warning-container` measure 1.03:1 apart, so the glyph is the only separator a tile has.

The band takes `knownLoading` separately from `isLoading`: the known-SIMs set has its own
GET and can land later, and without it the tile would show a confident `0`.

---

## i18n

Subtrees: `page`, `band`, `preferences`, `reboot`, `low_power`, `ssh`, `known_sims`, in
all five packs. The pre-port `system`, `scheduled_operations` and `ssh_password`
subtrees are deleted.

- **Casing lives in the class, never the leaf.** `EYEBROW` carries `uppercase`.
- **No middle-dot glue** between short facts.
- A backend reason is never spliced into a sentence: it arrives already translated
  through `resolveErrorMessage`, or the caller shows its own generic line.
