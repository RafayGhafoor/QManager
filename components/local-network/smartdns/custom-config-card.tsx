"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { CARD_DESC, CARD_PAD, CARD_SHELL, CARD_TITLE } from "./shapes";

// =============================================================================
// CustomConfigCard — the operator's own smartdns config file
// =============================================================================
// The reference build (greenpacket) had a free-text config editor and the owner
// asked for one. This tree deliberately did not, for one reason: it would hand a
// root daemon an arbitrary directive string. That reason is answered rather than
// ignored — the backend renders the candidate TOGETHER with the generated base
// and starts it on a throwaway port, and only a config that actually BINDS is
// installed. A config that cannot run is refused with the daemon's own error.
//
// The file is INCLUDED, not substituted: the generated half stays UCI-driven
// (`conf-file` pulls this one in), so the two cannot fight over the bind line,
// the port or the cache size. Everything here is additive by construction.
//
// DELIBERATE LIMIT: editing this while the resolver is OFF is safe and inert; the
// file is validated when saved and again on every service start.
// =============================================================================

const PLACEHOLDER = `# Included after the generated config.
# Example:
# server-tls 1.1.1.1:853
# address /ads.example.com/#
# speed-check-mode ping,tcp:80`;

export function CustomConfigCard({
  value,
  installed,
  onSave,
  saving,
}: {
  value: string;
  installed: boolean;
  onSave: (text: string) => Promise<boolean>;
  saving: boolean;
}) {
  const { t } = useTranslation("local-network");
  const [draft, setDraft] = React.useState(value);

  // Re-base on a fresh read, but never mid-edit: the same rule the settings card
  // uses, and the reason this is derived rather than synced in an effect.
  const [base, setBase] = React.useState(value);
  if (value !== base) {
    setBase(value);
    setDraft(value);
  }

  const dirty = draft !== value;

  return (
    <Card className={cn(CARD_SHELL, "@container/card")}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>
          {t("smartdns.custom.title", "Config file")}
        </CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(
            "smartdns.custom.helper",
            "Appended after the generated config. It is validated on a throwaway port before it can be saved — a config that cannot bind is refused.",
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-3")}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          disabled={!installed || saving}
          className={cn(
            "min-h-[10rem] w-full resize-y rounded-lg border border-input bg-transparent p-3",
            "font-mono text-xs leading-relaxed outline-none",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
          aria-label={t("smartdns.custom.aria", "SmartDNS custom configuration")}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!installed || saving || !dirty}
            onClick={async () => {
              const ok = await onSave(draft);
              if (ok) setBase(draft);
            }}
          >
            {saving
              ? t("smartdns.custom.saving", "Validating…")
              : t("smartdns.custom.save", "Validate & save")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!dirty || saving}
            onClick={() => setDraft(value)}
          >
            <RotateCcwIcon className="size-4" aria-hidden="true" />
            <span className="ml-1.5">{t("smartdns.custom.reset", "Revert")}</span>
          </Button>
          <span className="text-on-surface-variant ml-auto text-xs tabular-nums">
            {draft.length} / 32768
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
