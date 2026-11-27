// =============================================================================
// antenna-health.ts — per-port RSRP imbalance verdict (history-v3)
// =============================================================================
// A receive chain that sits far below its siblings on the SAME band is not a
// channel effect: the four ports see the same cell. On the X75 this was
// measured at 31-51 dB (RX1/RX2, both LTE B1 and NR n41) — a disconnected or
// damaged feed. The verdict compares each port with the band's best port.
//
// Inputs are RSRP dBm per port in ANTENNA_PORTS order; `null` = not reporting.
// A port that is not reporting is NOT counted as weak (a 2-RX band legitimately
// reports two ports) — only a port that reports a value far below the best.
// =============================================================================

export type AntennaVerdict = "ok" | "warning" | "destructive" | "unknown";

/** dB below the best port at which a port is flagged. */
export const ANTENNA_WARN_DB = 20;
export const ANTENNA_FAULT_DB = 30;

export interface TechAntennaHealth {
  verdict: AntennaVerdict;
  /** Index of the strongest reporting port, or null if none report. */
  best_port: number | null;
  /** Per-port dB below best (0 for best), null when the port is not reporting. */
  deficit_db: (number | null)[];
  /** Ports at or beyond ANTENNA_WARN_DB below best, ascending. */
  weak_ports: number[];
  /** Largest deficit among reporting ports, or null. */
  worst_db: number | null;
}

/** Valid RSRP window; values outside are sentinels (e.g. -140 floor, 0). */
function isValidRsrp(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v < -30 && v > -140;
}

export function techAntennaHealth(
  rsrp: readonly (number | null | undefined)[] | null | undefined,
): TechAntennaHealth {
  const ports = (rsrp ?? []).slice(0, 4);
  let best: number | null = null;
  let bestPort: number | null = null;
  ports.forEach((v, i) => {
    if (isValidRsrp(v) && (best === null || v > best)) {
      best = v;
      bestPort = i;
    }
  });
  if (best === null) {
    return { verdict: "unknown", best_port: null, deficit_db: [null, null, null, null], weak_ports: [], worst_db: null };
  }
  const deficit: (number | null)[] = [0, 1, 2, 3].map((i) => {
    const v = ports[i];
    return isValidRsrp(v) ? Math.round((best as number) - v) : null;
  });
  const reporting = deficit.filter((d): d is number => d !== null);
  // One reporting port cannot be compared with anything.
  if (reporting.length < 2) {
    return { verdict: "unknown", best_port: bestPort, deficit_db: deficit, weak_ports: [], worst_db: null };
  }
  const worst = Math.max(...reporting);
  const weak = deficit
    .map((d, i) => (d !== null && d >= ANTENNA_WARN_DB ? i : -1))
    .filter((i) => i >= 0);
  const verdict: AntennaVerdict =
    worst >= ANTENNA_FAULT_DB ? "destructive" : worst >= ANTENNA_WARN_DB ? "warning" : "ok";
  return { verdict, best_port: bestPort, deficit_db: deficit, weak_ports: weak, worst_db: worst };
}

export interface AntennaHealth {
  lte: TechAntennaHealth;
  nr: TechAntennaHealth;
  /** Worst of the two techs ("unknown" only when both are unknown). */
  verdict: AntennaVerdict;
  /** Ports weak on every tech that reports (the hardware signature), ascending. */
  weak_on_all: number[];
}

const RANK: Record<AntennaVerdict, number> = { unknown: 0, ok: 1, warning: 2, destructive: 3 };

export function antennaHealth(
  lteRsrp: readonly (number | null | undefined)[] | null | undefined,
  nrRsrp: readonly (number | null | undefined)[] | null | undefined,
): AntennaHealth {
  const lte = techAntennaHealth(lteRsrp);
  const nr = techAntennaHealth(nrRsrp);
  const verdict = RANK[lte.verdict] >= RANK[nr.verdict] ? lte.verdict : nr.verdict;
  const known = [lte, nr].filter((t) => t.verdict !== "unknown");
  const weakOnAll =
    known.length === 0
      ? []
      : [0, 1, 2, 3].filter((p) => known.every((t) => t.weak_ports.includes(p)));
  return { lte, nr, verdict, weak_on_all: weakOnAll };
}
