"use client";

import { useId, useState, type FormEvent, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { Loader2, AlertTriangleIcon } from "lucide-react";
import { SaveButton } from "@/components/ui/save-button";
import { CardFoot } from "@/components/ui/card-foot";

interface IMEISettingsCardProps {
  currentImei: string | null;
  isLoading: boolean;
  isSaving: boolean;
  onSave: (imei: string) => Promise<boolean>;
  onReboot: () => Promise<boolean>;
}

const IMEISettingsCard = ({
  currentImei,
  isLoading,
  isSaving,
  onSave,
  onReboot,
}: IMEISettingsCardProps) => {
  const { t } = useTranslation("cellular");
  const formId = useId();
  const [imei, setImei] = useState<string>("");
  const [showRebootDialog, setShowRebootDialog] = useState(false);
  const [isRebooting, setIsRebooting] = useState(false);

  // Seed local form state from fetched data using the render-phase derived-state
  // pattern (React docs: "You Might Not Need an Effect") instead of useEffect, so
  // the sync lands in the same commit. prevImei keeps it to one sync per source
  // change — identical semantics to the previous [currentImei] effect.
  const [prevImei, setPrevImei] = useState(currentImei);
  if (currentImei !== null && currentImei !== prevImei) {
    setPrevImei(currentImei);
    setImei(currentImei);
  }

  const isValidImei = /^\d{15}$/.test(imei);
  const hasChanged = imei !== (currentImei ?? "");
  const showImeiError = imei.length > 0 && !isValidImei;

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();

    if (!isValidImei) return;

    if (!hasChanged) {
      toast.info(t("core_settings.imei.settings_card.toast.no_changes"));
      return;
    }

    const success = await onSave(imei);
    if (success) {
      toast.success(t("core_settings.imei.settings_card.toast.success"));
      setShowRebootDialog(true);
    } else {
      toast.error(t("core_settings.imei.settings_card.toast.error"));
    }
  };

  const handleReset = () => {
    if (currentImei !== null) {
      setImei(currentImei);
    }
  };

  const handleReboot = async (e: React.MouseEvent) => {
    e.preventDefault(); // Keep dialog open to show rebooting state
    setIsRebooting(true);
    const sent = await onReboot();
    if (sent) {
      toast.success(t("core_settings.imei.settings_card.toast.rebooting"));
    } else {
      toast.error(t("core_settings.imei.settings_card.toast.reboot_error"));
      setIsRebooting(false);
    }
  };

  // Only allow digits in the input
  const handleImeiChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 15);
    setImei(value);
  };

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("core_settings.imei.settings_card.title")}</CardTitle>
          <CardDescription>
            {t("core_settings.imei.settings_card.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-3 w-64" />
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
        <CardTitle>{t("core_settings.imei.settings_card.title")}</CardTitle>
        <CardDescription>
          {t("core_settings.imei.settings_card.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id={formId} className="grid gap-4" onSubmit={handleSave}>
          <div className="w-full">
            <FieldSet>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="device-imei-input">
                    {t("core_settings.imei.settings_card.field_label")}
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="device-imei-input"
                      placeholder={t("core_settings.imei.settings_card.field_placeholder")}
                      value={imei}
                      onChange={handleImeiChange}
                      maxLength={15}
                      inputMode="numeric"
                      disabled={isSaving}
                      aria-invalid={showImeiError}
                      aria-describedby={showImeiError ? "imei-error" : undefined}
                    />
                    <InputGroupAddon align="inline-start">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="pl-1.5 inline-flex items-center"
                            aria-label={t("core_settings.imei.settings_card.warning_aria")}
                          >
                            <AlertTriangleIcon className="text-muted-foreground size-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            {t("core_settings.imei.settings_card.warning_content")}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </InputGroupAddon>
                  </InputGroup>
                  {showImeiError && (
                    <FieldError id="imei-error">
                      {t("core_settings.imei.settings_card.length_error", { count: imei.length })}
                    </FieldError>
                  )}
                  <FieldDescription>
                    {t("core_settings.imei.settings_card.field_description")}
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </FieldSet>
          </div>
        </form>

        {/* Reboot confirmation dialog */}
        <AlertDialog open={showRebootDialog} onOpenChange={(open) => {
          if (!isRebooting) setShowRebootDialog(open);
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("core_settings.imei.settings_card.reboot_dialog.title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("core_settings.imei.settings_card.reboot_dialog.description")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRebooting}>
                {t("core_settings.imei.settings_card.reboot_dialog.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isRebooting}
                onClick={handleReboot}
              >
                {isRebooting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t("core_settings.imei.settings_card.reboot_dialog.rebooting")}
                  </>
                ) : (
                  t("core_settings.imei.settings_card.reboot_dialog.reboot")
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
          hasChanged ? (
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
              disabled={!hasChanged || isSaving}
            >
              {t("common:actions.discard")}
            </Button>
            <SaveButton
              type="submit"
              form={formId}
              isSaving={isSaving}
              saved={false}
              label={t("core_settings.imei.settings_card.write_button")}
              disabled={!isValidImei || !hasChanged}
              size="action"
            />
          </>
        }
      />
    </Card>
  );
};

export default IMEISettingsCard;
