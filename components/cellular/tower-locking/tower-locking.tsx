"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConditionScreen } from "@/components/cellular/condition-screen";
import { CellularPageHeader } from "@/components/cellular/page-header";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { useModemStatus } from "@/hooks/use-modem-status";
import { useTowerLocking } from "@/hooks/use-tower-locking";
import { staggerContainer, staggerItem } from "@/lib/motion";
import type { CarrierComponent } from "@/types/modem-status";
import type { LteLockCell, NrSaLockCell } from "@/types/tower-locking";

import TowerAutomationTiles from "./automation-tiles";
import TowerLiveStrip, { type CanTarget } from "./live-strip";
import LteTowerCard from "./lte-tower-card";
import NrSaTowerCard from "./nr-sa-tower-card";
import TowerPersistToggle from "./persist-toggle";
import { defaultScsForBand } from "./simple-mode-utils";
import {
  LEG_CARD_ID,
  SECTION_HEAD,
  TOWER_HERO,
  TOWER_SECTION,
  type TowerLeg,
} from "./shapes";

// =============================================================================
// TowerLockingComponent — page coordinator for /cellular/cell-locking/tower-locking
// =============================================================================
// Owns every hook and distributes data down as props; no child talks to CGI.
//
//   useModemStatus()   -> carrier_components, network type, per-leg RSRP/PCI/SCS
//   useTowerLocking()  -> config, modem lock state, failover state, writes
//
// Anatomy: header (scanner link, Refresh), the read-failure condition, then
//   1. "Right now"         the carriers on air (the only part that changes on
//                          its own);
//   2. "Lock automation"   failover and schedule (standing orders; failover
//                          protects both radios, so it is not a leg-card
//                          setting);
//   3. the leg cards, 2-up on a wide column (where the target changes);
//   4. keep-lock-after-reboot, modem-wide, so under the cards and not in one.
// Do not re-merge 1 and 2: each section's header describes only its own body.
//
// The prefill bus: "use this cell" on a carrier tile reaches a form owned by a
// sibling card through this component. The payload carries a NONCE so picking
// the SAME cell twice still registers.
// =============================================================================

const K = "cell_locking.tower_locking";

const TowerLockingComponent = () => {
  const { t } = useTranslation("cellular");
  const { data: modemData } = useModemStatus();
  const tower = useTowerLocking();

  // --- Prefill bus ------------------------------------------------------------
  const [ltePrefill, setLtePrefill] = useState<{
    cell: LteLockCell;
    nonce: number;
  } | null>(null);
  const [nrPrefill, setNrPrefill] = useState<{
    cell: NrSaLockCell;
    nonce: number;
  } | null>(null);
  const [nonce, setNonce] = useState(0);
  /** Free LTE slots, reported up by the card because it owns the unsaved edits. */
  const [lteFreeSlots, setLteFreeSlots] = useState(3);

  const networkType = modemData?.network?.type ?? "";
  const carriers = useMemo(
    () => modemData?.network?.carrier_components ?? [],
    [modemData?.network?.carrier_components],
  );
  const lteCarriers = useMemo(
    () => carriers.filter((c) => c.technology === "LTE"),
    [carriers],
  );
  const nrCarriers = useMemo(
    () => carriers.filter((c) => c.technology === "NR"),
    [carriers],
  );

  // Which legs can take a target from a tile, and why not. The reason is shown
  // on the control rather than the control being hidden.
  const canTarget: Record<TowerLeg, CanTarget> = useMemo(() => {
    const nrReason =
      networkType === "5G-NSA"
        ? t(`${K}.live.tile_blocked_nsa`)
        : networkType === "LTE" || networkType === ""
          ? t(`${K}.live.tile_blocked_lte_only`)
          : null;
    return {
      lte:
        lteFreeSlots > 0
          ? { ok: true, reason: null }
          : { ok: false, reason: t(`${K}.live.tile_blocked_slots_full`) },
      nr_sa: nrReason ? { ok: false, reason: nrReason } : { ok: true, reason: null },
    };
  }, [networkType, lteFreeSlots, t]);

  // Route a picked carrier to the leg that can lock it. `carrier_components`
  // has no SCS, so an NR pick sources it from the serving cell when the picked
  // cell IS the serving cell, and from the band default otherwise (the card
  // flags that as a guess).
  const handlePickCarrier = useCallback(
    (c: CarrierComponent) => {
      if (c.earfcn === null || c.pci === null) return;
      const next = nonce + 1;
      setNonce(next);

      if (c.technology === "LTE") {
        setLtePrefill({ cell: { earfcn: c.earfcn, pci: c.pci }, nonce: next });
      } else {
        const bandNumber = Number.parseInt(
          String(c.band).replace(/[^0-9]/g, ""),
          10,
        );
        const servingScs = modemData?.nr?.scs ?? null;
        const isServing =
          modemData?.nr?.arfcn === c.earfcn && modemData?.nr?.pci === c.pci;
        const scs =
          isServing && servingScs !== null
            ? servingScs
            : (defaultScsForBand(bandNumber) ?? 30);
        setNrPrefill({
          cell: {
            pci: c.pci,
            arfcn: c.earfcn,
            scs,
            band: Number.isNaN(bandNumber) ? 0 : bandNumber,
          },
          nonce: next,
        });
      }

      // A pick is a draft edit (no toast); bring the form it filled into view.
      const leg: TowerLeg = c.technology === "LTE" ? "lte" : "nr_sa";
      document
        .getElementById(LEG_CARD_ID[leg])
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
    [nonce, modemData?.nr?.arfcn, modemData?.nr?.pci, modemData?.nr?.scs],
  );

  // The RSRP of whichever leg the modem is actually registered on.
  const activeRsrp =
    networkType === "5G-SA"
      ? (modemData?.nr?.rsrp ?? null)
      : (modemData?.lte?.rsrp ?? null);

  // A read mid-write would race the AT lock the write holds.
  const isWriting =
    tower.isLteLocking || tower.isNrLocking || tower.isSavingSettings;
  const isRefreshBlocked = isWriting || tower.isRefreshing || tower.isLoading;

  // A refresh belongs to no card, so its failure is a toast; success is
  // evident from the page updating.
  const handleRefresh = async () => {
    const ok = await tower.refresh();
    if (!ok) toast.error(t(`${K}.toast.refresh_error`));
  };

  return (
    <div className="@container/main mx-auto flex flex-col gap-5 p-2">
      <CellularPageHeader
        title={t(`${K}.page.title`)}
        description={t(`${K}.page.description`)}
        actions={
          <>
            {/* The scanner is where a target comes from when it is not a cell
                the modem is camped on. Navigates, so tonal and not default. */}
            <Button asChild variant="tonal" size="action">
              <Link href="/cellular/cell-scanner">
                <MaterialSymbol name="radar" size={18} />
                {t("radio_info.bands.scanner.link")}
              </Link>
            </Button>
            <Button
              type="button"
              variant="tonal-neutral"
              size="action"
              onClick={handleRefresh}
              disabled={isRefreshBlocked}
            >
              <MaterialSymbol
                name="refresh"
                size={18}
                className={
                  tower.isRefreshing ? "motion-safe:animate-spin" : undefined
                }
              />
              {t(`${K}.actions.refresh`)}
            </Button>
          </>
        }
      />

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {tower.isRefreshing ? t(`${K}.a11y.refreshing`) : ""}
      </div>

      {/* A failed read keeps the previous figures on screen, so this is the
          only thing saying they are not the modem's. */}
      {tower.readError && !tower.isLoading ? (
        <ConditionScreen
          tone="destructive"
          glyph="visibility_off"
          ariaRole="alert"
          title={t(`${K}.error.title`)}
          description={tower.readError}
          onRetry={handleRefresh}
          retryLabel={t(`${K}.error.retry`)}
          disabled={isRefreshBlocked}
          disabledReason={
            isWriting ? t(`${K}.blocked.refresh_writing`) : undefined
          }
        />
      ) : null}

      <motion.div
        className="flex flex-col gap-5"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.div variants={staggerItem}>
          <section className={TOWER_HERO} aria-labelledby="tower-now-title">
            <div className={SECTION_HEAD.ROOT}>
              <h2 id="tower-now-title" className={SECTION_HEAD.TITLE}>
                {t(`${K}.live.title`)}
              </h2>
            </div>
            <TowerLiveStrip
              modemState={tower.modemState}
              carrierComponents={carriers}
              canTarget={canTarget}
              isLoading={tower.isLoading}
              onPickCarrier={handlePickCarrier}
            />
          </section>
        </motion.div>

        <motion.div variants={staggerItem}>
          <section
            className={TOWER_SECTION}
            aria-labelledby="tower-automation-title"
          >
            <div className={SECTION_HEAD.ROOT}>
              <h2 id="tower-automation-title" className={SECTION_HEAD.TITLE}>
                {t(`${K}.automation.title`)}
              </h2>
              <p className={SECTION_HEAD.DESCRIPTION}>
                {t(`${K}.automation.description`)}
              </p>
            </div>
            <TowerAutomationTiles
              config={tower.config}
              modemState={tower.modemState}
              failover={tower.failoverState}
              activeRsrp={activeRsrp}
              isLoading={tower.isLoading}
              isSavingSettings={tower.isSavingSettings}
              onUpdateSettings={tower.updateSettings}
              onScheduleChange={tower.updateSchedule}
            />
          </section>
        </motion.div>

        {/* Nested cascade: inherits `visible` from the parent. `h-full` on each
            cell so a card still loading matches its row-mate. */}
        <motion.div
          className="grid grid-cols-1 gap-4 @3xl/main:grid-cols-2"
          variants={staggerContainer}
        >
          <motion.div
            variants={staggerItem}
            className="h-full *:data-[slot=card]:h-full"
          >
            <LteTowerCard
              config={tower.config}
              modemState={tower.modemState}
              carriers={lteCarriers}
              isLoading={tower.isLoading}
              isLocking={tower.isLteLocking}
              prefill={ltePrefill}
              onFreeSlotsChange={setLteFreeSlots}
              onLock={tower.lockLte}
              onUnlock={tower.unlockLte}
            />
          </motion.div>

          <motion.div
            variants={staggerItem}
            className="h-full *:data-[slot=card]:h-full"
          >
            <NrSaTowerCard
              config={tower.config}
              modemState={tower.modemState}
              carriers={nrCarriers}
              networkType={networkType}
              servingNr={{
                arfcn: modemData?.nr?.arfcn ?? null,
                pci: modemData?.nr?.pci ?? null,
                scs: modemData?.nr?.scs ?? null,
              }}
              isLoading={tower.isLoading}
              isLocking={tower.isNrLocking}
              prefill={nrPrefill}
              onLock={tower.lockNrSa}
              onUnlock={tower.unlockNrSa}
            />
          </motion.div>
        </motion.div>

        <motion.div variants={staggerItem}>
          <TowerPersistToggle
            config={tower.config}
            modemState={tower.modemState}
            isLoading={tower.isLoading}
            isSavingSettings={tower.isSavingSettings}
            onUpdateSettings={tower.updateSettings}
          />
        </motion.div>
      </motion.div>
    </div>
  );
};

export default TowerLockingComponent;
