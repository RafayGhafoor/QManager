"use client";

import * as React from "react";
import Image from "next/image";
import { useTranslation } from "react-i18next";

import QManagerMark from "@/public/qmanager-mark.svg";
import OpenWrtLogo from "@/public/openwrt.svg";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

// Sidebar header. The canon header is the Tonal Q mark plus the product name
// (PRODUCT.md makes the mark the source of the colour system). The target keeps
// one thing the canon has no equivalent for: a disclosure to LuCI, the advanced
// OpenWrt UI that ships on the same device.
export function AppSwitcher() {
  const { t } = useTranslation("sidebar");
  const [open, setOpen] = React.useState(false);

  return (
    <SidebarMenu>
      <Collapsible asChild open={open} onOpenChange={setOpen}>
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
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
              </div>
              <MaterialSymbol
                name="unfold_more"
                size={18}
                className="text-sidebar-foreground/60 ml-auto"
              />
            </SidebarMenuButton>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <SidebarMenuSub>
              {/* LuCI: opens the advanced OpenWrt UI in a new tab */}
              <SidebarMenuSubItem>
                <SidebarMenuSubButton asChild>
                  <a
                    href="/cgi-bin/luci"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Image
                      src={OpenWrtLogo}
                      alt=""
                      className="size-4 shrink-0"
                    />
                    <span>{t("items.luci")}</span>
                    <MaterialSymbol
                      name="open_in_new"
                      size={16}
                      className="text-muted-foreground ml-auto"
                    />
                    <span className="sr-only">
                      {t("switcher.opens_new_tab")}
                    </span>
                  </a>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    </SidebarMenu>
  );
}
