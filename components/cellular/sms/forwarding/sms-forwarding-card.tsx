"use client";

import React, { useId, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";

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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { CardFoot } from "@/components/ui/card-foot";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SegmentedField } from "@/components/ui/segmented-field";
import { HintIcon } from "@/components/ui/hint-icon";
import { DUR, EASE_STANDARD } from "@/lib/motion";
import {
  type SmsForwardingData,
  type UseSmsForwardingReturn,
} from "@/hooks/use-sms-forwarding";

// =============================================================================
// SmsForwardingCard — the control surface for the daemon-backed SMS relay.
// Setup only: enable toggle + destination number + save. Live status, the
// recipient preview, the test action, and delivery failures all live in the
// companion DeliveryHealthCard, which shares this card's lifted hook.
// =============================================================================

// E.164-ish: optional leading +, first digit 1-9, total 7-15 digits.
const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;

const SmsForwardingCard = ({ fwd }: { fwd: UseSmsForwardingReturn }) => {
  const { t } = useTranslation("cellular");
  const { data, isLoading, isSaving, isSendingTest, saveSettings } = fwd;

  const { saved, markSaved } = useSaveFlash();
  const formId = useId();
  const [prevData, setPrevData] = useState<SmsForwardingData | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [targetPhone, setTargetPhone] = useState("");

  // Sync server → local during render (no setState-in-effect; React-Compiler safe).
  if (data && data !== prevData) {
    setPrevData(data);
    setIsEnabled(data.settings.enabled);
    setTargetPhone(data.settings.target_phone);
  }

  // Only validate while enabling — turning forwarding off must never be blocked
  // by a stale/invalid number left in the field.
  const phoneError =
    isEnabled && targetPhone && !PHONE_REGEX.test(targetPhone)
      ? t("sms.forwarding.sms.validation_phone")
      : null;

  const isDirty = data
    ? isEnabled !== data.settings.enabled ||
      targetPhone !== data.settings.target_phone
    : false;

  const canSave = !phoneError && isDirty && !isSaving && !isSendingTest;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;

    const result = await saveSettings({
      enabled: isEnabled,
      target_phone: targetPhone,
    });
    if (result.ok) {
      markSaved();
      toast.success(t("sms.forwarding.sms.toast_save_success"));
    } else {
      toast.error(result.error);
    }
  };

  const handleDiscard = () => {
    if (!data) return;
    setIsEnabled(data.settings.enabled);
    setTargetPhone(data.settings.target_phone);
  };

  // --- Loading skeleton ------------------------------------------------------
  // Mirrors the real form geometry (toggle row → labeled input → button) so the
  // card holds its height and nothing snaps when data lands.
  if (isLoading) {
    return (
      <Card className="@container/card h-full">
        <CardHeader>
          <CardTitle>{t("sms.forwarding.sms.card_title")}</CardTitle>
          <CardDescription>
            {t("sms.forwarding.sms.card_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6">
            {/* Enable row */}
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-[2.625rem] w-32 rounded-pill" />
            </div>
            {/* Target field: label + input + helper */}
            <div className="grid gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-full max-w-sm" />
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

  // The page renders the read failure once, in place of both cards.
  if (!data) return null;

  // --- Render ----------------------------------------------------------------
  return (
    <Card className="@container/card h-full">
      <CardHeader>
        <CardTitle>{t("sms.forwarding.sms.card_title")}</CardTitle>
        <CardDescription>
          {t("sms.forwarding.sms.card_description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <motion.form
          id={formId}
          className="grid gap-4"
          onSubmit={handleSave}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.standard, ease: EASE_STANDARD }}
        >
          <FieldSet>
            <FieldGroup>
              {/* Enable toggle */}
              <Field>
                <FieldLabel>{t("sms.forwarding.sms.enable_label")}</FieldLabel>
                <SegmentedField
                  value={isEnabled ? "on" : "off"}
                  onValueChange={(v) => setIsEnabled(v === "on")}
                  options={[
                    { value: "off", label: t("common:state.off") },
                    { value: "on", label: t("common:state.on") },
                  ]}
                  ariaLabel={t("sms.forwarding.sms.enable_label")}
                  breakpoint="never"
                  className="w-fit"
                  glyph={(className) => (
                    <MaterialSymbol name="check" size={16} className={className} />
                  )}
                />
              </Field>

              {/* Target phone */}
              <Field>
                <div className="flex items-center gap-1.5">
                  <FieldLabel htmlFor="sms-forwarding-target">
                    {t("sms.forwarding.sms.target_label")}
                  </FieldLabel>
                  <HintIcon label={t("sms.forwarding.sms.target_hint_label")}>
                    {t("sms.forwarding.sms.target_description")}
                  </HintIcon>
                </div>
                <Input
                  id="sms-forwarding-target"
                  type="tel"
                  inputMode="tel"
                  placeholder={t("sms.forwarding.sms.target_placeholder")}
                  className="max-w-sm font-mono"
                  value={targetPhone}
                  onChange={(e) => setTargetPhone(e.target.value)}
                  disabled={!isEnabled}
                  required={isEnabled}
                  aria-invalid={!!phoneError}
                  aria-describedby={
                    phoneError ? "sms-forwarding-target-error" : undefined
                  }
                  autoComplete="tel"
                />
                {phoneError ? (
                  <FieldError id="sms-forwarding-target-error">
                    {phoneError}
                  </FieldError>
                ) : null}
              </Field>
            </FieldGroup>
          </FieldSet>
        </motion.form>
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
              disabled={!canSave}
              size="action"
            />
          </>
        }
      />
    </Card>
  );
};

export default SmsForwardingCard;
