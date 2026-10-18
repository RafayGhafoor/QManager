"use client";

import React, { useId, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { CardFoot } from "@/components/ui/card-foot";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { SegmentedField } from "@/components/ui/segmented-field";
import { HintIcon } from "@/components/ui/hint-icon";
import {
  type SmsStorageChoice,
  type SmsStorageData,
  type SmsStorageUsage,
  type UseSmsStorageReturn,
} from "@/hooks/use-sms-storage";

// =============================================================================
// SmsStorageCard — where new messages are saved (modem or SIM)
// =============================================================================
// One choice plus two receipt rows (modem, SIM) with their counts. The choice
// only routes NEW messages; the inbox keeps reading both storages, so nothing
// moves when it changes. A storage that is filling up earns a chip (warning at
// 90%, destructive when full); a quiet row otherwise. A SIM store that can't
// be read disables the SIM option, unless it is already the saved choice.
// =============================================================================

const NEARLY_FULL = 0.9;
const ROW = "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm";
const STORAGES: SmsStorageChoice[] = ["ME", "SM"];

function UsageChip({ usage }: { usage: SmsStorageUsage }) {
  const { t } = useTranslation("cellular");
  if (usage.total <= 0) return null;
  if (usage.used >= usage.total) {
    return (
      <Badge variant="destructive">
        <MaterialSymbol name="error" size={12} />
        {t("sms.storage.full")}
      </Badge>
    );
  }
  if (usage.used / usage.total >= NEARLY_FULL) {
    return (
      <Badge variant="warning">
        <MaterialSymbol name="warning" size={12} />
        {t("sms.storage.nearly_full")}
      </Badge>
    );
  }
  return null;
}

const SmsStorageCard = ({ store }: { store: UseSmsStorageReturn }) => {
  const { t } = useTranslation("cellular");
  const { data, isLoading, isSaving, error, save, refresh } = store;
  const { saved, markSaved } = useSaveFlash();
  const formId = useId();
  const [prevData, setPrevData] = useState<SmsStorageData | null>(null);
  const [choice, setChoice] = useState<SmsStorageChoice>("ME");

  // Sync server → local during render (React-Compiler safe).
  if (data && data !== prevData) {
    setPrevData(data);
    setChoice(data.storage);
  }

  const header = (
    <CardHeader>
      <CardTitle>{t("sms.storage.card_title")}</CardTitle>
      <CardDescription>{t("sms.storage.card_description")}</CardDescription>
    </CardHeader>
  );

  if (isLoading) {
    return (
      <Card className="@container/card">
        {header}
        <CardContent className="grid gap-5">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-[2.625rem] w-44 rounded-pill" />
          </div>
          <div className="grid gap-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
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

  if (!data) {
    return (
      <Card className="@container/card">
        {header}
        <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            {error ?? t("sms.storage.load_failed")}
          </span>
          <Button variant="tonal-neutral" size="sm" onClick={refresh}>
            <MaterialSymbol name="refresh" size={16} />
            {t("common:actions.retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const simReadable = !!data.usage.SM;
  const isDirty = choice !== data.storage;
  const canSave = isDirty && !isSaving;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    const result = await save(choice);
    if (result.ok) {
      markSaved();
      toast.success(t("sms.storage.toast_saved"));
    } else {
      toast.error(result.error);
    }
  };

  return (
    <Card className="@container/card">
      {header}
      <CardContent>
        <form id={formId} className="grid gap-5" onSubmit={handleSave}>
          <Field>
            <div className="flex items-center gap-1.5">
              <FieldLabel>{t("sms.storage.field_label")}</FieldLabel>
              <HintIcon label={t("sms.storage.hint_label")}>
                {t("sms.storage.hint")}
              </HintIcon>
            </div>
            <SegmentedField
              value={choice}
              onValueChange={(v) => setChoice(v as SmsStorageChoice)}
              options={[
                { value: "ME", label: t("sms.storage.option_modem") },
                {
                  value: "SM",
                  label: t("sms.storage.option_sim"),
                  disabled: !simReadable && data.storage !== "SM",
                },
              ]}
              ariaLabel={t("sms.storage.field_label")}
              breakpoint="never"
              className="w-fit"
              glyph={(className) => (
                <MaterialSymbol name="check" size={16} className={className} />
              )}
            />
          </Field>

          <div className="grid gap-2">
            {STORAGES.map((s) => {
              const usage = data.usage[s];
              return (
                <div key={s} className={ROW}>
                  <span className="text-muted-foreground">
                    {s === "ME" ? t("sms.storage.row_modem") : t("sms.storage.row_sim")}
                  </span>
                  <span className="flex items-center gap-2">
                    {usage ? <UsageChip usage={usage} /> : null}
                    <span className="font-medium tabular-nums text-on-surface">
                      {usage
                        ? t("sms.storage.used_of_total", {
                            used: usage.used,
                            total: usage.total,
                          })
                        : t("sms.storage.unavailable")}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </form>
      </CardContent>
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
              onClick={() => setChoice(data.storage)}
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

export default SmsStorageCard;
