"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  InfoIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { HintIcon } from "@/components/ui/hint-icon";
import { Input } from "@/components/ui/input";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import {
  SEGMENTED,
  SegmentedField,
  type SegmentedOption,
} from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { useModemStatus } from "@/hooks/use-modem-status";
import type {
  PingProfileCadence,
  PingProfileSettings,
  UsePingProfileReturn,
} from "@/hooks/use-ping-profile";
import { cn } from "@/lib/utils";
import {
  PING_PROFILES,
  type ConnectivityStatus,
  type PingProfile,
} from "@/types/modem-status";

import { ConditionBlock } from "./condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION,
  EYEBROW,
  FAILED,
  FIELD_ERROR,
  FIELD_MONO,
  FOCUS_RING,
  GROUP,
  GROUP_HEAD,
  LEG,
  METRIC_HEAD,
  PILL_GLYPH,
  ROW,
  ROW_STACK,
  SKELETON_LOCAL,
  SLOT_ORDER,
  type SlotKey,
} from "./shapes";

// Probe Targets: how often the modem pings, and what, in probe order. What a
// failed probe triggers (the down threshold, recovery) belongs to the Watchdog.

const K = "connection_quality.targets";
const WATCHDOG_HREF = "/monitoring/watchdog/";

/** The installer's seed, so a restore lands where a fresh install would. */
const DEFAULTS: PingProfileSettings = {
  profile: "relaxed",
  target_ipv4: "1.1.1.1",
  target_ipv6: "2606:4700:4700::1111",
};

/**
 * Probe interval per profile, mirrored from `conn_state_resolve` in
 * `scripts/usr/lib/qmanager/conn_state.sh` so an unsaved choice previews its
 * cadence. The CGI's `interval_sec` stays the answer for the saved one.
 */
const PROFILE_INTERVAL_SEC: Record<PingProfile, number> = {
  sensitive: 1,
  regular: 2,
  relaxed: 5,
  quiet: 10,
};

const LABEL_LEAF: Record<SlotKey, string> = {
  target_ipv4: "ipv4",
  target_ipv6: "ipv6",
};

const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

// ─── Validation: mirrors validate_target() in the CGI ───────────────────────

type ValidationCode =
  | "empty"
  | "too_long"
  | "spaces"
  | "disallowed"
  | "ipv4_invalid"
  | "ipv6_invalid"
  | "ipv6_colon";

type SlotErrors = Partial<Record<SlotKey, ValidationCode | null>>;

const MAX_TARGET_LENGTH = 128;

function checkCommonRules(trimmed: string): ValidationCode | null {
  if (!trimmed) return "empty";
  if (trimmed.length > MAX_TARGET_LENGTH) return "too_long";
  if (/\s/.test(trimmed)) return "spaces";
  if (/[`$();|<>"\\]/.test(trimmed)) return "disallowed";
  return null;
}

/** family `ipv4`: an IPv4 literal or a hostname, charset [0-9A-Za-z.-]. */
function validateIpv4(value: string): ValidationCode | null {
  const trimmed = value.trim();
  const common = checkCommonRules(trimmed);
  if (common) return common;
  if (/[^0-9A-Za-z.-]/.test(trimmed)) return "ipv4_invalid";
  return null;
}

/** family `ipv6`: an IPv6 literal, charset [0-9A-Fa-f:.%] with a colon. */
function validateIpv6(value: string): ValidationCode | null {
  const trimmed = value.trim();
  const common = checkCommonRules(trimmed);
  if (common) return common;
  if (/[^0-9A-Fa-f:.%]/.test(trimmed)) return "ipv6_invalid";
  if (!trimmed.includes(":")) return "ipv6_colon";
  return null;
}

const validateSlot = (slot: SlotKey, value: string) =>
  slot === "target_ipv4" ? validateIpv4(value) : validateIpv6(value);

// ─── The chain's verdict ────────────────────────────────────────────────────

type LegState = "ipv4" | "ipv6" | "none" | "unknown";

interface LegVerdict {
  state: LegState;
  /** The answering leg's index in the SAVED chain, or -1. */
  index: number;
}

/**
 * Which leg carried the last probe, from the ICMP daemon only. A DNS lookup
 * time is its own reading and never stands in for this verdict.
 */
function legState(
  conn: ConnectivityStatus | undefined,
  saved: PingProfileSettings,
): LegVerdict {
  if (!conn || conn.status === "unknown" || conn.internet_available === null) {
    return { state: "unknown", index: -1 };
  }
  if (conn.internet_available !== true || conn.last_family === "none") {
    return { state: "none", index: -1 };
  }
  // The daemon reports its first target; a mismatch means it still runs the old chain.
  if (conn.ping_target && conn.ping_target !== saved.target_ipv4) {
    return { state: "unknown", index: -1 };
  }
  return conn.last_family === "ipv6"
    ? { state: "ipv6", index: 1 }
    : { state: "ipv4", index: 0 };
}

const VERDICT: Record<LegState, { variant: BadgeVariant; glyph: LucideIcon; key: string }> = {
  ipv4: { variant: "success", glyph: CircleCheckIcon, key: "verdict.ipv4" },
  // The fallback carrying the link is what it exists for: a fact, not a fault.
  ipv6: { variant: "info", glyph: InfoIcon, key: "verdict.ipv6" },
  none: { variant: "destructive", glyph: CircleSlashIcon, key: "verdict.none" },
  unknown: { variant: "muted", glyph: CircleDashedIcon, key: "verdict.unknown" },
};

// ─── Card ───────────────────────────────────────────────────────────────────

export interface ProbeTargetsCardProps {
  profile: UsePingProfileReturn;
}

export default function ProbeTargetsCard({ profile }: ProbeTargetsCardProps) {
  const { t } = useTranslation("monitoring");
  const { settings, cadence, isLoading, refresh } = profile;
  const { data: modemStatus, isLoading: statusLoading } = useModemStatus();

  const verdict =
    settings && !statusLoading ? legState(modemStatus?.connectivity, settings) : null;
  const spec = verdict ? VERDICT[verdict.state] : null;
  const VerdictGlyph = spec?.glyph;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle as="h2" className={CARD_TITLE}>
          {t(`${K}.title`)}
        </CardTitle>
        <CardDescription className={CARD_DESC}>{t(`${K}.description`)}</CardDescription>
        {isLoading || (settings && !spec) ? (
          <CardAction>
            <Skeleton className={SKELETON_LOCAL.VERDICT} />
          </CardAction>
        ) : spec && VerdictGlyph ? (
          <CardAction>
            <Badge variant={spec.variant}>
              <VerdictGlyph className="size-3" aria-hidden="true" />
              {t(`${K}.${spec.key}`)}
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {isLoading ? (
          <ProbeTargetsSkeleton />
        ) : !settings ? (
          <ConditionBlock
            tone="destructive"
            icon={CircleAlertIcon}
            ariaRole="alert"
            title={t(`${K}.error.title`)}
            description={t(`${K}.error.body`)}
            onAction={() => void refresh()}
            actionLabel={t(`${K}.error.retry`)}
            actionIcon={RefreshCwIcon}
            className={CONDITION.SCREEN}
          />
        ) : (
          <ProbeForm
            profile={profile}
            saved={settings}
            cadence={cadence}
            answered={verdict?.index ?? -1}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Loading ────────────────────────────────────────────────────────────────

function ProbeTargetsSkeleton() {
  return (
    <>
      <div className={GROUP}>
        <div className={METRIC_HEAD}>
          <span className={cn(EYEBROW, "mr-auto")}>
            <Skeleton className={cn(SKELETON_LOCAL.EYEBROW, "inline-block w-20 align-middle")} />
          </span>
          <Skeleton className={SKELETON_LOCAL.SEGMENT} />
        </div>
        <div className={ROW.ROOT} aria-hidden="true">
          <Skeleton className={cn(SKELETON_LOCAL.ROW_TEXT, "w-24")} />
          <Skeleton className={cn(SKELETON_LOCAL.ROW_TEXT, "w-20")} />
        </div>
      </div>
      {[0, 1].map((group) => (
        <div key={group} className={GROUP}>
          <div className={GROUP_HEAD}>
            <Skeleton className={SKELETON_LOCAL.EYEBROW} />
          </div>
          <div className={LEG.ROW}>
            <Skeleton className={SKELETON_LOCAL.DISC} />
            <Skeleton className={SKELETON_LOCAL.FIELD} />
          </div>
        </div>
      ))}
      <CardFoot
        className="mt-auto"
        liveStatus={false}
        actions={
          <>
            <Skeleton className={SKELETON_LOCAL.ACTION} />
            <Skeleton className={SKELETON_LOCAL.ACTION} />
          </>
        }
      />
    </>
  );
}

// ─── The form ───────────────────────────────────────────────────────────────

interface ProbeFormProps {
  profile: UsePingProfileReturn;
  /** Narrowed: this subtree only renders once the GET has landed. */
  saved: PingProfileSettings;
  cadence: PingProfileCadence | null;
  answered: number;
}

function ProbeForm({ profile, saved, cadence, answered }: ProbeFormProps) {
  const { t } = useTranslation("monitoring");
  const { isSaving, save } = profile;
  const { saved: flashed, markSaved } = useSaveFlash();

  // Edits are HELD and overlaid on the server values, never synced by an effect.
  const [edits, setEdits] = React.useState<Partial<PingProfileSettings>>({});
  const [errors, setErrors] = React.useState<SlotErrors>({});
  const [failed, setFailed] = React.useState(false);

  const values: PingProfileSettings = {
    profile: edits.profile ?? saved.profile,
    target_ipv4: edits.target_ipv4 ?? saved.target_ipv4,
    target_ipv6: edits.target_ipv6 ?? saved.target_ipv6,
  };

  const isDirty =
    values.profile !== saved.profile ||
    SLOT_ORDER.some((slot) => values[slot] !== saved[slot]);
  const hasValidationErrors = SLOT_ORDER.some((slot) => errors[slot]);
  const canSave = isDirty && !isSaving && !hasValidationErrors;

  const setSlot = (slot: SlotKey, value: string) => {
    setEdits((prev) => ({ ...prev, [slot]: value }));
    setErrors((prev) => ({ ...prev, [slot]: validateSlot(slot, value) }));
    setFailed(false);
  };

  const setProfile = (next: PingProfile) => {
    setEdits((prev) => ({ ...prev, profile: next }));
    setFailed(false);
  };

  const restoreDefaults = () => {
    setEdits({ ...DEFAULTS });
    setErrors({});
    setFailed(false);
  };

  const handleSave = async () => {
    if (!canSave) return;

    // Re-validate every slot at submit: one never touched has no error yet.
    const submitErrors: SlotErrors = {};
    for (const slot of SLOT_ORDER) submitErrors[slot] = validateSlot(slot, values[slot]);
    setErrors(submitErrors);
    if (SLOT_ORDER.some((slot) => submitErrors[slot])) return;

    const payload: PingProfileSettings = {
      profile: values.profile,
      target_ipv4: values.target_ipv4.trim(),
      target_ipv6: values.target_ipv6.trim(),
    };

    const result = await save(payload);
    if (result.ok) {
      // Hold the trimmed values so a normalised save does not read dirty.
      setEdits(payload);
      setFailed(false);
      markSaved();
      toast.success(t(`${K}.toast.saved`));
    } else {
      setFailed(true);
      toast.error(result.error ?? t(`${K}.toast.failed`));
    }
  };

  const profileOptions: SegmentedOption<PingProfile>[] = PING_PROFILES.map((p) => ({
    value: p,
    label: t(`${K}.profile.${p}`),
  }));

  // The Watchdog's override wins over any profile; otherwise the draft previews its own.
  const override = cadence?.intervalOverride ?? null;
  const intervalSec =
    override ??
    (values.profile === saved.profile
      ? (cadence?.intervalSec ?? PROFILE_INTERVAL_SEC[values.profile])
      : PROFILE_INTERVAL_SEC[values.profile]);

  const renderLeg = (slot: SlotKey, index: number) => {
    const fieldId = `probe-target-${slot}`;
    const errorId = `${fieldId}-error`;
    const code = errors[slot] ?? null;

    return (
      <div className={LEG.ROOT}>
        <div className={LEG.ROW}>
          <span
            aria-hidden="true"
            className={cn(LEG.DISC, index === answered ? LEG.DISC_ANSWERED : LEG.DISC_REST)}
          >
            {index + 1}
          </span>
          <label htmlFor={fieldId} className="sr-only">
            {t(`${K}.leg.${LABEL_LEAF[slot]}`)}
          </label>
          <Input
            id={fieldId}
            className={FIELD_MONO}
            value={values[slot]}
            onChange={(event) => setSlot(slot, event.target.value)}
            placeholder={DEFAULTS[slot]}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={code !== null}
            aria-describedby={code ? errorId : undefined}
          />
        </div>
        {code ? (
          <span id={errorId} role="alert" className={FIELD_ERROR}>
            {t(`${K}.validation.${code}`, { max: MAX_TARGET_LENGTH })}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <div className={GROUP}>
        <div className={METRIC_HEAD}>
          <span className={cn(EYEBROW, "mr-auto")}>{t(`${K}.group.sensitivity`)}</span>
          <SegmentedField
            value={values.profile}
            onValueChange={setProfile}
            options={profileOptions}
            ariaLabel={t(`${K}.group.sensitivity`)}
            breakpoint="lg"
            glyph={renderCheckGlyph}
          />
        </div>
        <div className={ROW.ROOT}>
          <span className={ROW.KEY}>{t(`${K}.interval.label`)}</span>
          <span className={ROW.VALUE}>
            {override !== null ? (
              <Link href={WATCHDOG_HREF} className={cn(ROW.LINK, FOCUS_RING)}>
                {t(`${K}.interval.override`, { seconds: intervalSec })}
                <ArrowUpRightIcon aria-hidden="true" className={ROW.LINK_GLYPH} />
              </Link>
            ) : (
              t(`${K}.interval.value`, { seconds: intervalSec })
            )}
          </span>
        </div>
      </div>

      <div className={GROUP}>
        <div className={GROUP_HEAD}>
          <span className={EYEBROW}>{t(`${K}.group.ipv4`)}</span>
        </div>
        <div className={ROW_STACK}>{renderLeg("target_ipv4", 0)}</div>
      </div>

      <div className={GROUP}>
        <div className={GROUP_HEAD}>
          <span className={EYEBROW}>{t(`${K}.group.ipv6`)}</span>
          <HintIcon label={t(`${K}.fallback_hint_label`)}>{t(`${K}.fallback_hint`)}</HintIcon>
        </div>
        <div className={ROW_STACK}>{renderLeg("target_ipv6", 1)}</div>
      </div>

      <CardFoot
        className="mt-auto"
        status={
          failed ? (
            <span className={FAILED.ROOT}>
              <TriangleAlertIcon className={FAILED.GLYPH} aria-hidden="true" />
              {t(`${K}.failed`)}
            </span>
          ) : null
        }
        actions={
          <>
            <Button type="button" variant="tonal-neutral" size="action" onClick={restoreDefaults}>
              <RotateCcwIcon className={PILL_GLYPH} aria-hidden="true" />
              {t(`${K}.restore`)}
            </Button>
            <SaveButton
              onClick={handleSave}
              isSaving={isSaving}
              saved={flashed}
              label={t(`${K}.save`)}
              disabled={!canSave}
              size="action"
            />
          </>
        }
      />
    </>
  );
}
