"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckIcon, RefreshCcwIcon, TriangleAlertIcon } from "lucide-react";

import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { CardFoot } from "@/components/ui/card-foot";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDnsSettings,
  type UseDnsSettingsReturn,
} from "@/hooks/use-dns-settings";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { cn } from "@/lib/utils";
import {
  CUSTOM_PROVIDER_ID,
  DNS_PROVIDERS,
  matchProvider,
} from "./dns-providers";
import {
  ADDRESS_INPUT,
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION,
  FAMILIES,
  FAMILY,
  FAMILY_TITLE,
  INPUTS,
  PROVIDER_TRIGGER,
  RECEIPT,
  SETTING_ROW,
  SKELETON,
} from "./shapes";

// Structural IPv6 check, mirroring the backend's gate closely enough that a
// malformed address never reaches it. Empty is allowed (optional field).
const IPV6 =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
const isValidIPv6 = (value: string) => !value || IPV6.test(value.trim());

/** The lucide check that SegmentedField reserves on every segment. */
const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

type Draft = {
  enabled: boolean;
  dns1: string;
  dns2: string;
  dns3: string;
  dns1v6: string;
  dns2v6: string;
  provider: string;
};

const draftFrom = (data: NonNullable<UseDnsSettingsReturn["data"]>): Draft => ({
  enabled: data.mode === "enabled",
  dns1: data.dns1,
  dns2: data.dns2,
  dns3: data.dns3,
  dns1v6: data.dns1v6,
  dns2v6: data.dns2v6,
  provider: matchProvider(
    data.dns1,
    data.dns2,
    data.dns3,
    data.dns1v6,
    data.dns2v6,
  ),
});

const EMPTY_DRAFT: Draft = {
  enabled: false,
  dns1: "",
  dns2: "",
  dns3: "",
  dns1v6: "",
  dns2v6: "",
  provider: CUSTOM_PROVIDER_ID,
};

function CustomDnsSkeleton() {
  return (
    <Card className={CARD_SHELL} aria-hidden="true">
      <CardHeader className={CARD_PAD}>
        <Skeleton className="h-7 w-48 rounded-inline" />
        <Skeleton className="h-5 w-72 max-w-full rounded-inline" />
      </CardHeader>
      <CardContent className={`${CARD_PAD} ${CARD_BODY}`}>
        <Skeleton className={SKELETON.SETTING} />
        <div className="flex flex-col gap-3">
          <Skeleton className={SKELETON.LABEL} />
          <Skeleton className={SKELETON.TRIGGER} />
        </div>
        <div className={RECEIPT.ROOT}>
          {[0, 1].map((g) => (
            <div key={g} className={RECEIPT.GROUP}>
              <div className={RECEIPT.GROUP_TITLE}>
                <Skeleton className={SKELETON.RECEIPT_TITLE} />
              </div>
              {[0, 1].map((r) => (
                <div key={r} className={RECEIPT.ROW}>
                  <Skeleton className={SKELETON.RECEIPT_TITLE} />
                  <Skeleton className={SKELETON.RECEIPT_VALUE} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </CardContent>
      <CardFoot
        className={CARD_PAD}
        liveStatus={false}
        actions={<Skeleton className={SKELETON.ACTION} />}
      />
    </Card>
  );
}

/**
 * Custom DNS: one card that owns the whole draft (on/off, provider, five
 * addresses across both families) and commits it from the foot. A preset
 * shows its resolved addresses as receipt rows; Custom reveals the inputs.
 */
const CustomDNSCard = () => {
  const { t } = useTranslation("local-network");
  const { data, isLoading, isSaving, error, saveDns, refresh } =
    useDnsSettings();
  const { saved, markSaved } = useSaveFlash();
  const formId = useId();

  const [draft, setDraft] = useState<Draft>(() =>
    data ? draftFrom(data) : EMPTY_DRAFT,
  );
  // Re-seed the draft whenever a load or save replaces the data
  // (adjust-during-render, no effect).
  const [prevData, setPrevData] = useState(data);
  if (data && data !== prevData) {
    setPrevData(data);
    setDraft(draftFrom(data));
  }

  const set = useCallback(
    <K extends keyof Draft>(key: K, value: Draft[K]) =>
      setDraft((d) => ({ ...d, [key]: value })),
    [],
  );

  const { enabled, dns1, dns2, dns3, dns1v6, dns2v6, provider } = draft;
  const isCustom = provider === CUSTOM_PROVIDER_ID;

  const handleProviderChange = useCallback((value: string) => {
    const preset = DNS_PROVIDERS.find((p) => p.id === value);
    setDraft((d) =>
      preset
        ? {
            ...d,
            provider: value,
            dns1: preset.ipv4[0],
            dns2: preset.ipv4[1],
            dns3: "",
            dns1v6: preset.ipv6[0],
            dns2v6: preset.ipv6[1],
          }
        : { ...d, provider: value },
    );
  }, []);

  const dns1v6Invalid = enabled && !isValidIPv6(dns1v6);
  const dns2v6Invalid = enabled && !isValidIPv6(dns2v6);
  const hasV6Error = dns1v6Invalid || dns2v6Invalid;
  const noAddresses = !dns1 && !dns2 && !dns3 && !dns1v6 && !dns2v6;
  const blocked = enabled && (noAddresses || hasV6Error);

  const isDirty = useMemo(() => {
    if (!data) return false;
    return (
      enabled !== (data.mode === "enabled") ||
      dns1 !== data.dns1 ||
      dns2 !== data.dns2 ||
      dns3 !== data.dns3 ||
      dns1v6 !== data.dns1v6 ||
      dns2v6 !== data.dns2v6
    );
  }, [data, enabled, dns1, dns2, dns3, dns1v6, dns2v6]);

  const handleSave = useCallback(async () => {
    if (!data || blocked) return;
    const result = await saveDns({
      mode: enabled ? "enabled" : "disabled",
      nic: data.nic,
      dns1,
      dns2,
      dns3,
      dns1v6,
      dns2v6,
    });
    if (result.ok) {
      markSaved();
      toast.success(
        enabled
          ? t("dns.toast_success_enabled")
          : t("dns.toast_success_disabled"),
      );
    } else if (result.code !== null || result.error !== null) {
      // A null/null result means the card unmounted mid-call: nobody to tell.
      toast.error(
        resolveErrorMessage(
          t,
          result.code,
          result.error,
          t("dns.toast_error_apply"),
        ),
      );
    }
  }, [
    data,
    blocked,
    enabled,
    dns1,
    dns2,
    dns3,
    dns1v6,
    dns2v6,
    saveDns,
    markSaved,
    t,
  ]);

  const handleDiscard = useCallback(() => {
    if (data) setDraft(draftFrom(data));
  }, [data]);

  if (isLoading) return <CustomDnsSkeleton />;

  const header = (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>{t("dns.card_title")}</CardTitle>
      <CardDescription className={CARD_DESC}>
        {t("dns.card_description")}
      </CardDescription>
    </CardHeader>
  );

  // A read that failed and left nothing behind: the block IS the state.
  if (!data) {
    return (
      <Card className={CARD_SHELL}>
        {header}
        <CardContent className={CARD_PAD}>
          <div role="alert" className={CONDITION.ROOT}>
            <span aria-hidden className={CONDITION.DISC}>
              <TriangleAlertIcon className={CONDITION.GLYPH} />
            </span>
            <p className={CONDITION.TITLE}>{t("dns.error_load_title")}</p>
            <p className={CONDITION.DESC}>
              {error ?? t("dns.error_load_desc")}
            </p>
            <Button
              variant="ghost"
              size="action"
              onClick={() => refresh()}
              className={CONDITION.ACTION}
            >
              <RefreshCcwIcon aria-hidden="true" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const v4Rows = [
    { key: t("dns.receipt_primary"), value: dns1 },
    { key: t("dns.receipt_secondary"), value: dns2 },
  ];
  const v6Rows = [
    { key: t("dns.receipt_primary"), value: dns1v6 },
    { key: t("dns.receipt_secondary"), value: dns2v6 },
  ];

  return (
    <Card className={CARD_SHELL}>
      {header}
      <CardContent className={`${CARD_PAD} ${CARD_BODY}`}>
        <form
          id={formId}
          className={CARD_BODY}
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
        >
          <div
            className={cn(
              SETTING_ROW.ROOT,
              SETTING_ROW.TRANSITION,
              enabled ? SETTING_ROW.ON : SETTING_ROW.REST,
            )}
          >
            <div className={SETTING_ROW.TEXT}>
              <p className={SETTING_ROW.TITLE}>{t("dns.label_enable")}</p>
              <p className={SETTING_ROW.DESC}>{t("dns.enable_description")}</p>
            </div>
            <SegmentedField
              value={enabled ? "on" : "off"}
              onValueChange={(next) => set("enabled", next === "on")}
              ariaLabel={t("dns.label_enable")}
              disabled={isSaving}
              breakpoint="never"
              glyph={renderCheckGlyph}
              options={[
                { value: "off", label: t("common:state.off") },
                { value: "on", label: t("common:state.on") },
              ]}
            />
          </div>

          <Field>
            <FieldLabel htmlFor="dns-provider">
              {t("dns.label_provider")}
            </FieldLabel>
            {/* Field stretches its direct children; the wrapper owns the width. */}
            <div className={PROVIDER_TRIGGER}>
              <Select
                value={provider}
                onValueChange={handleProviderChange}
                disabled={!enabled || isSaving}
              >
                <SelectTrigger id="dns-provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DNS_PROVIDERS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_PROVIDER_ID}>
                    {t("dns.provider_custom")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Field>

          {isCustom ? (
            <div className={FAMILIES}>
              <fieldset className={FAMILY} disabled={!enabled || isSaving}>
                <legend className={cn(FAMILY_TITLE, "mb-3")}>
                  {t("dns.label_ipv4_section")}
                </legend>
                <div className={INPUTS}>
                  <Field>
                    <FieldLabel htmlFor="primary-dns">
                      {t("dns.label_primary_dns")}
                    </FieldLabel>
                    <Input
                      id="primary-dns"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t("dns.placeholder_primary_dns")}
                      value={dns1}
                      onChange={(e) => set("dns1", e.target.value)}
                      className={ADDRESS_INPUT}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="secondary-dns">
                      {t("dns.label_secondary_dns")}
                    </FieldLabel>
                    <Input
                      id="secondary-dns"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t("dns.placeholder_secondary_dns")}
                      value={dns2}
                      onChange={(e) => set("dns2", e.target.value)}
                      className={ADDRESS_INPUT}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="tertiary-dns">
                      {t("dns.label_tertiary_dns")}
                      <span className="text-on-surface-variant font-normal">
                        {t("dns.label_tertiary_dns_optional_suffix")}
                      </span>
                    </FieldLabel>
                    <Input
                      id="tertiary-dns"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t("dns.placeholder_tertiary_dns")}
                      value={dns3}
                      onChange={(e) => set("dns3", e.target.value)}
                      className={ADDRESS_INPUT}
                    />
                  </Field>
                </div>
              </fieldset>

              <fieldset className={FAMILY} disabled={!enabled || isSaving}>
                <legend className={cn(FAMILY_TITLE, "mb-3")}>
                  {t("dns.label_ipv6_section")}
                </legend>
                <div className={INPUTS}>
                  <Field>
                    <FieldLabel htmlFor="primary-dns6">
                      {t("dns.label_primary_dns6")}
                    </FieldLabel>
                    <Input
                      id="primary-dns6"
                      autoComplete="off"
                      spellCheck={false}
                      autoCapitalize="none"
                      placeholder={t("dns.placeholder_primary_dns6")}
                      value={dns1v6}
                      onChange={(e) => set("dns1v6", e.target.value)}
                      aria-invalid={dns1v6Invalid || undefined}
                      aria-describedby={hasV6Error ? "dns6-error" : undefined}
                      className={ADDRESS_INPUT}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="secondary-dns6">
                      {t("dns.label_secondary_dns6")}
                      <span className="text-on-surface-variant font-normal">
                        {t("dns.label_tertiary_dns_optional_suffix")}
                      </span>
                    </FieldLabel>
                    <Input
                      id="secondary-dns6"
                      autoComplete="off"
                      spellCheck={false}
                      autoCapitalize="none"
                      placeholder={t("dns.placeholder_secondary_dns6")}
                      value={dns2v6}
                      onChange={(e) => set("dns2v6", e.target.value)}
                      aria-invalid={dns2v6Invalid || undefined}
                      aria-describedby={hasV6Error ? "dns6-error" : undefined}
                      className={ADDRESS_INPUT}
                    />
                  </Field>
                </div>
                {hasV6Error ? (
                  <FieldError id="dns6-error">
                    {t("dns.error_invalid_ipv6")}
                  </FieldError>
                ) : null}
              </fieldset>
            </div>
          ) : (
            // A preset: its resolved addresses, read-only, key left and value right.
            <div className={RECEIPT.ROOT}>
              {[
                { title: t("dns.label_ipv4_section"), rows: v4Rows },
                { title: t("dns.label_ipv6_section"), rows: v6Rows },
              ].map((group) => (
                <div key={group.title} className={RECEIPT.GROUP}>
                  <p className={RECEIPT.GROUP_TITLE}>{group.title}</p>
                  <dl className={RECEIPT.GROUP}>
                    {group.rows.map((row) => (
                      <div key={row.key} className={RECEIPT.ROW}>
                        <dt className={RECEIPT.KEY}>{row.key}</dt>
                        <dd className={RECEIPT.VALUE}>
                          {row.value || t("dns.receipt_none")}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          )}

          {enabled && noAddresses ? (
            <FieldError id="dns-error">
              {t("dns.error_at_least_one")}
            </FieldError>
          ) : null}
        </form>
      </CardContent>

      {/* Outside the form so `mt-auto` reaches the card edge; `form=` keeps Enter-to-submit. */}
      <CardFoot
        className={CARD_PAD}
        status={
          // A failed refresh or save stays visible here until the next good read.
          error ? (
            <span className="inline-flex items-center gap-1.5 text-destructive">
              <TriangleAlertIcon
                className="size-3.5 shrink-0"
                aria-hidden="true"
              />
              {error}
            </span>
          ) : null
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="action"
              onClick={handleDiscard}
              disabled={!isDirty || isSaving}
            >
              {t("common:actions.discard")}
            </Button>
            <SaveButton
              type="submit"
              form={formId}
              isSaving={isSaving}
              saved={saved}
              label={t("actions.apply", { ns: "common" })}
              disabled={!isDirty || blocked}
              size="action"
            />
          </>
        }
      />
    </Card>
  );
};

export default CustomDNSCard;
