"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import ApnSettingsCard from "./apn-settings-card";
import MBNCard from "./mbn-card";
import { CellularPageHeader } from "@/components/cellular/page-header";
import { Banner } from "@/components/ui/banner";
import { useApnSettings } from "@/hooks/use-apn-settings";
import { useMbnSettings } from "@/hooks/use-mbn-settings";
import { useSimProfiles } from "@/hooks/use-sim-profiles";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { APN_PAIR, PAGE_ROOT } from "../shapes";

// =============================================================================
// APNSettingsComponent — APN Settings page coordinator (single-APN model)
// =============================================================================
// Two write cards side by side on desktop (`APN_PAIR`), stacked below
// `@4xl/main`: the APN (what the data connection dials, plus what is live) and
// the carrier profile (MBN). Both are write surfaces of comparable weight with
// their own CardFoot, locked to one height; the MBN bundle list absorbs the
// slack. They arrive on the family's card cascade.
//
// Gating: when a Custom SIM Profile is active AND that profile sets a
// non-empty APN, the APN card becomes read-only; the source of truth is the
// profile. It is a disabled <fieldset> rather than `disabled` threaded through
// every child. MBN sits OUTSIDE the gate: no profile manages carrier bundles,
// so a profile owning the APN has nothing to say about it.
//
// An MBN change needs a reboot. The dialog after a successful save offers it;
// "Later" persists the deferred-reboot flag, and the app-shell banner
// (`PendingRebootBanner`) stays up on every route until the user reboots or
// dismisses it. Never a reboot inside a save.
// =============================================================================

const APNSettingsComponent = () => {
  const { t } = useTranslation("cellular");

  const {
    apn,
    cids,
    active,
    activeCid,
    dataCidSource,
    isLoading,
    isSaving,
    error,
    save,
    deactivate,
    refresh,
  } = useApnSettings();

  const {
    profiles: mbnProfiles,
    autoSel,
    isLoading: mbnLoading,
    isSaving: mbnSaving,
    error: mbnError,
    saveMbn,
    rebootDevice,
    refresh: refreshMbn,
  } = useMbnSettings();

  const { activeProfileId, isLoading: simLoading, getProfile } = useSimProfiles();

  // --- SIM Profile override check (async) ----------------------------------
  // Gate iff the active profile has a non-empty APN name. Empty APN = profile
  // does not manage APN, so we leave the page editable.
  const [profileOverride, setProfileOverride] = useState<{
    profileId: string;
    name: string;
  } | null>(null);

  // The override verdict arrives over TWO sequential fetches: useSimProfiles
  // first learns `activeProfileId`, then the effect below fetches that
  // profile's APN. `checkedId` records the profile id whose APN fetch has
  // completed, so render can tell whether the current verdict is settled or
  // still in flight — without any synchronous setState in the effect.
  const [checkedId, setCheckedId] = useState<string | null>(null);

  useEffect(() => {
    if (simLoading || !activeProfileId) return;

    let cancelled = false;
    (async () => {
      const profile = await getProfile(activeProfileId);
      if (cancelled) return;

      if (profile && profile.settings.apn.name) {
        setProfileOverride({ profileId: activeProfileId, name: profile.name });
      } else {
        setProfileOverride(null);
      }
      setCheckedId(activeProfileId);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeProfileId, simLoading, getProfile]);

  const isProfileControlled =
    !!activeProfileId && profileOverride?.profileId === activeProfileId;

  // True while we still can't tell whether a profile owns the APN. The cards
  // hold their skeletons and the fieldset stays disabled until this clears.
  const overrideUndetermined =
    simLoading || (!!activeProfileId && checkedId !== activeProfileId);

  const profileName = isProfileControlled
    ? profileOverride.name
    : t("core_settings.apn.managed_by_profile_fallback");

  return (
    <div className={PAGE_ROOT}>
      <CellularPageHeader
        title={t("core_settings.apn.page.title")}
        description={t("core_settings.apn.page.description")}
      />

      {/* Outside the cascade: a condition arriving should not queue behind the
          cards it governs. `Banner` owns its own entrance. */}
      {isProfileControlled ? (
        <Banner
          role="override"
          title={t("core_settings.apn.profile_gate_title", {
            profile: profileName,
          })}
          description={t("core_settings.apn.profile_gate_note")}
        />
      ) : null}

      <motion.div
        className={APN_PAIR.GRID}
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={staggerItem} className={APN_PAIR.CELL}>
          {/* `pointer-events-none opacity-60` makes the locked state obvious
              while leaving values readable. */}
          <fieldset
            disabled={isProfileControlled || overrideUndetermined}
            className={cn(
              "m-0 flex min-w-0 flex-col border-0 p-0",
              isProfileControlled && "pointer-events-none opacity-60",
            )}
          >
            <ApnSettingsCard
              apn={apn}
              cids={cids}
              active={active}
              activeCid={activeCid}
              dataCidSource={dataCidSource}
              isLoading={isLoading || overrideUndetermined}
              isSaving={isSaving}
              loadError={apn === null ? error : null}
              onRetry={() => refresh()}
              onSave={save}
              onDeactivate={deactivate}
            />
          </fieldset>
        </motion.div>

        <motion.div variants={staggerItem} className={APN_PAIR.CELL}>
          <MBNCard
            profiles={mbnProfiles}
            autoSel={autoSel}
            isLoading={mbnLoading}
            isSaving={mbnSaving}
            loadError={mbnProfiles === null ? mbnError : null}
            onRetry={() => refreshMbn()}
            onSave={saveMbn}
            onReboot={rebootDevice}
          />
        </motion.div>
      </motion.div>
    </div>
  );
};

export default APNSettingsComponent;
