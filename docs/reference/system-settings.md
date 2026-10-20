# System Settings (`/system-settings`)

> **Applies to:** the QManager target, ported from the RM520N fork's re-authored index (ledger U4.2),
> then regrouped (`docs/plans/2026-10-20-system-settings-regroup.html`): frontend only, no backend,
> CGI or UCI change, and no existing URL moved.
> Family: `components/system-settings/**` · namespace `public/locales/*/system-settings.json`

The index, plus two pages split out of it: **Device Access** and **Hardware** (both below).
The other sub-routes have their own docs: [logs.md](logs.md), [languages.md](languages.md),
[software-update.md](software-update.md), [at-terminal.md](at-terminal.md), and
[system-health-check.md](../features/system-health-check.md) (which also hosts the Debug
Report card).

The index is a header (title, hostname `Tag`, Refresh), a status band of three tiles,
and three cards. Page description: "How this device keeps time, when it restarts, and which
SIMs it remembers." **Time & Units** and **Scheduled Operations** sit side by side as a
symmetric 2-up; **Tracked SIMs** is a full-width card (`@3xl/main:col-span-2`) below them.

| Cell | Component | Data |
| --- | --- | --- |
| Time & Units | `system-settings-card.tsx` | `useSystemSettings()` -> `settings` |
| Scheduled Operations | `scheduled-operations-card.tsx` | `scheduledReboot`, `lowPower` |
| Tracked SIMs | `tracked-sims-card.tsx` | `useKnownSims()` |

SSH Access and Web Port live on [Device Access](#device-access-system-settingsdevice-access);
Hardware Offload and Host AT Ports on [Hardware](#hardware-system-settingshardware); the
debug report on System Health Check. None of them render on the index.

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

`system/settings.sh` GET returns `settings` (`hostname`,
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
`useKnownSims().clear` follow the same shape (`useIpaOffload().setEnabled` returns the
related `{ ok, error? }` `IpaOffloadMutationResult`; see [Hardware](#hardware-system-settingshardware)). Toasts are fired from the returned value,
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
- **Preferences syncs field by field.** The draft re-syncs per field when `settings`
  changes, so a refetch (a poll, or the unit or zone just saved) cannot wipe an unsaved
  edit to another field.
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
(Discard, then `SaveButton`). Each row has its own `Unsaved` marker.

> ℹ️ NOTE: The target-only **Force Tailscale Fixes** row was removed with the Tailscale
> rework. The fw4 zone and routing rule are now automatic, and the on/off lives in the
> **Network fixes** row on the Tailscale page ([`tailscale.md`](tailscale.md)).
> `settings.sh` no longer reads or writes `force_tailscale_fixes`; an old client that
> still posts it is ignored.

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

### Tracked SIMs (`tracked-sims-card.tsx`)

See [known-sims.md](../features/known-sims.md#frontend-tracked-sims-cardtsx).

---

## Device Access (`/system-settings/device-access`)

"The password and ports used to reach this modem." Route
`app/system-settings/device-access/page.tsx` ->
`components/system-settings/device-access/device-access.tsx`. A two-column grid (`CARD_GRID`, one
column on a phone) of two half-width cards; each owns its hook and internals, the page only composes them.

| Card | Component | Data |
| --- | --- | --- |
| SSH Access | `ssh-password-card.tsx` | `useSshPassword()` |
| Web Port | `web-port/web-port-card.tsx` | `useWebPort()` ([web-port.md](../features/web-port.md)) |

### SSH Access (`ssh-password-card.tsx`)

Three password fields (stacked one per row in the half-width desktop cell; one row only if the card spans the page) plus an **Enforce strong password** `SegmentedField` (default On,
mirroring the CGI's default). The form mirrors the device policy (five characters
minimum; with the strong policy, upper case, lower case and a digit) so it can refuse
before the round trip. A client-side refusal shows an inline notice; a device failure
toasts the returned reason. The web session is not affected by a change. The field
reveal toggles are a ghost `Button` over an `Input` (the target's `InputGroup` does not
take the canon `host` prop yet).

### Web Port (`web-port/web-port-card.tsx`)

HTTP and HTTPS fields sit side by side on a wide card. The card keeps its confirm dialog
and its post-save redirect, which now lands on `/system-settings/device-access/` on the new
origin (it used to land on `/system-settings/`).

---

## Hardware (`/system-settings/hardware`)

"How Ethernet traffic and a connected host reach the modem's hardware." Route
`app/system-settings/hardware/page.tsx` ->
`components/system-settings/hardware/hardware.tsx`. A symmetric 2-up of two cards, each with
its own hook.

| Card | Component | Data |
| --- | --- | --- |
| Hardware Offload | `ipa-offload/ipa-offload-card.tsx` | `useIpaOffload()` ([diagnostics.md](../features/diagnostics.md)) |
| Host AT Ports | `at-engine/host-at-ports-card.tsx` | `useHostAtPorts()` ([at-broker.md](../features/at-broker.md)) |

### Hardware Offload (`ipa-offload-card.tsx`)

A draft-and-apply card. An On/Off `SegmentedField` edits a local draft, committed from
`CardFoot` (status left, "Takes effect after a reboot."; Discard, then an Apply
`SaveButton`). It replaces the old bare `Switch`, which saved the moment it was toggled.

- Apply POSTs as before. On success it calls `requestRebootLater("ipa_offload")` (the
  deferred-reboot banner) and toasts; on failure it toasts the returned reason.
- The status row reads "Pending reboot" (warning chip) while the pending-reboot flag's
  source is `ipa_offload`, otherwise On/Off from the boot-enable state. The old card showed
  "Takes effect after reboot" unconditionally.
- Firmware without the vendor init script (`available: false`) shows a neutral "Not on this
  modem" state instead of a disabled switch.

> ℹ️ NOTE: `useIpaOffload().setEnabled` returns `{ ok, error? }` (`IpaOffloadMutationResult`, `types/ipa-offload.ts`)
> instead of a boolean, so the card toasts the call's own failure reason. A failed save no
> longer sets the hook's load `error`, so it cannot flip the card to its unreachable state.

### Host AT Ports (`host-at-ports-card.tsx`)

On/Off for the vendor host AT bridge ([at-broker.md](../features/at-broker.md)). It gained
dedicated unreachable-state copy (`host_at.{unavailable_title,error_title,error_description}`)
with the move.

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

Subtrees: `page`, `band`, `preferences`, `reboot`, `low_power`, `ssh`, `known_sims`,
`device_access`, `hardware`, `web_port`, `ipa_offload`, `host_at`, in all five packs (en,
zh-CN, zh-TW, it, id). The regroup added `device_access.page.{title,description}`,
`hardware.page.{title,description}`,
`ipa_offload.{status_on,status_off,reboot_note,discard,unavailable_title,error_title,error_description}`,
`host_at.{unavailable_title,error_title,error_description}` and
`web_port.{error_title,error_description}`; `sidebar.json` gained `items.device_access` and
`items.hardware`. The pre-port `system`, `scheduled_operations` and `ssh_password`
subtrees are deleted.

- **Casing lives in the class, never the leaf.** `EYEBROW` carries `uppercase`.
- **No middle-dot glue** between short facts.
- A backend reason is never spliced into a sentence: it arrives already translated
  through `resolveErrorMessage`, or the caller shows its own generic line.
