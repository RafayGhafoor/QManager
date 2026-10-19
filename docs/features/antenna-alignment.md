# Antenna Alignment and Antenna Statistics

The two antenna pages under `/cellular/`, re-authored in the RM520N canon by ledger rows U4.14 and U4.15 (2026-10-19, source `a05c4e92`). Neither has a CGI: both read `signal_per_antenna` from `useModemStatus()` (`/tmp/qmanager_status.json`). The fork's long-form notes are `docs/reference/antenna-alignment.md` and `docs/reference/antenna-statistics.md` at `a05c4e92` (`git show a05c4e92:<path>`); this file records the contract and the QManager deviations.

The pages are a transpose of each other. **Statistics** is technology-major (an LTE card and an NR5G card, four ports each) and answers "which chain is broken". **Alignment** is port-major and answers "which way should I point this thing".

## Files

| Thing | Where |
| ----- | ----- |
| Statistics shell + state routing | `components/cellular/antenna-statistics/antenna-statistics.tsx` |
| Per-radio card, port block, metric row | `components/cellular/antenna-statistics/tech-card.tsx` |
| Context strip (Active MIMO / Serving mode / Chains reporting), geometry from `components/cellular/tile-shape.ts` | `components/cellular/antenna-statistics/context-tiles.tsx` |
| Alignment shell (console + Positions + Receive Chains) | `components/cellular/antenna-alignment/antenna-alignment.tsx` |
| Live Aim console and the pinned phone readout | `components/cellular/antenna-alignment/live-aim.tsx` |
| Positions recorder card | `components/cellular/antenna-alignment/recorder-card.tsx` |
| Recorder state machine + `localStorage` | `components/cellular/antenna-alignment/use-position-recorder.ts` |
| Receive Chains strip | `components/cellular/antenna-alignment/port-strip.tsx` |
| Geometry and tone contract for the alignment family | `components/cellular/antenna-alignment/shapes.ts` |
| Scoring layer (`scoreSnapshot`, `findBestSlot`, ranking scale) | `components/cellular/antenna-alignment/utils.ts` |
| Skeletons + condition screens (each page) | `states.tsx` in each folder, on `components/cellular/condition-screen.tsx` |
| Quality glyph / chip / meter / ink | `components/cellular/signal-quality-display.ts` (no private copies anywhere in the family) |
| Sentinel boundary | `types/modem-status.ts`: `SignalMetric`, `SIGNAL_SENTINELS`, `normalizeSignalValue`, `isPortReporting`, `hasAntennaData` |
| Port metadata | `ANTENNA_PORTS` in `types/modem-status.ts` (the one port table; never duplicate it) |
| i18n | `antenna_statistics.*` (38 keys) and `antenna_alignment.*` (81 keys) in `public/locales/*/cellular.json`; metric labels reuse `radio_info.bands.metric.*` |

## The sentinel boundary (shared by both pages)

The modem says "this port measured nothing" three ways and the poller only translates one (`-32768` to `null`). `normalizeSignalValue(value, metric)` returns `null` for:

- RSRP `-140` and `-32768`
- RSRQ `-32768` only (a real `-19` dB RSRQ is reachable, so `-20` is not a sentinel there)
- SINR `-20` and `-32768`

Confirmed on the RM551E on 2026-10-19: `/tmp/qmanager_signal_history.json` shows `lte_rsrp` `-140` in the same sample and port index as `null` RSRQ and SINR, the same pattern the fork measured on the RM520N. Every per-antenna value on both pages goes through this function; pass the real metric at each call site. A null reading renders as "Not reported" / "Not reporting" with `MetricBar value={null}`, never as an empty bar labelled `-140 dBm`.

## Antenna-type toggle contract (kept from the old page)

- Two antenna types in the Positions card, `directional` (default slot labels `0°`, `45°`, `90°`) and `omni` (`Position A`, `B`, `C`, resolved through i18n while untouched). Labels are editable per slot and freeze at capture time.
- Three slots; each recording averages three samples, gated on the modem's own `timestamp` so an unchanged snapshot is never counted twice.
- Composite score is 60% RSRP + 40% SINR (`SCORE_WEIGHTS`) on the full 3GPP ranking scale, not the display scale. A missing leg reweights instead of scoring zero. `scoreSnapshot` is a pure function of the stored snapshot; do not give it a live-state argument.
- The recommendation appears once two or more slots are recorded.
- The recorder is client-side only: `localStorage` key `qmanager:antenna-alignment:v1` (`{version, antennaType, slots}`), no backend (persistence is new with U4.15; the old page held recordings in memory only, so there is nothing to migrate). `isDefaultLabel` is optional, and bumping `version` would discard every stored recording.

## QManager deviations from the fork

- **Four quality stops, not five.** The fork scores a fifth `bad` level (RSRP below `-120`) and adds `floor` / `range` to `SignalThresholds`. QManager's `getSignalQuality()` still has four stops, and widening the shared union touches every authenticated signal surface, so the antenna files land as-is and simply never receive `bad`. The `antenna_statistics.quality.bad` / `antenna_alignment.quality.bad` keys are kept, ready for when the five-stop model lands (see the port note in `signal-quality-display.ts`).
- **No `max-w-*` page cap.** The only `max-w` left is the header description column (`max-w-[41rem]`, sanctioned by the Full-Width Page Rule) and the empty-state paragraph in `tech-card.tsx`.
- The old `antennas.*` i18n subtree, `alignment-meter.tsx` and `antenna-card.tsx` are retired.

## Gotchas

- `CONSOLE_SPLIT` must not get `items-start`: the sticky console needs its column to stretch, or it never pins.
- Receive Chains draws LTE / NR rows from the surface-level radio mode, never from whether a port currently reports, so a dropping chain shows "Not reported" rather than vanishing.
- Port blocks on Statistics stay mounted at a pinned height and say "Not reporting"; chains drop in and out several times an hour and a collapsing block would make the card jump.
- Card order on Statistics comes from `network.type` (`5G-SA` puts NR first), not from which radio has readings, because per-antenna presence flaps.
- Template-literal i18n keys (`quality.<q>`, `card.<prefix>.*`, `empty.<prefix>.*`, `context.mode.<mode>`, `mode.<radio>`) are invisible to grep; do not delete them for lack of a call site.
