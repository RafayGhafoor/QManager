# TTL & MTU (`/local-network/ttl-settings`)

Rewrites the hop count on outbound cellular packets (IPv4 **TTL**, IPv6 **hop limit**) and overrides the **MTU** of the cellular interface. Re-authored from the RM520N fork in ledger **U4.20** (fork `a05c4e92`: `b0bf5493`, `a434e3da`, `2b9432fe`, `26de49ab`); the backend is the target's own and was not changed.

## Files

| Layer | Path |
| ----- | ---- |
| Route | `app/local-network/ttl-settings/page.tsx` (thin re-export) |
| Shell (owns all data) | `components/local-network/ttl-mtu-settings/ttl-settings.tsx` |
| Live strip (Band A) | `ttl-mtu-strip.tsx` |
| Write cards (Band B) | `ttl-settings-card.tsx`, `mtu-settings-card.tsx` |
| Geometry and tones | `shapes.ts` (this family's own module; restate, never import a sibling's) |
| Hooks | `hooks/use-ttl-settings.ts`, `hooks/use-mtu-settings.ts`, `hooks/use-sim-profiles.ts` |
| CGI | `scripts/www/cgi-bin/quecmanager/network/ttl.sh`, `network/mtu.sh` |
| i18n | `local-network` namespace, `ttl_mtu.*` sub-tree (all five catalogs) |

Lucide route (Icon-Boundary Rule).

## Contract

- `GET ttl.sh` → `{ success, is_enabled, ttl, hl, autostart }`. `0` means "no rule", not "set to zero". `POST { ttl, hl }`, each 0–255.
- `GET mtu.sh` → `{ success, is_enabled, current_value }`. `POST { mtu: 576..9000 }` or `{ mtu: "disable" }`.
- Both mutators return `MutationResult` (`{ ok, code, error }`). The card toasts the failure through `resolveErrorMessage(t, code, error, fallback)`; a `null/null` result means the page unmounted mid-call and nothing is toasted.

## Invariants

- **The shell owns both hooks.** The strip spans two endpoints that fail independently, so it takes separate `ttlPending` / `mtuPending` flags; never collapse them into one `isLoading`. Skeleton only while neither has answered and one is still pending; a spanning notice with Retry when neither answered.
- **No MTU figure without a read.** `mtu.sh` substitutes 1500 when `ip link` fails, so the tile draws a value only when the endpoint answered, and its caption states provenance ("Carrier-negotiated") rather than claiming a measurement.
- **`autostart` is never rendered.** The installer makes it `true` on every device, so a tile reading it would show a constant as a reading.
- **Drafts are derived, not synced.** Each card holds `Partial<Draft>` edits over a memoised server baseline, so Refresh re-bases the delta chips instead of erasing typing (and no setState-in-effect). Edits clear on a successful apply.
- **No silent no-op.** Apply is disabled while the form cannot apply, and the `CardFoot` status names the reason; Enter can still submit, so the handler refuses with the same sentence as a toast.
- **`refresh` is called through an arrow.** Both hooks take `silent` first, so a bare `onClick={refresh}` passes the click event as a truthy `silent`. The return type is now `(silent?: boolean) => Promise<void>`.
- **SIM profile override.** When the active Custom SIM Profile sets `ttl` or `hl`, an `override` Banner sits above the cards and the TTL card is held (its loading also waits on the profile read). MTU is not profile-managed and stays writable.

## Known gaps

- `errors.invalid_mtu` still says "typical range 68–1500" while `mtu.sh` enforces 576–9000 (shared `errors` namespace, not touched here).
- `mtu.sh` reads `rmnet_data0`; the fork resolves the WAN interface at runtime because the channel index migrates across attach cycles. Not ported (backend change).
