import * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// An icon-only pill that grows to reveal its label on hover or keyboard focus.
// The label stays in the accessibility tree at all times (via `aria-label`), so
// the collapsed state loses nothing for screen readers. The width animates with
// the `0fr` -> `1fr` grid-track trick, so no label width is measured in JS.
// Motion tokens only (`--duration-quick` / `--ease-standard`).

type ExpandButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "children" | "size"
> & {
  /** The glyph shown in both states. */
  icon: React.ReactNode
  /** Revealed on hover/focus; also the accessible name. */
  label: string
}

function ExpandButton({
  icon,
  label,
  className,
  variant = "outline",
  ...props
}: ExpandButtonProps) {
  return (
    <Button
      type="button"
      variant={variant}
      aria-label={label}
      className={cn(
        "group/expand h-[2.625rem] gap-0 px-3 font-semibold has-[>[data-slot=material-symbol]]:px-3",
        className,
      )}
      {...props}
    >
      {icon}
      <span
        aria-hidden
        className="ml-0 grid grid-cols-[0fr] opacity-0 transition-[grid-template-columns,margin,opacity] duration-[var(--duration-quick)] ease-[var(--ease-standard)] group-hover/expand:ml-2 group-hover/expand:mr-1.5 group-hover/expand:grid-cols-[1fr] group-hover/expand:opacity-100 group-focus-visible/expand:ml-2 group-focus-visible/expand:mr-1.5 group-focus-visible/expand:grid-cols-[1fr] group-focus-visible/expand:opacity-100"
      >
        <span className="min-w-0 overflow-hidden">{label}</span>
      </span>
    </Button>
  )
}

export { ExpandButton }
