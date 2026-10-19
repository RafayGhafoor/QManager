"use client";

import * as React from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

// =============================================================================
// CodeBlock — a block of copy-and-paste text with a header and actions
// =============================================================================
// Adapted from the shadcn `code-block` registry item (radix-nova). Changes from
// the registry source, all to fit this system:
//  - Surface is the canon's: `surface-container` on a card (one tonal step off
//    the host), `rounded-tile`, no border. Syntax colour is the `--code-*`
//    ramp below, mapped onto design tokens, so it follows light and dark.
//  - The copy button goes through `lib/clipboard.ts`: the device is usually
//    reached over plain http, where `navigator.clipboard` does not exist.
//  - Route-neutral: labels arrive as props, lucide glyphs are used directly
//    (the block lives on the lucide side of the icon boundary), and the copy
//    button reports its outcome so the caller owns the toast.
//  - Dropped: variants (destructive), size, footer, added/removed lines.
// =============================================================================

/** The syntax ramp. Keys carry the acting hue; everything else stays neutral. */
const CODE_INK =
  "[--code-foreground:var(--on-surface)] [--code-token-constant:var(--primary-on-surface)] [--code-token-string:var(--on-surface)] [--code-token-string-expression:var(--on-surface)] [--code-token-keyword:var(--primary-on-surface)] [--code-token-function:var(--primary-on-surface)] [--code-token-parameter:var(--on-surface)] [--code-token-link:var(--primary-on-surface)] [--code-token-comment:var(--on-surface-variant)] [--code-token-punctuation:var(--on-surface-variant)]";

/** Icon buttons keep a painted 32px; the overlay lifts the target to 44px on touch. */
const ACTION_BUTTON =
  "text-on-surface-variant hover:text-on-surface aria-pressed:text-on-surface relative before:absolute before:-inset-1.5 before:content-['']";

function CodeBlock({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block"
      className={cn(
        "group/code-block bg-surface-container text-on-surface relative flex w-full min-w-0 flex-col overflow-hidden rounded-tile text-sm",
        "has-[>[data-slot=code-block-content]:focus-visible]:ring-ring/50 has-[>[data-slot=code-block-content]:focus-visible]:ring-3",
        CODE_INK,
        className,
      )}
      {...props}
    />
  );
}

function CodeBlockHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-header"
      className={cn(
        "text-on-surface-variant flex min-w-0 shrink-0 items-center gap-2 py-2 pr-2 pl-4",
        className,
      )}
      {...props}
    />
  );
}

function CodeBlockTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-title"
      className={cn(
        "text-on-surface flex min-w-0 items-center gap-2 truncate font-sans text-[0.8125rem] font-medium [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function CodeBlockActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-actions"
      className={cn("ml-auto flex shrink-0 items-center gap-1", className)}
      {...props}
    />
  );
}

/** A header action: ghost, 32px, quiet until hovered. */
function CodeBlockAction({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      data-slot="code-block-action"
      className={cn(ACTION_BUTTON, className)}
      {...props}
    />
  );
}

interface CodeBlockCopyButtonProps
  extends Omit<React.ComponentProps<typeof Button>, "value"> {
  /** What lands on the clipboard; may differ from what the block shows. */
  value: string;
  /** Accessible name before and after a copy. */
  label: string;
  copiedLabel: string;
  /** Fires once the copy resolved; the caller toasts the outcome. */
  onResult?: (ok: boolean) => void;
}

function CodeBlockCopyButton({
  value,
  label,
  copiedLabel,
  onResult,
  className,
  onClick,
  ...props
}: CodeBlockCopyButtonProps) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);

  return (
    <>
      <CodeBlockAction
        data-slot="code-block-copy-button"
        data-copied={copied || undefined}
        aria-label={copied ? copiedLabel : label}
        className={className}
        onClick={async (event) => {
          onClick?.(event);
          const ok = await copyText(value);
          if (ok) setCopied(true);
          onResult?.(ok);
        }}
        {...props}
      >
        {copied ? (
          <CheckIcon className="size-4" aria-hidden="true" />
        ) : (
          <CopyIcon className="size-4" aria-hidden="true" />
        )}
      </CodeBlockAction>
      <span aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
    </>
  );
}

function CodeBlockContent({
  className,
  children,
  style,
  wrap = false,
  lineNumbers = false,
  startLine = 1,
  ...props
}: React.ComponentProps<"pre"> & {
  wrap?: boolean;
  lineNumbers?: boolean;
  startLine?: number;
}) {
  return (
    <pre
      data-slot="code-block-content"
      data-wrap={wrap || undefined}
      data-numbered={lineNumbers || undefined}
      dir="ltr"
      tabIndex={0}
      style={{ counterReset: `line ${startLine - 1}`, ...style }}
      className={cn(
        "selection:bg-primary/25 min-h-0 min-w-0 flex-1 overflow-auto px-4 pt-1.5 pb-4 text-start font-mono text-[0.8125rem] leading-[1.65] outline-none [scrollbar-width:thin] data-wrap:wrap-break-word data-wrap:whitespace-pre-wrap",
        className,
      )}
      {...props}
    >
      <code
        data-slot="code-block-code"
        className="in-data-numbered:grid-cols-[auto_1fr] in-data-wrap:min-w-0 grid min-h-lh min-w-max content-start"
      >
        {lineNumbers && typeof children === "string"
          ? children
              .replace(/\n$/, "")
              .split("\n")
              .map((line, index) => (
                <CodeBlockLine key={index}>{line}</CodeBlockLine>
              ))
          : children}
      </code>
    </pre>
  );
}

function CodeBlockLine({
  className,
  children,
  ...props
}: React.ComponentProps<"span">) {
  // An empty line holds a newline so copying a selection keeps blank lines.
  const empty =
    children === undefined ||
    children === null ||
    children === "" ||
    (Array.isArray(children) && children.length === 0);

  return (
    <span
      data-slot="code-block-line"
      className={cn(
        "in-data-numbered:col-span-2 in-data-numbered:grid in-data-numbered:grid-cols-subgrid in-data-numbered:gap-x-3 in-data-numbered:[counter-increment:line] in-data-numbered:before:content-[counter(line)] in-data-numbered:before:text-on-surface-variant in-data-numbered:before:min-w-6 in-data-numbered:before:text-end in-data-numbered:before:select-none relative block min-h-lh",
        className,
      )}
      {...props}
    >
      <span data-slot="code-block-line-content" className="min-w-0">
        {empty ? "\n" : children}
      </span>
    </span>
  );
}

export {
  CodeBlock,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockActions,
  CodeBlockAction,
  CodeBlockCopyButton,
  CodeBlockContent,
  CodeBlockLine,
};
