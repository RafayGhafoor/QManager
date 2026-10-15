"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";

import { AppSwitcher } from "@/components/app-switcher";
import { NavSection, type NavItem } from "@/components/nav-section";
import { NavUser } from "@/components/nav-user";
import DonateDialog from "@/components/donate-dialog";
import { useWatchdogIndicator } from "@/hooks/use-watchdog-indicator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";

// Icons are Material Symbols Rounded ligature names, resolved against the
// build-time subset in app/fonts. Adding one here means adding it to the
// MaterialSymbolName union AND regenerating the subset — the type will tell you.
//
// t_key values are keys inside the "sidebar" namespace's "items" object;
// NavSection resolves them via t(`items.${t_key}`). Labels never live here.
//
// Grouping follows the RM520N canon. Routes are the target's own: where the
// canon moved a page (Connection Quality to /monitoring/connection-quality,
// Network Events to /monitoring/events), the row points at where it lives
// today until ledger U3.2 reconciles the routes.

const navMain: NavItem[] = [
  { t_key: "home", url: "/dashboard", icon: "home" },
];

const navCellular: NavItem[] = [
  {
    t_key: "cellular_information",
    url: "/cellular",
    icon: "cell_tower",
    items: [
      { t_key: "antenna_statistics", url: "/cellular/antenna-statistics" },
      { t_key: "antenna_alignment", url: "/cellular/antenna-alignment" },
    ],
  },
  {
    t_key: "sms_center",
    url: "/cellular/sms",
    icon: "sms",
    items: [{ t_key: "sms_forwarding", url: "/cellular/sms/forwarding" }],
  },
  {
    t_key: "custom_profiles",
    url: "/cellular/custom-profiles",
    icon: "account_circle",
    items: [
      {
        t_key: "connection_scenarios",
        url: "/cellular/custom-profiles/connection-scenarios",
      },
    ],
  },
  {
    t_key: "band_locking",
    url: "/cellular/cell-locking",
    icon: "signal_cellular_alt",
    items: [
      { t_key: "tower_locking", url: "/cellular/cell-locking/tower-locking" },
      {
        t_key: "frequency_locking",
        url: "/cellular/cell-locking/frequency-locking",
      },
    ],
  },
  {
    t_key: "cell_scanner",
    url: "/cellular/cell-scanner",
    icon: "radar",
    items: [
      {
        t_key: "neighboring_cells",
        url: "/cellular/cell-scanner/neighbourcell-scanner",
      },
      {
        t_key: "frequency_calculator",
        url: "/cellular/cell-scanner/frequency-calculator",
      },
    ],
  },
  {
    t_key: "settings",
    url: "/cellular/settings",
    icon: "tune",
    items: [
      { t_key: "apn_management", url: "/cellular/settings/apn-management" },
      { t_key: "network_priority", url: "/cellular/settings/network-priority" },
      { t_key: "imei_settings", url: "/cellular/settings/imei-settings" },
      { t_key: "fplmn_settings", url: "/cellular/settings/fplmn-settings" },
    ],
  },
];

const navLocalNetwork: NavItem[] = [
  {
    t_key: "ethernet_status",
    url: "/local-network",
    icon: "settings_ethernet",
  },
  {
    t_key: "traffic_engine",
    url: "/local-network/traffic-engine",
    icon: "monitor",
  },
  {
    t_key: "local_network_settings",
    url: "/local-network/ip-passthrough",
    icon: "tune",
    items: [
      { t_key: "ttl_mtu_settings", url: "/local-network/ttl-settings" },
      { t_key: "custom_dns", url: "/local-network/custom-dns" },
    ],
  },
];

const navSystem: NavItem[] = [
  {
    t_key: "system_settings",
    url: "/system-settings",
    icon: "settings",
    items: [
      { t_key: "logs", url: "/system-settings/logs" },
      { t_key: "languages", url: "/system-settings/languages" },
      {
        t_key: "configuration_backup",
        url: "/system-settings/config-backup",
      },
      { t_key: "adaptive_polling", url: "/system-settings/adaptive-polling" },
    ],
  },
  {
    t_key: "software_update",
    url: "/system-settings/software-update",
    icon: "download",
  },
  {
    t_key: "at_terminal",
    url: "/system-settings/at-terminal",
    icon: "terminal",
  },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation("sidebar");
  const [donateOpen, setDonateOpen] = React.useState(false);
  const watchdog = useWatchdogIndicator();

  // The Watchdog row reports live state so a user on any page learns the modem
  // is being acted on. Tone follows what is happening to the device, not how
  // dramatic it sounds: recovery is intervention, cooldown is verification.
  const navMonitoring: NavItem[] = React.useMemo(
    () => [
      {
        t_key: "connection_quality",
        url: "/system-settings/connection-quality",
        icon: "speed",
        items: [
          { t_key: "latency_monitor", url: "/monitoring/latency" },
          // /monitoring is the section index, so a prefix match would light
          // this row on every Monitoring page.
          { t_key: "network_events", url: "/monitoring", exact: true },
        ],
      },
      { t_key: "alerts", url: "/monitoring/alerts", icon: "notifications" },
      {
        t_key: "watchdog",
        url: "/monitoring/watchdog",
        icon: "pets",
        status: watchdog
          ? watchdog.activity === "recovery"
            ? {
                tone: "destructive" as const,
                label: t("status.watchdog_acting"),
                description: t("status.watchdog_acting_detail", {
                  tier: watchdog.tier,
                }),
              }
            : {
                tone: "warning" as const,
                label: t("status.watchdog_settling"),
                description: t("status.watchdog_settling_detail"),
              }
          : undefined,
      },
      { t_key: "tailscale", url: "/monitoring/tailscale", icon: "vpn_lock" },
      { t_key: "netbird", url: "/monitoring/netbird", icon: "hub" },
    ],
    [watchdog, t],
  );

  const navFooter: NavItem[] = React.useMemo(
    () => [
      { t_key: "about_device", url: "/about-device", icon: "router" },
      { t_key: "support", url: "/support", icon: "support" },
      {
        t_key: "donate",
        url: "#",
        icon: "favorite",
        onClick: () => setDonateOpen(true),
      },
    ],
    [],
  );

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <AppSwitcher />
      </SidebarHeader>

      <SidebarContent>
        <NavSection groupKey="dashboard" items={navMain} />
        <NavSection groupKey="cellular" items={navCellular} />
        <NavSection groupKey="local_network" items={navLocalNetwork} />
        <NavSection groupKey="monitoring" items={navMonitoring} />
        <NavSection groupKey="system" items={navSystem} />
        {/* Unlabelled, quieter, and pinned to the bottom: these are about the
            product rather than the device, so they sit outside the sections a
            user navigates by. */}
        <NavSection items={navFooter} size="sm" className="mt-auto" />
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>

      <DonateDialog open={donateOpen} onOpenChange={setDonateOpen} />
    </Sidebar>
  );
}
