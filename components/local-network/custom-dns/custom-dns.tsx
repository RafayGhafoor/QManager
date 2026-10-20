"use client";

import * as React from "react";
import { useCallback, useId, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useSaveFlash } from "@/components/ui/save-button";
import { useDnsSettings } from "@/hooks/use-dns-settings";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { staggerContainer, staggerItem } from "@/lib/motion";

import { DNS_PROVIDERS } from "./dns-providers";
import {
  ADDRESS_KEYS,
  EMPTY_DRAFT,
  V4_KEYS,
  V6_KEYS,
  baselineFrom,
  hasAnyAddress,
  isValidAddress,
  presetFill,
  providerFor,
  type AddressKey,
  type Draft,
} from "./draft";
import { ResolverCard } from "./resolver-card";
import { ServersCard } from "./servers-card";
import { FAMILY_GRID, PAGE_HEAD, PAGE_ROOT } from "./shapes";

// =============================================================================
// Custom DNS — page shell
// =============================================================================
// The shell owns the read and the one draft the three cards edit: Resolver
// (on/off and provider, which commits from its foot), then IPv4 and IPv6 as
// peer cards. The backend takes all of it in one POST, so the server cards
// have no foot of their own; their fields join the Resolver form via `form=`,
// which keeps Enter-to-submit.
//
// The draft is derived, not synced: the shell holds only the user's EDITS over
// a baseline derived from the read, so a save's re-read re-bases the page
// without a setState-in-effect.
// =============================================================================

const K = "dns";

const CustomDNSComponent = () => {
  const { t } = useTranslation("local-network");
  const { data, isLoading, isSaving, error, saveDns, refresh } = useDnsSettings();
  const { saved, markSaved } = useSaveFlash();
  const formId = useId();

  const baseline = useMemo(() => (data ? baselineFrom(data) : null), [data]);
  const [edits, setEdits] = useState<Partial<Draft>>({});
  const draft = useMemo<Draft>(
    () => ({ ...(baseline ?? EMPTY_DRAFT), ...edits }),
    [baseline, edits],
  );

  const ready = baseline !== null;
  const status = isLoading ? "pending" : ready ? "ready" : "failed";

  // ---------------------------------------------------------------------------
  // Edits
  // ---------------------------------------------------------------------------
  const handleToggle = useCallback(
    (enabled: boolean) =>
      setEdits((prev) => {
        const next = { ...draft, ...prev, enabled };
        // Turning on with nothing to send starts from the first preset, a
        // working resolver the user can still change before applying.
        return enabled && !hasAnyAddress(next)
          ? { ...prev, enabled, ...presetFill(DNS_PROVIDERS[0].id) }
          : { ...prev, enabled };
      }),
    [draft],
  );

  const handleProvider = useCallback(
    (id: string) => setEdits((prev) => ({ ...prev, ...presetFill(id) })),
    [],
  );

  const handleAddress = useCallback(
    (key: AddressKey, value: string) =>
      setEdits((prev) => {
        const next = { ...draft, ...prev, [key]: value };
        return { ...prev, [key]: value, provider: providerFor(next) };
      }),
    [draft],
  );

  const handleDiscard = useCallback(() => setEdits({}), []);

  // ---------------------------------------------------------------------------
  // Validity
  // ---------------------------------------------------------------------------
  const invalid = useMemo(() => {
    const map = {} as Record<AddressKey, boolean>;
    for (const key of ADDRESS_KEYS) {
      map[key] = draft.enabled && !isValidAddress(key, draft[key]);
    }
    return map;
  }, [draft]);

  const anyInvalid = ADDRESS_KEYS.some((key) => invalid[key]);
  const blockedKey = !draft.enabled
    ? null
    : anyInvalid
      ? `${K}.blocked_invalid`
      : !hasAnyAddress(draft)
        ? `${K}.error_at_least_one`
        : null;

  const isDirty =
    baseline !== null &&
    (draft.enabled !== baseline.enabled ||
      ADDRESS_KEYS.some((key) => draft[key].trim() !== baseline[key].trim()));

  const canApply = ready && isDirty && blockedKey === null && !isSaving;

  // ---------------------------------------------------------------------------
  // Apply
  // ---------------------------------------------------------------------------
  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!data) return;
      if (blockedKey !== null) {
        // Enter can still submit a blocked form; refuse out loud.
        toast.error(t(blockedKey));
        return;
      }
      if (!canApply) return;

      const result = await saveDns({
        mode: draft.enabled ? "enabled" : "disabled",
        nic: data.nic,
        dns1: draft.dns1.trim(),
        dns2: draft.dns2.trim(),
        dns3: draft.dns3.trim(),
        dns1v6: draft.dns1v6.trim(),
        dns2v6: draft.dns2v6.trim(),
      });

      if (result.ok) {
        // The hook re-read the device before resolving, so the baseline is fresh.
        setEdits({});
        markSaved();
        toast.success(
          t(draft.enabled ? `${K}.toast_success_enabled` : `${K}.toast_success_disabled`),
        );
      } else if (result.code !== null || result.error !== null) {
        // null/null means the page unmounted mid-call: nobody to tell.
        toast.error(
          resolveErrorMessage(t, result.code, result.error, t(`${K}.toast_error_apply`)),
        );
      }
    },
    [data, blockedKey, canApply, draft, saveDns, markSaved, t],
  );

  // Off (or unread) holds the address rows: they keep their values but cannot
  // be edited until custom DNS is on.
  const serversHeld = !ready || !draft.enabled || isSaving;

  // The cascade root declares `initial`/`animate` once; children must not, or
  // they detach from the parent's clock.
  return (
    <motion.div
      className={PAGE_ROOT}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={staggerItem}>
        <div className={PAGE_HEAD.ROOT}>
          <div className={PAGE_HEAD.TITLES}>
            <h1 className={PAGE_HEAD.TITLE}>{t(`${K}.page_title`)}</h1>
            <p className={PAGE_HEAD.DESC}>{t(`${K}.page_description`)}</p>
          </div>
        </div>
      </motion.div>

      <motion.div variants={staggerItem}>
        <ResolverCard
          status={status}
          formId={formId}
          draft={draft}
          isSaving={isSaving}
          saved={saved}
          isDirty={isDirty}
          canApply={canApply}
          blockedKey={blockedKey}
          error={error}
          onToggle={handleToggle}
          onProvider={handleProvider}
          onDiscard={handleDiscard}
          onSubmit={handleSubmit}
          onRetry={() => refresh()}
        />
      </motion.div>

      {/* A failed read leaves nothing to show here; the Resolver card says why. */}
      {status !== "failed" ? (
        <motion.div variants={staggerItem} className={FAMILY_GRID}>
          <ServersCard
            family="v4"
            keys={V4_KEYS}
            pending={status === "pending"}
            formId={formId}
            draft={draft}
            invalid={invalid}
            held={serversHeld}
            onChange={handleAddress}
          />
          <ServersCard
            family="v6"
            keys={V6_KEYS}
            pending={status === "pending"}
            formId={formId}
            draft={draft}
            invalid={invalid}
            held={serversHeld}
            onChange={handleAddress}
          />
        </motion.div>
      ) : null}
    </motion.div>
  );
};

export default CustomDNSComponent;
