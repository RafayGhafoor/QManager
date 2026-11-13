"use client";

import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import type { NewestSample } from "./derive";

import { formatMoment } from "./derive";import { PanelEmpty } from "./empty-state";
import {
  CARD_DESC,
  CARD_SHELL,
  CARD_TITLE,
  IDENTITY,
} from "./shapes";

// =============================================================================
// IdentityCard — the newest serving cell in the range, as an identity grid
// =============================================================================
// Not a live card: it is the newest SAMPLE in the selected range, which is why it
// says "as of" with a timestamp instead of presenting itself as current. The
// dashboard is the live surface.
//
// A NULL IS AN EM DASH, AND IT IS THE NORMAL CASE. This modem reports no NR cell
// ID and no NR TAC at all on the NSA leg — `nr_cell_id` and `nr_tac` are `null`
// in every row while `nr_avail` is `1` — so those two rows are the ordinary
// state, not an error. Each absent value prints the dash rather than a 0: "0
// MHz" is a bandwidth and "no PCI" is a fact about the modem, and they must not
// look like the same thing.
//
// `nr_avail` IS THREE-VALUED AND IS DRAWN AS A WORD (present / absent / not
// determined). A dash there would be the same mark as a missing cell ID, and the
// two are opposite claims — "nobody looked" versus "there is no NR leg".
//
// THE NR ROWS ARE NOT BACKFILLED FROM THE LTE ONES. An operator reading "Cell
// ID" on the 5G side must see what the 5G side reported; falling back to the LTE
// cell ID would print a true-looking number for a field the modem never sent.
// =============================================================================

interface IdentityRow {
  key: string;
  labelKey: string;
  value: string | null;
  /** A band is identity, so it renders as a `Tag` rather than as bare ink. */
  tag?: "lte" | "nr";
}

const DASH = "—";

export interface IdentityCardProps {
  sample: NewestSample | null;
}

export function IdentityCard({ sample }: IdentityCardProps) {
  const { t } = useTranslation("cellular");

  if (sample === null) {
    return (
      <Card className={CARD_SHELL}>
        <CardHeader className="gap-1.5">
          <CardTitle className={CARD_TITLE}>{t("history.identity.title")}</CardTitle>
          <CardDescription className={CARD_DESC}>
            {t("history.identity.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PanelEmpty icon="info" body={t("history.identity.empty")} />
        </CardContent>
      </Card>
    );
  }

  const { cell, as_of } = sample;

  const text = (value: string | null) =>
    value === null || value.trim() === "" ? null : value;
  const figure = (value: number | null) => (value === null ? null : String(value));
  const mhz = (value: number | null) => (value === null ? null : `${value} MHz`);
  const asWord = (value: 0 | 1 | null) =>
    value === null
      ? t("history.identity.not_determined")
      : value === 1
        ? t("history.identity.nr_present")
        : t("history.identity.nr_absent");

  const rows: IdentityRow[] = [
    { key: "rat", labelKey: "history.identity.rat", value: text(cell.rat) },
    {
      key: "nr_avail",
      labelKey: "history.identity.nr_avail",
      value: asWord(cell.nr_avail),
    },
    { key: "lte_pci", labelKey: "history.identity.lte_pci", value: figure(cell.lte_pci) },
    {
      key: "lte_earfcn",
      labelKey: "history.identity.lte_earfcn",
      value: figure(cell.lte_earfcn),
    },
    {
      key: "lte_band",
      labelKey: "history.identity.lte_band",
      value: text(cell.lte_band),
      tag: "lte",
    },
    { key: "lte_bw", labelKey: "history.identity.lte_bw", value: mhz(cell.lte_bw) },
    {
      key: "lte_cell_id",
      labelKey: "history.identity.lte_cell_id",
      value: figure(cell.lte_cell_id),
    },
    { key: "lte_tac", labelKey: "history.identity.lte_tac", value: figure(cell.lte_tac) },
    { key: "nr_pci", labelKey: "history.identity.nr_pci", value: figure(cell.nr_pci) },
    {
      key: "nr_arfcn",
      labelKey: "history.identity.nr_arfcn",
      value: figure(cell.nr_arfcn),
    },
    {
      key: "nr_band",
      labelKey: "history.identity.nr_band",
      value: text(cell.nr_band),
      tag: "nr",
    },
    {
      key: "nr_cell_id",
      labelKey: "history.identity.nr_cell_id",
      value: figure(cell.nr_cell_id),
    },
    { key: "nr_tac", labelKey: "history.identity.nr_tac", value: figure(cell.nr_tac) },
  ];

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className="gap-1.5">
        <CardTitle className={CARD_TITLE}>{t("history.identity.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("history.identity.description")}
        </CardDescription>
        <p className={IDENTITY.AS_OF}>
          {t("history.identity.as_of", { time: formatMoment(as_of) })}
        </p>
      </CardHeader>

      <CardContent>
        <dl className={IDENTITY.GRID}>
          {rows.map((row) => (
            <div key={row.key} className={IDENTITY.ROW}>
              <dt className={IDENTITY.LABEL}>{t(row.labelKey)}</dt>
              <dd
                className={cn(
                  row.value === null ? IDENTITY.ABSENT : IDENTITY.VALUE,
                )}
              >
                {row.value === null ? (
                  DASH
                ) : row.tag !== undefined ? (
                  <Tag variant={row.tag} className="font-mono">
                    {row.value}
                  </Tag>
                ) : (
                  row.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

export default IdentityCard;
