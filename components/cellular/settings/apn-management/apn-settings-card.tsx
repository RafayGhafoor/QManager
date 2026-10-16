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
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldError,
} from "@/components/ui/field";
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
import { Badge } from "@/components/ui/badge";
import { Tag } from "@/components/ui/tag";
import { Skeleton } from "@/components/ui/skeleton";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { CardFoot } from "@/components/ui/card-foot";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { ConditionScreen } from "@/components/cellular/condition-screen";

import type {
  ApnActionResult,
  ApnSetting,
  CidContext,
  ApnSaveRequest,
} from "@/types/apn-settings";
import { PDP_TYPE_OPTIONS } from "@/types/apn-settings";

// =============================================================================
// Props
// =============================================================================

export interface ApnSettingsCardProps {
  apn: ApnSetting | null;
  cids: CidContext[] | null;
  /** 1 = custom APN live, 0 = carrier default, null before first fetch. */
  active: number | null;
  /** The live WAN-bearing CID, or null before first fetch. */
  activeCid: number | null;
  isLoading: boolean;
  isSaving: boolean;
  /** The first read failed and there is nothing to show (translated). */
  loadError: string | null;
  onRetry: () => void;
  onSave: (request: ApnSaveRequest) => Promise<ApnActionResult>;
  onDeactivate: () => Promise<ApnActionResult>;
}

// =============================================================================
// CID tag — one per modem context in the picker. What a context IS (IMS, SOS,
// Internet) is identity, so it is a neutral `Tag`. Carrier (IMS/SOS) takes
// precedence over Internet.
// =============================================================================

function CidBadge({ ctx }: { ctx: CidContext }) {
  const { t } = useTranslation("cellular");

  if (ctx.apn_type === "ims") {
    return (
      <Tag variant="neutral">
        <MaterialSymbol name="call" size={12} />
        {t("core_settings.apn.edit.fields.modem_profile.ims_badge")}
      </Tag>
    );
  }
  if (ctx.apn_type === "emergency") {
    return (
      <Tag variant="neutral">
        <MaterialSymbol name="sos" size={12} />
        {t("core_settings.apn.edit.fields.modem_profile.sos_badge")}
      </Tag>
    );
  }
  if (ctx.is_internet) {
    return (
      <Tag variant="neutral">
        <MaterialSymbol name="public" size={12} />
        {t("core_settings.apn.edit.fields.modem_profile.for_internet")}
      </Tag>
    );
  }
  return null;
}

// =============================================================================
// Live-status badge — reflects honest APN/active truth.
// =============================================================================

function LiveStatusBadge({
  active,
  activeCid,
  storedApn,
  cids,
  isSaving,
}: {
  active: number | null;
  activeCid: number | null;
  storedApn: string;
  cids: CidContext[] | null;
  isSaving: boolean;
}) {
  const { t } = useTranslation("cellular");

  if (active === null || cids === null) return null;

  if (active === 0) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="muted">
          <MaterialSymbol name="do_not_disturb_on" size={12} />
          {t("core_settings.apn.status.carrier_default")}
        </Badge>
      </div>
    );
  }

  // active === 1 — check if stored APN matches live CID's APN
  const liveCtx = activeCid !== null ? cids.find((c) => c.cid === activeCid) : null;
  // An empty live APN ("") is the backend's "couldn't read it" sentinel, not a
  // confirmed value — the compound AT read fails transiently (notably during the
  // COPS settle window right after a save). Collapse "" to null with `||` (NOT
  // `??`, which preserves "") so an unknown live APN falls through to "Active"
  // instead of a false "Not live". A genuinely different non-empty APN (a real
  // carrier override) still produces a mismatch.
  const liveApn = liveCtx?.apn || null;

  const isMatch =
    liveApn !== null &&
    storedApn.trim().toLowerCase() === liveApn.trim().toLowerCase();

  // Suppress "Not live" badge while saving to avoid flicker during COPS cycle
  if (!isSaving && liveApn !== null && !isMatch) {
    return (
      <div className="flex flex-col gap-1">
        <Badge variant="warning" className="w-fit">
          <MaterialSymbol name="warning" size={12} />
          {t("core_settings.apn.status.not_live")}
        </Badge>
        <p className="text-xs text-muted-foreground">
          {t("core_settings.apn.status.network_using_label")}{" "}
          <span className="font-mono text-on-surface">{liveApn}</span>
        </p>
      </div>
    );
  }

  return (
    <Badge variant="success">
      <MaterialSymbol name="check_circle" size={12} />
      {t("core_settings.apn.status.active")}
    </Badge>
  );
}

// =============================================================================
// Loading Skeleton
// =============================================================================

function ApnSettingsCardSkeleton() {
  const { t } = useTranslation("cellular");
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("core_settings.apn.card.title")}</CardTitle>
        <CardDescription>{t("core_settings.apn.card.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <Skeleton className="h-6 w-24 rounded-full" />
          <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-9 w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-9 w-full" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      </CardContent>
      <CardFoot
        className="px-6"
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

  // --- Form state (seeded from `apn`; reset when hook data arrives) ---
  const [apnValue, setApnValue] = useState(apn?.apn ?? "");
  const [pdpType, setPdpType] = useState(apn?.pdp_type ?? "ipv4v6");
  const [cid, setCid] = useState(String(apn?.cid ?? 1));

  // Sync form when hook data arrives after initial skeleton
  // Safe: React Compiler only disallows setState-in-effect when reading
  // derived state from the SAME render; this reads hook props.
  const [seeded, setSeeded] = useState(false);
  if (!seeded && apn !== null) {
    setSeeded(true);
    setApnValue(apn.apn);
    setPdpType(apn.pdp_type || "ipv4v6");
    setCid(String(apn.cid));
  }

  // --- UI state ---
  const [apnError, setApnError] = useState("");
  const [pendingCid, setPendingCid] = useState<CidContext | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const contexts = cids ?? [];

  if (isLoading) return <ApnSettingsCardSkeleton />;

  if (loadError) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{t("core_settings.apn.card.title")}</CardTitle>
          <CardDescription>{t("core_settings.apn.card.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ConditionScreen
            tone="destructive"
            glyph="error"
            ariaRole="alert"
            title={t("core_settings.apn.page.error_load_title")}
            description={loadError}
            onRetry={onRetry}
            retryLabel={t("actions.retry", { ns: "common" })}
            className="rounded-tile py-10"
          />
        </CardContent>
      </Card>
    );
  }

  // --- CID selection — intercept carrier contexts for confirmation ---
  const handleCidChange = (value: string) => {
    const ctx = contexts.find((c) => String(c.cid) === value);
    if (ctx && (ctx.apn_type === "ims" || ctx.apn_type === "emergency")) {
      setPendingCid(ctx);
      return;
    }
    setCid(value);
  };

  const confirmCidChange = () => {
    if (pendingCid) setCid(String(pendingCid.cid));
    setPendingCid(null);
  };

  // --- Validation ---
  const validateForm = (): boolean => {
    if (!apnValue.trim()) {
      setApnError(t("core_settings.apn.edit.fields.apn.error_required"));
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

    const result = await onSave(request);
    if (result.ok) {
      markSaved();
      toast.success(t("core_settings.apn.toast.saved"));
    } else {
      toast.error(result.error);
    }
  };

  const handleDeactivate = async () => {
    setConfirmDeactivate(false);
    const result = await onDeactivate();
    if (result.ok) {
      toast.success(t("core_settings.apn.toast.deactivated"));
    } else {
      toast.error(result.error);
    }
  };

  const pendingType = pendingCid?.apn_type;

  const isDirty =
    apn !== null &&
    (apnValue !== apn.apn ||
      pdpType !== (apn.pdp_type || "ipv4v6") ||
      cid !== String(apn.cid));

  const handleDiscard = () => {
    if (!apn) return;
    setApnValue(apn.apn);
    setPdpType(apn.pdp_type || "ipv4v6");
    setCid(String(apn.cid));
    setApnError("");
  };

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("core_settings.apn.card.title")}</CardTitle>
        <CardDescription>{t("core_settings.apn.card.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form id={formId} className="grid gap-4" onSubmit={handleSubmit}>
          {/* Live-status badge row */}
          <LiveStatusBadge
            active={active}
            activeCid={activeCid}
            storedApn={apnValue}
            cids={cids}
            isSaving={isSaving}
          />

          <FieldSet>
            <FieldGroup>
              {/* APN field */}
              <Field data-invalid={apnError ? true : undefined}>
                <FieldLabel htmlFor="apn-input">
                  {t("core_settings.apn.edit.fields.apn.label")}
                </FieldLabel>
                <Input
                  id="apn-input"
                  className="font-mono"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={t("core_settings.apn.edit.fields.apn.placeholder")}
                  value={apnValue}
                  onChange={(e) => {
                    setApnValue(e.target.value);
                    if (apnError) setApnError("");
                  }}
                  disabled={isSaving}
                  required
                  aria-required="true"
                  aria-invalid={!!apnError}
                />
                {apnError && <FieldError>{apnError}</FieldError>}
              </Field>

              {/* PDP Type + CID row */}
              <div className="grid @md/card:grid-cols-2 grid-cols-1 gap-4">
                <Field>
                  <FieldLabel htmlFor="apn-pdp-type">
                    {t("core_settings.apn.edit.fields.pdp_type.label")}
                  </FieldLabel>
                  <Select value={pdpType} onValueChange={setPdpType} disabled={isSaving}>
                    <SelectTrigger
                      id="apn-pdp-type"
                      aria-label={t("core_settings.apn.edit.fields.pdp_type.aria")}
                    >
                      <SelectValue
                        placeholder={t("core_settings.apn.edit.fields.pdp_type.placeholder")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {PDP_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {t(
                            `core_settings.apn.edit.fields.pdp_type.options.${opt.value}`
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="apn-cid">
                    {t("core_settings.apn.edit.fields.modem_profile.label")}
                  </FieldLabel>
                  <Select value={cid} onValueChange={handleCidChange} disabled={isSaving}>
                    <SelectTrigger
                      id="apn-cid"
                      aria-label={t("core_settings.apn.edit.fields.modem_profile.aria")}
                    >
                      <SelectValue
                        placeholder={t(
                          "core_settings.apn.edit.fields.modem_profile.placeholder"
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {contexts.length > 0 ? (
                        contexts.map((ctx) => (
                          <SelectItem key={ctx.cid} value={String(ctx.cid)}>
                            <span className="flex items-center gap-2 tabular-nums">
                              {t(
                                "core_settings.apn.edit.fields.modem_profile.option_template",
                                { cid: ctx.cid }
                              )}
                              <CidBadge ctx={ctx} />
                            </span>
                          </SelectItem>
                        ))
                      ) : (
                        // Fallback when cids[] hasn't loaded yet — offer CID 1–6
                        [1, 2, 3, 4, 5, 6].map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {t(
                              "core_settings.apn.edit.fields.modem_profile.option_template",
                              { cid: n }
                            )}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </FieldGroup>
          </FieldSet>

        </form>
      </CardContent>
      {/* Outside the form so `mt-auto` reaches the card edge; `form=` keeps Enter-to-submit. */}
      <CardFoot
        className="px-6"
        status={
          isDirty ? (
            <span className="font-medium">{t("common:state.unsaved")}</span>
          ) : (
            t("core_settings.apn.save_connection_notice")
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
                {t("core_settings.apn.carrier_default.button")}
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
              label={t("core_settings.apn.edit.save_button")}
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
            <AlertDialogTitle>
              {t("core_settings.apn.edit.cid_confirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingType === "ims"
                ? t("core_settings.apn.edit.cid_confirm.description_ims", {
                    cid: pendingCid?.cid,
                  })
                : t("core_settings.apn.edit.cid_confirm.description_sos", {
                    cid: pendingCid?.cid,
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("core_settings.apn.edit.cid_confirm.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmCidChange}>
              {t("core_settings.apn.edit.cid_confirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Use carrier default confirmation */}
      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("core_settings.apn.carrier_default.dialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("core_settings.apn.carrier_default.dialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("core_settings.apn.carrier_default.dialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivate}>
              {t("core_settings.apn.carrier_default.dialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
