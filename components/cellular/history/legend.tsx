"use client";

import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { BandCombo } from "@/types/cell-history";

import { METRIC_AXIS, type AvailabilityTier } from "./derive";
import { comboTone, LEGEND, STRIP, TIER } from "./shapes";

// =============================================================================
// Legend — how to read this page, stated once, in one strip
// =============================================================================
// Three swatch groups, each one a fact the panels below rely on and none of them
// a restatement of a panel's own legend:
//
//   availability  the four stops of the hero strip, drawn with `TIER`'s own fill
//                 AND height. Imported, not restated: the strip and this key are
//                 the same map, so they cannot drift into two vocabularies for the
//                 same four states.
//   series        a stroke key drawn as the stroke itself, one entry per tone the
//                 charts below actually plot. Derived from `METRIC_AXIS`, so a
//                 reading moving to another tone changes this key with it.
//   bands         the top three band sets by time share, wearing the tone
//                 `comboTone` gives them. Imported from `shapes`, where the band
//                 card reads it too: two hashes would eventually disagree, and a
//                 legend that lies about which violet is which is worse than none.
//
// Then TWO PLAIN LINES — the gap rule and the cadence. Neither is a swatch,
// because neither is a colour: they are the two claims a reader must hold to read
// any panel correctly, and they apply to the whole page rather than to one group.
//
// NOT A CARD. It sits between the controls and the panels, so it may not carry a
// surface and a shadow — a card there would read as the first panel and push the
// hero down. It does declare its own container, because its groups reflow on the
// PAGE COLUMN's width, not the window's.
// =============================================================================

export interface LegendProps {
  /**
   * Per-combination rollup, most samples first. The key shows the first three; an
   * empty list (no payload yet, or a range where no band was reported) hides the
   * band group rather than showing a colour key with nothing to key.
   */
  combos: BandCombo[];
  /** The poller's cadence, for the second plain line. */
  intervalSec: number;
}

/** How many combinations the key names before it stops being a key and becomes a list. */
const LEGEND_COMBOS = 3;

const TIERS: readonly AvailabilityTier[] = ["up", "partial", "down", "unknown"];

/**
 * The tones the charts below actually draw with, each with the label it is known
 * by. `--chart-lte` is deliberately absent: no entry in `METRIC_AXIS` plots with
 * it, and a key for a stroke that appears nowhere is a false statement about the
 * page.
 */
const SERIES_KEYS = [
  { tone: "var(--chart-nr)", labelKey: "history.legend.series_nr" },
] as const;

/** Which of those tones any plottable reading is on — derived, never hard-coded. */
const PLOTTED_TONES: ReadonlySet<string> = new Set(
  Object.values(METRIC_AXIS).map((axis) => axis.tone),
);

export function Legend({ combos, intervalSec }: LegendProps) {
  const { t } = useTranslation("cellular");
  const top = combos.slice(0, LEGEND_COMBOS);
  const series = SERIES_KEYS.filter((entry) => PLOTTED_TONES.has(entry.tone));

  return (
    <section className={LEGEND.ROOT} aria-label={t("history.legend.legend_aria")}>
      <h2 className={LEGEND.TITLE}>{t("history.legend.title")}</h2>

      <div className={LEGEND.GROUPS}>
        <div className={LEGEND.GROUP}>
          <h3 className={LEGEND.GROUP_LABEL}>{t("history.legend.availability")}</h3>
          <ul className={LEGEND.ITEMS}>
            {TIERS.map((tier) => (
              <li key={tier} className={LEGEND.ITEM}>
                <span className={STRIP.LEGEND_TRACK} aria-hidden="true">
                  <span
                    className={cn(
                      STRIP.LEGEND_SWATCH,
                      TIER[tier].fill,
                      TIER[tier].height,
                    )}
                  />
                </span>
                {t(TIER[tier].labelKey)}
              </li>
            ))}
          </ul>
        </div>

        <div className={LEGEND.GROUP}>
          <h3 className={LEGEND.GROUP_LABEL}>{t("history.legend.series")}</h3>
          <ul className={LEGEND.ITEMS}>
            {series.map((entry) => (
              <li key={entry.labelKey} className={LEGEND.ITEM}>
                <span
                  className={LEGEND.LINE}
                  style={{ backgroundColor: entry.tone }}
                  aria-hidden="true"
                />
                {t(entry.labelKey)}
              </li>
            ))}
          </ul>
        </div>

        {top.length > 0 ? (
          <div className={LEGEND.GROUP}>
            <h3 className={LEGEND.GROUP_LABEL}>{t("history.legend.bands")}</h3>
            <ul className={LEGEND.ITEMS}>
              {top.map((combo) => (
                <li
                  key={`${combo.bands ?? "-"}-${combo.first_ts}`}
                  className={LEGEND.ITEM}
                >
                  <span
                    className={cn(LEGEND.BAND_SWATCH, comboTone(combo.bands).fill)}
                    aria-hidden="true"
                  />
                  {combo.bands ?? t("history.bands.unknown")}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className={LEGEND.NOTES}>
        <p className={LEGEND.NOTE}>{t("history.legend.gap")}</p>
        <p className={LEGEND.NOTE}>
          {t("history.legend.cadence", { seconds: intervalSec })}
        </p>
      </div>
    </section>
  );
}

export default Legend;
