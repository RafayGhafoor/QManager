"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { Tag } from "@/components/ui/tag";
import { staggerRowItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { ScenarioConfig } from "@/types/connection-scenario";

// =============================================================================
// ScenarioItem — one scenario as a selectable tile
// =============================================================================
// No gradients: identity is a glyph disc plus neutral Tags (the network mode,
// and a band-lock marker when the scenario pins bands). Selecting a tile only
// shows its configuration in the Selected-scenario card; activation is the
// explicit commit there. The selected tile is promoted one container step to
// `primary-container` (Highlight-by-Container) and its disc to the strong
// `primary` fill; the running scenario carries a filled `success` chip.
//
// The persisted `gradient` field is passed through untouched by the page and
// never read here.
// =============================================================================

export interface Scenario {
  id: string;
  name: string;
  description: string;
  /** Material glyph for the identity disc. UI-only; never persisted. */
  glyph: MaterialSymbolName;
  /** Persisted by the backend; carried through on edit, never rendered. */
  gradient: string;
  isDefault: boolean;
  config: ScenarioConfig;
}

export const SCENARIO_TILE_SHAPE =
  "flex h-full min-h-[8.5rem] w-full flex-col gap-3 rounded-tile px-4 py-4 text-left transition-colors duration-[var(--duration-quick)] ease-out focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-[3px] focus-visible:outline-none";

export const SCENARIO_GRID =
  "grid grid-cols-1 gap-3 @md/card:grid-cols-2 @4xl/card:grid-cols-4";

interface ScenarioItemProps {
  scenario: Scenario;
  isActive: boolean;
  isSelected: boolean;
  modeLabel: string;
  onSelect: (id: string) => void;
}

export const ScenarioItem = ({
  scenario,
  isActive,
  isSelected,
  modeLabel,
  onSelect,
}: ScenarioItemProps) => {
  const { t } = useTranslation("cellular");
  const { lte_bands, nsa_nr_bands, sa_nr_bands } = scenario.config;
  const pinsBands = Boolean(lte_bands || nsa_nr_bands || sa_nr_bands);

  return (
    <motion.div variants={staggerRowItem} className="h-full">
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={() => onSelect(scenario.id)}
        className={cn(
          SCENARIO_TILE_SHAPE,
          isSelected
            ? "bg-primary-container text-on-primary-container"
            : "bg-surface-container hover:bg-surface-container-high",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "grid size-10 flex-none place-items-center rounded-pill",
              isSelected
                ? "bg-primary text-primary-foreground"
                : "bg-surface-container-high text-on-surface-variant",
            )}
          >
            <MaterialSymbol name={scenario.glyph} size={20} filled />
          </span>
          {isActive ? (
            <Badge variant="success">
              <MaterialSymbol name="check_circle" size={12} />
              {t("scenarios.scenario_item.active_badge")}
            </Badge>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{scenario.name}</span>
          <span
            className={cn(
              "line-clamp-2 text-xs",
              isSelected ? "opacity-80" : "text-on-surface-variant",
            )}
          >
            {scenario.description}
          </span>
        </div>

        <div className="mt-auto flex flex-wrap gap-1.5">
          <Tag variant="neutral">{modeLabel}</Tag>
          {pinsBands ? (
            <Tag variant="neutral">{t("scenarios.scenario_item.band_lock")}</Tag>
          ) : null}
        </div>
      </button>
    </motion.div>
  );
};
