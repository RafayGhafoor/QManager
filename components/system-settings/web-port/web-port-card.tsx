"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { AlertTriangleIcon, Loader2Icon, RotateCcwIcon } from "lucide-react";

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
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { SETTING_ROW, SettingRow } from "@/components/system-settings/at-engine/setting-row";

// =============================================================================
// Web Port — the HTTP / HTTPS ports QManager (and LuCI, same server) listen on
// =============================================================================
// Saving is self-severing: the server restarts on the new ports about 1 s
// after replying, and rolls itself back if it cannot bind them. The card then
// waits for the new origin and moves the browser there; that navigation is
// the success signal, so only a failure toasts. SSH twin: qmanager_web_port.
// =============================================================================

const FIELD = "w-28 tabular-nums";

type Phase = "idle" | "moving";

function parsePort(raw: string): number | null {
  if (!/^\d{1,5}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 65535 ? n : null;
}

const WebPortCard = () => {
  const { t } = useTranslation("system-settings");
  const { state, isLoading, isSaving, error, save, refresh } = useWebPort();
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
      window.location.assign(`${origin}/system-settings/`);
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
      <span className="font-medium text-destructive">{t("web_port.invalid")}</span>
    ) : same ? (
      <span className="font-medium text-destructive">{t("web_port.same")}</span>
    ) : dirty ? (
      <span className="font-medium">{t("web_port.pending", { origin: target })}</span>
    ) : null;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("web_port.card_title")}</CardTitle>
        <CardDescription>{t("web_port.card_description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && state === null ? (
          <div className="grid gap-2">
            <div className={SETTING_ROW}>
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-10 w-28 rounded-field" />
            </div>
            <div className={SETTING_ROW}>
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-10 w-28 rounded-field" />
            </div>
          </div>
        ) : error && state === null ? (
          <div className="grid gap-3">
            <Alert variant="destructive">
              <AlertTriangleIcon className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button variant="tonal-neutral" onClick={refresh} className="w-fit">
              <RotateCcwIcon className="size-4" />
              {t("actions.retry", { ns: "common" })}
            </Button>
          </div>
        ) : state ? (
          <div className="grid gap-2">
            <SettingRow label={<label htmlFor={httpId}>{t("web_port.http_label")}</label>}>
              <Input
                id={httpId}
                type="number"
                inputMode="numeric"
                host="container"
                min={1}
                max={65535}
                step={1}
                className={FIELD}
                value={httpDraft}
                disabled={isSaving || phase === "moving"}
                aria-invalid={dirty && (httpPort === null || same) ? true : undefined}
                onChange={(e) => setHttpDraft(e.target.value.trim())}
              />
            </SettingRow>
            <SettingRow label={<label htmlFor={httpsId}>{t("web_port.https_label")}</label>}>
              <Input
                id={httpsId}
                type="number"
                inputMode="numeric"
                host="container"
                min={1}
                max={65535}
                step={1}
                className={FIELD}
                value={httpsDraft}
                disabled={isSaving || phase === "moving"}
                aria-invalid={dirty && (httpsPort === null || same) ? true : undefined}
                onChange={(e) => setHttpsDraft(e.target.value.trim())}
              />
            </SettingRow>
          </div>
        ) : null}
      </CardContent>

      {state && (
        <CardFoot
          className="px-6"
          status={status}
          actions={
            <>
              <Button
                type="button"
                variant="tonal-neutral"
                size="action"
                onClick={discard}
                disabled={!dirty || isSaving || phase === "moving"}
              >
                {t("web_port.discard")}
              </Button>
              <SaveButton
                onClick={() => setConfirmOpen(true)}
                isSaving={isSaving || phase === "moving"}
                saved={false}
                label={t("actions.apply", { ns: "common" })}
                disabled={!canSave}
                size="action"
              />
            </>
          }
        />
      )}

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
