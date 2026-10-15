# Motion Preference

> **Applies to:** every Quectel/OpenWRT target build · frontend-only, device-independent · ported from the RM520N fork 2026-10-15 (port-ledger U0.1); verified there 2026-10-11 against `b2b0a0d6` / `fb396127`

The Animations preference (sidebar account menu → **Animations**: System / Full / Reduced) decides whether QManager moves. It exists because the OS `prefers-reduced-motion` query is the wrong single source: a user can want Full on a machine that asks for less motion, or Reduced on one that asks for nothing. The choice is one attribute on `<html>`, and every reader goes through one resolver that puts the in-app choice ahead of the OS query in both directions. The rules (movement goes, opacity stays; loading loops stop; the tables) live in `DESIGN.md` > Motion. This doc holds the contract and the traps.

> ℹ️ NOTE: **Target status.** The full system landed with ledger row **U2.2** (2026-10-15): the `lib/motion.ts` rewrite to the 360 / 600 / 800 ms scale, `lib/motion-preference.ts`, `components/motion-preference.tsx`, `components/motion-provider.tsx`, the `data-motion` boot script in `app/layout.tsx`, and the ESLint rules. `lib/motion-presets.ts` is deleted. The sidebar Animations row in `components/nav-user.tsx` uses lucide glyphs until U3.1 converts the sidebar to Material. The `useChartSeriesMotion()` hook in `hooks/use-chart-motion.ts` lands with the first chart that is re-authored (U4.7 / U4.10).

## Quick Reference

| Item | Value |
|---|---|
| Live answer for a component | `useMotionReduced()` — `components/motion-preference.tsx`. Re-renders on a preference change and on an OS toggle |
| Plain answer for a callback or non-React code | `isMotionReduced()` — `lib/motion-preference.ts`. Reads the attribute, then the OS query, at call time |
| Stored choice | `localStorage["qmanager_motion"]` (`MOTION_STORAGE_KEY`) = `"system"` \| `"full"` \| `"reduced"` |
| DOM contract | `data-motion` on `<html>` (`MOTION_ATTRIBUTE`): `"full"`, `"reduced"`, or **absent** for System |
| Pre-paint stamp | `MOTION_BOOT_SCRIPT`, injected render-blocking at the top of `<body>` in `app/layout.tsx` |
| motion/react bridge | `components/motion-provider.tsx` — System → `"user"`, Full → `"never"`, Reduced → `"always"` |
| CSS bridge | `@custom-variant motion-reduce` / `motion-safe` at the top of `app/globals.css` |
| Charts | `useChartSeriesMotion()` in `hooks/use-chart-motion.ts` reads `useMotionReduced()` |
| Enforcement | `eslint.config.mjs`: `no-restricted-imports` on `useReducedMotion` from `motion/react` and `framer-motion`; `no-restricted-syntax` on a `matchMedia` call whose literal argument contains `prefers-reduced-motion` |

## The four compliant paths

A surface that moves must reach the preference through one of these. Anything else reads the OS query only and ignores Full and Reduced.

| Path | Use for |
|---|---|
| A `motion/react` component under `MotionConfig` | Transforms in shared variants. `MotionConfig` drops the transform and keeps opacity |
| `motion-reduce:` / `motion-safe:` classes, or an `@variant motion-reduce` block in `globals.css` | CSS transitions and keyframes, spinners (`motion-safe:animate-spin`), skeletons (`motion-safe:animate-pulse`) |
| `useMotionReduced()` | Render-time decisions `MotionConfig` cannot see: a `grid-template-rows` disclosure, recharts props, a branch that skips a sequence |
| `isMotionReduced()` | Event handlers and imperative code: `useValueTick`'s Web Animations call, a `scrollIntoView` `behavior` |

## Traps

- **motion/react's `useReducedMotion` is OS-only.** It never sees `data-motion`, so a component using it ignores Full and Reduced while every `MotionConfig` sibling obeys them. It is an ESLint error for this reason. `MotionConfig reducedMotion="user"` reads the OS query the same way, which is why `MotionProvider` sets the prop from the `data-motion` attribute rather than leaving it at `"user"`.
- **The lint ban matches a string literal only.** `matchMedia("(prefers-reduced-motion: reduce)")` fails lint; `matchMedia(SOME_CONST)` or a template literal does not. The query string lives as a non-exported constant inside `lib/motion-preference.ts` so nothing else has it to pass.
- **Absent means System. Never write `data-motion="system"`.** The CSS variants key off `"full"` and `"reduced"`; any other value matches neither attribute branch and also blocks nothing, so it happens to behave like System today, but the contract is absence. `applyMotionPreference("system")` removes the attribute. The stored value is the literal `"system"`; only the attribute is absent.
- **The boot script must run before first paint.** An attribute set in a mount effect lands after the first frame, so a Reduced user sees one frame of every entrance. `MotionPreferenceProvider` re-stamps the attribute in its mount effect as a fallback if the script was blocked; that fallback is not pre-paint.
- **The provider hydrates in an effect, so its first render says `"system"`.** `useMotionReduced()` covers that render by reading the attribute through `isMotionReduced()`, which the boot script has already stamped. Code that reads `useMotionPreference().preference` directly sees `"system"` for one render.
- **motion/react fixes `reducedMotion` per element at mount** (`motion-dom` `VisualElement.mount`). `MotionProvider` therefore reads the `data-motion` attribute at render, not the context, so elements present at hydration get the right mode. Elements already on screen keep their mode after a mid-session switch until they remount; this is accepted (a forced remount would drop drafts).
- **Prerender answers "not reduced".** `next.config.ts` is `output: "export"`; both resolvers return `false` with no `window`. Nothing may depend on the prerendered HTML being in its reduced form.
- **Tailwind's stock `motion-reduce:` cannot see an attribute.** It compiles to a bare media query. Both variants are redefined in `globals.css`, each with a media-gated branch that excludes the opposing attribute and an attribute-gated branch. Redefine both or neither: a `motion-safe:` left stock freezes spinners for a user on OS-reduce who chose Full.
- **The tw-animate reduce rule works because it is unlayered.** One `:root { @variant motion-reduce { … } }` block zeroes `--tw-enter-translate-*`, `--tw-exit-translate-*`, `-rotate` and `-blur` and sets `-scale` to 1. tw-animate's slide and zoom utilities sit in a cascade layer, and unlayered declarations beat layered ones regardless of specificity, so no `!important` is needed. The fade (`--tw-enter-opacity`) is untouched. Moving this rule into a layer breaks it silently.
- **vaul's CSS is also unlayered.** The drawer library injects `animation-duration: .5s`, which beats any layered utility the same way. `components/ui/drawer.tsx` therefore writes its timing classes with Tailwind's `!` inside the class string. A `!` added by string interpolation is not in the source text Tailwind scans, so it generates nothing.
- **A late-mounting variant child renders blank.** A `motion.div` with only `variants` waits for its parent's cascade. If it mounts after that cascade ran (an `AnimatePresence` swap, a keyed remount, rows that replace a skeleton), it stays at opacity 0 at full height with no error. Declare `initial="hidden" animate="visible"` on it. This is independent of the preference but is the failure most often mistaken for one.

## Related

- `DESIGN.md` > Motion: the scale, the curves and the named rules.
- The RM520N fork's `dashboard-chart-cards.md` (the two chart clocks and why `MotionConfig` cannot reach recharts) and `dashboard-state-motion.md` (the value tick and `SaveButton`); read them with `git show a05c4e92:docs/reference/<name>.md`.
- [tailwind-prose-hazard.md](tailwind-prose-hazard.md): why the `duration-[var(--duration-standard)]` spelling needs its `var()` wrapper.
