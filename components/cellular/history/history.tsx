"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { CellularPageHeader } from "@/components/cellular/page-header";
import { ConditionScreen } from "@/components/cellular/condition-screen";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SegmentedField } from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { useCellHistory } from "@/hooks/use-cell-history";
import {
  CELL_HISTORY_RANGES,
  GAP_THRESHOLD_SECONDS,
  type CellHistoryRange,
} from "@/types/cell-history";
import { AvailabilityCard } from "./availability-card";
import { BandsCard } from "./bands-card";
import { BandSignalCard } from "./band-signal-card";
import { ChartCard } from "./chart-card";
import {
  availabilityBuckets,
  BUCKET_SEC,
  bandCombos,
  bandRuns,
  cellEvents,
  cellStats,
  coverageStart,
  formatMoment,
  isWindowShort,
  newestSample,
  nrOutages,
  rangeSpanSec,
  servingRuns,
  windowOf,
} from "./derive";
import { EventsCard } from "./events-card";
import { IdentityCard } from "./identity-card";
import { Legend } from "./legend";
import { OutagesCard } from "./outages-card";
import { PanelsPopover } from "./panels-popover";
import {
  loadPanels,
  savePanels,
  type PanelId,
  type PanelVisibility,
} from "./panels";
import { PatternCard } from "./pattern-card";
import { CONTROLS, GRID, PAGE_ROOT, SKELETON, STACK } from "./shapes";
import { TimelineCard } from "./timeline-card";

// =============================================================================
// Cell History — what the radio actually did over the selected range
// =============================================================================
// One ranged read, one page of panels, and one sentence at the top about what the
// record could and could not see.
//
// THE PANELS THE FIELD COMPLAINT NEEDS ARE THE DEFAULTS. "5G disappears at night,
// sometimes band 1" is answered by the day × hour pattern (does it recur at
// night), the band strip (which band set went missing) and the RF charts (how the
// reading moved either side) — so those, plus the serving-cell gantt, the per-band
// RSRP and the change list, open. The outage table and the identity grid are one
// click away: a page that opens with eight panels opens with none of them read.
//
// NO LIVE BAND AND NO `now` RANGE. The dashboard is the live surface; this page
// reads the archive, whose newest row is up to a poll cycle old. A live strip above
// range cards disagrees with them the moment the range's last bucket ages
// (`docs/reference/latency-monitor.md`), so the pill offers named ranges only and
// every card below reads the same window.
//
// THE WINDOW IS THE PAYLOAD'S, NOT THE PILL'S. Two lines under the controls state
// how many readings came back and what span they cover, and they say so when that
// span is materially shorter than the range asked for or when identity logging
// starts part-way through it. Without them the page would print "5G never dropped"
// about hours it could not see — the one claim a history surface must never make by
// omission.
//
// PANELS ARE A VIEWER PREFERENCE (`./panels`, `localStorage`). The availability
// hero is not one of them: a page about 5G availability that can hide its own
// answer is a settings screen.
//
// EVERY DERIVATION IS ONE `useMemo` ON THE PAYLOAD. Buckets, runs, combos, series
// and the change list all read the same rows, and recomputing them because a
// checkbox in the panel picker moved is work the device's only core does not need
// to do twice.
// =============================================================================

const RANGE_LABEL_KEY = {
  "1h": "history.range.h1",
  "3h": "history.range.h3",
  "6h": "history.range.h6",
  "12h": "history.range.h12",
  "24h": "history.range.h24",
} satisfies Record<CellHistoryRange, string>;

/** A day, by default: the page's subject is a nightly dropout. */
const DEFAULT_RANGE: CellHistoryRange = "24h";

/**
 * Past this span a bare `HH:MM` stops locating anything — the range can cross
 * midnight, and an axis reading `02:00` twice is worse than a wider label.
 */
const LONG_SPAN_SECONDS = 21_600;

/** The three readings the recorder writes per row — the RF group's charts. */
const RF_METRICS = ["rsrp", "rsrq", "sinr"] as const;

function PageSkeleton() {
  return (
    <div className={STACK} aria-hidden>
      <Skeleton className={SKELETON.HERO} />
      <Skeleton className={SKELETON.CARD} />
      <Skeleton className={SKELETON.CARD} />
      <Skeleton className={SKELETON.CARD} />
    </div>
  );
}

export function CellHistory() {
  const { t } = useTranslation("cellular");
  const [range, setRange] = useState<CellHistoryRange>(DEFAULT_RANGE);
  const { data, dataRange, isLoading, error, refresh } = useCellHistory(range);

  // Lazy and guarded: this page is prerendered during the static export, where
  // `window` does not exist. Reading storage in the initialiser (not in an effect)
  // is also what keeps the first client paint from flashing the defaults.
  const [panels, setPanels] = useState<PanelVisibility>(() => loadPanels());

  const togglePanel = (id: PanelId) => {
    setPanels((previous) => {
      const next: PanelVisibility = { ...previous, [id]: !previous[id] };
      savePanels(next);
      return next;
    });
  };

  // The range every payload-shaped decision keys on: `range` moves the moment a
  // pill is clicked, `dataRange` moves when the answer for it lands.
  const shownRange = dataRange ?? range;
  const longSpan = rangeSpanSec(shownRange) >= LONG_SPAN_SECONDS;
  const bucketSec = BUCKET_SEC[shownRange];

  const derived = useMemo(() => {
    if (data === null) return null;
    const window = windowOf(data);
    const rows = data.rows;
    const runs = servingRuns(rows);
    const comboRuns = bandRuns(rows);
    return {
      window,
      rows,
      runs,
      buckets: availabilityBuckets(rows, window, bucketSec),
      outages: nrOutages(rows),
      stats: cellStats(rows),
      events: cellEvents(rows),
      bandRuns: comboRuns,
      combos: bandCombos(comboRuns),
      identity: newestSample(rows),
      identityFrom: coverageStart(rows),
      short: isWindowShort(window, shownRange),
    };
  }, [data, bucketSec, shownRange]);

  const clockUnset = data !== null && !data.sane_epoch;

  return (
    <div className={PAGE_ROOT}>
      <CellularPageHeader
        title={t("history.page.title")}
        description={t("history.page.description")}
      />

      <div className={CONTROLS.ROOT}>
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
            {isLoading && data === null
              ? t("history.refreshing")
              : t("history.refresh")}
          </Button>
          <PanelsPopover visibility={panels} onToggle={togglePanel} />
        </div>

        {derived !== null && derived.window.samples > 0 ? (
          <div className={CONTROLS.NOTES_BLOCK}>
            <div className={CONTROLS.NOTES}>
              <span>
                {t("history.window.samples", { count: derived.window.samples })}
              </span>
              {derived.window.first_ts !== null &&
              derived.window.last_ts !== null ? (
                <span>
                  {t("history.window.span", {
                    first: formatMoment(derived.window.first_ts),
                    last: formatMoment(derived.window.last_ts),
                  })}
                </span>
              ) : null}
            </div>
            {derived.short ? (
              <p className={CONTROLS.NOTE}>
                {t("history.window.short", {
                  range: t(RANGE_LABEL_KEY[shownRange]),
                })}
              </p>
            ) : null}
            {derived.identityFrom !== null &&
            derived.window.first_ts !== null &&
            derived.identityFrom >
              derived.window.first_ts + GAP_THRESHOLD_SECONDS ? (
              <p className={CONTROLS.NOTE}>
                {t("history.window.identity_from", {
                  time: formatMoment(derived.identityFrom),
                })}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Directly under the controls and above every panel: what the marks mean
          does not depend on whether a read has landed yet. Only the band group
          waits for the combos. */}
      <Legend
        combos={derived?.combos ?? []}
        intervalSec={data?.interval_sec ?? 60}
      />

      {/* A failed read with figures already on screen keeps them and says they are
          not updating. A failed FIRST read has nothing worth keeping. */}
      {error !== null && data !== null ? (
        <Banner
          role="degraded"
          title={t("history.stale.title")}
          description={t("history.stale.description")}
        />
      ) : null}

      {data === null && isLoading ? <PageSkeleton /> : null}

      {data === null && !isLoading ? (
        <ConditionScreen
          tone="destructive"
          glyph="error"
          ariaRole="alert"
          title={t("history.error.title")}
          description={t("history.error.description")}
          onRetry={refresh}
          retryLabel={t("history.refresh")}
        />
      ) : null}

      {data !== null && clockUnset ? (
        <ConditionScreen
          tone="warning"
          glyph="schedule"
          ariaRole="status"
          title={t("history.clock.title")}
          description={t("history.clock.description")}
          onRetry={refresh}
          retryLabel={t("history.refresh")}
        />
      ) : null}

      {data !== null && !clockUnset && derived !== null ? (
        derived.window.samples === 0 ? (
          <ConditionScreen
            tone="primary"
            glyph="timeline"
            ariaRole="status"
            title={t("history.empty.title")}
            description={t("history.empty.description")}
          />
        ) : (
          <div className={STACK}>
            <AvailabilityCard
              buckets={derived.buckets}
              outages={derived.outages}
              window={derived.window}
              longSpan={longSpan}
            />

            {panels.pattern ? (
              <PatternCard
                buckets={derived.buckets}
                window={derived.window}
                range={shownRange}
              />
            ) : null}

            {panels.timeline ? (
              <TimelineCard
                runs={derived.runs}
                stats={derived.stats}
                window={derived.window}
                longSpan={longSpan}
              />
            ) : null}

            {panels.rf ? (
              <ChartCard
                title={t("history.charts.rf_title")}
                metrics={RF_METRICS}
                rows={derived.rows}
                window={derived.window}
                bucketSec={bucketSec}
                longSpan={longSpan}
              />
            ) : null}

            {panels.bands ? (
              <BandsCard
                runs={derived.bandRuns}
                combos={derived.combos}
                window={derived.window}
              />
            ) : null}

            {panels.band_signal ? (
              <BandSignalCard
                rows={derived.rows}
                window={derived.window}
                bucketSec={bucketSec}
                longSpan={longSpan}
              />
            ) : null}

            {panels.events || panels.outages ? (
              <div className={panels.events && panels.outages ? GRID : STACK}>
                {panels.events ? (
                  <EventsCard events={derived.events} range={shownRange} />
                ) : null}
                {panels.outages ? (
                  <OutagesCard outages={derived.outages} runs={derived.runs} />
                ) : null}
              </div>
            ) : null}

            {panels.identity ? <IdentityCard sample={derived.identity} /> : null}
          </div>
        )
      ) : null}
    </div>
  );
}

export default CellHistory;
