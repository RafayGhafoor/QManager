# About Device, Support & Donate

The design-language adoption pass for `/about-device`, `/support` and the Donate dialog,
landed in the fork 2026-09-07 and ported to this target by ledger U4.2 (2026-10-16). Three surfaces that had never migrated: no `shapes.ts`, no page cascade,
hairline table rows, retired inks, and **zero** translated strings between them.

Two families, two shape modules, one shared donate component:

| Path | Owns |
| --- | --- |
| `components/about-device/shapes.ts` | All geometry and tone for `/about-device` |
| `components/about-device/derive.ts` | `aboutView()`, the internet-tone derivation, the row builders |
| `components/support/shapes.ts` | All geometry and tone for `/support` **and** the dialog, incl. the brand pills |
| `components/support/donate-links.tsx` | The three channels, rendered by the band **and** the dialog |

Geometry is restated per family. Neither imports from `components/cellular/**`.

---

## The brand-colour exception

`PILL_WISE` / `PILL_PAYPAL` / `PILL_SPONSOR` in `components/support/shapes.ts` are the only
sanctioned raw hex in either family. On a payment button, brand recognition is functional and
outranks the token-purity rule — **user decision, 2026-09-07**, taken against a proposal to
replace them with system tonal pills.

**Each is a light/dark pair, and the dark half is not optional.** The shipped fills were
invisible on a dark card. Measured against `--card`, where SC 1.4.11 asks 3:1 for a component
boundary and 4.5:1 for the label:

| Channel | Light fill / ink | Dark fill / ink |
| --- | --- | --- |
| Wise | `#163300` + white — 13.93 / 13.93 | `#163300` measured **1.30:1**. Ships `#9FE870` + `#163300` — 12.32 / 9.45 |
| PayPal | `#003087` + white — 11.85 / 11.85 | `#003087` measured **1.53:1**. Ships `#0070BA` + white — 3.48 / 5.22 |
| GitHub Sponsors | `#BF3989` + white — 5.05 / 5.05 | `#BF3989` + white — 3.60 / 5.05 (one value both grounds) |

Both replacements are the brands' own dark-ground colours, so nothing about the identity is
invented. The pair shape is what `destructive` already does — its dark fill is deliberately a
*light* one. **Verified in the rendered DOM in both themes**, not from the class strings.

⚠️ Only review upholds this. A future token sweep that treats the hex as drift and "fixes" it
to a role colour discards a user decision; one that keeps the light half and drops the dark
half reintroduces a 1.30:1 button.

**No Ko-fi.** `KofiIcon` was 25 lines of dead SVG and is deleted, not parked. Three channels.

---

## `TonalBanner` cannot be used on either route

`components/ui/tonal-banner.tsx:94` types `icon: MaterialSymbolName` and `:158` renders a
`MaterialSymbol`. Both routes are **lucide** per DESIGN.md's Icon-Boundary table, so the
primitive is unusable here without breaking the boundary. The band's failure notice is
therefore `NOTICE` in `about-device/shapes.ts` rather than the shared primitive.

This is not an About Device quirk — it applies to every lucide route, and the next surface to
need a card-scoped banner will hit it.

---

## What the page reports, and what it must not claim

**"OpenWrt version" (target adaptation).** On this target `about.sh` fills
`system.openwrt_version` from `/etc/openwrt_release`'s `DISTRIB_RELEASE`, a host OS
version. The source read a Quectel `Project Rev` there and labelled it "Firmware
revision"; that label would be false here, so the row reads "OpenWrt version".

**The Internet tile is the only runtime tone on the band.** It reads the ping daemon's verdict
(`connectivity.internet_available`, which `about.sh` passes through from the poller cache), the
same source the dashboard and the watchdog use: `success` when true, `destructive` when false,
neutral "Not measured" when null (the daemon is not reporting). The caption names the answering
leg and its last round-trip from the same cache. The ipify lookup only fills the Public address
rows and never decides reachability: carriers that block it would otherwise read as offline.
Every other disc is neutral — a colour that never changes encodes nothing.

**One failure, one message.** `aboutView()` returns `loading | loaded | unreachable` and every
child reads it; no component infers state from a payload's shape. On `unreachable` the band
carries the notice and the Retry, and both cards go honestly empty. The retired pair printed a
destructive alert in one card while the other rendered six network rows of `-`, so a dead read
and a device with no addresses were indistinguishable.

The ordering inside `aboutView()` is load-bearing: a re-read that **fails** drops to empty even
with stale figures in state, while a re-read still **in flight** keeps the loaded view rather
than flashing skeletons over figures the user is already reading.

**An em dash is a reported absence, never a failed read** — the whole card fails together, so
inside a loaded card `—` can only mean the device has no value. The provenance line under
Addresses says so.

---

## Things that look like drift and are not

**The QR plate is white in both themes, deliberately.** A themed plate is unscannable. This is
a functional requirement, not a token violation.

**Eyebrow caps live in CSS, not in the leaves.** `EYEBROW` carries `uppercase`, and the English
keys read `Model` / `Modem firmware` / `Host system` / `Internet`. A pre-uppercased leaf would
push English casing into five locales; `text-transform` is locale-aware where a baked string is
not.

**Metric rows carry the fill; there is no second group fill.** The rows are
`surface-container` and the group around them is a transparent labelled cluster. Stacking a
`rounded-tile` group fill under them would put `surface-container` on `surface-container` — a
1.00:1 edge. The constants are `GROUP` / `ROW_LIST`, deliberately *not* named `ROW_GROUP`, so
nobody reads them as the `local-network/ethernet` composition.

**Several strings are constants, not keys**, because they are proper nouns or addresses:
`LINKS.DISCORD_NAME` ("Cellular Modem Talk/Development"), `LICENSE` ("MIT + Commons Clause"),
the repo URLs, and the three channel names in `donate-links.tsx` — "Wise", "PayPal",
"GitHub Sponsors". The Discord name was briefly a key, and `i18n:check` correctly flagged it as
identical in all five locales; the allowlist was the wrong fix, since suppressing "Cellular",
"Modem" and "Development" globally is what that file's own readme forbids.

**The repo slug is `dr-dolomite/QManager`**, matching this target's `system/update.sh`
`GITHUB_REPO` (the fork's page names `QManager-RM520N`; never port that slug).

---

## i18n

73 leaves across three new sections of the existing `common` namespace — `aboutDevice.*`,
`support.*`, `donate.*`. A **new namespace file would need registering by hand** in
`lib/i18n/resources.ts`, which is why these are sections rather than a fourth pack.

All five packs are **CRLF**. A `JSON.parse` → `JSON.stringify(obj, null, 2)` round-trip is
byte-identical on all five *provided* the CRLF is restored and the trailing newline preserved —
verified before writing, so the diff contains only the added sections.

⚠️ **`i18n:check` cannot catch a called key that exists in no pack.** It compares packs against
each other, so a key called by a component and declared nowhere passes the gate green and
renders its dotted path on screen. `donate.band.title` and `donate.band.body` did exactly that.
Audit both directions — called-but-undeclared *and* declared-but-uncalled — against the settled
sources, including the dynamic `${K}.${row.labelKey}` paths built in `derive.ts`.

---

## Measured, not read from class strings

Confirmed in the rendered DOM at the close of the pass:

| Claim | Measured |
| --- | --- |
| Symmetric-Pair Rule | `/about-device` 527 / 527 · `/support` 445 / 445 |
| Tile pin, not a floor | 104 / 104 / 104 / 104 |
| Metric rows | 40px · action rows 64px · pills 42px |
| `rounded-card`, `border-0` | 16px, 0px |
| **`CARD_SHELL`'s whisper beat `card.tsx`'s `shadow-sm`** | `lab(7.74 -0.53 -4.00 / 0.06) 0 1px 2px` — the token, not `rgba(0,0,0,.1) 0 1px 3px` |
| Dialog at 390px | 358px wide, 16px radius, no horizontal overflow |

That shadow row is why `CARD_SHELL` carries the important marker: `cn()` cannot dedupe an
arbitrary shadow against the primitive's own, because `tailwind-merge` reads an arbitrary
shadow value as a shadow *colour*, so both survive and emission order decides. Same family as
the custom-radius trap in `lib/utils.ts`.

---

## Target adaptations

- **LAN row.** The fork's `network.lan_gateway` row is the target's `network.lan_subnet`
  ("LAN subnet", CIDR): `types/about-device.ts` keeps `lan_subnet`, `addressGroups()` reads it and
  the row key is `aboutDevice.rows.lan_subnet`.
- **Version.** The Tag in the QManager band reads `APP_VERSION` from `lib/i18n/app-version.ts`
  (the package.json version), not a direct package.json import.
- **Hook.** `useAboutDevice` gained `isRefreshing` (a silent re-read keeps the figures on screen
  and only spins the pill). The header Refresh is the shared `RevealLabelButton`
  (`components/ui/reveal-label-button.tsx`): icon-only at rest, label on hover or focus. The target's error path stays: a `success:false` envelope resolves
  through `resolveErrorMessage`, and the fallback sentence is `aboutDevice.errors.fetch_failed`.
- **Not ported.** The fork's `hw_profile` / firmware fingerprint rows.
- **i18n.** Strings live in `common.aboutDevice.*`, `common.support.*` and `common.donate.*`;
  the retired `system-settings.about_device.*` and `system-settings.support.*` subtrees are gone.
- **Assets.** `public/qmanager-mark.svg` and `public/discord-qr.svg` both exist in the target.

## Not verified

Not seen against the live modem: this pass is frontend-only and `about.sh` is untouched.
