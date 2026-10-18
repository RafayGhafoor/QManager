"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import ApnSettingsCard from "./apn-settings-card";
import MBNCard from "./mbn-card";
import { CellularPageHeader } from "@/components/cellular/page-header";
import { Banner, bannerActionVariants } from "@/components/ui/banner";
import { useApnSettings } from "@/hooks/use-apn-settings";
import { useMbnSettings } from "@/hooks/use-mbn-settings";
import { useSimProfiles } from "@/hooks/use-sim-profiles";
import { clearPendingReboot, usePendingReboot } from "@/lib/reboot/pending";

// =============================================================================
// APNSettingsComponent — APN Settings page coordinator (single-APN model)
// =============================================================================
// Two stacked cards: the APN (what the data connection dials) and the carrier
// profile (MBN). They are unrelated settings, so they stack full-width rather
// than sitting as a uniform two-column pair.
//
// Gating: when a Custom SIM Profile is active AND that profile sets a
// non-empty APN, this whole page becomes read-only. The user can still see
// the current configuration but can't edit it — the source of truth is the
// profile. We wrap the cards in a disabled <fieldset> rather than threading
// `disabled` through every child component.
//
// An MBN change needs a reboot. The dialog after a successful save offers it;
// "Later" persists the deferred-reboot flag, and this page keeps the banner up
// until the user reboots or dismisses it. Never a reboot inside a save.
// =============================================================================

const APNSettingsComponent = () => {
  const { t } = useTranslation("cellular");

  const {
    apn,
    cids,
    active,
    activeCid,
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

  // --- Deferred MBN reboot ---------------------------------------------------
  const pendingReboot = usePendingReboot();
  const mbnRebootPending = pendingReboot?.source === "mbn";
  const [rebootBusy, setRebootBusy] = useState(false);

  const handleRebootNow = async () => {
    setRebootBusy(true);
    const sent = await rebootDevice();
    if (sent) {
      clearPendingReboot();
    } else {
      setRebootBusy(false);
      toast.error(t("core_settings.apn.mbn.toast.reboot_error"));
    }
  };

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
    <div className="@container/main mx-auto flex flex-col gap-5 p-2">
      <CellularPageHeader
        title={t("core_settings.apn.page.title")}
        description={t("core_settings.apn.page.description")}
      />

      {mbnRebootPending ? (
        <Banner
          role="deferred-reboot"
          title={t("core_settings.apn.mbn.pending_reboot.title")}
          description={t("core_settings.apn.mbn.pending_reboot.description")}
          action={
            <>
              <button
                type="button"
                className={bannerActionVariants({ tone: "on-warning" })}
                onClick={clearPendingReboot}
                disabled={rebootBusy}
              >
                {t("core_settings.apn.mbn.pending_reboot.dismiss")}
              </button>
              <button
                type="button"
                className={bannerActionVariants({ tone: "warning" })}
                onClick={handleRebootNow}
                disabled={rebootBusy}
              >
                {rebootBusy
                  ? t("core_settings.apn.mbn.reboot_dialog.rebooting")
                  : t("core_settings.apn.mbn.reboot_dialog.reboot")}
              </button>
            </>
          }
        />
      ) : null}

      {isProfileControlled ? (
        <Banner
          role="override"
          title={t("core_settings.apn.profile_gate_title", {
            profile: profileName,
          })}
          description={t("core_settings.apn.profile_gate_note")}
        />
      ) : null}

      {/* Fieldset wrap: `pointer-events-none opacity-60` makes the disabled
          state visually obvious while leaving values readable. */}
      <fieldset
        disabled={isProfileControlled || overrideUndetermined}
        className={
          isProfileControlled
            ? "pointer-events-none m-0 grid grid-cols-1 gap-4 border-0 p-0 opacity-60"
            : "m-0 grid grid-cols-1 gap-4 border-0 p-0"
        }
      >
        <ApnSettingsCard
          apn={apn}
          cids={cids}
          active={active}
          activeCid={activeCid}
          isLoading={isLoading || overrideUndetermined}
          isSaving={isSaving}
          loadError={apn === null ? error : null}
          onRetry={() => refresh()}
          onSave={save}
          onDeactivate={deactivate}
        />

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
      </fieldset>
    </div>
  );
};

export default APNSettingsComponent;
