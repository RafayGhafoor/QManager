"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowDownAZIcon,
  ArrowUpAZIcon,
  ArrowUpDownIcon,
  Download,
  ListIcon,
  Loader2,
  MoreVerticalIcon,
  PencilLineIcon,
  Plus,
  RefreshCcwIcon,
  RotateCcw,
  TriangleAlertIcon,
  Upload,
  X,
} from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardFoot } from "@/components/ui/card-foot";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldError } from "@/components/ui/field";
import { useCdnHostlist } from "@/hooks/use-cdn-hostlist";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { validateDomainKey } from "@/lib/validate-domain";
import { cn } from "@/lib/utils";
import {
  CARD_DESC,
  CARD_PAD,
  CARD_SHELL,
  CARD_TITLE,
  CONDITION,
  CONDITION_TONE,
  HOSTLIST,
  SKELETON,
} from "./shapes";

const sameSet = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const norm = (list: string[]) =>
    list.map((d) => d.toLowerCase()).sort((x, y) => x.localeCompare(y));
  const na = norm(a);
  const nb = norm(b);
  return na.every((d, i) => d === nb[i]);
};

function HostlistHeader({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation("local-network");
  return (
    <CardHeader className={CARD_PAD}>
      <CardTitle className={CARD_TITLE}>
        {t("video_optimizer.hostlist_card_title")}
      </CardTitle>
      <CardDescription className={CARD_DESC}>
        {t("video_optimizer.hostlist_card_description")}
      </CardDescription>
      {children}
    </CardHeader>
  );
}

/** The hostlist's placeholder: the loaded card's own geometry. */
export function HostlistSkeleton() {
  return (
    <Card className={cn(CARD_SHELL, "h-full")} aria-hidden="true">
      <CardHeader className={CARD_PAD}>
        <Skeleton className={SKELETON.TITLE} />
        <Skeleton className={SKELETON.DESC} />
      </CardHeader>
      <CardContent className={`${CARD_PAD} flex min-h-0 flex-1 flex-col gap-4`}>
        <Skeleton className={SKELETON.INPUT} />
        <Skeleton className={SKELETON.HOSTLIST} />
      </CardContent>
      <CardFoot
        className={CARD_PAD}
        liveStatus={false}
        actions={<Skeleton className={SKELETON.ACTION} />}
      />
    </Card>
  );
}

/**
 * The CDN domains Video Optimizer targets. A companion of the Video tab: the
 * draft is edited in the pill field and committed from the foot.
 */
export function CdnHostlistCard() {
  const { t } = useTranslation("local-network");
  const {
    domains,
    defaultDomains,
    isLoading,
    isSaving,
    isRestoring,
    error,
    saveHostlist,
    restoreDefaults,
    refresh,
  } = useCdnHostlist();

  // The draft follows the saved list whenever a load or save replaces it
  // (adjust-during-render, no effect).
  const [editDomains, setEditDomains] = useState<string[]>(domains);
  const [prevDomains, setPrevDomains] = useState(domains);
  if (domains !== prevDomains) {
    setPrevDomains(domains);
    setEditDomains(domains);
  }

  const [newDomain, setNewDomain] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState<boolean | null>(null);
  const { saved, markSaved } = useSaveFlash();
  const importRef = useRef<HTMLInputElement>(null);

  const defaultSet = useMemo(
    () => new Set(defaultDomains.map((d) => d.toLowerCase())),
    [defaultDomains],
  );

  const isDirty = useMemo(
    () => !sameSet(editDomains, domains),
    [editDomains, domains],
  );

  const displayDomains = useMemo(() => {
    const indexed = editDomains.map((d, i) => ({ domain: d, originalIndex: i }));
    if (sortAsc === null) return indexed;
    return indexed.sort((a, b) => {
      const cmp = a.domain.toLowerCase().localeCompare(b.domain.toLowerCase());
      return sortAsc ? cmp : -cmp;
    });
  }, [editDomains, sortAsc]);

  const customCount = useMemo(
    () => editDomains.filter((d) => !defaultSet.has(d.toLowerCase())).length,
    [editDomains, defaultSet],
  );

  const handleAddDomain = useCallback(() => {
    const trimmed = newDomain.trim();
    const errKey = validateDomainKey(trimmed, editDomains);
    if (errKey) {
      setValidationError(t(errKey));
      return;
    }
    setEditDomains((prev) => [...prev, trimmed]);
    setNewDomain("");
    setValidationError(null);
  }, [newDomain, editDomains, t]);

  const handleRemoveDomain = useCallback((originalIndex: number) => {
    setEditDomains((prev) => prev.filter((_, i) => i !== originalIndex));
  }, []);

  const handleSave = useCallback(async () => {
    const result = await saveHostlist(editDomains);
    if (result.ok) {
      markSaved();
      toast.success(t("video_optimizer.toast_save_success"));
    } else {
      toast.error(
        resolveErrorMessage(
          t,
          result.code,
          result.error,
          t("video_optimizer.toast_save_error"),
        ),
      );
    }
  }, [editDomains, saveHostlist, markSaved, t]);

  const handleDiscard = useCallback(() => {
    setEditDomains(domains);
    setValidationError(null);
  }, [domains]);

  const handleRestoreDefaults = useCallback(async () => {
    const result = await restoreDefaults();
    if (result.ok) {
      toast.success(t("video_optimizer.toast_restore_success"));
    } else {
      toast.error(
        resolveErrorMessage(
          t,
          result.code,
          result.error,
          t("video_optimizer.toast_restore_error"),
        ),
      );
    }
  }, [restoreDefaults, t]);

  const handleExport = useCallback(() => {
    const content = editDomains.join("\n") + "\n";
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "video_domains.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(
      t("video_optimizer.toast_export_success", { count: editDomains.length }),
    );
  }, [editDomains, t]);

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result;
        if (typeof text !== "string") return;

        const imported = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"));

        const existingLower = new Set(editDomains.map((d) => d.toLowerCase()));
        const newOnes = imported.filter(
          (d) => !existingLower.has(d.toLowerCase()),
        );

        // Import only changes the draft; the foot's Save commits it.
        if (newOnes.length === 0) {
          toast.info(t("video_optimizer.toast_import_no_new"));
        } else {
          setEditDomains((prev) => [...prev, ...newOnes]);
          toast.success(
            t("video_optimizer.toast_import_success", { count: newOnes.length }),
          );
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [editDomains, t],
  );

  const toggleSort = useCallback(() => {
    setSortAsc((prev) => (prev === null ? true : prev ? false : null));
  }, []);

  if (isLoading) return <HostlistSkeleton />;

  if (error && domains.length === 0) {
    const tone = CONDITION_TONE.destructive;
    return (
      <Card className={cn(CARD_SHELL, "h-full")}>
        <HostlistHeader />
        <CardContent className={`${CARD_PAD} flex flex-1 flex-col`}>
          <div role="alert" className={cn(CONDITION.ROOT, tone.ROOT)}>
            <span aria-hidden className={cn(CONDITION.DISC, tone.DISC)}>
              <TriangleAlertIcon className={CONDITION.GLYPH} />
            </span>
            <p className={CONDITION.DESC}>
              {t("video_optimizer.hostlist_error_load_failed")}
            </p>
            <div className={CONDITION.ACTIONS}>
              <Button
                variant="ghost"
                size="action"
                onClick={() => refresh()}
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
  }

  const busy = isSaving || isRestoring;

  return (
    <Card className={cn(CARD_SHELL, "h-full")}>
      <HostlistHeader>
        <CardAction className={HOSTLIST.HEAD_TOOLS}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={HOSTLIST.ICON_BUTTON}
            onClick={toggleSort}
            aria-label={
              sortAsc === null
                ? t("video_optimizer.aria_sort_az")
                : sortAsc
                  ? t("video_optimizer.aria_sort_za")
                  : t("video_optimizer.aria_sort_clear")
            }
          >
            {sortAsc === null ? (
              <ArrowUpDownIcon className="size-4" />
            ) : sortAsc ? (
              <ArrowDownAZIcon className="size-4" />
            ) : (
              <ArrowUpAZIcon className="size-4" />
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={HOSTLIST.ICON_BUTTON}
                aria-label={t("video_optimizer.aria_menu_options")}
              >
                <MoreVerticalIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExport}>
                <Download className="size-4" />
                {t("video_optimizer.menu_export")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => importRef.current?.click()}>
                <Upload className="size-4" />
                {t("video_optimizer.menu_import")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={importRef}
            type="file"
            accept=".txt,.csv,text/plain"
            className="hidden"
            onChange={handleImport}
          />
        </CardAction>
      </HostlistHeader>

      <CardContent
        className={`${CARD_PAD} flex min-h-0 flex-1 flex-col gap-4`}
        aria-live="polite"
      >
        <div className="flex flex-col gap-1.5">
          <InputGroup>
            <InputGroupInput
              type="text"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              className="font-mono text-[0.8125rem]"
              placeholder={t("video_optimizer.placeholder_new_domain")}
              value={newDomain}
              onChange={(e) => {
                setNewDomain(e.target.value);
                if (validationError) setValidationError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddDomain();
                }
              }}
              aria-label={t("video_optimizer.aria_new_domain")}
              aria-invalid={!!validationError}
              aria-describedby={validationError ? "add-domain-error" : undefined}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="sm"
                variant="ghost"
                onClick={handleAddDomain}
                aria-label={t("video_optimizer.aria_add_domain")}
              >
                <Plus className="size-4" />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {validationError ? (
            <FieldError id="add-domain-error">{validationError}</FieldError>
          ) : null}
        </div>

        {displayDomains.length === 0 ? (
          <div className={HOSTLIST.EMPTY}>
            <ListIcon className={HOSTLIST.EMPTY_GLYPH} aria-hidden="true" />
            <p className={HOSTLIST.EMPTY_TEXT}>
              {t("video_optimizer.empty_state_no_domains")}
            </p>
          </div>
        ) : (
          <ul className={HOSTLIST.FIELD} aria-label={t("video_optimizer.hostlist_card_title")}>
            {displayDomains.map(({ domain, originalIndex }) => {
              const isCustom = !defaultSet.has(domain.toLowerCase());
              return (
                <li
                  key={`${domain}-${originalIndex}`}
                  className={cn(
                    HOSTLIST.PILL,
                    isCustom ? HOSTLIST.PILL_CUSTOM : HOSTLIST.PILL_DEFAULT,
                  )}
                >
                  {isCustom ? (
                    <PencilLineIcon
                      className={HOSTLIST.PILL_GLYPH}
                      aria-label={t("video_optimizer.aria_custom_domain_badge")}
                    />
                  ) : null}
                  <span className="truncate">{domain}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className={HOSTLIST.PILL_REMOVE}
                    onClick={() => handleRemoveDomain(originalIndex)}
                    aria-label={t("video_optimizer.aria_remove_domain", { domain })}
                  >
                    <X />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <CardFoot
        className={CARD_PAD}
        status={
          <span className={HOSTLIST.SUMMARY}>
            {t("traffic_engine.hostlist_summary", {
              count: editDomains.length,
              custom: customCount,
            })}
          </span>
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="action"
              onClick={handleDiscard}
              disabled={!isDirty || busy}
            >
              {t("common:actions.discard")}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="tonal-neutral"
                  size="action"
                  disabled={busy}
                >
                  {isRestoring ? (
                    <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
                  ) : (
                    <RotateCcw aria-hidden="true" />
                  )}
                  {isRestoring
                    ? t("video_optimizer.state_restoring")
                    : t("video_optimizer.button_restore_defaults")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("video_optimizer.dialog_restore_title")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("video_optimizer.dialog_restore_desc")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    {t("actions.cancel", { ns: "common" })}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => void handleRestoreDefaults()}
                  >
                    {t("video_optimizer.dialog_action_restore")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <SaveButton
              type="button"
              isSaving={isSaving}
              saved={saved}
              disabled={!isDirty || isRestoring}
              onClick={() => void handleSave()}
              label={t("actions.save", { ns: "common" })}
              size="action"
            />
          </>
        }
      />
    </Card>
  );
}
