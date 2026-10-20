"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

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
// explicit commit there. The selected tile is a quiet neutral step up
// (`surface-container-high` plus an `outline` ring), so "what I'm looking at"
// never competes with "what is running". The running scenario is the one
// place colour moves: its disc turns `success` with the ambient pulse rings
// (animate-pulse-ring, removed under reduced motion), and an sr-only label
// carries the state for assistive tech. Every other disc stays on `primary`.
// =============================================================================

export interface Scenario {
  id: string;
  name: string;
  description: string;
  /** Material glyph for the identity disc, resolved from `icon` for customs. */
  glyph: MaterialSymbolName;
  /** Persisted glyph id (`scenario-icons.ts`), customs only. */
  icon?: string;
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
  /** "HH:MM" of the next scheduled start, when a schedule will run it. */
  nextAt?: string;
}

export const ScenarioItem = ({
  scenario,
  isActive,
  isSelected,
  modeLabel,
  onSelect,
  nextAt,
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
            ? "bg-surface-container-high ring-1 ring-outline ring-inset"
            : "bg-surface-container hover:bg-surface-container-high",
        )}
      >
        <span aria-hidden="true" className="relative grid size-10 flex-none place-items-center">
          {isActive ? (
            <>
              {/* Translucent `success`, not the tone steps: dark-mode tone-1
                  sits within a step of the tile ground and vanishes. */}
              <span className="absolute -inset-2 animate-pulse-ring rounded-pill bg-success/20" />
              <span
                className="absolute -inset-1 animate-pulse-ring rounded-pill bg-success/35"
                style={{ animationDelay: "0.3s" }}
              />
            </>
          ) : null}
          <span
            className={cn(
              "relative grid size-10 place-items-center rounded-pill transition-colors duration-[var(--duration-standard)] ease-out",
              isActive
                ? "bg-success text-success-foreground"
                : "bg-primary text-primary-foreground",
            )}
          >
            <MaterialSymbol name={scenario.glyph} size={20} filled />
          </span>
        </span>

        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">
            {scenario.name}
            {isActive ? (
              <span className="sr-only">
                {" "}({t("scenarios.scenario_item.active_badge")})
              </span>
            ) : null}
          </span>
          <span className="line-clamp-2 text-xs text-on-surface-variant">
            {scenario.description}
          </span>
        </div>

        <div className="mt-auto flex flex-wrap gap-1.5">
          <Tag variant="neutral">{modeLabel}</Tag>
          {pinsBands ? (
            <Tag variant="neutral">{t("scenarios.scenario_item.band_lock")}</Tag>
          ) : null}
          {nextAt ? (
            <Tag variant="neutral">
              {t("scenarios.scenario_item.next_at", { time: nextAt })}
            </Tag>
          ) : null}
        </div>
      </button>
    </motion.div>
  );
};
