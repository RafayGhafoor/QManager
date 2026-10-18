// =============================================================================
// connection-scenario.ts — QManager Connection Scenario Types
// =============================================================================
// TypeScript interfaces and default scenario constants for the Connection
// Scenarios feature. Connection Scenarios control radio/RF configuration
// (network mode, band locks) and sit above SIM Profiles in the hierarchy.
//
// SIM Profiles = identity/connectivity (APN, IMEI, TTL/HL)
// Connection Scenarios = radio/RF config (network mode, bands)
//
// Backend contract:
//   Active scenario: /etc/qmanager/active_scenario
//   Activate endpoint: POST /cgi-bin/quecmanager/scenarios/activate.sh
//   Status endpoint:   GET  /cgi-bin/quecmanager/scenarios/active.sh
// =============================================================================

// --- Network Mode Options ----------------------------------------------------

export const NETWORK_MODE_OPTIONS = [
  { label: "Auto", value: "AUTO" },
  { label: "LTE Only", value: "LTE" },
  { label: "5G SA Only", value: "NR5G" },
  { label: "5G SA / NSA", value: "LTE:NR5G" },
] as const;

/** Map AT mode_pref value → display label */
export function modeValueToLabel(atValue: string): string {
  return (
    NETWORK_MODE_OPTIONS.find((o) => o.value === atValue)?.label ?? atValue
  );
}

// --- Optimization tokens -----------------------------------------------------
//
// The built-in scenarios and the create path write fixed English tokens, which
// are ours to translate; a word the user typed in the edit dialog is theirs and
// shows verbatim. The stored string stays the stable token (B5.26), so only the
// DISPLAY goes through this map. The keys live in the `cellular` namespace.

export const OPTIMIZATION_TOKENS = {
  balanced: "Balanced",
  latency: "Latency",
  throughput: "Throughput",
  custom: "Custom",
} as const;

const OPTIMIZATION_LABEL_KEY: Record<string, string> = {
  [OPTIMIZATION_TOKENS.balanced]: "scenarios.default_balanced_name",
  [OPTIMIZATION_TOKENS.latency]: "scenarios.default_gaming_optimization",
  [OPTIMIZATION_TOKENS.throughput]: "scenarios.default_streaming_optimization",
  [OPTIMIZATION_TOKENS.custom]: "scenarios.default_custom_optimization",
};

/**
 * A stored `optimization` value -> its `cellular` i18n key, or `null` when the
 * user typed their own word and the caller should print it unchanged.
 */
export function optimizationLabelKey(value: string): string | null {
  return OPTIMIZATION_LABEL_KEY[value.trim()] ?? null;
}

// --- Band Format Helpers -----------------------------------------------------

import type { TFunction } from "i18next";

/** Colon-delimited storage → comma-separated display ("1:3:7" → "1, 3, 7") */
export function bandsToDisplay(colonDelimited: string, t?: TFunction): string {
  if (!colonDelimited || colonDelimited === "AUTO")
    return t
      ? t("cellular:scenarios.active_config_card.config_values.auto")
      : "Auto";
  return colonDelimited.split(":").join(", ");
}

/** Comma-separated input → colon-delimited storage ("1, 3, 7" → "1:3:7") */
export function inputToBands(commaInput: string): string {
  if (!commaInput.trim()) return "";
  return commaInput
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean)
    .join(":");
}

/** Colon-delimited storage → comma-separated input ("1:3:7" → "1, 3, 7") */
export function bandsToInput(colonDelimited: string): string {
  if (!colonDelimited) return "";
  return colonDelimited.split(":").join(", ");
}

// --- Scenario Data Model -----------------------------------------------------

/** Configuration settings for a connection scenario */
export interface ScenarioConfig {
  /** AT command value for mode_pref: "AUTO" | "LTE" | "NR5G" | "LTE:NR5G" */
  atModeValue: string;
  /**
   * Legacy display label in the language it was saved in. No longer written
   * (B5.26): the UI derives the mode label from `atModeValue`, and `save.sh`
   * strips it. Records saved before that still carry it; never read it.
   */
  mode?: string;
  /**
   * A stable token the app writes (`Balanced`, `Latency`, `Throughput`,
   * `Custom`; see `optimizationLabelKey`) or the user's own free text, shown
   * verbatim. Records saved before B5.26 may hold a translated string.
   */
  optimization: string;
  /** LTE bands, colon-delimited (e.g., "1:3:7:28"). Empty = Auto. */
  lte_bands: string;
  /** NR5G NSA bands, colon-delimited (e.g., "41:78"). Empty = Auto. */
  nsa_nr_bands: string;
  /** NR5G SA bands, colon-delimited (e.g., "41:78"). Empty = Auto. */
  sa_nr_bands: string;
}

/** Full connection scenario definition */
export interface ConnectionScenario {
  /** Unique scenario ID (default: "balanced"|"gaming"|"streaming", custom: "custom-<ts>") */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** SVG pattern type for the card overlay */
  pattern: "balanced" | "gaming" | "streaming" | "custom";
  /** Scenario configuration */
  config: ScenarioConfig;
  /** Whether this is a built-in default (cannot be deleted/edited) */
  isDefault: boolean;
}

// --- Default Scenarios -------------------------------------------------------

export const DEFAULT_SCENARIOS: ConnectionScenario[] = [
  {
    id: "balanced",
    name: "Balanced",
    description: "Auto band selection",
    pattern: "balanced",
    config: {
      atModeValue: "AUTO",
      mode: "Auto",
      optimization: "Balanced",
      lte_bands: "",
      nsa_nr_bands: "",
      sa_nr_bands: "",
    },
    isDefault: true,
  },
  {
    id: "gaming",
    name: "Gaming",
    description: "Low latency, SA priority",
    pattern: "gaming",
    config: {
      atModeValue: "NR5G",
      mode: "5G SA Only",
      optimization: "Latency",
      lte_bands: "",
      nsa_nr_bands: "",
      sa_nr_bands: "",
    },
    isDefault: true,
  },
  {
    id: "streaming",
    name: "Streaming",
    description: "High bandwidth, stable connection",
    pattern: "streaming",
    config: {
      atModeValue: "LTE:NR5G",
      mode: "5G SA / NSA",
      optimization: "Throughput",
      lte_bands: "",
      nsa_nr_bands: "",
      sa_nr_bands: "",
    },
    isDefault: true,
  },
];

// --- API Types ---------------------------------------------------------------

/** Response from GET /cgi-bin/quecmanager/scenarios/active.sh */
export interface ScenarioActiveResponse {
  active_scenario_id: string;
}

/** Response from GET /cgi-bin/quecmanager/scenarios/list.sh */
export interface ScenarioListResponse {
  scenarios: StoredScenario[];
  active_scenario_id: string;
}

/** Stored custom scenario definition (as saved on the backend) */
export interface StoredScenario {
  id: string;
  name: string;
  description: string;
  /**
   * Identity glyph id from `SCENARIO_ICONS` (`scenario-icons.ts`), persisted
   * as a key, never as the glyph. Absent on records saved before B5.25; they
   * resolve to the default glyph.
   */
  icon?: string;
  /** Retired Tailwind gradient (B5.25). Old records may carry it; `save.sh`
   *  strips it on the next save. Never read. */
  gradient?: string;
  config: ScenarioConfig;
}

/** Response from POST /cgi-bin/quecmanager/scenarios/activate.sh */
export interface ScenarioActivateResponse {
  success: boolean;
  id?: string;
  error?: string;
  detail?: string;
}

/** Generic success/error response for save/delete */
export interface ScenarioApiResponse {
  success: boolean;
  id?: string;
  error?: string;
  detail?: string;
}

/**
 * POST body for activation.
 * Default scenarios: only `id` is needed (backend knows the config).
 * Custom scenarios: full config is sent in the body.
 */
export interface ScenarioActivateRequest {
  id: string;
  /** AT mode_pref value — required for custom scenarios */
  mode?: string;
  /** Colon-delimited LTE bands — omit to leave unchanged */
  lte_bands?: string;
  /** Colon-delimited NR NSA bands — omit to leave unchanged */
  nsa_nr_bands?: string;
  /** Colon-delimited NR SA bands — omit to leave unchanged */
  sa_nr_bands?: string;
}
