"use client";

import React from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import {
  CONDITION_TONE,
  ConditionScreen,
} from "@/components/cellular/condition-screen";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import EmptyProfileComponent from "./empty-profile";
import { ApplyProgressDialog } from "./apply-progress-dialog";
import type { UseSimProfilesReturn } from "@/hooks/use-sim-profiles";
import { useProfileApply } from "@/hooks/use-profile-apply";
import { useScenarioList } from "@/hooks/use-scenario-list";
import {
  formatProfileDate,
  type ProfileSummary,
  type SimProfile,
  type PdpType,
} from "@/types/sim-profile";
import { setPendingReboot } from "@/lib/reboot/pending";

// =============================================================================
// ProfileViewComponent — the registry: every saved Custom SIM Profile
// =============================================================================
// One of the page's two views (the other is the editor). One card holds the
// whole roster; each profile is one `surface-container` row (the card's one
// inner container), the active profile first.
//
// Identity (the carrier preset, the config: APN, CID, PDP, TTL, HL) is `Tag`s.
// Facts that change what the modem does (an IMEI override, Verizon's MPDN
// lock) are Fact-Is-Info `info` badges with their own glyphs, shown only when
// they apply. Status is the filled chip on the row's right edge.
//
// Data-shape note: list.sh returns summaries only, so every profile's full
// config is prefetched in parallel and ONE skeleton is held until all are in
// (rows never shimmer twice). SIM mismatch is derived client-side through
// `iccidMismatch` (canonical compare, mirrors `iccid_canonicalize`).
//
// Activation opens the Sequenced Pipeline Dialog first; its outcome toasts
// once on close, and a needed reboot defers to the persistent banner. A
// profile bound to another SIM confirms first: apply.sh never checks the
// ICCID, so the profile lands on the SIM in the modem and lasts until the next
// auto-apply (boot, SIM switch, watchdog) finds no match and clears it.
// =============================================================================

type ProfileStatus = "active" | "mismatch" | "inactive";

/** Compare-time ICCID form, mirroring `iccid_canonicalize` (`sim_db.sh`):
 *  drop whitespace, uppercase, strip one trailing BCD pad nibble. */
function canonicalIccid(iccid: string): string {
  return iccid.replace(/\s+/g, "").toUpperCase().replace(/F$/, "");
}

/** Bound to a SIM other than the live one. An empty binding is SIM-agnostic;
 *  an unknown live ICCID is "don't know", never a mismatch. */
function iccidMismatch(
  profileIccid: string,
  currentIccid: string | null,
): boolean {
  if (!profileIccid || !currentIccid) return false;
  return canonicalIccid(profileIccid) !== canonicalIccid(currentIccid);
}

function deriveStatus(
  isActive: boolean,
  profileIccid: string,
  currentIccid: string | null,
): ProfileStatus {
  if (!isActive) return "inactive";
  if (iccidMismatch(profileIccid, currentIccid)) return "mismatch";
  return "active";
}

/** No two states share a glyph (success and warning containers are 1.03:1). */
const STATUS_CHIP: Record<
  ProfileStatus,
  { variant: BadgeVariant; glyph: MaterialSymbolName; key: string }
> = {
  active: {
    variant: "success",
    glyph: "check_circle",
    key: "custom_profiles.table.status_badge.active",
  },
  mismatch: {
    variant: "warning",
    glyph: "warning",
    key: "custom_profiles.table.status_badge.sim_mismatch",
  },
  inactive: {
    variant: "muted",
    glyph: "do_not_disturb_on",
    key: "custom_profiles.table.status_badge.inactive",
  },
};

const ROW =
  "flex flex-col gap-3 rounded-tile bg-surface-container px-4 py-3.5 @3xl/card:px-5";

interface ProfileViewProps {
  sim: UseSimProfilesReturn;
  /** Live SIM ICCID from current_settings.sh, for mismatch detection. */
  currentIccid: string | null;
  /** Open the editor on a saved profile. */
  onEdit: (id: string) => void;
  /** Open the editor on a new profile. */
  onAdd: () => void;
}

const ProfileViewComponent = ({
  sim,
  currentIccid,
  onEdit,
  onAdd,
}: ProfileViewProps) => {
  const { t } = useTranslation("cellular");
  const { profiles, activeProfileId, isLoading, error, getProfile } = sim;
  const { deleteProfile, deactivateProfile, refresh } = sim;
  const { nameForId } = useScenarioList();

  const { applyProfile, applyState, error: applyError, reset } =
    useProfileApply();
  const [applyOpen, setApplyOpen] = React.useState(false);
  const [pendingDelete, setPendingDelete] =
    React.useState<ProfileSummary | null>(null);
  const [pendingMismatch, setPendingMismatch] =
    React.useState<ProfileSummary | null>(null);

  const startApply = (id: string) => {
    setApplyOpen(true);
    applyProfile(id);
  };

  // A profile bound to another SIM confirms before anything is written.
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

  // On close (only reachable at a terminal state): one toast for the outcome,
  // refresh the list if it landed, and defer an IMEI-change reboot. Read the
  // state BEFORE reset() clears it.
  const handleApplyClose = () => {
    const finished = applyState?.status;
    const name = applyState?.profile_name ?? "";
    const needsReboot = applyState?.requires_reboot === true;
    const succeeded = finished === "complete" || finished === "partial";
    const failure =
      applyError ?? t("custom_profiles.view.toast.activate_error");

    setApplyOpen(false);
    reset();

    if (succeeded) {
      toast.success(
        t(
          finished === "partial"
            ? "custom_profiles.view.toast.activated_partial"
            : "custom_profiles.view.toast.activated",
          { name },
        ),
      );
      refresh();
      if (needsReboot) setPendingReboot("imei");
    } else if (finished === "failed") {
      toast.error(failure);
    }
  };

  const applyTerminal =
    applyState?.status === "complete" ||
    applyState?.status === "partial" ||
    applyState?.status === "failed";

  const handleDeactivate = async (profile: ProfileSummary) => {
    const result = await deactivateProfile();
    if (result.ok) {
      toast.success(
        t("custom_profiles.view.toast.deactivated", { name: profile.name }),
      );
      if (result.requiresReboot) setPendingReboot("verizon_revert");
    } else {
      toast.error(result.error);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    const result = await deleteProfile(target.id);
    if (result.ok) {
      toast.success(
        t("custom_profiles.view.toast.deleted", { name: target.name }),
      );
    } else {
      toast.error(result.error);
    }
  };

  // ---- Detail hydration -----------------------------------------------------
  // One skeleton for the summary fetch AND the detail prefetch; later runs
  // (after create, edit, delete, activate) refresh in the background because
  // `detailsHydrated` only ever turns true.
  const [details, setDetails] = React.useState<Record<string, SimProfile>>({});
  const [detailsHydrated, setDetailsHydrated] = React.useState(false);

  React.useEffect(() => {
    if (isLoading) return;
    if (profiles.length === 0) {
      setDetails({});
      setDetailsHydrated(true);
      return;
    }
    let cancelled = false;
    Promise.all(profiles.map((p) => getProfile(p.id))).then((results) => {
      if (cancelled) return;
      const next: Record<string, SimProfile> = {};
      profiles.forEach((p, i) => {
        if (results[i]) next[p.id] = results[i] as SimProfile;
      });
      setDetails(next);
      setDetailsHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [profiles, getProfile, isLoading]);

  const showSkeleton =
    (isLoading && profiles.length === 0) ||
    (profiles.length > 0 && !detailsHydrated);
  // A failed list read with nothing to show: say so, never "no profiles yet".
  const showError = !isLoading && profiles.length === 0 && error !== null;

  const ordered = React.useMemo(
    () =>
      [...profiles].sort(
        (a, b) =>
          (a.id === activeProfileId ? 0 : 1) -
          (b.id === activeProfileId ? 0 : 1),
      ),
    [profiles, activeProfileId],
  );

  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <CardTitle>{t("custom_profiles.view.title")}</CardTitle>
            <CardDescription>
              {profiles.length > 0
                ? t("custom_profiles.view.count", {
                    count: profiles.length,
                  })
                : t("custom_profiles.view.subtitle")}
            </CardDescription>
          </div>
          {profiles.length > 0 ? (
            <Button size="action" onClick={onAdd}>
              <MaterialSymbol name="add" size={18} />
              {t("custom_profiles.registry.add")}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {showSkeleton ? (
          <ListSkeleton />
        ) : showError ? (
          <ConditionScreen
            tone="destructive"
            glyph="error"
            ariaRole="alert"
            title={t("custom_profiles.registry.error_title")}
            description={error ?? ""}
            onRetry={refresh}
            retryLabel={t("actions.retry", { ns: "common" })}
            className="rounded-tile py-10"
          />
        ) : profiles.length === 0 ? (
          <EmptyProfileComponent onAdd={onAdd} />
        ) : (
          <motion.div
            className="flex flex-col gap-2.5"
            variants={staggerRows}
            initial="hidden"
            animate="visible"
          >
            {ordered.map((profile) => (
              <ProfileRow
                key={profile.id}
                summary={profile}
                status={deriveStatus(
                  profile.id === activeProfileId,
                  profile.sim_iccid,
                  currentIccid,
                )}
                scenarioName={nameForId(profile.scenario.default)}
                busy={
                  applyOpen &&
                  !applyTerminal &&
                  applyState?.profile_id === profile.id
                }
                otherSim={iccidMismatch(profile.sim_iccid, currentIccid)}
                full={details[profile.id] ?? null}
                onActivate={() => handleActivate(profile)}
                onDeactivate={() => handleDeactivate(profile)}
                onEdit={() => onEdit(profile.id)}
                onDelete={() => setPendingDelete(profile)}
              />
            ))}
          </motion.div>
        )}
      </CardContent>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("custom_profiles.view.delete_title", {
                name: pendingDelete?.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("custom_profiles.view.delete_description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("custom_profiles.view.delete_keep")}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              {t("custom_profiles.table.actions_menu.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      <ApplyProgressDialog
        open={applyOpen}
        applyState={applyState}
        error={applyError}
        onClose={handleApplyClose}
      />
    </Card>
  );
};

// -----------------------------------------------------------------------------
// One profile. Narrow: a stacked block. Wide: identity and config on the left,
// status and the action on the right edge (every element on two edges).
// -----------------------------------------------------------------------------
const ProfileRow = ({
  summary,
  status,
  scenarioName,
  busy,
  otherSim,
  full,
  onActivate,
  onDeactivate,
  onEdit,
  onDelete,
}: {
  summary: ProfileSummary;
  status: ProfileStatus;
  scenarioName: string;
  busy: boolean;
  /** Bound to a SIM other than the one in the modem. */
  otherSim: boolean;
  full: SimProfile | null;
  onActivate: () => void;
  onDeactivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) => {
  const { t } = useTranslation("cellular");
  const isActive = status !== "inactive";
  const scheduled = summary.scenario.schedule.enabled;
  const verizonMpdn = summary.mno === "Verizon";
  const chip = STATUS_CHIP[status];
  const warning = CONDITION_TONE.warning;

  return (
    <motion.div variants={staggerRowItem} className={ROW}>
      <div className="flex flex-col gap-3 @3xl/card:flex-row @3xl/card:items-start @3xl/card:justify-between">
        {/* Identity, scenario binding and config */}
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">
              {summary.name}
            </span>
            {summary.mno ? <Tag variant="neutral">{summary.mno}</Tag> : null}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-on-surface-variant">
            <MaterialSymbol
              name={scheduled ? "schedule" : "route"}
              size={14}
              className="flex-none"
            />
            <span className="truncate">
              {scheduled
                ? t("custom_profiles.view.scenario_scheduled", {
                    scenario: scenarioName,
                  })
                : t("custom_profiles.view.scenario_always_on", {
                    scenario: scenarioName,
                  })}
            </span>
          </div>
          {full ? (
            <ConfigPills
              profile={full}
              verizonMpdn={verizonMpdn}
              otherSim={otherSim && !isActive}
            />
          ) : null}
        </div>

        {/* Status, the one action, the overflow menu */}
        <div className="flex flex-none flex-wrap items-center gap-2 @3xl/card:justify-end">
          <Badge variant={chip.variant}>
            <MaterialSymbol name={chip.glyph} size={12} />
            {t(chip.key)}
          </Badge>
          {isActive ? (
            <Button variant="tonal-neutral" size="sm" onClick={onDeactivate}>
              <MaterialSymbol name="power_settings_new" size={16} />
              {t("custom_profiles.table.actions_menu.deactivate")}
            </Button>
          ) : (
            <Button size="sm" onClick={onActivate} disabled={busy}>
              <MaterialSymbol
                name={busy ? "progress_activity" : "play_arrow"}
                size={16}
                className={busy ? "motion-safe:animate-spin" : undefined}
              />
              {busy
                ? t("custom_profiles.view.activating")
                : t("custom_profiles.table.actions_menu.activate")}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-on-surface-variant"
                aria-label={t("custom_profiles.table.actions_menu.open_menu")}
              >
                <MaterialSymbol name="more_vert" size={18} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={onEdit}>
                <MaterialSymbol name="edit" size={16} />
                {t("custom_profiles.table.actions_menu.edit")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <MaterialSymbol name="delete" size={16} />
                {t("custom_profiles.table.actions_menu.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {status === "mismatch" ? (
        <div
          role="status"
          className={cn(
            "flex items-start gap-2 rounded-field px-3 py-2 text-xs",
            warning.container,
          )}
        >
          <MaterialSymbol name="sim_card" size={16} className="flex-none" />
          <span>{t("custom_profiles.view.mismatch_note")}</span>
        </div>
      ) : null}

      <span className="text-[11px] text-on-surface-variant tabular-nums">
        {t("custom_profiles.card.label_updated")}{" "}
        {formatProfileDate(summary.updated_at)}
      </span>
    </motion.div>
  );
};

// -----------------------------------------------------------------------------
// Config readout: identity is Tags; facts that change the modem's behaviour
// are Fact-Is-Info badges, each with its own glyph, shown only when they apply.
// -----------------------------------------------------------------------------
const PDP_PILL_KEY: Record<PdpType, string> = {
  IP: "custom_profiles.pills.ip_v4",
  IPV6: "custom_profiles.pills.ip_v6",
  IPV4V6: "custom_profiles.pills.ip_dual",
};

const ConfigPills = ({
  profile,
  verizonMpdn,
  otherSim,
}: {
  profile: SimProfile;
  verizonMpdn: boolean;
  /** Inactive and bound to another SIM (the active row has its own chip). */
  otherSim: boolean;
}) => {
  const { t } = useTranslation("cellular");
  const { apn, imei, ttl, hl } = profile.settings;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Tag variant="neutral">
        {apn.name.trim() ? (
          <>
            {t("custom_profiles.pills.apn_prefix")}
            <span className="font-mono break-all">{apn.name}</span>
          </>
        ) : (
          t("custom_profiles.pills.apn_default")
        )}
      </Tag>
      <Tag variant="neutral" className="tabular-nums">
        {t("custom_profiles.pills.cid", { cid: apn.cid })}
      </Tag>
      <Tag variant="neutral">
        {PDP_PILL_KEY[apn.pdp_type] ? t(PDP_PILL_KEY[apn.pdp_type]) : apn.pdp_type}
      </Tag>
      {ttl > 0 ? (
        <Tag variant="neutral" className="tabular-nums">
          {t("custom_profiles.pills.ttl", { value: ttl })}
        </Tag>
      ) : null}
      {hl > 0 ? (
        <Tag variant="neutral" className="tabular-nums">
          {t("custom_profiles.pills.hl", { value: hl })}
        </Tag>
      ) : null}
      {imei.trim() !== "" ? (
        <Badge variant="info">
          <MaterialSymbol name="fingerprint" size={12} />
          {t("custom_profiles.pills.imei_override")}
        </Badge>
      ) : null}
      {verizonMpdn ? (
        <Badge variant="info">
          <MaterialSymbol name="alt_route" size={12} />
          {t("custom_profiles.pills.mpdn_locked")}
        </Badge>
      ) : null}
      {otherSim ? (
        <Badge variant="info">
          <MaterialSymbol name="sim_card_alert" size={12} />
          {t("custom_profiles.pills.other_sim")}
        </Badge>
      ) : null}
    </div>
  );
};

// -----------------------------------------------------------------------------
// Skeleton: the row shape, imported from `ROW` so the two cannot drift.
// -----------------------------------------------------------------------------
const SkeletonRow = () => (
  <div className={ROW}>
    <div className="flex flex-col gap-3 @3xl/card:flex-row @3xl/card:justify-between">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-44" />
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-24 rounded-pill" />
          <Skeleton className="h-5 w-12 rounded-pill" />
          <Skeleton className="h-5 w-16 rounded-pill" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-16 rounded-pill" />
        <Skeleton className="h-8 w-24 rounded-pill" />
      </div>
    </div>
    <Skeleton className="h-3 w-28" />
  </div>
);

const ListSkeleton = () => (
  <div className="flex flex-col gap-2.5">
    <SkeletonRow />
    <SkeletonRow />
  </div>
);

export default ProfileViewComponent;
