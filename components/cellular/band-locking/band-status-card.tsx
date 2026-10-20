"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConditionScreen } from "@/components/cellular/condition-screen";
import {
  qualityInkClass,
  qualityMeterTone,
} from "@/components/cellular/signal-quality-display";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { HintIcon } from "@/components/ui/hint-icon";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { MetricBar } from "@/components/ui/metric-bar";
import { SegmentedField } from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  BandActionResult,
  BandCategory,
  FailoverState,
} from "@/types/band-locking";
import {
  RSRP_THRESHOLDS,
  getSignalQuality,
  signalToProgress,
  type CarrierComponent,
} from "@/types/modem-status";

import {
  BADGE_GLYPH_SIZE,
  BAND_HERO,
  CARRIER_DISC_GLYPH,
  CATEGORY_BADGE,
  FAILOVER_DOT,
  HERO_ONAIR_GRID,
  HERO_ONAIR_PANEL,
  HERO_ONAIR_TILE,
  HERO_RAIL_DISC,
  HERO_RAIL_PANEL,
  HERO_RAIL_ROW,
  HERO_RAIL_ROW_LABEL,
  HERO_RAIL_ROW_RATIO,
  HERO_RAIL_SUBTITLE,
  HERO_RAIL_TITLE,
  HERO_ROW,
  HERO_ROW_LABEL,
  HERO_SPLIT,
  POSTURE_GLYPH,
  RAIL_CATEGORIES,
  SKELETON_SHAPE,
  carrierDiscTone,
  categoryPosture,
  categoryShortKey,
  failoverKey,
  type BandPosture,
} from "./shapes";

// =============================================================================
// BandStatusCard — what the modem is doing right now
// =============================================================================
// The status card above the band cards (ported from the fork's
// `live-band-hero.tsx`, a05c4e92). Left: the carriers on air, PCC first.
// Right: one posture row per category, each scrolling to the card that changes
// it. Below both: the failover safety net, a property of the whole modem
// (`lock.sh` arms one watcher whichever category was written).
//
// Failover is a persistent toggle, so it commits on change and toasts the
// returned result; there is no draft and no CardFoot here.
// =============================================================================

const K = "cell_locking.band_locking";

/** Rail rows shown by default (LTE, NSA); SA and NR-DC fold behind a toggle. */
const RAIL_PRIMARY_COUNT = 2;

export interface BandStatusCardProps {
  failover: FailoverState;
  carrierComponents: CarrierComponent[];
  /** The lockable universe per category (hardware list, policy fallback). */
  supportedBands: Record<BandCategory, number[]>;
  lockedBands: Record<BandCategory, number[]>;
  /** False when `current.sh` failed and `lockedBands` is the `[]` fallback. */
  hasCurrentReading: boolean;
  onToggleFailover: (enabled: boolean) => Promise<BandActionResult>;
  /** Scroll to (and, for NR-DC, swap the shared slot to) a category's card. */
  onSelectCategory: (category: BandCategory) => void;
  isLoading: boolean;
  /** A Connection Scenario owns radio config; failover is frozen with it. */
  isGated?: boolean;
}

/** PCC first, then LTE before NR (the LTE leg anchors NSA). Order is the only
 *  channel carrying lead primacy, since the tile body is neutral. */
function sortCarriers(components: CarrierComponent[]): CarrierComponent[] {
  return [...components].sort((a, b) => {
    const lead = (c: CarrierComponent) => (c.type === "PCC" ? 0 : 1);
    const tech = (c: CarrierComponent) => (c.technology === "LTE" ? 0 : 1);
    return lead(a) - lead(b) || tech(a) - tech(b);
  });
}

function OnAirTile({ carrier }: { carrier: CarrierComponent }) {
  const { t } = useTranslation("cellular");
  const quality = getSignalQuality(carrier.rsrp, RSRP_THRESHOLDS);
  // `null` for no reading drives all three channels: no fill, neutral ink, and
  // a dash. Decided upstream of `signalToProgress`, which returns 0 (a red
  // stub) rather than null for a missing reading.
  const tone = qualityMeterTone(quality);
  const percent =
    tone === null ? null : signalToProgress(carrier.rsrp, RSRP_THRESHOLDS);

  return (
    <div
      role="listitem"
      className={HERO_ONAIR_TILE.ROOT}
      aria-label={t(`${K}.status.tile_aria`, {
        tech: t(`${K}.status.tech_${carrier.technology.toLowerCase()}`),
        role: carrier.type,
      })}
    >
      {carrier.bandwidth_mhz > 0 ? (
        <span className={HERO_ONAIR_TILE.BANDWIDTH}>
          {t(`${K}.status.mhz`, { value: carrier.bandwidth_mhz })}
        </span>
      ) : null}

      <div className={HERO_ONAIR_TILE.TOP}>
        <span
          aria-hidden="true"
          className={`${HERO_ONAIR_TILE.DISC} ${carrierDiscTone(carrier.technology)}`}
        >
          <MaterialSymbol
            name={CARRIER_DISC_GLYPH[carrier.technology]}
            size={20}
            filled
          />
        </span>
        <div className={HERO_ONAIR_TILE.TEXT}>
          <div className={HERO_ONAIR_TILE.BAND_ROW}>
            <span className={HERO_ONAIR_TILE.BAND}>{carrier.band}</span>
          </div>
          {carrier.earfcn !== null || carrier.pci !== null ? (
            <div className={HERO_ONAIR_TILE.DETAIL}>
              {carrier.earfcn !== null ? (
                <span>{t(`${K}.status.earfcn`, { value: carrier.earfcn })}</span>
              ) : null}
              {carrier.pci !== null ? (
                <span>{t(`${K}.status.pci`, { value: carrier.pci })}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className={HERO_ONAIR_TILE.METRICS_GROUP}>
        <div className={HERO_ONAIR_TILE.RSRP_ROW}>
          {/* The ramp ink is legal only beside the bar whose length carries the
              same reading; with no reading the ink is neutral. */}
          <span className={`${HERO_ONAIR_TILE.RSRP} ${qualityInkClass(quality)}`}>
            {carrier.rsrp === null
              ? t(`${K}.status.no_value`)
              : t(`${K}.status.dbm`, { value: carrier.rsrp })}
          </span>
          <span className={HERO_ONAIR_TILE.RSRP_UNIT}>
            {t(`${K}.status.rsrp`)}
          </span>
          <span className="sr-only">{t(`${K}.status.quality.${quality}`)}</span>
        </div>
        <div aria-hidden="true">
          <MetricBar
            value={percent}
            max={100}
            // MetricBar is higher-is-worse; unreachable thresholds plus the
            // override pin the ramp tone instead.
            warnAt={101}
            dangerAt={101}
            colorOverride={tone}
            track="surface-container-high"
          />
        </div>
      </div>
    </div>
  );
}

export function BandStatusCard({
  failover,
  carrierComponents,
  supportedBands,
  lockedBands,
  hasCurrentReading,
  onToggleFailover,
  onSelectCategory,
  isLoading,
  isGated = false,
}: BandStatusCardProps) {
  const { t } = useTranslation("cellular");

  const onAir = useMemo(
    () => sortCarriers(carrierComponents),
    [carrierComponents],
  );
  const totalMhz = onAir.reduce(
    (sum, c) => sum + (c.bandwidth_mhz > 0 ? c.bandwidth_mhz : 0),
    0,
  );

  const postures = RAIL_CATEGORIES.map((category) => ({
    category,
    posture: categoryPosture(
      lockedBands[category],
      supportedBands[category],
      hasCurrentReading,
    ),
  }));
  const reported = postures.filter(
    (p) => p.posture === "locked" || p.posture === "unrestricted",
  );
  const restrictedCount = reported.filter((p) => p.posture === "locked").length;

  // Any restriction at all is a locked posture; the subtitle tells partial
  // from full in words. `unavailable` is checked first: a failed read zeroes
  // both counters, which would otherwise read as "never reported".
  const overall: BandPosture = !hasCurrentReading
    ? "unavailable"
    : reported.length === 0
      ? "unknown"
      : restrictedCount === 0
        ? "unrestricted"
        : "locked";

  const subtitle =
    overall === "locked"
      ? t(`${K}.status.subtitle_locked`, {
          count: restrictedCount,
          total: reported.length,
        })
      : t(`${K}.status.subtitle_${overall}`);

  const [moreOpen, setMoreOpen] = useState(false);

  const renderRailRow = ({
    category,
    posture,
  }: {
    category: BandCategory;
    posture: BandPosture;
  }) => {
    const badge = CATEGORY_BADGE[posture];
    // No ratio for a failed read: a real denominator over a fabricated zero is
    // a count we do not have.
    const ratio =
      posture === "unavailable"
        ? t(`${K}.status.ratio_unavailable`)
        : t(`${K}.status.ratio`, {
            count: lockedBands[category].length,
            total: supportedBands[category].length,
          });
    const label = t(categoryShortKey(category));
    const statusLabel = t(`${K}.status.rail_${posture}`);
    return (
      <button
        key={category}
        type="button"
        onClick={() => onSelectCategory(category)}
        className={HERO_RAIL_ROW}
        aria-label={t(`${K}.status.rail_aria`, {
          category: label,
          ratio,
          status: statusLabel,
        })}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={HERO_RAIL_ROW_LABEL}>{label}</span>
          <span className={HERO_RAIL_ROW_RATIO}>{ratio}</span>
        </div>
        <Badge variant={badge.variant} className="ml-auto flex-none">
          <MaterialSymbol name={badge.glyph} size={BADGE_GLYPH_SIZE} />
          {statusLabel}
        </Badge>
        <MaterialSymbol
          name="chevron_right"
          size={20}
          className="flex-none text-on-surface-variant transition-transform duration-[var(--duration-quick)] ease-out group-hover:translate-x-0.5"
        />
      </button>
    );
  };

  const fKey = failoverKey(failover);
  const fDot = FAILOVER_DOT[fKey];

  const handleFailover = async (value: "on" | "off") => {
    const enabled = value === "on";
    if (enabled === failover.enabled) return;
    const result = await onToggleFailover(enabled);
    if (result.ok) {
      toast.success(
        t(
          enabled
            ? `${K}.settings_card.toast.failover_enabled`
            : `${K}.settings_card.toast.failover_disabled`,
        ),
      );
    } else {
      toast.error(result.error);
    }
  };

  return (
    <section className={BAND_HERO} aria-label={t(`${K}.status.title`)}>
      <div className={HERO_SPLIT}>
        {/* --- On air now ------------------------------------------------- */}
        <div className={HERO_ONAIR_PANEL}>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className={HERO_RAIL_TITLE}>{t(`${K}.status.on_air`)}</span>
            {isLoading ? (
              <Skeleton className="h-3.5 w-40" />
            ) : onAir.length > 0 ? (
              <span className={`${HERO_RAIL_SUBTITLE} tabular-nums`}>
                {t(`${K}.status.on_air_summary`, {
                  count: onAir.length,
                  mhz: totalMhz,
                })}
              </span>
            ) : null}
          </div>

          {isLoading ? (
            <div className={HERO_ONAIR_GRID}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className={SKELETON_SHAPE.ONAIR_TILE} />
              ))}
            </div>
          ) : onAir.length === 0 ? (
            <ConditionScreen
              tone="neutral"
              glyph="signal_cellular_off"
              ariaRole="status"
              title={t(`${K}.status.on_air_empty_title`)}
              description={t(`${K}.status.on_air_empty_body`)}
              className="rounded-tile bg-surface py-10"
            />
          ) : (
            <div className={HERO_ONAIR_GRID} role="list">
              {onAir.map((c) => (
                <OnAirTile
                  key={`${c.technology}-${c.type}-${c.band}-${c.earfcn ?? "x"}-${c.pci ?? "x"}`}
                  carrier={c}
                />
              ))}
            </div>
          )}
        </div>

        {/* --- Lock posture rail ------------------------------------------ */}
        <div className={HERO_RAIL_PANEL}>
          <div className="flex items-center gap-3">
            {isLoading ? (
              <Skeleton className={SKELETON_SHAPE.HERO_DISC} />
            ) : (
              <span className={HERO_RAIL_DISC} aria-hidden="true">
                <MaterialSymbol name={POSTURE_GLYPH[overall]} size={22} filled />
              </span>
            )}
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className={HERO_RAIL_TITLE}>{t(`${K}.status.posture`)}</span>
              {isLoading ? (
                <Skeleton className="h-3.5 w-40" />
              ) : (
                <span className={HERO_RAIL_SUBTITLE}>{subtitle}</span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {isLoading ? (
              RAIL_CATEGORIES.slice(0, RAIL_PRIMARY_COUNT).map((c) => (
                <Skeleton key={c} className={SKELETON_SHAPE.RAIL_ROW} />
              ))
            ) : (
              <>
                {postures.slice(0, RAIL_PRIMARY_COUNT).map(renderRailRow)}
                <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
                  <CollapsibleContent className="flex flex-col gap-2 pb-2">
                    {postures.slice(RAIL_PRIMARY_COUNT).map(renderRailRow)}
                  </CollapsibleContent>
                  <CollapsibleTrigger className="group flex w-full items-center justify-center gap-1 rounded-pill px-3 py-1.5 text-xs font-medium text-on-surface-variant transition-colors duration-[var(--duration-quick)] ease-out hover:text-foreground focus-visible:ring-ring focus-visible:ring-[3px] focus-visible:outline-none">
                    {moreOpen
                      ? t(`${K}.status.rail_show_less`)
                      : t(`${K}.status.rail_show_more`, {
                          categories: postures
                            .slice(RAIL_PRIMARY_COUNT)
                            .map((p) => t(categoryShortKey(p.category)))
                            .join(", "),
                        })}
                    <MaterialSymbol
                      name="expand_more"
                      size={16}
                      className="transition-transform duration-[var(--duration-quick)] ease-out group-data-[state=open]:rotate-180"
                    />
                  </CollapsibleTrigger>
                </Collapsible>
              </>
            )}
          </div>
        </div>
      </div>

      {/* --- Failover ------------------------------------------------------ */}
      {isLoading ? (
        <Skeleton className={SKELETON_SHAPE.HERO_ROW} />
      ) : (
        <div className={HERO_ROW}>
          <div className="flex min-w-0 items-center gap-1.5">
            {fDot ? (
              <span
                role="img"
                aria-label={t(`${K}.settings_card.status.${fKey}`)}
                title={t(`${K}.settings_card.status.${fKey}`)}
                className="relative mr-1 flex size-2.5 flex-none"
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping ${fDot.ping}`}
                />
                <span
                  aria-hidden="true"
                  className={`relative size-2.5 rounded-full ${fDot.dot}`}
                />
              </span>
            ) : null}
            <p className={HERO_ROW_LABEL}>
              {t(`${K}.settings_card.band_failover_label`)}
            </p>
            <HintIcon label={t(`${K}.settings_card.band_failover_info_aria`)}>
              {t(`${K}.settings_card.band_failover_tooltip`)}
            </HintIcon>
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
            <SegmentedField
              value={failover.enabled ? "on" : "off"}
              onValueChange={handleFailover}
              options={[
                { value: "off", label: t("state.off", { ns: "common" }) },
                { value: "on", label: t("state.on", { ns: "common" }) },
              ]}
              ariaLabel={t(`${K}.settings_card.band_failover_label`)}
              disabled={isGated}
              breakpoint="never"
              glyph={(className) => (
                <MaterialSymbol
                  name="check"
                  size={16}
                  className={className}
                  aria-hidden="true"
                />
              )}
            />
          </div>
        </div>
      )}
    </section>
  );
}

export default BandStatusCard;
