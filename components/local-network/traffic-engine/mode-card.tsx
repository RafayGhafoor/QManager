"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2Icon,
  InfoIcon,
  MinusIcon,
  PlusIcon,
  ShieldCheckIcon,
  SyringeIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { FieldError } from "@/components/ui/field";
import { HintIcon } from "@/components/ui/hint-icon";
import { Input } from "@/components/ui/input";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import type { useTrafficMasquerade } from "@/hooks/use-traffic-masquerade";
import type { useVideoOptimizer } from "@/hooks/use-video-optimizer";
import { cn } from "@/lib/utils";
import { BackButton, ViewBody, ViewHeader } from "./card-view";
import { CheckRow } from "./check-row";
import { HandshakeStrip } from "./handshake-strip";
import { HostnamesMenu, HostnamesView, useHostlistDraft, type Hostlist } from "./hostnames-view";
import { DrillRow, MetricRow } from "./metric-row";
import type { EngineMode } from "./engine-card";
import {
  CARD_BODY,
  CARD_PAD,
  CARD_SHELL,
  FIELD,
  ROWS,
  STEPPER,
} from "./shapes";

export const STRENGTH_MIN = 1;
export const STRENGTH_MAX = 10;

/** The highlight a `?mode=` deep link puts on its card for a moment. */
const HIGHLIGHT =
  "ring-2 ring-primary ring-offset-4 ring-offset-background transition-shadow duration-[var(--duration-standard)] ease-standard";

/** The DOM id a `?mode=` deep link scrolls to. */
export const modeCardId = (mode: EngineMode) => `traffic-engine-${mode}`;

/** What every mode card knows about the engine. */
interface EngineState {
  /** This mode owns the engine and nothing is in flight. */
  active: boolean;
  /** This mode owns the engine (an apply's restart included). */
  owner: boolean;
  /** The other mode owns the engine. */
  otherOwns: boolean;
  /** An engine change is in flight. */
  busy: boolean;
  /** The other mode's name, for the blocked-apply reason. */
  otherLabel: string;
  highlighted: boolean;
}

interface FootProps extends EngineState {
  modeLabel: string;
  dirty: boolean;
  invalid: boolean;
  isSaving: boolean;
  onDiscard: () => void;
  onApply: () => Promise<boolean>;
}

/** The mode card's foot: the pending change and its consequence left, Discard and Apply right. */
function ModeFoot({
  modeLabel,
  dirty,
  invalid,
  owner,
  otherOwns,
  busy,
  otherLabel,
  isSaving,
  onDiscard,
  onApply,
}: FootProps) {
  const { t } = useTranslation("local-network");
  const { saved, markSaved } = useSaveFlash();

  // D: a clean draft leaves the status slot empty, and a dirty one names only
  // the consequence of applying, never the pending change (Card-Foot Apply Rule).
  let status: ReactNode = null;
  if (dirty && invalid) {
    status = t("traffic_engine.foot_invalid");
  } else if (dirty) {
    status = owner
      ? t("traffic_engine.foot_restart")
      : otherOwns
        ? t("traffic_engine.foot_switch_to_apply", { mode: modeLabel })
        : t("traffic_engine.foot_on_enable", { mode: modeLabel });
  }

  return (
    <CardFoot
      status={status}
      actions={
        <>
          <Button type="button" variant="ghost" onClick={onDiscard} disabled={!dirty || isSaving}>
            {t("actions.discard", { ns: "common" })}
          </Button>
          <SaveButton
            type="button"
            isSaving={isSaving}
            saved={saved}
            disabled={!dirty || invalid || busy}
            blockedReason={
              dirty && otherOwns ? t("traffic_engine.apply_blocked_other", { mode: otherLabel }) : null
            }
            onClick={async () => {
              if (await onApply()) markSaved();
            }}
            label={t("actions.apply", { ns: "common" })}
            savingLabel={t("traffic_engine.applying")}
          />
        </>
      }
    />
  );
}

type CheckState = {
  busy: boolean;
  /** "pass" | "fail" | "error", or null before a run. */
  outcome: "pass" | "fail" | "error" | null;
  message?: string;
};

function CheckResult({ outcome, message }: Pick<CheckState, "outcome" | "message">) {
  const { t } = useTranslation("local-network");
  if (!outcome) return null;
  const badge =
    outcome === "pass" ? (
      <Badge variant="success">
        <CheckCircle2Icon className="size-3" aria-hidden="true" />
        {t("traffic_engine.check_passed")}
      </Badge>
    ) : outcome === "fail" ? (
      <Badge variant="warning">
        <TriangleAlertIcon className="size-3" aria-hidden="true" />
        {t("traffic_engine.check_not_detected")}
      </Badge>
    ) : (
      <Badge variant="destructive">
        <XCircleIcon className="size-3" aria-hidden="true" />
        {t("traffic_engine.check_failed")}
      </Badge>
    );
  return (
    <>
      {badge}
      {message ? <span>{message}</span> : null}
    </>
  );
}

// -----------------------------------------------------------------------------
// Video Optimizer
// -----------------------------------------------------------------------------

interface VideoOptimizerCardProps extends EngineState {
  vo: ReturnType<typeof useVideoOptimizer>;
  hostlist: Hostlist;
  /** Masquerade owns the engine, so the hostname list is idle. */
  masqueradeOwns: boolean;
  savedStrength: number;
  draftStrength: number;
  onDraftChange: (next: number) => void;
  onApply: () => Promise<boolean>;
}

export function VideoOptimizerCard({
  vo,
  hostlist,
  masqueradeOwns,
  savedStrength,
  draftStrength,
  onDraftChange,
  onApply,
  ...engine
}: VideoOptimizerCardProps) {
  const { t } = useTranslation("local-network");
  const [view, setView] = useState<"main" | "hosts">("main");
  const [direction, setDirection] = useState<1 | -1>(1);
  const draft = useHostlistDraft(hostlist);
  const strengthId = useId();
  const isHosts = view === "hosts";
  const modeLabel = t("traffic_engine.mode_video");
  const dirty = draftStrength !== savedStrength;

  const open = (next: "main" | "hosts") => {
    setDirection(next === "hosts" ? 1 : -1);
    setView(next);
  };

  const { verifyResult } = vo;
  const check: CheckState = {
    busy: verifyResult.status === "running",
    outcome: !engine.active
      ? null
      : verifyResult.status === "error"
        ? "error"
        : verifyResult.status === "complete"
          ? verifyResult.passed
            ? "pass"
            : "fail"
          : null,
    message: verifyResult.status === "error" ? verifyResult.error : verifyResult.message,
  };

  const count = hostlist.domains.length;
  const actsOn = hostlist.isLoading
    ? t("traffic_engine.stat_empty")
    : t("traffic_engine.acts_on_domains", { count });

  return (
    <Card id={modeCardId("video")} className={cn(CARD_SHELL, engine.highlighted && HIGHLIGHT)}>
      <ViewHeader
        viewKey={view}
        padClassName={CARD_PAD}
        title={isHosts ? t("traffic_engine.hosts_title") : modeLabel}
        description={isHosts ? t("traffic_engine.hosts_desc") : t("traffic_engine.video_tagline")}
        action={
          isHosts ? (
            <>
              {masqueradeOwns ? (
                <Badge variant="info">
                  <InfoIcon className="size-3" aria-hidden="true" />
                  {t("traffic_engine.hosts_not_used")}
                </Badge>
              ) : null}
              <HostnamesMenu draft={draft} />
              <BackButton onBack={() => open("main")} />
            </>
          ) : undefined
        }
      />

      {isHosts ? (
        <ViewBody viewKey="hosts" direction={direction} className={cn(CARD_PAD, CARD_BODY)}>
          <HostnamesView hostlist={hostlist} draft={draft} />
        </ViewBody>
      ) : (
        <ViewBody viewKey="main" direction={direction} className={CARD_PAD}>
          <div className={CARD_BODY}>
            <HandshakeStrip
              mode="video"
              active={engine.active}
              strength={draftStrength}
              domain=""
              preview={dirty}
              hint={
                <HintIcon label={t("traffic_engine.aria_video_how")}>
                  {t("traffic_engine.video_how")}
                </HintIcon>
              }
            />
            <div className={ROWS}>
              <MetricRow
                label={t("traffic_engine.metric_carrier_reads")}
                value={t("traffic_engine.carrier_reads_none")}
                quiet={!engine.active}
              />
              <DrillRow
                label={t("traffic_engine.metric_acts_on")}
                ariaLabel={t("traffic_engine.aria_edit_hostnames")}
                value={actsOn}
                quiet={!engine.active}
                onOpen={() => open("hosts")}
              />
            </div>
            <div className={FIELD.ROW}>
              <div className={FIELD.TEXT}>
                <div className={FIELD.LABEL_ROW}>
                  <span id={strengthId} className={FIELD.LABEL}>
                    {t("video_optimizer.label_desync_repeats")}
                  </span>
                  <HintIcon label={t("video_optimizer.aria_desync_repeats_info")}>
                    {t("video_optimizer.help_desync_repeats")}
                  </HintIcon>
                </div>
                <p className={FIELD.HINT}>{t("video_optimizer.helper_desync_repeats")}</p>
              </div>
              <div role="group" aria-labelledby={strengthId} className={STEPPER.ROOT}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={STEPPER.BUTTON}
                  aria-label={t("traffic_engine.aria_strength_lower")}
                  disabled={draftStrength <= STRENGTH_MIN || vo.isSaving}
                  onClick={() => onDraftChange(draftStrength - 1)}
                >
                  <MinusIcon aria-hidden="true" />
                </Button>
                <span className={STEPPER.VALUE} aria-live="polite">
                  {draftStrength}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={STEPPER.BUTTON}
                  aria-label={t("traffic_engine.aria_strength_raise")}
                  disabled={draftStrength >= STRENGTH_MAX || vo.isSaving}
                  onClick={() => onDraftChange(draftStrength + 1)}
                >
                  <PlusIcon aria-hidden="true" />
                </Button>
              </div>
            </div>
            <CheckRow
              title={t("video_optimizer.verify_title")}
              description={t("video_optimizer.verify_description")}
              blockedReason={
                engine.active ? undefined : t("traffic_engine.check_blocked", { mode: modeLabel })
              }
              runLabel={t("video_optimizer.button_verify_service")}
              busyLabel={t("video_optimizer.state_verifying")}
              icon={ShieldCheckIcon}
              busy={check.busy}
              onRun={() => void vo.runVerification()}
              result={
                check.outcome ? <CheckResult outcome={check.outcome} message={check.message} /> : undefined
              }
            />
          </div>
          <ModeFoot
            {...engine}
            modeLabel={modeLabel}
            dirty={dirty}
            invalid={false}
            isSaving={vo.isSaving}
            onDiscard={() => onDraftChange(savedStrength)}
            onApply={onApply}
          />
        </ViewBody>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Masquerade
// -----------------------------------------------------------------------------

interface MasqueradeCardProps extends EngineState {
  masq: ReturnType<typeof useTrafficMasquerade>;
  savedDomain: string;
  draftDomain: string;
  /** The translated validation error for the draft, or null when it is valid. */
  draftError: string | null;
  onDraftChange: (next: string) => void;
  onApply: () => Promise<boolean>;
}

export function MasqueradeCard({
  masq,
  savedDomain,
  draftDomain,
  draftError,
  onDraftChange,
  onApply,
  ...engine
}: MasqueradeCardProps) {
  const { t } = useTranslation("local-network");
  const inputId = useId();
  const errorId = useId();
  const modeLabel = t("traffic_engine.mode_masquerade");
  const trimmed = draftDomain.trim();
  const dirty = trimmed !== savedDomain;
  const shown = draftError ? savedDomain : trimmed;

  const { testResult } = masq;
  const check: CheckState = {
    busy: testResult.status === "running",
    outcome: !engine.active
      ? null
      : testResult.status === "error"
        ? "error"
        : testResult.status === "complete"
          ? testResult.injected
            ? "pass"
            : "fail"
          : null,
    // The pass line is built here so it is translated and carries no stray dash.
    message:
      testResult.status === "error"
        ? testResult.error
        : testResult.injected
          ? t("traffic_engine.check_injection_confirmed", { count: testResult.packets ?? 0 })
          : testResult.message,
  };

  return (
    <Card id={modeCardId("masquerade")} className={cn(CARD_SHELL, engine.highlighted && HIGHLIGHT)}>
      <ViewHeader
        viewKey="main"
        padClassName={CARD_PAD}
        title={modeLabel}
        description={t("traffic_engine.masquerade_tagline")}
      />
      <ViewBody viewKey="main" direction={-1} className={CARD_PAD}>
        <div className={CARD_BODY}>
          <HandshakeStrip
            mode="masquerade"
            active={engine.active}
            strength={0}
            domain={shown}
            preview={dirty && !draftError}
            hint={
              <HintIcon label={t("traffic_engine.aria_masquerade_how")}>
                {t("traffic_engine.masquerade_how")}
              </HintIcon>
            }
          />
          <div className={ROWS}>
            <MetricRow
              label={t("traffic_engine.metric_carrier_reads")}
              value={shown}
              mono
              quiet={!engine.active}
            />
            <MetricRow
              label={t("traffic_engine.metric_acts_on")}
              value={t("traffic_engine.acts_on_all")}
              quiet={!engine.active}
            />
          </div>
          <div className={FIELD.ROW}>
            <div className={FIELD.TEXT}>
              <div className={FIELD.LABEL_ROW}>
                <label htmlFor={inputId} className={FIELD.LABEL}>
                  {t("masquerade.label_domain")}
                </label>
                <HintIcon label={t("masquerade.aria_domain_info")}>{t("masquerade.help_domain")}</HintIcon>
              </div>
              <p className={FIELD.HINT}>{t("masquerade.helper_domain")}</p>
            </div>
            <div className={FIELD.INPUT_WRAP}>
              <Input
                id={inputId}
                type="text"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="none"
                value={draftDomain}
                onChange={(e) => onDraftChange(e.target.value)}
                disabled={masq.isSaving}
                placeholder={t("masquerade.placeholder_domain")}
                className={FIELD.INPUT}
                aria-invalid={!!draftError}
                aria-describedby={draftError ? errorId : undefined}
              />
              {draftError ? (
                <FieldError id={errorId} className={FIELD.ERROR}>
                  {draftError}
                </FieldError>
              ) : null}
            </div>
          </div>
          <CheckRow
            title={t("masquerade.test_title")}
            description={t("masquerade.test_description")}
            blockedReason={
              engine.active ? undefined : t("traffic_engine.check_blocked", { mode: modeLabel })
            }
            runLabel={t("masquerade.button_run_test")}
            busyLabel={t("masquerade.state_testing")}
            icon={SyringeIcon}
            busy={check.busy}
            onRun={() => void masq.runTest()}
            result={
              check.outcome ? <CheckResult outcome={check.outcome} message={check.message} /> : undefined
            }
          />
        </div>
        <ModeFoot
          {...engine}
          modeLabel={modeLabel}
          dirty={dirty}
          invalid={!!draftError}
          isSaving={masq.isSaving}
          onDiscard={() => onDraftChange(savedDomain)}
          onApply={onApply}
        />
      </ViewBody>
    </Card>
  );
}
