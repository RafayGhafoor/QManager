"use client";

import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { Tag } from "@/components/ui/tag";
import {
  ANTENNA_WARN_DB,
  antennaHealth,
  type AntennaVerdict,
} from "@/lib/antenna-health";
import { ANTENNA_PORTS } from "@/types/modem-status";
import type { AntennaSeries, CellHistorySuccess } from "@/types/cell-history";
import { cn } from "@/lib/utils";

import {
  buildRows,
  formatValue,
  hasReading,
  valuesOf,
  type ChartFrame,
} from "./chart-data";
import { METRIC_AXIS, yDomain } from "./derive";
import { PanelEmpty } from "./empty-state";
import type { PlotSeries } from "./history-chart";
import { LazyHistoryChart } from "./lazy-chart";
import { SeriesKey } from "./series-key";
import {
  ANTENNA,
  CARD,
  DASHES,
  FULL,
  HEAD,
  SERIES_TONE,
} from "./shapes";

// =============================================================================
// AntennasCard — the four receive chains, side by side, per radio
// =============================================================================
// Each radio gets one chart with up to four RSRP lines, one per antenna port in
// `ANTENNA_PORTS` order. The ports see the SAME cell, so they should track each
// other within a few dB; a port that rides 30 dB under its siblings is a cable
// or a connector, not a channel effect, and this is the chart where that shows.
//
// The four lines are one hue (`--spatial` is the colour of antennas) and are
// told apart by shade AND dash, never by hue alone. The legend names each port
// by its real name (Main, Diversity, MIMO 3, MIMO 4) with its window median and
// how far below the best port it sits.
//
// THE VERDICT IS `antennaHealth`, NOT A SECOND IMPLEMENTATION. The badge is
// computed from the per-port window medians through the shared library, so this
// card, the dashboard rail and the antenna statistics page can never disagree
// about what "balanced" means. Colour is never the only carrier: the badge has
// a glyph and a sentence naming the ports.
// =============================================================================

/** Port -> stroke. Two shades of the spatial hue, then the same two fainter. */
const PORT_STYLE = [
  { color: SERIES_TONE.spatial, dash: DASHES[0], opacity: 1 },
  { color: SERIES_TONE.spatialFill, dash: DASHES[1], opacity: 1 },
  { color: SERIES_TONE.spatial, dash: DASHES[2], opacity: 0.65 },
  { color: SERIES_TONE.spatialFill, dash: DASHES[3], opacity: 0.65 },
] as const;

const TECHS = ["LTE", "NR"] as const;

const VERDICT_BADGE: Record<
  AntennaVerdict,
  { variant: "success" | "warning" | "destructive" | "muted"; glyph: "check_circle" | "warning" | "error" | "help" }
> = {
  ok: { variant: "success", glyph: "check_circle" },
  warning: { variant: "warning", glyph: "warning" },
  destructive: { variant: "destructive", glyph: "error" },
  unknown: { variant: "muted", glyph: "help" },
};

function portLabel(port: number): string {
  const entry = ANTENNA_PORTS[port];
  return entry ? `${entry.name} (${entry.rx})` : `ANT${port}`;
}

export interface AntennasCardProps {
  data: CellHistorySuccess;
  frame: ChartFrame;
}

export function AntennasCard({ data, frame }: AntennasCardProps) {
  const { t, i18n } = useTranslation("cellular");

  const byTech = (tech: (typeof TECHS)[number]): AntennaSeries[] =>
    data.antennas.filter((item) => item.tech === tech);

  const medians = (tech: (typeof TECHS)[number]): (number | null)[] =>
    [0, 1, 2, 3].map(
      (port) => byTech(tech).find((item) => item.port === port)?.median ?? null,
    );

  const health = antennaHealth(medians("LTE"), medians("NR"));
  const weakPorts = [
    ...new Set([...health.lte.weak_ports, ...health.nr.weak_ports]),
  ].sort((a, b) => a - b);

  const names = (() => {
    const list = weakPorts.map(portLabel);
    try {
      return new Intl.ListFormat(i18n.language, {
        style: "long",
        type: "conjunction",
      }).format(list);
    } catch {
      return list.join(", ");
    }
  })();

  const badge = VERDICT_BADGE[health.verdict];
  const verdictText =
    health.verdict === "destructive"
      ? t("history.antennas.verdict_destructive", { ports: names })
      : health.verdict === "warning"
        ? t("history.antennas.verdict_warning", { ports: names })
        : health.verdict === "ok"
          ? t("history.antennas.verdict_ok")
          : t("history.antennas.verdict_unknown");

  const blocks = TECHS.map((tech) => ({ tech, series: byTech(tech) })).filter(
    (block) => block.series.length > 0,
  );

  return (
    <section className={cn(CARD, FULL)}>
      <header className={HEAD.ROOT}>
        <h2 className={HEAD.TITLE}>{t("history.antennas.title")}</h2>
        <p className={HEAD.DESC}>{t("history.antennas.description")}</p>
      </header>

      {blocks.length === 0 ? (
        <PanelEmpty icon="settings_input_antenna" body={t("history.antennas.empty")} />
      ) : (
        <>
          <div className={ANTENNA.VERDICT_ROW}>
            <Badge
              variant={badge.variant}
              className="h-auto whitespace-normal py-1 text-start"
            >
              <MaterialSymbol name={badge.glyph} size={12} />
              {verdictText}
            </Badge>
          </div>

          <div className={ANTENNA.BLOCKS}>
            {blocks.map(({ tech, series }) => {
              const axis = METRIC_AXIS.rsrp;
              const rows = buildRows(
                series.map((item) => ({
                  key: `p${item.port}`,
                  points: item.rsrp,
                })),
                frame.bucketSec,
              );

              const drawn = series.filter((item) => hasReading(rows, `p${item.port}`));
              const techHealth = tech === "LTE" ? health.lte : health.nr;

              const plots: PlotSeries[] = drawn.map((item) => {
                const style = PORT_STYLE[item.port];
                return {
                  key: `p${item.port}`,
                  label: portLabel(item.port),
                  color: style.color,
                  dash: style.dash,
                  opacity: style.opacity,
                  unit: axis.unit,
                  decimals: axis.decimals,
                };
              });

              const domain = yDomain(
                axis.domain,
                valuesOf(
                  rows,
                  plots.map((plot) => plot.key),
                ),
              );

              const techName =
                tech === "LTE"
                  ? t("history.charts.series.lte")
                  : t("history.charts.series.nr");

              return (
                <div key={tech} className={ANTENNA.BLOCK}>
                  <div className={ANTENNA.BLOCK_TITLE}>
                    <Tag variant={tech === "LTE" ? "lte" : "nr"}>{techName}</Tag>
                    <span>{t("history.charts.metric.rsrp")}</span>
                    <span className="text-[0.6875rem]">{axis.unit}</span>
                  </div>

                  <SeriesKey
                    ariaLabel={t("history.antennas.key_aria", { tech: techName })}
                    items={drawn.map((item) => {
                      const style = PORT_STYLE[item.port];
                      const deficit = techHealth.deficit_db[item.port];
                      const median =
                        item.median === null
                          ? "—"
                          : `${formatValue(item.median, axis.decimals)} ${axis.unit}`;
                      return {
                        key: `p${item.port}`,
                        label: portLabel(item.port),
                        color: style.color,
                        dash: style.dash,
                        opacity: style.opacity,
                        value:
                          deficit !== null && deficit >= ANTENNA_WARN_DB
                            ? `${median} · ${t("history.antennas.below", { db: deficit })}`
                            : median,
                      };
                    })}
                  />

                  {plots.length === 0 ? (
                    <PanelEmpty icon="settings_input_antenna" body={t("history.charts.no_data")} />
                  ) : (
                    <LazyHistoryChart
                      {...frame}
                      rows={rows}
                      series={plots}
                      leftDomain={domain}
                      leftUnit={axis.unit}
                      ariaLabel={`${techName} ${t("history.antennas.title")}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export default AntennasCard;
