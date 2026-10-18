"use client";

import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type {
  MbnActionResult,
  MbnProfile,
  MbnSaveRequest,
} from "@/types/mbn-settings";

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
  // Form state
  const [localAutoSel, setLocalAutoSel] = useState<string>("");
  const [selectedProfile, setSelectedProfile] = useState<string>("");

  // Reboot dialog
  const [showRebootDialog, setShowRebootDialog] = useState(false);
  const [isRebooting, setIsRebooting] = useState(false);

  // Seed local form state from fetched data using the render-phase derived-state
  // pattern (React docs: "You Might Not Need an Effect") instead of useEffect, so
  // the sync lands in the same commit. The prev refs make this re-run only when a
  // source changes — identical semantics to the previous [profiles, autoSel]
  // effect.
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

  const isDirty =
    (autoSel !== null && localAutoSel !== "" && localAutoSel !== String(autoSel)) ||
    (profiles !== null &&
      selectedProfile !== (profiles.find((p) => p.selected)?.name ?? ""));

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!profiles) return;

    const currentAutoSel = autoSel !== null ? String(autoSel) : "";
    const currentProfile = profiles.find((p) => p.selected);

    // Case 1: Auto-select changed to enabled
    if (localAutoSel === "1" && currentAutoSel !== "1") {
      const result = await onSave({ action: "auto_sel", auto_sel: 1 });
      if (result.ok) {
        toast.success(t("core_settings.apn.mbn.toast.auto_enabled"));
        setShowRebootDialog(true);
      } else {
        toast.error(result.error);
      }
      return;
    }

    // Case 2: Auto-select changed to disabled (without profile change)
    if (localAutoSel === "0" && currentAutoSel !== "0" && selectedProfile === currentProfile?.name) {
      const result = await onSave({ action: "auto_sel", auto_sel: 0 });
      if (result.ok) {
        toast.success(t("core_settings.apn.mbn.toast.auto_disabled"));
        setShowRebootDialog(true);
      } else {
        toast.error(result.error);
      }
      return;
    }

    // Case 3: Profile changed (auto-sel is off or being turned off)
    if (localAutoSel === "0" && selectedProfile && selectedProfile !== currentProfile?.name) {
      const result = await onSave({
        action: "apply_profile",
        profile_name: selectedProfile,
      });
      if (result.ok) {
        toast.success(t("core_settings.apn.mbn.toast.profile_applied"));
        setShowRebootDialog(true);
      } else {
        toast.error(result.error);
      }
    }
    // Save is disabled while clean, so there is no "no changes" branch.
  };

  /** "Later": persist the deferred-reboot flag so the page banner stays up. */
  const handleRebootLater = () => {
    requestRebootLater("mbn");
    setShowRebootDialog(false);
  };

  const handleReset = () => {
    if (autoSel !== null) {
      setLocalAutoSel(String(autoSel));
    }
    if (profiles) {
      const active = profiles.find((p) => p.selected);
      setSelectedProfile(active?.name ?? "");
    }
  };

  const handleReboot = async (e: React.MouseEvent) => {
    e.preventDefault(); // Keep dialog open to show rebooting state
    setIsRebooting(true);
    // The /reboot/ hand-off is the success signal; only a failure toasts.
    const sent = await onReboot();
    if (!sent) {
      toast.error(t("core_settings.apn.mbn.toast.reboot_error"));
      setIsRebooting(false);
    }
  };

  if (!isLoading && loadError) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("core_settings.apn.mbn.card.title")}</CardTitle>
          <CardDescription>
            {t("core_settings.apn.mbn.card.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConditionScreen
            tone="destructive"
            glyph="error"
            ariaRole="alert"
            title={t("core_settings.apn.mbn.load_error_title")}
            description={loadError}
            onRetry={onRetry}
            retryLabel={t("actions.retry", { ns: "common" })}
            className="rounded-tile py-10"
          />
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("core_settings.apn.mbn.card.title")}</CardTitle>
          <CardDescription>
            {t("core_settings.apn.mbn.card.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="space-y-2 ">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-9 w-full" />
            </div>
            <div className="space-y-2 ">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
        </CardContent>
        <CardFoot
          className="px-6"
          liveStatus={false}
          aria-hidden="true"
          actions={<Skeleton className="h-[2.625rem] w-40 rounded-pill" />}
        />
      </Card>
    );
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("core_settings.apn.mbn.card.title")}</CardTitle>
        <CardDescription>
          {t("core_settings.apn.mbn.card.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id={formId} className="grid gap-4" onSubmit={handleSave}>
          <div className="w-full">
            <FieldSet>
              <FieldGroup>
                <Field>
                  <FieldLabel>{t("core_settings.apn.mbn.auto_select.label")}</FieldLabel>
                  <SegmentedField
                    value={
                      (localAutoSel ||
                        (autoSel !== null ? String(autoSel) : "0")) as
                        | "0"
                        | "1"
                    }
                    onValueChange={setLocalAutoSel}
                    options={[
                      { value: "1", label: t("common:state.on") },
                      { value: "0", label: t("common:state.off") },
                    ]}
                    ariaLabel={t("core_settings.apn.mbn.auto_select.label")}
                    disabled={isSaving}
                    breakpoint="never"
                    className="w-fit"
                    glyph={(className) => (
                      <MaterialSymbol name="check" size={16} className={className} />
                    )}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="mbn-carrier-config">{t("core_settings.apn.mbn.configuration.label")}</FieldLabel>
                  <Select
                    value={
                      selectedProfile ||
                      (profiles
                        ? profiles.find((p) => p.selected)?.name ?? ""
                        : "")
                    }
                    onValueChange={setSelectedProfile}
                    disabled={isSaving || localAutoSel === "1"}
                  >
                    <SelectTrigger id="mbn-carrier-config" className="font-mono" aria-label={t("core_settings.apn.mbn.configuration.label")}>
                      <SelectValue placeholder={t("core_settings.apn.mbn.configuration.placeholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles?.map((p) => (
                        <SelectItem key={p.index} value={p.name} className="font-mono">
                          {p.name}
                          {p.selected && p.activated ? t("core_settings.apn.mbn.configuration.option_active_suffix") : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>
            </FieldSet>
          </div>
        </form>

        {/* Reboot confirmation dialog */}
        <AlertDialog open={showRebootDialog} onOpenChange={(open) => {
          // Any close that is not the reboot itself defers it (Later, Esc,
          // overlay): the change is written and still needs a reboot.
          if (isRebooting) return;
          if (!open) handleRebootLater();
          else setShowRebootDialog(true);
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("core_settings.apn.mbn.reboot_dialog.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("core_settings.apn.mbn.reboot_dialog.description")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRebooting}>
                {t("core_settings.apn.mbn.reboot_dialog.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isRebooting}
                onClick={handleReboot}
              >
                {isRebooting ? (
                  <>
                    <MaterialSymbol
                      name="progress_activity"
                      size={16}
                      className="motion-safe:animate-spin"
                    />
                    {t("core_settings.apn.mbn.reboot_dialog.rebooting")}
                  </>
                ) : (
                  t("core_settings.apn.mbn.reboot_dialog.reboot")
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
      {/* Outside the form so `mt-auto` reaches the card edge; `form=` keeps Enter-to-submit. */}
      <CardFoot
        className="px-6"
        status={
          isDirty ? (
            <span className="font-medium">{t("common:state.unsaved")}</span>
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
              label={t("core_settings.apn.mbn.save")}
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
