"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { CircleAlertIcon, Loader2Icon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import { SaveButton } from "@/components/ui/save-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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

import { useWebPort } from "@/hooks/use-web-port";
import { originForPorts, waitForOrigin } from "@/lib/web-port";
import { cn } from "@/lib/utils";

import { ConditionBlock } from "../condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION_PANEL,
  GROUP_FILL,
  PORT_FIELD,
  PORT_GRID,
  ROW,
  ROW_GROUP,
  SKELETON_HARDWARE,
} from "../shapes";

// =============================================================================
// Web Port — the HTTP / HTTPS ports QManager (and LuCI, same server) listen on
// =============================================================================
// Saving is self-severing: the server restarts on the new ports about 1 s
// after replying, and rolls itself back if it cannot bind them. The card then
// waits for the new origin and moves the browser there; that navigation is
// the success signal, so only a failure toasts. SSH twin: qmanager_web_port.
//
// Lives on /system-settings/device-access, a two-column page, so on a desktop
// the card is half width: the two port rows stack (`PORT_GRID`), each key left
// and value right.
// =============================================================================

/** Where the browser lands after a move: this card's own page on the new origin. */
const LANDING_PATH = "/system-settings/device-access/";

type Phase = "idle" | "moving";

function parsePort(raw: string): number | null {
  if (!/^\d{1,5}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 65535 ? n : null;
}

const WebPortCard = () => {
  const { t } = useTranslation("system-settings");
  const { state, isLoading, isSaving, save, refresh } = useWebPort();
  const httpId = useId();
  const httpsId = useId();

  const [httpDraft, setHttpDraft] = useState("");
  const [httpsDraft, setHttpsDraft] = useState("");
  const [seen, setSeen] = useState<string | null>(null);
  const savedKey = state ? `${state.httpPort}/${state.httpsPort}` : null;
  if (savedKey !== seen) {
    setSeen(savedKey);
    setHttpDraft(state ? String(state.httpPort) : "");
    setHttpsDraft(state ? String(state.httpsPort) : "");
  }

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");

  const httpPort = parsePort(httpDraft);
  const httpsPort = parsePort(httpsDraft);
  const dirty =
    state !== null &&
    (httpDraft !== String(state.httpPort) || httpsDraft !== String(state.httpsPort));
  const invalid = httpPort === null || httpsPort === null;
  const same = !invalid && httpPort === httpsPort;
  const canSave = dirty && !invalid && !same && phase === "idle";

  const target = canSave || phase === "moving"
    ? originForPorts(httpPort ?? 0, httpsPort ?? 0)
    : "";

  const discard = () => {
    if (!state) return;
    setHttpDraft(String(state.httpPort));
    setHttpsDraft(String(state.httpsPort));
  };

  const handleSave = async () => {
    setConfirmOpen(false);
    if (httpPort === null || httpsPort === null) return;
    const result = await save(httpPort, httpsPort);
    if (!result.ok) {
      toast.error(result.error ?? t("web_port.toast_failed"));
      return;
    }
    if (!result.moving) {
      toast.success(t("web_port.toast_unchanged"));
      return;
    }
    setPhase("moving");
    const origin = originForPorts(result.httpPort ?? httpPort, result.httpsPort ?? httpsPort);
    if (await waitForOrigin(origin)) {
      window.location.assign(`${origin}${LANDING_PATH}`);
      return;
    }
    // The server rolled back (or the new port is unreachable from here).
    setPhase("idle");
    toast.error(t("web_port.toast_unreachable"));
    refresh();
  };

  const status =
    phase === "moving" ? (
      <span className="inline-flex items-center gap-2 font-medium">
        <Loader2Icon className="size-4 motion-safe:animate-spin" aria-hidden="true" />
        {t("web_port.moving", { origin: target })}
      </span>
    ) : dirty && invalid ? (
      <span className="text-destructive-on-surface font-medium">{t("web_port.invalid")}</span>
    ) : same ? (
      <span className="text-destructive-on-surface font-medium">{t("web_port.same")}</span>
    ) : dirty ? (
      <span className="font-medium">{t("web_port.pending", { origin: target })}</span>
    ) : null;

  const header = (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>{t("web_port.card_title")}</CardTitle>
      <CardDescription className={CARD_DESC}>
        {t("web_port.card_description")}
      </CardDescription>
    </CardHeader>
  );

  if (isLoading && state === null) {
    return (
      <Card className={CARD_SHELL} aria-hidden="true">
        {header}
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          <div className={cn(ROW_GROUP, GROUP_FILL, PORT_GRID)}>
            {[0, 1].map((i) => (
              <div key={i} className={ROW.ROOT}>
                <div className={ROW.TEXT}>
                  <Skeleton className={cn(SKELETON_HARDWARE.LABEL, "w-24")} />
                </div>
                <div className={ROW.CONTROL}>
                  <Skeleton className={SKELETON_HARDWARE.FIELD} />
                </div>
              </div>
            ))}
          </div>
          <CardFoot
            liveStatus={false}
            actions={<Skeleton className={SKELETON_HARDWARE.ACTION} />}
          />
        </CardContent>
      </Card>
    );
  }

  if (state === null) {
    return (
      <Card className={CARD_SHELL}>
        {header}
        <CardContent className={cn(CARD_PAD, CARD_BODY)}>
          <ConditionBlock
            tone="destructive"
            glyph={CircleAlertIcon}
            ariaRole="alert"
            title={t("web_port.error_title")}
            description={t("web_port.error_description")}
            onRetry={refresh}
            retryLabel={t("actions.retry", { ns: "common" })}
            className={CONDITION_PANEL.SCREEN}
          />
        </CardContent>
      </Card>
    );
  }

  const fieldsDisabled = isSaving || phase === "moving";

  return (
    <Card className={CARD_SHELL}>
      {header}
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        <div className={cn(ROW_GROUP, GROUP_FILL, PORT_GRID)}>
          <div className={ROW.ROOT}>
            <div className={ROW.TEXT}>
              <label htmlFor={httpId} className={ROW.LABEL}>
                {t("web_port.http_label")}
              </label>
            </div>
            <div className={ROW.CONTROL}>
              <Input
                id={httpId}
                type="number"
                inputMode="numeric"
                host="container"
                min={1}
                max={65535}
                step={1}
                className={PORT_FIELD}
                value={httpDraft}
                disabled={fieldsDisabled}
                aria-invalid={dirty && (httpPort === null || same) ? true : undefined}
                onChange={(e) => setHttpDraft(e.target.value.trim())}
              />
            </div>
          </div>
          <div className={ROW.ROOT}>
            <div className={ROW.TEXT}>
              <label htmlFor={httpsId} className={ROW.LABEL}>
                {t("web_port.https_label")}
              </label>
            </div>
            <div className={ROW.CONTROL}>
              <Input
                id={httpsId}
                type="number"
                inputMode="numeric"
                host="container"
                min={1}
                max={65535}
                step={1}
                className={PORT_FIELD}
                value={httpsDraft}
                disabled={fieldsDisabled}
                aria-invalid={dirty && (httpsPort === null || same) ? true : undefined}
                onChange={(e) => setHttpsDraft(e.target.value.trim())}
              />
            </div>
          </div>
        </div>

        <CardFoot
          status={status}
          actions={
            <>
              <Button
                type="button"
                variant="ghost"
                size="action"
                onClick={discard}
                disabled={!dirty || fieldsDisabled}
              >
                {t("actions.discard", { ns: "common" })}
              </Button>
              <SaveButton
                onClick={() => setConfirmOpen(true)}
                isSaving={fieldsDisabled}
                saved={false}
                label={t("actions.apply", { ns: "common" })}
                disabled={!canSave}
                size="action"
              />
            </>
          }
        />
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("web_port.confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("web_port.confirm_description", { origin: target })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleSave();
              }}
            >
              {t("web_port.confirm_action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default WebPortCard;
