"use client";

import { useState } from "react";
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
import {
  availabilityBuckets,
  BUCKET_SEC,
  cellEvents,
  cellStats,
  coverageStart,
  formatMoment,
  isWindowShort,
  nrOutages,
  servingRuns,
  windowOf,
} from "./derive";
import { EventsCard } from "./events-card";
import { CONTROLS, PAGE_ROOT, SKELETON, STACK } from "./shapes";
import { TimelineCard } from "./timeline-card";

// =============================================================================
// Cell History — what the radio actually did over the selected range
// =============================================================================
// One ranged read, three readings of it, and one sentence at the top about what
// the record could and could not see.
//
// A DAY IS THE DEFAULT AND THE CEILING. The complaint this page exists for is a
// night-time dropout, and the shortest range that contains a night is a day; the
// CGI serves raw rows, so a week would be ~10k rows of JSON on a single-core
// device. `range` is what the pill says, `dataRange` is what the payload on
// screen was read for — every payload-shaped decision keys on `dataRange`, or the
// moment between clicking 24h and its answer would price the 24h payload against
// a 1h just selected.
//
// THE WINDOW IS THE PAYLOAD'S, NOT THE PILL'S. Two lines under the controls state
// how many readings came back and what span they cover, and say so when that span
// is materially shorter than the range asked for. Without them the page would
// print "5G never dropped" about hours it could not see, which is the one claim a
// history surface must never make by omission.
//
// AN EMPTY RECORD IS A STATE, NOT A BLANK PAGE. With no rows the page says when
// recording starts (the first reading after the recorder is installed) rather
// than drawing an empty strip, because a strip with nothing on it reads as "no
// 5G" — the exact inversion of the truth.
// =============================================================================

const RANGE_LABEL_KEY = {
  "1h": "history.range.h1",
  "3h": "history.range.h3",
  "6h": "history.range.h6",
  "12h": "history.range.h12",
  "24h": "history.range.h24",
} satisfies Record<CellHistoryRange, string>;

const DEFAULT_RANGE: CellHistoryRange = "24h";

function PageSkeleton() {
  return (
    <div className={STACK} aria-hidden>
      <Skeleton className={SKELETON.HERO} />
      <Skeleton className={SKELETON.CARD} />
      <Skeleton className={SKELETON.CARD} />
    </div>
  );
}

export function CellHistory() {
  const { t } = useTranslation("cellular");
  const [range, setRange] = useState<CellHistoryRange>(DEFAULT_RANGE);
  const { data, dataRange, isLoading, error, refresh } = useCellHistory(range);

  // The range every payload-shaped decision keys on.
  const shownRange = dataRange ?? range;
  const window = data !== null ? windowOf(data) : null;
  const rows = data?.rows ?? [];

  const buckets =
    window === null ? [] : availabilityBuckets(rows, window, BUCKET_SEC[shownRange]);
  const outages = nrOutages(rows);
  const runs = servingRuns(rows);
  const stats = cellStats(rows);
  const events = cellEvents(rows);
  const identityFrom = coverageStart(rows);
  const shortWindow = window !== null && isWindowShort(window, shownRange);

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
        </div>

        {window !== null && window.samples > 0 ? (
          <div className={CONTROLS.NOTES}>
            <span>
              {t("history.window.samples", { count: window.samples })}
            </span>
            {window.first_ts !== null && window.last_ts !== null ? (
              <span>
                {t("history.window.span", {
                  first: formatMoment(window.first_ts),
                  last: formatMoment(window.last_ts),
                })}
              </span>
            ) : null}
            {shortWindow ? (
              <span className={CONTROLS.NOTE}>
                {t("history.window.short", {
                  range: t(RANGE_LABEL_KEY[shownRange]),
                })}
              </span>
            ) : null}
            {identityFrom !== null &&
            window.first_ts !== null &&
            identityFrom > window.first_ts + GAP_THRESHOLD_SECONDS ? (
              <span className={CONTROLS.NOTE}>
                {t("history.window.identity_from", {
                  time: formatMoment(identityFrom),
                })}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

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

      {data !== null && !clockUnset && window !== null ? (
        window.samples === 0 ? (
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
              buckets={buckets}
              outages={outages}
              window={window}
              range={shownRange}
            />
            <TimelineCard
              runs={runs}
              stats={stats}
              window={window}
              range={shownRange}
            />
            <EventsCard events={events} range={shownRange} />
          </div>
        )
      ) : null}
    </div>
  );
}

export default CellHistory;
