"use client";

import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { CopyIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { HintIcon } from "@/components/ui/hint-icon";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

import { ROW, SNIPPET, TOKEN } from "./shapes";

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

interface ScrapeConfigProps {
  endpointPath: string;
  /** The device's HTTPS port (custom web ports), 443 by default. */
  httpsPort: number;
  token: string;
  revealed: boolean;
}

export function ScrapeConfig({
  endpointPath,
  httpsPort,
  token,
  revealed,
}: ScrapeConfigProps) {
  const { t } = useTranslation("monitoring");
  const host = useSyncExternalStore(noopSubscribe, readHost, serverHost);

  const shown = buildConfig(
    endpointPath,
    host,
    httpsPort,
    revealed ? token : maskToken(token),
  );

  const handleCopy = async () => {
    const ok = await copyText(
      buildConfig(endpointPath, host, httpsPort, token),
    );
    if (ok) toast.success(t(`${K}.toast.config_copied`));
    else toast.error(t(`${K}.toast.copy_failed`));
  };

  return (
    <div className={cn(SNIPPET.ROOT, "@container/card")}>
      <div className={SNIPPET.HEAD}>
        <div className={ROW.TEXT}>
          <span className={ROW.LABEL_LINE}>
            <span className={ROW.LABEL}>{t(`${K}.config.label`)}</span>
            <HintIcon label={t(`${K}.config.hint_label`)}>
              {t(`${K}.config.hint`)}
            </HintIcon>
          </span>
          <span className={ROW.CONSEQUENCE}>{t(`${K}.config.consequence`)}</span>
        </div>
        <Button
          type="button"
          variant="tonal-neutral"
          size="sm"
          onClick={handleCopy}
        >
          <CopyIcon className={TOKEN.GLYPH} aria-hidden="true" />
          {t(`${K}.config.copy`)}
        </Button>
      </div>
      <pre
        className={SNIPPET.BLOCK}
        aria-label={t(`${K}.config.label`)}
        tabIndex={0}
      >
        {shown}
      </pre>
    </div>
  );
}
