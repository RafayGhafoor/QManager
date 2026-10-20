"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Download,
  Loader2,
  MoreHorizontalIcon,
  Plus,
  RefreshCcwIcon,
  TriangleAlertIcon,
  Upload,
  X,
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
import { CardFoot } from "@/components/ui/card-foot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SaveButton, useSaveFlash } from "@/components/ui/save-button";
import { Skeleton } from "@/components/ui/skeleton";
import type { useCdnHostlist } from "@/hooks/use-cdn-hostlist";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import { validateDomainKey } from "@/lib/validate-domain";
import { cn } from "@/lib/utils";
import { CONDITION, CONDITION_TONE, HOSTS, SKELETON } from "./shapes";
import { groupDomains } from "./video-services";

export type Hostlist = ReturnType<typeof useCdnHostlist>;

const lower = (list: readonly string[]) => new Set(list.map((d) => d.toLowerCase()));

/**
 * The hostname list's draft, owned by the Video Optimizer card so it survives
 * Back: edits stay pending until Save, and a load or save replaces the draft.
 */
export function useHostlistDraft(hostlist: Hostlist) {
  const { t } = useTranslation("local-network");
  const { domains, saveHostlist, restoreDefaults } = hostlist;
  const { saved, markSaved } = useSaveFlash();

  const [draft, setDraft] = useState<string[]>(domains);
  const [prevDomains, setPrevDomains] = useState(domains);
  if (domains !== prevDomains) {
    setPrevDomains(domains);
    setDraft(domains);
  }

  const { added, removed } = useMemo(() => {
    const savedSet = lower(domains);
    const draftSet = lower(draft);
    return {
      added: draft.filter((d) => !savedSet.has(d.toLowerCase())).length,
      removed: domains.filter((d) => !draftSet.has(d.toLowerCase())).length,
    };
  }, [draft, domains]);

  const add = useCallback((domain: string) => setDraft((prev) => [domain, ...prev]), []);
  const remove = useCallback(
    (domain: string) => setDraft((prev) => prev.filter((d) => d !== domain)),
    [],
  );
  const discard = useCallback(() => setDraft(domains), [domains]);

  const save = useCallback(async () => {
    const result = await saveHostlist(draft);
    if (result.ok) {
      markSaved();
      toast.success(t("video_optimizer.toast_save_success"));
    } else {
      toast.error(
        resolveErrorMessage(t, result.code, result.error, t("video_optimizer.toast_save_error")),
      );
    }
  }, [draft, saveHostlist, markSaved, t]);

  const restore = useCallback(async () => {
    const result = await restoreDefaults();
    if (result.ok) {
      toast.success(t("video_optimizer.toast_restore_success"));
    } else {
      toast.error(
        resolveErrorMessage(t, result.code, result.error, t("video_optimizer.toast_restore_error")),
      );
    }
  }, [restoreDefaults, t]);

  /** Adds the new domains from an imported text file to the draft. */
  const importText = useCallback(
    (text: string) => {
      const existing = lower(draft);
      const fresh = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && !existing.has(line.toLowerCase()));
      if (fresh.length === 0) {
        toast.success(t("video_optimizer.toast_import_no_new"));
        return;
      }
      setDraft((prev) => [...fresh, ...prev]);
      toast.success(t("video_optimizer.toast_import_success", { count: fresh.length }));
    },
    [draft, t],
  );

  return {
    draft,
    added,
    removed,
    dirty: added + removed > 0,
    saved,
    add,
    remove,
    discard,
    save,
    restore,
    importText,
  };
}

export type HostlistDraft = ReturnType<typeof useHostlistDraft>;

/** The `⋯` menu in the hostnames view's `CardAction`: Import and Export. */
export function HostnamesMenu({ draft }: { draft: HostlistDraft }) {
  const { t } = useTranslation("local-network");
  const fileRef = useRef<HTMLInputElement>(null);

  const exportList = () => {
    const blob = new Blob([draft.draft.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "video_domains.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("video_optimizer.toast_export_success", { count: draft.draft.length }));
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") draft.importText(text);
    };
    reader.readAsText(file);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={HOSTS.REMOVE}
            aria-label={t("video_optimizer.aria_menu_options")}
          >
            <MoreHorizontalIcon className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" aria-hidden="true" />
            {t("video_optimizer.menu_import")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={exportList}>
            <Download className="size-4" aria-hidden="true" />
            {t("video_optimizer.menu_export")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.csv,text/plain"
        className="hidden"
        onChange={onFile}
      />
    </>
  );
}

interface HostnamesViewProps {
  hostlist: Hostlist;
  draft: HostlistDraft;
}

/**
 * The Video Optimizer card's second view: one column grouped by service,
 * custom domains first, an add field on top and its own Discard / Save foot.
 * The list scrolls inside the card so the mode pair keeps one height.
 */
export function HostnamesView({ hostlist, draft }: HostnamesViewProps) {
  const { t } = useTranslation("local-network");
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const groups = useMemo(() => groupDomains(draft.draft), [draft.draft]);
  const busy = hostlist.isSaving || hostlist.isRestoring;

  if (hostlist.isLoading) {
    return (
      <div className={HOSTS.LIST} aria-hidden="true">
        <Skeleton className={SKELETON.FIELD} />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className={SKELETON.ROW} />
        ))}
      </div>
    );
  }

  if (hostlist.error && hostlist.domains.length === 0) {
    const tone = CONDITION_TONE.destructive;
    return (
      <div role="alert" className={cn(CONDITION.ROOT, tone.ROOT)}>
        <span aria-hidden className={cn(CONDITION.DISC, tone.DISC)}>
          <TriangleAlertIcon className={CONDITION.GLYPH} />
        </span>
        <p className={CONDITION.DESC}>{t("video_optimizer.hostlist_error_load_failed")}</p>
        <div className={CONDITION.ACTIONS}>
          <Button variant="ghost" size="action" onClick={() => void hostlist.refresh()} className={tone.ACTION}>
            <RefreshCcwIcon aria-hidden="true" />
            {t("actions.retry", { ns: "common" })}
          </Button>
        </div>
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = input.trim().toLowerCase();
    if (!value) return;
    const errKey = validateDomainKey(value, draft.draft);
    if (errKey) {
      setInputError(t(errKey));
      return;
    }
    draft.add(value);
    setInput("");
    setInputError(null);
  };

  const status = draft.dirty ? (
    <span>
      <span className="text-on-surface font-semibold">
        {t("traffic_engine.hosts_unsaved", { count: draft.added + draft.removed })}
      </span>{" "}
      (
      {[
        draft.added ? t("traffic_engine.hosts_added", { count: draft.added }) : null,
        draft.removed ? t("traffic_engine.hosts_removed", { count: draft.removed }) : null,
      ]
        .filter(Boolean)
        .join(", ")}
      )
    </span>
  ) : null;

  return (
    <>
      <form className={HOSTS.TOOLBAR} onSubmit={submit}>
        <div className={HOSTS.INPUT_WRAP}>
          <Input
            type="text"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            className={HOSTS.INPUT}
            placeholder={t("video_optimizer.placeholder_new_domain")}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (inputError) setInputError(null);
            }}
            aria-label={t("video_optimizer.aria_new_domain")}
            aria-invalid={!!inputError}
            aria-describedby={inputError ? "te-new-domain-error" : undefined}
          />
          {inputError ? (
            <FieldError id="te-new-domain-error" className="mt-1.5">
              {inputError}
            </FieldError>
          ) : null}
        </div>
        <Button type="submit" variant="tonal" disabled={!input.trim()}>
          <Plus aria-hidden="true" />
          {t("traffic_engine.hosts_add")}
        </Button>
      </form>

      {draft.draft.length === 0 ? (
        <div className={HOSTS.EMPTY}>
          <p className={HOSTS.EMPTY_TITLE}>{t("traffic_engine.hosts_empty_title")}</p>
          <p className={HOSTS.EMPTY_TEXT}>{t("traffic_engine.hosts_empty_desc")}</p>
        </div>
      ) : (
        <div className={HOSTS.SCROLL}>
          <div className={HOSTS.LIST}>
            {groups.map((g) => {
              const name = g.service ?? t("traffic_engine.hosts_group_custom");
              return (
                <section key={name} aria-label={name}>
                  <h3 className={HOSTS.GROUP_HEAD}>
                    <span>{name}</span>
                    <span className={HOSTS.GROUP_COUNT}>{g.domains.length}</span>
                  </h3>
                  <ul>
                    {g.domains.map((d) => (
                      <li key={d} className={HOSTS.ROW}>
                        <span className={HOSTS.NAME} title={d}>
                          {d}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={HOSTS.REMOVE}
                          onClick={() => draft.remove(d)}
                          aria-label={t("video_optimizer.aria_remove_domain", { domain: d })}
                        >
                          <X className="size-4" aria-hidden="true" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}

      <CardFoot
        status={status}
        actions={
          <>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="ghost" disabled={busy}>
                  {hostlist.isRestoring ? (
                    <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
                  ) : null}
                  {hostlist.isRestoring
                    ? t("video_optimizer.state_restoring")
                    : t("video_optimizer.button_restore_defaults")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("video_optimizer.dialog_restore_title")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("video_optimizer.dialog_restore_desc")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void draft.restore()}>
                    {t("video_optimizer.dialog_action_restore")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button type="button" variant="ghost" onClick={draft.discard} disabled={!draft.dirty || busy}>
              {t("actions.discard", { ns: "common" })}
            </Button>
            <SaveButton
              type="button"
              isSaving={hostlist.isSaving}
              saved={draft.saved}
              disabled={!draft.dirty || hostlist.isRestoring}
              onClick={() => void draft.save()}
              label={t("actions.save", { ns: "common" })}
              savingLabel={t("traffic_engine.saving")}
            />
          </>
        }
      />
    </>
  );
}
