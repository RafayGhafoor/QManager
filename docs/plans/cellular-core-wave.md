# Cellular core wave (U4.13 to U4.18b)

Opened 2026-10-19. Ledger rows: `docs/rm520n-port-ledger.md` > U4.

## Why this wave

Every Track U row in the ledger is closed, and `rm520n/development` is still at `a05c4e92` (no new source commits). The canon puts Material Symbols on all of `/cellular/**`, but six cellular families never got a U4 row. They still render lucide, and the fork has a re-authored version of each:

| Row | Route | Fork files (`git show a05c4e92:<path>`) | Target today |
|---|---|---|---|
| U4.13 | `/cellular` (Cellular Information) | `components/cellular/radio/*` (5), `tile-shape.ts`, `lib/radio-info.ts`, `lib/ipv6.ts` | old `cellular-information.tsx`, `cell-data.tsx`, `active-bands.tsx` |
| U4.14 | `/cellular/antenna-statistics` | `antenna-statistics/{context-tiles,tech-card,states}` | 1 file, lucide, `max-w` |
| U4.15 | `/cellular/antenna-alignment` | `antenna-alignment/{live-aim,port-strip,recorder-card,use-position-recorder,shapes,states}` | 4 files, lucide, `max-w` |
| U4.16 | `/cellular/cell-locking/frequency-locking` | `frequency-locking/{freq-lock-hero,lte-freq-card,nr-freq-card,apply-bar,shapes}` | 4 files, lucide, 2 `Switch` |
| U4.17 | `/cellular/cell-locking/tower-locking` | `tower-locking/{live-strip,lte-tower-card,nr-sa-tower-card,automation-tiles,schedule-tile,shapes}` | 8 files, lucide, 4 `Switch` |
| U4.18a | `/cellular/settings` | `settings/{live-state-strip,setting-row,rate-ceiling-disclosure,apply-foot,shapes}` | lucide, `cellular-ambr.tsx` |
| U4.18b | IMEI, FPLMN, Network Priority | same file sets, restyled | lucide, 1 `Switch` |

Primitive check: every `components/ui/*` and hook the fork pages import exists in the target. The only missing modules are `components/cellular/tile-shape.ts`, `lib/radio-info.ts` and `lib/ipv6.ts`. All three land with U4.13.

## Contract drift to settle in each row's recon

- `types/modem-status.ts`: fork-only `SimBlock`, `SimStatus`, `SignalMetric`, `NetworkTypeLabel`, `networkTypeLabel`, `normalizeSignalValue`, `hasAntennaData`, `isPortReporting`, `formatBitsPerSec`, `DataUsedBlock` (the last one belongs to B5.21, not this wave). Target-only exports (Adaptive Polling, ping profiles, `RadioDetails`, `formatBytesPerSec`) must stay. Port helpers, not the whole file.
- `types/cellular-settings.ts` and `use-cellular-settings.ts`: the fork uses patch-based apply (`CellularSettingsPatch`, `WRITABLE_SETTING_KEYS`, `ApplyPhase`) and SIM hot-swap detection. `cellular/settings.sh` differs by +142 / -225 lines. This is the biggest backend gap in the wave.
- `use-tower-locking.ts` / `types/tower-locking.ts`: fork-only `TowerWarningCode`, `TowerScheduleSaveResult`; `tower/lock.sh` and `tower/schedule.sh` differ.
- `frequency/lock.sh` differs by +6 / -69. The target may be ahead here (B5.1 transport fix), so recon has to decide which side is ahead before anything is copied.
- Target-ahead files to keep: `lib/earfcn.ts` (+110 lines), the B5.1 / B1.11 shell fixes, `ANTENNA_PORTS`.

## Order and lanes

0. **Pre-flight (this session, at start).** The working tree has an uncommitted NetBird follow-up (`components/monitoring/netbird/*`, `docs/reference/netbird.md`, five `monitoring.json`). Find out which session owns it. If no session does, ask the user before committing it. Sessions branch from `development-home`, so that work has to be settled first.
1. **Lane A, alone first: U4.13.** It lands `tile-shape.ts`, `radio-info.ts` and `ipv6.ts`, which U4.14 and U4.18a import. Frontend only. Merge it before Lane B starts.
2. **Lane B, parallel after U4.13 merges (one session per row, each in its own worktree):**
   - B1: U4.14 + U4.15 (the antenna family, in one session because both touch the same `modem-status` helpers).
   - B2: U4.16 Frequency Locking.
   - B3: U4.18b IMEI / FPLMN / Network Priority.
3. **Lane C, Large rows with a plan stop:** U4.17 Tower Locking and U4.18a Cellular Settings. Each session recons (live modem, read-only) and then stops with a linked plan for approval. Lane C can start alongside Lane B, because the plans don't conflict with the builds. They build after approval.

## Rules for every session

- Read `DESIGN.md`, `PRODUCT.md`, the ledger row, the fork's `docs/reference/<page>.md` and the target's `docs/features/` doc first.
- Worktree reset onto `development-home`; copy `.env`; `bun install` for tsc/build.
- **Locale conflicts:** every row adds keys to `public/locales/*/cellular.json` in all five catalogs. Each row touches only its own sub-tree, and rows merge into `development-home` one at a time, with `bun run i18n:check` after each merge.
- Material only on the route once converted (no lucide left, `bun run icons:check`); filled-chip / Tag split; `CardFoot` apply; toasts from returned results; no `max-w-*`; three states with shape-constant skeletons.
- Validate: `bunx tsc --noEmit`, eslint on touched files, `bun run i18n:check`, `bun run icons:check`, `bun run build`, and a browser preview at 1440 and 375 in light and dark. Any shell change gets the full static audit plus the on-device leg. Writes that lock or unlock bands or towers, or that cycle CFUN, need the user's OK.
- Close the ledger row with commits and deviations, and update `DESIGN.md` Migration Deltas > Icons when the route converts.
- Models: plans on Opus 5.5 High; builds orchestrated on Opus medium with Sonnet 5.5 High builders; recon on Haiku 5.5. Sessions self-merge into `development-home` once validated, and never push.

## Not in this wave

B5.21 (Data Used counter) and B5.22 (Storage meter) are dashboard data restores that need poller work. B5.34 to B5.37 are backend hygiene, and B5.14 / B5.16 / B5.18 are still-owed live checks. Each is its own session later.
