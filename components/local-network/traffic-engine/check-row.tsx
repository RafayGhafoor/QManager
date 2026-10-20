"use client";

import type { ReactNode } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CHECK, FIELD } from "./shapes";

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
      {result ? <div className={CHECK.RESULT}>{result}</div> : null}
    </div>
  );
}
