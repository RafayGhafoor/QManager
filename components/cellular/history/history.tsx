"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { CellularPageHeader } from "@/components/cellular/page-header";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SegmentedField } from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { TonalBanner } from "@/components/ui/tonal-banner";
import { useCellHistory } from "@/hooks/use-cell-history";
import {
  CELL_HISTORY_RANGES,
  type CellHistoryRange,
} from "@/types/cell-history";
import { cn } from "@/lib/utils";

import { AntennasCard } from "./antennas-card";
import { AvailabilityCard } from "./availability-card";
import { CarriersCard } from "./carriers-card";
import { ChartCard } from "./chart-card";
import { visibleRestarts, type ChartFrame } from "./chart-data";
import {
  AGG_CHARTS,
  PHY_CHARTS,
  QUALITY_CHARTS,
  RF_CHARTS,
  SYSTEM_CHARTS,
} from "./chart-specs";
import { CongestionCard } from "./congestion-card";
import {
  archiveShort,
  formatMoment,
  identityLagsWindow,
  windowSeconds,
} from "./derive";
import { EventsCard } from "./events-card";
import { IdentityCard } from "./identity-card";
import { Legend } from "./legend";
import { OutagesCard } from "./outages-card";
import { PanelSkeleton } from "./panel-skeleton";
import { PanelsPopover } from "./panels-popover";
import {
  loadPanels,
  savePanels,
  type PanelId,
  type PanelVisibility,
} from "./panels";
import { PatternCard } from "./pattern-card";
import { CONTROLS, FULL, GRID, PAGE_SHELL, STACK } from "./shapes";
import { StatusBanners } from "./status-banners";
import { TimelineCard } from "./timeline-card";

// =============================================================================
// Cell History — what the radio actually did over the selected range
// =============================================================================
// One ranged read, one page of panels, and a few sentences at the top about what
// the archive could and could not see.
//
// NO LIVE BAND AND NO `now` RANGE. The dashboard is the live surface; this page
// reads the archive, whose newest row is up to a minute old. A `now` tab shipped
// once on /monitoring/latency and was deleted because a live view above range
// cards disagrees with them the moment the range's last bucket ages
// (`docs/reference/latency-monitor.md:74`). So the pill offers named ranges
// only, and every card below reads the same window.
//
// THE WINDOW ENDS AT THE WALL CLOCK (history-v3). A recorder that stopped leaves
// an empty tail on every chart and a banner saying why, instead of the old
// behaviour of ending the window at the newest row, which made hours-old data
// look like "the last 24 h". Coverage is therefore read from `recorder` and the
// first/last archived timestamps, never from the window's width.
//
// ONE SHARED HOVER. Every chart on the page carries one sync id and one x
// domain (the payload window), so hovering any instant puts the crosshair and an
// exact-values tooltip at that instant in every chart that has it. Restarts are
// marked on every chart in the same place.
//
// PANELS ARE A VIEWER PREFERENCE. Which panels are on lives in `localStorage`
// (`./panels`); the availability hero is not one of them, because a page about
// 5G availability that can hide its own answer is a settings screen. The stored
// object is merged ONTO the defaults, so a panel added in a later build appears
// at its own default instead of vanishing.
//
// THREE STATES. Loading is a card-shaped skeleton per enabled panel (the loaded
// shell imported, not restated); empty is the recorder's own statement of why
// there is nothing to draw; error keeps the figures already on screen and says
// they are not updating, or - with nothing on screen - offers a retry.
// =============================================================================

/** Range -> its pill label key. The pill offers every range the CGI serves. */
const RANGE_LABEL_KEY = {
  "1h": "history.range.h1",
  "3h": "history.range.h3",
  "6h": "history.range.h6",
  "12h": "history.range.h12",
  "24h": "history.range.h24",
  "7d": "history.range.d7",
  "30d": "history.range.d30",
} satisfies Record<CellHistoryRange, string>;

/**
 * A day, by default: the page's subject is a nightly dropout, and the shortest
 * range that can show one is a night. It is also the shortest range the pattern
 * panel can draw, so the first impression is never a card explaining that it
 * needs a longer range.
 */
const DEFAULT_RANGE: CellHistoryRange = "24h";

function PageSkeleton({ panels }: { panels: PanelVisibility }) {
  // The hero, then one card-shaped placeholder per series panel that is on. The
  // cards that are not charts (events, outages, identity) have no chart box to
  // reserve, so they are not previewed: a placeholder of the wrong height would
  // move the page when it resolved.
  const chartPanels = (
    ["carriers", "rf", "agg", "phy", "congestion", "antennas", "quality", "system"] as const
  ).filter((id) => panels[id]);
  return (
    <div className="flex flex-col gap-5" aria-hidden>
      <Skeleton className={cn(FULL, "h-48 rounded-hero")} />
      {chartPanels.map((id) => (
        <PanelSkeleton key={id} />
      ))}
    </div>
  );
}

export function CellHistory() {
  const { t } = useTranslation("cellular");
  const [range, setRange] = useState<CellHistoryRange>(DEFAULT_RANGE);
  const { data, dataRange, isLoading, error, refresh } = useCellHistory(range);

  // Lazy and guarded: this page is prerendered during the static export, where
  // `window` does not exist. Reading storage in the initialiser (not in an
  // effect) is also what keeps the first client paint from flashing the
  // defaults before the saved choice lands.
  const [panels, setPanels] = useState<PanelVisibility>(() => loadPanels());

  const togglePanel = (id: PanelId) => {
    setPanels((previous) => {
      const next: PanelVisibility = { ...previous, [id]: !previous[id] };
      savePanels(next);
      return next;
    });
  };

  const window = data?.window ?? null;
  const longSpan = window !== null && windowSeconds(window) >= 86_400;
  // The range every payload-shaped decision keys on: `range` moves the moment a
  // pill is clicked, `dataRange` moves when the answer for it lands. Reading the
  // pill instead would price a 30d payload against the 1h just selected.
  const shownRange = dataRange ?? range;
  const rangeLabel = t(RANGE_LABEL_KEY[shownRange]);

  const frame: ChartFrame | null =
    data && window
      ? {
          windowStart: window.start,
          windowEnd: window.end,
          bucketSec: data.bucket_sec,
          longSpan,
          restarts: visibleRestarts(data.restarts, window.start, window.end),
        }
      : null;

  const restartCauses = [
    ...new Set((frame?.restarts ?? []).map((restart) => restart.cause)),
  ];

  // Nothing to draw: the recorder says it has no rows, or the window holds none.
  const nothingRecorded =
    data !== null &&
    window !== null &&
    (data.recorder.state === "empty" || window.samples === 0);

  return (
    <div className={PAGE_SHELL}>
      <CellularPageHeader
        title={t("history.page.title")}
        description={t("history.page.description")}
      />

      <div className={CONTROLS.ROW}>
        <SegmentedField
          value={range}
          onValueChange={(next) => setRange(next)}
          options={CELL_HISTORY_RANGES.map((value) => ({
            value,
            label: t(RANGE_LABEL_KEY[value]),
            numeric: true,
          }))}
          ariaLabel={t("history.range_aria")}
          breakpoint="5xl"
          // The active pill's fill marks it; a check glyph beside a range label
          // would be a second, redundant mark (latency-monitor.md:118).
          glyph={() => null}
        />
        <Button
          type="button"
          variant="tonal-neutral"
          size="sm"
          onClick={refresh}
          disabled={isLoading}
        >
          <MaterialSymbol name="refresh" size={16} />
          {isLoading && !data ? t("history.refreshing") : t("history.refresh")}
        </Button>
        <PanelsPopover visibility={panels} onToggle={togglePanel} />
      </div>

      {data && window !== null ? (
        <StatusBanners
          recorder={data.recorder}
          deviceUtcOffsetMin={data.device_utc_offset_min}
        />
      ) : null}

      {/* Directly under the controls and above every panel, and outside the
          payload branches: what the marks mean does not depend on whether a
          read has landed yet. */}
      <Legend restartCauses={restartCauses} />

      {window !== null && data !== null ? (
        <div className={CONTROLS.NOTES_BLOCK}>
          <div className={CONTROLS.NOTES}>
            <span>{t("history.window.samples", { count: window.samples })}</span>
            {window.first_ts !== null && window.last_ts !== null ? (
              <span>
                {t("history.window.span", {
                  first: formatMoment(window.first_ts),
                  last: formatMoment(window.last_ts),
                })}
              </span>
            ) : null}
          </div>
          {/* An empty window is stated once, below, rather than also being
              called "shorter than requested" - the two say the same thing and
              the shorter one is the less useful sentence. */}
          {window.samples > 0 && archiveShort(window, data.recorder, shownRange) ? (
            <p className={CONTROLS.NOTE}>
              {t("history.window.short", { range: rangeLabel })}
            </p>
          ) : null}
          {data.coverage.cell_from !== null &&
          identityLagsWindow(data.coverage, window) ? (
            <p className={CONTROLS.NOTE}>
              {t("history.window.identity_from", {
                time: formatMoment(data.coverage.cell_from),
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* A failed read with figures already on screen keeps the figures and says
          they are not updating. A failed FIRST read has nothing to keep. */}
      {error && data ? (
        <TonalBanner tone="warning" icon="warning" size="compact" title={t("history.stale")}>
          {t("history.error.read")}
        </TonalBanner>
      ) : null}

      {!data && isLoading ? <PageSkeleton panels={panels} /> : null}

      {!data && !isLoading ? (
        <TonalBanner tone="destructive" icon="error" title={t("history.error.read")}>
          <Button type="button" variant="tonal-neutral" size="sm" onClick={refresh}>
            <MaterialSymbol name="refresh" size={16} />
            {t("history.refresh")}
          </Button>
        </TonalBanner>
      ) : null}

      {data && window !== null && frame !== null ? (
        nothingRecorded ? (
          <TonalBanner tone="info" icon="info">
            {t("history.window.empty")}
          </TonalBanner>
        ) : (
          <div className="flex flex-col gap-5">
            <AvailabilityCard
              buckets={data.cells.availability}
              outages={data.cells.outages}
              window={window}
              longSpan={longSpan}
            />

            {panels.pattern ? (
              <PatternCard
                buckets={data.cells.availability}
                window={window}
                range={shownRange}
              />
            ) : null}

            {panels.timeline ? (
              <TimelineCard
                runs={data.cells.timeline}
                window={window}
                longSpan={longSpan}
              />
            ) : null}

            {panels.carriers ? (
              <CarriersCard data={data} frame={frame} window={window} />
            ) : null}

            {panels.rf ? (
              <ChartCard
                titleKey="history.charts.rf_title"
                descriptionKey="history.charts.rf_desc"
                charts={RF_CHARTS}
                data={data}
                frame={frame}
              />
            ) : null}

            {panels.agg ? (
              <ChartCard
                titleKey="history.charts.agg_title"
                descriptionKey="history.charts.agg_desc"
                charts={AGG_CHARTS}
                data={data}
                frame={frame}
              />
            ) : null}

            {panels.phy ? (
              <ChartCard
                titleKey="history.charts.phy_title"
                descriptionKey="history.charts.phy_desc"
                charts={PHY_CHARTS}
                data={data}
                frame={frame}
              />
            ) : null}

            {panels.congestion ? (
              <CongestionCard data={data} frame={frame} />
            ) : null}

            {panels.antennas ? (
              <AntennasCard data={data} frame={frame} />
            ) : null}

            {panels.quality ? (
              <ChartCard
                titleKey="history.charts.quality_title"
                descriptionKey="history.charts.quality_desc"
                charts={QUALITY_CHARTS}
                data={data}
                frame={frame}
              />
            ) : null}

            {panels.events || panels.outages ? (
              <div
                className={panels.events && panels.outages ? GRID : STACK}
              >
                {panels.events ? (
                  <EventsCard
                    stats={data.cells.stats}
                    events={data.cells.events}
                    coverage={data.coverage}
                  />
                ) : null}
                {panels.outages ? (
                  <OutagesCard
                    outages={data.cells.outages}
                    runs={data.cells.timeline}
                  />
                ) : null}
              </div>
            ) : null}

            {/* Identity and the device-load group do NOT pair: a five-chart
                card beside a thirteen-row grid leaves one of them holding a
                row's worth of slack, and DESIGN.md's answer to that is a
                full-width band, not a symmetric row. */}
            {panels.identity ? (
              <IdentityCard
                cell={data.snapshot.cell}
                asOf={data.snapshot.as_of}
                coverage={data.coverage}
              />
            ) : null}

            {panels.system ? (
              <ChartCard
                titleKey="history.charts.system_title"
                descriptionKey="history.charts.system_desc"
                charts={SYSTEM_CHARTS}
                data={data}
                frame={frame}
              />
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}

export default CellHistory;
