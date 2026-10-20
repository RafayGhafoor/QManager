"use client";

import * as React from "react";
import { useCallback, useId, useMemo, useState } from "react";
import { CheckIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
  SegmentedField,
  SEGMENTED,
  type SegmentedOption,
} from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { cn } from "@/lib/utils";
import type { MutationResult } from "@/types/mutation-result";

import {
  ACTION_HEIGHT,
  CARD_BODY,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  DELTA,
  FIELD,
  FIELD_INVALID,
  FOOT_BLOCKED,
  ROW,
  ROW_GROUP,
  VALUE_NONE,
} from "./shapes";

// =============================================================================
// MtuSettingsCard — the second of Band B's two peer write cards
// =============================================================================
// Two rows: the override On/Off and the value. Same derived-draft and
// refuse-out-loud contract as the TTL card. MTU is not written by any SIM
// profile, so this card stays writable while the TTL card is held.
// =============================================================================

const K = "ttl_mtu";

type OnOff = "on" | "off";

const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

/** The bounds `mtu.sh` enforces. */
const MTU_MIN = 576;
const MTU_MAX = 9000;

const ERR_MTU_RANGE = `${K}.errors.mtu_range`;

export interface MtuCardValue {
  isEnabled: boolean;
  /** What the interface reported (`mtu.sh` falls back to 1500 on a failed read). */
  currentValue: number;
}

interface MtuDraft {
  enabled: boolean;
  mtu: string;
}

const EMPTY_DRAFT: MtuDraft = { enabled: false, mtu: "" };

export interface MtuSettingsCardProps {
  /** The endpoint's reading; `null` until it answers. */
  value: MtuCardValue | null;
  isLoading: boolean;
  isSaving: boolean;
  onApply: (mtu: number) => Promise<MutationResult>;
  onDisable: () => Promise<MutationResult>;
}

/** The pending-change chip; always rendered, `invisible` when clean. */
function DeltaChip({ from, to }: { from: string; to: string }) {
  const clean = from === to;
  return (
    <span
      className={cn(DELTA.ROOT, clean && DELTA.CLEAN)}
      aria-hidden={clean ? "true" : undefined}
    >
      {from}
      <span className={DELTA.ARROW}>→</span>
      {to}
    </span>
  );
}

export function MtuSettingsCard({
  value,
  isLoading,
  isSaving,
  onApply,
  onDisable,
}: MtuSettingsCardProps) {
  const { t } = useTranslation("local-network");
  const { saved, markSaved } = useSaveFlash();

  const formId = useId();
  const mtuId = useId();
  const mtuHintId = useId();
  const onOffOptions: SegmentedOption<OnOff>[] = [
    { value: "on", label: t(`${K}.values.on`) },
    { value: "off", label: t(`${K}.values.off`) },
  ];

  // ---------------------------------------------------------------------------
  // Baseline + edits -> draft
  // ---------------------------------------------------------------------------
  const serverEnabled = value?.isEnabled ?? null;
  const serverMtu = value?.currentValue ?? null;

  const baseline = useMemo<MtuDraft | null>(
    () =>
      serverEnabled === null || serverMtu === null
        ? null
        : { enabled: serverEnabled, mtu: String(serverMtu) },
    [serverEnabled, serverMtu],
  );

  const [edits, setEdits] = useState<Partial<MtuDraft>>({});
  const draft = useMemo<MtuDraft>(
    () => ({ ...(baseline ?? EMPTY_DRAFT), ...edits }),
    [baseline, edits],
  );

  const setField = useCallback(
    <F extends keyof MtuDraft>(field: F, next: MtuDraft[F]) =>
      setEdits((prev) => ({ ...prev, [field]: next })),
    [],
  );

  const enabledDirty = baseline !== null && draft.enabled !== baseline.enabled;
  const mtuDirty = baseline !== null && draft.mtu !== baseline.mtu;
  const isDirty = enabledDirty || mtuDirty;

  // ---------------------------------------------------------------------------
  // Validity
  // ---------------------------------------------------------------------------
  const trimmed = draft.mtu.trim();
  const parsed = trimmed === "" ? null : Number(trimmed);
  const mtuBad =
    draft.enabled &&
    (parsed === null ||
      !Number.isInteger(parsed) ||
      parsed < MTU_MIN ||
      parsed > MTU_MAX);

  const blockedKey = mtuBad ? ERR_MTU_RANGE : null;

  const unread = baseline === null;
  const canApply = !unread && isDirty && blockedKey === null;

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  const handleDiscard = useCallback(() => setEdits({}), []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      if (blockedKey !== null) {
        toast.error(t(blockedKey, { min: MTU_MIN, max: MTU_MAX }));
        return;
      }
      if (!canApply) return;

      // `parsed` is a valid in-range integer whenever the draft is enabled here.
      const next = parsed as number;
      const result = draft.enabled ? await onApply(next) : await onDisable();

      if (!result.ok) {
        // null/null means the page unmounted mid-call: nobody to tell.
        if (result.code !== null || result.error !== null) {
          toast.error(
            resolveErrorMessage(
              t,
              result.code,
              result.error,
              t(`${K}.toast_mtu_error`),
            ),
          );
        }
        return;
      }

      setEdits({});
      markSaved();
      toast.success(
        draft.enabled
          ? t(`${K}.toast_mtu_applied`, { mtu: next })
          : t(`${K}.toast_mtu_cleared`),
      );
    },
    [blockedKey, canApply, draft.enabled, parsed, onApply, onDisable, markSaved, t],
  );

  const header = (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>{t(`${K}.cards.mtu.title`)}</CardTitle>
      <CardDescription>{t(`${K}.cards.mtu.description`)}</CardDescription>
    </CardHeader>
  );

  if (isLoading) {
    return (
      <Card className={CARD_SHELL}>
        {header}
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          <div className={ROW_GROUP}>
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} className={cn(ROW.HEIGHT, "rounded-field")} />
            ))}
          </div>
        </CardContent>
        <CardFoot
          className={CARD_PAD}
          liveStatus={false}
          aria-hidden="true"
          actions={<Skeleton className={cn(ACTION_HEIGHT, "w-40 rounded-pill")} />}
        />
      </Card>
    );
  }

  const valueHeld = unread || !draft.enabled;
  const onOff = (enabled: boolean) =>
    t(enabled ? `${K}.values.on` : `${K}.values.off`);

  return (
    <Card className={CARD_SHELL}>
      {header}
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <form id={formId} onSubmit={handleSubmit} className={CARD_BODY}>
          <div className={ROW_GROUP}>
            {/* Row 1 — the override On/Off. */}
            <div className={ROW.ROOT}>
              <div className={cn(ROW.TEXT, unread && ROW.HELD)}>
                <span className={ROW.LABEL_LINE}>
                  <span className={ROW.LABEL}>{t(`${K}.rows.mtu_toggle.label`)}</span>
                  <DeltaChip
                    from={onOff(baseline?.enabled ?? false)}
                    to={onOff(draft.enabled)}
                  />
                </span>
                <span className={ROW.CONSEQUENCE}>
                  {unread
                    ? t(`${K}.rows.shared.consequence_unread`)
                    : t(`${K}.rows.mtu_toggle.consequence`)}
                </span>
              </div>
              <div className={ROW.CONTROL}>
                <SegmentedField
                  value={draft.enabled ? "on" : "off"}
                  onValueChange={(next) => setField("enabled", next === "on")}
                  options={onOffOptions}
                  ariaLabel={t(`${K}.rows.mtu_toggle.label`)}
                  disabled={unread}
                  breakpoint="never"
                  glyph={renderCheckGlyph}
                />
              </div>
            </div>

            {/* Row 2 — the value. */}
            <div className={ROW.ROOT}>
              <div className={cn(ROW.TEXT, valueHeld && ROW.HELD)}>
                <span className={ROW.LABEL_LINE}>
                  <label htmlFor={mtuId} className={ROW.LABEL}>
                    {t(`${K}.rows.mtu_value.label`)}
                  </label>
                  <DeltaChip
                    from={!baseline || baseline.mtu === "" ? VALUE_NONE : baseline.mtu}
                    to={draft.mtu === "" ? VALUE_NONE : draft.mtu}
                  />
                </span>
                <span id={mtuHintId} className={ROW.CONSEQUENCE}>
                  {unread
                    ? t(`${K}.rows.shared.consequence_unread`)
                    : draft.enabled
                      ? t(`${K}.rows.mtu_value.consequence`, {
                          min: MTU_MIN,
                          max: MTU_MAX,
                        })
                      : t(`${K}.rows.mtu_value.consequence_off`)}
                </span>
              </div>
              <div className={ROW.CONTROL}>
                <Input
                  host="container"
                  id={mtuId}
                  type="number"
                  inputMode="numeric"
                  min={MTU_MIN}
                  max={MTU_MAX}
                  value={draft.mtu}
                  onChange={(event) => setField("mtu", event.target.value)}
                  disabled={valueHeld}
                  aria-invalid={mtuBad || undefined}
                  aria-describedby={mtuHintId}
                  placeholder="1500"
                  className={cn(FIELD, mtuBad && FIELD_INVALID)}
                />
              </div>
            </div>
          </div>
        </form>
      </CardContent>
      {/* Outside the form so `mt-auto` reaches the card edge; `form=` keeps Enter-to-submit. */}
      <CardFoot
        className={CARD_PAD}
        status={
          unread ? null : blockedKey !== null ? (
            <span className={FOOT_BLOCKED}>
              {t(blockedKey, { min: MTU_MIN, max: MTU_MAX })}
            </span>
          ) : null
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="action"
              onClick={handleDiscard}
              disabled={isSaving || !isDirty}
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
        }
      />
    </Card>
  );
}

export default MtuSettingsCard;
