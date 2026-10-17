"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  CheckCircle2Icon,
  CopyIcon,
  Loader2Icon,
  PackageIcon,
  RefreshCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import type { InstallResult } from "@/types/video-optimizer";

import { ConditionBlock } from "./condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_HEAD,
  CARD_HEAD_TEXT,
  CARD_TITLE,
  COMMAND,
  HERO_PAD,
  HERO_SHELL,
  NOTICE,
  NOTICE_BODY,
  NOTICE_GLYPH,
  NOTICE_TONE,
  PILL_REST,
  RAIL,
} from "./shapes";

// -----------------------------------------------------------------------------
// Install — the not-installed hero. The only card on this shape.
// -----------------------------------------------------------------------------

/** One labelled machine-voice row for the manual route. */
function CommandRow({ command }: { command: string }) {
  const { t } = useTranslation("monitoring");

  const copy = async () => {
    if (await copyText(command)) {
      toast.success(t("netbird.toast.copied"));
    } else {
      toast.error(t("netbird.toast.copyFailed"));
    }
  };

  return (
    <div className={COMMAND.ROOT}>
      <span className={COMMAND.LABEL}>{t("netbird.install.manualLabel")}</span>
      <div className={COMMAND.BOX}>
        <code className={COMMAND.TEXT}>{command}</code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={copy}
          className={COMMAND.COPY}
          aria-label={t("netbird.install.copyCommand")}
        >
          <CopyIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function InstallCard({
  installResult,
  runInstall,
  onRefresh,
  installHint,
}: {
  installResult: InstallResult;
  runInstall: () => Promise<void>;
  onRefresh: () => void;
  installHint?: string;
}) {
  const { t } = useTranslation("monitoring");
  const running = installResult.status === "running";
  const command = installHint || t("netbird.install.manualCommand");

  // One toast per finished install, fired when a run we watched ends. A result
  // that was already terminal on mount never toasts.
  const prevStatus = React.useRef(installResult.status);
  React.useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = installResult.status;
    if (prev !== "running") return;
    if (installResult.status === "complete") {
      toast.success(t("netbird.toast.installed"), { id: "netbird-install" });
    } else if (installResult.status === "error") {
      toast.error(installResult.message || t("netbird.toast.installFailed"), {
        id: "netbird-install",
      });
    }
  }, [installResult.status, installResult.message, t]);

  return (
    <Card className={HERO_SHELL}>
      <CardHeader className={cn(HERO_PAD, CARD_HEAD)}>
        <div className={CARD_HEAD_TEXT}>
          <CardTitle className={CARD_TITLE}>
            {t("netbird.install.title")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t("netbird.install.description")}
          </CardDescription>
        </div>
      </CardHeader>

      {/* No card-level `aria-live`: the notices below are already live regions. */}
      <CardContent className={cn(HERO_PAD, CARD_BODY)}>
        <ConditionBlock
          tone="muted"
          icon={PackageIcon}
          title={t("netbird.install.conditionTitle")}
          description={t("netbird.install.conditionDescription")}
        />

        {installResult.status === "complete" ? (
          <div role="status" className={cn(NOTICE, NOTICE_TONE.success)}>
            <CheckCircle2Icon className={NOTICE_GLYPH} />
            <span className={NOTICE_BODY}>
              {installResult.message ?? t("netbird.install.done")}
            </span>
          </div>
        ) : null}

        {installResult.status === "error" ? (
          <div role="alert" className={cn(NOTICE, NOTICE_TONE.destructive)}>
            <TriangleAlertIcon className={NOTICE_GLYPH} />
            <span className={NOTICE_BODY}>
              {installResult.message || t("netbird.install.failed")}
              {installResult.detail ? (
                <span className="mt-0.5 block">{installResult.detail}</span>
              ) : null}
            </span>
          </div>
        ) : null}

        <div className={cn(RAIL, "justify-center")}>
          <Button
            type="button"
            size="action"
            onClick={() => runInstall()}
            disabled={running}
          >
            {running ? (
              <Loader2Icon className="size-4 motion-safe:animate-spin" />
            ) : (
              <PackageIcon className="size-4" />
            )}
            {/* Never the backend's own message: a control's label has a width
                contract, and this surface ships in five locales. */}
            {running
              ? t("netbird.install.installing")
              : t("netbird.install.install")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="action"
            className={PILL_REST}
            onClick={onRefresh}
            disabled={running}
          >
            <RefreshCcwIcon className="size-4" />
            {t("netbird.install.checkAgain")}
          </Button>
        </div>

        <CommandRow command={command} />
      </CardContent>
    </Card>
  );
}
