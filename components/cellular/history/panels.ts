// =============================================================================
// panels.ts — which panels a reader shows, as a per-viewer preference
// =============================================================================
// Whether a panel is on is a DISPLAY preference, not device state: no write
// endpoint, no round-trip, and one browser's choice never reformats the page
// for anyone else. So it lives in `localStorage`, exactly as greenpacket's
// History page keeps its own panel picker.
//
// THE MERGE IS THE LOAD-BEARING PART. A stored object is merged ONTO the
// defaults rather than trusted wholesale: a panel added in a later build must
// appear at its own default, not vanish because an older payload never
// mentioned it. That is why `mergePanels` walks the current id list instead of
// `Object.assign`-ing whatever was found.
//
// The availability hero is NOT in this list. It is the page's answer, not a
// panel — hiding it would leave a page about 5G availability with no statement
// about 5G availability on it.
// =============================================================================

export const PANEL_IDS = [
  "pattern",
  "timeline",
  "carriers",
  "rf",
  "agg",
  "phy",
  "congestion",
  "antennas",
  "quality",
  "events",
  "outages",
  "identity",
  "system",
] as const;

export type PanelId = (typeof PANEL_IDS)[number];

export type PanelVisibility = Record<PanelId, boolean>;

/**
 * The first impression. The panels that answer the field complaint ("5G
 * disappears at night, on which band") and the ones that explain WHY a link is
 * slow - every carrier, the PHY the radio negotiated, this device's share of the
 * carrier, the antenna balance - are on. What stays opt-in is what is
 * context rather than cause: the per-outage table, the identity grid, device
 * load, and connection quality (which the dashboard already carries).
 */
export const PANEL_DEFAULT: PanelVisibility = {
  pattern: true,
  timeline: true,
  carriers: true,
  rf: true,
  agg: true,
  phy: true,
  congestion: true,
  antennas: true,
  quality: false,
  events: true,
  outages: false,
  identity: false,
  system: false,
};

/**
 * Versioned and app-scoped, like the other `qmanager.*` browser preferences.
 *
 * BUMPED TO v2 with history-v3, deliberately: a v1 object stored `phy: false`
 * because PHY was opt-in then, and merging it onto the new defaults would keep
 * the very panel this release rebuilt hidden for everyone who had visited. The
 * v1 key is simply no longer read (there is nothing worth migrating - a
 * visibility map is a handful of booleans, and the removed `bands` id has no
 * successor with the same meaning). Unknown ids inside a v2 object - a panel
 * removed in a later build - are ignored by `mergePanels`, which walks the
 * CURRENT id list.
 *
 * Not bumped when a panel is ADDED: the merge hands it its own default.
 */
const STORAGE_KEY = "qmanager.cell_history.panels.v2";

/**
 * Stored choices merged onto the defaults. `unknown` input, because a stored
 * payload is not typed: a value that is not a boolean is simply not evidence.
 */
export function mergePanels(saved: unknown): PanelVisibility {
  const merged: PanelVisibility = { ...PANEL_DEFAULT };
  if (saved === null || typeof saved !== "object") return merged;
  const record = saved as Record<string, unknown>;
  for (const id of PANEL_IDS) {
    const value = record[id];
    if (typeof value === "boolean") merged[id] = value;
  }
  return merged;
}

/** The reader's stored choice, or the defaults on a first visit. */
export function loadPanels(): PanelVisibility {
  if (typeof window === "undefined") return { ...PANEL_DEFAULT };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...PANEL_DEFAULT };
    return mergePanels(JSON.parse(raw) as unknown);
  } catch {
    // Private mode, quota, or a hand-edited value: the defaults still answer.
    return { ...PANEL_DEFAULT };
  }
}

/** Best-effort persist. A read-only browser simply does not remember. */
export function savePanels(visibility: PanelVisibility): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility));
  } catch {
    // Quota exceeded or storage disabled — the choice still holds for this tab.
  }
}

export function shownPanelCount(visibility: PanelVisibility): number {
  return PANEL_IDS.filter((id) => visibility[id]).length;
}
