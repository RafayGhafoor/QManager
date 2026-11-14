"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  CircleAlertIcon,
  CircleSlashIcon,
  RefreshCcwIcon,
  TriangleAlertIcon,
  CheckCircle2Icon,
  Trash2Icon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { SmartDnsStatus } from "@/types/smartdns";

import { formatDuration, formatMoment, formatNumber } from "./format";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION,
  LOG,
  READOUT,
  SECTION_LABEL,
  SETTING,
  SKELETON,
} from "./shapes";

// =============================================================================
// StatusCard — what the resolver is doing, and what it is doing it with
// =============================================================================
// The page's first card and the only one that reports rather than edits.
//
// -----------------------------------------------------------------------------
// `enabled`, `running` AND `listening` ARE THREE FACTS, AND ALL THREE ARE DRAWN
// -----------------------------------------------------------------------------
// `enabled` is what was asked for. `running` is a process. `listening` is a
// socket. They come apart in the two ways that matter most:
//
//   enabled, not running  — the service failed to start (bad config, no binary)
//   running, not listening — it started and could not bind its port
//
// Collapsing them into one chip is exactly how a resolver that answers nothing
// renders as healthy, so the chip states the combination and the readouts carry
// the raw facts beside it.
//
// The card also owns the removal action, because the package is the resolver and
// a "Remove" button belongs next to the thing it removes. It is only reachable
// with the resolver switched off, and it asks first.
// =============================================================================

const K = "smartdns";

type StatusState =
  | "running"
  | "enabled_stopped"
  | "running_unbound"
  | "stopped"
  | "wired_only";

const STATE_BADGE = {
  running: "success",
  enabled_stopped: "warning",
  running_unbound: "warning",
  stopped: "muted",
  wired_only: "warning",
} as const;

const STATE_GLYPH = {
  running: CheckCircle2Icon,
  enabled_stopped: TriangleAlertIcon,
  running_unbound: TriangleAlertIcon,
  stopped: CircleSlashIcon,
  wired_only: TriangleAlertIcon,
} as const;

export interface StatusCardProps {
  status: SmartDnsStatus | null;
  isLoading: boolean;
  isRemoving: boolean;
  /** The last failure, already translated; null when the last read succeeded. */
  error: string | null;
  onRefresh: () => void;
  onRemove: () => void;
}

export function StatusCard({
  status,
  isLoading,
  isRemoving,
  error,
  onRefresh,
  onRemove,
}: StatusCardProps) {
  const { t, i18n } = useTranslation("local-network");

  const state: StatusState = status?.running
    ? status.listening
      ? "running"
      : "running_unbound"
    : status?.enabled
      ? "enabled_stopped"
      : status?.wired
        ? "wired_only"
        : "stopped";
  const StateGlyph = STATE_GLYPH[state];

  const dash = "—";
  const units = {
    day: t(`${K}.duration.day`),
    hour: t(`${K}.duration.hour`),
    minute: t(`${K}.duration.minute`),
    second: t(`${K}.duration.second`),
  };

  const memory =
    status?.rss_kb === null || status?.rss_kb === undefined
      ? null
      : `${formatNumber(status.rss_kb / 1024, i18n.language, 1)} ${t(`${K}.units.mb`)}`;

  const readouts: { key: string; label: string; value: string; mono?: boolean }[] = [
    {
      key: "port",
      label: t(`${K}.status.readout.port`),
      // Just the number: a loopback address on screen reads as a path, and the
      // fact that only the router's own daemons reach it is in the card
      // description instead.
      value: formatNumber(status?.port ?? null, i18n.language) ?? dash,
    },
    {
      key: "upstreams",
      label: t(`${K}.status.readout.upstreams`),
      value: formatNumber(status?.upstream_count ?? null, i18n.language) ?? dash,
    },
    {
      key: "uptime",
      label: t(`${K}.status.readout.uptime`),
      value:
        status?.running && status.uptime_sec !== null
          ? (formatDuration(status.uptime_sec, units) ?? dash)
          : dash,
    },
    {
      key: "memory",
      label: t(`${K}.status.readout.memory`),
      value: status?.running ? (memory ?? dash) : dash,
    },
    {
      key: "cache",
      label: t(`${K}.status.readout.cache`),
      value: formatNumber(status?.cache_size ?? null, i18n.language) ?? dash,
    },
    {
      key: "fallback",
      label: t(`${K}.status.readout.fallback`),
      value: formatNumber(status?.carrier_resolvers.length ?? null, i18n.language) ?? dash,
    },
    {
      key: "config",
      label: t(`${K}.status.readout.config`),
      value: formatMoment(status?.config_mtime ?? null, i18n.language) ?? dash,
    },
    {
      key: "logged",
      label: t(`${K}.status.readout.log_lines`),
      value: formatNumber(status?.logs_tail.length ?? null, i18n.language) ?? dash,
    },
  ];

  // The carrier fallback is the load-bearing fact behind "this cannot break your
  // DNS", so it is spelled out when there is one rather than only counted.
  const fallbackList = status?.carrier_resolvers ?? [];
  const logs = status?.logs_tail ?? [];

  const pending = isLoading && status === null;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.status.title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`${K}.status.description`)}
        </CardDescription>
        {status ? (
          <CardAction className="flex flex-wrap items-center gap-2">
            <Badge variant={STATE_BADGE[state]}>
              <StateGlyph className="size-3" aria-hidden="true" />
              {t(`${K}.status.state.${state}`)}
            </Badge>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={status.enabled || isRemoving}
                  title={
                    status.enabled
                      ? t(`${K}.status.remove.blocked`)
                      : t(`${K}.status.remove.label`)
                  }
                >
                  <Trash2Icon className="size-4" aria-hidden="true" />
                  {t(`${K}.status.remove.label`)}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t(`${K}.status.remove.confirm_title`)}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t(`${K}.status.remove.confirm_body`)}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    {t("common:actions.cancel")}
                  </AlertDialogCancel>
                  <AlertDialogAction onClick={onRemove}>
                    {t(`${K}.status.remove.confirm_action`)}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        {pending ? (
          <div className="flex flex-col gap-4" aria-hidden="true">
            <div className="grid grid-cols-2 gap-3 @2xl/card:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className={SKELETON.READOUT} />
              ))}
            </div>
            <Skeleton className="h-24 w-full rounded-tile" />
          </div>
        ) : error !== null && status === null ? (
          <div role="alert" className={CONDITION.ROOT}>
            <span aria-hidden="true" className={CONDITION.DISC}>
              <CircleAlertIcon className={CONDITION.GLYPH} />
            </span>
            <div className={CONDITION.TEXT}>
              <p className={CONDITION.TITLE}>{t(`${K}.error_load_title`)}</p>
              <p className={CONDITION.BODY}>{error ?? t(`${K}.error_load_body`)}</p>
            </div>
            <Button variant="ghost" onClick={onRefresh} className={CONDITION.ACTION}>
              <RefreshCcwIcon className="size-4" aria-hidden="true" />
              {t("common:actions.retry")}
            </Button>
          </div>
        ) : (
          <>
            <div className={READOUT.GRID}>
              {readouts.map((row) => (
                <div key={row.key} className={READOUT.ROOT}>
                  <span className={READOUT.KEY}>{row.label}</span>
                  <span
                    className={row.mono ? READOUT.VALUE_MONO : READOUT.VALUE}
                    title={row.mono ? row.value : undefined}
                  >
                    {row.value}
                  </span>
                </div>
              ))}
            </div>

            {status?.lan_dns ? (
              <div className={SETTING.ROW}>
                <div className={SETTING.KEY}>
                  <span className={SETTING.KEY_LINE}>
                    {t(`${K}.status.fallback.label`)}
                  </span>
                  <span className={SETTING.KEY_SUB}>
                    {fallbackList.length > 0
                      ? t(`${K}.status.fallback.present`, {
                          servers: fallbackList.join(", "),
                        })
                      : t(`${K}.status.fallback.absent`)}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <span className={SECTION_LABEL}>{t(`${K}.status.log.title`)}</span>
              {logs.length > 0 ? (
                <div className={LOG.VIEWPORT}>
                  <pre className={LOG.BODY}>
                    {logs.map((line, index) => (
                      <span key={`${index}-${line}`}>{line}</span>
                    ))}
                  </pre>
                </div>
              ) : (
                <span className={LOG.EMPTY}>{t(`${K}.status.log.empty`)}</span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default StatusCard;
