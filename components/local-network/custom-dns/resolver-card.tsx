"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { CheckIcon, CircleAlertIcon, RefreshCcwIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { SaveButton } from "@/components/ui/save-button";
import { SEGMENTED, SegmentedField, type SegmentedOption } from "@/components/ui/segmented-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { CUSTOM_PROVIDER_ID, DNS_PROVIDERS } from "./dns-providers";
import type { Draft } from "./draft";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION,
  FOOT,
  PROVIDER_TRIGGER,
  SETTING,
  SKELETON,
} from "./shapes";

// =============================================================================
// ResolverCard — whether custom DNS is on, and which resolver
// =============================================================================
// The anchor of the page and the owner of its one foot: the IPv4 and IPv6
// cards below edit the same draft, and this foot counts and applies all of it.
// =============================================================================

const K = "dns";

type OnOff = "on" | "off";

/** The lucide check that SegmentedField reserves on every segment. */
const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

const ROW_CASCADE = { variants: staggerRows, initial: "hidden", animate: "visible" } as const;

function SettingRow({
  label,
  labelFor,
  sub,
  held = false,
  children,
}: {
  label: string;
  labelFor?: string;
  sub: string;
  held?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.div variants={staggerRowItem} className={SETTING.ROW}>
      <div className={cn(SETTING.KEY, held && SETTING.HELD)}>
        {labelFor ? (
          <label htmlFor={labelFor} className={SETTING.KEY_LINE}>
            {label}
          </label>
        ) : (
          <span className={SETTING.KEY_LINE}>{label}</span>
        )}
        <span className={SETTING.KEY_SUB}>{sub}</span>
      </div>
      <div className={SETTING.CONTROL}>{children}</div>
    </motion.div>
  );
}

export interface ResolverCardProps {
  status: "pending" | "ready" | "failed";
  formId: string;
  draft: Draft;
  isSaving: boolean;
  saved: boolean;
  isDirty: boolean;
  canApply: boolean;
  /** Why Apply is blocked, as a translation key; null when it is not. */
  blockedKey: string | null;
  /** The hook's last failure, already translated. */
  error: string | null;
  onToggle: (enabled: boolean) => void;
  onProvider: (id: string) => void;
  onDiscard: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onRetry: () => void;
}

export function ResolverCard({
  status,
  formId,
  draft,
  isSaving,
  saved,
  isDirty,
  canApply,
  blockedKey,
  error,
  onToggle,
  onProvider,
  onDiscard,
  onSubmit,
  onRetry,
}: ResolverCardProps) {
  const { t } = useTranslation("local-network");
  const providerId = React.useId();

  const onOffOptions: SegmentedOption<OnOff>[] = [
    { value: "off", label: t("common:state.off") },
    { value: "on", label: t("common:state.on") },
  ];

  const header = (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>{t(`${K}.cards.resolver.title`)}</CardTitle>
      <CardDescription className={CARD_DESC}>
        {t(`${K}.cards.resolver.description`)}
      </CardDescription>
    </CardHeader>
  );

  if (status === "failed") {
    return (
      <Card className={CARD_SHELL}>
        {header}
        <CardContent className={CARD_PAD}>
          <div role="alert" className={CONDITION.ROOT}>
            <span aria-hidden="true" className={CONDITION.DISC}>
              <CircleAlertIcon className={CONDITION.GLYPH} />
            </span>
            <div className={CONDITION.TEXT}>
              <p className={CONDITION.TITLE}>{t(`${K}.error_load_title`)}</p>
              <p className={CONDITION.BODY}>{error ?? t(`${K}.error_load_desc`)}</p>
            </div>
            <Button variant="ghost" onClick={onRetry} className={CONDITION.ACTION}>
              <RefreshCcwIcon className="size-4" aria-hidden="true" />
              {t("common:actions.retry")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const pending = status === "pending";

  const footStatus = pending ? null : error ? (
    // A failed save stays visible here until the next good read.
    <span className={FOOT.FAILED}>
      <TriangleAlertIcon className={FOOT.GLYPH} aria-hidden="true" />
      {error}
    </span>
  ) : blockedKey !== null ? (
    <span className={FOOT.BLOCKED}>{t(blockedKey)}</span>
  ) : null;

  return (
    <Card className={CARD_SHELL}>
      {header}
      <CardContent className={CARD_PAD}>
        {pending ? (
          <div className={SETTING.GROUP_WIDE} aria-hidden="true">
            {["w-[8.5rem]", "w-56"].map((pill) => (
              <div key={pill} className={SETTING.ROW}>
                <div className="flex flex-col gap-1">
                  <Skeleton className={SKELETON.ROW_KEY} />
                  <Skeleton className={SKELETON.ROW_SUB} />
                </div>
                <Skeleton className={cn(SKELETON.PILL, "ml-auto", pill)} />
              </div>
            ))}
          </div>
        ) : (
          <form id={formId} onSubmit={onSubmit}>
            <motion.div className={SETTING.GROUP_WIDE} {...ROW_CASCADE}>
              <SettingRow
                label={t(`${K}.rows.mode.label`)}
                sub={t(
                  draft.enabled
                    ? `${K}.rows.mode.consequence_on`
                    : `${K}.rows.mode.consequence_off`,
                )}
              >
                <SegmentedField
                  value={draft.enabled ? "on" : "off"}
                  onValueChange={(next) => onToggle(next === "on")}
                  options={onOffOptions}
                  ariaLabel={t(`${K}.rows.mode.label`)}
                  disabled={isSaving}
                  breakpoint="never"
                  glyph={renderCheckGlyph}
                />
              </SettingRow>

              <SettingRow
                label={t(`${K}.rows.provider.label`)}
                labelFor={providerId}
                sub={t(`${K}.rows.provider.consequence`)}
                held={!draft.enabled}
              >
                <div className={PROVIDER_TRIGGER}>
                  <Select
                    value={draft.provider}
                    onValueChange={onProvider}
                    disabled={!draft.enabled || isSaving}
                  >
                    <SelectTrigger id={providerId} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DNS_PROVIDERS.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={CUSTOM_PROVIDER_ID}>
                        {t(`${K}.provider_custom`)}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </SettingRow>
            </motion.div>
          </form>
        )}
      </CardContent>

      {/* Outside the form so `mt-auto` reaches the card edge; `form=` keeps Enter-to-submit. */}
      <CardFoot
        className={CARD_PAD}
        liveStatus={!pending}
        status={footStatus}
        actions={
          pending ? (
            <Skeleton className={SKELETON.ACTION} aria-hidden="true" />
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="action"
                onClick={onDiscard}
                disabled={!isDirty || isSaving}
              >
                {t("common:actions.discard")}
              </Button>
              <SaveButton
                type="submit"
                form={formId}
                isSaving={isSaving}
                saved={saved}
                label={t("common:actions.apply")}
                disabled={!canApply}
                size="action"
              />
            </>
          )
        }
      />
    </Card>
  );
}

export default ResolverCard;
