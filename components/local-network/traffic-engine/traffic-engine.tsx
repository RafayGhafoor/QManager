"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { RefreshCcwIcon, TriangleAlertIcon } from "lucide-react";
import { useMotionReduced } from "@/components/motion-preference";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HintIcon } from "@/components/ui/hint-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useVideoOptimizer } from "@/hooks/use-video-optimizer";
import { useTrafficMasquerade } from "@/hooks/use-traffic-masquerade";
import { useTtlSettings } from "@/hooks/use-ttl-settings";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import {
  DUR,
  EASE_STANDARD,
  staggerContainer,
  staggerItem,
} from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { MutationResult } from "@/types/mutation-result";

import { EngineStatusCard, EngineStatusSkeleton } from "./engine-status-card";
import { VideoOptimizerPanel } from "./video-optimizer-panel";
import { MasqueradePanel, DEFAULT_SNI_DOMAIN } from "./masquerade-panel";
import { CdnHostlistCard, HostlistSkeleton } from "./cdn-hostlist-card";
import { EngineOnboarding } from "./engine-onboarding";
import { EngineRemoveRow } from "./engine-advanced";
import { ResultAlert } from "./result-alert";
import {
  CARD_BODY,
  CARD_PAD,
  CARD_SHELL,
  COLS,
  CONDITION,
  CONDITION_TONE,
  HEADER_PILL,
  HERO_SHELL,
  PAGE_HEAD,
  PAGE_ROOT,
  PILL_GLYPH,
  SKELETON,
  STACK,
  TAB_DOT,
} from "./shapes";

export type ViewMode = "video" | "masquerade";

/**
 * An in-flight engine toggle. `start` = idle → on, `stop` = on → idle,
 * `switch` = takeover (stop one mode, start the other). Drives the status
 * card's busy chip and suppresses the remove row through the poll gap so the
 * destructive affordance never flashes mid-transition.
 */
export type EngineTransition = "start" | "stop" | "switch";

type Pending = { kind: EngineTransition; target: ViewMode | null } | null;

/**
 * Tracks per-poll deltas of a cumulative counter to derive a live pkt/s rate.
 * Resets cleanly when the engine stops. 1s poll cadence means each delta ≈
 * packets/second. Adjust-state-during-render (no effect, no ref) so the React
 * compiler lint passes and there is no update loop.
 */
function usePacketRate(packets: number | undefined, running: boolean) {
  const [last, setLast] = useState(0);
  const [prev, setPrev] = useState<{ packets: number | null; running: boolean }>(
    { packets: null, running: false },
  );

  if (running !== prev.running) {
    setPrev({ packets: running ? packets ?? null : null, running });
    if (!running && last) setLast(0);
  } else if (running && packets !== undefined && packets !== prev.packets) {
    const base = prev.packets;
    setPrev({ packets, running });
    if (base !== null) setLast(Math.max(0, packets - base));
  }

  return last;
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

/**
 * Page-level loading placeholder. Mirrors the loaded grid exactly: column 1
 * stacks status, tabs and the mode card; column 2 reserves the hostlist, but
 * only when the initial mode will render it.
 */
function PageSkeleton({ showHostlist }: { showHostlist: boolean }) {
  return (
    <div className={COLS} aria-hidden="true">
      <div className={STACK}>
        <EngineStatusSkeleton />
        <Skeleton className={SKELETON.TABS} />
        <Card className={CARD_SHELL}>
          <CardContent className={`${CARD_PAD} ${CARD_BODY}`}>
            <Skeleton className={SKELETON.TITLE} />
            <Skeleton className={SKELETON.SETTING} />
            <Skeleton className={SKELETON.SETTING} />
            <Skeleton className={SKELETON.FIELD} />
          </CardContent>
        </Card>
      </div>
      {showHostlist ? <HostlistSkeleton /> : null}
    </div>
  );
}

type PendingTakeover = { target: ViewMode; apply: () => void } | null;

export default function TrafficEngine() {
  const { t } = useTranslation("local-network");
  const router = useRouter();
  const searchParams = useSearchParams();
  const reduceMotion = useMotionReduced();

  const vo = useVideoOptimizer();
  const masq = useTrafficMasquerade();
  // Owned here (not in the row) so it survives tab switches: the row's panel
  // unmounts on every Video/Masquerade flip, which would otherwise refetch
  // TTL and flash a spinner mid-card. Folded into the page skeleton below.
  const ttl = useTtlSettings();

  const initialMode: ViewMode =
    searchParams.get("mode") === "masquerade" ? "masquerade" : "video";
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode);
  const [pendingTakeover, setPendingTakeover] = useState<PendingTakeover>(null);
  // Slide direction for the tab crossfade: +1 entering Masquerade (right tab),
  // -1 entering Video (left tab).
  const [dir, setDir] = useState(0);
  // In-flight engine toggle, or null when settled. Optimistic: set the instant
  // the user acts and held until the next poll confirms the destination state.
  const [pending, setPending] = useState<Pending>(null);

  const setViewModeAndUrl = useCallback(
    (mode: string) => {
      if (mode !== "video" && mode !== "masquerade") return;
      setDir(mode === "masquerade" ? 1 : -1);
      setViewMode(mode);
      const params = new URLSearchParams(searchParams.toString());
      if (mode === "masquerade") params.set("mode", "masquerade");
      else params.delete("mode");
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [router, searchParams],
  );

  // --- Derived engine truth (mutex guarantees at most one running) ---
  const voRunning = vo.settings?.status === "running";
  const masqRunning = masq.settings?.status === "running";
  const activeMode: ViewMode | null = voRunning
    ? "video"
    : masqRunning
      ? "masquerade"
      : null;

  const installed = vo.settings?.binary_installed ?? false;
  const kernelOk = vo.settings?.kernel_module_loaded ?? false;
  const canEnable = installed && kernelOk;

  const engineSaving = vo.isSaving || masq.isSaving;

  // Clear the pending transition once the poll confirms the destination state.
  // Adjust-during-render: no effect, no loop.
  if (pending) {
    const settled =
      pending.kind === "stop"
        ? activeMode === null && !engineSaving
        : activeMode === pending.target;
    if (settled) setPending(null);
  }

  const engineBusy = pending !== null;

  const voRate = usePacketRate(vo.settings?.packets_processed, voRunning);
  const masqRate = usePacketRate(masq.settings?.packets_processed, masqRunning);

  const refreshBoth = useCallback(() => {
    vo.refresh(true);
    masq.refresh(true);
  }, [vo, masq]);

  /** One toast per finished save, the reason read from the returned result. */
  const toastResult = useCallback(
    (result: MutationResult, successKey: string, failKey: string) => {
      if (result.ok) {
        toast.success(t(successKey));
      } else {
        toast.error(resolveErrorMessage(t, result.code, result.error, t(failKey)));
      }
    },
    [t],
  );

  // --- Save handlers (single call; the backend takes over on its own) ---
  const saveVideo = useCallback(
    async (enabled: boolean, desyncRepeats: number): Promise<boolean> => {
      // Re-applying a draft to the mode that already runs is not a transition.
      const reapply = enabled && voRunning;
      if (!reapply) {
        setPending(
          enabled
            ? { kind: masqRunning ? "switch" : "start", target: "video" }
            : { kind: "stop", target: null },
        );
      }
      const result = await vo.saveSettings({
        enabled,
        desync_repeats: desyncRepeats,
      });
      if (!result.ok) setPending(null);
      toastResult(
        result,
        reapply
          ? "traffic_engine.toast_applied"
          : enabled
            ? "traffic_engine.toast_video_enabled"
            : "traffic_engine.toast_video_disabled",
        "video_optimizer.toast_error_apply",
      );
      // Refresh both even on failure: a takeover may have half-landed.
      refreshBoth();
      return result.ok;
    },
    [vo, refreshBoth, toastResult, masqRunning, voRunning],
  );

  const saveMasq = useCallback(
    async (enabled: boolean, sni: string): Promise<boolean> => {
      const reapply = enabled && masqRunning;
      if (!reapply) {
        setPending(
          enabled
            ? { kind: voRunning ? "switch" : "start", target: "masquerade" }
            : { kind: "stop", target: null },
        );
      }
      const result = await masq.saveSettings(enabled, sni);
      if (!result.ok) setPending(null);
      toastResult(
        result,
        reapply
          ? "traffic_engine.toast_applied"
          : enabled
            ? "traffic_engine.toast_masquerade_enabled"
            : "traffic_engine.toast_masquerade_disabled",
        "masquerade.toast_error_apply",
      );
      refreshBoth();
      return result.ok;
    },
    [masq, refreshBoth, toastResult, voRunning, masqRunning],
  );

  // Enabling a mode while the OTHER mode owns the engine requires a confirm.
  const requestEnableVideo = useCallback(
    (desyncRepeats: number) => {
      if (masqRunning) {
        setPendingTakeover({
          target: "video",
          apply: () => void saveVideo(true, desyncRepeats),
        });
        return;
      }
      void saveVideo(true, desyncRepeats);
    },
    [masqRunning, saveVideo],
  );

  const requestEnableMasq = useCallback(
    (sni: string) => {
      if (voRunning) {
        setPendingTakeover({
          target: "masquerade",
          apply: () => void saveMasq(true, sni),
        });
        return;
      }
      void saveMasq(true, sni);
    },
    [voRunning, saveMasq],
  );

  // Safety net: if the poll never confirms (backend hiccup), don't strand the
  // status card on a busy chip forever. setState only in the timer callback.
  useEffect(() => {
    if (pending === null) return;
    const id = setTimeout(() => setPending(null), 8000);
    return () => clearTimeout(id);
  }, [pending]);

  const videoLabel = t("traffic_engine.mode_video");
  const masqueradeLabel = t("traffic_engine.mode_masquerade");

  // --- State machine ---
  // Gate on ttl too so the Bypass Hotspot row's first fetch is covered by the
  // page skeleton; all three are fast local reads fired in parallel on mount.
  const isLoading = vo.isLoading || masq.isLoading || ttl.isLoading;
  const showSkeleton = useDelayedFlag(isLoading);
  const loadError = (vo.error && !vo.settings) || (masq.error && !masq.settings);
  const anyRunning = voRunning || masqRunning;

  // The tab switch: the outgoing panel slides and fades one way while the
  // incoming one enters from the other side. Panel and hostlist share one
  // timeline. Transforms only, and no `layout`, so 1s polls never re-ease
  // the column height.
  const panelVariants = {
    enter: (d: number) => ({ opacity: 0, x: reduceMotion ? 0 : d * 24 }),
    center: { opacity: 1, x: 0 },
    exit: (d: number) => ({ opacity: 0, x: reduceMotion ? 0 : d * -24 }),
  };
  const panelTransition = reduceMotion
    ? { duration: 0 }
    : { duration: DUR.quick, ease: EASE_STANDARD };

  let body: React.ReactNode;
  if (isLoading) {
    body = showSkeleton ? (
      <PageSkeleton showHostlist={initialMode === "video"} />
    ) : null;
  } else if (loadError) {
    const tone = CONDITION_TONE.destructive;
    body = (
      <Card className={HERO_SHELL}>
        <CardContent className={CARD_PAD}>
          <div role="alert" className={cn(CONDITION.ROOT, tone.ROOT)}>
            <span aria-hidden className={cn(CONDITION.DISC, tone.DISC)}>
              <TriangleAlertIcon className={CONDITION.GLYPH} />
            </span>
            <h2 className={CONDITION.TITLE}>
              {t("traffic_engine.error_load_title")}
            </h2>
            <p className={CONDITION.DESC}>{t("traffic_engine.error_load_failed")}</p>
            <div className={CONDITION.ACTIONS}>
              <Button
                variant="ghost"
                size="action"
                onClick={() => refreshBoth()}
                className={tone.ACTION}
              >
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
        onRefresh={() => vo.refresh()}
      />
    );
  } else {
    body = (
      <div className={COLS}>
        {/* Column 1: engine status, the prerequisite notice, mode controls. */}
        <div className={STACK}>
          <EngineStatusCard
            activeMode={activeMode}
            transition={pending?.kind}
            uptime={
              voRunning
                ? vo.settings?.uptime ?? "0s"
                : masq.settings?.uptime ?? "0s"
            }
            packets={
              voRunning
                ? vo.settings?.packets_processed ?? 0
                : masq.settings?.packets_processed ?? 0
            }
            rate={voRunning ? voRate : masqRate}
            sniDomain={masq.settings?.sni_domain}
            footer={
              // Only in the settled-idle state: a transition's poll gap briefly
              // reads as idle and would flash the destructive row in and out.
              !anyRunning && !engineBusy ? (
                <EngineRemoveRow
                  isUninstalling={vo.isUninstalling}
                  onUninstall={vo.runUninstall}
                  onUninstalled={refreshBoth}
                />
              ) : undefined
            }
          />

          {!kernelOk ? (
            <ResultAlert tone="warning">
              <span className="inline-flex items-start gap-1.5">
                {t("traffic_engine.alert_kernel_module_missing")}
                <HintIcon label={t("traffic_engine.aria_kernel_module_hint")}>
                  {t("traffic_engine.kernel_module_hint")}
                </HintIcon>
              </span>
            </ResultAlert>
          ) : null}

          <Tabs value={viewMode} onValueChange={setViewModeAndUrl}>
            <TabsList
              className="grid w-full grid-cols-2"
              aria-label={t("traffic_engine.aria_mode_selector")}
            >
              <TabsTrigger value="video">
                {videoLabel}
                {voRunning ? <span className={TAB_DOT} aria-hidden="true" /> : null}
              </TabsTrigger>
              <TabsTrigger value="masquerade">
                {masqueradeLabel}
                {masqRunning ? <span className={TAB_DOT} aria-hidden="true" /> : null}
              </TabsTrigger>
            </TabsList>

            {/* One keyed panel crossfades over the other (relative wrapper so
                the popLayout exit can overlay). role=tabpanel keeps the tab
                semantics Radix's TabsContent would otherwise provide. */}
            <div className="relative mt-4">
              <AnimatePresence mode="popLayout" initial={false} custom={dir}>
                <motion.div
                  key={viewMode}
                  role="tabpanel"
                  custom={dir}
                  variants={panelVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={panelTransition}
                  className={STACK}
                >
                  {viewMode === "video" ? (
                    <VideoOptimizerPanel
                      hook={vo}
                      ttl={ttl}
                      running={voRunning}
                      otherOwns={masqRunning}
                      modeLabel={videoLabel}
                      otherModeLabel={masqueradeLabel}
                      canEnable={canEnable}
                      transitioning={engineBusy}
                      onEnable={requestEnableVideo}
                      onDisable={() =>
                        void saveVideo(false, vo.settings?.desync_repeats ?? 1)
                      }
                      onApply={(n) => saveVideo(true, n)}
                    />
                  ) : (
                    <MasqueradePanel
                      hook={masq}
                      ttl={ttl}
                      running={masqRunning}
                      otherOwns={voRunning}
                      modeLabel={masqueradeLabel}
                      otherModeLabel={videoLabel}
                      canEnable={canEnable}
                      transitioning={engineBusy}
                      onEnable={requestEnableMasq}
                      onDisable={() =>
                        void saveMasq(
                          false,
                          masq.settings?.sni_domain ?? DEFAULT_SNI_DOMAIN,
                        )
                      }
                      onApply={(sni) => saveMasq(true, sni)}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </Tabs>
        </div>

        {/* Column 2: the CDN hostlist is a companion to Video Optimizer; on
            the Masquerade tab this column is intentionally empty. It stretches
            to column 1's height so the bottom edges line up. */}
        <AnimatePresence mode="wait" initial={false}>
          {viewMode === "video" ? (
            <motion.div
              key="hostlist"
              className="h-full"
              initial={reduceMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
              transition={panelTransition}
            >
              <CdnHostlistCard />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    );
  }

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
            <h1 className={PAGE_HEAD.TITLE}>{t("traffic_engine.page_title")}</h1>
            <p className={PAGE_HEAD.DESC}>{t("traffic_engine.page_description")}</p>
          </div>
          <div className={PAGE_HEAD.ACTIONS}>
            <Button
              type="button"
              variant="ghost"
              size="action"
              onClick={() => refreshBoth()}
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

      {/* Takeover confirm: switching which mode owns the single engine */}
      <AlertDialog
        open={pendingTakeover !== null}
        onOpenChange={(open) => !open && setPendingTakeover(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingTakeover &&
                t("traffic_engine.takeover_title", {
                  mode:
                    pendingTakeover.target === "video"
                      ? videoLabel
                      : masqueradeLabel,
                })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTakeover &&
                t("traffic_engine.takeover_desc", {
                  enabling:
                    pendingTakeover.target === "video"
                      ? videoLabel
                      : masqueradeLabel,
                  stopping:
                    pendingTakeover.target === "video"
                      ? masqueradeLabel
                      : videoLabel,
                })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                pendingTakeover?.apply();
                setPendingTakeover(null);
              }}
            >
              {pendingTakeover &&
                t("traffic_engine.takeover_confirm", {
                  mode:
                    pendingTakeover.target === "video"
                      ? videoLabel
                      : masqueradeLabel,
                })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
