"use client";

import React, { useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MetricBar } from "@/components/ui/metric-bar";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TickingValue } from "@/components/ui/ticking-value";
import { TickGroup } from "@/components/ui/tick-group";

import type { DeviceStatus, LteStatus, NrStatus } from "@/types/modem-status";
import {
  calculateLteDistance,
  calculateNrDistance,
  formatDistance,
  formatTemperature,
} from "@/types/modem-status";
import { useUnitPreferences } from "@/hooks/use-system-settings";
import { DUR, staggerRows, staggerRowItem } from "@/lib/motion";
import {
  ABSENT,
  CARD_DESC,
  CARD_SHELL,
  CARD_TITLE,
  FOCUS_RING,
  METER_H,
  VALUE_CLASS,
} from "./shapes";
import { PillRow } from "./pill-row";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { cn } from "@/lib/utils";

interface DeviceMetricsComponentProps {
  deviceData: DeviceStatus | null;
  lteData: LteStatus | null;
  nrData: NrStatus | null;
  isLoading: boolean;
  /**
   * Whether the last poll actually reached the modem.
   *
   * Spelled exactly as device-status.tsx and network-status.tsx spell it, and
   * for the same reason: the status hook deliberately keeps the previous
   * snapshot on a failed fetch, so a card reading only `deviceData` sees a
   * full, plausible payload during an outage and cannot tell it is looking at
   * a photograph.
   */
  modemReachable: boolean;
  /**
   * Live LTE timing advance from the on-demand radio-details read. TA is off
   * the poller on this backend (docs/features/ondemand-radio-details.md), so
   * this is the primary source and `lteData.ta` only the fallback.
   */
  liveLteTa?: number | null;
  /** Live NR timing advance (NTA); same sourcing as `liveLteTa`. */
  liveNrTa?: number | null;
}

// --- Warning thresholds ---
const TEMP_WARN = 60; // °C
const TEMP_DANGER = 75; // °C
const CPU_WARN = 70; // percentage
const CPU_DANGER = 90; // percentage

/** One meter group: a label/value row over an 8px track. */
function MeterRow({
  label,
  children,
  bar,
}: {
  label: string;
  /** The value cell — already wrapped in its own `TickingValue`. */
  children: React.ReactNode;
  /**
   * The track. ALWAYS a `MetricBar`, never `null` — a bar with no reading
   * takes `value={null}` and draws the empty track (DESIGN.md > Quality bars).
   *
   * This prop used to accept `null` and fall back to an invisible spacer that
   * held the height and drew nothing. That is a THIRD spelling of absence: an
   * empty track says "no reading", a blank gap says "no meter". Introducing
   * the canonical one for the unreachable branch and leaving the old one
   * beside it would have put both in the same slot on the same card.
   */
  bar: React.ReactNode;
}) {
  return (
    <motion.div variants={staggerRowItem} className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-on-surface-variant">
          {label}
        </span>
        <div className="flex items-center gap-1.5">{children}</div>
      </div>
      {bar}
    </motion.div>
  );
}

/**
 * Skeleton (Skeleton-Mirror Rule): three meter groups and two pills, i.e. the
 * exact five-row geometry of the loaded body at the exact same heights.
 *
 * It used to draw TEN generic rows for a smaller body, so the card lost height
 * the instant data landed and dragged its grid siblings with it.
 */
function MetricsSkeleton() {
  return (
    <div className="flex flex-col gap-3.5">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="flex h-5 items-center justify-between gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className={cn(METER_H, "w-full rounded-pill")} />
        </div>
      ))}
      {Array.from({ length: 2 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-pill" />
      ))}
    </div>
  );
}

const DeviceMetricsComponent = ({
  deviceData,
  lteData,
  nrData,
  isLoading,
  modemReachable,
  liveLteTa,
  liveNrTa,
}: DeviceMetricsComponentProps) => {
  const { t } = useTranslation("dashboard");
  const unitPrefs = useUnitPreferences();
  const temp = deviceData?.temperature ?? null;
  const cpu = deviceData?.cpu_usage ?? null;
  const memUsed = deviceData?.memory_used_mb ?? 0;
  const memTotal = deviceData?.memory_total_mb ?? 0;

  // Same spelling as device-status.tsx and network-status.tsx, so the cards on
  // this surface cannot disagree about what "unreachable" means.
  const unreachable = !modemReachable;

  // The chip may not fire off a photograph: a temperature we cannot re-read is
  // not evidence the modem is still hot, and a warning nobody can refresh is
  // worse than no warning at all.
  const isTempHigh = !unreachable && temp !== null && temp >= TEMP_WARN;
  // CPU is /proc/stat on the box serving this page, so its chip is not gated.
  const isCpuHigh = cpu !== null && cpu >= CPU_WARN;
  const memPct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;

  // Skeleton handoff (Motion Guide recipe 11): the overlay lives for one
  // `quick` and then unmounts. Nothing downstream depends on it, so a missed
  // timer degrades to an ordinary instant swap rather than a stuck skeleton.
  const [handoff, setHandoff] = useState(false);
  const wasLoading = React.useRef(isLoading);
  React.useEffect(() => {
    const landed = wasLoading.current && !isLoading;
    wasLoading.current = isLoading;
    if (!landed) return;

    setHandoff(true);
    const id = window.setTimeout(() => setHandoff(false), DUR.quick * 1000);
    return () => window.clearTimeout(id);
  }, [isLoading]);

  // WHERE THE UNREACHABLE GATE STOPS, and it stops in the middle of this card
  // because `modem_reachable` means exactly one thing: the last AT command
  // timed out. It is not a verdict on the machine serving the page.
  //
  // GATED — read over AT, and free to have changed since. Temperature is
  // AT+QTEMP; both distances derive from the serving cell's timing advance.
  // When the poll fails the poller parses nothing and the PREVIOUS value
  // survives, so what is on screen is a photograph. Step 03 made this same
  // call for the two uptimes.
  //
  // NOT GATED — CPU (/proc/stat) and memory (/proc/meminfo) are measured
  // locally and are still fresh; the poller reads both unconditionally, before
  // it ever talks to the modem. Blanking them would be inventing an outage this
  // box is not having.
  //
  // PORT NOTE (ledger U4.10): the RM520N card also carries a Storage meter and
  // a resettable Data Used counter. Both need poller blocks this backend does
  // not have (the modem-subsys/storage telemetry and the persistent data_used
  // counter), so they are left out here until ledger B5.10 / B5.11 port them.
  //
  // ABSENT rather than the formatters' own "-": both return a hyphen-minus for
  // a null reading, which beside a column of figures reads as a minus sign
  // with its digits missing. The formatters are shared with other routes, so
  // the sentinel is chosen here rather than changed there.
  const tempValue =
    unreachable || temp === null
      ? ABSENT
      : formatTemperature(temp, unitPrefs?.tempUnit);
  const cpuValue = cpu !== null ? `${cpu}%` : ABSENT;
  const memValue = memTotal > 0 ? `${memUsed} MB / ${memTotal} MB` : ABSENT;

  // An inactive leg has no serving cell to be distant from: the poller reports
  // its TA as 0, which would otherwise render as "< 10 m".
  const lteTa =
    lteData?.state === "inactive" ? null : (liveLteTa ?? lteData?.ta ?? null);
  const nrTa =
    nrData?.state === "inactive" ? null : (liveNrTa ?? nrData?.ta ?? null);
  const lteKm = calculateLteDistance(lteTa);
  const nrKm = calculateNrDistance(nrTa);
  const lteDistance =
    unreachable || lteKm === null
      ? ABSENT
      : formatDistance(lteKm, unitPrefs?.distanceUnit);
  const nrDistance =
    unreachable || nrKm === null
      ? ABSENT
      : formatDistance(nrKm, unitPrefs?.distanceUnit);

  const body = isLoading ? (
    <MetricsSkeleton />
  ) : (
    // One tick cascade for the whole body, and the card's reading order is
    // already the cascade order: the three meters top-to-bottom, then the two
    // distance rows. `TickGroup` sorts the live DOM nodes rather
    // than a declared index, so it needs no axis flag to switch between the
    // two — and rows that hold their value this poll never enter the ranking,
    // which is why one group over five figures cannot run long.
    //
    // Wrapping the `motion.div` from outside is deliberate but also safe from
    // inside: `TickGroup` publishes its own React context and never touches
    // `MotionContext`, and motion/react resolves a child's parent through
    // `useContext(MotionContext)`, so an intervening plain provider is
    // transparent to `staggerRows` -> `staggerRowItem` propagation.
    <TickGroup>
      <motion.div
        className="flex flex-col gap-3.5"
        // Variants only, no initial/animate: this cascade INHERITS the
        // page-wide clock in home-component.tsx. Declaring its own would
        // detach it and start a second clock, which is the defect the
        // single-cascade step retired.
        variants={staggerRows}
      >
        {/* ── Modem Temperature ─────────────────────────────────────────── */}
        <MeterRow
          label={t("metrics.modem_temperature")}
          bar={
            <MetricBar
              value={unreachable ? null : temp}
              max={100}
              warnAt={TEMP_WARN}
              dangerAt={TEMP_DANGER}
              // A cool modem is good news, not merely not-yet-bad — so the
              // meter reads green below the warn line and still escalates to
              // amber and red above it.
              baseTone="success"
              track="surface-container-high"
              index={0}
            />
          }
        >
          {isTempHigh && (
            // The glyph inherits the chip's `on-warning-container` ink. It used
            // to carry `text-warning`, which repainted it in the SOLID role
            // colour on a container fill — the Container-Pair Rule's most common
            // failure. No `transition-colors` here either: `badge.tsx` writes its
            // own two-clock longhand and the utility would clobber it.
            <Badge variant="warning">
              <MaterialSymbol name="warning" size={12} filled />
              {t("metrics.high_temp_warning")}
            </Badge>
          )}
          <span className={VALUE_CLASS}>
            <TickingValue value={temp}>{tempValue}</TickingValue>
          </span>
        </MeterRow>

        {/* ── CPU Usage ─────────────────────────────────────────────────── */}
        <MeterRow
          label={t("metrics.cpu_usage")}
          bar={
            <MetricBar
              value={cpu}
              max={100}
              warnAt={CPU_WARN}
              dangerAt={CPU_DANGER}
              track="surface-container-high"
              index={1}
            />
          }
        >
          {isCpuHigh && (
            <Badge variant="warning">
              <MaterialSymbol name="warning" size={12} filled />
              {t("metrics.high_cpu_warning")}
            </Badge>
          )}
          <span className={VALUE_CLASS}>
            <TickingValue value={cpu}>{cpuValue}</TickingValue>
          </span>
        </MeterRow>

        {/* ── Memory Usage ──────────────────────────────────────────────── */}
        <MeterRow
          label={t("metrics.memory_usage")}
          bar={
            <MetricBar
              value={memTotal > 0 ? memPct : null}
              max={100}
              warnAt={70}
              dangerAt={90}
              track="surface-container-high"
              index={2}
            />
          }
        >
          <span className={VALUE_CLASS}>
            <TickingValue value={memUsed}>{memValue}</TickingValue>
          </span>
        </MeterRow>

        {/* ── LTE Cell Distance ─────────────────────────────────────────── */}
        <PillRow
          label={
            <>
              <span className="truncate">{t("metrics.lte_cell_distance")}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn("inline-flex shrink-0", FOCUS_RING)}
                    aria-label={t("metrics.more_info_aria")}
                  >
                    <MaterialSymbol name="info" size={16} filled />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {!unreachable && lteTa ? (
                    <p>{t("metrics.lte_distance_tooltip", { ta: lteTa })}</p>
                  ) : (
                    <p>{t("metrics.ta_unavailable")}</p>
                  )}
                </TooltipContent>
              </Tooltip>
            </>
          }
        >
          <span className={VALUE_CLASS}>
            <TickingValue value={lteDistance}>{lteDistance}</TickingValue>
          </span>
        </PillRow>

        {/* ── NR Cell Distance ──────────────────────────────────────────── */}
        <PillRow
          label={
            <>
              <span className="truncate">{t("metrics.nr_cell_distance")}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn("inline-flex shrink-0", FOCUS_RING)}
                    aria-label={t("metrics.more_info_aria")}
                  >
                    <MaterialSymbol name="info" size={16} filled />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {!unreachable && nrTa ? (
                    <p>{t("metrics.nr_distance_tooltip", { ta: nrTa })}</p>
                  ) : (
                    <p>{t("metrics.ta_unavailable")}</p>
                  )}
                </TooltipContent>
              </Tooltip>
            </>
          }
        >
          <span className={VALUE_CLASS}>
            <TickingValue value={nrDistance}>{nrDistance}</TickingValue>
          </span>
        </PillRow>
      </motion.div>
    </TickGroup>
  );

  return (
    <Card className={CARD_SHELL}>
      {/* CardHeader with its own padding cancelled, because CARD_SHELL already
          carries px-6. Structurally identical to the loaded/skeleton titles in
          recent-activities.tsx and signal-status-card.tsx — this card has no
          CardAction today, but keeping the header slot means the grid column
          for one is already reserved, and a reviewer diffing the dashboard
          cards does not find this one built differently for no reason. */}
      <CardHeader className="px-0">
        <CardTitle className={cn(CARD_TITLE, "tabular-nums")}>
          {t("metrics.title")}
        </CardTitle>
        {/* An explicit ink class because the primitive hardcodes a retired
            one. Not skeletoned: both lines are constants and neither was ever
            unknown, so a placeholder here would withhold the one thing that
            could orient a reader while the rows fill in. */}
        <CardDescription className={CARD_DESC}>
          {t("metrics.description")}
        </CardDescription>
      </CardHeader>

      {/* Recipe 11's overlay construction: the skeleton fades out ON TOP of the
          real content rather than beside it, so the real body owns the card's
          height from its first frame and the crossfade contributes zero layout
          shift. Pure opacity, no movement. */}
      <div className="relative">
        <div className={cn(handoff && "ca-content-in")}>{body}</div>
        {handoff && (
          <div
            aria-hidden
            className="ca-skeleton-out pointer-events-none absolute inset-0 [&>*]:h-full"
          >
            <MetricsSkeleton />
          </div>
        )}
      </div>
    </Card>
  );
};

export default DeviceMetricsComponent;
