"use client";

import * as React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { Checkbox } from "@/components/ui/checkbox";
import { SaveButton } from "@/components/ui/save-button";
import {
  SEGMENTED,
  SegmentedField,
  type SegmentedOption,
} from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { SmartDnsSettings, SmartDnsStatus } from "@/types/smartdns";

import { SMARTDNS_UPSTREAMS } from "./providers";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  FOOT,
  ROW_DIVIDER,
  SETTING,
  SKELETON,
  UPSTREAM,
} from "./shapes";

// =============================================================================
// SettingsCard — the resolver's whole configuration, in one card, one foot
// =============================================================================
// DESIGN.md > Layout: a feature's settings live in one self-contained card, and
// a card that edits a draft commits from `CardFoot`. There is no second Save.
//
// -----------------------------------------------------------------------------
// THE TWO SWITCHES MEAN DIFFERENT THINGS AND ARE LABELLED AS SUCH
// -----------------------------------------------------------------------------
//   Resolver          — run it. Nothing on the LAN uses it yet.
//   Route LAN DNS     — put it in front of the carrier in dnsmasq. THIS is the
//                       switch that changes what every client resolves through,
//                       so it is separate, off by default, and cannot be turned
//                       on while the resolver is off.
//
// Each row's sub-line states the consequence of the CURRENT position, not the
// one being moved to: the reader needs to know what they are living with before
// they change it, and a sentence that swaps under the cursor hides exactly that.
//
// -----------------------------------------------------------------------------
// WHY THE UPSTREAM LIST IS CHECKBOXES
// -----------------------------------------------------------------------------
// smartdns races every upstream it is given and takes the fastest answer, so the
// count is the thing that matters — more endpoints, more resilience to one being
// unreachable. A Select shows one value and hides the set; the count is printed
// above the grid instead.
// =============================================================================

const K = "smartdns";

type OnOff = "on" | "off";

/** The lucide check SegmentedField reserves on every segment. */
const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

const ROW_CASCADE = { variants: staggerRows, initial: "hidden", animate: "visible" } as const;

/** The cache sizes offered. Bounded in the backend at 512..65536. */
const CACHE_CHOICES = [1024, 4096, 8192] as const;

function SettingRow({
  label,
  sub,
  held = false,
  children,
}: {
  label: string;
  sub: string;
  held?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.div variants={staggerRowItem} className={SETTING.ROW}>
      <div className={cn(SETTING.KEY, held && SETTING.HELD)}>
        <span className={SETTING.KEY_LINE}>{label}</span>
        <span className={SETTING.KEY_SUB}>{sub}</span>
      </div>
      <div className={SETTING.CONTROL}>{children}</div>
    </motion.div>
  );
}

export interface SettingsCardProps {
  status: SmartDnsStatus | null;
  /** The draft, already merged over the device's settings by the shell. */
  draft: SmartDnsSettings;
  isLoading: boolean;
  isSaving: boolean;
  saved: boolean;
  isDirty: boolean;
  canApply: boolean;
  /** Why Apply is blocked, as a translation key; null when it is not. */
  blockedKey: string | null;
  onChange: (patch: Partial<SmartDnsSettings>) => void;
  onDiscard: () => void;
  onSubmit: (event: React.FormEvent) => void;
}

export function SettingsCard({
  status,
  draft,
  isLoading,
  isSaving,
  saved,
  isDirty,
  canApply,
  blockedKey,
  onChange,
  onDiscard,
  onSubmit,
}: SettingsCardProps) {
  const { t } = useTranslation("local-network");
  const formId = React.useId();

  const onOffOptions: SegmentedOption<OnOff>[] = [
    { value: "off", label: t("common:state.off") },
    { value: "on", label: t("common:state.on") },
  ];

  const cacheOptions: SegmentedOption<string>[] = CACHE_CHOICES.map((size) => ({
    value: String(size),
    label: String(size),
    numeric: true,
  }));

  const pending = isLoading && status === null;

  const selected = draft.upstreams;
  const toggleUpstream = (url: string) => {
    const next = selected.includes(url)
      ? selected.filter((u) => u !== url)
      : [...selected, url];
    onChange({ upstreams: next });
  };

  const lanBlocked = blockedKey !== null;

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={CARD_PAD}>
        <CardTitle className={CARD_TITLE}>{t(`${K}.settings.title`)}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t(`${K}.settings.description`)}
        </CardDescription>
      </CardHeader>

      <CardContent className={CARD_PAD}>
        {pending ? (
          <div className={SETTING.GROUP} aria-hidden="true">
            {[0, 1, 2].map((row) => (
              <div key={row} className={SETTING.ROW}>
                <div className="flex flex-col gap-1">
                  <Skeleton className={SKELETON.ROW_KEY} />
                  <Skeleton className={SKELETON.ROW_SUB} />
                </div>
                <Skeleton className={cn(SKELETON.PILL, "ml-auto w-40")} />
              </div>
            ))}
          </div>
        ) : (
          <form id={formId} onSubmit={onSubmit}>
            <motion.div className={SETTING.GROUP} {...ROW_CASCADE}>
              <SettingRow
                label={t(`${K}.settings.rows.enabled.label`)}
                sub={t(
                  draft.enabled
                    ? `${K}.settings.rows.enabled.on`
                    : `${K}.settings.rows.enabled.off`,
                )}
              >
                <SegmentedField
                  value={draft.enabled ? "on" : "off"}
                  onValueChange={(next) => onChange({ enabled: next === "on" })}
                  options={onOffOptions}
                  ariaLabel={t(`${K}.settings.rows.enabled.label`)}
                  disabled={isSaving}
                  breakpoint="never"
                  glyph={renderCheckGlyph}
                />
              </SettingRow>

              <SettingRow
                label={t(`${K}.settings.rows.lan_dns.label`)}
                sub={t(
                  draft.lan_dns
                    ? `${K}.settings.rows.lan_dns.on`
                    : `${K}.settings.rows.lan_dns.off`,
                )}
                held={!draft.enabled}
              >
                <SegmentedField
                  value={draft.lan_dns ? "on" : "off"}
                  onValueChange={(next) => onChange({ lan_dns: next === "on" })}
                  options={onOffOptions}
                  ariaLabel={t(`${K}.settings.rows.lan_dns.label`)}
                  disabled={isSaving || !draft.enabled}
                  breakpoint="never"
                  glyph={renderCheckGlyph}
                />
              </SettingRow>

              <SettingRow
                label={t(`${K}.settings.rows.cache.label`)}
                sub={t(`${K}.settings.rows.cache.hint`)}
              >
                <SegmentedField
                  value={String(draft.cache_size)}
                  onValueChange={(next) =>
                    onChange({ cache_size: Number.parseInt(next, 10) })
                  }
                  options={cacheOptions}
                  ariaLabel={t(`${K}.settings.rows.cache.label`)}
                  disabled={isSaving}
                  breakpoint="never"
                  glyph={renderCheckGlyph}
                />
              </SettingRow>

              <SettingRow
                label={t(`${K}.settings.rows.prefetch.label`)}
                sub={t(`${K}.settings.rows.prefetch.hint`)}
              >
                <SegmentedField
                  value={draft.prefetch ? "on" : "off"}
                  onValueChange={(next) => onChange({ prefetch: next === "on" })}
                  options={onOffOptions}
                  ariaLabel={t(`${K}.settings.rows.prefetch.label`)}
                  disabled={isSaving}
                  breakpoint="never"
                  glyph={renderCheckGlyph}
                />
              </SettingRow>
            </motion.div>

            <div className={cn(SETTING.GROUP, ROW_DIVIDER, "mt-5")}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className={SETTING.KEY_LINE}>
                  {t(`${K}.settings.rows.upstreams.label`)}
                </span>
                <span className={UPSTREAM.COUNT}>
                  {t(`${K}.settings.rows.upstreams.count`, {
                    count: selected.length,
                  })}
                </span>
              </div>
              <p className={SETTING.KEY_SUB}>{t(`${K}.settings.rows.upstreams.hint`)}</p>

              <div className={UPSTREAM.GRID}>
                {SMARTDNS_UPSTREAMS.map((provider) => {
                  const id = `smartdns-upstream-${provider.id}`;
                  const checked = selected.includes(provider.url);
                  return (
                    <label
                      key={provider.id}
                      htmlFor={id}
                      className={cn(UPSTREAM.ROW, isSaving && UPSTREAM.ROW_HELD)}
                    >
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={() => toggleUpstream(provider.url)}
                        disabled={isSaving}
                      />
                      <span className="min-w-0 truncate">{provider.name}</span>
                    </label>
                  );
                })}
              </div>

              {/* A configured upstream outside this list is shown rather than
                  silently dropped on the next save — the device is the source of
                  truth even when its value is not one this page offers. */}
              {selected
                .filter((url) => !SMARTDNS_UPSTREAMS.some((p) => p.url === url))
                .map((url) => (
                  <div key={url} className={UPSTREAM.ROW}>
                    <span className="text-on-surface-variant font-mono text-[0.75rem]">
                      {url}
                    </span>
                  </div>
                ))}
            </div>
          </form>
        )}
      </CardContent>

      {/* Outside the form so `mt-auto` reaches the card edge; `form=` keeps Enter-to-submit. */}
      <CardFoot
        className={CARD_PAD}
        liveStatus={!pending}
        status={
          pending ? null : blockedKey !== null ? (
            <span className={FOOT.BLOCKED}>{t(blockedKey)}</span>
          ) : lanBlocked ? null : isDirty ? (
            <span className={FOOT.NOTE}>{t(`${K}.settings.foot.pending`)}</span>
          ) : null
        }
        actions={
          pending ? (
            <Skeleton className={SKELETON.ACTION} aria-hidden="true" />
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="action"
                onClick={onDiscard}
                disabled={!isDirty || isSaving}
              >
                {t("common:actions.discard")}
              </Button>
              <SaveButton
                type="submit"
                form={formId}
                isSaving={isSaving}
                saved={saved}
                label={t("common:actions.apply")}
                disabled={!canApply}
                blockedReason={
                  blockedKey === null ? null : t(blockedKey)
                }
                size="action"
              />
            </>
          )
        }
      />
    </Card>
  );
}

export default SettingsCard;
