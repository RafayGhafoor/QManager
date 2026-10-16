"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2Icon, Loader2, MinusCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { EngineTransition, ViewMode } from "./traffic-engine";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_HEAD,
  CARD_PAD,
  CARD_TITLE,
  EYEBROW,
  HERO_SHELL,
  SKELETON,
  STAT,
} from "./shapes";

interface EngineStatusCardProps {
  /** Which mode owns the running engine, or null when idle. */
  activeMode: ViewMode | null;
  /** Live stats of the running mode. Ignored visually while idle. */
  uptime: string;
  packets: number;
  rate: number;
  /** SNI domain, for the masquerading chip label. */
  sniDomain?: string;
  /**
   * In-flight engine transition, or undefined when settled. Drives a busy chip
   * and placeholder stats so start, stop and switch all have a loading state,
   * and the chip isn't contradicted by a stale reading during the ~1s poll gap.
   */
  transition?: EngineTransition;
  /** The idle-only remove row. The composer passes it only while settled-idle,
   *  so a destructive action never sits under live stats. */
  footer?: ReactNode;
}

function Stat({
  label,
  value,
  unit,
  live,
  loading,
}: {
  label: string;
  value: string;
  unit?: string;
  live: boolean;
  loading?: boolean;
}) {
  return (
    <div className={STAT.ROOT}>
      <span className={EYEBROW}>{label}</span>
      {loading ? (
        <Skeleton className={SKELETON.STAT} />
      ) : (
        <span className={STAT.VALUE_ROW}>
          <span
            className={cn(
              STAT.VALUE,
              STAT.TRANSITION,
              live ? STAT.VALUE_ON : STAT.VALUE_OFF,
            )}
          >
            {value}
          </span>
          {unit ? <span className={STAT.UNIT}>{unit}</span> : null}
        </span>
      )}
    </div>
  );
}

/**
 * The anchor of the page. It reports what the single packet engine is doing
 * right now: a state chip in the header and three tabular readouts. No control
 * lives here (enable and disable belong to each mode card).
 */
export function EngineStatusCard({
  activeMode,
  uptime,
  packets,
  rate,
  sniDomain,
  transition,
  footer,
}: EngineStatusCardProps) {
  const { t } = useTranslation("local-network");
  const running = activeMode !== null;
  const transitioning = !!transition;
  const dash = t("traffic_engine.stat_empty");

  // A transition outranks the steady state: during a switch the outgoing mode
  // still reads "running" for a beat, and the chip should say "Switching".
  const chip = transitioning ? (
    <Badge variant="info">
      <Loader2 className="size-3 motion-safe:animate-spin" aria-hidden="true" />
      {t(
        transition === "stop"
          ? "traffic_engine.state_stopping"
          : transition === "switch"
            ? "traffic_engine.state_switching"
            : "traffic_engine.state_starting",
      )}
    </Badge>
  ) : running ? (
    <Badge variant="success">
      <CheckCircle2Icon className="size-3" aria-hidden="true" />
      {activeMode === "video"
        ? t("traffic_engine.state_protecting")
        : t("traffic_engine.state_masquerading", { domain: sniDomain })}
    </Badge>
  ) : (
    <Badge variant="muted">
      <MinusCircleIcon className="size-3" aria-hidden="true" />
      {t("traffic_engine.state_idle")}
    </Badge>
  );

  return (
    <Card className={HERO_SHELL}>
      <CardHeader className={`${CARD_PAD} ${CARD_HEAD.ROOT}`}>
        <div className={CARD_HEAD.TEXT}>
          <CardTitle className={CARD_TITLE}>
            {t("traffic_engine.engine_status_label")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t("traffic_engine.status_card_description")}
          </CardDescription>
        </div>
        {/* The live region sits on the chip (it changes only on transitions),
            not on the stats, which tick every poll. The chip drops under the
            title on a narrow card so a long domain never squeezes it. */}
        <div className={CARD_HEAD.ACTIONS} aria-live="polite">
          {chip}
        </div>
      </CardHeader>
      <CardContent className={`${CARD_PAD} ${CARD_BODY}`}>
        <div className={STAT.GRID}>
          <Stat
            label={t("traffic_engine.tile_uptime")}
            value={running ? uptime : dash}
            live={running}
            loading={transitioning}
          />
          <Stat
            label={t("traffic_engine.stat_packets")}
            value={running ? packets.toLocaleString() : dash}
            live={running}
            loading={transitioning}
          />
          <Stat
            label={t("traffic_engine.hero_rate_label")}
            value={running ? rate.toLocaleString() : dash}
            unit={running ? t("traffic_engine.hero_rate_unit") : undefined}
            live={running}
            loading={transitioning}
          />
        </div>
        {footer}
      </CardContent>
    </Card>
  );
}

/** The status card's placeholder: same shell, same stat grid. */
export function EngineStatusSkeleton() {
  return (
    <Card className={HERO_SHELL} aria-hidden="true">
      <CardHeader className={`${CARD_PAD} ${CARD_HEAD.ROOT}`}>
        <div className={CARD_HEAD.TEXT}>
          <Skeleton className={SKELETON.TITLE} />
          <Skeleton className={SKELETON.DESC} />
        </div>
        <div className={CARD_HEAD.ACTIONS}>
          <Skeleton className={SKELETON.BADGE} />
        </div>
      </CardHeader>
      <CardContent className={`${CARD_PAD} ${CARD_BODY}`}>
        <div className={STAT.GRID}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={STAT.ROOT}>
              <Skeleton className={SKELETON.EYEBROW} />
              <Skeleton className={SKELETON.STAT} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
