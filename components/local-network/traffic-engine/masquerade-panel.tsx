"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/ui/field";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { HintIcon } from "@/components/ui/hint-icon";
import type { useTrafficMasquerade } from "@/hooks/use-traffic-masquerade";
import type { UseTtlSettingsReturn } from "@/hooks/use-ttl-settings";
import { validateDomainKey } from "@/lib/validate-domain";
import { EngineEnableRow } from "./engine-enable-row";
import { BypassHotspotRow } from "./bypass-hotspot-row";
import { EngineCheckRow } from "./engine-check-row";
import { ResultAlert } from "./result-alert";
import { DraftStatus } from "./draft-status";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  FIELD,
} from "./shapes";

/** Fallback disguise domain when none is configured. Shared so the panel's
 *  initial value and the composer's disable-fallback can't drift. */
export const DEFAULT_SNI_DOMAIN = "speedtest.net";

interface MasqueradePanelProps {
  hook: ReturnType<typeof useTrafficMasquerade>;
  /** Composer-owned global TTL/HL hook, for the Bypass Hotspot row. */
  ttl: UseTtlSettingsReturn;
  /** Whether Masquerade owns the engine. */
  running: boolean;
  /** Whether Video Optimizer owns the engine (enabling masquerade takes over). */
  otherOwns: boolean;
  modeLabel: string;
  otherModeLabel: string;
  canEnable: boolean;
  /** True while any engine toggle is in flight (covers the post-save poll gap). */
  transitioning: boolean;
  /** Enable handler; owns the idle-vs-takeover confirm decision. */
  onEnable: (sniDomain: string) => void;
  onDisable: () => void;
  /** Re-apply the draft to the running mode. Resolves true on success. */
  onApply: (sniDomain: string) => Promise<boolean>;
}

/**
 * Masquerade: the enable row, the Bypass Hotspot row, the disguise-domain
 * draft and an injection test. The test mirrors Video Optimizer's verify check
 * exactly so the two confidence surfaces stay in lockstep.
 */
export function MasqueradePanel({
  hook,
  ttl,
  running,
  otherOwns,
  modeLabel,
  otherModeLabel,
  canEnable,
  transitioning,
  onEnable,
  onDisable,
  onApply,
}: MasqueradePanelProps) {
  const { t } = useTranslation("local-network");
  const { settings, isSaving, testResult, runTest } = hook;
  const busy = isSaving || transitioning;
  const formId = useId();
  const errorId = useId();

  const savedDomain = settings?.sni_domain || DEFAULT_SNI_DOMAIN;
  const [sniDomain, setSniDomain] = useState(savedDomain);
  const { saved, markSaved } = useSaveFlash();

  const sniErrorKey = useMemo(() => validateDomainKey(sniDomain), [sniDomain]);
  const sniError = sniErrorKey ? t(sniErrorKey) : null;
  const isDirty = sniDomain !== savedDomain;

  const handleApply = useCallback(async () => {
    if (sniError || !running) return;
    if (await onApply(sniDomain)) markSaved();
  }, [sniError, running, sniDomain, onApply, markSaved]);

  const testing = testResult.status === "running";

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{modeLabel}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("traffic_engine.masquerade_tagline")}
        </CardDescription>
      </CardHeader>
      <CardContent className={`${CARD_PAD} ${CARD_BODY}`}>
        <EngineEnableRow
          modeLabel={modeLabel}
          running={running}
          canEnable={canEnable}
          busy={busy}
          otherOwns={otherOwns}
          otherModeLabel={otherModeLabel}
          onToggle={(next) =>
            next ? onEnable(sniError ? savedDomain : sniDomain) : onDisable()
          }
        />

        {/* Hotspot bypass: the global TTL/HL shortcut, shared with Video Optimizer */}
        <BypassHotspotRow ttl={ttl} />

        <form
          id={formId}
          className={FIELD.ROOT}
          onSubmit={(e) => {
            e.preventDefault();
            void handleApply();
          }}
        >
          <div className={FIELD.LABEL_ROW}>
            <label htmlFor="sni-domain" className={FIELD.LABEL}>
              {t("masquerade.label_domain")}
            </label>
            <HintIcon label={t("masquerade.aria_domain_info")}>
              {t("masquerade.help_domain")}
            </HintIcon>
          </div>
          <p className={FIELD.HELPER}>{t("masquerade.helper_domain")}</p>
          <Input
            id="sni-domain"
            type="text"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            value={sniDomain}
            onChange={(e) => setSniDomain(e.target.value)}
            disabled={busy}
            placeholder={t("masquerade.placeholder_domain")}
            className={FIELD.TEXT}
            aria-invalid={!!sniError}
            aria-describedby={sniError ? errorId : undefined}
          />
          {sniError ? <FieldError id={errorId}>{sniError}</FieldError> : null}
        </form>

        {/* Injection test: shared layout with Video Optimizer's verify check */}
        <EngineCheckRow
          title={t("masquerade.test_title")}
          description={t("masquerade.test_description")}
          hint={t("masquerade.test_hint")}
          hintAriaLabel={t("masquerade.aria_test_hint")}
          runLabel={t("masquerade.button_run_test")}
          busyLabel={t("masquerade.state_testing")}
          running={running}
          busy={testing}
          onRun={runTest}
        >
          {testResult.status === "complete" ? (
            <ResultAlert tone={testResult.injected ? "success" : "destructive"}>
              {testResult.message}
            </ResultAlert>
          ) : null}
          {testResult.status === "error" && testResult.error ? (
            <ResultAlert tone="destructive">{testResult.error}</ResultAlert>
          ) : null}
        </EngineCheckRow>
      </CardContent>

      {/* Outside the form so `mt-auto` reaches the card edge; `form=` keeps Enter-to-submit. */}
      <CardFoot
        className={CARD_PAD}
        status={<DraftStatus dirty={isDirty} running={running} />}
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="action"
              onClick={() => setSniDomain(savedDomain)}
              disabled={!isDirty || busy}
            >
              {t("common:actions.discard")}
            </Button>
            <SaveButton
              type="submit"
              form={formId}
              isSaving={isSaving}
              saved={saved}
              disabled={!running || !isDirty || !!sniError || busy}
              label={t("traffic_engine.tile_apply")}
              size="action"
            />
          </>
        }
      />
    </Card>
  );
}
