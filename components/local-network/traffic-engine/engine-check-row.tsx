"use client";

import type { ReactNode } from "react";
import { Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HintIcon } from "@/components/ui/hint-icon";
import { CHECK } from "./shapes";

interface EngineCheckRowProps {
  title: string;
  description: string;
  hint?: string;
  hintAriaLabel?: string;
  runLabel: string;
  busyLabel: string;
  /** The mode is running; a check of a stopped engine proves nothing. */
  running: boolean;
  busy: boolean;
  onRun: () => void;
  /** The result notice, shown only while the mode runs. */
  children?: ReactNode;
}

/**
 * The confidence check both mode panels end with: Video's verify and
 * Masquerade's injection test share this layout so they stay in lockstep.
 */
export function EngineCheckRow({
  title,
  description,
  hint,
  hintAriaLabel,
  runLabel,
  busyLabel,
  running,
  busy,
  onRun,
  children,
}: EngineCheckRowProps) {
  return (
    <div className={CHECK.ROOT} aria-live="polite">
      <div className={CHECK.HEAD}>
        <div className={CHECK.TEXT}>
          <div className={CHECK.TITLE_ROW}>
            <p className={CHECK.TITLE}>{title}</p>
            {hint ? <HintIcon label={hintAriaLabel ?? title}>{hint}</HintIcon> : null}
          </div>
          <p className={CHECK.DESC}>{description}</p>
        </div>
        <Button
          type="button"
          variant="tonal-neutral"
          onClick={onRun}
          disabled={!running || busy}
        >
          {busy ? (
            <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <Zap aria-hidden="true" />
          )}
          {busy ? busyLabel : runLabel}
        </Button>
      </div>

      {running ? children : null}
    </div>
  );
}
