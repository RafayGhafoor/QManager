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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { Skeleton } from "@/components/ui/skeleton";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { CardFoot } from "@/components/ui/card-foot";
import { MaterialSymbol, type MaterialSymbolName } from "@/components/ui/material-symbol";
import { SegmentedField } from "@/components/ui/segmented-field";
import { ConditionScreen } from "@/components/cellular/condition-screen";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { SettingRow } from "../setting-row";
import {
  APN_VERDICT,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  FIELD_SHELL,
  INLINE_ERROR,
  READOUT_ROW,
  REVEAL,
  ROW_GROUP,
  SELECT_TRIGGER,
  SETTING_ROW,
} from "../shapes";

import type {
  ApnActionResult,
  ApnSetting,
  CidContext,
  ApnSaveRequest,
  DataCidSource,
} from "@/types/apn-settings";
import { PDP_TYPE_OPTIONS } from "@/types/apn-settings";

// =============================================================================
// APN Configuration — the write card
// =============================================================================
// Two blocks under the header, in the family's order: what is live, then what
// you can change, then the commit.
//
//   Readout   pill rows: the mode, the APN the network dialled, the data
//             context. The live verdict rides the APN row as glyph + ink.
//   Settings  one ROW_GROUP of SettingRows (label + consequence left, control
//             right), the same grammar as /cellular/settings.
//
// NO STATUS CHIP. The card used to open with a filled Badge ("Active" / "Not
// live" / "Carrier default") floating above the form with no edge under it. A
// chip there answered "is it live?" without saying what was live. The readout
// row states the fact (the APN), and its glyph states the verdict on that fact,
// so one line carries both. Defaults are quiet (Quiet-Default Rule); only a
// mismatch takes warning ink and earns its one-sentence note.
// =============================================================================

// Mirrors the backend allow-list (the value is spliced into an AT command).
const APN_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

const K = "core_settings.apn";
const F = `${K}.edit.fields`;
const R = `${K}.readout`;

/** No value to show. Punctuation, not copy. */
const EM_DASH = "—";

const renderCheckGlyph = (className: string) => (
  <MaterialSymbol name="check" size={16} className={className} />
);

// =============================================================================
// Props
// =============================================================================

export interface ApnSettingsCardProps {
  apn: ApnSetting | null;
  cids: CidContext[] | null;
  /** 1 = custom APN live, 0 = carrier default, null before first fetch. */
  active: number | null;
  /** The live data-bearing CID, or null before first fetch. */
  activeCid: number | null;
  /** How the data CID was identified; "none" = no bearer is up. */
  dataCidSource: DataCidSource | null;
  isLoading: boolean;
  isSaving: boolean;
  /** The first read failed and there is nothing to show (translated). */
  loadError: string | null;
  onRetry: () => void;
  onSave: (request: ApnSaveRequest) => Promise<ApnActionResult>;
  onDeactivate: () => Promise<ApnActionResult>;
}

// =============================================================================
// CID tag — what a context IS (IMS, SOS, Internet) is identity, so a neutral
// `Tag`. Carrier (IMS/SOS) takes precedence over Internet.
// =============================================================================

function CidTag({ ctx }: { ctx: CidContext }) {
  const { t } = useTranslation("cellular");

  if (ctx.apn_type === "ims") {
    return (
      <Tag variant="neutral">
        <MaterialSymbol name="call" size={12} />
        {t(`${F}.modem_profile.ims_badge`)}
      </Tag>
    );
  }
  if (ctx.apn_type === "emergency") {
    return (
      <Tag variant="neutral">
        <MaterialSymbol name="sos" size={12} />
        {t(`${F}.modem_profile.sos_badge`)}
      </Tag>
    );
  }
  if (ctx.is_internet) {
    return (
      <Tag variant="neutral">
        <MaterialSymbol name="public" size={12} />
        {t(`${F}.modem_profile.for_internet`)}
      </Tag>
    );
  }
  return null;
}

// =============================================================================
// The readout — what the modem is actually doing
// =============================================================================

type Verdict = "match" | "drift" | "unknown";

function ReadoutRow({
  label,
  value,
  glyph,
  glyphClass,
  mono = false,
  quiet = false,
  srVerdict,
}: {
  label: string;
  value: string;
  glyph?: MaterialSymbolName;
  glyphClass?: string;
  mono?: boolean;
  quiet?: boolean;
  /** The verdict in words, for assistive tech; the glyph is decorative. */
  srVerdict?: string;
}) {
  return (
    <div className={READOUT_ROW.ROOT}>
      <span className={READOUT_ROW.LABEL}>{label}</span>
      <span className={READOUT_ROW.VALUE_GROUP}>
        {glyph ? (
          <MaterialSymbol
            name={glyph}
            filled
            size={APN_VERDICT.GLYPH}
            className={cn("flex-none", glyphClass)}
          />
        ) : null}
        <span
          title={mono ? value : undefined}
          className={cn(
            mono ? READOUT_ROW.VALUE_MONO : READOUT_ROW.VALUE_TEXT,
            quiet && "text-on-surface-variant font-medium",
          )}
        >
          {value}
        </span>
        {srVerdict ? <span className="sr-only">{srVerdict}</span> : null}
      </span>
    </div>
  );
}

function ApnReadout({
  active,
  activeCid,
  dataCidSource,
  storedApn,
  cids,
  isSaving,
}: {
  active: number | null;
  activeCid: number | null;
  dataCidSource: DataCidSource | null;
  storedApn: string;
  cids: CidContext[] | null;
  isSaving: boolean;
}) {
  const { t } = useTranslation("cellular");

  const isCustom = active === 1;
  const connected = activeCid !== null && dataCidSource !== "none";
  const liveCtx = connected ? cids?.find((c) => c.cid === activeCid) : null;
  // An empty live APN ("") is the backend's "couldn't read it" sentinel, not a
  // confirmed value: the compound AT read fails transiently (notably during the
  // COPS settle window right after a save). `||`, not `??`, so "" collapses to
  // null and an unknown live APN renders a quiet dash rather than a false
  // mismatch. A genuinely different non-empty APN still produces one.
  const liveApn = liveCtx?.apn || null;

  // A verdict needs both halves, a custom APN to judge, and a settled link:
  // the save's own COPS cycle would otherwise flash a mismatch mid-apply.
  const verdict: Verdict =
    !isCustom || liveApn === null || isSaving
      ? "unknown"
      : storedApn.trim().toLowerCase() === liveApn.trim().toLowerCase()
        ? "match"
        : "drift";

  return (
    <div className="flex flex-col gap-2">
      <div className={READOUT_ROW.LIST}>
        <ReadoutRow
          label={t(`${R}.mode_label`)}
          value={isCustom ? t(`${R}.custom`) : t(`${K}.status.carrier_default`)}
          quiet={!isCustom}
        />
        <ReadoutRow
          label={t(`${K}.status.network_using_label`)}
          value={liveApn ?? EM_DASH}
          mono={liveApn !== null}
          quiet={liveApn === null}
          glyph={
            verdict === "match"
              ? "check_circle"
              : verdict === "drift"
                ? "warning"
                : undefined
          }
          glyphClass={verdict === "match" ? APN_VERDICT.MATCH : APN_VERDICT.DRIFT}
          srVerdict={
            verdict === "match"
              ? t(`${R}.matches`)
              : verdict === "drift"
                ? t(`${K}.status.not_live`)
                : undefined
          }
        />
        <ReadoutRow
          label={t(`${R}.context_label`)}
          value={
            connected
              ? t(`${F}.modem_profile.option_template`, { cid: activeCid })
              : t(`${R}.not_connected`)
          }
          glyph={connected ? undefined : "link_off"}
          glyphClass={APN_VERDICT.QUIET}
          quiet={!connected}
        />
      </div>

      {/* The one sentence a mismatch earns. It arrives through the 0fr -> 1fr
          row rather than blinking in, and the space it takes is the space a
          real problem deserves; the clean state keeps the card compact. */}
      <div
        className={cn(REVEAL.ROOT, verdict === "drift" ? REVEAL.OPEN : REVEAL.CLOSED)}
        aria-hidden={verdict !== "drift"}
      >
        <div className={REVEAL.CLIP}>
          <p className={cn(APN_VERDICT.NOTE, "pt-0.5")}>
            <MaterialSymbol
              name="warning"
              size={APN_VERDICT.GLYPH}
              className="mt-0.5 flex-none"
            />
            {t(`${R}.not_live_note`)}
          </p>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Header — identical in every state, so the title never swaps on load
// =============================================================================

function ApnCardHeader() {
  const { t } = useTranslation("cellular");
  return (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>{t(`${K}.card.title`)}</CardTitle>
      <CardDescription>{t(`${K}.card.description`)}</CardDescription>
    </CardHeader>
  );
}

// =============================================================================
// Loading skeleton — geometry imported from the same constants as the loaded
// card (The Skeleton-Mirror Rule).
// =============================================================================

function ApnSettingsCardSkeleton() {
  return (
    <Card className={CARD_SHELL}>
      <ApnCardHeader />
      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        <div className={READOUT_ROW.LIST}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className={READOUT_ROW.HEIGHT} />
          ))}
        </div>
        <div className={ROW_GROUP.ROOT}>
          {Array.from({ length: 3 }).map((_, i) => (
            <React.Fragment key={i}>
              {i > 0 ? <div className={ROW_GROUP.DIVIDER} /> : null}
              <Skeleton className={cn(SETTING_ROW.HEIGHT, "rounded-field")} />
            </React.Fragment>
          ))}
        </div>
      </CardContent>
      <CardFoot
        className={CARD_PAD}
        liveStatus={false}
        aria-hidden="true"
        status={<Skeleton className="h-4 w-48" />}
        actions={<Skeleton className="h-[2.625rem] w-40 rounded-pill" />}
      />
    </Card>
  );
}

// =============================================================================
// Component
// =============================================================================

export default function ApnSettingsCard({
  apn,
  cids,
  active,
  activeCid,
  dataCidSource,
  isLoading,
  isSaving,
  loadError,
  onRetry,
  onSave,
  onDeactivate,
}: ApnSettingsCardProps) {
  const { t } = useTranslation("cellular");
  const { saved, markSaved } = useSaveFlash();
  const formId = useId();
  const apnLabelId = useId();
  const pdpLabelId = useId();
  const cidLabelId = useId();

  // --- Form state (seeded from `apn`; reset when hook data arrives) ---
  const [apnValue, setApnValue] = useState(apn?.apn ?? "");
  const [pdpType, setPdpType] = useState(apn?.pdp_type ?? "ipv4v6");
  const [cid, setCid] = useState(String(apn?.cid ?? 1));

  // Seed the form when hook data arrives after the skeleton (render-phase
  // derived state; React Compiler forbids the setState-in-effect version).
  const [seeded, setSeeded] = useState(false);
  if (!seeded && apn !== null) {
    setSeeded(true);
    setApnValue(apn.apn);
    setPdpType(apn.pdp_type || "ipv4v6");
    // A slot that was never set has no meaningful CID of its own: start the
    // picker on the context that actually carries the data connection.
    const detected =
      !apn.apn && activeCid !== null && dataCidSource !== null && dataCidSource !== "none";
    setCid(String(detected ? activeCid : apn.cid));
  }

  // --- UI state ---
  const [apnError, setApnError] = useState("");
  // The user accepted the IMS/SOS warning for the CID currently in the picker.
  const [carrierConfirmed, setCarrierConfirmed] = useState(false);
  const [pendingCid, setPendingCid] = useState<CidContext | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const contexts = cids ?? [];

  if (isLoading) return <ApnSettingsCardSkeleton />;

  if (loadError) {
    return (
      <Card className={CARD_SHELL}>
        <ApnCardHeader />
        <CardContent className={cn(CARD_PAD, "flex flex-1 flex-col")}>
          <ConditionScreen
            tone="destructive"
            glyph="error"
            ariaRole="alert"
            title={t(`${K}.page.error_load_title`)}
            description={loadError}
            onRetry={onRetry}
            retryLabel={t("actions.retry", { ns: "common" })}
            className="flex-1 rounded-tile py-10"
          />
        </CardContent>
      </Card>
    );
  }

  // --- CID selection: intercept carrier contexts for confirmation ---
  const handleCidChange = (value: string) => {
    const ctx = contexts.find((c) => String(c.cid) === value);
    if (ctx && (ctx.apn_type === "ims" || ctx.apn_type === "emergency")) {
      setPendingCid(ctx);
      return;
    }
    setCarrierConfirmed(false);
    setCid(value);
  };

  const confirmCidChange = () => {
    if (pendingCid) {
      setCid(String(pendingCid.cid));
      setCarrierConfirmed(true);
    }
    setPendingCid(null);
  };

  // --- Validation ---
  const validateForm = (): boolean => {
    if (!apnValue.trim()) {
      setApnError(t(`${F}.apn.error_required`));
      return false;
    }
    if (!APN_PATTERN.test(apnValue.trim())) {
      setApnError(t(`${F}.apn.error_invalid`));
      return false;
    }
    setApnError("");
    return true;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    const request: ApnSaveRequest = {
      apn: apnValue.trim(),
      pdp_type: pdpType,
      cid: parseInt(cid, 10),
    };
    // Authorise a carrier (IMS/SOS) context only after the confirm dialog, or
    // when the stored setting already targets it (the user confirmed earlier).
    const target = contexts.find((c) => String(c.cid) === cid);
    const isCarrierTarget =
      target?.apn_type === "ims" || target?.apn_type === "emergency";
    if (isCarrierTarget && (carrierConfirmed || cid === String(apn?.cid))) {
      request.allow_carrier_cid = true;
    }

    const result = await onSave(request);
    if (result.ok) {
      markSaved();
      toast.success(t(`${K}.toast.saved`));
    } else {
      toast.error(result.error);
    }
  };

  const handleDeactivate = async () => {
    setConfirmDeactivate(false);
    const result = await onDeactivate();
    if (result.ok) {
      toast.success(t(`${K}.toast.deactivated`));
    } else {
      toast.error(result.error);
    }
  };

  const pendingType = pendingCid?.apn_type;

  const savedPdp = apn ? apn.pdp_type || "ipv4v6" : pdpType;
  const savedCid = apn ? String(apn.cid) : cid;
  const apnDirty = apn !== null && apnValue !== apn.apn;
  const pdpDirty = apn !== null && pdpType !== savedPdp;
  const cidDirty = apn !== null && cid !== savedCid;
  const isDirty = apnDirty || pdpDirty || cidDirty;

  const pdpLabel = (value: string) =>
    t(`${F}.pdp_type.options.${value}`, { defaultValue: value });
  const cidLabel = (value: string) =>
    t(`${F}.modem_profile.option_template`, { cid: value });

  const handleDiscard = () => {
    if (!apn) return;
    setApnValue(apn.apn);
    setPdpType(savedPdp);
    setCid(savedCid);
    setCarrierConfirmed(false);
    setApnError("");
  };

  const pdpOptions = PDP_TYPE_OPTIONS.map((opt) => ({
    value: opt.value as string,
    label: pdpLabel(opt.value),
  }));

  return (
    <Card className={CARD_SHELL}>
      <ApnCardHeader />
      <CardContent className={cn(CARD_PAD, "flex flex-col gap-4")}>
        <ApnReadout
          active={active}
          activeCid={activeCid}
          dataCidSource={dataCidSource}
          storedApn={apn?.apn ?? ""}
          cids={cids}
          isSaving={isSaving}
        />

        <form id={formId} onSubmit={handleSubmit} noValidate>
          {/* Declared initial AND animate: this group mounts when the read
              lands, after the page cascade has already run. */}
          <motion.div
            className={ROW_GROUP.ROOT}
            variants={staggerRows}
            initial="hidden"
            animate="visible"
          >
            <motion.div variants={staggerRowItem}>
              <SettingRow
                label={t(`${F}.apn.label`)}
                labelId={apnLabelId}
                consequence={t(`${F}.apn.consequence`)}
                dirty={apnDirty}
                control={
                  <div className="flex w-full flex-col gap-1.5 @2xl/card:w-60">
                    <Input
                      host="container"
                      className={cn(FIELD_SHELL, "@2xl/card:w-full")}
                      aria-labelledby={apnLabelId}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder={t(`${F}.apn.placeholder`)}
                      value={apnValue}
                      onChange={(e) => {
                        setApnValue(e.target.value);
                        if (apnError) setApnError("");
                      }}
                      disabled={isSaving}
                      maxLength={100}
                      required
                      aria-required="true"
                      aria-invalid={!!apnError}
                      aria-describedby={apnError ? `${apnLabelId}-err` : undefined}
                    />
                    {apnError ? (
                      <span
                        id={`${apnLabelId}-err`}
                        className={cn(INLINE_ERROR, "text-[0.78125rem] leading-snug")}
                      >
                        {apnError}
                      </span>
                    ) : null}
                  </div>
                }
              />
            </motion.div>

            <div className={ROW_GROUP.DIVIDER} />

            <motion.div variants={staggerRowItem}>
              <SettingRow
                label={t(`${F}.pdp_type.label`)}
                labelId={pdpLabelId}
                consequence={t(`${F}.pdp_type.consequence`)}
                dirty={pdpDirty}
                delta={`${pdpLabel(savedPdp)} → ${pdpLabel(pdpType)}`}
                control={
                  <SegmentedField
                    value={pdpType}
                    onValueChange={setPdpType}
                    options={pdpOptions}
                    ariaLabel={t(`${F}.pdp_type.aria`)}
                    disabled={isSaving}
                    breakpoint="never"
                    glyph={renderCheckGlyph}
                  />
                }
              />
            </motion.div>

            <div className={ROW_GROUP.DIVIDER} />

            <motion.div variants={staggerRowItem}>
              <SettingRow
                label={t(`${F}.modem_profile.label`)}
                labelId={cidLabelId}
                consequence={t(`${F}.modem_profile.consequence`)}
                dirty={cidDirty}
                delta={`${cidLabel(savedCid)} → ${cidLabel(cid)}`}
                control={
                  <Select value={cid} onValueChange={handleCidChange} disabled={isSaving}>
                    <SelectTrigger
                      host="container"
                      className={cn(SELECT_TRIGGER, "@2xl/card:min-w-44")}
                      aria-labelledby={cidLabelId}
                    >
                      <SelectValue placeholder={t(`${F}.modem_profile.placeholder`)} />
                    </SelectTrigger>
                    <SelectContent className="rounded-tile">
                      {(contexts.length > 0
                        ? contexts
                        : // Fallback when cids[] hasn't loaded: offer CID 1-6.
                          [1, 2, 3, 4, 5, 6].map((n) => ({ cid: n }) as CidContext)
                      ).map((ctx) => (
                        <SelectItem key={ctx.cid} value={String(ctx.cid)}>
                          <span className="flex items-center gap-2 tabular-nums">
                            {cidLabel(String(ctx.cid))}
                            {contexts.length > 0 ? <CidTag ctx={ctx} /> : null}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            </motion.div>
          </motion.div>
        </form>
      </CardContent>

      {/* Outside the form so `mt-auto` reaches the card edge; `form=` keeps
          Enter-to-submit. The consequence of saving holds the status edge until
          there is something unsaved to report instead. */}
      <CardFoot
        className={CARD_PAD}
        status={
          isDirty ? (
            <span className="font-medium text-on-surface">{t("common:state.unsaved")}</span>
          ) : (
            <span className="text-pretty">{t(`${K}.save_connection_notice`)}</span>
          )
        }
        actions={
          <>
            {active !== 0 && (
              <Button
                type="button"
                variant="tonal-neutral"
                size="action"
                onClick={() => setConfirmDeactivate(true)}
                disabled={isSaving}
              >
                {t(`${K}.carrier_default.button`)}
              </Button>
            )}
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
              label={t(`${K}.edit.save_button`)}
              size="action"
            />
          </>
        }
      />

      {/* Carrier-CID confirmation */}
      <AlertDialog
        open={pendingCid !== null}
        onOpenChange={(o) => !o && setPendingCid(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${K}.edit.cid_confirm.title`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingType === "ims"
                ? t(`${K}.edit.cid_confirm.description_ims`, { cid: pendingCid?.cid })
                : t(`${K}.edit.cid_confirm.description_sos`, { cid: pendingCid?.cid })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(`${K}.edit.cid_confirm.cancel`)}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmCidChange}>
              {t(`${K}.edit.cid_confirm.confirm`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Use carrier default confirmation */}
      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${K}.carrier_default.dialog.title`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${K}.carrier_default.dialog.description`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(`${K}.carrier_default.dialog.cancel`)}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivate}>
              {t(`${K}.carrier_default.dialog.confirm`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
