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
import { Tag } from "@/components/ui/tag";
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
// TtlSettingsCard — the first of Band B's two peer write cards
// =============================================================================
// Three rows in one tonal group: the rewrite On/Off, then the two values it
// gates. The fetch, the SIM-profile check and Refresh live in the shell.
//
// The draft is derived, not synced: the card holds only the user's EDITS and
// overlays them on a baseline derived from the server values, so a Refresh
// re-bases the delta chips instead of erasing what was typed (and no
// setState-in-effect is needed).
//
// No silent no-op: Apply is disabled whenever the form cannot be applied and the
// foot status names the reason; Enter inside a field can still submit, so the
// handler refuses out loud with the same sentence as a toast.
// =============================================================================

const K = "ttl_mtu";

type OnOff = "on" | "off";

const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

/** The bounds `ttl.sh` enforces (0 there means "remove the rule"). */
const TTL_MIN = 1;
const TTL_MAX = 255;

/** What the TTL and hop-limit fields hold while the rewrite is off. */
const DEFAULT_HOPS = "64";

const ERR_VALUE_RANGE = `${K}.errors.value_range`;
const ERR_NO_VALUE = `${K}.errors.no_value`;

/** Narrower than `TtlSettingsData`: `autostart` is excluded on purpose. */
export interface TtlCardValue {
  isEnabled: boolean;
  /** 0 means "not rewritten", not "zero". */
  ttl: number;
  /** 0 means "not rewritten", not "zero". */
  hl: number;
}

interface TtlDraft {
  enabled: boolean;
  ttl: string;
  hl: string;
}

const EMPTY_DRAFT: TtlDraft = { enabled: false, ttl: "", hl: "" };

export interface TtlSettingsCardProps {
  /** The endpoint's reading; `null` until it answers. */
  value: TtlCardValue | null;
  isLoading: boolean;
  isSaving: boolean;
  /** True when the active SIM profile writes these two values. */
  isProfileControlled: boolean;
  onApply: (ttl: number, hl: number) => Promise<MutationResult>;
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

export function TtlSettingsCard({
  value,
  isLoading,
  isSaving,
  isProfileControlled,
  onApply,
}: TtlSettingsCardProps) {
  const { t } = useTranslation("local-network");
  const { saved, markSaved } = useSaveFlash();

  const formId = useId();
  const ttlId = useId();
  const hlId = useId();
  const ttlHintId = useId();
  const hlHintId = useId();
  const onOffOptions: SegmentedOption<OnOff>[] = [
    { value: "on", label: t(`${K}.values.on`) },
    { value: "off", label: t(`${K}.values.off`) },
  ];

  // ---------------------------------------------------------------------------
  // Baseline + edits -> draft
  // ---------------------------------------------------------------------------
  // Keyed off the primitives: the shell rebuilds the prop object every render.
  const serverEnabled = value?.isEnabled ?? null;
  const serverTtl = value?.ttl ?? null;
  const serverHl = value?.hl ?? null;

  const baseline = useMemo<TtlDraft | null>(
    () =>
      serverEnabled === null || serverTtl === null || serverHl === null
        ? null
        : {
            enabled: serverEnabled,
            // While the rewrite is off the fields show the usual 64 as a real
            // value, so switching it on starts from something sensible.
            ttl: serverTtl > 0 ? String(serverTtl) : serverEnabled ? "" : DEFAULT_HOPS,
            hl: serverHl > 0 ? String(serverHl) : serverEnabled ? "" : DEFAULT_HOPS,
          },
    [serverEnabled, serverTtl, serverHl],
  );

  const [edits, setEdits] = useState<Partial<TtlDraft>>({});
  const draft = useMemo<TtlDraft>(
    () => ({ ...(baseline ?? EMPTY_DRAFT), ...edits }),
    [baseline, edits],
  );

  const setField = useCallback(
    <F extends keyof TtlDraft>(field: F, next: TtlDraft[F]) =>
      setEdits((prev) => ({ ...prev, [field]: next })),
    [],
  );

  const enabledDirty = baseline !== null && draft.enabled !== baseline.enabled;
  const ttlDirty = baseline !== null && draft.ttl !== baseline.ttl;
  const hlDirty = baseline !== null && draft.hl !== baseline.hl;
  const isDirty = enabledDirty || ttlDirty || hlDirty;

  // ---------------------------------------------------------------------------
  // Validity
  // ---------------------------------------------------------------------------
  const parse = (text: string): number | null => {
    const trimmed = text.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) ? parsed : NaN;
  };

  const ttlParsed = parse(draft.ttl);
  const hlParsed = parse(draft.hl);
  const outOfRange = (parsed: number | null) =>
    parsed !== null &&
    (Number.isNaN(parsed) || parsed < TTL_MIN || parsed > TTL_MAX);

  const ttlBad = draft.enabled && outOfRange(ttlParsed);
  const hlBad = draft.enabled && outOfRange(hlParsed);
  const nothingEntered =
    draft.enabled && draft.ttl.trim() === "" && draft.hl.trim() === "";

  const blockedKey =
    ttlBad || hlBad ? ERR_VALUE_RANGE : nothingEntered ? ERR_NO_VALUE : null;

  const unread = baseline === null;
  const held = isProfileControlled || unread;
  const valuesHeld = held || !draft.enabled;
  const canApply = !held && isDirty && blockedKey === null;

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  // Discard drops the edits, so the fields fall back to whatever the device most
  // recently reported.
  const handleDiscard = useCallback(() => setEdits({}), []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      if (blockedKey !== null) {
        toast.error(t(blockedKey, { min: TTL_MIN, max: TTL_MAX }));
        return;
      }
      if (!canApply) return;

      const nextTtl = draft.enabled && ttlParsed !== null ? ttlParsed : 0;
      const nextHl = draft.enabled && hlParsed !== null ? hlParsed : 0;

      const result = await onApply(nextTtl, nextHl);
      if (!result.ok) {
        // null/null means the page unmounted mid-call: nobody to tell.
        if (result.code !== null || result.error !== null) {
          toast.error(
            resolveErrorMessage(
              t,
              result.code,
              result.error,
              t(`${K}.toast_ttl_error`),
            ),
          );
        }
        return;
      }

      // The hook re-read the device before resolving, so the baseline is fresh.
      setEdits({});
      markSaved();
      if (nextTtl > 0 || nextHl > 0) {
        toast.success(
          t(`${K}.toast_ttl_applied`, {
            ttl: nextTtl > 0 ? nextTtl : VALUE_NONE,
            hl: nextHl > 0 ? nextHl : VALUE_NONE,
          }),
        );
      } else {
        toast.success(t(`${K}.toast_ttl_cleared`));
      }
    },
    [blockedKey, canApply, draft.enabled, ttlParsed, hlParsed, onApply, markSaved, t],
  );

  const header = (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>{t(`${K}.cards.ttl.title`)}</CardTitle>
      <CardDescription>{t(`${K}.cards.ttl.description`)}</CardDescription>
    </CardHeader>
  );

  if (isLoading) {
    return (
      <Card className={CARD_SHELL}>
        {header}
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          <div className={ROW_GROUP}>
            {Array.from({ length: 3 }).map((_, index) => (
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

  /** A value row's consequence: unread beats off beats the real sentence. */
  const valueConsequence = (active: string) =>
    unread
      ? t(`${K}.rows.shared.consequence_unread`)
      : draft.enabled
        ? active
        : t(`${K}.rows.shared.consequence_off`);

  const onOff = (enabled: boolean) =>
    t(enabled ? `${K}.values.on` : `${K}.values.off`);

  return (
    <Card className={CARD_SHELL}>
      {header}
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <form id={formId} onSubmit={handleSubmit} className={CARD_BODY}>
          <div className={ROW_GROUP}>
            {/* Row 1 — the On/Off that gates the other two. */}
            <div className={ROW.ROOT}>
              <div className={cn(ROW.TEXT, held && ROW.HELD)}>
                <span className={ROW.LABEL_LINE}>
                  <span className={ROW.LABEL}>{t(`${K}.rows.rewrite.label`)}</span>
                  <DeltaChip
                    from={onOff(baseline?.enabled ?? false)}
                    to={onOff(draft.enabled)}
                  />
                </span>
                <span className={ROW.CONSEQUENCE}>
                  {unread
                    ? t(`${K}.rows.shared.consequence_unread`)
                    : t(`${K}.rows.rewrite.consequence`)}
                </span>
              </div>
              <div className={ROW.CONTROL}>
                <SegmentedField
                  value={draft.enabled ? "on" : "off"}
                  onValueChange={(next) => setField("enabled", next === "on")}
                  options={onOffOptions}
                  ariaLabel={t(`${K}.rows.rewrite.label`)}
                  disabled={held}
                  breakpoint="never"
                  glyph={renderCheckGlyph}
                />
              </div>
            </div>

            {/* Row 2 — TTL (IPv4). */}
            <div className={ROW.ROOT}>
              <div className={cn(ROW.TEXT, valuesHeld && ROW.HELD)}>
                <span className={ROW.LABEL_LINE}>
                  <label htmlFor={ttlId} className={ROW.LABEL}>
                    {t(`${K}.rows.ttl_value.label`)}
                  </label>
                  {/* The protocol family is metadata: a Tag, not a Badge. */}
                  <Tag variant="neutral">IPv4</Tag>
                  <DeltaChip
                    from={!baseline || baseline.ttl === "" ? VALUE_NONE : baseline.ttl}
                    to={draft.ttl === "" ? VALUE_NONE : draft.ttl}
                  />
                </span>
                <span id={ttlHintId} className={ROW.CONSEQUENCE}>
                  {valueConsequence(
                    t(`${K}.rows.ttl_value.consequence`, {
                      min: TTL_MIN,
                      max: TTL_MAX,
                    }),
                  )}
                </span>
              </div>
              <div className={ROW.CONTROL}>
                <Input
                  host="container"
                  id={ttlId}
                  type="number"
                  inputMode="numeric"
                  min={TTL_MIN}
                  max={TTL_MAX}
                  value={draft.ttl}
                  onChange={(event) => setField("ttl", event.target.value)}
                  disabled={valuesHeld}
                  aria-invalid={ttlBad || undefined}
                  aria-describedby={ttlHintId}
                  placeholder="64"
                  className={cn(FIELD, ttlBad && FIELD_INVALID)}
                />
              </div>
            </div>

            {/* Row 3 — hop limit (IPv6). */}
            <div className={ROW.ROOT}>
              <div className={cn(ROW.TEXT, valuesHeld && ROW.HELD)}>
                <span className={ROW.LABEL_LINE}>
                  <label htmlFor={hlId} className={ROW.LABEL}>
                    {t(`${K}.rows.hl_value.label`)}
                  </label>
                  <Tag variant="neutral">IPv6</Tag>
                  <DeltaChip
                    from={!baseline || baseline.hl === "" ? VALUE_NONE : baseline.hl}
                    to={draft.hl === "" ? VALUE_NONE : draft.hl}
                  />
                </span>
                <span id={hlHintId} className={ROW.CONSEQUENCE}>
                  {valueConsequence(t(`${K}.rows.hl_value.consequence`))}
                </span>
              </div>
              <div className={ROW.CONTROL}>
                <Input
                  host="container"
                  id={hlId}
                  type="number"
                  inputMode="numeric"
                  min={TTL_MIN}
                  max={TTL_MAX}
                  value={draft.hl}
                  onChange={(event) => setField("hl", event.target.value)}
                  disabled={valuesHeld}
                  aria-invalid={hlBad || undefined}
                  aria-describedby={hlHintId}
                  placeholder="64"
                  className={cn(FIELD, hlBad && FIELD_INVALID)}
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
          held ? null : blockedKey !== null ? (
            <span className={FOOT_BLOCKED}>
              {t(blockedKey, { min: TTL_MIN, max: TTL_MAX })}
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

export default TtlSettingsCard;
