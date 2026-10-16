"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { isMotionReduced } from "@/lib/motion-preference";
import { useSaveFlash } from "@/components/ui/save-button";
import type {
  WatchdogSettings,
  WatchdogSavePayload,
  WatchdogSaveResult,
} from "@/hooks/use-watchdog-settings";
import { isIntInRange, type TierIndex } from "./derive";

// Ladder and Detection each commit their own draft. The CGI writes only the
// keys a POST carries, so a card sends its own fields and nothing else: the
// other card's half-edit, and a cadence another page changed, both survive.

/** Probe cadence options (seconds); every ping profile's own interval is one. */
export const PROBE_INTERVAL_OPTIONS = [1, 2, 5, 10, 15, 30] as const;

/** A callback-ref factory: the form owns the map, a card registers into it. */
export type RegisterField = (id: string) => (el: HTMLElement | null) => void;

export type WatchdogScope = "ladder" | "detection";

/** The validated controls, by the id they register under. */
export const FIELD_ID = {
  probeInterval: "watchdog-probe-interval",
  failThreshold: "watchdog-fail-threshold",
  cooldown: "watchdog-cooldown",
  qualityConsecutive: "watchdog-quality-consecutive",
  ssrGrace: "watchdog-ssr-grace",
  backupSim: "watchdog-backup-slot",
  recheckInterval: "watchdog-recheck-interval",
  maxReboots: "watchdog-max-reboots",
} as const;

export interface WatchdogFormErrors {
  probeInterval: string | null;
  failThreshold: string | null;
  cooldown: string | null;
  qualityConsecutive: string | null;
  ssrGrace: string | null;
  backupSim: string | null;
  recheckInterval: string | null;
  maxReboots: string | null;
}

/** Reading order per card, which is also the order a blocked save walks them in. */
const SCOPE_FIELDS = {
  ladder: ["backupSim", "recheckInterval", "maxReboots"],
  detection: [
    "probeInterval",
    "failThreshold",
    "cooldown",
    "qualityConsecutive",
    "ssrGrace",
  ],
} as const satisfies Record<WatchdogScope, readonly (keyof WatchdogFormErrors)[]>;

/** A blocked save names the FIELD by its visible label. */
export const FIELD_LABEL_KEY: Record<keyof WatchdogFormErrors, string> = {
  probeInterval: "watchdog.detection.probe.label",
  failThreshold: "watchdog.detection.threshold.label",
  cooldown: "watchdog.detection.cooldown.label",
  qualityConsecutive: "watchdog.detection.quality.label",
  ssrGrace: "watchdog.detection.ssr.label",
  backupSim: "watchdog.ladder.tier3.slotLabel",
  recheckInterval: "watchdog.ladder.failback.name",
  maxReboots: "watchdog.ladder.tier4.capLabel",
};

/** Every field the two cards edit. Numbers stay strings while typed. */
export interface WatchdogDraft {
  enabled: boolean;
  tier1: boolean;
  tier2: boolean;
  tier3: boolean;
  tier4: boolean;
  backupSlot: string;
  recheck: boolean;
  recheckInterval: string;
  maxReboots: string;
  probeInterval: string;
  failThreshold: string;
  cooldown: string;
  quality: boolean;
  qualityConsecutive: string;
  ssrAware: boolean;
  ssrGrace: string;
}

const SCOPE_KEYS = {
  ladder: [
    "enabled",
    "tier1",
    "tier2",
    "tier3",
    "tier4",
    "backupSlot",
    "recheck",
    "recheckInterval",
    "maxReboots",
  ],
  detection: [
    "probeInterval",
    "failThreshold",
    "cooldown",
    "quality",
    "qualityConsecutive",
    "ssrAware",
    "ssrGrace",
  ],
} as const satisfies Record<WatchdogScope, readonly (keyof WatchdogDraft)[]>;

export interface ScopeState {
  dirty: boolean;
  /** Fields blocking this card's save, in reading order. */
  blockedFields: (keyof WatchdogFormErrors)[];
  isSaving: boolean;
  /** Either card is saving; one save at a time. */
  busy: boolean;
  saved: boolean;
  submit: () => Promise<void>;
  discard: () => void;
  /** Focus and reveal the first blocking control. No-op when nothing blocks. */
  focusFirstBlocked: () => void;
}

export interface WatchdogForm {
  /** The draft both cards render: saved truth overlaid with unsaved edits. */
  draft: WatchdogDraft;
  setFields: (patch: Partial<WatchdogDraft>) => void;
  errors: WatchdogFormErrors;
  scopes: Record<WatchdogScope, ScopeState>;
  /** Newly lets the watchdog reboot unattended; keyed on master AND tier 4 (stock ships tier 4 armed, master off). */
  grantsRebootAuthority: boolean;
  registerField: RegisterField;
}

interface UseWatchdogFormArgs {
  settings: WatchdogSettings;
  isSaving: boolean;
  saveSettings: (payload: WatchdogSavePayload) => Promise<WatchdogSaveResult>;
}

const savedDraft = (s: WatchdogSettings): WatchdogDraft => ({
  enabled: s.enabled,
  tier1: s.tier1_enabled,
  tier2: s.tier2_enabled,
  tier3: s.tier3_enabled,
  tier4: s.tier4_enabled,
  backupSlot: s.backup_sim_slot != null ? String(s.backup_sim_slot) : "",
  recheck: s.primary_recheck_enabled,
  recheckInterval: String(s.primary_recheck_interval),
  maxReboots: String(s.max_reboots_per_hour),
  probeInterval: String(s.probe_interval),
  failThreshold: String(s.fail_threshold),
  cooldown: String(s.cooldown),
  quality: s.quality_enabled,
  qualityConsecutive: String(s.quality_consecutive),
  ssrAware: s.ssr_aware,
  ssrGrace: String(s.ssr_grace),
});

const int = (raw: string) => parseInt(raw, 10);

/** Only the card's own keys go on the wire. */
const toPayload = (
  scope: WatchdogScope,
  d: WatchdogDraft,
): WatchdogSavePayload =>
  scope === "ladder"
    ? {
        action: "save_settings",
        enabled: d.enabled,
        tier1_enabled: d.tier1,
        tier2_enabled: d.tier2,
        tier3_enabled: d.tier3,
        tier4_enabled: d.tier4,
        backup_sim_slot: d.backupSlot ? int(d.backupSlot) : null,
        primary_recheck_enabled: d.recheck,
        primary_recheck_interval: int(d.recheckInterval),
        max_reboots_per_hour: int(d.maxReboots),
      }
    : {
        action: "save_settings",
        // An unchanged value writes nothing on the CGI side.
        probe_interval: int(d.probeInterval),
        fail_threshold: int(d.failThreshold),
        cooldown: int(d.cooldown),
        quality_enabled: d.quality,
        quality_consecutive: int(d.qualityConsecutive),
        ssr_aware: d.ssrAware,
        ssr_grace: int(d.ssrGrace),
      };

const omit = (
  edits: Partial<WatchdogDraft>,
  keys: readonly (keyof WatchdogDraft)[],
): Partial<WatchdogDraft> => {
  const next = { ...edits };
  for (const k of keys) delete next[k];
  return next;
};

/** A number field's error key: empty is caught separately as "required". */
const rangeError = (raw: string, min: number, max: number, key: string) =>
  raw.trim() !== "" && !isIntInRange(raw, min, max) ? key : null;

export function useWatchdogForm({
  settings,
  isSaving,
  saveSettings,
}: UseWatchdogFormArgs): WatchdogForm {
  const { t } = useTranslation("monitoring");
  const ladderFlash = useSaveFlash();
  const detectionFlash = useSaveFlash();

  // Edits overlay server truth, so a re-read never eats a typed value and one
  // card's save leaves the other card's half-edit alone.
  const [edits, setEdits] = useState<Partial<WatchdogDraft>>({});
  const [savingScope, setSavingScope] = useState<WatchdogScope | null>(null);

  const saved = useMemo(() => savedDraft(settings), [settings]);
  const draft = useMemo<WatchdogDraft>(() => ({ ...saved, ...edits }), [saved, edits]);

  const setFields = useCallback((patch: Partial<WatchdogDraft>) => {
    setEdits((prev) => ({ ...prev, ...patch }));
  }, []);

  // Values are i18n KEYS; the rendering component translates them. The ranges
  // mirror the CGI's validate_int bounds.
  const errors = useMemo<WatchdogFormErrors>(
    () => ({
      probeInterval: rangeError(draft.probeInterval, 1, 60, "watchdog.errors.probeInterval"),
      failThreshold: rangeError(draft.failThreshold, 1, 20, "watchdog.errors.failThreshold"),
      cooldown: rangeError(draft.cooldown, 10, 300, "watchdog.errors.cooldown"),
      qualityConsecutive: draft.quality
        ? rangeError(draft.qualityConsecutive, 1, 60, "watchdog.errors.qualityConsecutive")
        : null,
      ssrGrace: draft.ssrAware
        ? rangeError(draft.ssrGrace, 10, 120, "watchdog.errors.ssrGrace")
        : null,
      // An unset slot leaves the ladder unable to fail over, so it blocks.
      backupSim:
        draft.tier3 && !draft.backupSlot ? "watchdog.errors.backupSim" : null,
      recheckInterval:
        draft.tier3 && draft.recheck
          ? rangeError(draft.recheckInterval, 5, 1440, "watchdog.errors.recheckInterval")
          : null,
      maxReboots: draft.tier4
        ? rangeError(draft.maxReboots, 1, 10, "watchdog.errors.maxReboots")
        : null,
    }),
    [draft],
  );

  // An empty number field the CGI would receive as NaN still blocks. A field
  // whose switch is off is still sent, so it must hold a number too.
  const emptyRequired: Record<keyof WatchdogFormErrors, boolean> = {
    probeInterval: draft.probeInterval.trim() === "",
    failThreshold: draft.failThreshold.trim() === "",
    cooldown: draft.cooldown.trim() === "",
    qualityConsecutive: draft.qualityConsecutive.trim() === "",
    ssrGrace: draft.ssrGrace.trim() === "",
    backupSim: false,
    recheckInterval: draft.recheckInterval.trim() === "",
    maxReboots: draft.maxReboots.trim() === "",
  };

  const blockedFor = (scope: WatchdogScope) =>
    SCOPE_FIELDS[scope].filter(
      (key) => errors[key] !== null || emptyRequired[key],
    );
  const dirtyFor = (scope: WatchdogScope) =>
    SCOPE_KEYS[scope].some((k) => draft[k] !== saved[k]);

  const grantsRebootAuthority =
    draft.enabled && draft.tier4 && !(settings.enabled && settings.tier4_enabled);

  // A ref, because nothing renders off it.
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  const registerField = useCallback<RegisterField>(
    (id) => (el) => {
      fieldRefs.current[id] = el;
    },
    [],
  );

  const focusField = (key: keyof WatchdogFormErrors) => {
    const host = fieldRefs.current[FIELD_ID[key]];
    if (!host) return;
    // A segmented control registers its wrapper; focus its first visible segment.
    const el = host.matches("input, button")
      ? host
      : Array.from(host.querySelectorAll<HTMLElement>("input, button")).find(
          (n) => n.getClientRects().length > 0 && !n.hasAttribute("disabled"),
        );
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({
      block: "center",
      behavior: isMotionReduced() ? "auto" : "smooth",
    });
  };

  const submitScope = async (scope: WatchdogScope) => {
    if (!dirtyFor(scope) || blockedFor(scope).length > 0 || isSaving) return;

    setSavingScope(scope);
    // The RESULT carries the backend's reason; hook `error` state would be stale here.
    const result = await saveSettings(toPayload(scope, draft));
    setSavingScope(null);
    if (result.ok) {
      setEdits((prev) => omit(prev, SCOPE_KEYS[scope]));
      (scope === "ladder" ? ladderFlash : detectionFlash).markSaved();
      toast.success(t("watchdog.save.toastOk"));
    } else {
      toast.error(t("watchdog.save.toastFail"), {
        description: result.message ?? undefined,
      });
    }
  };

  const scopeState = (scope: WatchdogScope): ScopeState => ({
    dirty: dirtyFor(scope),
    blockedFields: blockedFor(scope),
    isSaving: isSaving && savingScope === scope,
    busy: isSaving,
    saved: (scope === "ladder" ? ladderFlash : detectionFlash).saved,
    submit: () => submitScope(scope),
    discard: () => setEdits((prev) => omit(prev, SCOPE_KEYS[scope])),
    focusFirstBlocked: () => {
      const first = blockedFor(scope)[0];
      if (first) focusField(first);
    },
  });

  return {
    draft,
    setFields,
    errors,
    scopes: { ladder: scopeState("ladder"), detection: scopeState("detection") },
    grantsRebootAuthority,
    registerField,
  };
}

/** Tier on/off by index, for the rungs and the timeline. */
export const draftTiers = (d: WatchdogDraft): Record<TierIndex, boolean> => ({
  1: d.tier1,
  2: d.tier2,
  3: d.tier3,
  4: d.tier4,
});
