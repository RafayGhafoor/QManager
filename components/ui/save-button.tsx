"use client";

import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useMotionReduced } from "@/components/motion-preference";
import { Loader2, CheckIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { type VariantProps } from "class-variance-authority";
import { DUR, EASE_QUICK } from "@/lib/motion";
import { cn } from "@/lib/utils";

type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

// =============================================================================
// useSaveFlash — brief "Saved!" indicator after a successful save
// =============================================================================
// Usage:
//   const { saved, markSaved } = useSaveFlash();
//   // call markSaved() after a successful save
// =============================================================================

export function useSaveFlash(duration = 1800) {
  const [saved, setSaved] = useState(false);
  const markSaved = useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), duration);
  }, [duration]);
  return { saved, markSaved };
}

// =============================================================================
// SaveButton — primary save button with loading + saved flash states
// =============================================================================

interface SaveButtonProps extends Omit<ButtonProps, "children"> {
  isSaving: boolean;
  saved: boolean;
  label?: string;
  /** Localizable transient-state labels. Default to English for callers that
   *  haven't been wired to i18n yet. */
  savingLabel?: string;
  savedLabel?: string;
}

export function SaveButton({
  isSaving,
  saved,
  label = "Save Settings",
  savingLabel = "Saving…",
  savedLabel = "Saved!",
  disabled,
  className,
  ...props
}: SaveButtonProps) {
  const isActive = isSaving || saved;
  const reduceMotion = useMotionReduced();
  // Label swaps ride the quick step, no spring — the design system bans
  // bounce/elastic. U2.1b replaces this with the canon save-check pop.

  return (
    <Button
      {...props}
      disabled={disabled || isActive}
      className={cn("relative min-w-[120px] overflow-hidden", className)}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isSaving ? (
          <motion.span
            key="saving"
            className="flex items-center gap-1.5"
            initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
            transition={{ duration: reduceMotion ? 0 : DUR.quick, ease: EASE_QUICK }}
          >
            <Loader2 className="size-3.5 animate-spin" />
            {savingLabel}
          </motion.span>
        ) : saved ? (
          <motion.span
            key="saved"
            className="flex items-center gap-1.5"
            initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.85 }}
            transition={{ duration: reduceMotion ? 0 : DUR.quick, ease: EASE_QUICK }}
          >
            <CheckIcon className="size-3.5" />
            {savedLabel}
          </motion.span>
        ) : (
          <motion.span
            key="idle"
            initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
            transition={{ duration: reduceMotion ? 0 : DUR.quick, ease: EASE_QUICK }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </Button>
  );
}
