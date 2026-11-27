// =============================================================================
// chart-specs.ts — which charts each series panel draws
// =============================================================================
// A panel is a list of charts and a chart is a list of series, both named by
// the archive's own panel ids (`CellHistoryPanel`). The plotting contract of a
// series (unit, bracket, tone, step or slope) lives in `derive.ts`'s
// `METRIC_AXIS`; this file only says which series share a chart and what they
// are called, so adding a metric to the page is one entry here and one there.
//
// `l1` marks a chart whose series exist only while the recorder samples layer-1
// statistics (MCS, rank). When sampling is off and the archive has no reading,
// the chart says "Reporting off" rather than "no data" - those are different
// facts and only the first is something the reader can change.
// =============================================================================

import type { ChartMetric } from "./derive";
import { DASHES } from "./shapes";

export interface SpecSeries {
  metric: ChartMetric;
  /** i18n key of the series name; omit for a single-series chart (title is the name). */
  labelKey?: string;
  dash?: string;
  /** `bar` for packet loss; otherwise the metric's own step/slope. */
  kind?: "bar";
}

export interface ChartSpec {
  id: string;
  /** i18n key of the chart title. */
  titleKey: string;
  series: readonly SpecSeries[];
  l1?: boolean;
}

const LTE = "history.charts.series.lte";
const NR = "history.charts.series.nr";

/** The primary carrier's own readings. */
export const RF_CHARTS: readonly ChartSpec[] = [
  { id: "rsrp", titleKey: "history.charts.metric.rsrp", series: [{ metric: "rsrp" }] },
  { id: "sinr", titleKey: "history.charts.metric.sinr", series: [{ metric: "sinr" }] },
  { id: "rsrq", titleKey: "history.charts.metric.rsrq", series: [{ metric: "rsrq" }] },
  { id: "rssi", titleKey: "history.charts.metric.rssi", series: [{ metric: "rssi" }] },
];

/** Carrier aggregation: how many carriers, how much bandwidth. */
export const AGG_CHARTS: readonly ChartSpec[] = [
  { id: "ca", titleKey: "history.charts.metric.ca", series: [{ metric: "ca" }] },
  { id: "bw", titleKey: "history.charts.metric.bw", series: [{ metric: "bw" }] },
];

/** The PHY layer: what the radio negotiated, per radio. */
export const PHY_CHARTS: readonly ChartSpec[] = [
  {
    id: "dl_mcs",
    titleKey: "history.charts.metric.dl_mcs",
    l1: true,
    series: [
      { metric: "lte_mcs", labelKey: LTE, dash: DASHES[1] },
      { metric: "nr_mcs", labelKey: NR },
    ],
  },
  {
    id: "ul_mcs",
    titleKey: "history.charts.metric.ul_mcs",
    l1: true,
    series: [{ metric: "ul_mcs" }],
  },
  {
    id: "rank",
    titleKey: "history.charts.metric.rank",
    l1: true,
    series: [
      { metric: "lte_ri", labelKey: LTE, dash: DASHES[1] },
      { metric: "nr_ri", labelKey: NR },
    ],
  },
  {
    id: "cqi",
    titleKey: "history.charts.metric.cqi",
    series: [
      { metric: "lte_cqi", labelKey: LTE, dash: DASHES[1] },
      { metric: "nr_cqi", labelKey: NR },
    ],
  },
  {
    id: "tx_power",
    titleKey: "history.charts.metric.tx_power",
    series: [{ metric: "tx_power" }],
  },
];

/** The device itself. */
export const SYSTEM_CHARTS: readonly ChartSpec[] = [
  { id: "temp", titleKey: "history.charts.metric.temp", series: [{ metric: "temp" }] },
  { id: "cpu", titleKey: "history.charts.metric.cpu", series: [{ metric: "cpu" }] },
  { id: "mem", titleKey: "history.charts.metric.mem", series: [{ metric: "mem" }] },
  { id: "dl", titleKey: "history.charts.metric.dl", series: [{ metric: "dl" }] },
  { id: "ul", titleKey: "history.charts.metric.ul", series: [{ metric: "ul" }] },
];

/** Connection quality, from the ping archive joined by time. */
export const QUALITY_CHARTS: readonly ChartSpec[] = [
  {
    id: "latency",
    titleKey: "history.charts.metric.latency",
    series: [
      { metric: "lat", labelKey: "history.charts.metric.lat" },
      { metric: "jit", labelKey: "history.charts.metric.jit", dash: DASHES[1] },
    ],
  },
  {
    id: "loss",
    titleKey: "history.charts.metric.loss",
    series: [{ metric: "loss", kind: "bar" }],
  },
];
