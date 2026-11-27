"use client";

import { useTranslation } from "react-i18next";

import { qualityStrokeVar } from "@/components/cellular/signal-quality-display";
import { cn } from "@/lib/utils";

import type { AvailabilityTier } from "./derive";
import { RESTART_MARK } from "./history-chart-marks";
import { SeriesSwatch } from "./series-key";
import { LEGEND, STRIP, TIER } from "./shapes";

// =============================================================================
// Legend — how to read this page, stated once, in one strip
// =============================================================================
// Three groups, each one a fact the panels below rely on and none of them a
// restatement of a panel's own key (every chart names its own series):
//
//   availability  the four stops of the hero strip, drawn with `TIER`'s own fill
//                 AND height. Imported, not restated: the strip and this key are
//                 the same map, so they cannot drift into two vocabularies for
//                 the same four states. Height matters for the reason
//                 `shapes.ts` gives - the stops are a lightness staircase and
//                 the ladder must be legible in greyscale.
//   restarts      the dashed vertical marks every chart carries, by cause. Drawn
//                 from `RESTART_MARK`, the same map the charts read, and shown
//                 only when the window actually holds a restart: a key for a
//                 mark that appears nowhere is a false statement about the page.
//   quality       the three inks a graded line takes (quality-grade.ts): the
//                 same ramp tokens as the meters, so "red" on a chart and on a
//                 dashboard bar mean one thing.
//   marks         the two plain claims that apply to every panel (a break in a
//                 line is a gap, never zero; one sample a minute).
//
// NOT A CARD. It sits between the controls and the panels, so it may not carry
// a surface or a shadow - a card there would read as the first panel. It
// declares its own container because its groups reflow on the PAGE COLUMN's
// width, not the window's.
// =============================================================================

const TIERS: readonly AvailabilityTier[] = ["up", "partial", "down", "unknown"];

const QUALITY = [
  { id: "good", ink: qualityStrokeVar("good") },
  { id: "fair", ink: qualityStrokeVar("fair") },
  { id: "poor", ink: qualityStrokeVar("poor") },
] as const;

/** Which restart causes the window actually contains, in a stable order. */
const CAUSES = ["restart", "power_loss", "planned", "unknown"] as const;

export interface LegendProps {
  /** Causes present in the window; an empty list hides the restart group. */
  restartCauses: readonly (typeof CAUSES)[number][];
}

export function Legend({ restartCauses }: LegendProps) {
  const { t } = useTranslation("cellular");
  const shown = CAUSES.filter((cause) => restartCauses.includes(cause));

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
                {t(`history.availability.legend.${tier}`)}
              </li>
            ))}
          </ul>
        </div>

        <div className={LEGEND.GROUP}>
          <h3 className={LEGEND.GROUP_LABEL}>{t("history.legend.quality")}</h3>
          <ul className={LEGEND.ITEMS}>
            {QUALITY.map((item) => (
              <li key={item.id} className={LEGEND.ITEM}>
                <SeriesSwatch color={item.ink} />
                {t(`history.legend.quality_${item.id}`)}
              </li>
            ))}
          </ul>
        </div>

        {shown.length > 0 ? (
          <div className={LEGEND.GROUP}>
            <h3 className={LEGEND.GROUP_LABEL}>{t("history.legend.restarts")}</h3>
            <ul className={LEGEND.ITEMS}>
              {shown.map((cause) => (
                <li key={cause} className={LEGEND.ITEM}>
                  <SeriesSwatch
                    color={RESTART_MARK[cause].stroke}
                    dash={RESTART_MARK[cause].dash}
                  />
                  {t(`history.restart.cause.${cause}`)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className={LEGEND.NOTES}>
        <p className={LEGEND.NOTE}>{t("history.legend.gap")}</p>
        <p className={LEGEND.NOTE}>{t("history.legend.quality_note")}</p>
        <p className={LEGEND.NOTE}>{t("history.legend.cadence")}</p>
      </div>
    </section>
  );
}

export default Legend;
