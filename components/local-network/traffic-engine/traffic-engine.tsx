"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { toast } from "sonner";
import { RefreshCcwIcon, TriangleAlertIcon } from "lucide-react";
import { useMotionReduced } from "@/components/motion-preference";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { HintIcon } from "@/components/ui/hint-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { useCdnHostlist } from "@/hooks/use-cdn-hostlist";
import { useTrafficMasquerade } from "@/hooks/use-traffic-masquerade";
import { useTtlSettings } from "@/hooks/use-ttl-settings";
import { useVideoOptimizer } from "@/hooks/use-video-optimizer";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { validateDomainKey } from "@/lib/validate-domain";
import type { MutationResult } from "@/types/mutation-result";

import {
  EngineCard,
  type EngineChoice,
  type EngineMode,
  type EngineTransition,
} from "./engine-card";
import { EngineOnboarding } from "./engine-onboarding";
import { MasqueradeCard, VideoOptimizerCard, modeCardId } from "./mode-card";
import { CHART_SAMPLES } from "./packet-chart";
import {
  CARD_ACTION,
  CARD_BODY,
  CARD_HEAD,
  CARD_PAD,
  CARD_SHELL,
  CONDITION,
  CONDITION_TONE,
  CONTROL_COL,
  ENGINE_GRID,
  ENGINE_ROWS,
  HEADER_PILL,
  HERO_PAD,
  HERO_SHELL,
  LIVE,
  PAGE_HEAD,
  PAGE_ROOT,
  PAIR,
  PILL_GLYPH,
  ROWS,
  SKELETON,
  STACK,
} from "./shapes";

/** Fallback disguise domain when none is configured. */
export const DEFAULT_SNI_DOMAIN = "speedtest.net";

/** How long a `?mode=` deep link keeps its card highlighted. */
const HIGHLIGHT_MS = 1600;

/** How long a transition may wait for the poll to confirm it. */
const PENDING_TIMEOUT_MS = 8000;

type Pending = { kind: EngineTransition; target: EngineMode | null } | null;

const EMPTY_HISTORY: readonly (number | null)[] = Array(CHART_SAMPLES).fill(null);

/**
 * The engine's outbound rate over the last minute, one sample per poll. The
 * hook refetches every second while a mode runs and every fetch is a new
 * object, so the object's identity is the tick. A stop or a mode switch
 * starts the history over: the two modes' counters are not one series.
 * Adjust-during-render (no effect, no ref), so there is no update loop.
 */
function usePacketHistory(sample: object | null, mode: EngineMode | null, packets: number) {
  const [state, setState] = useState<{
    sample: object | null;
    mode: EngineMode | null;
    last: number | null;
    history: readonly (number | null)[];
  }>({ sample: null, mode: null, last: null, history: EMPTY_HISTORY });

  if (mode !== state.mode) {
    setState({ sample, mode, last: mode ? packets : null, history: EMPTY_HISTORY });
  } else if (mode && sample && sample !== state.sample) {
    const rate = state.last === null ? null : Math.max(0, packets - state.last);
    setState({
      sample,
      mode,
      last: packets,
      history: [...state.history.slice(1), rate],
    });
  }

  return state.history;
}

/**
 * Returns true only once `active` has held for `delayMs`. Suppresses the
 * flash-of-skeleton on fast loads (this app runs ON the modem, so loads are
 * routinely sub-100ms). setState lives only in the timer callback and the
 * cleanup, clear of the React-compiler setState-in-effect rule.
 */
function useDelayedFlag(active: boolean, delayMs = 160) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setShown(true), delayMs);
    return () => {
      clearTimeout(id);
      setShown(false);
    };
  }, [active, delayMs]);
  return active && shown;
}

/** The loading placeholder: the Engine card, then the mode pair, at their loaded geometry. */
function PageSkeleton() {
  const header = (pad: string, badge: boolean) => (
    <CardHeader className={cn(pad, CARD_HEAD)}>
      <Skeleton className={SKELETON.TITLE} />
      <Skeleton className={SKELETON.DESC} />
      {badge ? (
        <div data-slot="card-action" className={cn("col-start-2 row-span-2 row-start-1", CARD_ACTION)}>
          <Skeleton className={SKELETON.BADGE} />
        </div>
      ) : null}
    </CardHeader>
  );
  return (
    <div className={STACK} aria-hidden="true">
      <Card className={HERO_SHELL}>
        {header(HERO_PAD, true)}
        <CardContent className={cn(HERO_PAD, ENGINE_GRID)}>
          <div className={CONTROL_COL}>
            <Skeleton className={SKELETON.LABEL} />
            <Skeleton className={SKELETON.CONTROL} />
            <div className={cn(ROWS, ENGINE_ROWS)}>
              <Skeleton className={SKELETON.ROW} />
              <Skeleton className={SKELETON.ROW} />
              <Skeleton className={SKELETON.ROW} />
            </div>
          </div>
          <div className={LIVE.ROOT}>
            <div className={LIVE.HEAD}>
              <Skeleton className={SKELETON.LEGEND} />
              <Skeleton className={SKELETON.RATE} />
            </div>
            <Skeleton className={SKELETON.CHART} />
          </div>
        </CardContent>
      </Card>
      <div className={PAIR}>
        {[0, 1].map((k) => (
          <Card key={k} className={CARD_SHELL}>
            {header(CARD_PAD, false)}
            <CardContent className={cn(CARD_PAD, CARD_BODY)}>
              <Skeleton className={SKELETON.STRIP} />
              <div className={ROWS}>
                <Skeleton className={SKELETON.ROW} />
                <Skeleton className={SKELETON.ROW} />
              </div>
              <Skeleton className={SKELETON.FIELD} />
              <Skeleton className={SKELETON.FIELD} />
              <div className="mt-auto flex min-h-16 items-center justify-between gap-4 pt-4">
                <Skeleton className={SKELETON.FOOT_STATUS} />
                <Skeleton className={SKELETON.FOOT_ACTION} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

const clampStrength = (n: number | undefined) =>
  typeof n === "number" && n >= 1 && n <= 10 ? n : 1;

export default function TrafficEngine() {
  const { t } = useTranslation("local-network");
  const searchParams = useSearchParams();
  const reduceMotion = useMotionReduced();

  const vo = useVideoOptimizer();
  const masq = useTrafficMasquerade();
  // Owned here so the Engine card's view swaps never refetch it; folded into
  // the skeleton gate so its first load is covered.
  const ttl = useTtlSettings();
  // Owned here so the Video Optimizer card's Acts on row and its hostnames
  // view read one list.
  const hostlist = useCdnHostlist();

  // --- Engine truth (the backend mutex guarantees at most one running) ---
  const voRunning = vo.settings?.status === "running";
  const masqRunning = masq.settings?.status === "running";
  const activeMode: EngineMode | null = voRunning ? "video" : masqRunning ? "masquerade" : null;
  const installed = vo.settings?.binary_installed ?? false;
  const kernelOk = vo.settings?.kernel_module_loaded ?? false;
  const engineSaving = vo.isSaving || masq.isSaving;

  // --- Saved values and their drafts. A load or save replaces the draft. ---
  const savedStrength = clampStrength(vo.settings?.desync_repeats);
  const savedDomain = masq.settings?.sni_domain || DEFAULT_SNI_DOMAIN;
  const [strength, setStrength] = useState(savedStrength);
  const [prevStrength, setPrevStrength] = useState(savedStrength);
  if (savedStrength !== prevStrength) {
    setPrevStrength(savedStrength);
    setStrength(savedStrength);
  }
  const [domain, setDomain] = useState(savedDomain);
  const [prevDomain, setPrevDomain] = useState(savedDomain);
  if (savedDomain !== prevDomain) {
    setPrevDomain(savedDomain);
    setDomain(savedDomain);
  }
  const domainErrorKey = validateDomainKey(domain.trim());
  const domainError = domainErrorKey ? t(domainErrorKey) : null;
  const domainToSend = domainError ? savedDomain : domain.trim();

  // --- In-flight engine change. Optimistic: set the instant the user acts,
  // held until the poll confirms the destination. Adjust-during-render. ---
  const [pending, setPending] = useState<Pending>(null);
  if (pending) {
    const settled =
      pending.kind === "stop"
        ? activeMode === null && !engineSaving
        : pending.kind === "apply"
          ? activeMode === pending.target && !engineSaving
          : activeMode === pending.target;
    if (settled) setPending(null);
  }
  // Safety net: a poll that never confirms must not strand the busy chip.
  useEffect(() => {
    if (pending === null) return;
    const id = setTimeout(() => setPending(null), PENDING_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [pending]);

  const shownMode: EngineChoice =
    pending && pending.kind !== "apply" ? (pending.target ?? "off") : (activeMode ?? "off");

  const runningSettings = voRunning ? vo.settings : masqRunning ? masq.settings : null;
  const history = usePacketHistory(
    runningSettings,
    activeMode,
    runningSettings?.packets_processed ?? 0,
  );

  const refreshAll = useCallback(() => {
    void vo.refresh(true);
    void masq.refresh(true);
    void ttl.refresh(true);
    void hostlist.refresh();
  }, [vo, masq, ttl, hostlist]);

  /** One toast per finished save, the reason read from the returned result. */
  const toastResult = useCallback(
    (result: MutationResult, successKey: string, failKey: string) => {
      if (result.ok) toast.success(t(successKey));
      else toast.error(resolveErrorMessage(t, result.code, result.error, t(failKey)));
    },
    [t],
  );

  /** Every engine save: mark the transition, save, toast, then refresh both modes. */
  const run = useCallback(
    async (
      next: Pending,
      save: () => Promise<MutationResult>,
      successKey: string,
      failKey: string,
    ) => {
      if (next) setPending(next);
      const result = await save();
      if (!result.ok) setPending(null);
      toastResult(result, successKey, failKey);
      // Refresh both even on failure: a switch may have half-landed.
      void vo.refresh(true);
      void masq.refresh(true);
      return result.ok;
    },
    [toastResult, vo, masq],
  );

  const onModeChange = useCallback(
    (next: EngineChoice) => {
      if (next === shownMode || pending) return;
      if (next === "off") {
        const stop: Pending = { kind: "stop", target: null };
        if (activeMode === "video") {
          void run(stop, () => vo.saveSettings({ enabled: false, desync_repeats: savedStrength }),
            "traffic_engine.toast_video_disabled", "video_optimizer.toast_error_apply");
        } else if (activeMode === "masquerade") {
          void run(stop, () => masq.saveSettings(false, savedDomain),
            "traffic_engine.toast_masquerade_disabled", "masquerade.toast_error_apply");
        }
        return;
      }
      const kind: EngineTransition = activeMode ? "switch" : "start";
      // Switching to a mode carries its draft, so an edit made while the
      // other mode ran lands with the switch.
      if (next === "video") {
        void run({ kind, target: "video" }, () => vo.saveSettings({ enabled: true, desync_repeats: strength }),
          "traffic_engine.toast_video_enabled", "video_optimizer.toast_error_apply");
      } else {
        void run({ kind, target: "masquerade" }, () => masq.saveSettings(true, domainToSend),
          "traffic_engine.toast_masquerade_enabled", "masquerade.toast_error_apply");
      }
    },
    [shownMode, pending, activeMode, run, vo, masq, savedStrength, savedDomain, strength, domainToSend],
  );

  // Apply a draft. The owner restarts on it; an idle engine stores it (a save
  // with the mode off is a stop of a stopped engine). While the other mode
  // owns the engine the foot blocks Apply: saving this mode off would stop it.
  const applyVideo = useCallback(() => {
    if (masqRunning) return Promise.resolve(false);
    return run(voRunning ? { kind: "apply", target: "video" } : null,
      () => vo.saveSettings({ enabled: voRunning, desync_repeats: strength }),
      "traffic_engine.toast_applied", "video_optimizer.toast_error_apply");
  }, [masqRunning, voRunning, run, vo, strength]);

  const applyMasquerade = useCallback(() => {
    if (voRunning || domainError) return Promise.resolve(false);
    return run(masqRunning ? { kind: "apply", target: "masquerade" } : null,
      () => masq.saveSettings(masqRunning, domain.trim()),
      "traffic_engine.toast_applied", "masquerade.toast_error_apply");
  }, [voRunning, masqRunning, domainError, run, masq, domain]);

  // --- Install ends in a toast (success or failure), never on mount. ---
  const installStatus = vo.installResult.status;
  const prevInstall = useRef(installStatus);
  useEffect(() => {
    const was = prevInstall.current;
    prevInstall.current = installStatus;
    if (was !== "running") return;
    if (installStatus === "complete") {
      toast.success(t("traffic_engine.toast_install_success"), { id: "traffic-engine-install" });
    } else if (installStatus === "error") {
      toast.error(t("traffic_engine.toast_install_error"), { id: "traffic-engine-install" });
    }
  }, [installStatus, t]);

  // --- State machine ---
  const isLoading = vo.isLoading || masq.isLoading || ttl.isLoading;
  const showSkeleton = useDelayedFlag(isLoading);
  const loadError = (vo.error && !vo.settings) || (masq.error && !masq.settings);
  const ready = !isLoading && !loadError && installed;

  // --- `?mode=` deep link: scroll to that card and highlight it a moment. ---
  const deepLink = searchParams.get("mode");
  const linkTarget: EngineMode | null =
    deepLink === "masquerade" ? "masquerade" : deepLink === "video" ? "video" : null;
  const [highlight, setHighlight] = useState<EngineMode | null>(null);
  const linkHandled = useRef(false);
  useEffect(() => {
    if (!ready || !linkTarget || linkHandled.current) return;
    linkHandled.current = true;
    const show = setTimeout(() => {
      document.getElementById(modeCardId(linkTarget))?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center",
      });
      setHighlight(linkTarget);
    }, 0);
    const hide = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [ready, linkTarget, reduceMotion]);

  let body: React.ReactNode;
  if (isLoading) {
    body = showSkeleton ? <PageSkeleton /> : null;
  } else if (loadError) {
    const tone = CONDITION_TONE.destructive;
    body = (
      <Card className={HERO_SHELL}>
        <CardContent className={CARD_PAD}>
          <div role="alert" className={cn(CONDITION.ROOT, tone.ROOT)}>
            <span aria-hidden className={cn(CONDITION.DISC, tone.DISC)}>
              <TriangleAlertIcon className={CONDITION.GLYPH} />
            </span>
            <h2 className={CONDITION.TITLE}>{t("traffic_engine.error_load_title")}</h2>
            <p className={CONDITION.DESC}>{t("traffic_engine.error_load_failed")}</p>
            <div className={CONDITION.ACTIONS}>
              <Button variant="ghost" size="action" onClick={refreshAll} className={tone.ACTION}>
                <RefreshCcwIcon aria-hidden="true" />
                {t("actions.retry", { ns: "common" })}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  } else if (!installed) {
    body = (
      <EngineOnboarding
        installResult={vo.installResult}
        onInstall={vo.runInstall}
        onRefresh={() => void vo.refresh()}
      />
    );
  } else {
    const engineBusy = pending !== null;
    const videoLabel = t("traffic_engine.mode_video");
    const masqueradeLabel = t("traffic_engine.mode_masquerade");
    body = (
      <div className={STACK}>
        {!kernelOk ? (
          <Banner
            role="degraded"
            title={t("traffic_engine.kernel_banner_title")}
            description={
              <span className="inline-flex items-center gap-1.5">
                {t("traffic_engine.kernel_banner_desc")}
                <HintIcon label={t("traffic_engine.aria_kernel_module_hint")}>
                  {t("traffic_engine.kernel_module_hint")}
                </HintIcon>
              </span>
            }
          />
        ) : null}
        <EngineCard
          shownMode={shownMode}
          activeMode={activeMode}
          transition={pending?.kind ?? null}
          kernelOk={kernelOk}
          onModeChange={onModeChange}
          uptime={(voRunning ? vo.settings?.uptime : masq.settings?.uptime) ?? "0s"}
          packets={runningSettings?.packets_processed ?? 0}
          history={history}
          sniDomain={savedDomain}
          ttl={ttl}
          isUninstalling={vo.isUninstalling}
          onUninstall={vo.runUninstall}
          onUninstalled={refreshAll}
        />
        <div className={PAIR}>
          <VideoOptimizerCard
            vo={vo}
            hostlist={hostlist}
            masqueradeOwns={masqRunning}
            active={voRunning && !engineBusy}
            owner={voRunning}
            otherOwns={masqRunning}
            busy={engineBusy}
            otherLabel={masqueradeLabel}
            highlighted={highlight === "video"}
            savedStrength={savedStrength}
            draftStrength={strength}
            onDraftChange={setStrength}
            onApply={applyVideo}
          />
          <MasqueradeCard
            masq={masq}
            active={masqRunning && !engineBusy}
            owner={masqRunning}
            otherOwns={voRunning}
            busy={engineBusy}
            otherLabel={videoLabel}
            highlighted={highlight === "masquerade"}
            savedDomain={savedDomain}
            draftDomain={domain}
            draftError={domainError}
            onDraftChange={setDomain}
            onApply={applyMasquerade}
          />
        </div>
      </div>
    );
  }

  return (
    <motion.div className={PAGE_ROOT} variants={staggerContainer} initial="hidden" animate="visible">
      <motion.div variants={staggerItem}>
        <div className={PAGE_HEAD.ROOT}>
          <div className={PAGE_HEAD.TITLES}>
            <h1 className={PAGE_HEAD.TITLE}>{t("traffic_engine.page_title")}</h1>
            <p className={PAGE_HEAD.DESC}>{t("traffic_engine.page_description")}</p>
          </div>
          <div className={PAGE_HEAD.ACTIONS}>
            <Button
              type="button"
              variant="ghost"
              size="action"
              onClick={refreshAll}
              disabled={isLoading}
              className={HEADER_PILL}
            >
              <RefreshCcwIcon
                className={cn(PILL_GLYPH, isLoading && "motion-safe:animate-spin")}
                aria-hidden="true"
              />
              {t("traffic_engine.refresh")}
            </Button>
          </div>
        </div>
      </motion.div>

      <motion.div variants={staggerItem}>{body}</motion.div>
    </motion.div>
  );
}
