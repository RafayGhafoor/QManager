"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronsUpDown,
  KeyRound,
  Loader2,
  LogOut,
  Power,
  Camera,
  Pencil,
  RotateCcw,
  Settings,
  Sparkles,
  CircleMinus,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { logout } from "@/hooks/use-auth";
import { useModemReconnect } from "@/hooks/use-modem-reconnect";
import { authFetch } from "@/lib/auth-fetch";
import { rebootNow } from "@/lib/reboot";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { ChangePasswordDialog } from "@/components/auth/change-password-dialog";
import { AnimatedThemeToggler } from "./ui/animated-theme-toggler";
import { useTranslation } from "react-i18next";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { useMotionPreference } from "@/components/motion-preference";
import {
  MOTION_PREFERENCES,
  type MotionPreference,
} from "@/lib/motion-preference";

// Animations preference, presented beside the theme row: both are appearance
// choices that live on this device only, so they belong in the same group.
//
// The keys are written out as LITERALS rather than built with
// t(`motion.${preference}`). lib/i18n/check.ts scans source text for key
// stems, and an interpolated key is invisible to it — a missing translation
// would then ship as the raw key string with a green check run.
const MOTION_LABEL_KEY: Record<MotionPreference, string> = {
  system: "motion.system",
  full: "motion.full",
  reduced: "motion.reduced",
};

// lucide stand-ins for the source's Material glyphs (settings / auto_awesome /
// do_not_disturb_on): the target sidebar stays lucide until it converts whole.
const MOTION_ICON: Record<MotionPreference, LucideIcon> = {
  system: Settings,
  full: Sparkles,
  reduced: CircleMinus,
};

export function NavUser({
  user,
}: {
  user: {
    name: string;
    avatar: string;
  };
}) {
  const { isMobile } = useSidebar();
  const { t } = useTranslation("common");
  const { preference: motionPreference, setPreference: setMotionPreference } =
    useMotionPreference();
  const MotionIcon = MOTION_ICON[motionPreference];

  // --- Display name from device hostname ---
  const [displayName, setDisplayName] = useState<string>(user.name);
  const [avatarSrc, setAvatarSrc] = useState<string>(() => {
    if (typeof window === "undefined") return user.avatar;
    return localStorage.getItem("qm_display_avatar") || user.avatar;
  });

  // Fetch hostname from system settings on mount
  useEffect(() => {
    authFetch("/cgi-bin/quecmanager/system/settings.sh")
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.settings?.hostname) {
          setDisplayName(json.settings.hostname);
        }
      })
      .catch(() => {});
  }, []);

  // --- Dialog state ---
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [reconnectDialogOpen, setReconnectDialogOpen] = useState(false);
  const [rebootDialogOpen, setRebootDialogOpen] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const {
    reconnectModem,
    isReconnecting,
    step: reconnectStep,
  } = useModemReconnect();

  // --- Name edit state ---
  const [nameInput, setNameInput] = useState(displayName);

  // --- Avatar upload ---
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      localStorage.setItem("qm_display_avatar", base64);
      setAvatarSrc(base64);
      toast.success("Profile photo updated.");
    };
    reader.readAsDataURL(file);
    // Reset so same file can be re-selected
    e.target.value = "";
  };

  // --- Name save (updates device hostname) ---
  const [savingName, setSavingName] = useState(false);

  const handleNameSave = async () => {
    const name = nameInput.trim();
    if (!name) return;
    setSavingName(true);
    try {
      const resp = await authFetch("/cgi-bin/quecmanager/system/settings.sh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_settings", hostname: name }),
      });
      const json = await resp.json();
      if (!json.success) {
        toast.error("Failed to update display name.");
        return;
      }
      setDisplayName(name);
      setNameDialogOpen(false);
      toast.success("Display name updated.");
    } catch {
      toast.error("Failed to update display name.");
    } finally {
      setSavingName(false);
    }
  };

  // --- Reboot (optimistic) ---
  // Fire the reboot request and redirect to the countdown page.
  // The backend flushes its response then reboots after 1s — the countdown
  // page handles polling for device readiness and redirects to login.
  const handleReboot = async (e: React.MouseEvent) => {
    e.preventDefault();
    setRebooting(true);
    rebootNow("manual");
  };

  const handleReconnect = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (isReconnecting) return;

    const result = await reconnectModem({
      onStep: (step) => {
        if (step === "disconnecting") {
          toast.info(t("state.disconnecting"));
          return;
        }
        toast.info(t("state.reconnecting"));
      },
    });

    if (!result.success) {
      toast.error(resolveErrorMessage(t, result.error, undefined, "Failed to reconnect modem"));
      return;
    }

    setReconnectDialogOpen(false);
    toast.success("Modem reconnect complete");
  };

  const initials =
    displayName
      .split(/[-_ ]+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "QM";

  return (
    <>
      {/* Hidden file input for avatar upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={avatarSrc} alt={displayName} />
                  <AvatarFallback className="rounded-lg">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{displayName}</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
              side={isMobile ? "bottom" : "right"}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  {/* Clickable avatar with camera overlay */}
                  <button
                    type="button"
                    onClick={handleAvatarClick}
                    className="relative group shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Change profile photo"
                  >
                    <Avatar className="h-8 w-8 rounded-lg">
                      <AvatarImage src={avatarSrc} alt={displayName} />
                      <AvatarFallback className="rounded-lg">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute inset-0 rounded-lg bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Camera className="size-3.5 text-white" />
                    </div>
                  </button>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{displayName}</span>
                  </div>
                </div>
              </DropdownMenuLabel>

              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground text-xs">
                {t("language.label")}
              </DropdownMenuLabel>
              <div className="px-1 pb-1">
                <LanguageSwitcher />
              </div>

              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() => {
                    setNameInput(displayName);
                    setNameDialogOpen(true);
                  }}
                >
                  <Pencil />
                  {t("actions.change_display_name")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPasswordDialogOpen(true)}>
                  <KeyRound />
                  {t("actions.change_password")}
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <AnimatedThemeToggler />
                </DropdownMenuItem>
                {/* Animations sits directly under Theme: the two device-local
                    appearance preferences read as one pair.

                    Three states cycle in place rather than through a submenu,
                    which keeps the theme row's interaction shape. The default
                    close is suppressed so reaching Reduced from System is one
                    open and two clicks, not two opens. The current state is
                    shown as a trailing value because a glyph alone cannot
                    distinguish "following the OS" from "explicitly Full". */}
                <DropdownMenuItem
                  onSelect={(event) => event.preventDefault()}
                  onClick={() =>
                    setMotionPreference(
                      MOTION_PREFERENCES[
                        (MOTION_PREFERENCES.indexOf(motionPreference) + 1) %
                          MOTION_PREFERENCES.length
                      ]
                    )
                  }
                >
                  <MotionIcon />
                  {t("motion.label")}
                  <span
                    aria-live="polite"
                    className="text-muted-foreground ml-auto text-xs"
                  >
                    {t(MOTION_LABEL_KEY[motionPreference])}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setReconnectDialogOpen(true)}
                  disabled={isReconnecting}
                >
                  {isReconnecting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RotateCcw />
                  )}
                  {t("actions.reconnect_modem")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setRebootDialogOpen(true)}
              >
                <Power />
                {t("actions.reboot_device")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => logout()}>
                <LogOut />
                {t("actions.log_out")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      {/* Change Display Name dialog */}
      <Dialog
        open={nameDialogOpen}
        onOpenChange={(open) => {
          setNameDialogOpen(open);
          if (!open) setNameInput(displayName);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("actions.change_display_name")}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Your name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNameSave();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNameDialogOpen(false)}>
              {t("actions.cancel")}
            </Button>
            <Button
              onClick={handleNameSave}
              disabled={
                !nameInput.trim() ||
                nameInput.trim() === displayName ||
                savingName
              }
            >
              {savingName ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("state.saving")}
                </>
              ) : (
                t("actions.save")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChangePasswordDialog
        open={passwordDialogOpen}
        onOpenChange={setPasswordDialogOpen}
      />

      <AlertDialog
        open={reconnectDialogOpen}
        onOpenChange={(open) => {
          if (!isReconnecting) setReconnectDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reconnect Modem</AlertDialogTitle>
            <AlertDialogDescription aria-live="polite">
              {isReconnecting
                ? reconnectStep === "disconnecting"
                  ? "Disconnecting modem from network..."
                  : "Reconnecting modem to network..."
                : "This will disconnect the modem for a few seconds, then reconnect it automatically."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isReconnecting}>
              {t("actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isReconnecting}
              onClick={handleReconnect}
            >
              {isReconnecting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {reconnectStep === "disconnecting"
                    ? t("state.disconnecting")
                    : t("state.reconnecting")}
                </>
              ) : (
                "Reconnect"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={rebootDialogOpen}
        onOpenChange={(open) => {
          if (!rebooting) setRebootDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("actions.reboot_device")}</AlertDialogTitle>
            <AlertDialogDescription aria-live="polite">
              {rebooting
                ? "Reboot command sent. You will be logged out shortly..."
                : "The device will restart and all network connections will drop until it comes back online."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rebooting}>
              {t("actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={rebooting}
              onClick={handleReboot}
            >
              {rebooting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("state.applying")}
                </>
              ) : (
                "Reboot Now"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
