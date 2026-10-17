"use client";

import * as React from "react";
import { motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2Icon,
  LinkIcon,
  MinusCircleIcon,
  RefreshCcwIcon,
  RouteIcon,
  TriangleAlertIcon,
  UsersIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import type { NetBirdPeer, NetBirdStatus } from "@/hooks/use-netbird";
import { rowCascadeDelay, transitionStandard } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { ConditionBlock } from "./condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_HEAD,
  CARD_HEAD_ACTIONS,
  CARD_HEAD_TEXT,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CROSSFADE_STACK,
  HEAD_TAG,
  SKELETON,
  TABLE,
} from "./shapes";

const MotionTableRow = motion.create(TableRow);

const peerRowItem: Variants = {
  hidden: { opacity: 0, y: 5 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { ...transitionStandard, delay: rowCascadeDelay(index) },
  }),
};

/** Anything before this is the pre-clock-step 1970 window, not a real reading. */
const CLOCK_SANE_MS = Date.UTC(2020, 0, 1);
/** A year. Past this the delta is arithmetic on a bad clock, not an age. */
const AGE_CEILING_MS = 365 * 24 * 60 * 60 * 1000;

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/**
 * The device has no battery RTC and boots at Jan 1970, so a delta taken before
 * the clock is stepped renders every peer as decades stale. Say unknown instead.
 */
function formatLastSeen(lastSeen: string, online: boolean, t: TFn): string {
  const common = { ns: "common" };
  if (online) return t("time.now", common);
  if (!lastSeen || lastSeen === "-") return t("time.unknown", common);

  const at = new Date(lastSeen).getTime();
  const now = Date.now();
  if (!Number.isFinite(at) || now < CLOCK_SANE_MS) {
    return t("time.unknown", common);
  }

  const diff = now - at;
  if (diff < 0 || diff > AGE_CEILING_MS) return t("time.unknown", common);

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t("time.just_now", common);
  if (minutes < 60) return t("time.minutes_ago", { ...common, count: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hours_ago", { ...common, count: hours });

  return t("time.days_ago", { ...common, count: Math.floor(hours / 24) });
}

export interface PeersCardProps {
  status: NetBirdStatus | null;
  isLoading: boolean;
  error?: string | null;
  onRetry: () => void;
}

export function PeersCard({
  status,
  isLoading,
  error,
  onRetry,
}: PeersCardProps) {
  const { t } = useTranslation("monitoring");
  const dash = t("netbird.peers.dash");

  const connected = status?.backend_state === "Connected";
  const peers: NetBirdPeer[] = (connected && status?.peers) || [];
  const onlineCount = peers.filter((p) => p.status === "Connected").length;
  const reportedCount = status?.peers_connected ?? 0;

  let body: React.ReactNode;
  if (!isLoading && !status && error) {
    body = (
      <ConditionBlock
        tone="destructive"
        icon={TriangleAlertIcon}
        title={t("netbird.peers.errorTitle")}
        description={error}
        actionLabel={t("netbird.actions.retry")}
        actionIcon={RefreshCcwIcon}
        onAction={onRetry}
      />
    );
  } else if (peers.length === 0 && connected && reportedCount > 0) {
    // The daemon counted peers but this build lists none of them.
    body = (
      <ConditionBlock
        tone="muted"
        icon={UsersIcon}
        title={t("netbird.peers.connectedCount", { count: reportedCount })}
        description={t("netbird.peers.noDetail")}
      />
    );
  } else if (peers.length === 0) {
    body = (
      <ConditionBlock
        tone="muted"
        icon={UsersIcon}
        title={
          connected
            ? t("netbird.peers.emptyTitle")
            : t("netbird.peers.offlineTitle")
        }
        description={
          connected
            ? t("netbird.peers.emptyDescription")
            : t("netbird.peers.offlineDescription")
        }
      />
    );
  } else {
    body = (
      <Table>
        <TableHeader>
          <TableRow className={TABLE.ROW}>
            <TableHead className={TABLE.HEAD}>
              {t("netbird.peers.colDevice")}
            </TableHead>
            <TableHead
              className={cn(TABLE.HEAD, "hidden @sm/card:table-cell")}
            >
              {t("netbird.peers.colAddress")}
            </TableHead>
            <TableHead
              className={cn(TABLE.HEAD, "hidden w-28 @sm/card:table-cell")}
            >
              {t("netbird.peers.colConnection")}
            </TableHead>
            <TableHead className={cn(TABLE.HEAD, "w-28")}>
              {t("netbird.peers.colStatus")}
            </TableHead>
            <TableHead
              className={cn(TABLE.HEAD, "hidden w-28 @md/card:table-cell")}
            >
              {t("netbird.peers.colLastSeen")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {peers.map((peer, i) => {
            const online = peer.status === "Connected";
            const p2p =
              peer.connection_type?.toLowerCase().includes("p2p") ||
              peer.direct?.toLowerCase() === "true";

            return (
              <MotionTableRow
                key={`${peer.hostname}-${peer.netbird_ip || i}`}
                className={cn(TABLE.ROW, TABLE.ROW_HEIGHT)}
                custom={i}
                variants={peerRowItem}
                initial="hidden"
                animate="visible"
              >
                {/* w-full + max-w-0 lets the name truncate instead of
                    widening the table; on a narrow card the address folds
                    under the name so the status column stays in view. */}
                <TableCell className={cn(TABLE.CELL, "w-full max-w-0")}>
                  <span className={TABLE.NAME} title={peer.hostname}>
                    {peer.hostname || t("netbird.peers.unnamed")}
                  </span>
                  <span className={TABLE.SUB_MONO}>
                    {peer.netbird_ip || dash}
                  </span>
                </TableCell>
                <TableCell
                  className={cn(TABLE.CELL_MONO, "hidden @sm/card:table-cell")}
                >
                  {peer.netbird_ip || dash}
                </TableCell>
                <TableCell
                  className={cn(TABLE.CELL, "hidden @sm/card:table-cell")}
                >
                  {online ? (
                    p2p ? (
                      <Badge variant="success">
                        <LinkIcon className="size-3" />
                        {t("netbird.peers.p2p")}
                      </Badge>
                    ) : (
                      // Relayed is a fact about the path, not a fault.
                      <Badge variant="info">
                        <RouteIcon className="size-3" />
                        {t("netbird.peers.relayed")}
                      </Badge>
                    )
                  ) : (
                    <span className="text-on-surface-variant text-xs">
                      {dash}
                    </span>
                  )}
                </TableCell>
                <TableCell className={TABLE.CELL}>
                  {online ? (
                    <Badge variant="success">
                      <CheckCircle2Icon className="size-3" />
                      {t("netbird.peers.online")}
                    </Badge>
                  ) : (
                    <Badge variant="muted">
                      <MinusCircleIcon className="size-3" />
                      {t("netbird.peers.offline")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell
                  className={cn(TABLE.CELL_MUTED, "hidden @md/card:table-cell")}
                >
                  {formatLastSeen(peer.last_seen, online, t as TFn)}
                </TableCell>
              </MotionTableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  }

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={cn(CARD_PAD, CARD_HEAD)}>
        <div className={CARD_HEAD_TEXT}>
          <CardTitle className={CARD_TITLE}>
            {t("netbird.peers.title")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t("netbird.peers.description")}
          </CardDescription>
        </div>
        {peers.length > 0 ? (
          <div className={CARD_HEAD_ACTIONS}>
            <Tag variant="neutral" className={HEAD_TAG}>
              {t("netbird.peers.countOnline", {
                online: onlineCount,
                total: peers.length,
              })}
            </Tag>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {/* Skeleton and table share ONE grid cell, so the swap costs no shift. */}
        <div className={cn(CROSSFADE_STACK, "flex-1")}>
          {isLoading && !status ? <PeersSkeleton /> : body}
        </div>
      </CardContent>
    </Card>
  );
}

/** Placeholder rows read the SAME pinned heights the real rows do, and take
 *  the table's own zero row gap, so the swap costs no height. */
function PeersSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className={SKELETON.TABLE_STACK} aria-hidden>
      <Skeleton className={SKELETON.HEAD} />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={SKELETON.ROW_SLOT}>
          <Skeleton className={SKELETON.ROW} />
        </div>
      ))}
    </div>
  );
}
