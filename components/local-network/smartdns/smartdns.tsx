"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { RefreshCcwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useSmartDns } from "@/hooks/use-smartdns";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { staggerContainer, staggerItem } from "@/lib/motion";
import type { SmartDnsSettings } from "@/types/smartdns";

import { InstallCard } from "./install-card";
import { SettingsCard } from "./settings-card";
import { StatusCard } from "./status-card";
import { PAGE_HEAD, PAGE_ROOT } from "./shapes";

// =============================================================================
// SmartDNS — the /local-network/smartdns page shell
// =============================================================================
// Three cards, in the order a reader asks:
//
//   1. Status    what is it doing (and, when there is no package, what this is)
//   2. Settings  the whole configuration, one draft, one foot
//
// The install card REPLACES the other two rather than sitting above them. There
// is nothing to report about a resolver that is not on the device, and offering
// its settings would let an operator configure something that cannot run.
//
// -----------------------------------------------------------------------------
// THE DRAFT IS DERIVED, NOT SYNCED
// -----------------------------------------------------------------------------
// The shell holds only the user's EDITS over a baseline derived from the read
// (the Custom DNS page's construction, and the reason a save's re-read re-bases
// the page without a setState-in-effect). A read that lands while the operator is
// mid-edit therefore does not silently overwrite what they typed.
//
// -----------------------------------------------------------------------------
// WHAT IS NOT HERE
// -----------------------------------------------------------------------------
// No free-text config editor, no per-domain rules, no latency table. The first
// would hand a root daemon an arbitrary directive; the second and third need
// measurements this tree cannot take without a device to take them on. What is
// here is the whole surface the backend implements, which is why every control on
// the page can actually do something.
// =============================================================================

const K = "smartdns";

const EMPTY_SETTINGS: SmartDnsSettings = {
  enabled: false,
  lan_dns: false,
  cache_size: 4096,
  prefetch: true,
  upstreams: [],
};

const SmartDnsComponent = () => {
  const { t } = useTranslation("local-network");
  const smartdns = useSmartDns();
  const { status, isLoading, isSaving, error } = smartdns;

  const [edits, setEdits] = useState<Partial<SmartDnsSettings>>({});
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);

  const baseline = status?.settings ?? null;
  const draft = useMemo<SmartDnsSettings>(
    () => ({ ...(baseline ?? EMPTY_SETTINGS), ...edits }),
    [baseline, edits],
  );

  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    },
    [],
  );

  const markSaved = useCallback(() => {
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    setSaved(true);
    savedTimer.current = window.setTimeout(() => {
      savedTimer.current = null;
      setSaved(false);
    }, 1800);
  }, []);

  // ---------------------------------------------------------------------------
  // Package operations report through the device, on their own clock
  // ---------------------------------------------------------------------------
  // The hook polls while a package action is in flight. The completion toast
  // therefore fires here, keyed to a transition rather than to a render: the ref
  // starts at the mount-time value, so a page opened after an install does not
  // announce it.
  const installedState = status?.install?.status ?? null;
  const previousInstallRef = useRef<typeof installedState>(installedState);

  useEffect(() => {
    const previous = previousInstallRef.current;
    if (installedState === previous) return;
    previousInstallRef.current = installedState;

    if (installedState === "complete" && previous === "installing") {
      toast.success(t(`${K}.toast_installed`), { id: "smartdns-package" });
    } else if (installedState === "error") {
      toast.error(t(`${K}.toast_install_failed`), { id: "smartdns-package" });
    }
  }, [installedState, t]);

  // ---------------------------------------------------------------------------
  // Edits
  // ---------------------------------------------------------------------------
  const handleChange = useCallback(
    (patch: Partial<SmartDnsSettings>) => setEdits((prev) => ({ ...prev, ...patch })),
    [],
  );
  const handleDiscard = useCallback(() => setEdits({}), []);

  const isDirty =
    baseline !== null &&
    (draft.enabled !== baseline.enabled ||
      draft.lan_dns !== baseline.lan_dns ||
      draft.cache_size !== baseline.cache_size ||
      draft.prefetch !== baseline.prefetch ||
      draft.upstreams.length !== baseline.upstreams.length ||
      draft.upstreams.some((url) => !baseline.upstreams.includes(url)));

  const blockedKey: string | null =
    draft.upstreams.length === 0 ? `${K}.blocked_no_upstreams` : null;
  const canApply = baseline !== null && isDirty && blockedKey === null && !isSaving;

  // ---------------------------------------------------------------------------
  // Apply
  // ---------------------------------------------------------------------------
  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!canApply) {
        if (blockedKey !== null) toast.error(t(blockedKey));
        return;
      }

      const result = await smartdns.save(draft);
      if (result.ok) {
        setEdits({});
        markSaved();
        toast.success(
          t(draft.lan_dns ? `${K}.toast_saved_lan` : `${K}.toast_saved`),
        );
      } else if (result.code !== null || result.error !== null) {
        toast.error(
          resolveErrorMessage(
            t,
            result.code,
            result.error,
            t(`${K}.toast_save_failed`),
          ),
        );
      }
    },
    [canApply, blockedKey, draft, markSaved, smartdns, t],
  );

  const handleInstall = useCallback(async () => {
    const result = await smartdns.install();
    if (!result.ok && (result.code !== null || result.error !== null)) {
      toast.error(
        resolveErrorMessage(t, result.code, result.error, t(`${K}.toast_install_failed`)),
      );
    }
  }, [smartdns, t]);

  const handleRemove = useCallback(async () => {
    const result = await smartdns.uninstall();
    if (result.ok) {
      toast.success(t(`${K}.toast_removed`), { id: "smartdns-package" });
    } else if (result.code !== null || result.error !== null) {
      toast.error(
        resolveErrorMessage(t, result.code, result.error, t(`${K}.toast_remove_failed`)),
      );
    }
  }, [smartdns, t]);

  const showInstall = status !== null && !status.installed;

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
          <div className={PAGE_HEAD.ACTIONS}>
            <Button
              type="button"
              variant="tonal-neutral"
              size="action"
              onClick={smartdns.refresh}
              disabled={isLoading}
            >
              <RefreshCcwIcon className="size-4" aria-hidden="true" />
              {t(`${K}.refresh`)}
            </Button>
          </div>
        </div>
      </motion.div>

      <motion.div variants={staggerItem}>
        {showInstall ? (
          <InstallCard
            install={status?.install ?? null}
            isInstalling={smartdns.isInstalling}
            error={error}
            onInstall={() => {
              void handleInstall();
            }}
          />
        ) : (
          <StatusCard
            status={status}
            isLoading={isLoading}
            isRemoving={smartdns.isStartingInstall}
            error={error}
            onRefresh={smartdns.refresh}
            onRemove={() => {
              void handleRemove();
            }}
          />
        )}
      </motion.div>

      {/* No settings to edit until the binary exists. */}
      {showInstall ? null : (
        <motion.div variants={staggerItem}>
          <SettingsCard
            status={status}
            draft={draft}
            isLoading={isLoading}
            isSaving={isSaving}
            saved={saved}
            isDirty={isDirty}
            canApply={canApply}
            blockedKey={blockedKey}
            onChange={handleChange}
            onDiscard={handleDiscard}
            onSubmit={handleSubmit}
          />
        </motion.div>
      )}
    </motion.div>
  );
};

export default SmartDnsComponent;
