// =============================================================================
// highlighter — shiki, loaded lazily, coloured by CSS variables
// =============================================================================
// Adapted from the shadcn `code-block` registry item. Two deliberate changes:
//
//  1. One `css-variables` theme instead of github-light + github-dark. Token
//     colours are `var(--code-*)`, so light and dark come from the design
//     tokens the `CodeBlock` root maps them to, and a syntax colour is never a
//     raw hex the canon did not choose.
//  2. Only the languages a QManager surface renders. Every entry becomes its
//     own chunk in the static export (the device serves them from flash), so
//     add a language only with the surface that needs it.
// =============================================================================

import {
  createCssVariablesTheme,
  createHighlighterCore,
  type GrammarState,
  type HighlighterCore,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

const languages = {
  yaml: () => import("shiki/langs/yaml.mjs"),
};

const aliases: Record<string, keyof typeof languages> = {
  yml: "yaml",
};

/** The prefix the `CodeBlock` root maps onto design tokens. */
export const CODE_VARIABLE_PREFIX = "--code-";

const THEME = "code-block";

let highlighter: Promise<HighlighterCore> | undefined;

function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [
      createCssVariablesTheme({
        name: THEME,
        variablePrefix: CODE_VARIABLE_PREFIX,
        variableDefaults: {},
        fontStyle: false,
      }),
    ],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });

  return highlighter;
}

function getLanguage(language: string) {
  const name = language.toLowerCase();
  if (name in languages) return name as keyof typeof languages;
  return aliases[name] ?? null;
}

export interface LineToken {
  content: string;
  color?: string;
}

export interface Highlighter {
  /**
   * One token list per line, and the grammar state after the last line. Pass
   * that state back to continue where the code left off.
   */
  highlight(
    code: string,
    state?: GrammarState,
  ): { lines: LineToken[][]; state: GrammarState | undefined };
}

/** Loads a language and returns a highlighter for it, or null if unlisted. */
export async function loadHighlighter(
  language: string,
): Promise<Highlighter | null> {
  const lang = getLanguage(language);
  if (!lang) return null;

  const shiki = await getHighlighter();
  if (!shiki.getLoadedLanguages().includes(lang)) {
    await shiki.loadLanguage(languages[lang]);
  }

  return {
    highlight(code, state) {
      const tokens = shiki.codeToTokens(code, {
        lang,
        theme: THEME,
        grammarState: state,
      }).tokens;

      return {
        lines: tokens.map((line) =>
          line.map((token) => ({ content: token.content, color: token.color })),
        ),
        state: shiki.getLastGrammarState(tokens),
      };
    },
  };
}
