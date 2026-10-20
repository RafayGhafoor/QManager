"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowUpIcon,
  CheckCircle2Icon,
  CheckIcon,
  Loader2,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import type { UseTtlSettingsReturn } from "@/hooks/use-ttl-settings";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { cn } from "@/lib/utils";
import type { MutationResult } from "@/types/mutation-result";
import { BypassHotspotRow } from "./bypass-hotspot-row";
import { BackButton, ViewBody, ViewHeader } from "./card-view";
import { DrillRow, MetricRow } from "./metric-row";
import { PacketChart } from "./packet-chart";
import {
  CONTROL_COL,
  ENGINE_GRID,
  ENGINE_ROWS,
  HERO_PAD,
  HERO_SHELL,
  LABEL,
  LIVE,
  METRIC,
  MODE_REASON,
  ROWS,
  ROWS_3,
} from "./shapes";

export type EngineMode = "video" | "masquerade";
export type EngineChoice = EngineMode | "off";

/**
 * An in-flight engine change: `start` idle → on, `stop` on → idle, `switch`
 * one mode to the other, `apply` a running mode restarting on a new setting.
 */
export type EngineTransition = "start" | "stop" | "switch" | "apply";

const TRANSITION_KEY: Record<EngineTransition, string> = {
  start: "traffic_engine.state_starting",
  stop: "traffic_engine.state_stopping",
  switch: "traffic_engine.state_switching",
  apply: "traffic_engine.state_applying",
};

const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

/** The three-way mode control fills its column and splits it evenly. */
const MODE_FIELD =
  "@sm/card:w-full [&>[data-slot=toggle-group]]:w-full [&_[data-slot=toggle-group-item]]:min-w-0 [&_[data-slot=toggle-group-item]]:flex-1";

interface EngineCardProps {
  /** The mode the control shows: the target while a change is in flight. */
  shownMode: EngineChoice;
  /** The mode that owns the engine right now, or null when idle. */
  activeMode: EngineMode | null;
  transition: EngineTransition | null;
  kernelOk: boolean;
  onModeChange: (next: EngineChoice) => void;
  uptime: string;
  packets: number;
  history: readonly (number | null)[];
  ttl: UseTtlSettingsReturn;
  isUninstalling: boolean;
  onUninstall: () => Promise<MutationResult>;
  onUninstalled: () => void;
}

/**
 * The anchor. Live view: the mode control (one engine, one mode), Hotspot
 * bypass, uptime, packets and the Package drill row on the left; the outbound
 * packet chart on the right. Package view: queue support, the engine, its
 * source and Remove, so the destructive action never sits beside live stats.
 */
export function EngineCard({
  shownMode,
  activeMode,
  transition,
  kernelOk,
  onModeChange,
  uptime,
  packets,
  history,
  ttl,
  isUninstalling,
  onUninstall,
  onUninstalled,
}: EngineCardProps) {
  const { t } = useTranslation("local-network");
  const [view, setView] = useState<"live" | "package">("live");
  const [direction, setDirection] = useState<1 | -1>(1);
  const isPackage = view === "package";
  const running = activeMode !== null && transition === null;
  const engaged = activeMode !== null || transition !== null;
  const dash = t("traffic_engine.stat_empty");

  const open = (next: "live" | "package") => {
    setDirection(next === "package" ? 1 : -1);
    setView(next);
  };

  // The mode control already shows the steady state; the chip only narrates a change in flight.
  const chip = transition ? (
    <Badge variant="info">
      <Loader2 className="size-3 motion-safe:animate-spin" aria-hidden="true" />
      {t(TRANSITION_KEY[transition])}
    </Badge>
  ) : null;

  const last = history[history.length - 1];
  const rate = running && last !== null && last !== undefined ? last.toLocaleString() : dash;

  const remove = async () => {
    const result = await onUninstall();
    if (result.ok) {
      toast.success(t("traffic_engine.advanced_toast_success"));
      onUninstalled();
    } else {
      toast.error(
        resolveErrorMessage(t, result.code, result.error, t("traffic_engine.advanced_toast_error")),
      );
    }
  };

  const queueValue = kernelOk ? (
    t("traffic_engine.pkg_available")
  ) : (
    <Badge variant="destructive">
      <XCircleIcon className="size-3" aria-hidden="true" />
      {t("traffic_engine.pkg_missing")}
    </Badge>
  );
  const okGlyph = <CheckCircle2Icon className={METRIC.GLYPH} aria-hidden="true" />;

  return (
    <Card id="traffic-engine-engine" className={HERO_SHELL}>
      <ViewHeader
        viewKey={view}
        padClassName={HERO_PAD}
        title={isPackage ? t("traffic_engine.package_title") : t("traffic_engine.engine_title")}
        description={isPackage ? t("traffic_engine.package_desc") : t("traffic_engine.engine_desc")}
        action={
          chip || isPackage ? (
            <>
              <span aria-live="polite">{chip}</span>
              {isPackage ? <BackButton onBack={() => open("live")} /> : null}
            </>
          ) : undefined
        }
      />

      {isPackage ? (
        <ViewBody viewKey="package" direction={direction} className={HERO_PAD}>
          <div className={ROWS_3}>
            <MetricRow
              label={t("traffic_engine.pkg_queue")}
              value={queueValue}
              glyph={kernelOk ? okGlyph : undefined}
              quiet={kernelOk}
            />
            <MetricRow
              label={t("traffic_engine.pkg_engine")}
              value={t("traffic_engine.pkg_installed")}
              glyph={okGlyph}
              quiet
            />
            <MetricRow
              label={t("traffic_engine.pkg_source")}
              value={t("traffic_engine.pkg_source_value")}
              quiet
            />
          </div>
          <CardFoot
            status={
              engaged ? t("traffic_engine.pkg_status_busy") : t("traffic_engine.pkg_status_idle")
            }
            actions={
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={engaged || isUninstalling}>
                    {isUninstalling ? (
                      <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2Icon aria-hidden="true" />
                    )}
                    {isUninstalling
                      ? t("traffic_engine.advanced_removing")
                      : t("traffic_engine.advanced_remove_button")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("traffic_engine.advanced_dialog_title")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("traffic_engine.advanced_dialog_desc")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => void remove()}
                    >
                      {t("traffic_engine.advanced_dialog_confirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            }
          />
        </ViewBody>
      ) : (
        <ViewBody viewKey="live" direction={direction} className={HERO_PAD}>
          <CardContent className={cn("px-0", ENGINE_GRID)}>
            <div className={CONTROL_COL}>
              <span className={LABEL}>{t("traffic_engine.label_mode")}</span>
              <SegmentedField<EngineChoice>
                value={shownMode}
                onValueChange={onModeChange}
                ariaLabel={t("traffic_engine.aria_mode_selector")}
                disabled={!kernelOk || transition !== null}
                breakpoint="sm"
                glyph={renderCheckGlyph}
                className={MODE_FIELD}
                selectTriggerClassName="w-full text-[0.84375rem] font-medium px-4 @sm/card:hidden"
                options={[
                  { value: "off", label: t("traffic_engine.mode_off") },
                  { value: "video", label: t("traffic_engine.mode_video") },
                  { value: "masquerade", label: t("traffic_engine.mode_masquerade") },
                ]}
              />
              {!kernelOk ? (
                <p className={MODE_REASON}>{t("traffic_engine.mode_reason_kernel")}</p>
              ) : null}
              <BypassHotspotRow ttl={ttl} />
              <div className={cn(ROWS, ENGINE_ROWS)}>
                <MetricRow label={t("traffic_engine.tile_uptime")} value={running ? uptime : dash} quiet={!running} />
                <MetricRow
                  label={t("traffic_engine.metric_packets")}
                  value={running ? packets.toLocaleString() : dash}
                  quiet={!running}
                />
                {!engaged ? (
                  <DrillRow
                    label={t("traffic_engine.metric_package")}
                    ariaLabel={t("traffic_engine.aria_open_package")}
                    onOpen={() => open("package")}
                    quiet={kernelOk}
                    value={
                      kernelOk ? (
                        t("traffic_engine.pkg_installed")
                      ) : (
                        <Badge variant="destructive">
                          <XCircleIcon className="size-3" aria-hidden="true" />
                          {t("traffic_engine.pkg_queue_missing")}
                        </Badge>
                      )
                    }
                  />
                ) : null}
              </div>
            </div>

            <div className={LIVE.ROOT}>
              <div className={LIVE.HEAD}>
                <span className={LIVE.LEGEND}>
                  <span className={LIVE.LEGEND_DOT} aria-hidden="true" />
                  {t("traffic_engine.live_legend")}
                </span>
                <span className={LIVE.NUMERAL}>
                  <ArrowUpIcon
                    className={cn(LIVE.ARROW, running ? "opacity-100" : "opacity-0")}
                    aria-hidden="true"
                  />
                  <span className={cn(LIVE.RATE, running ? LIVE.RATE_ON : LIVE.RATE_OFF)}>{rate}</span>
                  <span className={LIVE.UNIT}>{t("traffic_engine.hero_rate_unit")}</span>
                </span>
              </div>
              <PacketChart history={history} live={running} />
            </div>
          </CardContent>
        </ViewBody>
      )}
    </Card>
  );
}
