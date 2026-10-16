"use client";

import { useId, useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { CardFoot } from "@/components/ui/card-foot";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useMtuSettings } from "@/hooks/use-mtu-settings";

// =============================================================================
// MTUSettingsCard — MTU Configuration
// =============================================================================
// Connected to the useMtuSettings hook for fetching and saving MTU.
// Toggle on/off enables or disables custom MTU across rmnet_data interfaces.
// =============================================================================

const MTUSettingsCard = () => {
  const { t } = useTranslation("local-network");
  const { data, isLoading, isSaving, error, saveMtu, disableMtu } =
    useMtuSettings();

  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("mtu.card_title")}</CardTitle>
          <CardDescription>{t("mtu.card_description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-10 w-full" />
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

  // Key-based remount — form reinitializes when data changes
  const formKey = data
    ? `${data.isEnabled}-${data.currentValue}`
    : "empty";

  return (
    <MTUForm
      key={formKey}
      data={data}
      isSaving={isSaving}
      error={error}
      saveMtu={saveMtu}
      disableMtu={disableMtu}
    />
  );
};

function MTUForm({
  data,
  isSaving,
  error,
  saveMtu,
  disableMtu,
}: {
  data: ReturnType<typeof useMtuSettings>["data"];
  isSaving: boolean;
  error: string | null;
  saveMtu: ReturnType<typeof useMtuSettings>["saveMtu"];
  disableMtu: ReturnType<typeof useMtuSettings>["disableMtu"];
}) {
  const { t } = useTranslation("local-network");
  const { saved, markSaved } = useSaveFlash();
  const formId = useId();

  // Form state initialized from data — no sync effect needed
  const [isEnabled, setIsEnabled] = useState(data?.isEnabled ?? false);
  const [mtuValue, setMtuValue] = useState(
    data ? String(data.currentValue) : "",
  );

  const isDirty = useMemo(() => {
    if (!data) return false;
    return (
      mtuValue !== String(data.currentValue) || isEnabled !== data.isEnabled
    );
  }, [data, mtuValue, isEnabled]);

  const mtuNum = Number(mtuValue);
  const isMtuInvalid =
    isEnabled &&
    mtuValue !== "" &&
    (isNaN(mtuNum) || mtuNum < 576 || mtuNum > 9000);

  const handleToggle = useCallback(
    (checked: boolean) => {
      setIsEnabled(checked);
      if (!checked && data) {
        setMtuValue(String(data.currentValue));
      }
    },
    [data],
  );

  const handleDiscard = useCallback(() => {
    if (!data) return;
    setIsEnabled(data.isEnabled);
    setMtuValue(String(data.currentValue));
  }, [data]);

  const handleSave = useCallback(async () => {
    if (!isEnabled) {
      const success = await disableMtu();
      if (success) {
        markSaved();
        toast.success(t("mtu.toast_success_disabled"));
      } else {
        toast.error(t("mtu.toast_error_apply"));
      }
      return;
    }

    const mtu = parseInt(mtuValue, 10);
    if (isNaN(mtu) || mtu < 576 || mtu > 9000) return;

    const success = await saveMtu(mtu);
    if (success) {
      markSaved();
      toast.success(t("mtu.toast_success_enabled", { mtu }));
    } else {
      toast.error(t("mtu.toast_error_apply"));
    }
  }, [isEnabled, mtuValue, saveMtu, disableMtu, markSaved, t]);

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("mtu.card_title")}</CardTitle>
        <CardDescription>{t("mtu.card_description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id={formId}
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
        >
          <FieldSet>
            <FieldGroup>
              <div className="grid gap-2">
                <Field orientation="horizontal" className="w-fit">
                  <FieldLabel htmlFor="mtu-setting">
                    {t("mtu.label_enable")}
                  </FieldLabel>
                  <Switch
                    id="mtu-setting"
                    checked={isEnabled}
                    onCheckedChange={handleToggle}
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="mtu-value">{t("mtu.label_mtu")}</FieldLabel>
                <Input
                  id="mtu-value"
                  type="number"
                  min="576"
                  max="9000"
                  placeholder={t("mtu.placeholder_mtu")}
                  className="w-full"
                  value={mtuValue}
                  onChange={(e) => setMtuValue(e.target.value)}
                  disabled={!isEnabled}
                  aria-invalid={isMtuInvalid}
                  aria-describedby={isMtuInvalid ? "mtu-error" : undefined}
                />
                {isMtuInvalid && (
                  <FieldError id="mtu-error">
                    {t("mtu.error_range")}
                  </FieldError>
                )}
              </Field>
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
      {/* Outside the form so `mt-auto` reaches the card edge; `form=` keeps Enter-to-submit. */}
      <CardFoot
        className="px-6"
        status={
          error && !isSaving ? (
            <span className="text-destructive">
              {error}
            </span>
          ) : isDirty ? (
            <span className="font-medium">{t("common:state.unsaved")}</span>
          ) : null
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="action"
              onClick={handleDiscard}
              disabled={!isDirty || isSaving}
            >
              {t("common:actions.discard")}
            </Button>
            <SaveButton
              type="submit"
              form={formId}
              isSaving={isSaving}
              saved={saved}
              label={t("actions.apply", { ns: "common" })}
              disabled={!isDirty || isMtuInvalid}
              size="action"
            />
          </>
        }
      />
    </Card>
  );
}

export default MTUSettingsCard;
