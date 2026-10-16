"use client";

import type { ReactNode } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";

import { CONDITION_TONE } from "@/components/cellular/condition-screen";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { DUR, EASE_QUICK } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { type UseSmsForwardingReturn } from "@/hooks/use-sms-forwarding";

// =============================================================================
// DeliveryHealthCard — the status card that leads the forwarding page
// =============================================================================
// Status first: this card reports the relay before the settings card below
// changes it. A filled health chip carries the verdict, a receipt row names the
// destination, a bubble previews what the recipient receives, and the foot
// holds the test action (it verifies the SAVED path; the CGI reads the target
// from the stored settings, not the draft). Delivery failures surface as a
// destructive block until the user clears them. Shares the lifted
// useSmsForwarding hook with the settings card.
// =============================================================================

// The preview teaches the relay FORMAT, so the sender is a sample inbound
// number, not the saved target (who RECEIVES this bubble).
const SAMPLE_SENDER = "+15550142";
const K = "sms.forwarding.health";

type Health = "active" | "issue" | "off" | "unconfigured";

/** One glyph per state: `success` and `warning` containers are 1.03:1 apart,
 *  so the glyph is the only channel separating them. */
const HEALTH_CHIP: Record<
  Health,
  { variant: BadgeVariant; glyph: MaterialSymbolName }
> = {
  active: { variant: "success", glyph: "check_circle" },
  issue: { variant: "warning", glyph: "warning" },
  unconfigured: { variant: "warning", glyph: "edit" },
  off: { variant: "muted", glyph: "do_not_disturb_on" },
};

const RECEIPT_ROW =
  "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm";

function HealthHeader({ chip }: { chip?: ReactNode }) {
  const { t } = useTranslation("cellular");
  return (
    <CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <CardTitle>{t(`${K}.card_title`)}</CardTitle>
          <CardDescription>{t(`${K}.card_description`)}</CardDescription>
        </div>
        {chip}
      </div>
    </CardHeader>
  );
}

const DeliveryHealthCard = ({ fwd }: { fwd: UseSmsForwardingReturn }) => {
  const { t } = useTranslation("cellular");
  const {
    data,
    isLoading,
    isSendingTest,
    isClearing,
    sendTest,
    clearFailures,
  } = fwd;

  const handleSendTest = async () => {
    const result = await sendTest();
    if (result.ok) toast.success(t(`${K}.toast_test_success`));
    else toast.error(result.error);
  };

  const handleClear = async () => {
    const result = await clearFailures();
    if (result.ok) toast.success(t(`${K}.toast_clear_success`));
    else toast.error(result.error);
  };

  // --- Loading ----------------------------------------------------------------
  if (isLoading) {
    return (
      <Card className="@container/card h-full">
        <HealthHeader chip={<Skeleton className="h-5 w-24 rounded-pill" />} />
        <CardContent className="grid gap-5">
          <div className={RECEIPT_ROW}>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="grid gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-11 w-full rounded-tile" />
          </div>
          <Skeleton className="h-4 w-40" />
        </CardContent>
        <CardFoot
          className="px-6"
          liveStatus={false}
          aria-hidden="true"
          status={<Skeleton className="h-4 w-48" />}
          actions={<Skeleton className="h-[2.625rem] w-32 rounded-pill" />}
        />
      </Card>
    );
  }

  // The page renders the read failure once, in place of both cards.
  if (!data) return null;

  const { enabled, target_phone } = data.settings;
  const failures = data.failures ?? [];

  // One state machine drives the chip, the destination row and the test gate.
  const health: Health = !enabled
    ? "off"
    : !target_phone
      ? "unconfigured"
      : failures.length > 0 || data.failure_count > 0
        ? "issue"
        : "active";
  const chip = HEALTH_CHIP[health];
  const canSendTest = enabled && !!target_phone && !isSendingTest;
  const destructive = CONDITION_TONE.destructive;

  return (
    <Card className="@container/card h-full">
      <HealthHeader
        chip={
          <Badge variant={chip.variant} className="flex-none">
            <MaterialSymbol name={chip.glyph} size={12} />
            {t(`${K}.state_${health}`)}
          </Badge>
        }
      />
      <CardContent className="grid gap-5">
        {/* Destination: a receipt row, key left and value right. */}
        {target_phone ? (
          <div className={RECEIPT_ROW}>
            <span className="text-muted-foreground">
              {t(`${K}.destination_label`)}
            </span>
            <span className="font-mono font-medium tabular-nums">
              {target_phone}
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(`${K}.destination_none`)}
          </p>
        )}

        {/* What the recipient receives */}
        <div className="grid gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t(`${K}.preview_label`)}
          </p>
          <div className="rounded-tile bg-surface-container px-4 py-3">
            <p className="text-sm leading-snug">
              <span className="font-mono text-on-surface-variant">
                {t(`${K}.preview_from`, { sender: SAMPLE_SENDER })}
              </span>{" "}
              <span>{t(`${K}.preview_sample_body`)}</span>
            </p>
          </div>
        </div>

        {/* Delivery failures, until the user clears them */}
        <AnimatePresence initial={false} mode="wait">
          {failures.length > 0 ? (
            <motion.div
              key="failures"
              role="alert"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: DUR.quick, ease: EASE_QUICK }}
              className="overflow-hidden"
            >
              <div
                className={cn(
                  "flex items-start gap-3 rounded-tile px-4 py-3.5",
                  destructive.container,
                )}
              >
                <span
                  className={cn(
                    "grid size-8 flex-none place-items-center rounded-pill",
                    destructive.disc,
                  )}
                >
                  <MaterialSymbol name="error" size={18} filled />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <p className="text-sm font-semibold">
                    {t(`${K}.failures_title`, { count: failures.length })}
                  </p>
                  <p className="text-sm opacity-90">
                    {t(`${K}.failures_description`)}
                  </p>
                  <ul className="grid gap-1.5 text-xs">
                    {failures.slice(0, 5).map((f, i) => (
                      <li
                        key={`${f.sender}-${f.timestamp}-${i}`}
                        className="flex flex-wrap items-baseline gap-x-2"
                      >
                        <span className="font-mono font-medium">
                          {f.sender || t(`${K}.failures_unknown_sender`)}
                        </span>
                        <span className="tabular-nums opacity-80">
                          {f.timestamp}
                        </span>
                        {f.last_error ? (
                          <span className="opacity-80">({f.last_error})</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={isClearing}
                    onClick={handleClear}
                    className={cn(
                      "inline-flex h-9 w-fit items-center gap-1.5 rounded-pill px-4 text-sm font-semibold transition-colors duration-[var(--duration-quick)] ease-out focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
                      destructive.action,
                    )}
                  >
                    <MaterialSymbol
                      name={isClearing ? "progress_activity" : "close"}
                      size={16}
                      className={isClearing ? "motion-safe:animate-spin" : undefined}
                    />
                    {t(`${K}.clear_button`)}
                  </button>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.p
              key="no-failures"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DUR.quick, ease: EASE_QUICK }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground"
            >
              <MaterialSymbol name="check_circle" size={16} className="text-success-on-surface" />
              {t(`${K}.failures_empty`)}
            </motion.p>
          )}
        </AnimatePresence>
      </CardContent>

      <CardFoot
        className="px-6"
        status={
          canSendTest || isSendingTest
            ? t(`${K}.test_hint`)
            : t(`${K}.test_disabled_hint`)
        }
        actions={
          <Button
            type="button"
            variant="tonal-neutral"
            size="action"
            disabled={!canSendTest}
            onClick={handleSendTest}
          >
            <MaterialSymbol
              name={isSendingTest ? "progress_activity" : "send"}
              size={18}
              className={isSendingTest ? "motion-safe:animate-spin" : undefined}
            />
            {isSendingTest ? t(`${K}.test_sending`) : t(`${K}.test_button`)}
          </Button>
        }
      />
    </Card>
  );
};

export default DeliveryHealthCard;
