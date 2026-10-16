# Toast Confirmation

> **Applies to:** every Quectel/OpenWRT target build · frontend-only, device-independent · ported from the RM520N fork 2026-10-15 (port-ledger U0.1); the rule was adopted there on 2026-10-06

Every user-initiated mutation that finishes is confirmed by exactly one `sonner` toast, success or failure, and by nothing that fades (**The Toast-Confirms Rule**, user decision). A transient "Applied" / "Saved" chip or any other self-dismissing success label is retired. `SaveButton`'s own Saving.../Saved! flash is the control's state and stays, as do persistent states (Locked, Active, a failure line that stays beside its draft). The rule, its Do/Don't rows and the never-toast list live in `DESIGN.md` > Components > **Confirmation Toasts**; the one-paragraph form is in `CLAUDE.md`. This doc holds what those cannot: the implementation traps and the target's current status.

## Quick Reference

| Item | Value |
|---|---|
| Library | plain `sonner`: `import { toast } from "sonner"`. No wrapper. One `<Toaster />` in `app/layout.tsx` (`components/ui/sonner.tsx`) |
| Reference implementation | The RM520N fork's `components/cellular/band-locking/band-grid-card.tsx`: `markSaved()` then `toast.success(t(...))` on ok, `toast.error(t(...))` on not ok, in the handler. In the target: `components/system-settings/at-engine/host-at-ports-card.tsx` (result-carrying mutator) and, for a boolean mutator, `components/local-network/ttl-mtu-settings/ttl-settings-card.tsx` (fixed title toast, the hook's render-time `error` as the persistent `CardFoot` status) |
| Failure reason | the call's own returned result. Turn a backend error code into copy with `resolveErrorMessage(t, code, detail, fallback)` from `lib/i18n/resolve-error.ts` (contract in [`docs/features/error-codes.md`](../features/error-codes.md)) |
| Copy to clipboard | `copyText` from `lib/clipboard.ts` (lands with ledger U2.3; until then the target calls `navigator.clipboard` directly, see Target status); toast success only when it returns `true` |
| Copy catalog | `t()` keys in **all five** catalogs (`en id it zh-CN zh-TW`, under `public/locales/`); `bun run i18n:check` (`lib/i18n/check.ts`) gates parity. Language-pack mechanics: [`docs/features/language-packs.md`](../features/language-packs.md) |

## Checklist for a new mutation

1. It is a user-initiated mutation that **finishes** (save, apply, persistent toggle, add, delete, reset, install, copy). If it is on the never-toast list below, stop.
2. Take the failure reason from **this call's returned result**. A mutator that returns a bare boolean carries no reason, so the handler shows a fixed translated title. To show a reason, change the mutator to return `{ success, error? }` and update every caller in the same commit (see the `if (await save())` trap).
3. Fire the toast in the **component handler that owns the action**, at the terminal moment: request resolved, read-back matched, or the stepper settled. Not in a presentational footer. First grep for an existing toast on the same outcome.
4. One sentence, past tense, naming the thing ("MTU applied."). Failure is a fixed translated title, plus the reason as `description` when the result carries one.
5. A multi-step or detached apply that settles later is an **effect** with a deterministic `id` and an arm guard (below).
6. `markSaved()` only on success, after the result. Never before the request resolves.
7. Partial failure is **one** error toast, never a success followed by an error.
8. A persistent failure line beside the draft is fine. Keep that same text out of an `aria-live` region so a screen reader hears it once.
9. Retiring a chip's text means deleting its key from **all five** locales, because `bun run i18n:check` fails on extra keys. Adding a toast key means adding it to all five.
10. If the mutation ends in a navigation or reload, read "The navigation exception" before adding any toast.

## The traps

**Stale closure: read the reason from the call's result, never from hook state after an `await`.** An `error` captured by a handler is the render the click happened in, so it is `null` or the previous attempt's message. The tell is `toast.error(error || t(...))` or `error ?? t(...)` straight after an `await`.

**The `if (await save())` trap.** When a mutator that returned a boolean starts returning an object, an unchanged `if (await save())` is truthy for **every** outcome and TypeScript does not flag it, so every success toast fires after a failure. Change the call sites in the same commit (grep the importers) and test `res.success`. RM520N's hooks are mostly `Promise<boolean>` today (the fork counted 116 such signatures under `hooks/`; the target has a similar mix) and `docs/FRONTEND.md` shows the shapes in use, so this is the likeliest way a conversion goes wrong.

**Effect-based toasts: deterministic `id`, and only for a transition seen in this session.** An apply that settles later (profile apply, a list download, an install) is announced from an effect, which re-runs on re-render, in StrictMode and on a language switch (a new `t` identity, which also re-runs any effect or interval that lists `t` as a dependency). Two guards are required together: a sonner `id` derived from the run, so a repeat replaces instead of stacking, and proof the terminal state was reached by an action this page started. A result merely loaded on mount, or a status file left in `/tmp`, never toasts.

**A toast fired from a page's mount effect is lost: `<Toaster />` renders after `{children}`.** `app/layout.tsx` renders the page before `<Toaster />`, so a `toast.*` called synchronously from a mount effect is published before sonner has subscribed. Defer it one tick with `window.setTimeout(() => toast.success(...), 0)`. Use no cleanup when a one-shot flag is consumed on the first pass, or StrictMode's second pass would cancel the only toast. Handler- and `await`-fired toasts fire long after mount and do not hit this.

**One owner per outcome.** A toast in an effect and another in the handler announce the same outcome twice. Pick the surface that sees the terminal moment and delete the other.

**The toast says what is true at that moment.** "Updated" is not "enabled" and "Lock sent" is not "Camped on". A change the device has accepted but not yet confirmed is announced as accepted.

**Copy through `copyText`, never `navigator.clipboard`.** `navigator.clipboard` exists only in a secure context. The modem's web UI is normally opened over plain HTTP at its LAN address (uhttpd), which is not a secure context, and there it is `undefined`, so every raw call throws. `copyText` falls back to a hidden textarea and `execCommand`. A grep for `navigator.clipboard` outside `lib/clipboard.ts` should return only comments.

## The navigation exception

A mutation that ends in a page navigation or reload destroys any toast fired before it, so the transition is the success signal and only failures toast.

- **The `/reboot/` hand-off** (every apply that ends in a reboot: IMEI, IP Passthrough, manual reboot, Software Update, and any flow routed through `lib/reboot/`): `markSaved()` then `window.location.href = "/reboot/"`; see [FRONTEND.md](../FRONTEND.md) > Reboot Dialog Pattern. No success toast. A failed save toasts before returning. A deferred reboot (the dialog plus the persistent banner, `lib/reboot/pending.ts` and `lib/config-backup/pending-reboot.ts`) is **not** a navigation: the apply finished, so it toasts like any other mutation and the banner carries the pending-reboot state.
- **Change Password** (`changePassword()` in `hooks/use-auth.ts`) hard-redirects to `/login/` on success, so nothing fired before the redirect survives. A failed change stays an inline error in the dialog. The confirmation belongs on the page the redirect lands on, through a one-shot `sessionStorage` flag consumed on mount and toasted after a deferred tick (see the mount-effect trap). Neither the RM520N fork nor the target has that hand-off yet, so a successful change shows nothing.
- **`/setup` wizard steps** (`components/onboarding/steps/*`): a successful step advances, and the advance is the confirmation. A failed write toasts. No per-step success toast.

## Never toast

Polling and background or automatic work; draft-only edits (a pill, an input, a select); Discard; tab and filter state; and diagnostics whose result is a persistent inline panel.

## Target status (grepped 2026-10-15, before the canon port)

The rule is partly met by habit. These gaps are swept as each surface is re-authored; ledger **U4.1** (Card-Foot Apply sweep, DONE 2026-10-16) retired the fading Saved labels (Ethernet link speed's `ethernet.badge_saved`, the only one left in the target) and the `toast.error(error || t(...))` stale closures in SMS Forwarding, Band Locking (x2), System Settings, TTL, MTU (x2) and Custom DNS; the counts below predate it.

- **Handler-level toasts are common:** 105 `toast.success(` and 122 `toast.error(` sites (`git grep -E 'toast\.(success|error)\(' -- app components hooks lib`).
- **Stale-closure sites: not audited.** Look for `toast.error(error || t(...))` or `error ?? t(...)` straight after an `await`. The RM520N fork fixed seven by returning `MutationResult` (`types/mutation-result.ts`, `{ ok, error }`) from the mutators; that type does not exist in the target, so a new mutator defines the shape it needs and tests the field (see the `if (await save())` trap).
- **Raw `navigator.clipboard`:** 4 sites (`imei-tools-card.tsx`, `system-logs-card.tsx` x2, `copyable-command.tsx`). `lib/clipboard.ts` lands with U2.3; migrate each when its surface is touched.
- **Hard-coded English toasts:** 12 sites match `toast.(error|success)("`. Every toast string goes through `t()`.
- **Transient Saved chips:** `useSaveFlash` appears in 22 files. Most are `SaveButton`'s own flash, which stays; status text that fades beside a toast is retired.
- **Effect toasts with an `id`:** not audited. Audit one before touching it.

## Related

- `DESIGN.md` > Components > Confirmation Toasts, and The Toast-Confirms Rule under Named Rules.
- `PRODUCT.md` Principle 3 (interfaces that never lie).
- [`docs/features/error-codes.md`](../features/error-codes.md): the backend error envelope that `resolveErrorMessage` translates for the failure toast.
- The RM520N fork's `dashboard-state-motion.md` Part 3 explains `SaveButton`'s own Saved flash and why it carries no `aria-live` (`git show a05c4e92:docs/reference/dashboard-state-motion.md`).
