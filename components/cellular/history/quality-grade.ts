// =============================================================================
// quality-grade.ts — colour a reading by how good it is, at every instant
// =============================================================================
// A graded series draws its stroke in the quality ramp (`qualityStrokeVar`, the
// same tokens the meters and numerals use), so a stretch of bad SINR is red
// where it happened and a recovery turns green again. Identity (which carrier,
// which antenna, LTE vs NR) stays on the dash pattern and the label, never on
// the hue of a graded line.
//
// Thresholds:
//  * RSRP / RSRQ / SINR / latency: the app's own thresholds (types/modem-status),
//    so a chart and the dashboard meter can never disagree about "fair".
//  * Everything else: product brackets, not standards - CQI 7 is where 16QAM
//    starts, MCS 10/20 roughly separate QPSK / 16-64QAM / 256QAM operation, a
//    TX power within ~3 dB of the 23 dBm class limit means the uplink is out of
//    headroom (cell edge), loss above 2 % is felt by real-time traffic.
// =============================================================================

import {
  LATENCY_THRESHOLDS,
  RSRP_THRESHOLDS,
  RSRQ_THRESHOLDS,
  SINR_THRESHOLDS,
  type SignalQuality,
  type SignalThresholds,
} from "@/types/modem-status";
import { qualityStrokeVar } from "@/components/cellular/signal-quality-display";

/**
 * `higher`: value >= excellent is excellent, >= good is good, >= fair is fair,
 * below is poor. `lower`: value <= excellent is excellent, <= good ..., above
 * fair is poor.
 */
export interface Grade {
  dir: "higher" | "lower";
  excellent: number;
  good: number;
  fair: number;
}

const fromSignal = (t: SignalThresholds): Grade => ({
  dir: "higher",
  excellent: t.excellent,
  good: t.good,
  fair: t.fair,
});

export const GRADES = {
  rsrp: fromSignal(RSRP_THRESHOLDS),
  rsrq: fromSignal(RSRQ_THRESHOLDS),
  sinr: fromSignal(SINR_THRESHOLDS),
  lte_cqi: { dir: "higher", excellent: 12, good: 10, fair: 7 },
  nr_cqi: { dir: "higher", excellent: 12, good: 10, fair: 7 },
  lte_mcs: { dir: "higher", excellent: 24, good: 20, fair: 10 },
  nr_mcs: { dir: "higher", excellent: 24, good: 20, fair: 10 },
  ul_mcs: { dir: "higher", excellent: 24, good: 20, fair: 10 },
  tx_power: { dir: "lower", excellent: 5, good: 12, fair: 20 },
  nr_tx_power: { dir: "lower", excellent: 5, good: 12, fair: 20 },
  lat: {
    dir: "lower",
    excellent: LATENCY_THRESHOLDS.excellent,
    good: LATENCY_THRESHOLDS.good,
    fair: LATENCY_THRESHOLDS.fair,
  },
  jit: { dir: "lower", excellent: 5, good: 15, fair: 30 },
  loss: { dir: "lower", excellent: 0, good: 0.5, fair: 2 },
  temp: { dir: "lower", excellent: 50, good: 60, fair: 75 },
  cpu: { dir: "lower", excellent: 50, good: 70, fair: 90 },
  mem: { dir: "lower", excellent: 60, good: 80, fair: 92 },
} as const satisfies Record<string, Grade>;

export type GradedMetric = keyof typeof GRADES;

export function gradeFor(metric: string): Grade | undefined {
  return (GRADES as Record<string, Grade>)[metric];
}

export function gradeQuality(value: number | null | undefined, grade: Grade): SignalQuality {
  if (value === null || value === undefined || !Number.isFinite(value)) return "none";
  if (grade.dir === "higher") {
    if (value >= grade.excellent) return "excellent";
    if (value >= grade.good) return "good";
    if (value >= grade.fair) return "fair";
    return "poor";
  }
  if (value <= grade.excellent) return "excellent";
  if (value <= grade.good) return "good";
  if (value <= grade.fair) return "fair";
  return "poor";
}

/** The stroke/fill colour of one reading. */
export function gradeColor(value: number | null | undefined, grade: Grade): string {
  return qualityStrokeVar(gradeQuality(value, grade));
}

export interface GradientStop {
  offset: number;
  color: string;
}

/**
 * Hard-stop stops for a vertical `objectBoundingBox` gradient over a series
 * whose plotted values span [min, max] (offset 0 = the top = max). Each
 * threshold strictly inside the span gets two stops at the same offset, so the
 * colour changes exactly where the line crosses it. Returns null when the span
 * is degenerate (a flat line has a zero-height box, which an objectBoundingBox
 * gradient cannot paint) - the caller then uses one solid colour.
 */
export function gradientStops(
  min: number,
  max: number,
  grade: Grade,
): GradientStop[] | null {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-9) return null;
  const span = max - min;
  const cuts = [grade.excellent, grade.good, grade.fair]
    .filter((c) => c > min && c < max)
    .sort((a, b) => b - a); // top (high values) first
  const stops: GradientStop[] = [];
  let upper = max;
  for (const cut of cuts) {
    const offset = (max - cut) / span;
    // colour of the band just above the cut (between cut and `upper`)
    const above = gradeColor((upper + cut) / 2, grade);
    const below = gradeColor(cut - span * 1e-6, grade);
    // For "lower is better" the band exactly AT a threshold belongs below the
    // cut's open side; the midpoint test above already resolves both sides.
    stops.push({ offset, color: above }, { offset, color: below });
    upper = cut;
  }
  stops.unshift({ offset: 0, color: gradeColor(max, grade) });
  stops.push({ offset: 1, color: gradeColor(min, grade) });
  return stops;
}
