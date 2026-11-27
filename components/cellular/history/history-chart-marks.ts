// =============================================================================
// history-chart-marks.ts — marks shared by the chart and the page legend
// =============================================================================
// Lives apart from `history-chart.tsx` on purpose: that file imports recharts
// and is loaded through `next/dynamic`, and the page legend needs these marks
// in the FIRST paint. Importing them from the chart file would drag the whole
// chart stack into the main chunk.
// =============================================================================

import type { RestartCause } from "@/types/ping-history";

/** Every chart on the page shares this id, so hover is one gesture. */
export const SYNC_ID = "cell-history";

/**
 * One stroke per restart cause: dash AND hue, so it survives greyscale. A power
 * loss and a restart are different faults (a cut supply vs a crash/reset), so
 * they are different marks, not one mark with a different tooltip.
 */
export const RESTART_MARK: Record<
  RestartCause,
  { stroke: string; dash: string }
> = {
  restart: { stroke: "var(--warning)", dash: "5 3" },
  power_loss: { stroke: "var(--destructive)", dash: "8 3 2 3" },
  planned: { stroke: "var(--on-surface-variant)", dash: "3 3" },
  unknown: { stroke: "var(--on-surface-variant)", dash: "1 3" },
};

interface SyncTick {
  value?: number;
}

/**
 * The cross-chart sync rule: put this chart's crosshair at the NEAREST row to
 * the instant the hovered chart is at, within `toleranceMs`.
 *
 * recharts' built-in `syncMethod="value"` matches the hovered x EXACTLY, so two
 * charts whose rows differ by even one synthetic gap row would stop following
 * each other, and `"index"` (the default) matches row NUMBER, which is wrong as
 * soon as the charts have different row counts. Nearest-within-a-bucket is what
 * "the same instant" actually means. Outside the tolerance the answer is -1 (no
 * crosshair): a chart whose data stops early must not pin its last point under
 * a cursor that is hours past it.
 */
export function syncNearest(toleranceMs: number) {
  return (
    ticks: readonly SyncTick[],
    data: { activeLabel?: unknown },
  ): number => {
    const target = data.activeLabel;
    if (typeof target !== "number") return -1;
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < ticks.length; i++) {
      const value = ticks[i].value;
      if (typeof value !== "number") continue;
      const distance = Math.abs(value - target);
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
    return bestDistance <= toleranceMs ? best : -1;
  };
}
