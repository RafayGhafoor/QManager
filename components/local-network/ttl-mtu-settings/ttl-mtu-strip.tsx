"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  MinusCircleIcon,
  PackageIcon,
  RefreshCcwIcon,
  RouteIcon,
  WaypointsIcon,
  type LucideIcon,
} from "lucide-react";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

import {
  BAND,
  CHIP_GLYPH,
  DISC_TONE,
  DISC_TRANSITION,
  NOTICE_ACTION,
  NOTICE_SPAN,
  NOTICE_TITLE,
  TILE,
  VALUE_NONE,
  type DiscTone,
  type TtlMtuState,
} from "./shapes";

// =============================================================================
// TtlMtuStrip — Band A of /local-network/ttl-settings
// =============================================================================
// Three read-only tiles above the write cards: what the cellular interface is
// doing with TTL, hop limit and MTU right now.
//
// The band spans two endpoints (`ttl.sh`, `mtu.sh`) that fail independently, so
// failure is per read: a tile whose endpoint answered shows its value, a tile
// whose endpoint did not shows the em dash and says why (pending vs unread,
// from its own flag). The spanning notice is only for "neither answered".
// =============================================================================

const K = "ttl_mtu";

/** The MTU the carrier hands out on essentially every network. */
const CARRIER_DEFAULT_MTU = 1500;

/** Literal keys rather than an interpolated suffix, so the checker can resolve them. */
const STATE_LABEL_KEY: Record<TtlMtuState, string> = {
  custom: `${K}.strip.chip_custom`,
  default: `${K}.strip.chip_default`,
};

export interface TtlStripReading {
  isEnabled: boolean;
  ttl: number;
  hl: number;
}

/**
 * `currentValue` is not unconditionally a measurement: `mtu.sh` substitutes
 * 1500 when the interface read fails. So the band draws a figure only when the
 * endpoint answered (this object is non-null), and the caption states where the
 * value comes from rather than claiming it was measured.
 */
export interface MtuStripReading {
  isEnabled: boolean;
  currentValue: number;
}

function Tile({
  glyph: Glyph,
  tone = "neutral",
  eyebrow,
  children,
  caption,
}: {
  glyph: LucideIcon;
  /** The disc's fill, the only colour a tile carries. */
  tone?: DiscTone;
  eyebrow: string;
  children: React.ReactNode;
  caption: React.ReactNode;
}) {
  return (
    <div className={cn(TILE.ROOT, TILE.BODY)}>
      <span className={cn(TILE.DISC, DISC_TRANSITION, DISC_TONE[tone])}>
        <Glyph className={TILE.GLYPH} aria-hidden="true" />
      </span>
      <div className={TILE.TEXT}>
        <span className={TILE.EYEBROW}>{eyebrow}</span>
        <span className={TILE.VALUE}>{children}</span>
        <span className={TILE.CAPTION}>{caption}</span>
      </div>
    </div>
  );
}

function NoticeTile({
  glyph: Glyph,
  title,
  body,
  action,
}: {
  glyph: LucideIcon;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn(TILE.ROOT, TILE.BODY, NOTICE_SPAN)} role="status">
      <span className={cn(TILE.DISC, DISC_TONE.neutral)}>
        <Glyph className={TILE.GLYPH} aria-hidden="true" />
      </span>
      <div className={TILE.TEXT}>
        <span className={NOTICE_TITLE}>{title}</span>
        <span className={TILE.CAPTION}>{body}</span>
      </div>
      {action}
    </div>
  );
}

export interface TtlMtuStripProps {
  /** The TTL endpoint's reading; `null` until it answers. */
  ttl: TtlStripReading | null;
  /** The MTU endpoint's reading; `null` until it answers. */
  mtu: MtuStripReading | null;
  /**
   * Separate per-endpoint pending flags. One page-level `isLoading` would
   * caption a tile "didn't answer" over a request that is still in flight.
   */
  ttlPending: boolean;
  mtuPending: boolean;
  /** Derived in the shell, the only component holding both readings. */
  state: TtlMtuState;
  stateBadge: BadgeVariant;
  /** Re-runs both GETs. */
  onRetry: () => void;
}

export function TtlMtuStrip({
  ttl,
  mtu,
  ttlPending,
  mtuPending,
  state,
  stateBadge,
  onRetry,
}: TtlMtuStripProps) {
  const { t } = useTranslation("local-network");

  const ttlReady = ttl !== null;
  const mtuReady = mtu !== null;
  const anyReady = ttlReady || mtuReady;

  const ttlActive = ttlReady && ttl.ttl > 0;
  const hlActive = ttlReady && ttl.hl > 0;
  const mtuActive = mtuReady && mtu.isEnabled;

  // Both answered and nothing overrides the carrier: one sentence, not three
  // tiles of dashes. The tiles return as soon as any override is in force.
  const nothingInForce = ttlReady && mtuReady && state === "default";

  const pendingCaption = (pending: boolean) =>
    t(
      pending
        ? `${K}.tiles.shared.caption_pending`
        : `${K}.tiles.shared.caption_unread`,
    );

  return (
    <section aria-label={t(`${K}.strip.label`)} className="flex flex-col gap-2">
      <div className={BAND.HEAD}>
        <span className={BAND.LABEL}>{t(`${K}.strip.label`)}</span>
        {/* The chip is a property of the reading; no reading, no chip. */}
        {anyReady ? (
          <Badge variant={stateBadge}>
            {state === "custom" ? (
              <CheckCircle2Icon className={BAND.GLYPH} aria-hidden="true" />
            ) : (
              <MinusCircleIcon className={BAND.GLYPH} aria-hidden="true" />
            )}
            {t(STATE_LABEL_KEY[state])}
          </Badge>
        ) : null}
      </div>

      <div className={TILE.GRID}>
        {!anyReady && (ttlPending || mtuPending) ? (
          Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className={cn(TILE.HEIGHT, "rounded-tile")} />
          ))
        ) : !anyReady ? (
          <NoticeTile
            glyph={CircleAlertIcon}
            title={t(`${K}.strip.unavailable_title`)}
            body={t(`${K}.strip.unavailable_body`)}
            action={
              <Button
                type="button"
                variant="ghost"
                onClick={() => onRetry()}
                className={NOTICE_ACTION}
              >
                <RefreshCcwIcon className={CHIP_GLYPH} aria-hidden="true" />
                {t(`${K}.strip.retry`)}
              </Button>
            }
          />
        ) : nothingInForce ? (
          <NoticeTile
            glyph={MinusCircleIcon}
            title={t(`${K}.strip.idle_title`)}
            body={t(`${K}.strip.idle_body`)}
          />
        ) : (
          <>
            <Tile
              glyph={RouteIcon}
              tone={ttlActive ? "success" : "neutral"}
              eyebrow={t(`${K}.tiles.ttl.label`)}
              caption={
                !ttlReady
                  ? pendingCaption(ttlPending)
                  : ttlActive
                    ? t(`${K}.tiles.ttl.caption_active`)
                    : t(`${K}.tiles.ttl.caption_idle`)
              }
            >
              <span className={TILE.VALUE_TEXT}>
                {ttlActive ? ttl.ttl : VALUE_NONE}
              </span>
            </Tile>

            <Tile
              glyph={WaypointsIcon}
              tone={hlActive ? "success" : "neutral"}
              eyebrow={t(`${K}.tiles.hl.label`)}
              caption={
                !ttlReady
                  ? pendingCaption(ttlPending)
                  : hlActive
                    ? t(`${K}.tiles.hl.caption_active`)
                    : t(`${K}.tiles.hl.caption_idle`)
              }
            >
              <span className={TILE.VALUE_TEXT}>
                {hlActive ? ttl.hl : VALUE_NONE}
              </span>
            </Tile>

            <Tile
              glyph={PackageIcon}
              tone={mtuActive ? "success" : "neutral"}
              eyebrow={t(`${K}.tiles.mtu.label`)}
              caption={
                !mtuReady
                  ? pendingCaption(mtuPending)
                  : mtuActive
                    ? t(`${K}.tiles.mtu.caption_active`, {
                        carrier: CARRIER_DEFAULT_MTU,
                      })
                    : t(`${K}.tiles.mtu.caption_idle`)
              }
            >
              {mtuReady ? (
                <>
                  <span className={TILE.VALUE_TEXT}>{mtu.currentValue}</span>
                  {/* A unit is metadata about the figure: a Tag, never a Badge. */}
                  <Tag variant="neutral">{t(`${K}.tiles.mtu.unit`)}</Tag>
                </>
              ) : (
                <span className={TILE.VALUE_TEXT}>{VALUE_NONE}</span>
              )}
            </Tile>
          </>
        )}
      </div>
    </section>
  );
}

export default TtlMtuStrip;
