"use client";

import { useTranslation } from "react-i18next";

import { CONDITION_TONE } from "@/components/cellular/condition-screen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SaveButton } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { bandsToDisplay } from "@/types/connection-scenario";
import type { Scenario } from "./scenario-item";

// =============================================================================
// ActiveConfigCard — the Selected-scenario card
// =============================================================================
// Shows the configuration of the tile the user selected and commits it from
// the CardFoot: Activate is the SaveButton, last on the right. Delete and Edit
// (custom scenarios only) sit before it. When the active profile's schedule
// owns scenario selection, Activate is withheld and the foot says why.
// =============================================================================

const ROW =
  "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm";

interface ActiveConfigCardProps {
  scenario: Scenario | undefined;
  /** Translated network-mode label, derived from `atModeValue`. */
  modeLabel: string;
  /** Translated optimization label. */
  optimizationLabel: string;
  isActive: boolean;
  isActivating: boolean;
  isLoading: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onActivate: () => void;
  /** True when the active profile's schedule controls scenario selection. */
  scheduleLocked: boolean;
  /** "HH:MM" of the next scheduled transition (shown while locked). */
  nextChangeAt: string | null;
}

export const ActiveConfigCard = ({
  scenario,
  modeLabel,
  optimizationLabel,
  isActive,
  isActivating,
  isLoading,
  onEdit,
  onDelete,
  onActivate,
  scheduleLocked,
  nextChangeAt,
}: ActiveConfigCardProps) => {
  const { t } = useTranslation("cellular");
  const K = "scenarios.active_config_card";

  if (isLoading || !scenario) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="grid">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={ROW}>
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </CardContent>
        <CardFoot
          className="px-6"
          liveStatus={false}
          aria-hidden="true"
          actions={<Skeleton className="h-[2.625rem] w-32 rounded-pill" />}
        />
      </Card>
    );
  }

  const isCustom = !scenario.isDefault;
  const info = CONDITION_TONE.primary;

  const chip = scheduleLocked
    ? { variant: "info" as const, glyph: "lock_clock" as const, label: t("scenarios.schedule_lock.badge") }
    : isActive
      ? { variant: "success" as const, glyph: "check_circle" as const, label: t(`${K}.status.active`) }
      : { variant: "muted" as const, glyph: "do_not_disturb_on" as const, label: t(`${K}.status.not_active`) };

  const rows: { label: string; value: string }[] = [
    { label: t(`${K}.config_labels.network_mode`), value: modeLabel },
    { label: t(`${K}.config_labels.optimization`), value: optimizationLabel },
    { label: t(`${K}.config_labels.lte_bands`), value: bandsToDisplay(scenario.config.lte_bands, t) },
    { label: t(`${K}.config_labels.nrsa_bands`), value: bandsToDisplay(scenario.config.sa_nr_bands, t) },
    { label: t(`${K}.config_labels.nrsa_nsa_bands`), value: bandsToDisplay(scenario.config.nsa_nr_bands, t) },
  ];

  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <CardTitle>{t(`${K}.configuration`, { name: scenario.name })}</CardTitle>
            <CardDescription>{scenario.description}</CardDescription>
          </div>
          <Badge variant={chip.variant} className="flex-none">
            <MaterialSymbol name={chip.glyph} size={12} />
            {chip.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid divide-y divide-border @3xl/card:grid-cols-2 @3xl/card:gap-x-8 @3xl/card:divide-y-0">
          {rows.map((row) => (
            <div key={row.label} className={ROW}>
              <span className="text-on-surface-variant">{row.label}</span>
              <span className="font-semibold tabular-nums">{row.value}</span>
            </div>
          ))}
        </div>

        {scheduleLocked ? (
          <div
            role="status"
            className={cn("flex items-start gap-3 rounded-tile px-4 py-3", info.container)}
          >
            <MaterialSymbol name="lock_clock" size={18} className="mt-px flex-none" />
            <div className="grid gap-0.5 text-sm">
              <p>{t("scenarios.schedule_lock.hint")}</p>
              {nextChangeAt ? (
                <p className="text-xs tabular-nums opacity-80">
                  {t("scenarios.schedule_lock.next_change", { time: nextChangeAt })}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </CardContent>

      <CardFoot
        className="px-6"
        status={
          isActive && !scheduleLocked ? t(`${K}.running_note`) : null
        }
        actions={
          <>
            {isCustom ? (
              <>
                <Button type="button" variant="ghost" size="action" onClick={onDelete}>
                  <MaterialSymbol name="delete" size={18} />
                  {t("scenarios.scenario_item.delete_confirm.confirm")}
                </Button>
                <Button type="button" variant="tonal-neutral" size="action" onClick={onEdit}>
                  <MaterialSymbol name="edit" size={18} />
                  {t(`${K}.edit`)}
                </Button>
              </>
            ) : null}
            {!scheduleLocked ? (
              <SaveButton
                type="button"
                onClick={onActivate}
                isSaving={isActivating}
                saved={false}
                disabled={isActive}
                label={t(`${K}.activate`)}
                size="action"
              />
            ) : null}
          </>
        }
      />
    </Card>
  );
};
