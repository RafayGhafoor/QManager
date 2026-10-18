"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConditionScreen } from "@/components/cellular/condition-screen";
import { CellularPageHeader } from "@/components/cellular/page-header";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { useBandLocking } from "@/hooks/use-band-locking";
import { useConnectionScenarios } from "@/hooks/use-connection-scenarios";
import { useModemStatus } from "@/hooks/use-modem-status";
import { staggerContainer, staggerItem } from "@/lib/motion";
import {
  getBandsForCategory,
  parseBandString,
  type BandActionResult,
  type BandCategory,
} from "@/types/band-locking";
import { builtInScenarioNameKey } from "@/types/connection-scenario";

import BandGridCard from "./band-grid-card";
import BandStatusCard from "./band-status-card";
import { categoryCardId, categoryShortKey } from "./shapes";

// =============================================================================
// BandLockingComponent — page coordinator for /cellular/cell-locking
// =============================================================================
// Owns every hook and distributes data down as props; no child talks to CGI.
//
//   useModemStatus()          → device.hw_* / supported_* bands, carriers
//   useBandLocking()          → currentBands, failover, lock/unlock, refresh
//   useConnectionScenarios()  → activeScenarioId (the scenario gate)
//
// Anatomy: header (with Refresh), the read-failure condition, the scenario
// gate, the status card, then the category cards (LTE, NSA, and the SA slot
// that swaps with NR-DC).
//
// Three band layers (docs/features/band-locking.md):
//   hwBands      hardware capability, the chip universe ("Unlock all" writes it)
//   policyBands  the network/SIM policy subset, grouping only
//   locked       what the modem is configured to now (`current.sh`)
// NR-DC has no hardware list of its own and borrows the SA one.
//
// Refresh exists because `current.sh` is read on mount and after a write only;
// a scheduled scenario rewriting bands on-device would otherwise go unseen. It
// is blocked while any write or the failover watcher is running: `current.sh`
// takes the AT lock, and the watcher treats a failed check as "no carrier".
// =============================================================================

const K = "cell_locking.band_locking";

const BandLockingComponent = () => {
  const { t } = useTranslation("cellular");
  const { data, isLoading: statusLoading } = useModemStatus();
  const {
    currentBands,
    failover,
    isLoading: bandsLoading,
    isRefreshing,
    lockingCategory,
    readError,
    lockBands,
    unlockAll,
    toggleFailover,
    refresh,
  } = useBandLocking();
  const {
    activeScenarioId,
    customScenarios,
    isLoading: scenariosLoading,
  } = useConnectionScenarios();

  // --- Shared SA / NR-DC slot ------------------------------------------------
  const [saSlotView, setSaSlotView] = useState<"sa_nr5g" | "nrdc_nr5g">(
    "sa_nr5g",
  );
  const swapTargetView = saSlotView === "sa_nr5g" ? "nrdc_nr5g" : "sa_nr5g";

  // --- Per-card write failures, from each mutator's returned result ---------
  const [writeErrors, setWriteErrors] = useState<
    Partial<Record<BandCategory, string>>
  >({});

  const track = async (
    category: BandCategory,
    run: () => Promise<BandActionResult>,
  ): Promise<BandActionResult> => {
    setWriteErrors((prev) => ({ ...prev, [category]: undefined }));
    const result = await run();
    if (!result.ok) {
      setWriteErrors((prev) => ({ ...prev, [category]: result.error }));
    }
    return result;
  };

  // --- Scenario gate ---------------------------------------------------------
  const isScenarioControlled = activeScenarioId !== "balanced";
  const activeScenarioName = useMemo(() => {
    if (!isScenarioControlled) return "";
    const builtInKey = builtInScenarioNameKey(activeScenarioId);
    if (builtInKey) return t(builtInKey);
    const fromCustom = customScenarios.find((s) => s.id === activeScenarioId);
    if (fromCustom) return fromCustom.name;
    return activeScenarioId;
  }, [activeScenarioId, isScenarioControlled, customScenarios, t]);

  // --- Band layers -----------------------------------------------------------
  const policyBands: Record<BandCategory, number[]> = {
    lte: parseBandString(data?.device.supported_lte_bands),
    nsa_nr5g: parseBandString(data?.device.supported_nsa_nr5g_bands),
    sa_nr5g: parseBandString(data?.device.supported_sa_nr5g_bands),
    nrdc_nr5g: parseBandString(data?.device.supported_nrdc_nr5g_bands),
  };
  const hwLte = parseBandString(data?.device.hw_lte_bands);
  const hwNsa = parseBandString(data?.device.hw_nsa_nr5g_bands);
  const hwSa = parseBandString(data?.device.hw_sa_nr5g_bands);
  const supportedBands: Record<BandCategory, number[]> = {
    lte: hwLte.length > 0 ? hwLte : policyBands.lte,
    nsa_nr5g: hwNsa.length > 0 ? hwNsa : policyBands.nsa_nr5g,
    sa_nr5g: hwSa.length > 0 ? hwSa : policyBands.sa_nr5g,
    nrdc_nr5g: hwSa.length > 0 ? hwSa : policyBands.nrdc_nr5g,
  };

  const hasCurrentReading = currentBands !== null;
  const locked = (category: BandCategory) =>
    currentBands ? parseBandString(getBandsForCategory(currentBands, category)) : [];
  const lockedBands: Record<BandCategory, number[]> = {
    lte: locked("lte"),
    nsa_nr5g: locked("nsa_nr5g"),
    sa_nr5g: locked("sa_nr5g"),
    nrdc_nr5g: locked("nrdc_nr5g"),
  };

  const carrierComponents = data?.network.carrier_components ?? [];
  const isPageLoading = statusLoading || bandsLoading || scenariosLoading;

  const isBusy = lockingCategory !== null;
  const isWatcherRunning = failover.watcher_running === true;
  const isRefreshBlocked =
    isBusy || isRefreshing || bandsLoading || isWatcherRunning;
  const watcherReason = isWatcherRunning
    ? t(`${K}.refresh_blocked_watcher`)
    : undefined;

  // A refresh belongs to no card, so its failure is a toast; success is
  // evident from the page updating.
  const handleRefresh = async () => {
    const ok = await refresh();
    if (!ok) toast.error(t(`${K}.toast.refresh_error`));
  };

  const selectCategory = (category: BandCategory) => {
    if (category === "sa_nr5g" || category === "nrdc_nr5g") {
      setSaSlotView(category);
    }
    document
      .getElementById(categoryCardId(category))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const renderCard = (
    category: BandCategory,
    swap?: { onSwapView: () => void; swapLabel: string },
  ) => (
    <BandGridCard
      key={category}
      bandCategory={category}
      supportedBands={supportedBands[category]}
      policyBands={policyBands[category]}
      currentLockedBands={lockedBands[category]}
      hasCurrentReading={hasCurrentReading}
      onLock={(bands) => track(category, () => lockBands(category, bands))}
      onUnlockAll={() =>
        track(category, () => unlockAll(category, supportedBands[category]))
      }
      isLocking={lockingCategory === category}
      isBusy={isBusy}
      isLoading={isPageLoading}
      error={writeErrors[category] ?? null}
      isGated={isScenarioControlled}
      onSwapView={swap?.onSwapView}
      swapLabel={swap?.swapLabel}
    />
  );

  return (
    <div className="@container/main mx-auto flex flex-col gap-5 p-2">
      <CellularPageHeader
        title={t(`${K}.page.title`)}
        description={t(`${K}.page.description`)}
        actions={
          <Button
            type="button"
            variant="tonal-neutral"
            size="action"
            onClick={handleRefresh}
            disabled={isRefreshBlocked}
            title={watcherReason}
          >
            <MaterialSymbol
              name="refresh"
              size={18}
              className={isRefreshing ? "motion-safe:animate-spin" : undefined}
            />
            {t(`${K}.actions.refresh`)}
          </Button>
        }
      />

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {isRefreshing ? t(`${K}.refreshing`) : ""}
      </div>

      {readError && !isPageLoading ? (
        <ConditionScreen
          tone="destructive"
          glyph="visibility_off"
          ariaRole="alert"
          title={t(`${K}.read_error_title`)}
          description={readError}
          onRetry={handleRefresh}
          retryLabel={t(`${K}.actions.refresh`)}
          disabled={isRefreshBlocked}
          disabledReason={watcherReason}
        />
      ) : null}

      {!isPageLoading && isScenarioControlled ? (
        <Banner
          role="override"
          title={t(`${K}.scenario_gate_title`, { scenario: activeScenarioName })}
          description={t(`${K}.scenario_gate_note`)}
        />
      ) : null}

      <motion.div
        className="flex flex-col gap-5"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.div variants={staggerItem}>
          <BandStatusCard
            failover={failover}
            carrierComponents={carrierComponents}
            supportedBands={supportedBands}
            lockedBands={lockedBands}
            hasCurrentReading={hasCurrentReading}
            onToggleFailover={toggleFailover}
            onSelectCategory={selectCategory}
            isLoading={isPageLoading}
            isGated={isScenarioControlled}
          />
        </motion.div>

        <motion.div
          className="grid grid-cols-1 gap-4 @3xl/main:grid-cols-2"
          variants={staggerContainer}
        >
          {(["lte", "nsa_nr5g"] as const).map((category) => (
            <motion.div
              key={category}
              id={categoryCardId(category)}
              variants={staggerItem}
              className="h-full scroll-mt-20 *:data-[slot=card]:h-full"
            >
              {renderCard(category)}
            </motion.div>
          ))}
          {/* The shared SA / NR-DC slot. The key remounts the card on swap so
              its selection re-initialises from the new category. */}
          <motion.div
            id={categoryCardId("sa_nr5g")}
            variants={staggerItem}
            className="h-full scroll-mt-20 *:data-[slot=card]:h-full"
          >
            {renderCard(saSlotView, {
              onSwapView: () => setSaSlotView(swapTargetView),
              swapLabel: t(categoryShortKey(swapTargetView)),
            })}
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default BandLockingComponent;
