"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftRightIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  EthernetPortIcon,
  GaugeIcon,
  HelpCircleIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  UnplugIcon,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TickGroup } from "@/components/ui/tick-group";
import { TickingValue } from "@/components/ui/ticking-value";
import { cn } from "@/lib/utils";

import {
  BAND,
  CAPTION,
  DISC_DOWN,
  DISC_NEUTRAL,
  DISC_TRANSITION,
  DISC_UP,
  EYEBROW,
  NOTICE_SPAN,
  NOTICE_TITLE,
  TILE,
  VALUE,
  VALUE_NONE,
  VALUE_TEXT,
} from "./shapes";
import type { EthernetStatus } from "./types";

// =============================================================================
// LinkStateStrip — the link band of /local-network/ethernet
// =============================================================================
// Ported from the RM520N fork. Four tiles (link state, negotiated rate, duplex,
// negotiation) replace the old card's pulse-ring illustration and receipt rows.
// Speed and duplex are properties of one negotiated link, so both read as an
// absence (em dash plus "Needs an active link") while it is down.
//
// The band chip has no healthy half: every figure is a poll read, so "live" is
// the resting state. It appears only when the last poll failed and there is a
// held reading for it to be a property of.
//
// The negotiation tile shows both facts: the VALUE is what the PHY is doing
// (`auto_negotiation`), the CAPTION is what it was told (`speed_limit`). When
// they disagree, that is what a technician opened the page to see.
// =============================================================================

const K = "ethernet";

/** Literal keys (not `option_${limit}`) so the i18n checker can resolve them. */
const LIMIT_LABEL_KEY: Record<string, string> = {
  "10": `${K}.settings.option_10`,
  "100": `${K}.settings.option_100`,
  "1000": `${K}.settings.option_1000`,
  "2500": `${K}.settings.option_2500`,
};

function Tile({
  glyph: Glyph,
  disc = DISC_NEUTRAL,
  animate = false,
  eyebrow,
  children,
  caption,
}: {
  glyph: LucideIcon;
  disc?: string;
  /** Only the link tile's disc changes at runtime, so only it transitions. */
  animate?: boolean;
  eyebrow: string;
  children: React.ReactNode;
  caption: React.ReactNode;
}) {
  return (
    <div className={cn(TILE.ROOT, TILE.BODY)}>
      <span className={cn(TILE.DISC, animate && DISC_TRANSITION, disc)}>
        <Glyph className={TILE.GLYPH} aria-hidden="true" />
      </span>
      <div className={TILE.TEXT}>
        <span className={EYEBROW}>{eyebrow}</span>
        <span className={VALUE}>{children}</span>
        <span className={CAPTION}>{caption}</span>
      </div>
    </div>
  );
}

/** One tile spanning the grid, for a failed first read or a missing controller. */
function NoticeTile({
  glyph: Glyph,
  title,
  body,
}: {
  glyph: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <div className={cn(TILE.ROOT, TILE.BODY, NOTICE_SPAN)} role="status">
      <span className={cn(TILE.DISC, DISC_NEUTRAL)}>
        <Glyph className={TILE.GLYPH} aria-hidden="true" />
      </span>
      <div className={TILE.TEXT}>
        <span className={NOTICE_TITLE}>{title}</span>
        <span className={CAPTION}>{body}</span>
      </div>
    </div>
  );
}

/** `"2500Mb/s"` -> `"2.5 Gbps"`; no reading -> em dash. */
function formatSpeed(speed: string): string {
  if (!speed || speed === "Unknown") return VALUE_NONE;
  const match = speed.match(/^(\d+)Mb\/s$/);
  if (match) {
    const mbps = parseInt(match[1], 10);
    if (mbps >= 1000) return `${mbps / 1000} Gbps`;
    return `${mbps} Mbps`;
  }
  return speed;
}

export interface LinkStateStripProps {
  /** The GET's payload. `null` until the first read lands. */
  status: EthernetStatus | null;
  /** True until the first read resolves, either way. */
  isLoading: boolean;
  /** True when the most recent poll failed (set on every failure, cleared on every success). */
  pollFailed: boolean;
}

export function LinkStateStrip({
  status,
  isLoading,
  pollFailed,
}: LinkStateStripProps) {
  const { t } = useTranslation("local-network");

  const present = status?.interface_present !== false;
  const ready = status !== null;
  const failed = !ready && !isLoading && pollFailed;
  const isConnected = status?.link_status === "up";

  // The three link states never share a glyph: success and warning containers
  // measure 1.03:1 apart, so the glyph carries the state.
  const linkSpec = isConnected
    ? {
        disc: DISC_UP,
        glyph: CheckCircle2Icon,
        value: t(`${K}.tiles.link.value_up`),
        caption: t(`${K}.tiles.link.caption_up`),
      }
    : status?.link_status === "down"
      ? {
          disc: DISC_DOWN,
          glyph: UnplugIcon,
          value: t(`${K}.tiles.link.value_down`),
          caption: t(`${K}.tiles.link.caption_down`),
        }
      : {
          disc: DISC_NEUTRAL,
          glyph: HelpCircleIcon,
          value: t(`${K}.tiles.link.value_unknown`),
          caption: t(`${K}.tiles.link.caption_unknown`),
        };

  const rate = isConnected ? formatSpeed(status?.speed ?? "") : VALUE_NONE;
  const duplex =
    isConnected && status?.duplex === "full"
      ? t(`${K}.tiles.duplex.value_full`)
      : isConnected && status?.duplex === "half"
        ? t(`${K}.tiles.duplex.value_half`)
        : VALUE_NONE;

  // The ceiling answers "am I getting the port's full speed?".
  const rateCaption = !isConnected
    ? t(`${K}.tiles.speed.caption_down`)
    : status?.supports_2500
      ? t(`${K}.tiles.speed.caption_ceiling`, {
          ceiling: t(`${K}.settings.option_2500`),
        })
      : t(`${K}.tiles.speed.caption`);

  const autoNeg = status?.auto_negotiation;
  const negotiationValue =
    autoNeg === "on"
      ? t(`${K}.tiles.negotiation.value_auto`)
      : autoNeg === "off"
        ? t(`${K}.tiles.negotiation.value_forced`)
        : t(`${K}.tiles.negotiation.value_unknown`);

  // The CGI validates the saved limit against the same five values, so an
  // unrecognised one only reaches the "no limit" fallback on a broken backend.
  const limitKey = status ? LIMIT_LABEL_KEY[status.speed_limit] : undefined;
  const negotiationCaption = limitKey
    ? t(`${K}.tiles.negotiation.caption_limited`, { speed: t(limitKey) })
    : t(`${K}.tiles.negotiation.caption_auto`);

  return (
    <section aria-label={t(`${K}.strip.label`)} className="flex flex-col gap-2">
      <div className={BAND.HEAD}>
        <span className={BAND.LABEL}>{t(`${K}.strip.label`)}</span>
        {ready && present && pollFailed ? (
          <Badge variant="warning">
            <TriangleAlertIcon className={BAND.GLYPH} aria-hidden="true" />
            {t(`${K}.strip.unresponsive`)}
          </Badge>
        ) : null}
      </div>

      <div className={TILE.GRID}>
        {ready && !present ? (
          // A designed outcome, not a fault: the copy states the hardware fact.
          <NoticeTile
            glyph={EthernetPortIcon}
            title={t(`${K}.strip.absent_title`)}
            body={t(`${K}.strip.absent_body`)}
          />
        ) : ready ? (
          // Only the rate ticks; the other three are categories that hold for hours.
          <TickGroup>
            <Tile
              glyph={linkSpec.glyph}
              disc={linkSpec.disc}
              animate
              eyebrow={t(`${K}.tiles.link.label`)}
              caption={linkSpec.caption}
            >
              <span className={VALUE_TEXT}>{linkSpec.value}</span>
            </Tile>

            <Tile
              glyph={GaugeIcon}
              eyebrow={t(`${K}.tiles.speed.label`)}
              caption={rateCaption}
            >
              <TickingValue value={rate} className={VALUE_TEXT}>
                {rate}
              </TickingValue>
            </Tile>

            <Tile
              glyph={ArrowLeftRightIcon}
              eyebrow={t(`${K}.tiles.duplex.label`)}
              caption={t(
                isConnected
                  ? `${K}.tiles.duplex.caption`
                  : `${K}.tiles.duplex.caption_down`,
              )}
            >
              <span className={VALUE_TEXT}>{duplex}</span>
            </Tile>

            <Tile
              glyph={SlidersHorizontalIcon}
              eyebrow={t(`${K}.tiles.negotiation.label`)}
              caption={negotiationCaption}
            >
              <span className={VALUE_TEXT}>{negotiationValue}</span>
            </Tile>
          </TickGroup>
        ) : failed ? (
          <NoticeTile
            glyph={CircleAlertIcon}
            title={t(`${K}.strip.unavailable_title`)}
            body={t(`${K}.strip.unavailable_body`)}
          />
        ) : (
          Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className={cn(TILE.HEIGHT, "rounded-tile")} />
          ))
        )}
      </div>
    </section>
  );
}

export default LinkStateStrip;
