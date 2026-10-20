"use client";

import * as React from "react";
import { useId, useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SaveButton } from "@/components/ui/save-button";
import { CardFoot } from "@/components/ui/card-foot";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SegmentedField } from "@/components/ui/segmented-field";
import { ConditionScreen } from "@/components/cellular/condition-screen";
import { requestRebootLater } from "@/lib/reboot";
import {
  DUR,
  EASE_STANDARD,
  rowCascadeDelay,
  staggerRowItem,
  staggerRows,
} from "@/lib/motion";
import { cn } from "@/lib/utils";
import type {
  MbnActionResult,
  MbnProfile,
  MbnSaveRequest,
} from "@/types/mbn-settings";

import { SettingRow } from "../setting-row";
import {
  APN_PAIR,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CHOICE_ROW,
  EMPTY_BLOCK,
  REVEAL,
  ROW_GROUP,
  SECTION_LABEL,
  SETTING_ROW,
} from "../shapes";

// =============================================================================
// Carrier Profile (MBN) — the write card beside APN
// =============================================================================
// An auto-select row, then the bundle list as radio rows. The list replaced a
// Select: a closed Select hid the twenty-odd bundles some firmware ships behind
// a click, and hid WHICH one is running. Rows show both at once, the running
// bundle carries a caption, and the drafted one is the `primary-container` row
// (The Highlight-by-Container Rule) with a check glyph, so selection survives
// grayscale.
//
// The list is the card's one slack absorber. Beside the APN card it fills
// whatever height that card sets (`APN_PAIR.LIST_SLOT` / `LIST_FILL`); stacked,
// it caps at the family's scroll cap.
//
// A save never reboots. The dialog after a successful save offers it; any other
// close defers it through the app-wide pending-reboot banner.
// =============================================================================

const K = "core_settings.apn.mbn";

const renderCheckGlyph = (className: string) => (
  <MaterialSymbol name="check" size={16} className={className} />
);

interface MBNCardProps {
  profiles: MbnProfile[] | null;
  autoSel: number | null;
  isLoading: boolean;
  isSaving: boolean;
  /** The first read failed and there is nothing to show (translated). */
  loadError: string | null;
  onRetry: () => void;
  onSave: (request: MbnSaveRequest) => Promise<MbnActionResult>;
  /** Fires the reboot and enters the /reboot/ flow; false if it was not sent. */
  onReboot: () => Promise<boolean>;
}

function MbnCardHeader() {
  const { t } = useTranslation("cellular");
  return (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>{t(`${K}.card.title`)}</CardTitle>
      <CardDescription>{t(`${K}.card.description`)}</CardDescription>
    </CardHeader>
  );
}

const MBNCard = ({
  profiles,
  autoSel,
  isLoading,
  isSaving,
  loadError,
  onRetry,
  onSave,
  onReboot,
}: MBNCardProps) => {
  const { t } = useTranslation("cellular");
  const formId = useId();
  const autoLabelId = useId();
  const listLabelId = useId();
  const listName = useId();

  // Form state
  const [localAutoSel, setLocalAutoSel] = useState<string>("");
  const [selectedProfile, setSelectedProfile] = useState<string>("");

  // Reboot dialog
  const [showRebootDialog, setShowRebootDialog] = useState(false);
  const [isRebooting, setIsRebooting] = useState(false);

  // Seed local form state from fetched data with render-phase derived state
  // rather than an effect, so the sync lands in the same commit. Re-runs only
  // when a source changes.
  const [prevAutoSel, setPrevAutoSel] = useState(autoSel);
  const [prevProfiles, setPrevProfiles] = useState(profiles);
  if (autoSel !== prevAutoSel || profiles !== prevProfiles) {
    setPrevAutoSel(autoSel);
    setPrevProfiles(profiles);
    if (autoSel !== null) {
      setLocalAutoSel(String(autoSel));
    }
    if (profiles) {
      const active = profiles.find((p) => p.selected);
      setSelectedProfile(active?.name ?? "");
    }
  }

  const savedProfile = profiles?.find((p) => p.selected)?.name ?? "";
  const autoValue = (localAutoSel || (autoSel !== null ? String(autoSel) : "0")) as
    | "0"
    | "1";
  const autoOn = autoValue === "1";

  const autoDirty = autoSel !== null && localAutoSel !== "" && localAutoSel !== String(autoSel);
  const profileDirty = profiles !== null && selectedProfile !== savedProfile;
  const isDirty = autoDirty || profileDirty;

  const onOff = (v: string) => (v === "1" ? t("common:state.on") : t("common:state.off"));

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!profiles) return;

    const currentAutoSel = autoSel !== null ? String(autoSel) : "";

    // Case 1: Auto-select changed to enabled
    if (localAutoSel === "1" && currentAutoSel !== "1") {
      const result = await onSave({ action: "auto_sel", auto_sel: 1 });
      if (result.ok) {
        toast.success(t(`${K}.toast.auto_enabled`));
        setShowRebootDialog(true);
      } else {
        toast.error(result.error);
      }
      return;
    }

    // Case 2: Auto-select changed to disabled (without profile change)
    if (localAutoSel === "0" && currentAutoSel !== "0" && selectedProfile === savedProfile) {
      const result = await onSave({ action: "auto_sel", auto_sel: 0 });
      if (result.ok) {
        toast.success(t(`${K}.toast.auto_disabled`));
        setShowRebootDialog(true);
      } else {
        toast.error(result.error);
      }
      return;
    }

    // Case 3: Profile changed (auto-sel is off or being turned off)
    if (localAutoSel === "0" && selectedProfile && selectedProfile !== savedProfile) {
      const result = await onSave({
        action: "apply_profile",
        profile_name: selectedProfile,
      });
      if (result.ok) {
        toast.success(t(`${K}.toast.profile_applied`));
        setShowRebootDialog(true);
      } else {
        toast.error(result.error);
      }
    }
    // Save is disabled while clean, so there is no "no changes" branch.
  };

  /** "Later": persist the deferred-reboot flag so the shell banner stays up. */
  const handleRebootLater = () => {
    requestRebootLater("mbn");
    setShowRebootDialog(false);
  };

  const handleReset = () => {
    if (autoSel !== null) {
      setLocalAutoSel(String(autoSel));
    }
    setSelectedProfile(savedProfile);
  };

  const handleReboot = async (e: React.MouseEvent) => {
    e.preventDefault(); // Keep dialog open to show rebooting state
    setIsRebooting(true);
    // The /reboot/ hand-off is the success signal; only a failure toasts.
    const sent = await onReboot();
    if (!sent) {
      toast.error(t(`${K}.toast.reboot_error`));
      setIsRebooting(false);
    }
  };

  if (!isLoading && loadError) {
    return (
      <Card className={CARD_SHELL}>
        <MbnCardHeader />
        <CardContent className={cn(CARD_PAD, "flex flex-1 flex-col")}>
          <ConditionScreen
            tone="destructive"
            glyph="error"
            ariaRole="alert"
            title={t(`${K}.load_error_title`)}
            description={loadError}
            onRetry={onRetry}
            retryLabel={t("actions.retry", { ns: "common" })}
            className="flex-1 rounded-tile py-10"
          />
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className={CARD_SHELL}>
        <MbnCardHeader />
        <CardContent className={cn(CARD_PAD, "flex flex-1 flex-col gap-4")}>
          <div className={ROW_GROUP.ROOT}>
            <Skeleton className={cn(SETTING_ROW.HEIGHT, "rounded-field")} />
          </div>
          <Skeleton className="h-5 w-40" />
          <div className={APN_PAIR.LIST_SLOT}>
            <Skeleton className={cn(APN_PAIR.LIST_HEIGHT, "w-full @4xl/main:absolute @4xl/main:inset-0 @4xl/main:h-auto")} />
          </div>
        </CardContent>
        <CardFoot
          className={CARD_PAD}
          liveStatus={false}
          aria-hidden="true"
          actions={<Skeleton className="h-[2.625rem] w-40 rounded-pill" />}
        />
      </Card>
    );
  }

  const list = profiles ?? [];

  return (
    <Card className={CARD_SHELL}>
      <MbnCardHeader />
      <CardContent className={cn(CARD_PAD, "flex flex-1 flex-col gap-4")}>
        <form id={formId} onSubmit={handleSave} className="contents">
          <motion.div
            className={ROW_GROUP.ROOT}
            variants={staggerRows}
            initial="hidden"
            animate="visible"
          >
            <motion.div variants={staggerRowItem}>
              <SettingRow
                label={t(`${K}.auto_select.label`)}
                labelId={autoLabelId}
                consequence={t(`${K}.auto_select.consequence`)}
                dirty={autoDirty}
                delta={`${onOff(String(autoSel ?? "0"))} → ${onOff(autoValue)}`}
                control={
                  <SegmentedField
                    value={autoValue}
                    onValueChange={setLocalAutoSel}
                    options={[
                      { value: "1", label: t("common:state.on") },
                      { value: "0", label: t("common:state.off") },
                    ]}
                    ariaLabel={t(`${K}.auto_select.label`)}
                    disabled={isSaving}
                    breakpoint="never"
                    glyph={renderCheckGlyph}
                  />
                }
              />
            </motion.div>
          </motion.div>

          <div className="flex flex-col gap-1">
            <span id={listLabelId} className={SECTION_LABEL}>
              {t(`${K}.configuration.label`)}
            </span>
            {/* Why the list is inert, said where the user is looking. It rides
                the reveal row so toggling auto-select doesn't jump the list. */}
            <div className={cn(REVEAL.ROOT, autoOn ? REVEAL.OPEN : REVEAL.CLOSED)}>
              <div className={REVEAL.CLIP}>
                <p className={SETTING_ROW.CONSEQUENCE}>{t(`${K}.configuration.auto_hint`)}</p>
              </div>
            </div>
          </div>

          <div className={APN_PAIR.LIST_SLOT}>
            {list.length === 0 ? (
              <div className={cn(EMPTY_BLOCK.ROOT, "h-full justify-center")}>
                <MaterialSymbol
                  name="sim_card_alert"
                  size={EMPTY_BLOCK.GLYPH}
                  className="text-on-surface-variant"
                />
                <span className={EMPTY_BLOCK.TITLE}>{t(`${K}.configuration.empty_title`)}</span>
                <span className={EMPTY_BLOCK.BODY}>{t(`${K}.configuration.empty_body`)}</span>
              </div>
            ) : (
              <div
                role="radiogroup"
                aria-labelledby={listLabelId}
                aria-disabled={autoOn || isSaving || undefined}
                className={cn(
                  APN_PAIR.LIST_FILL,
                  "transition-opacity duration-[var(--duration-standard)] ease-standard",
                  (autoOn || isSaving) && "opacity-60",
                )}
              >
                {list.map((p, index) => {
                  const checked = selectedProfile === p.name;
                  const running = p.selected && p.activated;
                  return (
                    <motion.label
                      key={p.index}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: DUR.standard,
                        ease: EASE_STANDARD,
                        delay: rowCascadeDelay(index),
                      }}
                      className={cn(
                        CHOICE_ROW.ROOT,
                        "relative flex-none cursor-pointer has-[input:focus-visible]:ring-[3px] has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-offset-2 has-[input:focus-visible]:ring-offset-surface-container",
                        checked ? CHOICE_ROW.SELECTED : CHOICE_ROW.REST,
                        (autoOn || isSaving) && "cursor-not-allowed hover:bg-transparent",
                      )}
                    >
                      <input
                        type="radio"
                        name={listName}
                        value={p.name}
                        checked={checked}
                        disabled={autoOn || isSaving}
                        onChange={() => setSelectedProfile(p.name)}
                        className="sr-only"
                      />
                      <span className={CHOICE_ROW.TEXT}>
                        <span className={CHOICE_ROW.NAME}>{p.name}</span>
                        {running ? (
                          <span className={CHOICE_ROW.CAPTION}>
                            {t(`${K}.configuration.running`)}
                          </span>
                        ) : null}
                      </span>
                      <span className="grid size-[18px] flex-none place-items-center" aria-hidden="true">
                        {checked ? <MaterialSymbol name="check" size={CHOICE_ROW.GLYPH} /> : null}
                      </span>
                    </motion.label>
                  );
                })}
              </div>
            )}
          </div>
        </form>

        {/* Reboot confirmation dialog */}
        <AlertDialog
          open={showRebootDialog}
          onOpenChange={(open) => {
            // Any close that is not the reboot itself defers it (Later, Esc,
            // overlay): the change is written and still needs a reboot.
            if (isRebooting) return;
            if (!open) handleRebootLater();
            else setShowRebootDialog(true);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t(`${K}.reboot_dialog.title`)}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(`${K}.reboot_dialog.description`)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRebooting}>
                {t(`${K}.reboot_dialog.cancel`)}
              </AlertDialogCancel>
              <AlertDialogAction disabled={isRebooting} onClick={handleReboot}>
                {isRebooting ? (
                  <>
                    <MaterialSymbol
                      name="progress_activity"
                      size={16}
                      className="motion-safe:animate-spin"
                    />
                    {t(`${K}.reboot_dialog.rebooting`)}
                  </>
                ) : (
                  t(`${K}.reboot_dialog.reboot`)
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
      {/* Outside the form so `mt-auto` reaches the card edge; `form=` keeps Enter-to-submit. */}
      <CardFoot
        className={CARD_PAD}
        status={
          isDirty ? (
            <span className="font-medium text-on-surface">{t("common:state.unsaved")}</span>
          ) : null
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="action"
              onClick={handleReset}
              disabled={!isDirty || isSaving}
            >
              {t("common:actions.discard")}
            </Button>
            <SaveButton
              type="submit"
              form={formId}
              isSaving={isSaving}
              saved={false}
              label={t(`${K}.save`)}
              disabled={!isDirty}
              size="action"
            />
          </>
        }
      />
    </Card>
  );
};

export default MBNCard;
