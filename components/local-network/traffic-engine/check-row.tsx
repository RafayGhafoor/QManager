"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { useMotionReduced } from "@/components/motion-preference";
import { Button } from "@/components/ui/button";
import { DUR } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { CHECK, FIELD } from "./shapes";

/** How long a finished check's result stays before it fades out. */
const RESULT_HOLD_MS = 6000;

interface CheckRowProps {
  title: string;
  description: string;
  /** Why the check can't run now (the mode is off). Replaces the description. */
  blockedReason?: string;
  runLabel: string;
  busyLabel: string;
  icon: LucideIcon;
  busy: boolean;
  onRun: () => void;
  /** The result line, shown under the row once a run finishes. */
  result?: ReactNode;
}

/**
 * The confidence check both mode cards end with (Verify service, Test
 * injection): text left, the run action right, the result on its own line.
 * One component, so the twins can't drift.
 */
export function CheckRow({
  title,
  description,
  blockedReason,
  runLabel,
  busyLabel,
  icon: Icon,
  busy,
  onRun,
  result,
}: CheckRowProps) {
  const reduceMotion = useMotionReduced();
  const [phase, setPhase] = useState<"shown" | "leaving" | "gone">("shown");
  const hasResult = Boolean(result);

  // A new run clears the result first (busy), so the next one starts "shown".
  if (!hasResult && phase !== "shown") setPhase("shown");

  // The result is a confirmation, not a record: it flies in, holds a few
  // seconds, then fades out and collapses so the card settles back.
  useEffect(() => {
    if (!hasResult) return;
    const leave = setTimeout(() => {
      if (reduceMotion) {
        setPhase("gone");
        return;
      }
      setPhase("leaving");
    }, RESULT_HOLD_MS);
    return () => clearTimeout(leave);
  }, [hasResult, reduceMotion]);

  useEffect(() => {
    if (phase !== "leaving") return;
    const done = setTimeout(() => setPhase("gone"), DUR.standard * 1000);
    return () => clearTimeout(done);
  }, [phase]);

  return (
    <div className={CHECK.ROOT} aria-live="polite">
      <div className={CHECK.TEXT}>
        <p className={FIELD.LABEL}>{title}</p>
        <p className={FIELD.HINT}>{blockedReason ?? description}</p>
      </div>
      <Button
        type="button"
        variant="tonal"
        onClick={onRun}
        disabled={Boolean(blockedReason) || busy}
      >
        {busy ? (
          <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
        ) : (
          <Icon aria-hidden="true" />
        )}
        {busy ? busyLabel : runLabel}
      </Button>
      {result && phase !== "gone" ? (
        <div className={cn(CHECK.RESULT_WRAP, phase === "leaving" && CHECK.RESULT_LEAVING)}>
          <div className={CHECK.RESULT}>{result}</div>
        </div>
      ) : null}
    </div>
  );
}
