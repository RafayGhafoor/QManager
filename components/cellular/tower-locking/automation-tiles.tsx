"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { HintIcon } from "@/components/ui/hint-icon";
import { Input } from "@/components/ui/input";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { SegmentedField } from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import {
  rsrpToQualityPercent,
  type TowerActionResult,
  type TowerFailoverState,
  type TowerLockConfig,
  type TowerModemState,
  type TowerScheduleConfig,
} from "@/types/tower-locking";

import ScheduleTile from "./schedule-tile";
import { writeTowerSettings, type UpdateTowerSettings } from "./settings-write";
import {
  AUTO_GRID,
  AUTO_METER,
  AUTO_TILE,
  BADGE_GLYPH_SIZE,
  FAILOVER_BADGE,
  FIELD_CONTROL,
  SKELETON_SHAPE,
  failoverKey,
  lockPresence,
  type TowerFailoverKey,
} from "./shapes";

// =============================================================================
// TowerAutomationTiles — what the lock does while nobody is watching
// =============================================================================
// Two tiles: release the lock when signal collapses (failover) and apply it on
// a daily window (schedule). Each reports the SAVED state (config) and, where
// the modem has an opinion, the LIVE state separately: the failover chip is the
// watcher's. The threshold renders empty until it has actually been read, never
// a plausible default. Keep-after-reboot lives under the leg cards
// (`persist-toggle.tsx`); it shares this tile's settings write.
// =============================================================================

const K = "cell_locking.tower_locking";

const FAILOVER_STATE_LABEL: Record<TowerFailoverKey, string> = {
  disabled: `${K}.automation.failover_state_disabled`,
  ready: `${K}.automation.failover_state_ready`,
  watching: `${K}.automation.failover_state_watching`,
  released: `${K}.automation.failover_state_released`,
  stalled: `${K}.automation.failover_state_stalled`,
  unknown: `${K}.automation.failover_state_unknown`,
};

const renderCheckGlyph = (className: string) => (
  <MaterialSymbol
    name="check"
    size={16}
    className={className}
    aria-hidden="true"
  />
);

export interface TowerAutomationTilesProps {
  config: TowerLockConfig | null;
  modemState: TowerModemState | null;
  failover: TowerFailoverState | null;
  /** RSRP of the leg the modem is registered on; null when unreported. */
  activeRsrp: number | null;
  isLoading: boolean;
  isSavingSettings: boolean;
  onUpdateSettings: UpdateTowerSettings;
  onScheduleChange: (schedule: TowerScheduleConfig) => Promise<TowerActionResult>;
}

export function TowerAutomationTiles({
  config,
  modemState,
  failover,
  activeRsrp,
  isLoading,
  isSavingSettings,
  onUpdateSettings,
  onScheduleChange,
}: TowerAutomationTilesProps) {
  const { t } = useTranslation("cellular");
  const { saved, markSaved } = useSaveFlash();

  // `null`, never a default: an unread threshold is an empty field.
  const savedThreshold = config ? config.failover.threshold : null;
  const savedText = savedThreshold === null ? "" : String(savedThreshold);
  const [thresholdInput, setThresholdInput] = useState(savedText);
  const [prevThreshold, setPrevThreshold] = useState(savedThreshold);
  if (savedThreshold !== prevThreshold) {
    setPrevThreshold(savedThreshold);
    setThresholdInput(savedText);
  }

  const parsedThreshold = Number.parseInt(thresholdInput, 10);
  const thresholdValid =
    /^\d{1,3}$/.test(thresholdInput.trim()) &&
    parsedThreshold >= 0 &&
    parsedThreshold <= 100;
  const thresholdBlank = thresholdInput.trim() === "";
  const thresholdDirty = thresholdInput !== savedText;
  const thresholdErrored = !thresholdBlank && !thresholdValid;
  const thresholdUnread = savedThreshold === null;

  const handleFailover = async (next: boolean) => {
    if (!config || next === config.failover.enabled) return;
    await writeTowerSettings(
      t,
      onUpdateSettings,
      config.persist,
      { ...config.failover, enabled: next },
      next
        ? t(`${K}.toast.failover_enabled`)
        : t(`${K}.toast.failover_disabled`),
    );
  };

  const handleThresholdSave = async () => {
    if (!config || !thresholdValid) return;
    const ok = await writeTowerSettings(
      t,
      onUpdateSettings,
      config.persist,
      { ...config.failover, threshold: parsedThreshold },
      t(`${K}.toast.threshold_saved`),
    );
    if (ok) markSaved();
  };

  const presence = lockPresence(modemState);
  const failState = failoverKey(
    failover ?? { enabled: false, activated: false, watcher_running: false },
    presence,
  );
  const failBadge = FAILOVER_BADGE[failState];

  const qualityPct =
    activeRsrp === null ? null : rsrpToQualityPercent(activeRsrp);

  if (isLoading) {
    return (
      <div className={AUTO_GRID}>
        {[0, 1].map((i) => (
          <Skeleton key={i} className={SKELETON_SHAPE.AUTO_TILE} />
        ))}
      </div>
    );
  }

  const controlsDisabled = !config || isSavingSettings;

  return (
    <motion.div
      className={AUTO_GRID}
      initial="hidden"
      animate="visible"
      variants={staggerRows}
    >
      {/* --- Signal failover (whole modem, both radios) ------------------- */}
      <motion.div variants={staggerRowItem} className={AUTO_TILE.ROOT}>
        <div className={AUTO_TILE.HEAD}>
          <span className={AUTO_TILE.DISC} aria-hidden="true">
            <MaterialSymbol name="shield" size={20} />
          </span>
          <span className={AUTO_TILE.TITLE}>
            {t(`${K}.automation.failover_label`)}
          </span>
          <HintIcon label={t(`${K}.automation.failover_help_label`)}>
            {t(`${K}.automation.failover_help`)}
          </HintIcon>
          <div className="ml-auto" role="group">
            <SegmentedField
              value={config?.failover.enabled ? "on" : "off"}
              onValueChange={(v) => void handleFailover(v === "on")}
              options={[
                { value: "off", label: t("state.off", { ns: "common" }) },
                { value: "on", label: t("state.on", { ns: "common" }) },
              ]}
              ariaLabel={t(`${K}.automation.failover_label`)}
              disabled={controlsDisabled}
              breakpoint="never"
              glyph={renderCheckGlyph}
            />
          </div>
        </div>

        <Badge variant={failBadge.variant} className="self-start">
          <MaterialSymbol name={failBadge.glyph} size={BADGE_GLYPH_SIZE} />
          {t(FAILOVER_STATE_LABEL[failState])}
        </Badge>

        {/* Locking never turns failover on by itself. */}
        {presence === "present" && failState === "disabled" ? (
          <p className={AUTO_TILE.BODY}>
            {t(`${K}.automation.failover_hint`)}
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="tower-failover-threshold"
            className={AUTO_TILE.BODY}
          >
            {t(`${K}.automation.threshold_label`)}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-[6.5rem]">
              <Input
                id="tower-failover-threshold"
                inputMode="numeric"
                autoComplete="off"
                host="container"
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleThresholdSave();
                }}
                disabled={controlsDisabled}
                aria-invalid={thresholdErrored || undefined}
                aria-describedby={
                  thresholdErrored
                    ? "tower-failover-threshold-note"
                    : thresholdUnread
                      ? "tower-failover-threshold-note"
                      : undefined
                }
                placeholder={t(`${K}.live.tile_no_value`)}
                className={`${FIELD_CONTROL} pr-8 text-center`}
              />
              <span
                aria-hidden="true"
                className="text-on-surface-variant pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm"
              >
                %
              </span>
            </div>
            {thresholdDirty || saved ? (
              <SaveButton
                onClick={handleThresholdSave}
                isSaving={isSavingSettings}
                saved={saved}
                label={t(`${K}.actions.update`)}
                blockedReason={
                  thresholdBlank
                    ? t(`${K}.blocked.threshold_empty`)
                    : thresholdValid
                      ? null
                      : t(`${K}.automation.threshold_invalid`)
                }
                size="action"
              />
            ) : null}
          </div>
          {thresholdErrored ? (
            <p
              id="tower-failover-threshold-note"
              role="alert"
              className="text-destructive-on-surface text-xs"
            >
              {t(`${K}.automation.threshold_invalid`)}
            </p>
          ) : thresholdUnread ? (
            <p
              id="tower-failover-threshold-note"
              className="text-on-surface-variant text-xs"
            >
              {t(`${K}.automation.threshold_unread`)}
            </p>
          ) : null}
        </div>

        {/* The threshold and the reading it gates, on one track. */}
        <div className={`${AUTO_TILE.FOOT} flex flex-col gap-1.5`}>
          <div className={AUTO_METER.ROOT}>
            <div className={AUTO_METER.TRACK}>
              <div
                className={AUTO_METER.FILL}
                style={{ transform: `scaleX(${(qualityPct ?? 0) / 100})` }}
              />
            </div>
            {thresholdValid ? (
              <span
                aria-hidden="true"
                className={AUTO_METER.MARK}
                style={{ left: `${parsedThreshold}%` }}
              />
            ) : null}
          </div>
          <span className={AUTO_TILE.BODY}>
            {qualityPct === null
              ? t(`${K}.automation.quality_unknown`)
              : t(`${K}.automation.quality_value`, { value: qualityPct })}
          </span>
        </div>
      </motion.div>

      <motion.div variants={staggerRowItem} className="h-full">
        <ScheduleTile config={config} onScheduleChange={onScheduleChange} />
      </motion.div>
    </motion.div>
  );
}

export default TowerAutomationTiles;
