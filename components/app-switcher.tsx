"use client";

import * as React from "react";
import Image from "next/image";
import { useTranslation } from "react-i18next";

import QManagerMark from "@/public/qmanager-mark.svg";
import OpenWrtLogo from "@/public/openwrt.svg";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { APP_VERSION } from "@/lib/i18n/app-version";

// Sidebar header, in the slot sidebar-07 gives its team switcher. The canon
// header is the Tonal Q mark plus the product name (PRODUCT.md makes the mark
// the source of the colour system). The target keeps one thing the canon has no
// equivalent for: a way across to LuCI, the advanced OpenWrt UI that ships on
// the same device. A dropdown rather than an inline disclosure, because the
// header must still work when the sidebar is collapsed to its icon rail.
export function AppSwitcher() {
  const { t } = useTranslation("sidebar");
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground gap-2.5 px-2.5"
            >
              <Image
                src={QManagerMark}
                alt=""
                aria-hidden="true"
                className="size-[1.875rem] shrink-0"
                priority
              />
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold">QManager</span>
                <span className="text-sidebar-foreground/70 truncate text-xs tabular-nums">
                  {APP_VERSION}
                </span>
              </div>
              <MaterialSymbol
                name="unfold_more"
                size={18}
                className="text-sidebar-foreground/60 ml-auto"
              />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="start"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              {t("switcher.apps")}
            </DropdownMenuLabel>
            <DropdownMenuItem className="font-medium">
              <Image
                src={QManagerMark}
                alt=""
                aria-hidden="true"
                className="size-4 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate">QManager</span>
              <MaterialSymbol name="check" size={16} className="text-primary" />
              <span className="sr-only">{t("switcher.current")}</span>
            </DropdownMenuItem>
            {/* LuCI: opens the advanced OpenWrt UI in a new tab */}
            <DropdownMenuItem asChild>
              <a
                href="/cgi-bin/luci"
                target="_blank"
                rel="noopener noreferrer"
                // LuCI opens in its own tab; drop the mobile sheet so this tab
                // is not left covered when the user comes back to it.
                onClick={() => setOpenMobile(false)}
              >
                <Image
                  src={OpenWrtLogo}
                  alt=""
                  aria-hidden="true"
                  className="size-4 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">
                  {t("items.luci")}
                </span>
                <MaterialSymbol
                  name="open_in_new"
                  size={16}
                  className="text-muted-foreground"
                />
                <span className="sr-only">{t("switcher.opens_new_tab")}</span>
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
