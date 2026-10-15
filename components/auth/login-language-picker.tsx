"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AVAILABLE_LANGUAGES } from "@/lib/i18n/available-languages";
import { fetchLanguagePackList } from "@/lib/i18n/language-pack-client";
import { DEFAULT_MANIFEST_URL } from "@/lib/i18n/language-pack-manifest";
import { cn } from "@/lib/utils";
import type { LanguageCode } from "@/types/i18n";

// =============================================================================
// LoginLanguagePicker — Icon-only Ghost button + radio menu for pre-auth pages.
// =============================================================================
// A slimmed-down sibling of components/i18n/language-switcher.tsx that fits
// the login chrome: no inline label, no border, opens a small radio list of
// bundled + installed language packs. Selection persists via i18next's normal
// changeLanguage flow — no auth required because the i18n preference is
// client-side.
//
// Positioning is the caller's job (the login page places it in the top-right
// corner cluster beside ModeToggle).
//
// GLYPH: Material Symbols, because the Icon-Boundary Rule covers `/` and
// `/login/`. The boundary covers those two routes, NOT every pre-auth surface:
// /setup/ is still a lucide route, so mounting this there would walk Material
// across the boundary. Retarget /setup/ first, or give it a lucide sibling.
// =============================================================================

interface LoginLanguagePickerProps {
  className?: string;
  variant?: "ghost" | "outline";
  size?: "icon-sm" | "icon";
}

export function LoginLanguagePicker({
  className,
  variant = "ghost",
  size = "icon-sm",
}: LoginLanguagePickerProps) {
  const { t, i18n } = useTranslation("common");
  const [installedCodes, setInstalledCodes] = React.useState<LanguageCode[]>([]);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetchLanguagePackList(DEFAULT_MANIFEST_URL);
        if (!mounted) return;
        setInstalledCodes(res.installed.map((i) => i.code));
      } catch {
        // Best-effort: if the list CGI fails (older firmware, network blip),
        // we still render the bundled languages.
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const visibleLanguages = React.useMemo(
    () =>
      AVAILABLE_LANGUAGES.filter(
        (l) => l.bundled || installedCodes.includes(l.code),
      ),
    [installedCodes],
  );

  const formatLabel = (lang: typeof AVAILABLE_LANGUAGES[number]) =>
    lang.native_name === lang.english_name
      ? lang.native_name
      : `${lang.native_name} (${lang.english_name})`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={size}
          aria-label={t("language.switch_aria")}
          // text-foreground (not muted) for outdoor-readable contrast against
          // a tablet glass in direct sunlight.
          className={cn(
            variant === "ghost" && "text-foreground",
            // Ghost at rest, tonal while its menu is open, so the trigger reads
            // as the origin of the surface hanging beneath it.
            "data-[state=open]:bg-surface-container",
            className,
          )}
        >
          {/* Explicit `size`: MaterialSymbol writes an inline fontSize, and
              17px matches the ModeToggle glyph beside it at icon-sm. */}
          <MaterialSymbol name="translate" size={size === "icon-sm" ? 17 : 19} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-[10rem]">
        <DropdownMenuRadioGroup
          value={i18n.language}
          onValueChange={(value) => i18n.changeLanguage(value)}
        >
          {visibleLanguages.map((lang) => (
            <DropdownMenuRadioItem key={lang.code} value={lang.code}>
              {formatLabel(lang)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
