"use client";

import { useCallback } from "react";
import { RefreshCcwIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { useMotionReduced } from "@/components/motion-preference";
import { Button } from "@/components/ui/button";
import { useKnownSims } from "@/hooks/use-known-sims";
import { useSystemSettings } from "@/hooks/use-system-settings";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import ScheduledOperationsCard from "@/components/system-settings/scheduled-operations-card";
import { StatusBand } from "@/components/system-settings/status-band";
import SystemSettingsCard from "@/components/system-settings/system-settings-card";

import {
  CARD_CELL,
  CARD_GRID,
  PAGE_HEAD,
  PAGE_ROOT,
  PILL_GLYPH,
} from "./shapes";

const K = "page";

const SystemSettings = () => {
  const { t } = useTranslation("system-settings");
  const settingsState = useSystemSettings();
  // Lifted rather than mounted twice: the hook fetches on mount with no shared
  // cache, so a second consumer would mean a second GET and a band count that
  // does not follow the Tracked SIMs row beneath it. It also lets the page's
  // Refresh button reconcile the count.
  const knownSims = useKnownSims();

  const reduceMotion = useMotionReduced();
  const { refresh: refreshSettings, isLoading } = settingsState;
  const { refresh: refreshKnownSims } = knownSims;

  const handleRefresh = useCallback(() => {
    void refreshSettings();
    void refreshKnownSims();
  }, [refreshSettings, refreshKnownSims]);

  const refreshLabel = t(`${K}.refresh`);

  return (
    <motion.div
      className={PAGE_ROOT}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      {/* The cascade root declares initial/animate once. Every child below is a
          staggerItem and must NOT declare its own, or it detaches from the clock. */}
      <motion.div variants={staggerItem}>
        <div className={PAGE_HEAD.ROOT}>
          <div className={PAGE_HEAD.TITLES}>
            <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.title`)}</h1>
            <p className={PAGE_HEAD.DESC}>{t(`${K}.description`)}</p>
          </div>
          <div className={PAGE_HEAD.ACTIONS}>
            {/* Icon-only at rest; the label unfolds on hover or keyboard focus,
                as on Cellular Settings. It animates `grid-template-columns`,
                which `MotionConfig` cannot see, so the easing is dropped under
                reduced motion. The accessible name is always the full label. */}
            <Button
              type="button"
              variant="tonal-neutral"
              onClick={handleRefresh}
              disabled={isLoading}
              size="action"
              aria-label={refreshLabel}
              title={refreshLabel}
              className="group/refresh gap-0"
            >
              <RefreshCcwIcon
                className={cn(PILL_GLYPH, isLoading && "motion-safe:animate-spin")}
                aria-hidden="true"
              />
              <span
                aria-hidden="true"
                className={cn(
                  "grid grid-cols-[0fr] group-hover/refresh:grid-cols-[1fr] group-focus-visible/refresh:grid-cols-[1fr]",
                  !reduceMotion &&
                    "transition-[grid-template-columns] duration-[var(--duration-standard)] ease-[var(--ease-standard)]",
                )}
              >
                <span className="min-w-0 overflow-hidden">
                  <span className="block pl-2">{refreshLabel}</span>
                </span>
              </span>
            </Button>
          </div>
        </div>
      </motion.div>

      <motion.div variants={staggerItem}>
        <StatusBand
          settings={settingsState.settings}
          scheduledReboot={settingsState.scheduledReboot}
          knownCount={knownSims.count}
          isLoading={settingsState.isLoading}
          knownLoading={knownSims.isLoading}
          error={settingsState.error}
        />
      </motion.div>

      {/* A nested container: it inherits `visible` from the root and gives each
          card its own 120ms step. It must not declare initial/animate. */}
      <motion.div className={CARD_GRID} variants={staggerContainer}>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <SystemSettingsCard
            {...settingsState}
            sims={{
              count: knownSims.count,
              isLoading: knownSims.isLoading,
              isClearing: knownSims.isClearing,
              refresh: knownSims.refresh,
              clear: knownSims.clear,
            }}
          />
        </motion.div>
        <motion.div variants={staggerItem} className={CARD_CELL}>
          <ScheduledOperationsCard {...settingsState} />
        </motion.div>
      </motion.div>
    </motion.div>
  );
};

export default SystemSettings;
