import * as React from "react";

import { loadHighlighter, type Highlighter } from "@/lib/highlighter";

// =============================================================================
// useHighlightedCode — one React node per line, plain text until shiki loads
// =============================================================================
// Adapted from the shadcn `use-highlighted-code` registry item. The tokens are
// rendered here (`color` is a `var(--code-*)` reference), so the lib stays free
// of JSX. Returns plain lines first, then the coloured ones: the code is
// readable and copyable before the grammar chunk arrives.
// =============================================================================

type Loaded = { language: string; highlighter: Highlighter | null } | null;

export function useHighlightedCode(
  value: string,
  language: string,
): React.ReactNode[] {
  // A trailing newline would render as an extra empty line.
  const code = value.endsWith("\n") ? value.slice(0, -1) : value;
  const [loaded, setLoaded] = React.useState<Loaded>(null);
  const highlighter = loaded?.language === language ? loaded.highlighter : null;

  React.useEffect(() => {
    let cancelled = false;

    loadHighlighter(language)
      .then((next) => {
        if (!cancelled) setLoaded({ language, highlighter: next });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [language]);

  // Re-tokenizing is cheap for a snippet this size and pure in its inputs, so
  // it is memoised rather than carried as state.
  return React.useMemo(() => {
    if (!highlighter) return code.split("\n");

    return highlighter.highlight(code).lines.map((line) =>
      line.map((token, index) => (
        <span key={index} style={{ color: token.color }}>
          {token.content}
        </span>
      )),
    );
  }, [code, highlighter]);
}
