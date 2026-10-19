"use client";

import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  EyeIcon,
  EyeOffIcon,
  FileCodeIcon,
  WrapTextIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CodeBlock,
  CodeBlockAction,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block";
import { HintIcon } from "@/components/ui/hint-icon";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { cn } from "@/lib/utils";

import { CARD_BODY, CARD_DESC, CARD_PAD, CARD_SHELL, CARD_TITLE, CONFIG } from "./shapes";

const K = "prometheus";

// The page's own host is the address Prometheus will reach the modem on, so
// the snippet is pasteable as-is. Read through `useSyncExternalStore` so the
// static prerender (no `window`) and the client agree without an effect.
const noopSubscribe = () => () => {};
const readHost = () => {
  const h = window.location.hostname;
  // An IPv6 literal needs brackets before the port.
  return h.includes(":") ? `[${h}]` : h;
};
const serverHost = () => "";

/** Masked form shown on screen until the user reveals the token. */
export function maskToken(token: string): string {
  return token ? `${"•".repeat(12)}${token.slice(-4)}` : "";
}

function buildConfig(
  path: string,
  host: string,
  port: number,
  credential: string,
): string {
  return [
    "scrape_configs:",
    "  - job_name: qmanager",
    "    scheme: https",
    `    metrics_path: ${path}`,
    "    authorization:",
    "      type: Bearer",
    `      credentials: ${credential}`,
    "    tls_config:",
    "      insecure_skip_verify: true",
    "    static_configs:",
    `      - targets: ["${host || "MODEM_ADDRESS"}:${port}"]`,
  ].join("\n");
}

interface ScrapeConfigCardProps {
  endpointPath: string;
  /** The device's HTTPS port (custom web ports), 443 by default. */
  httpsPort: number;
  token: string;
  /** True while the SAVED state is enabled with a token (State-Honesty). */
  live: boolean;
  revealed: boolean;
  onRevealedChange: (next: boolean) => void;
}

export function ScrapeConfigCard({
  endpointPath,
  httpsPort,
  token,
  live,
  revealed,
  onRevealedChange,
}: ScrapeConfigCardProps) {
  const { t } = useTranslation("monitoring");

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={cn(CARD_TITLE, "flex items-center gap-1.5")}>
          {t(`${K}.config.label`)}
          <HintIcon label={t(`${K}.config.hint_label`)}>
            {t(`${K}.config.hint`)}
          </HintIcon>
        </CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`${K}.config.consequence`)}
        </CardDescription>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {live ? (
          <ConfigBlock
            endpointPath={endpointPath}
            httpsPort={httpsPort}
            token={token}
            revealed={revealed}
            onRevealedChange={onRevealedChange}
          />
        ) : (
          <div className={CONFIG.EMPTY}>
            <FileCodeIcon className={CONFIG.EMPTY_GLYPH} aria-hidden="true" />
            <span className={CONFIG.EMPTY_TITLE}>
              {t(`${K}.config.empty_title`)}
            </span>
            <span className={CONFIG.EMPTY_DESC}>
              {t(`${K}.config.empty_description`)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Mounted only while live, so the highlighter chunk loads only when needed. */
function ConfigBlock({
  endpointPath,
  httpsPort,
  token,
  revealed,
  onRevealedChange,
}: Omit<ScrapeConfigCardProps, "live">) {
  const { t } = useTranslation("monitoring");
  const host = useSyncExternalStore(noopSubscribe, readHost, serverHost);
  const [wrap, setWrap] = useState(false);

  const shown = buildConfig(
    endpointPath,
    host,
    httpsPort,
    revealed ? token : maskToken(token),
  );
  // The clipboard always gets the real token, whatever the block shows.
  const copyValue = buildConfig(endpointPath, host, httpsPort, token);
  const lines = useHighlightedCode(shown, "yaml");

  return (
    <CodeBlock className={CONFIG.BLOCK}>
      <CodeBlockHeader>
        <CodeBlockTitle>
          <FileCodeIcon aria-hidden="true" />
          {CONFIG.FILENAME}
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockAction
            aria-pressed={revealed}
            aria-label={t(revealed ? `${K}.token.hide` : `${K}.token.show`)}
            onClick={() => onRevealedChange(!revealed)}
          >
            {revealed ? (
              <EyeOffIcon className="size-4" aria-hidden="true" />
            ) : (
              <EyeIcon className="size-4" aria-hidden="true" />
            )}
          </CodeBlockAction>
          <CodeBlockAction
            aria-pressed={wrap}
            aria-label={t(`${K}.config.wrap`)}
            onClick={() => setWrap((v) => !v)}
          >
            <WrapTextIcon className="size-4" aria-hidden="true" />
          </CodeBlockAction>
          <CodeBlockCopyButton
            value={copyValue}
            label={t(`${K}.config.copy`)}
            copiedLabel={t(`${K}.config.copied`)}
            onResult={(ok) => {
              if (ok) toast.success(t(`${K}.toast.config_copied`));
              else toast.error(t(`${K}.toast.copy_failed`));
            }}
          />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent wrap={wrap} aria-label={t(`${K}.config.label`)}>
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}
