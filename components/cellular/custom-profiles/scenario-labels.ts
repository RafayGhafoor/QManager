import type { TFunction } from "i18next";

import {
  bandsToDisplay,
  optimizationLabelKey,
} from "@/types/connection-scenario";

// =============================================================================
// scenario-labels.ts — the one place a stored scenario token becomes a word
// =============================================================================
// `types/connection-scenario.ts` is a plain constant module with no `t()` in
// scope, so its display helpers return i18n KEYS or `null`. These functions
// take the reader's `t` and finish the job, so a mode / optimization /
// band-lock value is rendered the same way on every surface.
//
// Every `t()` below is called with a VARIABLE key. The index of keys is the
// `MODE_LABEL_KEY` map here and `OPTIMIZATION_LABEL_KEY` in the type module.
// All keys live in the `cellular` namespace.
// =============================================================================

/** AT `mode_pref` value -> `cellular` i18n key (matches NETWORK_MODE_OPTIONS). */
const MODE_LABEL_KEY: Record<string, string> = {
  AUTO: "scenarios.mode_option_auto",
  LTE: "scenarios.mode_option_lte",
  NR5G: "scenarios.mode_option_nrsa",
  "LTE:NR5G": "scenarios.mode_option_nrsa_nsa",
};

/** An AT `mode_pref` value -> its i18n key, or `null` when unrecognised. */
export function modeLabelKey(atModeValue: string): string | null {
  return MODE_LABEL_KEY[atModeValue] ?? null;
}

/**
 * An AT `mode_pref` value -> the reader's word for it. An unrecognised
 * combination falls back to the RAW AT value (honest: the modem said it and
 * this build has no word for it); render it in machine voice.
 */
export function modeLabel(t: TFunction, atModeValue: string): string {
  const key = modeLabelKey(atModeValue);
  return key ? t(key) : atModeValue;
}

/**
 * A stored `optimization` value -> the reader's word for it. Falls back to the
 * stored string verbatim: the edit dialog's field is free text, so anything
 * outside the app's own tokens is the user's word and is never translated.
 */
export function optimizationLabel(t: TFunction, value: string): string {
  const key = optimizationLabelKey(value);
  return key ? t(key) : value;
}

/** A colon-delimited band lock -> "1, 3, 7", or the reader's word for "Auto". */
export function bandsLabel(t: TFunction, colonDelimited: string): string {
  if (!colonDelimited || colonDelimited === "AUTO") {
    return t("scenarios.active_config_card.config_values.bands_auto");
  }
  return bandsToDisplay(colonDelimited);
}
