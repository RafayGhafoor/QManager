"use client";

import { useTranslation } from "react-i18next";
import { SettingRow } from "./setting-row";

interface EngineEnableRowProps {
  /** Localized mode name, used in the row title. */
  modeLabel: string;
  /** Whether THIS mode currently owns the engine. */
  running: boolean;
  /** False when the binary or kernel module is missing. */
  canEnable: boolean;
  /** True while a save is in flight. */
  busy: boolean;
  /** True when the OTHER mode owns the engine (enabling will take over). */
  otherOwns: boolean;
  /** Other mode's display name, for the takeover hint. */
  otherModeLabel: string;
  onToggle: (next: boolean) => void;
}

/**
 * The single enable affordance shared by both mode panels. On reflects whether
 * THIS mode is running; choosing On while the other mode owns the engine
 * routes through the composer's takeover confirm. Identical markup on both
 * panels keeps the two surfaces from drifting.
 */
export function EngineEnableRow({
  modeLabel,
  running,
  canEnable,
  busy,
  otherOwns,
  otherModeLabel,
  onToggle,
}: EngineEnableRowProps) {
  const { t } = useTranslation("local-network");

  // A description in every state. While running, the mutex stays visible so
  // "enabling the other mode stops this" never vanishes once the engine is on.
  const helper = running
    ? t("traffic_engine.hero_running_prompt", { mode: otherModeLabel })
    : otherOwns
      ? t("traffic_engine.hero_takeover_prompt", { mode: otherModeLabel })
      : t("traffic_engine.hero_idle_prompt");

  return (
    <SettingRow
      title={t("traffic_engine.enable_mode", { mode: modeLabel })}
      description={helper}
      checked={running}
      disabled={!canEnable}
      busy={busy}
      ariaLabel={t("traffic_engine.enable_mode", { mode: modeLabel })}
      onChange={onToggle}
    />
  );
}
