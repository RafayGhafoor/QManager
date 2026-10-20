"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  RefreshCwIcon,
  ZapIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { HintIcon } from "@/components/ui/hint-icon";
import { Input } from "@/components/ui/input";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import type { UsePrometheusMetricsReturn } from "@/hooks/use-prometheus-metrics";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import type {
  MetricsFreshness,
  PrometheusStatusResponse,
} from "@/types/prometheus-metrics";

import { maskToken } from "./scrape-config";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CHIP_GLYPH,
  COARSE_TARGET,
  GROUP,
  ROW,
  TOKEN,
} from "./shapes";

const K = "prometheus";

const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

/** Only the keys the user changed; the rest read through from the device. */
type Draft = { enabled?: boolean; freshness?: MetricsFreshness };

interface PrometheusCardProps {
  data: PrometheusStatusResponse;
  /** Shared with the scrape config card: one reveal for the token everywhere. */
  revealed: boolean;
  onRevealedChange: (next: boolean) => void;
  hook: Pick<
    UsePrometheusMetricsReturn,
    "save" | "regenerateToken" | "isSaving" | "isRegenerating"
  >;
}

export function PrometheusCard({
  data,
  revealed,
  onRevealedChange,
  hook,
}: PrometheusCardProps) {
  const { t } = useTranslation("monitoring");
  const { saved, markSaved } = useSaveFlash();
  const [draft, setDraft] = useState<Draft>({});

  const settings = data.settings ?? {
    enabled: false,
    freshness: "adaptive" as const,
    token: "",
  };
  const enabled = draft.enabled ?? settings.enabled;
  const freshness = draft.freshness ?? settings.freshness;
  const dirty =
    enabled !== settings.enabled || freshness !== settings.freshness;

  // The token describes what is LIVE, not the draft (State-Honesty).
  const live = settings.enabled && settings.token.length > 0;
  const adaptiveOff = data.poller?.adaptive_enabled === false;
  const busy = hook.isSaving || hook.isRegenerating;

  const handleSave = async () => {
    const result = await hook.save(enabled, freshness);
    if (result.success) {
      setDraft({});
      markSaved();
      toast.success(t(`${K}.toast.saved`));
    } else {
      toast.error(result.message ?? t(`${K}.toast.save_failed`));
    }
  };

  const handleRegenerate = async () => {
    const result = await hook.regenerateToken();
    if (result.success) toast.success(t(`${K}.toast.regenerated`));
    else toast.error(result.message ?? t(`${K}.toast.regenerate_failed`));
  };

  const handleCopyToken = async () => {
    const ok = await copyText(settings.token);
    if (ok) toast.success(t(`${K}.toast.token_copied`));
    else toast.error(t(`${K}.toast.copy_failed`));
  };

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.card.title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`${K}.card.description`)}
        </CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <div className={GROUP.ROOT}>
          <div className={GROUP.COLUMN}>
            {/* Endpoint */}
            <div className={ROW.ROOT}>
              <div className={ROW.TEXT}>
                <span className={ROW.LABEL}>{t(`${K}.endpoint.label`)}</span>
                <span className={ROW.CONSEQUENCE}>
                  {t(
                    enabled
                      ? `${K}.endpoint.consequence_on`
                      : `${K}.endpoint.consequence_off`,
                  )}
                </span>
              </div>
              <div className={ROW.CONTROL}>
                <SegmentedField
                  value={enabled ? "on" : "off"}
                  onValueChange={(next) =>
                    setDraft((d) => ({ ...d, enabled: next === "on" }))
                  }
                  options={[
                    { value: "off", label: t("state.off", { ns: "common" }) },
                    { value: "on", label: t("state.on", { ns: "common" }) },
                  ]}
                  ariaLabel={t(`${K}.endpoint.label`)}
                  disabled={busy}
                  breakpoint="never"
                  glyph={renderCheckGlyph}
                />
              </div>
            </div>

            {/* Scrape freshness */}
            <div className={ROW.ROOT}>
              <div className={ROW.TEXT}>
                <span className={ROW.LABEL_LINE}>
                  <span className={ROW.LABEL}>
                    {t(`${K}.freshness.label`)}
                  </span>
                  <HintIcon label={t(`${K}.freshness.hint_label`)}>
                    {t(`${K}.freshness.hint`)}
                  </HintIcon>
                </span>
                <span className={ROW.CONSEQUENCE}>
                  {t(`${K}.freshness.consequence.${freshness}`)}
                </span>
                {adaptiveOff ? (
                  <span className={ROW.FACTS}>
                    <Badge variant="info">
                      <ZapIcon className={CHIP_GLYPH} aria-hidden="true" />
                      {t(`${K}.facts.adaptive_off`)}
                    </Badge>
                  </span>
                ) : null}
              </div>
              <div className={ROW.CONTROL}>
                <SegmentedField
                  value={freshness}
                  onValueChange={(next) =>
                    setDraft((d) => ({ ...d, freshness: next }))
                  }
                  options={[
                    {
                      value: "adaptive",
                      label: t(`${K}.freshness.options.adaptive`),
                    },
                    {
                      value: "balanced",
                      label: t(`${K}.freshness.options.balanced`),
                    },
                    {
                      value: "realtime",
                      label: t(`${K}.freshness.options.realtime`),
                    },
                  ]}
                  ariaLabel={t(`${K}.freshness.label`)}
                  disabled={busy}
                  glyph={renderCheckGlyph}
                />
              </div>
            </div>

            {/* Token */}
            {live ? (
              <div className={ROW.STACK_ROOT}>
                <div className={ROW.TEXT}>
                  <label htmlFor="prometheus-token" className={ROW.LABEL}>
                    {t(`${K}.token.label`)}
                  </label>
                  <span className={ROW.CONSEQUENCE}>
                    {t(`${K}.token.consequence`)}
                  </span>
                </div>
                <div className={TOKEN.LINE}>
                  <div className={TOKEN.FIELD_WRAP}>
                    <Input
                      id="prometheus-token"
                      host="container"
                      readOnly
                      spellCheck={false}
                      value={revealed ? settings.token : maskToken(settings.token)}
                      className={TOKEN.FIELD}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className={cn(TOKEN.TOGGLE, COARSE_TARGET)}
                      onClick={() => onRevealedChange(!revealed)}
                      aria-pressed={revealed}
                      aria-label={t(
                        revealed ? `${K}.token.hide` : `${K}.token.show`,
                      )}
                    >
                      {revealed ? (
                        <EyeOffIcon className={TOKEN.GLYPH} aria-hidden="true" />
                      ) : (
                        <EyeIcon className={TOKEN.GLYPH} aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                  <div className={TOKEN.ACTIONS}>
                    <Button
                      type="button"
                      variant="tonal-neutral"
                      onClick={handleCopyToken}
                    >
                      <CopyIcon className={TOKEN.GLYPH} aria-hidden="true" />
                      {t(`${K}.token.copy`)}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="tonal-neutral"
                          disabled={busy}
                        >
                          <RefreshCwIcon
                            className={TOKEN.GLYPH}
                            aria-hidden="true"
                          />
                          {t(`${K}.token.regenerate`)}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {t(`${K}.regenerate_dialog.title`)}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {t(`${K}.regenerate_dialog.description`)}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>
                            {t(`${K}.regenerate_dialog.cancel`)}
                          </AlertDialogCancel>
                          <AlertDialogAction onClick={handleRegenerate}>
                            {t(`${K}.regenerate_dialog.confirm`)}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <CardFoot
          status={
            dirty && enabled && !settings.token ? (
              <span>{t(`${K}.foot.token_on_save`)}</span>
            ) : null
          }
          actions={
            <>
              {dirty ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDraft({})}
                  disabled={busy}
                >
                  {t(`${K}.foot.discard`)}
                </Button>
              ) : null}
              <SaveButton
                isSaving={hook.isSaving}
                saved={saved}
                label={t(`${K}.foot.save`)}
                disabled={!dirty || busy}
                onClick={handleSave}
                size="action"
              />
            </>
          }
        />
      </CardContent>
    </Card>
  );
}
