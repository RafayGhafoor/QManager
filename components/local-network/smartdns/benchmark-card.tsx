"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { PlayIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SmartDnsBench } from "@/types/smartdns";

import { CARD_DESC, CARD_PAD, CARD_SHELL, CARD_TITLE, SETTING } from "./shapes";

// =============================================================================
// BenchmarkCard — "what would my DNS latency be if I changed it?"
// =============================================================================
// Every row is measured the SAME way: `curl -w %{time_namelookup}`, with
// `--doh-url <provider>` for a DoH row and without it for the "current path"
// row. One method is what makes the comparison a comparison.
//
// The current-path row is dnsmasq - and when the resolver is wired (`lan_dns`),
// that same row IS SmartDNS, because dnsmasq forwards to it. So the card answers
// both questions the operator asked with one table and no special cases:
//   * "what would the latency be if I changed DNS?"  -> current vs provider rows
//   * "what does SmartDNS buy?"                       -> current (wired) vs carrier
//
// HONEST LIMITS, stated on the card rather than in a comment nobody reads: the
// number includes the DoH TLS handshake, the first sample of each provider
// therefore pays for it, and min/median are shown separately for that reason. It
// is not a resolver RTT and must not be read as one.
// =============================================================================

/** Delta label: negative means the row is FASTER than the current path. */
function delta(current: number | null, row: number | null): string | null {
  if (current === null || row === null || current <= 0) return null;
  const pct = Math.round(((current - row) / current) * 100);
  if (pct === 0) return "0%";
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

export function BenchmarkCard({
  bench,
  running,
  onRun,
}: {
  bench: SmartDnsBench | null;
  running: boolean;
  onRun: () => void;
}) {
  const { t } = useTranslation("local-network");
  const rows = React.useMemo(() => {
    if (!bench) return [];
    // Fastest first, unanswered last: the page should never make the reader sort.
    return [...bench.results].sort((a, b) => {
      if (a.min_ms === null && b.min_ms === null) return 0;
      if (a.min_ms === null) return 1;
      if (b.min_ms === null) return -1;
      return a.min_ms - b.min_ms;
    });
  }, [bench]);

  return (
    <Card className={cn(CARD_SHELL, "@container/card")}>
      <CardHeader className={cn(CARD_PAD, "flex flex-row items-start gap-4")}>
        <div className="min-w-0 flex-1">
          <CardTitle className={CARD_TITLE}>
            {t("smartdns.benchmark.title", "DNS latency")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t(
              "smartdns.benchmark.helper",
              "Resolve time for a real hostname through each resolver. The first row is this device's current path.",
            )}
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRun}
          disabled={running}
          className="shrink-0"
        >
          {running ? (
            <RefreshCwIcon className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <PlayIcon className="size-4" aria-hidden="true" />
          )}
          <span className="ml-1.5">
            {running
              ? t("smartdns.benchmark.running", "Measuring…")
              : t("smartdns.benchmark.run", "Run test")}
          </span>
        </Button>
      </CardHeader>

      <CardContent className={cn(CARD_PAD, "flex flex-col gap-3")}>
        {!bench && !running ? (
          <p className={cn(CARD_DESC, "py-2")}>
            {t(
              "smartdns.benchmark.empty",
              "No measurement yet. Run the test to compare this device's current resolver with the DoH providers.",
            )}
          </p>
        ) : null}

        {bench ? (
          <div className="flex flex-col">
            {rows.map((r) => {
              const isSystem = r.kind === "system";
              const d = delta(bench.system_ms, r.min_ms);
              return (
                <div
                  key={r.id}
                  className={cn(
                    SETTING.ROW,
                    "grid grid-cols-[1fr_auto_auto] items-center gap-3 py-2",
                  )}
                >
                  <span className="min-w-0 truncate text-sm">
                    {isSystem
                      ? t(
                          "smartdns.benchmark.system_row",
                          "Current path (dnsmasq)",
                        )
                      : r.label}
                  </span>
                  <span className="text-on-surface-variant text-xs tabular-nums">
                    {r.min_ms === null
                      ? t("smartdns.benchmark.failed", "no answer")
                      : d}
                  </span>
                  <span className="w-16 text-right text-sm tabular-nums">
                    {r.min_ms === null ? "—" : `${r.min_ms} ms`}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}

        {bench ? (
          <p className={cn(CARD_DESC, "text-xs leading-relaxed")}>
            {t(
              "smartdns.benchmark.method",
              "Method: curl name-lookup time, {{samples}} samples per domain over {{domains}}. Includes the DoH TLS handshake, so a first sample is the slowest — min and median are reported separately.",
              { samples: bench.samples_per_domain, domains: bench.domains.join(", ") },
            )}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
