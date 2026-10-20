"use client";

import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { HintIcon } from "@/components/ui/hint-icon";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { RevealButton } from "@/components/ui/reveal-button";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  TowerLockConfig,
  TowerModemState,
} from "@/types/tower-locking";

import {
  BADGE_GLYPH_SIZE,
  PERSIST_BADGE,
  SKELETON_SHAPE,
  persistPosture,
  type PersistPosture,
} from "./shapes";
import {
  writeTowerSettings,
  type UpdateTowerSettings,
} from "./settings-write";

// =============================================================================
// TowerPersistToggle — keep the lock across a reboot
// =============================================================================
// One modem-wide setting, so it sits under the leg cards rather than inside
// either. The button reports the SAVED setting (pressed = on); the badge beside
// it is the modem's own read-back, which can disagree. `split` (one radio keeps
// it, the other does not) is a real fault, so it stays visible, not tooltipped.
// =============================================================================

const K = "cell_locking.tower_locking";

const PERSIST_STATE_LABEL: Record<PersistPosture, string> = {
  on: `${K}.automation.persist_state_on`,
  off: `${K}.automation.persist_state_off`,
  split: `${K}.automation.persist_state_split`,
  unknown: `${K}.automation.persist_state_unknown`,
};

export interface TowerPersistToggleProps {
  config: TowerLockConfig | null;
  modemState: TowerModemState | null;
  isLoading: boolean;
  isSavingSettings: boolean;
  onUpdateSettings: UpdateTowerSettings;
}

export function TowerPersistToggle({
  config,
  modemState,
  isLoading,
  isSavingSettings,
  onUpdateSettings,
}: TowerPersistToggleProps) {
  const { t } = useTranslation("cellular");

  if (isLoading) {
    return <Skeleton className={`${SKELETON_SHAPE.ACTION_QUIET} w-28`} />;
  }

  const posture = persistPosture(modemState);
  const badge = PERSIST_BADGE[posture];
  const on = config?.persist ?? false;

  const handleToggle = async () => {
    if (!config) return;
    const next = !config.persist;
    await writeTowerSettings(
      t,
      onUpdateSettings,
      next,
      config.failover,
      next
        ? t(`${K}.toast.persist_enabled`)
        : t(`${K}.toast.persist_disabled`),
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <RevealButton
        glyph="restart_alt"
        label={t(`${K}.automation.persist_label`)}
        variant={on ? "tonal" : "tonal-neutral"}
        aria-pressed={on}
        status={isSavingSettings ? "saving" : "idle"}
        disabled={!config}
        onClick={() => void handleToggle()}
      />
      <Badge variant={badge.variant}>
        <MaterialSymbol name={badge.glyph} size={BADGE_GLYPH_SIZE} />
        {t(PERSIST_STATE_LABEL[posture])}
      </Badge>
      <HintIcon label={t(`${K}.automation.persist_help_label`)}>
        {posture === "split"
          ? t(`${K}.automation.persist_split_help`)
          : t(`${K}.automation.persist_help`)}
      </HintIcon>
    </div>
  );
}

export default TowerPersistToggle;
