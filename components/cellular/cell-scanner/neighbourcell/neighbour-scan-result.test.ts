import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { TFunction } from "i18next";
import { getColumns } from "./neighbour-scan-result";

// The scan worker has always parsed rsrq/rssi/sinr into
// /tmp/qmanager_neighbour_scan_result.json and the CSV export has always written
// all three — only the table had no column for them. These tests pin the
// contract, because the two ways the fix can be quietly undone are invisible to
// everything else in the repo:
//
//   * a dropped column. Nothing type-checks an array of react-table column defs
//     for completeness, and the CSV export keeps working either way, so losing a
//     column would go unnoticed.
//   * a dropped key. `bun run i18n:check` only diffs each catalog against the
//     English superset — it never checks whether code *asks* for a key, so
//     deleting `rsrq` from en and from every translation passes it clean.

// --- A translator backed by the real English catalog -------------------------
// Resolving against en rather than echoing keys back means the assertions below
// read as what the user sees ("-8 dB", "Not reported"), and a key that the
// component asks for but the catalog lacks fails here instead of rendering as a
// raw key name in the browser.

const LOCALES_DIR = join(process.cwd(), "public", "locales");

function pick(node: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      node,
    );
}

const enCatalog: unknown = JSON.parse(
  readFileSync(join(LOCALES_DIR, "en", "cellular.json"), "utf8"),
);

const t = ((key: string, opts?: Record<string, unknown>) => {
  const raw = pick(enCatalog, key);
  if (typeof raw !== "string") {
    throw new Error(`en/cellular.json has no string at "${key}"`);
  }
  return opts
    ? raw.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(opts[name]))
    : raw;
}) as unknown as TFunction;

const columns = () => getColumns(t);

/** react-table keys a column by `accessorKey`, or by `id` when there is neither
 *  an accessor nor a header to derive one from (the actions column). */
const columnIds = () => columns().map((c) => c.accessorKey ?? c.id);

/** Flatten a rendered element tree to the text a user would read. */
function text(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props: { children?: unknown } }).props;
    return text(props.children);
  }
  return "";
}

/** Drive one column's cell renderer with a fake table row. The measurement
 *  cells read only `row.getValue`, so no table instance is needed. */
function renderCell(id: string, value: number | null | undefined) {
  const column = columns().find((c) => (c.accessorKey ?? c.id) === id);
  if (!column?.cell) throw new Error(`no cell renderer for column ${id}`);
  const cell = column.cell as unknown as (ctx: unknown) => unknown;
  return cell({ row: { getValue: () => value } });
}

const MEASUREMENTS = ["rsrq", "rssi", "sinr"] as const;
const UNREPORTED = "Not reported";

// --- The columns -------------------------------------------------------------

describe("neighbour table columns", () => {
  it("renders the identity columns, every measurement the worker reports, then actions", () => {
    expect(columnIds()).toEqual([
      "networkType",
      "cellType",
      "frequency",
      "pci",
      "signalStrength",
      "rsrq",
      "rssi",
      "sinr",
      "actions",
    ]);
  });

  it("orders the measurements after signal strength, RSRQ then RSSI then SINR", () => {
    const ids = columnIds();
    expect(ids.indexOf("signalStrength")).toBeLessThan(ids.indexOf("rsrq"));
    expect(ids.indexOf("rsrq")).toBeLessThan(ids.indexOf("rssi"));
    expect(ids.indexOf("rssi")).toBeLessThan(ids.indexOf("sinr"));
  });

  it("labels each measurement column from the catalog", () => {
    // Resolving through `t` means this fails loudly if a key goes missing.
    const headers = columns().map((c) => c.header);
    expect(headers).toContain("RSRQ");
    expect(headers).toContain("RSSI");
    expect(headers).toContain("SINR");
  });

  it("keeps the actions column last and un-hideable", () => {
    const actions = columns().find((c) => c.id === "actions");
    expect(actions).toBeDefined();
    expect(actions?.enableHiding).toBe(false);
  });
});

// --- What a cell shows -------------------------------------------------------

describe("an unreported measurement", () => {
  it("is not rendered as if it were a reading", () => {
    for (const id of MEASUREMENTS) {
      const el = renderCell(id, null) as {
        props: { label?: string; children?: unknown };
      };
      expect(el.props.label).toBe(UNREPORTED);
      expect(text(el)).not.toMatch(/-?\d/);
    }
  });

  it("uses the same marker for an absent field as for an explicit null", () => {
    // `NeighbourCellResult.rsrq` is optional, so the column has to survive
    // `undefined` as well as the worker's explicit null.
    for (const id of MEASUREMENTS) {
      expect(text(renderCell(id, undefined))).toBe(text(renderCell(id, null)));
    }
  });

  it("still renders a real reading, with its unit", () => {
    // RSSI is dBm where RSRQ and SINR are dB — the same split the serving-cell
    // cards use. NB: `{value} dBm` renders as two children, hence `text()`.
    expect(text(renderCell("rsrq", -8))).toBe("-8 dB");
    expect(text(renderCell("sinr", 12))).toBe("12 dB");
    expect(text(renderCell("rssi", -49))).toBe("-49 dBm");
  });

  it("does not confuse a zero reading with an absence", () => {
    // 0 is the *signal* column's unreported sentinel, not the measurements'.
    for (const id of MEASUREMENTS) {
      const el = renderCell(id, 0) as { props: { label?: string } };
      expect(el.props.label).toBeUndefined();
    }
  });
});

// --- The catalogs this table depends on --------------------------------------

const REQUIRED_KEYS = [
  "cell_scanner.neighbour.column_headers.rsrq",
  "cell_scanner.neighbour.column_headers.rssi",
  "cell_scanner.neighbour.column_headers.sinr",
  "cell_scanner.neighbour.cells.unreported",
  "cell_scanner.neighbour.cells.decibel",
] as const;

const catalogLanguages = readdirSync(LOCALES_DIR).filter((name) =>
  statSync(join(LOCALES_DIR, name)).isDirectory(),
);

describe("neighbour column i18n", () => {
  it("finds a catalog for every shipped language", () => {
    expect(catalogLanguages).toContain("en");
    expect(catalogLanguages).toContain("zh-CN");
    expect(catalogLanguages.length).toBeGreaterThan(1);
  });

  for (const lang of catalogLanguages) {
    it(`${lang} defines every key the neighbour table asks for`, () => {
      const catalog: unknown = JSON.parse(
        readFileSync(join(LOCALES_DIR, lang, "cellular.json"), "utf8"),
      );

      for (const key of REQUIRED_KEYS) {
        const value = pick(catalog, key);
        expect(typeof value, `${lang} is missing ${key}`).toBe("string");
        expect(
          (value as string).trim().length,
          `${lang} has an empty ${key}`,
        ).toBeGreaterThan(0);
      }
    });
  }

  it("leaves the three initialisms untranslated", () => {
    // RSRQ/RSSI/SINR are technical initialisms and stay Latin in every
    // translation, as they do across the rest of the catalogs. Only the copy
    // around them moves.
    for (const lang of catalogLanguages) {
      const catalog: unknown = JSON.parse(
        readFileSync(join(LOCALES_DIR, lang, "cellular.json"), "utf8"),
      );
      for (const name of ["rsrq", "rssi", "sinr"]) {
        expect(
          pick(catalog, `cell_scanner.neighbour.column_headers.${name}`),
          `${lang} translated ${name}`,
        ).toBe(name.toUpperCase());
      }
    }
  });
});
