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
import type { useVideoOptimizer } from "@/hooks/use-video-optimizer";
import type { UseTtlSettingsReturn } from "@/hooks/use-ttl-settings";
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

interface VideoOptimizerPanelProps {
  hook: ReturnType<typeof useVideoOptimizer>;
  /** Composer-owned global TTL/HL hook, for the Bypass Hotspot row. */
  ttl: UseTtlSettingsReturn;
  /** Whether Video Optimizer owns the engine. */
  running: boolean;
  /** Whether Masquerade owns the engine (enabling video takes over). */
  otherOwns: boolean;
  modeLabel: string;
  otherModeLabel: string;
  canEnable: boolean;
  /** True while any engine toggle is in flight (covers the post-save poll gap). */
  transitioning: boolean;
  /** Enable handler; owns the idle-vs-takeover confirm decision. */
  onEnable: (desyncRepeats: number) => void;
  onDisable: () => void;
  /** Re-apply the draft to the running mode. Resolves true on success. */
  onApply: (desyncRepeats: number) => Promise<boolean>;
}

const parseRepeats = (text: string): number | null => {
  if (!/^\d+$/.test(text)) return null;
  const n = parseInt(text, 10);
  return n >= 1 && n <= 10 ? n : null;
};

/**
 * Video Optimizer: the enable row, the Bypass Hotspot row, the desync-strength
 * draft and a verify check in one card, committing its draft from the foot.
 * The CDN domain list is a sibling card mounted by the composer.
 */
export function VideoOptimizerPanel({
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
}: VideoOptimizerPanelProps) {
  const { t } = useTranslation("local-network");
  const { settings, isSaving, verifyResult, runVerification } = hook;
  const busy = isSaving || transitioning;
  const formId = useId();
  const errorId = useId();

  const savedRepeats = settings?.desync_repeats ?? 1;
  const [repeatsText, setRepeatsText] = useState<string>(String(savedRepeats));
  const { saved, markSaved } = useSaveFlash();

  const repeats = useMemo(() => parseRepeats(repeatsText), [repeatsText]);
  const isDirty = repeats !== savedRepeats;

  const handleApply = useCallback(async () => {
    if (repeats === null || !running) return;
    if (await onApply(repeats)) markSaved();
  }, [repeats, running, onApply, markSaved]);

  const verifying = verifyResult.status === "running";

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{modeLabel}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("traffic_engine.video_tagline")}
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
          onToggle={(next) => (next ? onEnable(repeats ?? 1) : onDisable())}
        />

        {/* Hotspot bypass: the global TTL/HL shortcut, shared with Masquerade */}
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
            <label htmlFor="dpi-desync-repeats" className={FIELD.LABEL}>
              {t("video_optimizer.label_desync_repeats")}
            </label>
            <HintIcon label={t("video_optimizer.aria_desync_repeats_info")}>
              {t("video_optimizer.help_desync_repeats")}
            </HintIcon>
          </div>
          <p className={FIELD.HELPER}>
            {t("video_optimizer.helper_desync_repeats")}
          </p>
          <Input
            id="dpi-desync-repeats"
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            step={1}
            value={repeatsText}
            onChange={(e) => setRepeatsText(e.target.value)}
            disabled={busy}
            aria-invalid={repeats === null}
            aria-describedby={repeats === null ? errorId : undefined}
            className={FIELD.NUMBER}
          />
          {repeats === null ? (
            <FieldError id={errorId}>
              {t("invalid_repeats", { ns: "errors" })}
            </FieldError>
          ) : null}
        </form>

        {/* Verify check: shared layout with Masquerade's injection test */}
        <EngineCheckRow
          title={t("video_optimizer.verify_title")}
          description={t("video_optimizer.verify_description")}
          hint={t("video_optimizer.verify_hint")}
          hintAriaLabel={t("video_optimizer.aria_verify_hint")}
          runLabel={t("video_optimizer.button_verify_service")}
          busyLabel={t("video_optimizer.state_verifying")}
          running={running}
          busy={verifying}
          onRun={runVerification}
        >
          {verifyResult.status === "complete" && verifyResult.passed === true ? (
            <ResultAlert tone="success">{verifyResult.message}</ResultAlert>
          ) : null}
          {verifyResult.status === "complete" && verifyResult.passed === false ? (
            <ResultAlert tone="warning">{verifyResult.message}</ResultAlert>
          ) : null}
          {verifyResult.status === "error" && verifyResult.error ? (
            <ResultAlert tone="destructive">{verifyResult.error}</ResultAlert>
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
              onClick={() => setRepeatsText(String(savedRepeats))}
              disabled={!isDirty || busy}
            >
              {t("common:actions.discard")}
            </Button>
            <SaveButton
              type="submit"
              form={formId}
              isSaving={isSaving}
              saved={saved}
              disabled={!running || !isDirty || repeats === null || busy}
              label={t("traffic_engine.tile_apply")}
              size="action"
            />
          </>
        }
      />
    </Card>
  );
}
