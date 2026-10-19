"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { RefreshCcwIcon } from "lucide-react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { useMtuSettings } from "@/hooks/use-mtu-settings";
import { useSimProfiles } from "@/hooks/use-sim-profiles";
import { useTtlSettings } from "@/hooks/use-ttl-settings";

import { MtuSettingsCard } from "./mtu-settings-card";
import { TtlMtuStrip } from "./ttl-mtu-strip";
import { TtlSettingsCard } from "./ttl-settings-card";
import { PAGE_HEAD, PAGE_ROOT, STATE_BADGE, type TtlMtuState } from "./shapes";

// =============================================================================
// TTL & MTU — page shell
// =============================================================================
// The shell owns all the data: both hooks, the SIM-profile check and the shared
// Refresh, because the live strip spans both endpoints and no card holds both.
// Layout: page header with Refresh, then a `staggerContainer` cascade over the
// strip and two peer write cards.
//
// `refresh` is always called through an arrow: both hooks take `silent` as the
// first argument, so a bare `onClick={refreshTtl}` would pass the click event
// in as a truthy `silent` and suppress the loading state the button exists for.
//
// A Custom SIM Profile that carries a TTL or HL writes both values when it is
// activated, so the TTL card is held and an `override` Banner says why, above
// both cards. MTU is not profile-managed, so its card stays writable.
// =============================================================================

const K = "ttl_mtu";

const TTLandMTUSettingsComponent = () => {
  const { t } = useTranslation("local-network");

  const {
    data: ttlData,
    isLoading: ttlLoading,
    isSaving: ttlSaving,
    saveTtlHl,
    refresh: refreshTtl,
  } = useTtlSettings();

  const {
    data: mtuData,
    isLoading: mtuLoading,
    isSaving: mtuSaving,
    saveMtu,
    disableMtu,
    refresh: refreshMtu,
  } = useMtuSettings();

  const {
    activeProfileId,
    getProfile,
    isLoading: profilesLoading,
  } = useSimProfiles();

  // ---------------------------------------------------------------------------
  // Which profile, if any, owns TTL and hop limit
  // ---------------------------------------------------------------------------
  // `getProfile` is async, so this cannot be derived during render; the
  // cancelled flag keeps a slow read for a stale profile out of the banner.
  const [profileOverride, setProfileOverride] = useState<{
    profileId: string;
    name: string;
  } | null>(null);

  useEffect(() => {
    if (!activeProfileId) return;

    let cancelled = false;
    (async () => {
      const profile = await getProfile(activeProfileId);
      if (cancelled) return;

      if (profile && (profile.settings.ttl > 0 || profile.settings.hl > 0)) {
        setProfileOverride({ profileId: activeProfileId, name: profile.name });
      } else {
        setProfileOverride(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeProfileId, getProfile]);

  const isProfileControlled =
    !!activeProfileId && profileOverride?.profileId === activeProfileId;
  const profileName = isProfileControlled ? profileOverride.name : "";

  // "Is anything overriding the carrier" spans both endpoints, so it is answered
  // here and handed down resolved.
  const bandState: TtlMtuState =
    (ttlData !== null && (ttlData.ttl > 0 || ttlData.hl > 0)) ||
    (mtuData !== null && mtuData.isEnabled)
      ? "custom"
      : "default";

  const isBusy = ttlSaving || mtuSaving;

  const refreshBoth = useCallback(() => {
    void refreshTtl();
    void refreshMtu();
  }, [refreshTtl, refreshMtu]);

  const ttlValue = ttlData
    ? { isEnabled: ttlData.isEnabled, ttl: ttlData.ttl, hl: ttlData.hl }
    : null;
  const mtuValue = mtuData
    ? { isEnabled: mtuData.isEnabled, currentValue: mtuData.currentValue }
    : null;

  // The cascade root declares `initial`/`animate` once; children must not, or
  // they detach from the parent's clock.
  return (
    <motion.div
      className={PAGE_ROOT}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <div className={PAGE_HEAD.ROOT}>
          <div className={PAGE_HEAD.TITLES}>
            <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.page_title`)}</h1>
            <p className={PAGE_HEAD.DESC}>{t(`${K}.page_description`)}</p>
          </div>
          <div className={PAGE_HEAD.ACTIONS}>
            <Button
              type="button"
              variant="tonal-neutral"
              size="action"
              onClick={() => refreshBoth()}
              disabled={isBusy || ttlLoading || mtuLoading}
            >
              <RefreshCcwIcon className="size-4" aria-hidden="true" />
              {t(`${K}.refresh`)}
            </Button>
          </div>
        </div>
      </motion.div>

      <motion.div variants={staggerItem}>
        <TtlMtuStrip
          ttl={ttlValue}
          mtu={mtuValue}
          ttlPending={ttlLoading}
          mtuPending={mtuLoading}
          state={bandState}
          stateBadge={STATE_BADGE[bandState]}
          onRetry={() => refreshBoth()}
        />
      </motion.div>

      {isProfileControlled ? (
        <motion.div variants={staggerItem}>
          <Banner
            role="override"
            title={t(`${K}.banner.title`, { profile: profileName })}
            description={t(`${K}.banner.body`)}
          />
        </motion.div>
      ) : null}

      <motion.div variants={staggerItem}>
        <div className="grid grid-cols-1 gap-5 @4xl/main:grid-cols-2">
          <TtlSettingsCard
            value={ttlValue}
            // The profile read gates this card too: until it lands we do not
            // know whether a profile owns TTL, and a card that renders writable
            // then goes held a beat later has invited a write it will refuse.
            isLoading={ttlLoading || profilesLoading}
            isSaving={ttlSaving}
            isProfileControlled={isProfileControlled}
            onApply={saveTtlHl}
          />
          <MtuSettingsCard
            value={mtuValue}
            isLoading={mtuLoading}
            isSaving={mtuSaving}
            onApply={saveMtu}
            onDisable={disableMtu}
          />
        </div>
      </motion.div>
    </motion.div>
  );
};

export default TTLandMTUSettingsComponent;
