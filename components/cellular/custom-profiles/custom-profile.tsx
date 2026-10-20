"use client";

import React from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { CellularPageHeader } from "@/components/cellular/page-header";
import { useMotionReduced } from "@/components/motion-preference";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import {
  ConnectionScenariosProvider,
  useConnectionScenarios,
} from "@/hooks/use-connection-scenarios";
import { useCurrentSettings } from "@/hooks/use-current-settings";
import { useProfileApply } from "@/hooks/use-profile-apply";
import { SimProfilesProvider, useSimProfiles } from "@/hooks/use-sim-profiles";
import {
  DUR,
  EASE_STANDARD,
  staggerContainer,
  staggerItem,
} from "@/lib/motion";
import { setPendingReboot } from "@/lib/reboot/pending";
import { buildDayTimeline } from "@/lib/schedule-timeline";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SCENARIOS,
  builtInScenarioNameKey,
  type ConnectionScenario,
} from "@/types/connection-scenario";
import type { ProfileSummary, SimProfile } from "@/types/sim-profile";

import {
  ActiveProfileHero,
  ActiveProfileHeroSkeleton,
} from "./active-profile-hero";
import { ApplyProgressDialog } from "./apply-progress-dialog";
import ConnectionScenariosCard, {
  SCENARIO_CREATE_ACTION,
} from "./connection-scenarios/connection-scenario-card";
import {
  DeactivateProgressDialog,
  type DeactivatePhase,
} from "./deactivate-progress-dialog";
import { ProfileFormDialog } from "./profile-form-dialog";
import { iccidMismatch } from "./profile-iccid";
import type { ProfileSaveOutcome, WizardTab } from "./profile-input";
import ProfileViewComponent from "./profile-view";
import {
  ScheduleTodayCard,
  ScheduleTodayCardSkeleton,
} from "./schedule-ribbon";
import {
  HERO_CARD,
  HERO_DISC,
  HERO_DISC_TONE,
  HERO_STATE,
  MACHINE_VALUE,
  SAVED_PROFILES_ANCHOR,
} from "./shapes";

// =============================================================================
// Custom SIM Profiles — the merged profiles + scenarios page
// =============================================================================
// Connection Scenarios used to be its own route; a profile's whole purpose is
// to bind a scenario, so the two now share one page (the RM520N layout):
//
//   1. Page header with New scenario + New profile
//   2. The "in force now" HERO (the page's one `rounded-hero`)
//   3. The Today card: the active profile's 24-hour schedule
//   4. Saved profiles beside connection scenarios
//
// This file owns every flow the hero and the list share: the wizard dialog,
// activation (with the other-SIM confirm), the apply pipeline dialog, and
// deactivation. Divergences from the fork, on purpose:
//   - Saving never re-applies. A save of the active profile only re-arms its
//     schedule cron (save.sh); network field edits wait for an activation, so
//     the hero says so and offers Reapply.
//   - The Verizon rules live in the wizard (brick warning, CID 3), the row and
//     hero badges (MPDN lock), the other-SIM confirm note, and the reboot
//     deferrals after an IMEI apply or a Verizon deactivate.
// =============================================================================

/** The hero <-> empty <-> error cross-fade. Transform + opacity only. */
const HERO_SWAP = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: DUR.quick, ease: EASE_STANDARD },
} as const;

const MS_PER_MINUTE = 60_000;

/** One clock for the page, so the needle, the summary and every mini bar agree. */
function useMinuteClock(): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), MS_PER_MINUTE);
    return () => clearInterval(id);
  }, []);
  return now;
}

const CustomProfilePageBody = () => {
  const { t } = useTranslation("cellular");
  const now = useMinuteClock();
  const reduceMotion = useMotionReduced();

  const sim = useSimProfiles();
  const {
    profiles,
    activeProfileId,
    isLoading,
    error,
    getProfile,
    deactivateProfile,
    refresh,
  } = sim;
  const {
    applyState,
    applyProfile,
    error: applyError,
    reset: resetApply,
  } = useProfileApply();
  const currentSettings = useCurrentSettings(true);
  const currentIccid = currentSettings.settings?.iccid ?? null;
  const { customScenarios } = useConnectionScenarios();

  const scenarios: ConnectionScenario[] = React.useMemo(
    () => [
      ...DEFAULT_SCENARIOS.map((s) => {
        const key = builtInScenarioNameKey(s.id);
        return key ? { ...s, name: t(key) } : s;
      }),
      ...customScenarios.map((s) => ({
        ...s,
        pattern: "custom" as const,
        isDefault: false,
      })),
    ],
    [customScenarios, t],
  );

  // ---------------------------------------------------------------------------
  // The active profile, in full
  // ---------------------------------------------------------------------------
  // list.sh returns summaries without `settings`, so the hero asks for the full
  // record by id. The nonce re-runs the GET after an edit of the active profile
  // (its id does not change). Settlement is stored as the id that settled, so a
  // failed GET is a finished one and never holds the page in skeleton.
  const [detail, setDetail] = React.useState<SimProfile | null>(null);
  const [settledDetailId, setSettledDetailId] = React.useState<string | null>(
    null,
  );
  const [detailNonce, setDetailNonce] = React.useState(0);
  const invalidateActiveProfile = React.useCallback(
    () => setDetailNonce((n) => n + 1),
    [],
  );

  React.useEffect(() => {
    if (!activeProfileId) return;
    let cancelled = false;
    void getProfile(activeProfileId).then((p) => {
      if (cancelled) return;
      setSettledDetailId(activeProfileId);
      // An empty answer is a dropped request or a missing file, not proof that
      // nothing is active: keep the previous record for the same id.
      setDetail((prev) => p ?? (prev?.id === activeProfileId ? prev : null));
    });
    return () => {
      cancelled = true;
    };
  }, [activeProfileId, getProfile, detailNonce]);

  const activeProfile = activeProfileId ? detail : null;
  const heroDetailSettled = Boolean(
    activeProfileId && settledDetailId === activeProfileId,
  );
  const heroDetailFailed = heroDetailSettled && activeProfile === null;

  const timeline = React.useMemo(
    () =>
      activeProfile
        ? buildDayTimeline(
            activeProfile.scenario.schedule,
            activeProfile.scenario.default,
            now,
          )
        : null,
    [activeProfile, now],
  );

  const activeScenario = React.useMemo(() => {
    if (!activeProfile || !timeline) return null;
    const live = timeline.segments.find((s) => s.isLive);
    const id = live?.scenarioId ?? activeProfile.scenario.default;
    return scenarios.find((s) => s.id === id) ?? null;
  }, [activeProfile, timeline, scenarios]);

  const scheduleArmed = Boolean(activeProfile?.scenario.schedule.enabled);

  // Epoch ms of each scenario's next start today, only while a schedule is
  // armed: a tile never claims a time nothing will honour.
  const nextFireByScenarioId = React.useMemo<Record<string, number>>(() => {
    if (!scheduleArmed || !timeline) return {};
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const out: Record<string, number> = {};
    for (const seg of timeline.segments) {
      if (seg.startMinute <= timeline.nowMinute) continue;
      if (out[seg.scenarioId] !== undefined) continue;
      out[seg.scenarioId] = midnight.getTime() + seg.startMinute * MS_PER_MINUTE;
    }
    return out;
  }, [scheduleArmed, timeline, now]);

  // ---------------------------------------------------------------------------
  // Coordinated first reveal
  // ---------------------------------------------------------------------------
  // The hero, the list and the scenarios card each report their own readiness;
  // `pageReady` latches the first time all three agree, so the page reveals
  // once and later background refreshes never re-skeleton it.
  const [profilesReady, setProfilesReady] = React.useState(false);
  const [scenariosReady, setScenariosReady] = React.useState(false);
  const heroReady = !isLoading && (!activeProfileId || heroDetailSettled);
  const [pageReady, setPageReady] = React.useState(false);
  if (!pageReady && profilesReady && scenariosReady && heroReady) {
    setPageReady(true);
  }

  // ---------------------------------------------------------------------------
  // The wizard dialog (+ deep links, read once at mount)
  // ---------------------------------------------------------------------------
  const searchParams = useSearchParams();
  const [formOpen, setFormOpen] = React.useState(
    () => searchParams.get("action") === "create",
  );
  const [arrivedFromScenarioLink] = React.useState(
    () => searchParams.get("action") === SCENARIO_CREATE_ACTION,
  );
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [formTab, setFormTab] = React.useState<WizardTab>("identity");
  const [scenarioCreateSignal, setScenarioCreateSignal] = React.useState(0);

  // The active profile's saved network edits that have not reached the modem.
  const [pendingNetworkId, setPendingNetworkId] = React.useState<
    string | null
  >(null);

  const openWizard = (id: string | null, tab: WizardTab = "identity") => {
    setEditingId(id);
    setFormTab(tab);
    setFormOpen(true);
  };

  const handleSaved = (outcome: ProfileSaveOutcome) => {
    if (editingId !== null && editingId === activeProfileId) {
      invalidateActiveProfile();
      if (outcome.networkChanged) setPendingNetworkId(editingId);
    }
  };

  // "+ Create scenario" inside the wizard: close it, open the card's dialog.
  const handleCreateScenarioFromWizard = () => {
    setFormOpen(false);
    setScenarioCreateSignal((n) => n + 1);
  };

  // ---------------------------------------------------------------------------
  // Activation and the apply pipeline dialog
  // ---------------------------------------------------------------------------
  // The dialog opens for a user's own activation, and also adopts a run this
  // page did not start (another tab, a boot-time apply) once it is seen in
  // flight. A dismissed run is remembered by its backend identity so it never
  // re-opens.
  const runKey = applyState
    ? `${applyState.profile_id}:${applyState.started_at}`
    : null;
  const [userApplyOpen, setUserApplyOpen] = React.useState(false);
  const [adoptedRunKey, setAdoptedRunKey] = React.useState<string | null>(null);
  if (
    applyState?.status === "applying" &&
    runKey !== null &&
    runKey !== adoptedRunKey
  ) {
    setAdoptedRunKey(runKey);
  }
  const showApplyProgress =
    userApplyOpen || (runKey !== null && runKey === adoptedRunKey);

  const [pendingMismatch, setPendingMismatch] =
    React.useState<ProfileSummary | null>(null);

  const startApply = (id: string) => {
    setUserApplyOpen(true);
    void applyProfile(id);
  };

  // A profile bound to another SIM confirms before anything is written:
  // apply.sh never checks the ICCID.
  const handleActivate = (profile: ProfileSummary) => {
    if (iccidMismatch(profile.sim_iccid, currentIccid)) {
      setPendingMismatch(profile);
      return;
    }
    startApply(profile.id);
  };

  const confirmMismatch = () => {
    if (!pendingMismatch) return;
    const target = pendingMismatch;
    setPendingMismatch(null);
    startApply(target.id);
  };

  const handleReapplyActive = () => {
    if (activeProfile) startApply(activeProfile.id);
  };

  // Close is only reachable at a terminal state: one toast for the outcome,
  // re-read the list and the hero's record, and defer an IMEI reboot to the
  // banner. Read the state BEFORE reset() clears it.
  const handleApplyClose = () => {
    const finished = applyState?.status;
    const profileId = applyState?.profile_id ?? null;
    const name = applyState?.profile_name ?? "";
    const needsReboot = applyState?.requires_reboot === true;
    const succeeded = finished === "complete" || finished === "partial";
    const failure =
      applyError ?? t("custom_profiles.view.toast.activate_error");

    setUserApplyOpen(false);
    setAdoptedRunKey(null);
    resetApply();
    refresh();
    invalidateActiveProfile();

    if (succeeded) {
      if (profileId !== null && profileId === pendingNetworkId) {
        setPendingNetworkId(null);
      }
      toast.success(
        t(
          finished === "partial"
            ? "custom_profiles.view.toast.activated_partial"
            : "custom_profiles.view.toast.activated",
          { name },
        ),
      );
      if (needsReboot) setPendingReboot("imei");
    } else if (finished === "failed" || applyError) {
      toast.error(failure);
    }
  };

  // ---------------------------------------------------------------------------
  // Deactivation
  // ---------------------------------------------------------------------------
  const [deactivateOpen, setDeactivateOpen] = React.useState(false);
  const [deactivatePhase, setDeactivatePhase] =
    React.useState<DeactivatePhase>("confirm");
  const isDeactivating = deactivateOpen && deactivatePhase === "working";

  const activeSummary = profiles.find((p) => p.id === activeProfileId) ?? null;
  const deactivateName = activeProfile?.name ?? activeSummary?.name ?? "";
  const deactivateIsVerizon =
    (activeProfile?.mno ?? activeSummary?.mno) === "Verizon";

  const handleDeactivateRequest = () => {
    setDeactivatePhase("confirm");
    setDeactivateOpen(true);
  };

  const handleDeactivateConfirm = async () => {
    const name = deactivateName;
    setDeactivatePhase("working");
    const result = await deactivateProfile();
    setDeactivateOpen(false);
    setDeactivatePhase("confirm");
    if (result.ok) {
      setPendingNetworkId(null);
      toast.success(t("custom_profiles.view.toast.deactivated", { name }));
      if (result.requiresReboot) setPendingReboot("verizon_revert");
    } else {
      toast.error(result.error);
    }
  };

  // ---------------------------------------------------------------------------
  // "Activate a profile" from the empty hero: scroll + focus the saved list
  // ---------------------------------------------------------------------------
  const savedProfilesRef = React.useRef<HTMLDivElement>(null);
  const handleJumpToSavedProfiles = () => {
    const el = savedProfilesRef.current;
    if (!el) return;
    el.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
    el.focus({ preventScroll: true });
  };

  const applyingProfileId =
    applyState?.status === "applying" ? applyState.profile_id : null;
  const pageBusy =
    isDeactivating || showApplyProgress || applyingProfileId !== null;
  const showSkeleton = !pageReady;

  return (
    <motion.div
      className="@container/main mx-auto flex flex-col gap-5 p-2"
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <CellularPageHeader
          title={t("custom_profiles.page.title")}
          description={t("custom_profiles.page.description")}
          actions={
            <>
              <Button
                variant="tonal"
                size="action"
                onClick={() => setScenarioCreateSignal((n) => n + 1)}
              >
                <MaterialSymbol name="auto_awesome" size={18} aria-hidden />
                {t("custom_profiles.page.new_scenario")}
              </Button>
              <Button size="action" onClick={() => openWizard(null)}>
                <MaterialSymbol name="add" size={18} aria-hidden />
                {t("custom_profiles.page.new_profile")}
              </Button>
            </>
          }
        />
      </motion.div>

      {/* The skeleton sits outside AnimatePresence so the first reveal is not
          animated twice; only a later swap between states cross-fades. */}
      <motion.div variants={staggerItem} aria-live="polite">
        {showSkeleton ? (
          <ActiveProfileHeroSkeleton />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {activeProfile ? (
              <motion.div key="hero-active" {...HERO_SWAP}>
                <ActiveProfileHero
                  profile={activeProfile}
                  activeScenario={activeScenario}
                  applyState={applyState}
                  currentIccid={currentIccid}
                  busy={pageBusy}
                  onEdit={() => openWizard(activeProfile.id)}
                  onDeactivate={handleDeactivateRequest}
                  onReapply={handleReapplyActive}
                  pendingNetworkChange={pendingNetworkId === activeProfile.id}
                />
              </motion.div>
            ) : heroDetailFailed ? (
              <motion.div key="hero-error" {...HERO_SWAP}>
                <ActiveProfileUnavailable
                  detail={error}
                  onRetry={invalidateActiveProfile}
                />
              </motion.div>
            ) : (
              <motion.div key="hero-empty" {...HERO_SWAP}>
                <NoActiveProfile
                  hasSavedProfiles={profiles.length > 0}
                  onCreate={() => openWizard(null)}
                  onActivateExisting={handleJumpToSavedProfiles}
                />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </motion.div>

      {/* The shape of today: only while a profile is in force. */}
      {showSkeleton ? (
        <motion.div variants={staggerItem}>
          <ScheduleTodayCardSkeleton />
        </motion.div>
      ) : activeProfile ? (
        <motion.div variants={staggerItem}>
          <ScheduleTodayCard
            profile={activeProfile}
            scenarios={scenarios}
            now={now}
            onEditSchedule={() => openWizard(activeProfile.id, "scenario")}
          />
        </motion.div>
      ) : null}

      <motion.div variants={staggerItem}>
        <div className="grid grid-flow-row grid-cols-1 items-start gap-4 @4xl/main:grid-cols-[1.15fr_1fr]">
          <div
            ref={savedProfilesRef}
            tabIndex={-1}
            className={SAVED_PROFILES_ANCHOR}
          >
            <ProfileViewComponent
              sim={sim}
              currentIccid={currentIccid}
              onEdit={(id) => openWizard(id)}
              onAdd={() => openWizard(null)}
              onActivate={handleActivate}
              onDeactivate={handleDeactivateRequest}
              applyingProfileId={applyingProfileId}
              pageBusy={pageBusy}
              now={now}
              holdSkeleton={showSkeleton}
              onLocalReadyChange={setProfilesReady}
            />
          </div>
          <ConnectionScenariosCard
            autoOpenAddDialog={arrivedFromScenarioLink}
            openAddSignal={scenarioCreateSignal}
            nextFireByScenarioId={nextFireByScenarioId}
            radioOwnedByProfile={scheduleArmed}
            ownerProfileName={activeProfile?.name ?? null}
            holdSkeleton={showSkeleton}
            onLocalReadyChange={setScenariosReady}
          />
        </div>
      </motion.div>

      {/* --- Dialogs -------------------------------------------------------- */}
      <ProfileFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        sim={sim}
        currentSettings={currentSettings}
        editingId={editingId}
        onSaved={handleSaved}
        initialTab={formTab}
        onCreateScenario={handleCreateScenarioFromWizard}
      />

      <AlertDialog
        open={pendingMismatch !== null}
        onOpenChange={(open) => !open && setPendingMismatch(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("custom_profiles.view.mismatch_confirm.title", {
                name: pendingMismatch?.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("custom_profiles.view.mismatch_confirm.description")}
              {pendingMismatch?.mno === "Verizon" ? (
                <>
                  {" "}
                  {t("custom_profiles.view.mismatch_confirm.verizon_note")}
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmMismatch}>
              {t("custom_profiles.view.mismatch_confirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DeactivateProgressDialog
        open={deactivateOpen}
        phase={deactivatePhase}
        profileName={deactivateName}
        isVerizon={deactivateIsVerizon}
        onConfirm={handleDeactivateConfirm}
        onOpenChange={(open) => {
          if (!open) setDeactivateOpen(false);
        }}
      />

      <ApplyProgressDialog
        open={showApplyProgress}
        applyState={applyState}
        error={applyError}
        onClose={handleApplyClose}
      />
    </motion.div>
  );
};

/**
 * The hero's empty state: no profile is active. A resting state, not a fault,
 * so neutral and `role="status"`. With saved profiles the action jumps to the
 * list (activation keeps its one home on the row); with none, it creates.
 */
function NoActiveProfile({
  hasSavedProfiles,
  onCreate,
  onActivateExisting,
}: {
  hasSavedProfiles: boolean;
  onCreate: () => void;
  onActivateExisting: () => void;
}) {
  const { t } = useTranslation("cellular");
  return (
    <div role="status" className={cn(HERO_CARD, HERO_STATE.SHELL)}>
      <span className={cn(HERO_DISC, HERO_DISC_TONE.empty)}>
        <MaterialSymbol
          name="sim_card_alert"
          size={HERO_STATE.GLYPH_SIZE}
          filled
          aria-hidden
        />
      </span>
      <span className={HERO_STATE.TITLE}>
        {t("custom_profiles.hero_empty.title")}
      </span>
      <span className={HERO_STATE.BODY}>
        {hasSavedProfiles
          ? t("custom_profiles.hero_empty.description_saved")
          : t("custom_profiles.hero_empty.description")}
      </span>
      {hasSavedProfiles ? (
        <Button size="action" onClick={onActivateExisting}>
          <MaterialSymbol name="play_arrow" size={18} aria-hidden />
          {t("custom_profiles.hero_empty.activate_action")}
        </Button>
      ) : (
        <Button size="action" onClick={onCreate}>
          <MaterialSymbol name="add" size={18} aria-hidden />
          {t("custom_profiles.page.new_profile")}
        </Button>
      )}
    </div>
  );
}

/**
 * The hero's third state: a profile IS active and its record did not load.
 * `warning`, not `destructive`: nothing on the modem failed, our read did.
 */
function ActiveProfileUnavailable({
  detail,
  onRetry,
}: {
  detail: string | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation("cellular");
  return (
    <div role="alert" className={cn(HERO_CARD, HERO_STATE.SHELL)}>
      <span className={cn(HERO_DISC, HERO_DISC_TONE.error)}>
        <MaterialSymbol
          name="cloud_off"
          size={HERO_STATE.GLYPH_SIZE}
          filled
          aria-hidden
        />
      </span>
      <span className={HERO_STATE.TITLE}>
        {t("custom_profiles.hero_error.title")}
      </span>
      <span className={HERO_STATE.BODY}>
        {t("custom_profiles.hero_error.description")}
      </span>
      {detail ? (
        <span className={cn(MACHINE_VALUE, HERO_STATE.DETAIL)}>{detail}</span>
      ) : null}
      <Button variant="tonal" size="action" onClick={onRetry}>
        <MaterialSymbol name="refresh" size={17} aria-hidden />
        {t("custom_profiles.hero_error.retry")}
      </Button>
    </div>
  );
}

/**
 * The page inside its two shared-fetch providers, so the hero, the list, the
 * wizard and the scenarios card read one instance of each instead of six.
 */
const CustomProfileComponent = () => (
  <SimProfilesProvider>
    <ConnectionScenariosProvider>
      <CustomProfilePageBody />
    </ConnectionScenariosProvider>
  </SimProfilesProvider>
);

export default CustomProfileComponent;
