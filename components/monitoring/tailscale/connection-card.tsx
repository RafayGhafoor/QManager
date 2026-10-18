"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  CheckIcon,
  ExternalLinkIcon,
  Loader2Icon,
  LogInIcon,
  TriangleAlertIcon,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SEGMENTED, SegmentedField } from "@/components/ui/segmented-field";
import { Tag } from "@/components/ui/tag";
import type {
  TailscaleActionResult,
  TailscaleStatus,
} from "@/hooks/use-tailscale";
import { cn } from "@/lib/utils";

import { ConditionBlock } from "./condition-block";
import {
  CARD_BODY,
  CARD_DESC,
  CARD_HEAD,
  CARD_HEAD_ACTIONS,
  CARD_HEAD_TEXT,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  HEAD_TAG,
  LIVE_DOT,
  NOTICE,
  NOTICE_BODY,
  NOTICE_GLYPH,
  NOTICE_LIST,
  NOTICE_TONE,
  PILL_REST,
  RAIL,
  SKELETON,
  SWITCH_ROW,
  type TailscaleView,
} from "./shapes";

// -----------------------------------------------------------------------------
// Connection — what the link is doing, the two settings, and the action rail.
// -----------------------------------------------------------------------------

export interface ConnectionCardProps {
  view: TailscaleView;
  status: TailscaleStatus;
  isConnecting: boolean;
  isDisconnecting: boolean;
  isTogglingService: boolean;
  isTogglingBoot: boolean;
  isTogglingExitNode: boolean;
  isTogglingSsh: boolean;
  connect: () => Promise<TailscaleActionResult>;
  disconnect: () => Promise<TailscaleActionResult>;
  logout: () => Promise<TailscaleActionResult>;
  startService: () => Promise<TailscaleActionResult>;
  stopService: () => Promise<TailscaleActionResult>;
  setBootEnabled: (enabled: boolean) => Promise<TailscaleActionResult>;
  setExitNodeAdvertised: (enabled: boolean) => Promise<TailscaleActionResult>;
  setSshEnabled: (enabled: boolean) => Promise<TailscaleActionResult>;
}

/** The lucide check that SegmentedField reserves on every segment. */
const renderCheckGlyph = (className: string) => (
  <CheckIcon size={SEGMENTED.GLYPH} className={className} aria-hidden="true" />
);

/** A setting's tonal tile: rest is a surface container, on is a primary one.
 *  The control is an On/Off pill group, never a bare switch. */
function SettingRow({
  title,
  description,
  note,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  note?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const { t } = useTranslation("common");
  return (
    <div
      className={cn(
        SWITCH_ROW.ROOT,
        SWITCH_ROW.TRANSITION,
        checked ? SWITCH_ROW.ON : SWITCH_ROW.REST,
      )}
    >
      <div className={SWITCH_ROW.TEXT}>
        <p className={SWITCH_ROW.TITLE}>{title}</p>
        <p className={SWITCH_ROW.DESC}>{description}</p>
        {note ? <p className={SWITCH_ROW.NOTE}>{note}</p> : null}
      </div>
      <SegmentedField
        value={checked ? "on" : "off"}
        onValueChange={(next) => onChange(next === "on")}
        ariaLabel={title}
        disabled={disabled}
        breakpoint="never"
        glyph={renderCheckGlyph}
        options={[
          { value: "off", label: t("tailscale.connection.off") },
          { value: "on", label: t("tailscale.connection.on") },
        ]}
      />
    </div>
  );
}

export function ConnectionCard({
  view,
  status,
  isConnecting,
  isDisconnecting,
  isTogglingService,
  isTogglingBoot,
  isTogglingExitNode,
  isTogglingSsh,
  connect,
  disconnect,
  logout,
  startService,
  stopService,
  setBootEnabled,
  setExitNodeAdvertised,
  setSshEnabled,
}: ConnectionCardProps) {
  const { t } = useTranslation("common");
  const [sshDialogOpen, setSshDialogOpen] = React.useState(false);

  const version = status.version;
  const daemonRunning = status.daemon_running ?? false;
  const backendState = status.backend_state ?? "";
  const bootEnabled = status.enabled_on_boot ?? false;
  const exitNodeEnabled = status.exit_node_advertised ?? false;
  const installVariant = status.install_variant;
  const authUrl = status.auth_url;

  // The accept-routes advisory is normal on this device and is not a fault.
  const health = (status.health ?? []).filter(
    (msg) => !msg.includes("--accept-routes"),
  );

  // `tailscale set` cannot reach a stopped or logged-out daemon, so exit-node
  // advertising can only change while the node is connected.
  const exitNodeLocked = !daemonRunning || backendState !== "Running";

  // Tailscale SSH follows the same rule. While connected, `ssh_enabled: null`
  // means the daemon's prefs could not be read, so the row is left out rather
  // than shown with a guessed state.
  const sshEnabled = status.ssh_enabled ?? false;
  const sshUnknown = !exitNodeLocked && status.ssh_enabled == null;

  const applySsh = async (checked: boolean) => {
    const result = await setSshEnabled(checked);
    if (result.ok) {
      toast.success(
        checked
          ? t("tailscale.toast.sshEnabled")
          : t("tailscale.toast.sshDisabled"),
      );
    } else {
      toast.error(
        result.reason ||
          (checked
            ? t("tailscale.toast.sshEnableFailed")
            : t("tailscale.toast.sshDisableFailed")),
      );
    }
  };

  // Turning SSH on opens remote shell access, so it confirms first; turning
  // it off applies at once.
  const handleSsh = (checked: boolean) => {
    if (checked) setSshDialogOpen(true);
    else void applySsh(false);
  };

  const handleBoot = async (checked: boolean) => {
    const result = await setBootEnabled(checked);
    if (result.ok) {
      toast.success(
        checked
          ? t("tailscale.toast.bootEnabled")
          : t("tailscale.toast.bootDisabled"),
      );
    } else {
      toast.error(result.reason || t("tailscale.toast.bootFailed"));
    }
  };

  const handleExitNode = async (checked: boolean) => {
    const result = await setExitNodeAdvertised(checked);
    if (result.ok) {
      toast.success(
        checked
          ? t("tailscale.toast.exitNodeEnabled")
          : t("tailscale.toast.exitNodeDisabled"),
      );
    } else {
      toast.error(result.reason || t("tailscale.toast.exitNodeFailed"));
    }
  };

  const run = async (
    action: () => Promise<TailscaleActionResult>,
    successKey: string,
    errorKey: string,
  ) => {
    const result = await action();
    if (result.ok) toast.success(t(successKey));
    else toast.error(result.reason || t(errorKey));
  };

  const logoutDialog = (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          disabled={isDisconnecting}
          size="action"
        >
          {t("tailscale.connection.logout")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("tailscale.connection.logoutDialogTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("tailscale.connection.logoutDialogDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("tailscale.actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() =>
              run(
                logout,
                "tailscale.toast.loggedOut",
                "tailscale.toast.logoutFailed",
              )
            }
          >
            {t("tailscale.connection.logout")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const busyGlyph = (
    <Loader2Icon className="size-4 motion-safe:animate-spin" />
  );

  let rail: React.ReactNode = null;
  if (view === "serviceStopped") {
    rail = (
      <Button
        type="button"
        size="action"
        disabled={isTogglingService}
        onClick={() =>
          run(
            startService,
            "tailscale.toast.serviceStarted",
            "tailscale.toast.serviceStartFailed",
          )
        }
      >
        {isTogglingService ? busyGlyph : null}
        {isTogglingService
          ? t("tailscale.connection.starting")
          : t("tailscale.connection.startService")}
      </Button>
    );
  } else if (view === "needsLogin") {
    rail = (
      <>
        {authUrl ? null : (
          <Button
            type="button"
            size="action"
            disabled={isConnecting}
            onClick={() =>
              run(
                connect,
                "tailscale.toast.connected",
                "tailscale.toast.connectFailed",
              )
            }
          >
            {isConnecting ? busyGlyph : null}
            {isConnecting
              ? t("tailscale.connection.connecting")
              : t("tailscale.connection.connect")}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="action"
          className={PILL_REST}
          disabled={isTogglingService}
          onClick={() =>
            run(
              stopService,
              "tailscale.toast.serviceStopped",
              "tailscale.toast.serviceStopFailed",
            )
          }
        >
          {isTogglingService ? busyGlyph : null}
          {isTogglingService
            ? t("tailscale.connection.stopping")
            : t("tailscale.connection.stopService")}
        </Button>
      </>
    );
  } else if (view === "running") {
    rail = (
      <>
        <Button
          type="button"
          variant="ghost"
          size="action"
          className={PILL_REST}
          disabled={isDisconnecting}
          onClick={() =>
            run(
              disconnect,
              "tailscale.toast.disconnected",
              "tailscale.toast.disconnectFailed",
            )
          }
        >
          {isDisconnecting ? busyGlyph : null}
          {isDisconnecting
            ? t("tailscale.connection.disconnecting")
            : t("tailscale.connection.disconnect")}
        </Button>
        {logoutDialog}
      </>
    );
  } else {
    rail = (
      <>
        <Button
          type="button"
          size="action"
          disabled={isConnecting}
          onClick={() =>
            run(
              connect,
              "tailscale.toast.connected",
              "tailscale.toast.connectFailed",
            )
          }
        >
          {isConnecting ? busyGlyph : null}
          {isConnecting
            ? t("tailscale.connection.connecting")
            : t("tailscale.connection.connect")}
        </Button>
        {logoutDialog}
      </>
    );
  }

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={cn(CARD_PAD, CARD_HEAD)}>
        <div className={CARD_HEAD_TEXT}>
          <CardTitle className={CARD_TITLE}>
            {t("tailscale.connection.title")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t("tailscale.connection.description")}
          </CardDescription>
        </div>
        {version || installVariant === "official" || installVariant === "tiny" ? (
          <div className={CARD_HEAD_ACTIONS}>
            {installVariant === "official" || installVariant === "tiny" ? (
              <Tag variant="neutral" className={HEAD_TAG}>
                {t(`tailscale.install.variant.${installVariant}.title`)}
              </Tag>
            ) : null}
            {version ? (
              <Tag variant="neutral" className={HEAD_TAG}>
                {t("tailscale.connection.version", { version })}
              </Tag>
            ) : null}
          </div>
        ) : null}
      </CardHeader>

      {/* No card-level `aria-live`: the health notice and the auth condition
          below are already live regions, and nesting them announces twice. */}
      <CardContent className={cn(CARD_PAD, CARD_BODY)}>
        {health.length > 0 ? (
          <div role="alert" className={cn(NOTICE, NOTICE_TONE.warning)}>
            <TriangleAlertIcon className={NOTICE_GLYPH} />
            <div className={cn(NOTICE_BODY, NOTICE_LIST)}>
              {health.map((msg) => (
                <span key={msg}>{msg}</span>
              ))}
            </div>
          </div>
        ) : null}

        {view === "needsLogin" && authUrl ? (
          <ConditionBlock
            tone="warning"
            icon={LogInIcon}
            title={t("tailscale.connection.authTitle")}
            description={t("tailscale.connection.authDescription")}
            actionLabel={t("tailscale.connection.openLogin")}
            actionIcon={ExternalLinkIcon}
            actionHref={authUrl}
            footer={
              <>
                {/* The surface's one ambient loop, and only while it waits. */}
                <span aria-hidden className={LIVE_DOT} />
                {t("tailscale.connection.authWaiting")}
              </>
            }
          />
        ) : null}

        <SettingRow
          title={t("tailscale.connection.bootTitle")}
          description={t("tailscale.connection.bootDescription")}
          checked={bootEnabled}
          disabled={isTogglingBoot}
          onChange={handleBoot}
        />

        <SettingRow
          title={t("tailscale.connection.exitNodeTitle")}
          description={t("tailscale.connection.exitNodeDescription")}
          note={
            exitNodeLocked ? t("tailscale.connection.exitNodeLocked") : undefined
          }
          checked={exitNodeEnabled}
          disabled={exitNodeLocked || isTogglingExitNode}
          onChange={handleExitNode}
        />

        {sshUnknown ? null : (
          <SettingRow
            title={t("tailscale.connection.sshTitle")}
            description={t("tailscale.connection.sshDescription")}
            note={exitNodeLocked ? t("tailscale.connection.sshLocked") : undefined}
            checked={sshEnabled}
            disabled={exitNodeLocked || isTogglingSsh}
            onChange={handleSsh}
          />
        )}

        <AlertDialog open={sshDialogOpen} onOpenChange={setSshDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("tailscale.connection.sshDialogTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("tailscale.connection.sshDialogDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("tailscale.actions.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void applySsh(true)}>
                {t("tailscale.connection.sshConfirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className={RAIL}>{rail}</div>
      </CardContent>

    </Card>
  );
}

/** Mirrors the loaded card's header structure and its switch tiles, both from
 *  the same constants, so the swap moves nothing. */
export function ConnectionCardSkeleton() {
  const { t } = useTranslation("common");
  return (
    <Card className={CARD_SHELL}>
      <CardHeader className={cn(CARD_PAD, CARD_HEAD)}>
        <div className={CARD_HEAD_TEXT}>
          <CardTitle className={CARD_TITLE}>
            {t("tailscale.connection.title")}
          </CardTitle>
          <CardDescription className={CARD_DESC}>
            {t("tailscale.connection.description")}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className={cn(CARD_PAD, CARD_BODY)} aria-hidden>
        <Skeleton className={SKELETON.SWITCH} />
        <Skeleton className={SKELETON.SWITCH} />
        <Skeleton className={SKELETON.SWITCH} />
        <Skeleton className={cn(SKELETON.ACTION, "w-40")} />
      </CardContent>
    </Card>
  );
}
