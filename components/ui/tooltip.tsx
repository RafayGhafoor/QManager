"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

/**
 * `default` is the inverted pill with an arrow (sidebar labels, raw values).
 * `info` wears the `HintIcon` tip surface (DESIGN.md > Copy & Help): popover
 * ground, hairline border, field radius, enter-only motion, no arrow. Use it for
 * a hover label that explains a verdict or fact. It is still a Radix Tooltip, so
 * it does not open on tap: an explanation a user must be able to read on a phone
 * belongs in a `HintIcon`.
 */
function TooltipContent({
  className,
  sideOffset,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  variant?: "default" | "info"
}) {
  const info = variant === "info"
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset ?? (info ? 8 : 0)}
        collisionPadding={info ? 12 : undefined}
        className={cn(
          info
            ? [
                "z-50 w-fit max-w-[min(18rem,var(--radix-tooltip-content-available-width))] origin-(--radix-tooltip-content-transform-origin)",
                "rounded-field border bg-popover px-3.5 py-2.5 text-[0.8125rem] leading-5 text-pretty text-popover-foreground shadow-lg",
                // Enter only, like `HintIcon`: closing is instant.
                "animate-in fade-in-0 zoom-in-96 duration-[var(--duration-quick)] ease-standard",
                "data-[side=top]:slide-in-from-bottom-1 data-[side=bottom]:slide-in-from-top-1",
                "motion-reduce:zoom-in-100 motion-reduce:data-[side=top]:slide-in-from-bottom-0 motion-reduce:data-[side=bottom]:slide-in-from-top-0",
              ]
            : "bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance",
          className
        )}
        {...props}
      >
        {children}
        {info ? null : (
          <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
        )}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
